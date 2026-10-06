import { describe, expect, test } from "bun:test";

import { createNewWaveChallenge, parseWaveChallenge } from "../docs/learning/newwave-challenge.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ deltaTime = 0.25, log = { error() {} } } = {}) {
  const spawned = [];
  const registered = [];
  const controller = {
    currentWave: -1, gameStarted: true,
    node: { activeInHierarchy: true },
    async judgeWaveCount(value) { this.currentWave += 1; return value; },
    registerZombieInThisWave(zombie) { registered.push(zombie); },
  };
  const runtime = {
    identity: controller, level: controller, levelId: ["egypt3"], gaming: true, superSlowed: false,
    valid: (value) => Boolean(value),
    player: {}, ui: { paused: false }, cc: { game: { isPaused: () => false },
      director: { isPaused: () => false, gameSpeed: 1, getDeltaTime: () => deltaTime } },
    frontYard: { getCurrentLawnBasicZombie: () => "mummy" },
    zombies: { async spawnZombieFromLaneByType(lane, type) {
      const zombie = { lane, type, node: { destroy() {} }, judgeInLnC() {} };
      spawned.push(zombie); return zombie;
    } },
  };
  controller.waveManagerProps = { Waves: [[], [], []], FlagWaveInterval: 3 };
  return { controller, log, registered, runtime, spawned };
}

const enabled = { enabled: true, ruleVersion: 1, extraPerWave: 2, maxWaves: 3, totalCap: 6 };

