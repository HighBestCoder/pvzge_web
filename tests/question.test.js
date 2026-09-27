import { describe, expect, test } from "bun:test";

import { createAdditionQuestion } from "../docs/learning/question.js";

function sequenceRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe("createAdditionQuestion", () => {
  test("uses two-digit operands and four distinct bounded options", () => {
    const random = sequenceRandom([0, 0.99, 0.5, 0.01, 0.75, 0.25]);

    for (let index = 0; index < 500; index += 1) {
      const question = createAdditionQuestion(random);
      expect(question.left).toBeGreaterThanOrEqual(10);
      expect(question.left).toBeLessThanOrEqual(90);
      expect(question.right).toBeGreaterThanOrEqual(10);
      expect(question.answer).toBe(question.left + question.right);
      expect(question.answer).toBeLessThanOrEqual(100);
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options).toContain(question.answer);
      expect(question.options.every((option) => option >= 0 && option <= 100)).toBe(true);
    }
  });

  test("is deterministic at minimum and maximum sums", () => {
    const minimum = createAdditionQuestion(() => 0);
    const maximum = createAdditionQuestion(() => 0.999999);

    expect({ left: minimum.left, right: minimum.right, answer: minimum.answer }).toEqual({ left: 10, right: 10, answer: 20 });
    expect({ left: maximum.left, right: maximum.right, answer: maximum.answer }).toEqual({ left: 90, right: 10, answer: 100 });
    expect(new Set(minimum.options).size).toBe(4);
    expect(new Set(maximum.options).size).toBe(4);
  });
});
