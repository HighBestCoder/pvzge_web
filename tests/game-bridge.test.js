import { describe, expect, test } from "bun:test";

import { createGameBridge } from "../docs/learning/game-bridge.js";

function createRuntime() {
  const invalid = new Set();
  const scene = {};
  const level = {
    node: { activeInHierarchy: true },
    isSeedChooserMode: () => false,
    carddeck_displayer_isActive: () => false,
  };
  const ui = { node: { activeInHierarchy: true }, sceneEnabled: true, paused: false, index: -1, mouseDown: false };
  const runtime = {
    cc: {
      director: { gameSpeed: 1, getScene: () => scene, isPaused: () => false },
      game: { isPaused: () => false },
    },
    valid: (value) => Boolean(value) && !invalid.has(value),
    scene, identity: level, levelId: [1, 2], gaming: true, level, ui,
    superSlowed: false, keys: { isInGame: true }, npc: { HasFlow: () => false },
    droppings: { controller: {}, layer: {}, SunMid: {} },
    square: { Square00: {}, getSquareWorldPosition: (row, column) => ({ x: column, y: row }) },
    sunCount: { component: {} }, sunflower: { produceSun() {} }, invalid,
  };
  ui.pauseMenu = () => {
    ui.paused = !ui.paused;
    runtime.cc.director.gameSpeed = ui.paused ? 0 : 1;
  };
  return runtime;
}

describe("sun reward bridge", () => {
  test("precomputes five squares and produces separate 50-value suns exactly once", async () => {
    const produced = [];
    const columns = [];
    const runtime = createRuntime();
    runtime.square.getSquareWorldPosition = (row, column) => {
      columns.push([row, column]);
      return { x: column, y: row };
    };
    runtime.sunflower.produceSun = (...args) => produced.push(args);
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);

    bridge.releasePause(snapshot);
    bridge.award(snapshot, "attempt-1");
    bridge.award(snapshot, "attempt-1");

    expect(columns).toEqual([[2, 2], [2, 3], [2, 4], [2, 5], [2, 6]]);
    expect(produced).toHaveLength(5);
    expect(produced.every(([value, , height, a, b, c]) => value === 50 && height === 40 && !a && !b && !c)).toBe(true);
  });

  test("rewards once while native speed is still catching up after quiz resume", async () => {
    const produced = [];
    const runtime = createRuntime();
    runtime.ui.pauseMenu = () => {
      runtime.ui.paused = !runtime.ui.paused;
      if (runtime.ui.paused) runtime.cc.director.gameSpeed = 0;
    };
    runtime.sunflower.produceSun = (...args) => produced.push(args);
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();

    await bridge.pauseForQuiz(snapshot);
    bridge.releasePause(snapshot);
    expect(runtime.ui.paused).toBe(false);
    expect(runtime.cc.director.gameSpeed).toBe(0);
    bridge.award(snapshot, "local-grade");
    bridge.award(snapshot, "local-grade");

    expect(produced).toHaveLength(5);
  });

  test("marks an award attempted before spawning so a partial failure cannot retry", async () => {
    let calls = 0;
    const runtime = createRuntime();
    runtime.sunflower.produceSun = () => { calls += 1; if (calls === 3) throw new Error("spawn failed"); };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);

    bridge.releasePause(snapshot);
    expect(() => bridge.award(snapshot, "attempt-1")).toThrow("spawn failed");
    bridge.award(snapshot, "attempt-1");
    expect(calls).toBe(3);
  });

  test.each(["gameWon", "gameLost", "gameOver"])("does not reward a terminal same-scene level that has %s", async (terminal) => {
    let calls = 0;
    const runtime = createRuntime();
    runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);

    runtime.level[terminal] = true;
    runtime.gaming = false;
    bridge.releasePause(snapshot);
    bridge.award(snapshot, "attempt-1");

    expect(calls).toBe(0);
  });

  test("revalidates every reward resource before spawning any sun", async () => {
    let calls = 0;
    const runtime = createRuntime();
    runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);

    runtime.invalid.add(runtime.droppings.SunMid);
    bridge.releasePause(snapshot);
    bridge.award(snapshot, "attempt-1");

    expect(calls).toBe(0);
  });

  test("does not reward during the cannon victory transition", async () => {
    const runtime = createRuntime();
    let calls = 0;
    runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);
    runtime.level._cannonVic = true;
    bridge.releasePause(snapshot);
    bridge.award(snapshot, "attempt-1");
    expect(calls).toBe(0);
  });

  test("rejects a reward while the user has paused after the quiz resumed", async () => {
    const runtime = createRuntime();
    let calls = 0;
    runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    await bridge.pauseForQuiz(snapshot);
    bridge.releasePause(snapshot);
    runtime.ui.pauseMenu();
    bridge.award(snapshot, "attempt-1");
    expect(calls).toBe(0);
  });

  test("requires a nonempty attempt tied to a legitimately acquired pause", async () => {
    const runtime = createRuntime();
    let calls = 0;
    runtime.sunflower.produceSun = () => { calls += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const unpaused = bridge.preflight();
    bridge.award(unpaused, "attempt-x");
    const acquired = bridge.preflight();
    await bridge.pauseForQuiz(acquired);
    bridge.releasePause(acquired);
    bridge.award(acquired, "");
    expect(calls).toBe(0);
  });
});

