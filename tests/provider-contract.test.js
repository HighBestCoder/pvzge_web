import { describe, expect, test } from "bun:test";

import {
  LearningProviderError,
  parseSession,
  parseSubmissionResult,
  parseTask,
  parseTaskResponse,
} from "../docs/learning/provider.js";

const content = { format: "plain_text", text: "四十二" };
const taskResponse = {
  schemaVersion: 1,
  status: "task",
  task: {
    taskId: "task-1",
    questionId: "addition-within-100",
    questionVersion: 1,
    kind: "single_choice",
    content: { format: "plain_text", prompt: "20 + 22 = ?" },
    options: ["a", "b", "c", "d"].map((optionId) => ({ optionId, content })),
    metadata: { subjectId: "math", skillIds: ["addition"] },
    timeLimitMs: 20_000,
  },
};

describe("provider DTO parsing", () => {
  test("whitelists and clones a valid session response", () => {
    const input = {
      schemaVersion: 1,
      status: "active",
      sessionId: "session-1",
      learnerRef: "demo-learner",
      plan: { planId: "plan-1", title: "百以内加法", subjectId: "math", skillIds: ["addition"] },
      ignored: "remote-only",
    };
    const parsed = parseSession(input);
    input.plan.skillIds[0] = "changed";
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: "active",
      sessionId: "session-1",
      learnerRef: "demo-learner",
      plan: { planId: "plan-1", title: "百以内加法", subjectId: "math", skillIds: ["addition"] },
    });
  });

  test("accepts text options while enforcing the v1 renderer's four-option capability", () => {
    expect(parseTaskResponse(taskResponse)).toEqual(taskResponse);
    expect(() => parseTaskResponse({ ...taskResponse, task: { ...taskResponse.task, options: taskResponse.task.options.slice(0, 3) } }))
      .toThrow(LearningProviderError);
  });

  test("exports a generic task parser and preserves positive content versions", () => {
    const nonMathTask = {
      ...taskResponse.task,
      questionId: "history-capital-france",
      questionVersion: 7,
      content: { format: "plain_text", prompt: "法国的首都是哪里？" },
      options: ["paris", "rome", "london", "berlin"].map((optionId) => ({
        optionId,
        content: { format: "plain_text", text: optionId },
      })),
      metadata: { subjectId: "history", skillIds: ["world-capitals"] },
    };
    expect(parseTask(nonMathTask)).toEqual(nonMathTask);
    const identities = {
      sessionId: "s", taskId: nonMathTask.taskId, questionId: nonMathTask.questionId,
      questionVersion: 7, attemptId: "a", evidenceId: "e",
    };
    expect(parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities, correctness: "correct" }))
      .toMatchObject({ questionId: "history-capital-france", questionVersion: 7 });
  });

  test("accepts no-task states and both submission result variants", () => {
    expect(parseTaskResponse({ schemaVersion: 1, status: "no_task" })).toEqual({ schemaVersion: 1, status: "no_task" });
    const identities = {
      sessionId: "s", taskId: "t", questionId: "q", questionVersion: 1, attemptId: "a", evidenceId: "e",
    };
    expect(parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities, correctness: "correct" }).correctness).toBe("correct");
    expect(parseSubmissionResult({ schemaVersion: 1, status: "recorded", ...identities, outcome: "cancelled" }).outcome).toBe("cancelled");
  });

  test("rejects unsupported protocol features at the boundary", () => {
    for (const invalid of [
      { ...taskResponse, schemaVersion: 2 },
      { ...taskResponse, task: { ...taskResponse.task, questionVersion: 0 } },
      { ...taskResponse, task: { ...taskResponse.task, questionVersion: Number.MAX_SAFE_INTEGER + 1 } },
      { ...taskResponse, task: { ...taskResponse.task, kind: "free_text" } },
      { ...taskResponse, task: { ...taskResponse.task, content: { format: "html", prompt: "x" } } },
    ]) {
      expect(() => parseTaskResponse(invalid)).toThrow(LearningProviderError);
    }
  });
});
