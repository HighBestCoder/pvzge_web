import { describe, expect, test } from "bun:test";

import { createQuizController } from "../docs/learning/quiz-controller.js";
import { LearningProviderError, parseSubmissionResult, parseTask } from "../docs/learning/provider.js";
import { parseSubmitAnswerRequest } from "../docs/learning/provider-requests.js";
import { createRemoteLearningProvider } from "../docs/learning/remote-provider.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

const inputSpecs = [
  { format: "integer", min: 0, max: 100 },
  { format: "decimal", min: "0", max: "100.0" },
  { format: "fraction", numeratorLabel: "分子", denominatorLabel: "分母", denominatorMin: 1 },
  { format: "digits", label: "最短循环节" },
  { format: "pair", labels: ["第一个数", "第二个数"], ordering: "any" },
];

function numericTask(inputSpec = inputSpecs[0], number = 1) {
  return {
    taskId: `task-${number}`,
    questionId: `question-${number}`,
    questionVersion: 2,
    kind: "numeric_entry",
    content: { format: "plain_text", prompt: "请输入答案" },
    inputSpec,
    metadata: { subjectId: "math", skillIds: ["number.SQ"], tableId: "SQ", stageKey: "SQ1",
      direction: "reverse", labels: ["平方"] },
    timeLimitMs: 120_000,
  };
}

function entered(values, attemptId = "attempt-1") {
  return { schemaVersion: 1, sessionId: "session-1", taskId: "task-1", questionId: "question-1",
    questionVersion: 2, attemptId, response: { type: "entered", values, elapsedMs: 17 } };
}

function graded(request, correctCount = 1) {
  return { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: request.taskId,
    questionId: request.questionId, questionVersion: request.questionVersion, attemptId: request.attemptId,
    evidenceId: `e-${request.attemptId}`, correctness: "correct",
    progress: { correctCount, wrongCount: 0, completedCount: correctCount,
      rewardSunCount: correctCount * 5, rewardSunValue: correctCount * 250 },
    feedback: { correctAnswer: "09", explanation: "最短循环节是 09。" } };
}

