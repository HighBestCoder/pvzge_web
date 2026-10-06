import { describe, expect, test } from "bun:test";

import {
  LearningProviderError,
  parseSession,
  parseEndSessionResult,
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
      challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
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
      challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
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
    const progress = { correctCount: 1, wrongCount: 0, completedCount: 1,
      rewardSunCount: 5, rewardSunValue: 250 };
    expect(parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
      correctness: "correct", progress }))
      .toMatchObject({ questionId: "history-capital-france", questionVersion: 7 });
  });

  test("accepts no-task states and both submission result variants", () => {
    expect(parseTaskResponse({ schemaVersion: 1, status: "no_task" })).toEqual({ schemaVersion: 1, status: "no_task" });
    const identities = {
      sessionId: "s", taskId: "t", questionId: "q", questionVersion: 1, attemptId: "a", evidenceId: "e",
    };
    const progress = { correctCount: 0, wrongCount: 0, completedCount: 1,
      rewardSunCount: 0, rewardSunValue: 0 };
    expect(parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
      correctness: "correct", progress }).correctness).toBe("correct");
    expect(parseSubmissionResult({ schemaVersion: 1, status: "recorded", ...identities,
      outcome: "cancelled", progress }).outcome).toBe("cancelled");
  });

  test("retains complete remote progress and validates final grants", () => {
    const remote = parseSession({ schemaVersion: 1, status: "active", sessionId: "s", learnerRef: "1",
      plan: { planId: "p", title: "P", subjectId: "math", skillIds: ["addition"] },
      questionCount: 12, completedCount: 4, correctCount: 3, wrongCount: 1, saveId: 9,
      configurationVersion: 2,
      challengeRule: { enabled: true, version: 4, perWaveCap: 2, maxWaves: 3, totalCap: 6 } });
    expect(remote).toMatchObject({ questionCount: 12, completedCount: 4, correctCount: 3, wrongCount: 1,
      saveId: 9, configurationVersion: 2, challengeRule: { enabled: true, version: 4 } });
    expect(parseEndSessionResult({ schemaVersion: 1, status: "ended", sessionId: "s",
      final: { correctCount: 3, wrongCount: 1, questionCount: 12, passed: false,
        reward: { grantId: "g", sunCount: 15 },
        challenge: { enabled: true, ruleVersion: 4, extraPerWave: 1, maxWaves: 3, totalCap: 6 } } }))
      .toMatchObject({ final: { wrongCount: 1, reward: { sunCount: 15 },
        challenge: { enabled: true, ruleVersion: 4, extraPerWave: 1 } } });
    expect(() => parseSession({ ...remote, correctCount: 5 })).toThrow(LearningProviderError);
  });

  test("parses authoritative submission progress and rejects inconsistent reward arithmetic", () => {
    const identities = { sessionId: "s", taskId: "t", questionId: "q", questionVersion: 1,
      attemptId: "a", evidenceId: "e" };
    const result = parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
      correctness: "incorrect", progress: { correctCount: 2, wrongCount: 1, completedCount: 4,
        rewardSunCount: 10, rewardSunValue: 500 } });
    expect(result.progress).toEqual({ correctCount: 2, wrongCount: 1, completedCount: 4,
      rewardSunCount: 10, rewardSunValue: 500 });
    expect(() => parseSubmissionResult({ ...result,
      progress: { ...result.progress, rewardSunValue: 499 } })).toThrow(LearningProviderError);
    expect(() => parseSubmissionResult({ ...result,
      progress: { ...result.progress, completedCount: 2 } })).toThrow(LearningProviderError);
  });

  test("parses optional post-submission feedback strictly and preserves legacy absence", () => {
    const identities = { sessionId: "s", taskId: "t", questionId: "q", questionVersion: 1,
      attemptId: "a", evidenceId: "e" };
    const progress = { correctCount: 0, wrongCount: 1, completedCount: 1,
      rewardSunCount: 0, rewardSunValue: 0 };
    const legacy = parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
      correctness: "incorrect", progress });
    expect(legacy.feedback).toBeUndefined();
    expect(parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
      correctness: "incorrect", progress, feedback: {
        correctOptionId: "b", correctAnswer: "巴黎", explanation: "法国的首都是巴黎。\n可在地图上找到。",
      } }).feedback).toEqual({ correctOptionId: "b", correctAnswer: "巴黎",
      explanation: "法国的首都是巴黎。\n可在地图上找到。" });
    for (const feedback of [
      {},
      { correctOptionId: "b", correctAnswer: "", explanation: "原因" },
      { correctOptionId: "b", correctAnswer: "巴黎", explanation: "x".repeat(4_001) },
      { correctOptionId: "b", correctAnswer: "巴黎", explanation: "原因", html: "<b>原因</b>" },
    ]) {
      expect(() => parseSubmissionResult({ schemaVersion: 1, status: "graded", ...identities,
        correctness: "incorrect", progress, feedback })).toThrow(LearningProviderError);
    }
  });

  test("defaults omitted legacy challenge snapshots off and rejects invalid enabled snapshots", () => {
    const legacy = parseSession({ schemaVersion: 1, status: "active", sessionId: "s", learnerRef: "1",
      plan: { planId: "p", title: "P", subjectId: "math", skillIds: ["addition"] } });
    expect(legacy.challengeRule.enabled).toBe(false);
    const ended = parseEndSessionResult({ schemaVersion: 1, status: "ended", sessionId: "s",
      final: { correctCount: 0, questionCount: 1, passed: false,
        reward: { grantId: "g", sunCount: 0 } } });
    expect(ended.final.challenge.enabled).toBe(false);
    expect(() => parseSession({ ...legacy,
      challengeRule: { enabled: true, version: 1, perWaveCap: 2, maxWaves: 3, totalCap: 7 } }))
      .toThrow(LearningProviderError);
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
