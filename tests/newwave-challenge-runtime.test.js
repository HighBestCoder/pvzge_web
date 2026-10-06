import { describe, expect, test } from "bun:test";

import { createNewWaveChallenge } from "../docs/learning/newwave-challenge.js";

const rule = { enabled: true, ruleVersion: 1, extraPerWave: 1, maxWaves: 3, totalCap: 6 };

function fixture() {
  const registered = [];
  const player = {};
  const controller = {
    currentWave: 0, gameStarted: true, node: { activeInHierarchy: true },
    waveManagerProps: { Waves: [[], [], []] },
    async judgeWaveCount() { this.currentWave += 1; },
    registerZombieInThisWave(zombie) { registered.push(zombie); },
  };
  const runtime = {
    identity: controller, level: controller, levelId: ["egypt3"], player, gaming: true, superSlowed: false,
    valid: (value) => Boolean(value), ui: { paused: false },
    cc: { game: { isPaused: () => false }, director: { isPaused: () => false, gameSpeed: 1, getDeltaTime: () => 0.5 } },
    frontYard: { getCurrentLawnBasicZombie: () => "mummy" },
    zombies: { async spawnZombieFromLaneByType() {
      return { node: { active: true, activeInHierarchy: true, destroy() {} }, judgeInLnC() {} };
    } },
  };
  return { controller, player, registered, runtime };
}

function mount(h) {
  const adapter = createNewWaveChallenge({ getRuntime: () => h.runtime, nextFrame: async () => {} });
  adapter.mount({ challenge: rule, runtime: h.runtime, player: h.player,
    targetLevelIds: ["egypt3"], customLevel: false, ownsTarget: () => true });
  return adapter;
}

describe("wave challenge active runtime guard", () => {
  test.each([
    ["pre-start", (h) => { h.controller.gameStarted = false; }],
    ["not gaming", (h) => { h.runtime.gaming = false; }],
    ["super slowed", (h) => { h.runtime.superSlowed = true; }],
    ["zero game speed", (h) => { h.runtime.cc.director.gameSpeed = 0; }],
    ["paused game", (h) => { h.runtime.cc.game.isPaused = () => true; }],
    ["inactive controller", (h) => { h.controller.node.activeInHierarchy = false; }],
    ["invalid controller", (h) => { h.runtime.valid = (value) => value !== h.controller; }],
    ["stale player", (h) => { h.runtime.player = {}; }],
    ["stale target", (h) => { h.runtime.levelId = ["egypt4"]; }],
  ])("does not reserve or spawn while %s", async (_name, mutate) => {
    const h = fixture();
    mount(h);
    mutate(h);
    await h.controller.judgeWaveCount();
    expect(h.registered).toHaveLength(0);
  });

  test("a pre-start call does not consume the wave reservation", async () => {
    const h = fixture();
    h.controller.gameStarted = false;
    mount(h);
    await h.controller.judgeWaveCount();
    h.controller.gameStarted = true;
    await h.controller.judgeWaveCount();
    expect(h.registered).toHaveLength(1);
  });
});
