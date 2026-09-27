import { describe, expect, test } from "bun:test";

import { createTimedAttempt } from "../docs/learning/timed-attempt.js";

function createHarness(start = 1_000) {
  let now = start;
  let dueCallback;
  let updateCallback;
  const cleared = [];
  const results = [];
  const attempt = createTimedAttempt({
    durationMs: 20_000,
    now: () => now,
    onSettle: (value) => results.push(value),
    onUpdate() {},
    setDue: (callback) => {
      dueCallback = callback;
      return "due";
    },
    setUpdate: (callback) => {
      updateCallback = callback;
      return "update";
    },
    clearDue: (id) => cleared.push(id),
    clearUpdate: (id) => cleared.push(id),
  });
  return {
    attempt,
    cleared,
    results,
    setNow(value) { now = value; },
    fireDue() { dueCallback(); },
    fireUpdate() { updateCallback(); },
  };
}

describe("createTimedAttempt", () => {
  test("treats an answer at the absolute deadline as a timeout", () => {
    const harness = createHarness();
    harness.setNow(21_000);

    expect(harness.attempt.answer(true)).toBe(true);
    expect(harness.results).toEqual([null]);
    expect(harness.cleared).toEqual(["due", "update"]);
  });

  test("settles exactly once when delayed and stale callbacks run", () => {
    const harness = createHarness();
    harness.setNow(20_999);

    expect(harness.attempt.answer(false)).toBe(true);
    expect(harness.attempt.answer(true)).toBe(false);
    harness.setNow(50_000);
    harness.fireDue();
    harness.fireUpdate();

    expect(harness.results).toEqual([false]);
    expect(harness.cleared).toEqual(["due", "update"]);
  });

  test("uses the monotonic deadline when the due callback is delayed", () => {
    const harness = createHarness();
    harness.setNow(30_000);

    harness.fireDue();

    expect(harness.results).toEqual([null]);
  });
});
