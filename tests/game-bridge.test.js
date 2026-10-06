import { describe, expect, test } from "bun:test";

import { createGameBridge, createSystemRuntime } from "../docs/learning/game-bridge.js";

function runtimeFixture() {
  const player = {};
  const oldScene = {};
  const oldController = {};
  const runtime = { scene: oldScene, identity: oldController, levelId: [1, 2], player, gaming: false,
    valid: (value) => Boolean(value), level: { node: { activeInHierarchy: true } },
    ui: { node: { activeInHierarchy: true }, sceneEnabled: true, paused: false },
    cc: { game: { isPaused: () => false }, director: { isPaused: () => false } },
    droppings: { controller: {}, layer: {}, SunMid: {} }, sunCount: { component: {} },
    square: { Square00: {}, getSquareWorldPosition: (row, column) => ({ x: column, y: row }) },
    sunflower: { produceSun() {} } };
  return { oldController, oldScene, player, runtime };
}

async function advanceFrame(frames) {
  for (let turn = 0; turn < 8 && frames.length === 0; turn += 1) await Promise.resolve();
  frames.shift()();
}

describe("post-load reward bridge", () => {
  test("maps the case-sensitive native zombie factory export", () => {
    const factory = { spawnZombieFromLaneByType() {} };
    const modules = {
      cc: { isValid() {}, director: { getScene: () => ({}) } },
      level: { LevelPlay: {} }, ui: { UIInGame: {} }, player: { AllPlayerProperties: {} }, sunflower: { sunflower: {} },
      droppings: { droppings: {} }, square: { Square: {} }, sunCount: { SunCount: {} },
      zombies: { zombies: factory, Zombies: class {} }, frontYard: { FrontYard: {} },
    };
    const system = { resolve: (id) => id, get: (id) => modules[id === "cc" ? "cc" : Object.entries({
      level: "levelController.ts", ui: "UI.ts", player: "PlayerProperties.ts", sunflower: "Sunflower.ts",
      droppings: "Droppings.ts", square: "Square.ts", sunCount: "SunCount.ts", zombies: "Zombies.ts", frontYard: "FrontYard.ts",
    }).find(([, suffix]) => id.endsWith(suffix))?.[0]] };

    expect(createSystemRuntime(system).zombies).toBe(factory);
  });

  test("mounts and reports a zero-sun wave challenge after native controller replacement", async () => {
    const fixture = runtimeFixture();
    const mounts = [];
    const statuses = [];
    fixture.runtime.scene = {};
    fixture.runtime.levelId = ["egypt3"];
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.gaming = true;
    fixture.runtime.levelId = ["egypt3"];
    const waveChallenge = { cancelPending() {}, mount(input) { mounts.push(input); return { status: "active", levelId: "egypt3" }; } };
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime, nextFrame: async () => {}, waveChallenge });

    const status = await bridge.watchReward({ oldController: fixture.oldController, player: fixture.player,
      targetLevelIds: ["egypt3"], challenge: { enabled: true }, reward: { grantId: "g", sunCount: 0 },
      runId: "r", ownsTarget: () => true, onChallengeStatus: (value) => statuses.push(value) });

    expect(mounts).toHaveLength(1);
    expect(status).toEqual({ status: "active", levelId: "egypt3" });
    expect(statuses).toEqual([status]);
  });

  test("retries challenge mounting while the replacement controller initializes", async () => {
    const fixture = runtimeFixture();
    const statuses = [{ status: "pending", reason: "runtime-initializing" }, { status: "active", levelId: "egypt3" }];
    const waveChallenge = { cancelPending() {}, mount() { return statuses.shift(); } };
    const frames = [];
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.gaming = true;
    fixture.runtime.levelId = ["egypt3"];
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime, waveChallenge,
      nextFrame: () => new Promise((resolve) => frames.push(resolve)) });
    const pending = bridge.watchReward({ oldController: fixture.oldController, player: fixture.player,
      targetLevelIds: ["egypt3"], reward: { grantId: "g", sunCount: 0 }, runId: "r", ownsTarget: () => true });
    await advanceFrame(frames);
    expect(await pending).toEqual({ status: "active", levelId: "egypt3" });
  });

  test("mounts once across many pre-game frames and reports started once after game start", async () => {
    const fixture = runtimeFixture();
    const frames = [];
    const mounts = [];
    const reports = [];
    const controller = { node: { activeInHierarchy: true }, gameStarted: false };
    fixture.runtime.identity = fixture.runtime.level = controller;
    fixture.runtime.scene = {};
    fixture.runtime.levelId = ["egypt3"];
    const waveChallenge = { cancelPending() {}, mount(input) { mounts.push(input); return { status: "active" }; } };
    const reporter = { async report(value) { reports.push(value); } };
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime, waveChallenge, reporter,
      nextFrame: () => new Promise((resolve) => frames.push(resolve)) });
    const pending = bridge.watchReward({ oldController: fixture.oldController, player: fixture.player,
      targetLevelIds: ["egypt3"], challenge: { enabled: true }, reward: { grantId: "g", sunCount: 0 },
      runId: "r", ownsTarget: () => true });

    for (let frame = 0; frame < 40; frame += 1) {
      await advanceFrame(frames);
    }
    expect(mounts).toHaveLength(1);
    expect(reports).toHaveLength(0);
    controller.gameStarted = true;
    fixture.runtime.gaming = true;
    await advanceFrame(frames);
    expect(await pending).toEqual({ status: "active" });
    expect(reports.filter(({ outcome }) => outcome === "started")).toHaveLength(1);
    controller.gameWon = true;
    await advanceFrame(frames);
    await Promise.resolve();
    expect(reports.filter(({ outcome }) => outcome === "won")).toHaveLength(1);
  });

  test("returns when the mounted controller changes before game start", async () => {
    const fixture = runtimeFixture();
    const frames = [];
    let reports = 0;
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: false };
    fixture.runtime.levelId = ["egypt3"];
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime,
      waveChallenge: { cancelPending() {}, mount: () => ({ status: "active" }) },
      reporter: { async report() { reports += 1; } },
      nextFrame: () => new Promise((resolve) => frames.push(resolve)) });
    const pending = bridge.watchReward({ oldController: fixture.oldController, player: fixture.player,
      targetLevelIds: ["egypt3"], reward: { grantId: "g", sunCount: 0 }, runId: "r", ownsTarget: () => true });
    await Promise.resolve();
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    await advanceFrame(frames);
    expect(await pending).toBeUndefined();
    expect(reports).toBe(0);
  });

  test("terminal state before game start returns without reporting or spawning reward", async () => {
    const fixture = runtimeFixture();
    const frames = [];
    let reports = 0;
    let rewards = 0;
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: false };
    fixture.runtime.levelId = ["egypt3"];
    fixture.runtime.sunflower.produceSun = () => { rewards += 1; };
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime,
      waveChallenge: { cancelPending() {}, mount: () => ({ status: "active" }) },
      reporter: { async report() { reports += 1; } },
      nextFrame: () => new Promise((resolve) => frames.push(resolve)) });
    const pending = bridge.watchReward({ oldController: fixture.oldController, player: fixture.player,
      targetLevelIds: ["egypt3"], reward: { grantId: "g", sunCount: 5 }, runId: "r", ownsTarget: () => true });
    await Promise.resolve();
    fixture.runtime.level.gameLost = true;
    await advanceFrame(frames);
    await pending;
    expect(reports).toBe(0);
    expect(rewards).toBe(0);
  });

  test("awards fifty native 50-value suns for ten correct answers", async () => {
    const fixture = runtimeFixture();
    const produced = [];
    fixture.runtime.sunflower.produceSun = (...args) => produced.push(args);
    let frame;
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime,
      nextFrame: () => new Promise((resolve) => { frame = resolve; }) });
    const pending = bridge.watchReward({ oldScene: fixture.oldScene, oldController: fixture.oldController,
      player: fixture.player, targetLevelIds: [1, 2], reward: { grantId: "g", sunCount: 50 }, runId: "r", ownsTarget: () => true });
    fixture.runtime.scene = {};
    fixture.runtime.identity = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.level = fixture.runtime.identity;
    fixture.runtime.gaming = true;
    frame();
    await pending;
    expect(produced).toHaveLength(50);
    expect(produced.every(([value]) => value === 50)).toBe(true);
  });

  test("caps rewards above ten correct answers at fifty native suns", async () => {
    const fixture = runtimeFixture();
    const produced = [];
    fixture.runtime.sunflower.produceSun = (...args) => produced.push(args);
    fixture.runtime.scene = {};
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.gaming = true;
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime, nextFrame: async () => {} });

    await bridge.watchReward({ oldScene: fixture.oldScene, oldController: fixture.oldController,
      player: fixture.player, targetLevelIds: [1, 2], reward: { grantId: "g", sunCount: 50 }, runId: "r", ownsTarget: () => true });

    expect(produced).toHaveLength(50);
    expect(produced.every(([value]) => value === 50)).toBe(true);
  });

  test("does not award wrong answers or repeat after later frames", async () => {
    const fixture = runtimeFixture();
    let calls = 0;
    fixture.runtime.sunflower.produceSun = () => { calls += 1; };
    fixture.runtime.scene = {};
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.gaming = true;
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime, nextFrame: async () => {} });
    await bridge.watchReward({ oldScene: fixture.oldScene, oldController: fixture.oldController,
      player: fixture.player, targetLevelIds: [1, 2], reward: { grantId: "g", sunCount: 0 }, runId: "r", ownsTarget: () => true });
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  test("cancels stale player, scene ownership, and terminal rewards", async () => {
    for (const mutate of [
      (runtime) => { runtime.player = {}; },
      (_runtime, ownership) => { ownership.value = false; },
      (runtime) => { runtime.level.gameWon = true; },
    ]) {
      const fixture = runtimeFixture();
      let calls = 0;
      const ownership = { value: true };
      fixture.runtime.sunflower.produceSun = () => { calls += 1; };
      let frame;
      const bridge = createGameBridge({ getRuntime: () => fixture.runtime,
        nextFrame: () => new Promise((resolve) => { frame = resolve; }) });
      const pending = bridge.watchReward({ oldScene: fixture.oldScene, oldController: fixture.oldController,
        player: fixture.player, targetLevelIds: [1, 2], reward: { grantId: "g", sunCount: 5 }, runId: "r", ownsTarget: () => ownership.value });
      fixture.runtime.scene = {};
      fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
      fixture.runtime.gaming = true;
      mutate(fixture.runtime, ownership);
      frame();
      await pending;
      expect(calls).toBe(0);
    }
  });

  test("waits for native reward resources instead of losing an early entitlement", async () => {
    const fixture = runtimeFixture();
    let calls = 0;
    const frames = [];
    fixture.runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => fixture.runtime,
      nextFrame: () => new Promise((resolve) => frames.push(resolve)) });
    const pending = bridge.watchReward({ oldScene: fixture.oldScene, oldController: fixture.oldController,
      player: fixture.player, targetLevelIds: [1, 2], reward: { grantId: "g", sunCount: 5 }, runId: "r", ownsTarget: () => true });
    fixture.runtime.scene = {};
    fixture.runtime.identity = fixture.runtime.level = { node: { activeInHierarchy: true }, gameStarted: true };
    fixture.runtime.gaming = true;
    fixture.runtime.droppings.SunMid = null;
    frames.shift()();
    await Promise.resolve();
    expect(calls).toBe(0);
    fixture.runtime.droppings.SunMid = {};
    frames.shift()();
    await pending;
    expect(calls).toBe(5);
  });
});
