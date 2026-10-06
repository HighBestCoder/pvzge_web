import { describe, expect, test } from "bun:test";

import { createNativeStart } from "../docs/learning/native-start.js";

function fixture({ ready = true, quizOpen = false, letsRock } = {}) {
  const calls = [];
  const dialog = { open: quizOpen };
  const root = { getElementById: (id) => id === "addition-quiz" ? dialog : null };
  const nativeNode = { active: true, get activeInHierarchy() { return this.active; } };
  const level = { gameStarted: false,
    letsRock: letsRock ?? function () { calls.push("start"); this.gameStarted = true; } };
  const runtime = {
    levelClass: { chooseCardMode: true, letsRocked: false },
    level,
    cards: { GameStartable: () => ready, gameStartButton: { node: nativeNode } },
  };
  let tick;
  const start = createNativeStart({ root, readRuntime: () => runtime,
    every(callback, delay) { tick = callback; calls.push(["every", delay]); return 9; },
    clearEvery(id) { calls.push(["clear", id]); } });
  return { calls, dialog, level, nativeNode, runtime, start, tick: () => tick() };
}

describe("automatic native seed-selection start", () => {
  test("waits for native card eligibility then starts without DOM interaction", () => {
    // Given
    const h = fixture({ ready: false });
    h.start.install();
    expect(h.calls).toEqual([["every", 100]]);

    // When
    h.runtime.cards.GameStartable = () => true;
    h.tick();
    h.tick();

    // Then
    expect(h.calls.filter((value) => value === "start")).toHaveLength(1);
    expect(h.level.gameStarted).toBe(true);
    expect(h.nativeNode.active).toBe(false);
  });

  test("does not start or hide the native control while the learning dialog is open", () => {
    // Given
    const h = fixture({ quizOpen: true });

    // When
    h.start.install();
    h.tick();

    // Then
    expect(h.calls).not.toContain("start");
    expect(h.nativeNode.active).toBe(true);
  });

  test("guards before invocation and does not restart the same level after phase exit", () => {
    // Given
    const observations = [];
    const h = fixture({ letsRock() {
      observations.push({ active: h.nativeNode.active, gameStarted: this.gameStarted });
      this.gameStarted = true;
    } });

    // When
    h.start.install();
    h.runtime.levelClass.letsRocked = true;
    h.tick();
    h.runtime.levelClass.letsRocked = false;
    h.level.gameStarted = false;
    h.nativeNode.active = true;
    h.tick();

    // Then
    expect(observations).toEqual([{ active: false, gameStarted: false }]);
  });

  test("resets only for a genuinely new native level component", async () => {
    // Given
    const h = fixture();
    h.start.install();
    await Promise.resolve();
    const later = { gameStarted: false,
      letsRock() { h.calls.push("later-start"); this.gameStarted = true; } };

    // When
    h.runtime.level = later;
    h.runtime.levelClass.letsRocked = false;
    h.nativeNode.active = true;
    await h.start.render();
    await h.start.render();

    // Then
    expect(h.calls.filter((value) => value === "start")).toHaveLength(1);
    expect(h.calls.filter((value) => value === "later-start")).toHaveLength(1);
  });

  test("restores and retries after an asynchronous native start failure", async () => {
    // Given
    let attempts = 0;
    const h = fixture({ letsRock() {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("native start failed"));
      this.gameStarted = true;
      return Promise.resolve();
    } });

    // When
    h.start.install();
    await Promise.resolve();
    await Promise.resolve();

    // Then
    expect(h.nativeNode.active).toBe(true);
    await h.start.render();
    expect(attempts).toBe(2);
    expect(h.level.gameStarted).toBe(true);
  });

  test("retries when the native callback resolves without leaving the ready phase", async () => {
    // Given
    let attempts = 0;
    const h = fixture({ letsRock() {
      attempts += 1;
      if (attempts === 2) this.gameStarted = true;
    } });

    // When
    h.start.install();
    await Promise.resolve();
    await h.start.render();

    // Then
    expect(attempts).toBe(2);
    expect(h.level.gameStarted).toBe(true);
  });

  test("stops polling and restores an owned native control on pagehide cleanup", () => {
    // Given
    const h = fixture({ ready: false });
    h.start.install();
    h.runtime.cards.GameStartable = () => true;
    h.tick();

    // When
    h.start.stop();

    // Then
    expect(h.calls).toContainEqual(["clear", 9]);
    expect(h.nativeNode.active).toBe(true);
  });
});
