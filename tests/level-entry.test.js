import { describe, expect, test } from "bun:test";

import { createLevelEntry } from "../docs/learning/level-entry.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(run = async () => ({ correctCount: 2, questionCount: 3, reward: { grantId: "g", sunCount: 10 }, completed: true, cancelled: false })) {
  const calls = [];
  const rewards = [];
  const player = {};
  const levelPlay = { thisLevelsID: [1, 2], nextLevelsID: [3], levelData: { name: "native" }, rhythmMusicClip: {} };
  const keyListener = { marker: "owner", async GoToGame(...args) { calls.push({ self: this, args }); return "loaded"; } };
  const lifecycle = [];
  const controller = { run, stop() { lifecycle.push("stop"); }, suspend() { lifecycle.push("suspend"); } };
  const bridge = { cancelPending() {}, watchReward(input) { rewards.push(input); return Promise.resolve(); }, snapshotRuntime: () => ({ scene: {}, identity: {} }) };
  const entry = createLevelEntry({ keyListener, levelPlay, getPlayer: () => player, controller, bridge,
    log: { error() {}, warn() {} } });
  entry.install();
  return { bridge, calls, controller, entry, keyListener, levelPlay, lifecycle, player, rewards };
}

describe("GoToGame level-entry gate", () => {
  test("blocks the first native load until ten-question batch completion and preserves this/args", async () => {
    const answers = Array.from({ length: 10 }, deferred);
    let answer = 0;
    const h = harness(async () => {
      for (const gate of answers) {
        answer += 1;
        await gate.promise;
      }
      return { correctCount: 10, completed: true, cancelled: false };
    });
    const object = {};
    const arrays = [[object]];
    const pending = h.keyListener.GoToGame(arrays, false);
    expect(h.calls).toHaveLength(0);
    for (const gate of answers.slice(0, 9)) {
      gate.resolve();
      await Promise.resolve();
      expect(h.calls).toHaveLength(0);
    }
    answers[9].resolve();
    expect(await pending).toBe("loaded");
    expect(answer).toBe(10);
    expect(h.calls[0]).toEqual({ self: h.keyListener, args: [[[object]], false] });
  });

  test("nested goToLevel and custom direct calls both pass through the wrapper", async () => {
    const h = harness();
    h.keyListener.goToLevel = function (objects) { return this.GoToGame(objects, false); };
    await h.keyListener.goToLevel([[{}]]);
    h.levelPlay.thisLevelsID = [];
    h.levelPlay.nextLevelsID = [];
    h.levelPlay.levelData = { name: "custom" };
    const customData = h.levelPlay.levelData;
    await h.keyListener.GoToGame([[customData]], false);
    expect(h.calls).toHaveLength(2);
    expect(h.rewards).toHaveLength(2);
    expect(h.rewards[1].targetLevelData).toBe(customData);
  });

  test("duplicates share one transition and different concurrent targets cannot replace its snapshot", async () => {
    const gate = deferred();
    const h = harness(() => gate.promise);
    const first = [[{}]];
    const a = h.keyListener.GoToGame(first, false);
    const b = h.keyListener.GoToGame(first, false);
    h.levelPlay.thisLevelsID = [9];
    const conflicting = h.keyListener.GoToGame([[{}]], false);
    gate.resolve({ correctCount: 1, completed: true, cancelled: false });
    await Promise.all([a, b, conflicting]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].args[0]).not.toBe(first);
    expect(h.calls[0].args[0][0][0]).toBe(first[0][0]);
  });

  test("explicit restart reuses only the same player's matching entitlement", async () => {
    let runs = 0;
    const h = harness(async () => { runs += 1; return { correctCount: 2, questionCount: 3,
      reward: { grantId: `g-${runs}`, sunCount: 10 }, completed: true, cancelled: false }; });
    await h.keyListener.GoToGame([[{}]], false);
    await h.keyListener.GoToGame([[{}]], true);
    h.levelPlay.thisLevelsID = [7];
    await h.keyListener.GoToGame([[{}]], true);
    expect(runs).toBe(2);
    expect(h.calls).toHaveLength(3);
    expect(h.rewards.map(({ reward }) => reward.sunCount)).toEqual([10, 10, 10]);
  });

  test("passes the same final server challenge through an explicit restart", async () => {
    const challenge = { enabled: true, ruleVersion: 1, extraPerWave: 2, maxWaves: 3, totalCap: 6 };
    let runs = 0;
    const h = harness(async () => { runs += 1; return { completed: true, cancelled: false,
      reward: { grantId: "g", sunCount: 0 }, challenge }; });

    await h.keyListener.GoToGame([[{}]], false);
    await h.keyListener.GoToGame([[{}]], true);

    expect(runs).toBe(1);
    expect(h.rewards.map((input) => input.challenge)).toEqual([challenge, challenge]);
  });

  test("cancel launches once but stop never invokes native loading", async () => {
    const cancelled = harness(async () => ({ correctCount: 0, completed: false, cancelled: true, reason: "user" }));
    await cancelled.keyListener.GoToGame([[{}]], false);
    expect(cancelled.calls).toHaveLength(1);
    const stopped = harness(async () => ({ correctCount: 0, completed: false, cancelled: true, reason: "stopped" }));
    await stopped.keyListener.GoToGame([[{}]], false);
    expect(stopped.calls).toHaveLength(0);
  });

  test("page teardown suspends the controller without explicit terminal stop", () => {
    const h = harness();
    h.entry.suspend();
    expect(h.lifecycle).toEqual(["suspend"]);
  });
});
