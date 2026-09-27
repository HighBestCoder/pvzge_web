import { describe, expect, test } from "bun:test";

import { createQuizController } from "../docs/learning/quiz-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const task = {
  taskId: "task-history", questionId: "capital-france", questionVersion: 7, kind: "single_choice",
  content: { format: "plain_text", prompt: "法国的首都是哪里？" },
  options: ["paris", "rome", "london", "berlin"].map((optionId) => ({
    optionId, content: { format: "plain_text", text: optionId.toUpperCase() },
  })),
  metadata: { subjectId: "history", skillIds: ["world-capitals"] }, timeLimitMs: 20_000,
};

function createHarness({ create, nextTask, submit, end } = {}) {
  let identity = "level-1";
  let eligible = true;
  let current = true;
  let open = false;
  let paused = false;
  let response = Promise.resolve({ type: "answered", optionId: "paris", elapsedMs: 25 });
  const events = [];
  const submissions = [];
  const ends = [];
  const errors = [];
  const provider = {
    async createSession(request) {
      events.push("create");
      if (create) return create(request);
      expect(request.gameContext).toEqual({ gameId: "pvzge", levelIds: ["1-1"], locale: "zh-CN" });
      return { schemaVersion: 1, status: "active", sessionId: `session-${identity}`, learnerRef: "learner-z",
        plan: { planId: "history", title: "历史", subjectId: "history", skillIds: ["world-capitals"] } };
    },
    async getNextTask() {
      events.push(paused ? "fetch-paused" : "fetch-active");
      return nextTask ? nextTask() : { schemaVersion: 1, status: "task", task };
    },
    async submitAnswer(request) {
      events.push(paused ? "submit-paused" : "submit-active");
      submissions.push(request);
      if (submit) return submit(request);
      return { schemaVersion: 1, status: request.response.type === "answered" ? "graded" : "recorded",
        sessionId: request.sessionId, taskId: request.taskId, questionId: request.questionId,
        questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: "evidence",
        ...(request.response.type === "answered" ? { correctness: "correct" } : { outcome: request.response.type }) };
    },
    async endSession(request) {
      ends.push(request);
      if (end) return end(request);
      return { schemaVersion: 1, status: "ended", sessionId: request.sessionId };
    },
  };
  const snapshot = { identity, scene: {}, positions: Array.from({ length: 5 }, () => ({})) };
  const bridge = {
    getLevelIdentity: () => identity,
    getGameContext: () => ({ gameId: "pvzge", levelIds: ["1-1"], locale: "zh-CN" }),
    hasEnded: () => !identity,
    isEligible: () => eligible,
    preflight: () => eligible ? { ...snapshot, identity } : null,
    isCurrent: (value) => current && value.identity === identity,
    isQuizActive: (value) => paused && current && value.identity === identity,
    async pauseForQuiz() { events.push("pause"); paused = true; return true; },
    releasePause() { events.push("release"); paused = false; },
    award(_snapshot, attemptId) { events.push(`award:${attemptId}`); },
  };
  const view = {
    ask(received) { events.push("ask"); open = true; expect(received).toEqual(task); return response.finally(() => { open = false; }); },
    dismiss(reason = "superseded") { events.push(`dismiss:${reason}`); open = false; },
    isOpen: () => open,
  };
  const controller = createQuizController({ provider, bridge, view, isVisible: () => true,
    firstDelayMs: 20_000, repeatDelayMs: 60_000, maxDeltaMs: 1_000,
    id: (() => { let value = 0; return () => `runtime-${++value}`; })(),
    log: { error(...args) { errors.push(args); } } });
  return { bridge, controller, ends, errors, events, provider, submissions,
    setCurrent(value) { current = value; }, setEligible(value) { eligible = value; },
    setIdentity(value) { identity = value; }, setResponse(value) { response = value; } };
}

async function accrue(controller, start, seconds) {
  await controller.tick(start);
  for (let index = 1; index <= seconds; index += 1) await controller.tick(start + index * 1_000);
}