describe("game bridge lifecycle", () => {
  test("does not claim pause ownership when speed is zero but ui.paused is false", async () => {
    const runtime = createRuntime();
    runtime.ui.pauseMenu = () => {};
    const bridge = createGameBridge({ getRuntime: () => runtime, nextFrame: async () => {} });
    const snapshot = bridge.preflight();
    runtime.cc.director.gameSpeed = 0;

    expect(await bridge.pauseForQuiz(snapshot)).toBe(false);
  });

  test("releasePause without acquired ownership is a no-op", () => {
    let toggles = 0;
    const runtime = createRuntime();
    runtime.ui.pauseMenu = () => { toggles += 1; };
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();
    runtime.ui.paused = true;

    bridge.releasePause(snapshot);

    expect(toggles).toBe(0);
  });

  test.each(["Tutorial_Wave_Stuck", "Tutorial_Point_At_Grass"])("suppresses quizzes while %s is active", (flag) => {
    const runtime = createRuntime();
    runtime.level[flag] = true;
    const bridge = createGameBridge({ getRuntime: () => runtime });

    expect(bridge.isEligible()).toBe(false);
  });

  test("rejects an invalid native scene and invalid components", () => {
    const runtime = createRuntime();
    const bridge = createGameBridge({ getRuntime: () => runtime });
    const snapshot = bridge.preflight();

    runtime.invalid.add(runtime.scene);
    expect(bridge.isCurrent(snapshot)).toBe(false);
    runtime.invalid.delete(runtime.scene);
    runtime.invalid.add(runtime.level);
    expect(bridge.isCurrent(snapshot)).toBe(false);
  });

  test("keeps identity stable when level ID arrays are recreated with equal contents", () => {
    const runtime = createRuntime();
    const bridge = createGameBridge({ getRuntime: () => ({ ...runtime, levelId: [...runtime.levelId] }) });

    expect(bridge.getLevelIdentity()).toBe(bridge.getLevelIdentity());
  });

  test("exposes provider context and no identity when no level is active", () => {
    const runtime = createRuntime();
    const bridge = createGameBridge({ getRuntime: () => runtime });
    expect(bridge.getGameContext()).toEqual({ gameId: "pvzge", levelIds: ["1", "2"], locale: "zh-CN" });
    runtime.gaming = false;
    expect(bridge.getLevelIdentity()).toBeNull();
    expect(bridge.hasEnded()).toBe(true);
  });
});
