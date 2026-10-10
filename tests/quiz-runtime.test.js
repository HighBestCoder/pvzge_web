import { describe, expect, test } from "bun:test";

import { createQuizController } from "../docs/learning/quiz-controller.js";
import { formatProgressSummary, normalizeProgress } from "../docs/learning/quiz-view-elements.js";

const task = (number) => ({
  taskId: `task-${number}`, questionId: `question-${number}`, questionVersion: 1,
  kind: "single_choice", content: { format: "plain_text", prompt: `${number} + 1 = ?` },
  options: ["a", "b", "c", "d"].map((optionId) => ({
    optionId, content: { format: "plain_text", text: optionId },
  })),
  metadata: { subjectId: "math", skillIds: ["addition"] }, timeLimitMs: 20_000,
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ answers = [], tasks = [task(1), task(2), task(3)], submitHook,
  showResult, questionCount = tasks.length, completedCount = 0, correctCount = 0, wrongCount = 0,
  challengeRule = { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
  unlocks = [], retryActions = [] } = {}) {
  const requests = { create: [], next: [], submit: [], end: [] };
  const loading = [];
  const progress = [];
  const feedback = [];
  const dismissals = [];
  const retries = [];
  let next = 0;
  let roundSubmits = 0;
  let providerCorrect = correctCount;
  let visible = true;
  const provider = {
    async createSession(request) {
      requests.create.push(structuredClone(request));
      next = 0;
      roundSubmits = 0;
      providerCorrect = correctCount;
      return { schemaVersion: 1, status: "active", sessionId: "session-1", learnerRef: "learner",
        plan: { planId: "plan", title: "Plan", subjectId: "math", skillIds: ["addition"] },
        questionCount, completedCount, correctCount, wrongCount, challengeRule,
        saveId: 1, configurationVersion: 1 };
    },
    async getNextTask(request) {
      requests.next.push(structuredClone(request));
      const value = tasks[next++];
      return value ? { schemaVersion: 1, status: "task", task: value } : { schemaVersion: 1, status: "no_task" };
    },
    async submitAnswer(request) {
      requests.submit.push(structuredClone(request));
      roundSubmits += 1;
      const result = submitHook ? await submitHook(request, requests.submit.length) : {
        schemaVersion: 1, status: request.response.type === "answered" ? "graded" : "recorded",
        sessionId: request.sessionId, taskId: request.taskId, questionId: request.questionId,
        questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: "evidence",
        ...(request.response.type === "answered" ? { correctness: "correct" } : { outcome: request.response.type }) };
      if (result.status === "graded" && result.correctness === "correct" && result.taskId === request.taskId) providerCorrect += 1;
      result.progress ??= { correctCount: providerCorrect,
        wrongCount: result.status === "graded" && result.correctness === "incorrect" ? wrongCount + 1 : wrongCount,
        completedCount: completedCount + roundSubmits,
        rewardSunCount: providerCorrect * 5, rewardSunValue: providerCorrect * 250 };
      providerCorrect = result.progress.correctCount;
      return result;
    },
    async endSession(request) {
      requests.end.push(structuredClone(request));
      return { schemaVersion: 1, status: "ended", sessionId: request.sessionId,
        final: { correctCount: providerCorrect, wrongCount, questionCount, passed: false,
          gameUnlocked: unlocks[requests.end.length - 1] ?? true,
          reward: { grantId: `grant-${requests.end.length}`, sunCount: providerCorrect * 5 },
          challenge: { enabled: challengeRule.enabled, ruleVersion: challengeRule.version,
            extraPerWave: challengeRule.enabled ? Math.min(wrongCount, challengeRule.perWaveCap) : 0,
            maxWaves: challengeRule.maxWaves, totalCap: challengeRule.totalCap } } };
    },
  };
  const view = {
    async ask(_task, currentProgress) {
      progress.push(structuredClone(currentProgress));
      return answers[currentProgress.current - 1] ?? { type: "timed_out", elapsedMs: 20_000 };
    },
    showLoading(currentProgress, options) { loading.push({ progress: currentProgress, options }); },
    async showResult(result, currentProgress) {
      feedback.push({ result: structuredClone(result), progress: structuredClone(currentProgress) });
      if (showResult) await showResult(result, currentProgress);
      return { action: "next" };
    },
    async showRetry(summary, currentProgress, options) {
      retries.push(structuredClone({ summary, progress: currentProgress }));
      const action = retryActions[retries.length - 1] ?? "retry";
      if (action === "cancel") { options.onCancel(); return { action: "dismissed", reason: "user" }; }
      return { action };
    },
    dismiss(reason) { dismissals.push(reason); },
  };
  let serial = 0;
  const controller = createQuizController({ provider, view, isVisible: () => visible,
    id: () => `id-${++serial}`, log: { error() {} } });
  return { controller, dismissals, feedback, loading, progress, requests, retries,
    setVisible(value) { visible = value; controller.setVisible(value); } };
}

describe("pre-level quiz batch", () => {
  test("defaults progress to the ten-question batch", () => {
    expect(normalizeProgress()).toEqual({ current: 1, total: 10, correctCount: 0,
      challengeRule: null, message: undefined });
    expect(formatProgressSummary({ correctCount: 3 })).toBe("已答对3题 · 达标后可得15个阳光（750点）");
  });

  test("uses server-confirmed progress for feedback and forwards the final challenge", async () => {
    const challengeRule = { enabled: true, version: 2, perWaveCap: 2, maxWaves: 3, totalCap: 6 };
    const answers = Array(7).fill(null);
    answers.push({ type: "answered", optionId: "a", elapsedMs: 1 });
    const h = harness({ tasks: [task(1)], questionCount: 8, completedCount: 7, correctCount: 6,
      wrongCount: 1, challengeRule, answers,
      submitHook: async request => ({ schemaVersion: 1, status: "graded", sessionId: request.sessionId,
        taskId: request.taskId, questionId: request.questionId, questionVersion: request.questionVersion,
        attemptId: request.attemptId, evidenceId: "e", correctness: "correct",
        progress: { correctCount: 7, wrongCount: 1, completedCount: 8,
          rewardSunCount: 35, rewardSunValue: 1750 } }) });
    const result = await h.controller.run({ gameId: "pvzge", levelIds: ["egypt3"], locale: "zh-CN" });
    expect(h.feedback[0].progress).toMatchObject({ correctCount: 7, wrongCount: 1,
      rewardSunCount: 35, rewardSunValue: 1750 });
    expect(h.loading.findLast(({ progress }) => progress.message === "正在确认学习奖励").progress.correctCount)
      .toBe(7);
    expect(result.challenge).toEqual({ enabled: true, ruleVersion: 2, extraPerWave: 1,
      maxWaves: 3, totalCap: 6 });
  });

  test("exposes no periodic scheduler API", () => {
    const h = harness();
    expect(h.controller.tick).toBeUndefined();
  });

  test("uses dynamic counts and resumes server progress for 3 and 12 question configurations", async () => {
    for (const questionCount of [3, 12]) {
      const completedCount = 1;
      const tasks = Array.from({ length: questionCount - completedCount }, (_, index) => task(index + 1));
      const answers = tasks.map(() => ({ type: "skipped", elapsedMs: 1 }));
      const h = harness({ tasks, answers, questionCount, completedCount, correctCount: 1 });
      const result = await h.controller.run({ gameId: "pvzge", levelIds: ["tutorial-1"], locale: "zh-CN" });
      expect(result.questionCount).toBe(questionCount);
      expect(h.progress[0]).toMatchObject({ current: 2, total: questionCount, correctCount: 1,
        wrongCount: 0, rewardSunCount: 5, rewardSunValue: 250 });
      expect(h.requests.submit).toHaveLength(questionCount - completedCount);
    }
  });

  test("accepts server timeout normalization for an answer at the deadline", async () => {
    const h = harness({ tasks: [task(1)], questionCount: 1,
      answers: [{ type: "answered", optionId: "a", elapsedMs: 20_000 }],
      submitHook: async request => ({ schemaVersion: 1, status: "recorded", sessionId: request.sessionId,
        taskId: request.taskId, questionId: request.questionId, questionVersion: request.questionVersion,
        attemptId: request.attemptId, evidenceId: "e", outcome: "timed_out" }) });
    expect(await h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" }))
      .toMatchObject({ correctCount: 0, completed: true });
  });

  test("runs exactly ten sequential tasks and exposes progress through the final question", async () => {
    const tasks = Array.from({ length: 10 }, (_, index) => task(index + 1));
    const answers = tasks.map((_, index) => ({ type: "answered", optionId: "a", elapsedMs: index + 1 }));
    const h = harness({ tasks, answers, submitHook: async (request, count) => ({ schemaVersion: 1,
      status: request.response.type === "answered" ? "graded" : "recorded",
      sessionId: request.sessionId, taskId: request.taskId, questionId: request.questionId,
      questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: `e-${count}`,
      ...(request.response.type === "answered" ? { correctness: "correct" } : { outcome: request.response.type }) }) });

    const result = await h.controller.run({ gameId: "pvzge", levelIds: ["1", "2"], locale: "zh-CN" });

    expect(result).toMatchObject({ learningSessionId: "session-1", saveId: 1, correctCount: 10,
      questionCount: 10, reward: { grantId: "grant-1", sunCount: 50 }, completed: true, cancelled: false });
    expect(h.requests.next).toHaveLength(10);
    expect(h.requests.submit).toHaveLength(10);
    expect(h.progress.map(({ current, total, correctCount }) => ({ current, total, correctCount })))
      .toEqual(tasks.map((_, index) => ({ current: index + 1, total: 10, correctCount: index })));
    expect(h.requests.end[0].reason).toBe("game_ended");
  });

  test("does not treat premature no_task as completion", async () => {
    const h = harness({ tasks: [] });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["custom-1"], locale: "zh-CN" });
    while (!h.loading.some(({ options }) => options.onRetry)) await Promise.resolve();
    h.loading.findLast(({ options }) => options.onRetry).options.onCancel();
    expect((await running).completed).toBe(false);
  });

  test("counts incorrect answers and timeouts as zero reward", async () => {
    const h = harness({
      tasks: [task(1), task(2)],
      answers: [
        { type: "answered", optionId: "b", elapsedMs: 10 },
        { type: "timed_out", elapsedMs: 20_000 },
      ],
      submitHook: async (request) => ({ schemaVersion: 1,
        status: request.response.type === "answered" ? "graded" : "recorded",
        sessionId: request.sessionId, taskId: request.taskId, questionId: request.questionId,
        questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: "evidence",
        ...(request.response.type === "answered" ? { correctness: "incorrect" } : { outcome: "timed_out" }) }),
    });

    const result = await h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });

    expect(result).toMatchObject({ correctCount: 0, questionCount: 2, completed: true, cancelled: false });
    expect(h.requests.submit.map(({ response }) => response.type)).toEqual(["answered", "timed_out"]);
    expect(h.feedback.map(({ result }) => result.status === "graded" ? result.correctness : result.outcome))
      .toEqual(["incorrect", "timed_out"]);
  });

  test("shows accepted correct, wrong, timeout, and skip results once before requesting the next task", async () => {
    const gates = Array.from({ length: 4 }, deferred);
    const events = [];
    const intents = [
      { type: "answered", optionId: "a", elapsedMs: 1 },
      { type: "answered", optionId: "b", elapsedMs: 2 },
      { type: "timed_out", elapsedMs: 20_000 },
      { type: "skipped", elapsedMs: 3 },
    ];
    const h = harness({ tasks: intents.map((_, index) => task(index + 1)), answers: intents,
      showResult: async (_result, progress) => { events.push(`result-${progress.current}`); await gates[progress.current - 1].promise; },
      submitHook: async (request, count) => ({ schemaVersion: 1,
        status: request.response.type === "answered" ? "graded" : "recorded",
        sessionId: request.sessionId, taskId: request.taskId, questionId: request.questionId,
        questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: `e-${count}`,
        ...(request.response.type === "answered"
          ? { correctness: count === 1 ? "correct" : "incorrect" }
          : { outcome: request.response.type }) }) });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    for (let index = 0; index < gates.length; index += 1) {
      while (h.feedback.length <= index) await Promise.resolve();
      expect(h.requests.next).toHaveLength(index + 1);
      gates[index].resolve();
    }
    await running;
    expect(events).toEqual(["result-1", "result-2", "result-3", "result-4"]);
    expect(h.feedback.map(({ result }) => result.status === "graded" ? result.correctness : result.outcome))
      .toEqual(["correct", "incorrect", "timed_out", "skipped"]);
  });

  test("requires an explicit next action after accepted feedback", async () => {
    const next = deferred();
    const h = harness({ tasks: [task(1)], questionCount: 1,
      answers: [{ type: "answered", optionId: "a", elapsedMs: 1 }],
      showResult: () => next.promise });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (h.feedback.length === 0) await Promise.resolve();
    expect(h.requests.end).toHaveLength(0);
    let settled = false;
    running.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    next.resolve();
    expect((await running).completed).toBe(true);
  });

  test("keeps grading failures in loading state and shows no false correctness before a valid retry", async () => {
    const accepted = deferred();
    const h = harness({ tasks: [task(1)], answers: [{ type: "answered", optionId: "a", elapsedMs: 1 }],
      showResult: () => accepted.promise,
      submitHook: async (request, count) => count === 1
        ? { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: "stale",
          questionId: request.questionId, questionVersion: request.questionVersion,
          attemptId: request.attemptId, evidenceId: "bad", correctness: "incorrect" }
        : { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: request.taskId,
          questionId: request.questionId, questionVersion: request.questionVersion,
          attemptId: request.attemptId, evidenceId: "good", correctness: "correct" } });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (!h.loading.some(({ options }) => options.onRetry)) await Promise.resolve();
    expect(h.feedback).toHaveLength(0);
    expect(h.loading.some(({ progress }) => progress.message === "正在判题")).toBe(true);
    expect(h.loading.findLast(({ options }) => options.onRetry).progress.message)
      .toBe("学习服务暂不可用，可重试或返回主菜单");
    h.loading.findLast(({ options }) => options.onRetry).options.onRetry();
    while (h.feedback.length === 0) await Promise.resolve();
    expect(h.feedback[0].result.correctness).toBe("correct");
    accepted.resolve();
    await running;
  });

  test("waits for final feedback before ending the session and stop dismisses a pending result", async () => {
    const feedbackGate = deferred();
    const h = harness({ tasks: [task(1)], answers: [{ type: "answered", optionId: "a", elapsedMs: 1 }],
      showResult: () => feedbackGate.promise });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (h.feedback.length === 0) await Promise.resolve();
    expect(h.requests.end).toHaveLength(0);
    h.controller.stop();
    feedbackGate.resolve();
    expect(await running).toMatchObject({ completed: false, cancelled: true, reason: "stopped" });
    expect(h.feedback).toHaveLength(1);
    expect(h.dismissals).toContain("stopped");
    expect(h.requests.end).toHaveLength(1);
    expect(h.requests.end[0].reason).toBe("abandoned");
  });

  test("page lifecycle suspension settles locally without submitting or ending the resumable session", async () => {
    let resolveQuestion;
    const requests = { submit: [], end: [] };
    const provider = {
      async createSession() { return { schemaVersion: 1, status: "active", sessionId: "session-1",
        learnerRef: "learner", plan: { planId: "p", title: "P", subjectId: "math", skillIds: ["addition"] },
        questionCount: 15, completedCount: 6, correctCount: 6, wrongCount: 0, saveId: 7,
        configurationVersion: 1 }; },
      async getNextTask() { return { schemaVersion: 1, status: "task", task: task(7) }; },
      async submitAnswer(request) { requests.submit.push(request); throw new Error("must not submit"); },
      async endSession(request) { requests.end.push(request); throw new Error("must not end"); },
    };
    const view = { showLoading() {}, showResult() {},
      ask() { return new Promise((resolve) => { resolveQuestion = resolve; }); },
      dismiss(reason) { if (reason === "pagehide") resolveQuestion?.({ type: "cancelled", reason: "hidden", elapsedMs: 0 }); } };
    const controller = createQuizController({ provider, view, id: () => "stable", log: { error() {} } });
    const running = controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (!resolveQuestion) await Promise.resolve();

    controller.suspend();

    expect(await running).toMatchObject({ completed: false, suspended: true, reason: "pagehide" });
    expect(requests.submit).toHaveLength(0);
    expect(requests.end).toHaveLength(0);
  });

  test("retries a mismatched grade with the exact same attempt payload", async () => {
    let retry;
    const h = harness({ tasks: [task(1)], answers: [{ type: "answered", optionId: "a", elapsedMs: 1 }],
      submitHook: async (request, count) => count === 1
        ? { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: "wrong",
          questionId: request.questionId, questionVersion: 1, attemptId: request.attemptId,
          evidenceId: "bad", correctness: "correct" }
        : { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: request.taskId,
          questionId: request.questionId, questionVersion: 1, attemptId: request.attemptId,
          evidenceId: "good", correctness: "correct" } });
    const running = h.controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (!h.loading.some(({ options }) => options.onRetry)) await Promise.resolve();
    retry = h.loading.findLast(({ options }) => options.onRetry).options.onRetry;
    retry();
    const result = await running;
    expect(result.correctCount).toBe(1);
    expect(h.requests.submit[1]).toEqual(h.requests.submit[0]);
  });

  test("only explicit cancellation lets a pending provider call finish the gate", async () => {
    const pending = deferred();
    const view = { showLoading(_progress, options) { queueMicrotask(options.onCancel); }, dismiss() {}, ask() {} };
    const provider = { createSession: () => pending.promise, getNextTask() {}, submitAnswer() {}, endSession() {} };
    const controller = createQuizController({ provider, view, id: () => "stable", log: { error() {} } });
    expect(await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" }))
      .toMatchObject({ correctCount: 0, completed: false, cancelled: true, reason: "user" });
  });

  test("hidden and stopped controllers never complete a transition", async () => {
    const pending = deferred();
    const view = { showLoading() {}, dismiss() {}, ask() {} };
    const provider = { createSession: () => pending.promise, getNextTask() {}, submitAnswer() {}, endSession() {} };
    const hidden = createQuizController({ provider, view, id: () => "hidden", log: { error() {} } });
    const hiddenRun = hidden.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    hidden.setVisible(false);
    let hiddenSettled = false;
    hiddenRun.finally(() => { hiddenSettled = true; });
    await Promise.resolve();
    expect(hiddenSettled).toBe(false);
    hidden.stop();
    expect((await hiddenRun).completed).toBe(false);
    const stopped = createQuizController({ provider, view, id: () => "stopped", log: { error() {} } });
    const stoppedRun = stopped.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    stopped.stop();
    expect((await stoppedRun).cancelled).toBe(true);
  });

  test("same-turn hide and show wakes a dismissed question", async () => {
    let activeAnswer;
    let asks = 0;
    const view = {
      ask(_task, progress) {
        asks += 1;
        if (asks > 1) return Promise.resolve({ type: "answered", optionId: "a", elapsedMs: progress.current });
        return new Promise((resolve) => { activeAnswer = resolve; });
      },
      showLoading() {},
      async showResult() { return { action: "next" }; },
      dismiss(reason) {
        if (reason === "hidden" && activeAnswer) {
          const resolve = activeAnswer;
          activeAnswer = null;
          resolve({ type: "cancelled", reason: "hidden", elapsedMs: 0 });
        }
      },
    };
    let serial = 0;
    let submitted = 0;
    const controller = createQuizController({ provider: {
      createSession: async () => ({ schemaVersion: 1, status: "active", sessionId: "s",
        learnerRef: "l", plan: { planId: "p", title: "p", subjectId: "m", skillIds: ["a"] },
        questionCount: 10, completedCount: 0, correctCount: 0, wrongCount: 0,
        challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
        saveId: 1, configurationVersion: 1 }),
      getNextTask: async request => ({ schemaVersion: 1, status: "task", task: task(request.requestId) }),
      submitAnswer: async request => {
        submitted += 1;
        return { schemaVersion: 1, status: "graded", sessionId: request.sessionId,
          taskId: request.taskId, questionId: request.questionId, questionVersion: request.questionVersion,
          attemptId: request.attemptId, evidenceId: "e", correctness: "correct",
          progress: { correctCount: submitted, wrongCount: 0, completedCount: submitted,
            rewardSunCount: submitted * 5, rewardSunValue: submitted * 250 } };
      },
      endSession: async request => ({ schemaVersion: 1, status: "ended", sessionId: request.sessionId,
        final: { correctCount: 10, questionCount: 10, passed: true, reward: { grantId: "g", sunCount: 50 } } }),
    }, view, id: () => `wake-${++serial}`, log: { error() {} } });
    const running = controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (!activeAnswer) await Promise.resolve();
    controller.setVisible(false);
    controller.setVisible(true);
    const result = await running;
    expect(result).toMatchObject({ correctCount: 10, questionCount: 10, completed: true, cancelled: false });
    expect(asks).toBe(11);
  });

  test("visibility-aborted provider request resumes automatically without retry UI", async () => {
    const requests = [];
    const loading = [];
    let createCalls = 0;
    const provider = {
      createSession(request, { signal }) {
        requests.push(structuredClone(request));
        createCalls += 1;
        if (createCalls > 1) return Promise.resolve({ schemaVersion: 1, status: "active", sessionId: "s",
          learnerRef: "l", plan: { planId: "p", title: "p", subjectId: "m", skillIds: ["a"] },
          questionCount: 1, completedCount: 1, correctCount: 0, wrongCount: 0,
          challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
          saveId: 1, configurationVersion: 1 });
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
      getNextTask: async () => ({ schemaVersion: 1, status: "no_task" }),
      submitAnswer() {},
      endSession: async request => ({ schemaVersion: 1, status: "ended", sessionId: request.sessionId,
        final: { correctCount: 0, questionCount: 1, passed: false, gameUnlocked: true,
          reward: { grantId: "g", sunCount: 0 } } }),
    };
    const controller = createQuizController({ provider, view: {
      ask() {}, dismiss() {}, showLoading(progress, options) { loading.push({ progress, options }); },
    }, id: () => "stable", log: { error() { throw new Error("visibility abort logged as provider failure"); } } });
    const running = controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (createCalls === 0) await Promise.resolve();
    controller.setVisible(false);
    controller.setVisible(true);
    expect(await running).toMatchObject({ correctCount: 0, questionCount: 1, completed: true, cancelled: false });
    expect(requests[1]).toEqual(requests[0]);
    expect(loading.some(({ options }) => options.onRetry)).toBe(false);
  });

  test("hidden after get-next resolves waits and asks the same issued task when visible", async () => {
    const ready = deferred();
    const asks = [];
    const requests = { next: [], submit: [], end: [] };
    let visible = true;
    const provider = {
      async createSession() { return { schemaVersion: 1, status: "active", sessionId: "session-1",
        learnerRef: "learner", plan: { planId: "p", title: "P", subjectId: "math", skillIds: ["addition"] },
        questionCount: 1, completedCount: 0, correctCount: 0, wrongCount: 0, saveId: 7,
        configurationVersion: 1 }; },
      async getNextTask(request) {
        requests.next.push(structuredClone(request));
        visible = false;
        return { schemaVersion: 1, status: "task", task: task(7) };
      },
      async submitAnswer(request) { requests.submit.push(structuredClone(request)); return {
        schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: request.taskId,
        questionId: request.questionId, questionVersion: request.questionVersion, attemptId: request.attemptId,
        evidenceId: "e", correctness: "correct", progress: { correctCount: 1, wrongCount: 0,
          completedCount: 1, rewardSunCount: 5, rewardSunValue: 250 } }; },
      async endSession(request) { requests.end.push(structuredClone(request)); return { schemaVersion: 1,
        status: "ended", sessionId: request.sessionId, final: { correctCount: 1, wrongCount: 0,
          questionCount: 1, passed: true, reward: { grantId: "g", sunCount: 5 } } }; },
    };
    const view = { showLoading() {}, dismiss(reason) { if (reason === "ready") ready.resolve(); },
      async ask(issuedTask) { asks.push(issuedTask.taskId); return { type: "answered", optionId: "a", elapsedMs: 1 }; },
      async showResult() { return { action: "next" }; } };
    const controller = createQuizController({ provider, view, isVisible: () => visible,
      id: () => "stable", log: { error() {} } });
    const running = controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    await ready.promise;
    expect(asks).toHaveLength(0);
    expect(requests.submit).toHaveLength(0);
    expect(requests.end).toHaveLength(0);

    visible = true;
    controller.setVisible(true);
    expect(await running).toMatchObject({ completed: true, correctCount: 1 });
    expect(asks).toEqual(["task-7"]);
    expect(requests.next).toHaveLength(1);
    expect(requests.submit).toHaveLength(1);
    expect(requests.end).toHaveLength(1);
  });
});

