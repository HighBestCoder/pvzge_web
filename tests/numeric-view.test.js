import { describe, expect, test } from "bun:test";

import {
  applyNumericKey,
  normalizeNumericValues,
  validateNumericValues,
} from "../docs/learning/quiz-input.js";
import { createQuizController } from "../docs/learning/quiz-controller.js";

const SPECS = {
  integer: { format: "integer", min: 0, max: 100 },
  decimal: { format: "decimal", min: "0", max: "100" },
  digits: { format: "digits", label: "循环节" },
  fraction: { format: "fraction", numeratorLabel: "分子", denominatorLabel: "分母", denominatorMin: 1 },
  pair: { format: "pair", labels: ["第一个数", "第二个数"], ordering: "any" },
};

function numericTask() {
  return {
    taskId: "task-1", questionId: "question-1", questionVersion: 1,
    kind: "numeric_entry", content: { format: "plain_text", prompt: "20+□=100" },
    inputSpec: SPECS.integer,
    metadata: { subjectId: "math", skillIds: ["number.CO"], tableId: "CO", stageKey: "CO1", direction: "forward" },
    timeLimitMs: 120_000,
  };
}

describe("numeric draft contract", () => {
  test("normalizes full-width digits and surrounding whitespace without losing zeroes", () => {
    expect(normalizeNumericValues([" ０ ", "　０９　"])).toEqual(["0", "09"]);
  });

  test("validates all five formats without grading correctness", () => {
    expect(validateNumericValues(SPECS.integer, ["0"])).toEqual({ valid: true, values: ["0"] });
    expect(validateNumericValues(SPECS.decimal, ["18.50"])).toEqual({ valid: true, values: ["18.50"] });
    expect(validateNumericValues(SPECS.digits, ["09"])).toEqual({ valid: true, values: ["09"] });
    expect(validateNumericValues(SPECS.fraction, ["-1", "3"])).toEqual({ valid: true, values: ["-1", "3"] });
    expect(validateNumericValues(SPECS.pair, ["29", "3"])).toEqual({ valid: true, values: ["29", "3"] });
  });

  test("rejects blank, malformed, wrong-arity, and zero-denominator drafts", () => {
    for (const [spec, values] of [
      [SPECS.integer, [""]], [SPECS.decimal, ["1."]], [SPECS.digits, ["0.9"]],
      [SPECS.fraction, ["1", "0"]], [SPECS.pair, ["2"]],
    ]) {
      expect(validateNumericValues(spec, values).valid).toBe(false);
    }
  });

  test("keypad preserves 09, limits fields, and exposes decimal only for decimal input", () => {
    expect(applyNumericKey("0", "9", SPECS.digits)).toBe("09");
    expect(applyNumericKey("18", ".", SPECS.decimal)).toBe("18.");
    expect(applyNumericKey("18.", ".", SPECS.decimal)).toBe("18.");
    expect(applyNumericKey("18", ".", SPECS.integer)).toBe("18");
    expect(applyNumericKey("09", "backspace", SPECS.digits)).toBe("0");
    expect(applyNumericKey("1234567890123456", "7", SPECS.integer)).toBe("1234567890123456");
  });

  test("minus toggles only for a signed fraction numerator", () => {
    expect(applyNumericKey("1", "minus", SPECS.fraction, 0)).toBe("-1");
    expect(applyNumericKey("-1", "minus", SPECS.fraction, 0)).toBe("1");
    expect(applyNumericKey("", "minus", SPECS.fraction, 0)).toBe("-");
    expect(applyNumericKey("3", "minus", SPECS.fraction, 1)).toBe("3");
    for (const spec of [SPECS.integer, SPECS.decimal, SPECS.digits, SPECS.pair]) {
      expect(applyNumericKey("1", "minus", spec, 0)).toBe("1");
    }
  });
});

describe("unscored stage card", () => {
  test("blocks first task issuance until explicit start and does not repeat on resume", async () => {
    const events = [];
    let startCard;
    const session = {
      schemaVersion: 1, status: "active", sessionId: "session-1", learnerRef: "learner",
      plan: { planId: "plan", title: "Plan", subjectId: "math", skillIds: ["number.CO"] },
      questionCount: 1, completedCount: 0, correctCount: 0, wrongCount: 0, saveId: 1, configurationVersion: 1,
      challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
      stageCard: { stageKey: "CO1", title: "CO1 示例", examplePrompt: "20+□=100",
        exampleAnswer: "80", explanation: "从100里去掉20，空格里应填80。", scored: false },
    };
    const provider = {
      async createSession() { return session; },
      async getNextTask() { events.push("next-task"); return { schemaVersion: 1, status: "task", task: numericTask() }; },
      async submitAnswer(request) {
        return { schemaVersion: 1, status: "graded", sessionId: request.sessionId, taskId: request.taskId,
          questionId: request.questionId, questionVersion: request.questionVersion, attemptId: request.attemptId,
          evidenceId: "evidence", correctness: "correct", progress: { correctCount: 1, wrongCount: 0,
            completedCount: 1, rewardSunCount: 5, rewardSunValue: 250 },
          feedback: { correctAnswer: "80", explanation: "从100里去掉20。" } };
      },
      async endSession(request) { return { schemaVersion: 1, status: "ended", sessionId: request.sessionId,
        final: { correctCount: 1, wrongCount: 0, questionCount: 1, passed: true,
          reward: { grantId: "grant", sunCount: 5 } } }; },
    };
    const view = {
      showLoading() {}, dismiss() {},
      showStageCard(card) { events.push(`card:${card.stageKey}`); return new Promise(resolve => { startCard = resolve; }); },
      async ask() { return { type: "entered", values: ["80"], elapsedMs: 1 }; },
      async showResult() { return { action: "next" }; },
    };
    const controller = createQuizController({ provider, view, id: () => "stable", log: { error() {} } });
    const running = controller.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    while (events.length === 0) await Promise.resolve();
    expect(events).toEqual(["card:CO1"]);
    startCard({ action: "start" });
    expect((await running).completed).toBe(true);
    expect(events).toEqual(["card:CO1", "next-task"]);

    session.completedCount = 1;
    const resumed = createQuizController({ provider, view, id: () => "resume", log: { error() {} } });
    await resumed.run({ gameId: "pvzge", levelIds: ["1"], locale: "zh-CN" });
    expect(events.filter(event => event.startsWith("card:"))).toHaveLength(1);
  });
});
