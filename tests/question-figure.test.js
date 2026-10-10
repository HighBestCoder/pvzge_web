import { describe, expect, test } from "bun:test";

import { LearningProviderError, parseTask } from "../docs/learning/provider.js";

function task(figure) {
  return {
    taskId: "t", questionId: "q", questionVersion: 1, kind: "single_choice",
    content: { format: "plain_text", prompt: "第9列，上面和下面分别是什么？", ...(figure ? { figure } : {}) },
    options: ["a", "b", "c", "d"].map((optionId) => ({ optionId, content: { format: "plain_text", text: optionId } })),
    metadata: { subjectId: "math", skillIds: ["aligned-cycles"] }, timeLimitMs: 120_000,
  };
}

const VALID = {
  sequence: { type: "sequence", items: ["红", "白", "白"], repeat: 3, caption: "3颗一组" },
  rows: { type: "rows", columns: 8,
    rows: [{ label: "上行", pattern: ["春", "夏", "秋", "冬"] }, { label: "下行", pattern: ["天", "地"] }] },
  order: { type: "order", lanes: ["A", "B", "C", "D"], sequence: ["A", "B", "C", "D", "D", "C", "B", "A"] },
  grid: { type: "grid", header: ["第1列", "第2列"], rowLabels: ["第1行", "第2行"], cells: [["2", ""], ["", "4"]] },
};

describe("question figures", () => {
  test("every supported figure type passes through unchanged", () => {
    for (const figure of Object.values(VALID)) {
      expect(parseTask(task(figure)).content.figure).toEqual(figure);
    }
  });

  test("sequence repeat defaults to two groups", () => {
    const { repeat, ...withoutRepeat } = VALID.sequence;
    expect(repeat).toBe(3);
    expect(parseTask(task(withoutRepeat)).content.figure.repeat).toBe(2);
  });

  test("tasks without a figure keep the original content shape", () => {
    expect(Object.keys(parseTask(task()).content)).toEqual(["format", "prompt"]);
  });

  test("malformed figures are rejected instead of half-drawn", () => {
    const invalid = [
      { type: "picture", url: "http://example.com/x.png" },
      { ...VALID.order, sequence: ["A", "E"] },
      { ...VALID.order, lanes: ["A", "A"] },
      { ...VALID.grid, cells: [["1", "2"], ["3"]] },
      { ...VALID.grid, header: ["只有一列"] },
      { ...VALID.rows, columns: 99 },
      { ...VALID.sequence, items: ["这个标签实在是太长了"] },
      { ...VALID.sequence, extra: true },
    ];
    for (const figure of invalid) {
      expect(() => parseTask(task(figure))).toThrow(LearningProviderError);
    }
  });
});
