import { callProvider, createRequestFactory, PROVIDER_TIMEOUT_MS } from "./learning-session.js";
import { parseSession, parseSubmissionResult, parseTaskResponse } from "./provider.js";

const DEFAULT_FIRST_DELAY = 20_000;
const DEFAULT_REPEAT_DELAY = 60_000;
const DEFAULT_MAX_DELTA = 1_000;

function validIntent(value, task) {
  if (!value || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) return false;
  if (value.type === "answered") return task.options.some(({ optionId }) => optionId === value.optionId);
  if (value.type === "timed_out" || value.type === "skipped") return true;
  return value.type === "cancelled" && ["scene_changed", "hidden", "stopped", "superseded"].includes(value.reason);
}

function matches(result, request) {
  return result.sessionId === request.sessionId && result.taskId === request.taskId &&
    result.questionId === request.questionId && result.questionVersion === request.questionVersion &&
    result.attemptId === request.attemptId;
}

export function createQuizController({
  provider,
  bridge,
  view,
  isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  firstDelayMs = DEFAULT_FIRST_DELAY,
  repeatDelayMs = DEFAULT_REPEAT_DELAY,
  maxDeltaMs = DEFAULT_MAX_DELTA,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  id = () => crypto.randomUUID(),
  log = console,
}) {
  if (!provider || ["createSession", "getNextTask", "submitAnswer", "endSession"].some((name) => typeof provider[name] !== "function")) {
    throw new TypeError("provider must implement the learning provider contract");
  }
  const requestId = createRequestFactory(id);
  let identity = null;
  let lifecycle = null;
  let elapsed = 0;
  let delay = firstDelayMs;
  let lastNow = null;
  let busy = false;
  let activeAttempt = null;
  let activeRun = null;
  let stopped = false;
  let visible = true;
  let gameSessionId = null;
  let lifecycleGeneration = 0;

  const report = (message, error) => log.error(`[quiz] ${message}`, error);

  async function endLifecycle(entry, reason) {
    if (!entry || entry.closePromise) return entry?.closePromise;
    entry.controller.abort();
    entry.closePromise = entry.sessionPromise.then(async (session) => {
      if (!session) return;
      const request = { schemaVersion: 1, requestId: requestId("end"), sessionId: session.sessionId, reason };
      try { await callProvider(provider.endSession.bind(provider), request, { timeoutMs }); }
      catch (error) { report("Failed to end learning session", error); }
    }).catch((error) => {
      if (error?.name !== "AbortError") report("Failed to close learning session", error);
    });
    return entry.closePromise;
  }

  function invalidate(reason) {
    if (!activeAttempt || activeAttempt.invalidated) return;
    activeAttempt.invalidated = true;
    activeAttempt.cancelReason = reason;
    if (view.isOpen()) view.dismiss(reason);
  }

  async function changeIdentity(nextIdentity) {
    if (nextIdentity === identity) return;
    const previous = lifecycle;
    invalidate("scene_changed");
    lifecycleGeneration += 1;
    identity = nextIdentity;
    gameSessionId = nextIdentity ? requestId("game") : null;
    lifecycle = null;
    elapsed = 0;
    delay = firstDelayMs;
    lastNow = null;
    if (previous) await endLifecycle(previous, nextIdentity ? "replaced" : "game_ended");
  }

  function startLifecycle(expectedIdentity) {
    const controller = new AbortController();
    const entry = { identity: expectedIdentity, controller, closePromise: null, pendingTask: null, ended: false };
    const request = { schemaVersion: 1, requestId: requestId("create"), gameSessionId,
      gameContext: bridge.getGameContext() };
    entry.sessionPromise = callProvider(provider.createSession.bind(provider), request, {
      signal: controller.signal,
      timeoutMs,
      onLateValue: (value) => {
        try {
          const session = parseSession(value);
          const end = { schemaVersion: 1, requestId: requestId("end-late"), sessionId: session.sessionId, reason: "abandoned" };
          callProvider(provider.endSession.bind(provider), end, { timeoutMs }).catch((error) => report("Failed to clean up late session", error));
        } catch (error) { report("Ignored malformed late session", error); }
      },
    }).then(parseSession).catch((error) => {
      if (lifecycle === entry) lifecycle = null;
      throw error;
    });
    lifecycle = entry;
    return entry;
  }

  async function getTask(entry) {
    if (entry.pendingTask) return entry.pendingTask;
    const session = await entry.sessionPromise;
    const response = parseTaskResponse(await callProvider(provider.getNextTask.bind(provider), {
      schemaVersion: 1, requestId: requestId("next"), sessionId: session.sessionId,
    }, { signal: entry.controller.signal, timeoutMs }));
    if (response.status === "task") entry.pendingTask = response.task;
    if (response.status === "session_ended") entry.ended = true;
    return entry.pendingTask;
  }

  async function submit(entry, task, attemptId, response) {
    const session = await entry.sessionPromise;
    const request = { schemaVersion: 1, sessionId: session.sessionId, taskId: task.taskId,
      questionId: task.questionId, questionVersion: task.questionVersion, attemptId, response };
    const result = parseSubmissionResult(await callProvider(provider.submitAnswer.bind(provider), request, { timeoutMs }));
    if (!matches(result, request)) throw new Error("Submission result identity mismatch");
    if (response.type === "answered" ? result.status !== "graded" : result.status !== "recorded" || result.outcome !== response.type) {
      throw new Error("Submission result status mismatch");
    }
    return result;
  }

  async function runQuiz(expectedIdentity) {
    const run = {};
    const runGeneration = lifecycleGeneration;
    busy = true;
    activeRun = run;
    let entry;
    let snapshot;
    let attempt;
    let ownsPause = false;
    try {
      entry = lifecycle ?? startLifecycle(expectedIdentity);
      const task = await getTask(entry);
      if (!task || entry.ended) return;
      snapshot = bridge.preflight();
      if (stopped || identity !== expectedIdentity || !snapshot || !visible || !isVisible()) return;
      const attemptId = requestId("attempt");
      attempt = { attemptId, entry, snapshot, task, invalidated: false, cancelReason: null };
      activeAttempt = attempt;
      ownsPause = await bridge.pauseForQuiz(snapshot);
      if (!ownsPause) return;
      if (stopped || identity !== expectedIdentity || !visible || !isVisible() || !bridge.isCurrent(snapshot)) {
        entry.pendingTask = null;
        bridge.releasePause(snapshot);
        ownsPause = false;
        await submit(entry, task, attemptId, {
          type: "cancelled", reason: attempt.cancelReason ?? "scene_changed", elapsedMs: 0,
        });
        return;
      }
      let response = await view.ask(task);
      if (attempt.invalidated) response = {
        type: "cancelled",
        reason: attempt.cancelReason ?? "superseded",
        elapsedMs: Number.isSafeInteger(response?.elapsedMs) && response.elapsedMs >= 0 ? response.elapsedMs : 0,
      };
      if (!validIntent(response, task)) throw new TypeError("Quiz view returned an invalid response intent");
      entry.pendingTask = null;
      bridge.releasePause(snapshot);
      ownsPause = false;
      const result = await submit(entry, task, attemptId, response);
      if (response.type === "answered" && result.correctness === "correct" && !attempt.invalidated &&
        !stopped && identity === expectedIdentity && visible && isVisible() && bridge.isCurrent(snapshot)) {
        bridge.award(snapshot, attemptId);
      }
    } catch (error) {
      report("Learning operation failed", error);
    } finally {
      if (ownsPause) {
        try { bridge.releasePause(snapshot); } catch (error) { report("Failed to release quiz pause", error); }
      }
      if (activeAttempt === attempt) activeAttempt = null;
      if (activeRun === run) {
        activeRun = null;
        busy = false;
      }
      if (runGeneration === lifecycleGeneration) {
        elapsed = 0;
        delay = entry?.pendingTask ? 0 : repeatDelayMs;
        lastNow = null;
      }
    }
  }

  async function tick(now) {
    if (stopped) return;
    const nextIdentity = bridge.getLevelIdentity();
    if (nextIdentity !== identity) await changeIdentity(nextIdentity);
    if (nextIdentity !== identity || nextIdentity !== bridge.getLevelIdentity()) return;
    if (busy) {
      if (activeAttempt && (!bridge.isCurrent(activeAttempt.snapshot) ||
        (view.isOpen() && !bridge.isQuizActive(activeAttempt.snapshot)))) invalidate("scene_changed");
      lastNow = now;
      return;
    }
    if (!nextIdentity || !visible || !isVisible() || !bridge.isEligible()) { lastNow = now; return; }
    if (lifecycle?.pendingTask) { await runQuiz(nextIdentity); return; }
    if (lastNow === null) { lastNow = now; return; }
    elapsed += Math.min(Math.max(now - lastNow, 0), maxDeltaMs);
    lastNow = now;
    if (elapsed >= delay && !lifecycle?.ended) await runQuiz(nextIdentity);
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    lastNow = null;
    if (!nextVisible) { elapsed = 0; invalidate("hidden"); }
  }

  async function stop() {
    if (stopped) return lifecycle?.closePromise;
    stopped = true;
    invalidate("stopped");
    return endLifecycle(lifecycle, "stopped");
  }

  return { tick, setVisible, stop };
}