describe("game unlocks only after a round reaches 90%", () => {
  const right = (n) => Array.from({ length: n }, () => ({ type: "answered", optionId: "a", elapsedMs: 10 }));

  test("a locked round shows the retry card, then a new round starts and only that round counts", async () => {
    const { controller, requests, retries } = harness({ tasks: [task(1), task(2), task(3)],
      answers: right(3), unlocks: [false, true] });

    const result = await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });

    expect(requests.create).toHaveLength(2);
    expect(requests.end).toHaveLength(2);
    expect(retries).toHaveLength(1);
    expect(retries[0].summary).toEqual({ correctCount: 3, questionCount: 3, requiredCount: 3 });
    expect(result).toMatchObject({ completed: true, gameUnlocked: true,
      reward: { grantId: "grant-2", sunCount: 15 } });
  });

  test("retries repeat with no limit until a round unlocks", async () => {
    const { controller, requests, retries } = harness({ answers: right(3), unlocks: [false, false, false, true] });

    const result = await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });

    expect(retries).toHaveLength(3);
    expect(requests.create).toHaveLength(4);
    expect(result).toMatchObject({ completed: true, gameUnlocked: true });
  });

  test("leaving from the retry card ends without the game and asks for the main menu", async () => {
    const { controller, requests } = harness({ answers: right(3), unlocks: [false], retryActions: ["cancel"] });

    const result = await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });

    expect(requests.create).toHaveLength(1);
    expect(result).toMatchObject({ completed: false, cancelled: true, reason: "user" });
  });

  test("required correct answers round up from 90%", async () => {
    const { requiredCorrect, meetsGameUnlock } = await import("../docs/learning/quiz-config.js");
    expect([3, 5, 10, 12, 15].map(requiredCorrect)).toEqual([3, 5, 9, 11, 14]);
    expect(meetsGameUnlock(9, 10)).toBe(true);
    expect(meetsGameUnlock(8, 10)).toBe(false);
    expect(meetsGameUnlock(14, 15)).toBe(true);
    expect(meetsGameUnlock(13, 15)).toBe(false);
    expect(meetsGameUnlock(0, 0)).toBe(false);
  });
});