describe("wrong-answer native wave challenge", () => {
  test("accepts backend rules for zero, one, and two wrong answers and rejects version zero", () => {
    expect(parseWaveChallenge(undefined).enabled).toBe(false);
    expect(parseWaveChallenge({ ...enabled, enabled: false, ruleVersion: 0, extraPerWave: 0 })).toEqual({
      enabled: false, ruleVersion: 0, extraPerWave: 0, maxWaves: 3, totalCap: 6, reason: "disabled",
    });
    expect(parseWaveChallenge({ ...enabled, extraPerWave: 0 })).toMatchObject({ enabled: true, ruleVersion: 1, extraPerWave: 0 });
    expect(parseWaveChallenge({ ...enabled, ruleVersion: 4, extraPerWave: 1 })).toMatchObject({ enabled: true, ruleVersion: 4, extraPerWave: 1 });
    expect(parseWaveChallenge(enabled)).toMatchObject({ enabled: true, ruleVersion: 1, extraPerWave: 2 });
    expect(parseWaveChallenge({ ...enabled, ruleVersion: 0 }).enabled).toBe(false);
    expect(parseWaveChallenge({ ...enabled, extraPerWave: 3 }).enabled).toBe(false);
    expect(parseWaveChallenge({ ...enabled, totalCap: 7 }).enabled).toBe(false);
  });

  test("adds two native basic zombies to only the first three actual egypt3 waves", async () => {
    const h = fixture();
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    expect(challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true })).toEqual({
      status: "active", levelId: "egypt3", ruleVersion: 1,
    });

    for (let wave = 0; wave < 5; wave += 1) await h.controller.judgeWaveCount(wave);

    expect(h.spawned.map(({ type }) => type)).toEqual(["mummy", "mummy", "mummy", "mummy", "mummy", "mummy"]);
    expect(h.registered).toEqual(h.spawned);
    expect(h.spawned.map(({ lane }) => lane)).toEqual([null, null, null, null, null, null]);
  });

  test("reports unsupported stock and custom levels without changing the controller", () => {
    const h = fixture();
    const original = h.controller.judgeWaveCount;
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime });

    expect(challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt2"], ownsTarget: () => true })).toEqual({
      status: "unsupported", reason: "level-not-audited", levelId: "egypt2",
    });
    expect(challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["custom-1"], customLevel: true,
      ownsTarget: () => true }).status).toBe("unsupported");
    expect(h.controller.judgeWaveCount).toBe(original);
  });

  test("rejects modified or special egypt3 runtime graphs", () => {
    for (const mutate of [
      (h) => { h.runtime.frontYard.getCurrentLawnBasicZombie = () => "tutorial"; },
      (h) => { h.controller.waveManagerProps.Waves = [[], []]; },
      (h) => { h.controller.conveyor = true; },
      (h) => { h.controller.Tutorial_Wave_Stuck = true; },
      (h) => { h.controller.bossProps = {}; },
    ]) {
      const h = fixture();
      mutate(h);
      const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime });
      expect(challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"],
        ownsTarget: () => true })).toEqual({ status: "unsupported", reason: "runtime-not-audited", levelId: "egypt3" });
    }
  });

  test("reports pending until the stock runtime graph is initialized", () => {
    const h = fixture();
    h.controller.waveManagerProps.Waves = [];
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime });
    expect(challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"],
      ownsTarget: () => true })).toEqual({ status: "pending", reason: "runtime-initializing", levelId: "egypt3" });
  });

  test("waits while native play is paused and preserves the original result", async () => {
    const h = fixture();
    const frame = deferred();
    const native = deferred();
    h.controller.currentWave = 0;
    h.controller.judgeWaveCount = function () { this.currentWave += 1; return native.promise; };
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: () => frame.promise });
    challenge.mount({ challenge: { ...enabled, extraPerWave: 1 }, runtime: h.runtime,
      targetLevelIds: ["egypt3"], ownsTarget: () => true });

    const pending = h.controller.judgeWaveCount("native-result");
    h.runtime.ui.paused = true;
    native.resolve("native-result");
    await Promise.resolve();
    expect(h.spawned).toHaveLength(0);
    h.runtime.ui.paused = false;
    frame.resolve();
    expect(await pending).toBe("native-result");
    expect(h.registered).toHaveLength(1);
  });

  test("destroys a late native spawn after cancellation instead of registering it", async () => {
    const h = fixture();
    const gate = deferred();
    let destroyed = 0;
    h.controller.currentWave = 0;
    h.runtime.zombies.spawnZombieFromLaneByType = async () => gate.promise;
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    challenge.mount({ challenge: { ...enabled, extraPerWave: 1 }, runtime: h.runtime,
      targetLevelIds: ["egypt3"], ownsTarget: () => true });
    const pending = h.controller.judgeWaveCount();
    await Promise.resolve();
    challenge.cancelPending();
    gate.resolve({ node: { destroy() { destroyed += 1; } }, judgeInLnC() {} });
    await pending;
    expect(h.registered).toHaveLength(0);
    expect(destroyed).toBe(1);
  });

  test("destroys a late native spawn after the next wave starts", async () => {
    const h = fixture();
    const gate = deferred();
    let destroyed = 0;
    h.controller.currentWave = 0;
    h.runtime.zombies.spawnZombieFromLaneByType = async () => gate.promise;
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    challenge.mount({ challenge: { ...enabled, extraPerWave: 1 }, runtime: h.runtime,
      targetLevelIds: ["egypt3"], ownsTarget: () => true });
    const pending = h.controller.judgeWaveCount();
    await Promise.resolve();
    h.controller.currentWave = 2;
    gate.resolve({ node: { destroy() { destroyed += 1; } }, judgeInLnC() {} });
    await pending;
    expect(h.registered).toHaveLength(0);
    expect(destroyed).toBe(1);
  });

  test("captures each wave synchronously and reserves slots before concurrent native promises settle", async () => {
    const h = fixture();
    const gates = [deferred(), deferred(), deferred(), deferred()];
    h.controller.judgeWaveCount = function () { this.currentWave += 1; return gates[this.currentWave].promise; };
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true });

    const calls = [h.controller.judgeWaveCount(), h.controller.judgeWaveCount(), h.controller.judgeWaveCount(),
      h.controller.judgeWaveCount()];
    for (const gate of gates) gate.resolve();
    await Promise.all(calls);

    expect(h.spawned).toHaveLength(2);
    expect(h.registered).toHaveLength(2);
  });

  test("deduplicates repeated native dispatch for the same wave", async () => {
    const h = fixture();
    h.controller.currentWave = 1;
    h.controller.judgeWaveCount = async function () { return this.currentWave; };
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true });
    await Promise.all([h.controller.judgeWaveCount(), h.controller.judgeWaveCount()]);
    expect(h.registered).toHaveLength(2);
  });

  test("isolates an extra spawn failure while preserving the native result", async () => {
    const errors = [];
    const h = fixture({ log: { error(...args) { errors.push(args); } } });
    h.controller.currentWave = 0;
    h.runtime.zombies.spawnZombieFromLaneByType = async () => { throw new Error("pool failed"); };
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {}, log: h.log });
    challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true });
    expect(await h.controller.judgeWaveCount("native-result")).toBe("native-result");
    expect(errors).toHaveLength(1);
    await h.controller.judgeWaveCount("later-native-result");
    expect(errors).toHaveLength(1);
  });

  test("propagates an original native judge rejection unchanged", async () => {
    const nativeError = new Error("native wave failed");
    const h = fixture();
    h.controller.judgeWaveCount = async () => { throw nativeError; };
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
    challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true });
    await expect(h.controller.judgeWaveCount()).rejects.toBe(nativeError);
  });

  test("stagger uses active simulation delta and does not advance while paused", async () => {
    let frames = 0;
    const h = fixture({ deltaTime: 0.25 });
    h.controller.currentWave = 0;
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime,
      nextFrame: async () => { frames += 1; if (frames === 1) h.runtime.ui.paused = true; if (frames === 3) h.runtime.ui.paused = false; } });
    challenge.mount({ challenge: enabled, runtime: h.runtime, targetLevelIds: ["egypt3"], ownsTarget: () => true });
    await h.controller.judgeWaveCount();
    expect(h.registered).toHaveLength(2);
    expect(frames).toBe(4);
  });

  test("preserves native activation and defers registration until simulation resumes", async () => {
    const h = fixture();
    const spawn = deferred();
    const frame = deferred();
    let activationWrites = 0;
    const zombie = { node: { get active() { return true; }, set active(value) { activationWrites += 1; }, destroy() {} }, judgeInLnC() {} };
    const activeAtRegistration = [];
    h.controller.registerZombieInThisWave = (value) => {
      activeAtRegistration.push(value.node.active);
      h.registered.push(value);
    };
    h.controller.currentWave = 0;
    h.runtime.zombies.spawnZombieFromLaneByType = async () => spawn.promise;
    const challenge = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: () => frame.promise });
    challenge.mount({ challenge: { ...enabled, extraPerWave: 1 }, runtime: h.runtime,
      targetLevelIds: ["egypt3"], ownsTarget: () => true });
    const pending = h.controller.judgeWaveCount();
    await Promise.resolve();
    h.runtime.ui.paused = true;
    spawn.resolve(zombie);
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(activationWrites).toBe(0);
    expect(h.registered).toHaveLength(0);
    h.runtime.ui.paused = false;
    frame.resolve();
    await pending;
    expect(zombie.node.active).toBe(true);
    expect(h.registered).toEqual([zombie]);
    expect(activeAtRegistration).toEqual([true]);
    expect(activationWrites).toBe(0);
  });
});
