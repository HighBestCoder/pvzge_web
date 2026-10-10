import { callProvider, createRequestFactory, PROVIDER_TIMEOUT_MS } from "./learning-session.js";
import { parseEndSessionResult, parseSession, parseSubmissionResult, parseTaskResponse } from "./provider.js";
import { requiredCorrect } from "./quiz-config.js";
import { createQuizControllerLifecycle } from "./quiz-controller-lifecycle.js";

function validIntent(value, task) {
  if (!value || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) return false;
  if (task.kind === "single_choice") {
    if (value.type === "answered") return task.options.some(({ optionId }) => optionId === value.optionId);
    return value.type === "timed_out" || value.type === "skipped";
  }
  if (task.kind === "numeric_entry" && value.type === "entered") {
    const arity = ["fraction", "pair"].includes(task.inputSpec.format) ? 2 : 1;
    if (!Array.isArray(value.values) || value.values.length !== arity ||
      value.values.some((field) => typeof field !== "string" || field.length < 1 || field.length > 16)) return false;
    if (task.inputSpec.format === "decimal") return /^[0-9]+(?:\.[0-9]+)?$/.test(value.values[0]);
    if (["integer", "digits", "pair"].includes(task.inputSpec.format)) {
      return value.values.every((field) => /^[0-9]+$/.test(field));
    }
    return /^-?[0-9]+$/.test(value.values[0]) && /^0*[1-9][0-9]*$/.test(value.values[1]);
  }
  return value.type === "timed_out" || value.type === "skipped";
}

function matches(result, request) {
  return result.sessionId === request.sessionId && result.taskId === request.taskId &&
    result.questionId === request.questionId && result.questionVersion === request.questionVersion &&
    result.attemptId === request.attemptId;
}

