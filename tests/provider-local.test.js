import { describe, expect, test } from "bun:test";

import { createLocalLearningProvider } from "../docs/learning/local-provider.js";
import { LearningProviderError } from "../docs/learning/provider.js";

const createRequest = {
  schemaVersion: 1,
  requestId: "create-1",
  gameSessionId: "game-1",
  gameContext: { gameId: "pvzge", levelIds: ["1-1"], locale: "zh-CN" },
};

function makeProvider() {
  let nextId = 0;
  return createLocalLearningProvider({ random: () => 0, id: () => `id-${++nextId}` });
}

async function start(provider) {
  const session = await provider.createSession(createRequest);
  const response = await provider.getNextTask({ schemaVersion: 1, requestId: "next-1", sessionId: session.sessionId });
  return { session, response, task: response.task };
}

describe("local learning provider", () => {
  test("exposes four async methods and never publishes the answer", async () => {
    const provider = makeProvider();
    expect(Object.keys(provider).sort()).toEqual(["createSession", "endSession", "getNextTask", "submitAnswer"]);
    const { session, response, task } = await start(provider);
    expect(session.learnerRef).toBe("demo-learner");
    expect(response.status).toBe("task");
    expect(task.options).toHaveLength(4);
    expect(JSON.stringify(task)).not.toContain("answer");
    expect(JSON.stringify(task)).not.toContain("correctOptionId");
    expect(task.options.every(({ optionId }) => !/20/.test(optionId))).toBe(true);
  });

  test("replays exact requests and pending tasks without sharing mutable state", async () => {
    const provider = makeProvider();
    const firstSession = await provider.createSession(createRequest);
    firstSession.plan.skillIds[0] = "tampered";
    const replay = await provider.createSession({ ...createRequest });
    expect(replay.plan.skillIds).toEqual(["addition-within-100"]);

    const request = { schemaVersion: 1, requestId: "next-1", sessionId: replay.sessionId };
    const first = await provider.getNextTask(request);
    first.task.options[0].content.text = "tampered";
    const retried = await provider.getNextTask({ ...request });
    const anotherRequest = await provider.getNextTask({ ...request, requestId: "next-2" });
    expect(retried.task.options[0].content.text).not.toBe("tampered");
    expect(anotherRequest).toEqual(retried);
  });

  test("assigns each generated immutable question an ID distinct from task and other questions", async () => {
    const provider = makeProvider();
    const { session, task: first } = await start(provider);
    await provider.submitAnswer({
      schemaVersion: 1, sessionId: session.sessionId, taskId: first.taskId,
      questionId: first.questionId, questionVersion: first.questionVersion, attemptId: "finish-first",
      response: { type: "skipped", elapsedMs: 1 },
    });
    const second = (await provider.getNextTask({
      schemaVersion: 1, requestId: "next-2", sessionId: session.sessionId,
    })).task;
    expect(first.questionId).not.toBe(first.taskId);
    expect(second.questionId).not.toBe(second.taskId);
    expect(second.questionId).not.toBe(first.questionId);
  });

  test("grades valid answers and makes attempt and terminal submission idempotent", async () => {
    const provider = makeProvider();
    const { session, task } = await start(provider);
    const correct = task.options.find(({ content: option }) => option.text === "20");
    const submission = {
      schemaVersion: 1, sessionId: session.sessionId, taskId: task.taskId,
      questionId: task.questionId, questionVersion: task.questionVersion, attemptId: "attempt-1",
      response: { type: "answered", optionId: correct.optionId, elapsedMs: 1200 },
    };
    const result = await provider.submitAnswer(submission);
    expect(result.correctness).toBe("correct");
    expect(await provider.submitAnswer(structuredClone(submission))).toEqual(result);
    await expect(provider.submitAnswer({ ...submission, response: { ...submission.response, elapsedMs: 1201 } })).rejects.toMatchObject({ code: "ATTEMPT_CONFLICT" });
    await expect(provider.submitAnswer({ ...submission, attemptId: "attempt-2" })).rejects.toMatchObject({ code: "TASK_ALREADY_TERMINAL" });
  });

  test("records non-answer outcomes and rejects invalid references instead of grading", async () => {
    const provider = makeProvider();
    const { session, task } = await start(provider);
    const base = {
      schemaVersion: 1, sessionId: session.sessionId, taskId: task.taskId,
      questionId: task.questionId, questionVersion: task.questionVersion, attemptId: "attempt-1",
    };
    const result = await provider.submitAnswer({ ...base, response: { type: "timed_out", elapsedMs: 20_000 } });
    expect(result).toMatchObject({ status: "recorded", outcome: "timed_out" });

    const other = makeProvider();
    const active = await start(other);
    const answered = { ...base, sessionId: active.session.sessionId, taskId: active.task.taskId,
      questionId: active.task.questionId, response: { type: "answered", optionId: "missing", elapsedMs: 1 } };
    await expect(other.submitAnswer(answered)).rejects.toMatchObject({ code: "INVALID_OPTION" });
    await expect(other.submitAnswer({ ...answered, questionVersion: 7 })).rejects.toMatchObject({ code: "QUESTION_VERSION_MISMATCH" });
    await expect(other.getNextTask({ schemaVersion: 1, requestId: "bad", sessionId: "missing" })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  test("ends idempotently, permits issued-task submission, and issues no later task", async () => {
    const provider = makeProvider();
    const { session, task } = await start(provider);
    const endRequest = { schemaVersion: 1, requestId: "end-1", sessionId: session.sessionId, reason: "game_ended" };
    expect(await provider.endSession(endRequest)).toEqual({ schemaVersion: 1, status: "ended", sessionId: session.sessionId });
    expect(await provider.endSession({ ...endRequest })).toEqual({ schemaVersion: 1, status: "ended", sessionId: session.sessionId });
    expect(await provider.getNextTask({ schemaVersion: 1, requestId: "next-after", sessionId: session.sessionId }))
      .toEqual({ schemaVersion: 1, status: "session_ended" });
    const result = await provider.submitAnswer({
      schemaVersion: 1, sessionId: session.sessionId, taskId: task.taskId, questionId: task.questionId,
      questionVersion: 1, attemptId: "late", response: { type: "skipped", elapsedMs: 12 },
    });
    expect(result.outcome).toBe("skipped");
  });

  test("rejects conflicting request IDs and honors pre-aborted signals", async () => {
    const provider = makeProvider();
    await provider.createSession(createRequest);
    await expect(provider.createSession({ ...createRequest, gameSessionId: "other" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.createSession({ ...createRequest, requestId: "aborted" }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  test("validates public requests and configured dependencies", async () => {
    expect(() => createLocalLearningProvider({ random: 3 })).toThrow(TypeError);
    const provider = makeProvider();
    await expect(provider.createSession({ ...createRequest, learnerId: "not-allowed", schemaVersion: 2 }))
      .rejects.toBeInstanceOf(LearningProviderError);
  });
});