describe("async quiz runtime", () => {
  test("fetches a non-math task before pausing and rewards once after resumed grading", async () => {
    const grade = deferred();
    const harness = createHarness({ submit: () => grade.promise });
    const ticking = accrue(harness.controller, 0, 20);
    while (!harness.events.includes("submit-active")) await Promise.resolve();
    expect(harness.events.slice(0, 6)).toEqual(["create", "fetch-active", "pause", "ask", "release", "submit-active"]);
    expect(harness.events.some((entry) => entry.startsWith("award"))).toBe(false);
    grade.resolve({ schemaVersion: 1, status: "graded", sessionId: "session-level-1", taskId: task.taskId,
      questionId: task.questionId, questionVersion: 7, attemptId: harness.submissions[0].attemptId,
      evidenceId: "e", correctness: "correct" });
    await ticking;
    expect(harness.events.filter((entry) => entry.startsWith("award"))).toHaveLength(1);
    expect(harness.submissions[0].response).toEqual({ type: "answered", optionId: "paris", elapsedMs: 25 });
  });

  test("records timeout at zero and never converts provider failures into incorrect answers", async () => {
    const harness = createHarness({ submit: async () => { throw new Error("offline"); } });
    harness.setResponse(Promise.resolve({ type: "timed_out", elapsedMs: 0 }));
    await accrue(harness.controller, 0, 20);
    expect(harness.submissions[0].response).toEqual({ type: "timed_out", elapsedMs: 0 });
    expect(harness.events.some((entry) => entry.startsWith("award"))).toBe(false);
  });

  test("bounds a provider that ignores abort without pausing gameplay", async () => {
    const harness = createHarness();
    harness.provider.createSession = () => new Promise(() => {});
    const controller = createQuizController({ provider: harness.provider, bridge: harness.bridge,
      view: { ask() { throw new Error("unreachable"); }, dismiss() {}, isOpen: () => false },
      isVisible: () => true, firstDelayMs: 1, repeatDelayMs: 60_000, maxDeltaMs: 1,
      timeoutMs: 5, id: () => "bounded", log: { error() {} } });
    await controller.tick(0);
    await controller.tick(1);
    expect(harness.events).not.toContain("pause");
  });

  test("retries session creation after a provider rejection", async () => {
    let creates = 0;
    const gameSessionIds = [];
    const harness = createHarness({ create: async (request) => {
      creates += 1;
      gameSessionIds.push(request.gameSessionId);
      if (creates === 1) throw new Error("temporary create failure");
      return { schemaVersion: 1, status: "active", sessionId: "recovered", learnerRef: "learner-z",
        plan: { planId: "history", title: "历史", subjectId: "history", skillIds: ["world-capitals"] } };
    } });

    await accrue(harness.controller, 0, 20);
    await accrue(harness.controller, 21_000, 60);

    expect(creates).toBe(2);
    expect(new Set(gameSessionIds).size).toBe(1);
    expect(harness.events).toContain("ask");
  });

  test("recovers when session setup throws before provider invocation", async () => {
    const harness = createHarness();
    harness.bridge.getGameContext = () => { throw new Error("context unavailable"); };
    await accrue(harness.controller, 0, 20);
    harness.bridge.getGameContext = () => ({ gameId: "pvzge", levelIds: ["1-1"], locale: "zh-CN" });

    await accrue(harness.controller, 21_000, 60);

    expect(harness.events).toContain("ask");
    expect(harness.errors.length).toBeGreaterThan(0);
  });

  test("does not continue a stale tick after awaited session cleanup", async () => {
    const closing = deferred();
    const harness = createHarness({ end: () => closing.promise });
    await accrue(harness.controller, 0, 20);
    harness.setIdentity("level-2");
    const changing = harness.controller.tick(21_000);
    while (harness.ends.length === 0) await Promise.resolve();
    harness.setIdentity("level-3");
    closing.resolve({ schemaVersion: 1, status: "ended", sessionId: "session-level-1" });
    await changing;

    expect(harness.events.filter((event) => event === "create")).toHaveLength(1);
    expect(harness.events.filter((event) => event === "fetch-active")).toHaveLength(1);
  });

  test("keeps the new level first delay when an old grade settles late", async () => {
    const grade = deferred();
    const harness = createHarness({ submit: () => grade.promise });
    const oldLevel = accrue(harness.controller, 0, 20);
    while (!harness.events.includes("submit-active")) await Promise.resolve();
    harness.setIdentity("level-2");
    await harness.controller.tick(21_000);
    const submission = harness.submissions[0];
    grade.resolve({ schemaVersion: 1, status: "graded", sessionId: submission.sessionId,
      taskId: submission.taskId, questionId: submission.questionId, questionVersion: submission.questionVersion,
      attemptId: submission.attemptId, evidenceId: "late-grade", correctness: "correct" });
    await oldLevel;

    await accrue(harness.controller, 22_000, 18);
    expect(harness.events.filter((event) => event === "ask")).toHaveLength(1);
    await harness.controller.tick(41_000);

    expect(harness.events.filter((event) => event === "ask")).toHaveLength(2);
  });

  test("keeps a delayed fetched task pending when the page becomes hidden", async () => {
    const fetched = deferred();
    const harness = createHarness({ nextTask: () => fetched.promise });
    const ticking = accrue(harness.controller, 0, 20);
    while (!harness.events.includes("fetch-active")) await Promise.resolve();
    harness.controller.setVisible(false);
    fetched.resolve({ schemaVersion: 1, status: "task", task });
    await ticking;

    expect(harness.events).not.toContain("pause");
    expect(harness.submissions).toHaveLength(0);
  });

  test("rejects a correlated result with the wrong task identity", async () => {
    const harness = createHarness({ submit: async (request) => ({ schemaVersion: 1, status: "graded",
      sessionId: request.sessionId, taskId: "other-task", questionId: request.questionId,
      questionVersion: request.questionVersion, attemptId: request.attemptId, evidenceId: "e", correctness: "correct" }) });
    await accrue(harness.controller, 0, 20);
    expect(harness.events.some((entry) => entry.startsWith("award"))).toBe(false);
  });

  test("scene invalidation dismisses and submits cancelled evidence exactly once", async () => {
    const answer = deferred();
    const harness = createHarness();
    harness.setResponse(answer.promise);
    const ticking = accrue(harness.controller, 0, 20);
    while (!harness.events.includes("ask")) await Promise.resolve();
    harness.setCurrent(false);
    const invalidation = harness.controller.tick(21_000);
    answer.resolve({ type: "cancelled", reason: "scene_changed", elapsedMs: 12 });
    await Promise.all([ticking, invalidation]);
    expect(harness.events).toContain("dismiss:scene_changed");
    expect(harness.submissions).toHaveLength(1);
    expect(harness.submissions[0].response.type).toBe("cancelled");
    expect(harness.events.some((entry) => entry.startsWith("award"))).toBe(false);
  });

  test("defers a fetched task without pausing when planting is transiently ineligible", async () => {
    const harness = createHarness();
    const original = harness.provider.getNextTask;
    harness.provider.getNextTask = async (...args) => { const value = await original(...args); harness.setEligible(false); return value; };
    await accrue(harness.controller, 0, 20);
    expect(harness.events).toEqual(["create", "fetch-active"]);
    harness.setEligible(true);
    await harness.controller.tick(21_000);
    expect(harness.events.filter((entry) => entry === "fetch-active")).toHaveLength(1);
    expect(harness.events).toContain("ask");
  });

  test("no_task waits for the regular cooldown and session closes once on level end", async () => {
    let fetches = 0;
    const harness = createHarness({ nextTask: () => { fetches += 1; return { schemaVersion: 1, status: "no_task" }; } });
    await accrue(harness.controller, 0, 20);
    await accrue(harness.controller, 21_000, 59);
    expect(fetches).toBe(1);
    await harness.controller.tick(81_000);
    expect(fetches).toBe(2);
    harness.setIdentity(null);
    await harness.controller.tick(82_000);
    await harness.controller.stop();
    expect(harness.ends).toHaveLength(1);
  });

  test("reports a failed session close without rejecting the scheduler", async () => {
    const harness = createHarness({ end: async () => { throw new Error("close failed"); } });
    await accrue(harness.controller, 0, 20);
    harness.setIdentity(null);

    await harness.controller.tick(21_000);

    expect(harness.ends).toHaveLength(1);
    expect(harness.errors.some(([, error]) => error?.message === "close failed")).toBe(true);
  });
});