function recorded(request, outcome, feedback) {
  const value = graded(request);
  const { correctness: _correctness, ...withoutCorrectness } = value;
  return { ...withoutCorrectness, status: "recorded", outcome, feedback };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("numeric provider contracts", () => {
  test("parses all public input specs and retains only public metadata", () => {
    for (const inputSpec of inputSpecs) expect(parseTask(numericTask(inputSpec)).inputSpec).toEqual(inputSpec);
    expect(() => parseTask({ ...numericTask(), metadata: { ...numericTask().metadata, factKey: "SQ:64" } }))
      .toThrow(LearningProviderError);
    expect(() => parseTask({ ...numericTask(), answerSpec: { type: "numeric_equality", value: "64" } }))
      .toThrow(LearningProviderError);
    expect(() => parseTask(numericTask({ format: "decimal", min: "9999999999999999", max: "9999999999999998" })))
      .toThrow(LearningProviderError);
  });

  test("preserves zero and leading zeros while rejecting malformed entered bodies", () => {
    expect(parseSubmitAnswerRequest(entered(["0"]))).toEqual(entered(["0"]));
    expect(parseSubmitAnswerRequest(entered(["09"]))).toEqual(entered(["09"]));
    for (const response of [
      { type: "entered", values: [], elapsedMs: 1 },
      { type: "entered", values: ["1", "2", "3"], elapsedMs: 1 },
      { type: "entered", values: ["1".repeat(17)], elapsedMs: 1 },
      { type: "entered", values: ["1"], optionId: "a", elapsedMs: 1 },
      { type: "mystery", values: ["1"], elapsedMs: 1 },
    ]) expect(() => parseSubmitAnswerRequest({ ...entered(["1"]), response })).toThrow(LearningProviderError);
  });

  test("validates entered arity against the issued remote task before persistence", async () => {
    const storage = new MemoryStorage();
    const provider = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async (path) => path.endsWith("get-next-task")
        ? jsonResponse({ schemaVersion: 1, status: "task", task: numericTask(inputSpecs[4]) })
        : jsonResponse(graded(entered(["1", "2"]))) });
    await provider.getNextTask({ schemaVersion: 1, requestId: "next", sessionId: "session-1" });
    await expect(provider.submitAnswer(entered(["1"]))).rejects.toThrow("arity");
    expect(storage.getItem("pvzge:learning-submissions:7")).toBe(null);
  });

  test("parses numeric feedback without correctOptionId and rejects mixed feedback", () => {
    const request = entered(["09"]);
    expect(parseSubmissionResult(graded(request), "numeric_entry").feedback).toEqual({ correctAnswer: "09",
      explanation: "最短循环节是 09。" });
    expect(() => parseSubmissionResult({ ...graded(request), feedback: { correctOptionId: "a",
      correctAnswer: "09", explanation: "private choice identity" } }, "numeric_entry")).toThrow(LearningProviderError);
    expect(() => parseSubmissionResult({ ...graded(request), answerSpec: { type: "exact_digits", value: "09" } },
      "numeric_entry")).toThrow(LearningProviderError);
  });

  test("rejects choice-only feedback for numeric terminal results and all cancelled feedback", () => {
    const request = entered(["09"]);
    for (const outcome of ["timed_out", "skipped"]) {
      expect(() => parseSubmissionResult(recorded(request, outcome,
        { correctOptionId: "choice-a", correctAnswer: "09", explanation: "wrong kind" }),
      "numeric_entry")).toThrow(LearningProviderError);
    }
    for (const kind of ["single_choice", "numeric_entry"]) {
      expect(() => parseSubmissionResult(recorded(request, "cancelled",
        { correctAnswer: "09", explanation: "must be absent" }), kind))
        .toThrow(LearningProviderError);
    }
  });

  test("rejects an unissued submission after provider creation without posting or persisting", async () => {
    const storage = new MemoryStorage();
    let posts = 0;
    const provider = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async () => { posts += 1; return jsonResponse(graded(entered(["09"]))); } });
    await expect(provider.submitAnswer(entered(["09"]))).rejects.toThrow("issued task");
    expect(posts).toBe(0);
    expect(storage.getItem("pvzge:learning-submissions:7")).toBe(null);
  });

  test("replays the exact entered payload after reload and keeps it until identity matches", async () => {
    const storage = new MemoryStorage();
    const request = entered(["09"]);
    const offline = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async (path) => path.endsWith("get-next-task")
        ? jsonResponse({ schemaVersion: 1, status: "task", task: numericTask(inputSpecs[3]) })
        : (() => { throw new TypeError("offline"); })() });
    await offline.getNextTask({ schemaVersion: 1, requestId: "issue", sessionId: "session-1" });
    await expect(offline.submitAnswer(request)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const persisted = JSON.parse(storage.getItem("pvzge:learning-submissions:7"))[0];
    expect(persisted.payload).toEqual(request);
    expect(persisted.context).toEqual({ sessionId: "session-1", taskId: "task-1", questionId: "question-1", questionVersion: 2,
      kind: "numeric_entry", inputSpec: inputSpecs[3] });

    const calls = [];
    const online = createRemoteLearningProvider({ saveId: 7, storage, fetchImpl: async (_path, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return jsonResponse(calls.length === 1 ? { ...graded(body), taskId: "stale" } : graded(body));
    } });
    await expect(online.getNextTask({ schemaVersion: 1, requestId: "next-1", sessionId: "session-1" }))
      .rejects.toThrow("identity mismatch");
    expect(JSON.parse(storage.getItem("pvzge:learning-submissions:7"))[0].payload).toEqual(request);
    await expect(online.getNextTask({ schemaVersion: 1, requestId: "next-2", sessionId: "session-1" }))
      .rejects.toThrow();
    expect(calls[1]).toEqual(request);
    expect(storage.getItem("pvzge:learning-submissions:7")).toBe("[]");
  });

  test("rejects a queued numeric attempt when persisted task context was changed", async () => {
    const storage = new MemoryStorage();
    const request = entered(["09"]);
    storage.setItem("pvzge:learning-submissions:7", JSON.stringify([{ id: request.attemptId, payload: request,
      context: { sessionId: request.sessionId, taskId: request.taskId, questionId: "changed", questionVersion: request.questionVersion,
        kind: "numeric_entry", inputSpec: inputSpecs[3] } }]));
    let posts = 0;
    const provider = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async () => { posts += 1; return jsonResponse(graded(request)); } });
    await expect(provider.createSession({ schemaVersion: 1, requestId: "create", gameSessionId: "game",
      gameContext: { gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" } })).rejects.toThrow("context");
    expect(posts).toBe(0);
    expect(JSON.parse(storage.getItem("pvzge:learning-submissions:7"))).toHaveLength(1);
  });

  test("validates entered intent against task kind and exact input arity", async () => {
    for (const [inputSpec, values] of inputSpecs.map((spec) => [spec,
      ["fraction", "pair"].includes(spec.format) ? ["0", "09"] : ["09"]])) {
      const task = numericTask(inputSpec);
      const submissions = [];
      const provider = fixtureProvider(task, submissions);
      const controller = createQuizController({ provider, view: fixtureView({ type: "entered", values, elapsedMs: 4 }),
        id: (() => { let value = 0; return () => `id-${++value}`; })(), log: { error() {} } });
      expect(await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" }))
        .toMatchObject({ questionCount: 1, correctCount: 1, completed: true });
      expect(submissions[0].response.values).toEqual(values);
    }

    for (const intent of [
      { type: "answered", optionId: "a", elapsedMs: 1 },
      { type: "entered", values: ["1", "2"], elapsedMs: 1 },
      { type: "entered", values: [""], elapsedMs: 1 },
    ]) {
      const controller = createQuizController({ provider: fixtureProvider(numericTask(), []), view: fixtureView(intent),
        id: () => "stable", log: { error() {} } });
      await expect(controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" }))
        .rejects.toThrow("invalid response intent");
    }
  });

  test("respects a server count of fifteen and rejects incompatible graded results before rewards", async () => {
    const tasks = Array.from({ length: 15 }, (_, index) => numericTask(inputSpecs[index % inputSpecs.length], index + 1));
    let next = 0;
    const submissions = [];
    const provider = fixtureProvider(tasks, submissions, () => tasks[next++]);
    const controller = createQuizController({ provider, view: fixtureView({ type: "entered", values: ["09"], elapsedMs: 1 }),
      id: (() => { let value = 0; return () => `batch-${++value}`; })(), log: { error() {} } });
    const result = await controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    expect(result).toMatchObject({ questionCount: 15, correctCount: 15, completed: true });
    expect(submissions).toHaveLength(15);

    const stale = fixtureProvider(numericTask(), [], undefined,
      request => ({ ...graded(request), feedback: { correctOptionId: "a", correctAnswer: "1", explanation: "wrong kind" } }));
    const loading = [];
    const running = createQuizController({ provider: stale, view: fixtureView({ type: "entered", values: ["1"], elapsedMs: 1 }, loading),
      id: () => "stable", log: { error() {} } }).run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (!loading.some(({ options }) => options.onCancel)) await Promise.resolve();
    loading.findLast(({ options }) => options.onCancel).options.onCancel();
    expect(await running).toMatchObject({ correctCount: 0, completed: false, cancelled: true });
  });
});

function fixtureProvider(taskOrTasks, submissions, nextTask, submitResult = graded) {
  const tasks = Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks];
  let index = 0;
  return {
    async createSession() { return { schemaVersion: 1, status: "active", sessionId: "session-1", learnerRef: "learner",
      plan: { planId: "number", title: "数字训练", subjectId: "math", skillIds: ["number.SQ"] },
      questionCount: tasks.length, completedCount: 0, correctCount: 0, wrongCount: 0, saveId: 7,
      configurationVersion: 1 }; },
    async getNextTask() { const task = nextTask ? nextTask() : tasks[index++];
      return task ? { schemaVersion: 1, status: "task", task } : { schemaVersion: 1, status: "no_task" }; },
    async submitAnswer(request) { submissions.push(structuredClone(request)); return submitResult(request, submissions.length); },
    async endSession(request) { return { schemaVersion: 1, status: "ended", sessionId: request.sessionId,
      final: { correctCount: submissions.length, wrongCount: 0, questionCount: tasks.length, passed: true,
        reward: { grantId: "grant", sunCount: submissions.length * 5 } } }; },
  };
}

function fixtureView(intent, loading = []) {
  return { async ask(task) { if (task.inputSpec && ["fraction", "pair"].includes(task.inputSpec.format) && intent.values.length === 1) {
      return { ...intent, values: [intent.values[0], intent.values[0]] }; }
    return structuredClone(intent); },
  showLoading(progress, options) { loading.push({ progress, options }); },
  async showResult() { return { action: "next" }; }, dismiss() {} };
}
