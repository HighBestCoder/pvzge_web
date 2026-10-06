import { expect, test } from "bun:test";
import { createGameBridge } from "../docs/learning/game-bridge.js";

test("holds the complete entitlement until tutorial progression, then awards once", async () => {
  const frames = [];
  const produced = [];
  const acknowledgements = [];
  const player = {};
  const level = { node: { activeInHierarchy: true }, gameStarted: true, Tutorial_Wave_Stuck: true };
  const runtime = {
    player, identity: level, level, levelId: ["tutorial1"], scene: {}, gaming: true,
    valid: Boolean, ui: { node: { activeInHierarchy: true }, sceneEnabled: true, paused: false },
    cc: { game: { isPaused: () => false }, director: { isPaused: () => false } },
    square: { Square00: {}, getSquareWorldPosition: (row, col) => ({ x: col, y: row }) },
    sunCount: { component: {} }, droppings: { controller: {}, layer: {}, SunMid: {} },
    sunflower: { produceSun: (...args) => produced.push(args) },
  };
  const bridge = createGameBridge({ getRuntime: () => runtime,
    nextFrame: () => new Promise(resolve => frames.push(resolve)),
    waveChallenge: { mount: () => ({ status: "disabled" }), cancelPending() {} },
    receipts: { has: () => false, acknowledge: async receipt => acknowledgements.push(receipt) },
  });
  const pending = bridge.watchReward({ player, oldController: {}, targetLevelIds: ["tutorial1"],
    ownsTarget: () => true, runId: "run", reward: { grantId: "grant", sunCount: 20 } });
  await Promise.resolve();
  expect(produced).toHaveLength(0);
  expect(acknowledgements).toHaveLength(0);
  expect(level.Tutorial_Wave_Stuck).toBe(true);
  level.Tutorial_Wave_Stuck = false;
  frames.shift()?.();
  await pending;
  expect(produced).toHaveLength(20);
  expect(produced.every(args => args[0] === 50)).toBe(true);
  expect(acknowledgements).toEqual([{ grantId: "grant", runId: "run" }]);
});

test("cancels a deferred tutorial entitlement when the level becomes terminal", async () => {
  const frames = [];
  const produced = [];
  const player = {};
  const level = { node: { activeInHierarchy: true }, gameStarted: true, Tutorial_Wave_Stuck: true };
  const runtime = {
    player, identity: level, level, levelId: ["tutorial1"], scene: {}, gaming: true,
    valid: Boolean, ui: { node: { activeInHierarchy: true }, sceneEnabled: true, paused: false },
    cc: { game: { isPaused: () => false }, director: { isPaused: () => false } },
    square: { Square00: {}, getSquareWorldPosition: (row, col) => ({ x: col, y: row }) },
    sunCount: { component: {} }, droppings: { controller: {}, layer: {}, SunMid: {} },
    sunflower: { produceSun: (...args) => produced.push(args) },
  };
  const bridge = createGameBridge({ getRuntime: () => runtime,
    nextFrame: () => new Promise(resolve => frames.push(resolve)),
    waveChallenge: { mount: () => ({ status: "disabled" }), cancelPending() {} },
  });
  const pending = bridge.watchReward({ player, oldController: {}, targetLevelIds: ["tutorial1"],
    ownsTarget: () => true, runId: "run", reward: { grantId: "grant", sunCount: 20 } });
  await Promise.resolve();

  level.gameLost = true;
  frames.shift()?.();
  await pending;

  expect(produced).toHaveLength(0);
});