export function createQuizController({
  provider,
  view,
  isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  timeoutMs = PROVIDER_TIMEOUT_MS,
  id = () => crypto.randomUUID(),
  log = console,
}) {
  if (!provider || ["createSession", "getNextTask", "submitAnswer", "endSession"]
    .some((name) => typeof provider[name] !== "function")) {
    throw new TypeError("provider must implement the learning provider contract");
  }
  const requestId = createRequestFactory(id);
  const lifecycle = createQuizControllerLifecycle({ view, isVisible, timeoutMs, log });

  async function closeSession(session, state, complete, progress) {
    if (!session) return null;
    if (state.suspended) return null;
    const request = { schemaVersion: 1, requestId: requestId("end"), sessionId: session.sessionId,
      reason: state.cancelled || lifecycle.stopped() ? "abandoned" : complete ? "game_ended" : "stopped" };
    const parse = (value) => {
        const result = parseEndSessionResult(value);
        if (result.sessionId !== session.sessionId) throw new Error("End-session identity mismatch");
        if (result.final.questionCount !== session.questionCount) throw new Error("End-session question count mismatch");
        return result;
      };
    if (state.cancelled || lifecycle.stopped()) {
      try { return parse(await callProvider(provider.endSession.bind(provider), request, { timeoutMs })); }
      catch (error) { log.error("[quiz] Partial session finalization failed", error); return null; }
    }
    return lifecycle.retryable(provider.endSession.bind(provider), request,
      { ...progress, current: session.questionCount, total: session.questionCount,
        message: "正在确认学习奖励" }, state, parse);
  }

  async function executeRound(gameContext, state) {
    let session = null;
    let correctCount = 0;
    let wrongCount = 0;
    let completedCount = 0;
    let rewardSunCount = 0;
    let rewardSunValue = 0;
    let complete = false;
    let finalResult = null;
    try {
      const createRequest = { schemaVersion: 1, requestId: requestId("create"),
        gameSessionId: requestId("game"), gameContext };
      session = await lifecycle.retryable(provider.createSession.bind(provider), createRequest,
        { current: 1, total: 10, correctCount }, state, parseSession);
      if (!session) return { correctCount: 0, questionCount: 0, completed: false,
        cancelled: state.cancelled || lifecycle.stopped(), ...(state.reason ? { reason: state.reason } : {}) };
      const questionCount = session.questionCount ?? 10;
      completedCount = session.completedCount ?? 0;
      correctCount = session.correctCount ?? 0;
      wrongCount = session.wrongCount ?? 0;
      rewardSunCount = correctCount * 5;
      rewardSunValue = rewardSunCount * 50;
      if (completedCount === 0 && session.stageCard) {
        if (!lifecycle.available()) await lifecycle.waitUntilVisible(state);
        if (!lifecycle.terminal(state)) {
          const cardProgress = { current: 1, total: questionCount, correctCount, wrongCount,
            rewardSunCount, rewardSunValue, challengeRule: session.challengeRule };
          let cardAction = await view.showStageCard(session.stageCard, cardProgress);
          while (cardAction?.action === "dismissed" && cardAction.reason === "hidden" &&
            !lifecycle.terminal(state)) {
            await lifecycle.waitUntilVisible(state);
            if (!lifecycle.terminal(state)) cardAction = await view.showStageCard(session.stageCard, cardProgress);
          }
          if (cardAction?.action !== "start" && !lifecycle.terminal(state)) {
            throw new TypeError("Quiz view returned an invalid stage-card intent");
          }
        }
      }
      for (; completedCount < questionCount && !lifecycle.terminal(state);) {
        const progress = { current: completedCount + 1, total: questionCount, correctCount,
          wrongCount, rewardSunCount, rewardSunValue, challengeRule: session.challengeRule };
        const nextRequest = { schemaVersion: 1, requestId: requestId("next"), sessionId: session.sessionId };
        const response = await lifecycle.retryable(provider.getNextTask.bind(provider), nextRequest, progress,
          state, parseTaskResponse);
        if (!response) break;
        if (response.status !== "task") {
          if (response.status === "no_task" && completedCount < questionCount) {
            throw new Error("Learning provider ended tasks before reported progress completed");
          }
          complete = completedCount >= questionCount;
          break;
        }
        view.dismiss("ready");
        if (!lifecycle.available() && !await lifecycle.waitUntilVisible(state)) break;
        let intent = await view.ask(response.task, progress);
        while (intent?.type === "cancelled" && intent.reason === "hidden" &&
          !lifecycle.terminal(state)) {
          await lifecycle.waitUntilVisible(state);
          if (!lifecycle.terminal(state)) intent = await view.ask(response.task, progress);
        }
        if (lifecycle.terminal(state)) break;
        if (!validIntent(intent, response.task)) throw new TypeError("Quiz view returned an invalid response intent");
        const submitRequest = { schemaVersion: 1, sessionId: session.sessionId,
          taskId: response.task.taskId, questionId: response.task.questionId,
          questionVersion: response.task.questionVersion, attemptId: requestId("attempt"), response: intent };
        const result = await lifecycle.retryable(provider.submitAnswer.bind(provider), submitRequest,
          { ...progress, message: "正在判题" },
          state, (value) => {
            const parsed = parseSubmissionResult(value, response.task.kind);
            if (!matches(parsed, submitRequest)) throw new Error("Submission result identity mismatch");
            const validStatus = ["answered", "entered"].includes(intent.type) ? (parsed.status === "graded" ||
              (parsed.status === "recorded" && parsed.outcome === "timed_out")) :
              parsed.status === "recorded" && parsed.outcome === intent.type;
            if (!validStatus) throw new Error("Submission result status mismatch");
            return parsed;
          });
        if (!result || lifecycle.terminal(state)) break;
        ({ correctCount, wrongCount, completedCount, rewardSunCount, rewardSunValue } = result.progress);
        let continuation = await view.showResult(result, { ...progress, correctCount, wrongCount,
          rewardSunCount, rewardSunValue });
        while (continuation?.action === "dismissed" && continuation.reason === "hidden" &&
          !lifecycle.terminal(state)) {
          await lifecycle.waitUntilVisible(state);
          if (!lifecycle.terminal(state)) {
            continuation = await view.showResult(result, { ...progress, correctCount, wrongCount,
              rewardSunCount, rewardSunValue });
          }
        }
        if (continuation?.action !== "next" && !lifecycle.terminal(state)) {
          throw new TypeError("Quiz view returned an invalid continuation intent");
        }
        if (lifecycle.terminal(state)) break;
      }
      complete = completedCount >= questionCount;
      finalResult = await closeSession(session, state, complete, { correctCount, wrongCount,
        rewardSunCount, rewardSunValue, challengeRule: session.challengeRule });
      if (!finalResult) return { learningSessionId: session.sessionId,
        ...(session.saveId ? { saveId: session.saveId } : {}), correctCount, questionCount,
        reward: { grantId: "unconfirmed", sunCount: 0 }, completed: false,
        cancelled: state.cancelled || lifecycle.stopped(), ...(state.suspended ? { suspended: true } : {}),
        ...(state.reason ? { reason: state.reason } : {}) };
      return { learningSessionId: session.sessionId, ...(session.saveId ? { saveId: session.saveId } : {}),
        correctCount: finalResult.final.correctCount, questionCount: finalResult.final.questionCount,
        wrongCount: finalResult.final.wrongCount, reward: finalResult.final.reward,
        challenge: finalResult.final.challenge, gameUnlocked: finalResult.final.gameUnlocked,
        completed: complete && !state.cancelled && !lifecycle.stopped(),
        cancelled: state.cancelled || lifecycle.stopped(),
        ...(state.reason ? { reason: state.reason } : {}) };
    } finally {
      view.dismiss(state.reason ?? "completed");
    }
  }

  // Rounds repeat until one reaches the unlock accuracy; only that round's reward reaches the game.
  // Leaving from the retry card ends with reason "user", which sends the player back to the menu.
  async function execute(gameContext, state) {
    for (;;) {
      const round = await executeRound(gameContext, state);
      if (!round.completed || round.gameUnlocked || lifecycle.terminal(state)) return round;
      const summary = { correctCount: round.correctCount, questionCount: round.questionCount,
        requiredCount: requiredCorrect(round.questionCount) };
      const progress = { current: round.questionCount, total: round.questionCount,
        correctCount: round.correctCount, wrongCount: round.wrongCount };
      let action = null;
      do {
        if (!lifecycle.available()) await lifecycle.waitUntilVisible(state);
        if (lifecycle.terminal(state)) break;
        action = await view.showRetry(summary, progress, { onCancel: () => lifecycle.cancel("user") });
      } while (action?.action === "dismissed" && action.reason === "hidden" && !lifecycle.terminal(state));
      if (lifecycle.terminal(state)) {
        return { ...round, completed: false, cancelled: true, ...(state.reason ? { reason: state.reason } : {}) };
      }
      if (action?.action !== "retry") throw new TypeError("Quiz view returned an invalid retry intent");
    }
  }

  function run(gameContext) {
    return lifecycle.run(execute, gameContext);
  }

  return { run, setVisible: lifecycle.setVisible, stop: lifecycle.stop, suspend: lifecycle.suspend };
}
