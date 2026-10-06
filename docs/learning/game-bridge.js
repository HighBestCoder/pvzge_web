import { createNewWaveChallenge } from "./newwave-challenge.js";
import { shouldDeferTutorialReward } from "./newtutorial-progression.js";

const IDS = {
  cc: "cc", level: "chunks:///_virtual/levelController.ts", ui: "chunks:///_virtual/UI.ts",
  player: "chunks:///_virtual/PlayerProperties.ts", sunflower: "chunks:///_virtual/Sunflower.ts",
  droppings: "chunks:///_virtual/Droppings.ts", square: "chunks:///_virtual/Square.ts",
  sunCount: "chunks:///_virtual/SunCount.ts",
  zombies: "chunks:///_virtual/Zombies.ts", frontYard: "chunks:///_virtual/FrontYard.ts",
};

function activeComponent(component, valid) {
  return Boolean(component && valid(component) && component.node && valid(component.node) && component.node.activeInHierarchy);
}

function sameLevelId(left, right) {
  if (String(left) === String(right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => String(value) === String(right[index]));
}

function validRuntime(runtime) {
  return Boolean(runtime?.valid && runtime.scene && runtime.valid(runtime.scene, true) &&
    activeComponent(runtime.level, runtime.valid) && activeComponent(runtime.ui, runtime.valid));
}

function validRewardResources(runtime, positions) {
  const { valid, droppings, square, sunCount, sunflower } = runtime;
  return Boolean(droppings?.controller && valid(droppings.controller) && droppings.layer && valid(droppings.layer) &&
    droppings.SunMid && valid(droppings.SunMid) && square?.Square00 && valid(square.Square00) &&
    sunCount?.component && valid(sunCount.component) && typeof sunflower?.produceSun === "function" &&
    positions.length === 5 && positions.every((position) => Number.isFinite(position?.x) && Number.isFinite(position?.y)));
}

function terminal(runtime) {
  return Boolean(runtime.level?.gameWon || runtime.level?.gameLost || runtime.level?.gameOver || runtime.level?._cannonVic ||
    runtime.ui?.exitNextTick || runtime.ui?.restartNextTick || runtime.ui?._exitDealt);
}

function ownsRuntime(runtime, input, controller) {
  return Boolean(runtime && runtime.player === input.player && runtime.identity === controller && input.ownsTarget());
}

function targetMatches(runtime, input) {
  return input.customLevel ? runtime.levelData === input.targetLevelData : sameLevelId(runtime.levelId, input.targetLevelIds);
}

export function createSystemRuntime(system = globalThis.System) {
  if (!system?.get || !system?.resolve) return null;
  const cached = {};
  for (const [name, id] of Object.entries(IDS)) {
    try { cached[name] = system.get(system.resolve(id)); }
    catch { return null; }
    if (!cached[name]) return null;
  }
  const levelClass = cached.level.LevelPlay;
  return {
    cc: cached.cc, valid: cached.cc.isValid, scene: cached.cc.director?.getScene?.(),
    identity: levelClass?.component ?? null, levelId: levelClass?.thisLevelsID,
    levelData: levelClass?.levelData,
    gaming: levelClass?.gaming, level: levelClass?.component, ui: cached.ui.UIInGame?.component,
    superSlowed: cached.ui.superSlowed,
    player: cached.player.AllPlayerProperties?.currentPlayer ?? null,
    sunflower: cached.sunflower.sunflower, droppings: cached.droppings.droppings,
    square: cached.square.Square, sunCount: cached.sunCount.SunCount,
    zombies: cached.zombies.zombies, frontYard: cached.frontYard.FrontYard,
  };
}

export function createGameBridge({
  getRuntime = () => createSystemRuntime(),
  nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve)),
  reporter = null,
  receipts = null,
  waveChallenge = null,
} = {}) {
  let generation = 0;
  const challenge = waveChallenge ?? createNewWaveChallenge({ getRuntime, nextFrame });

  function snapshotRuntime() {
    const runtime = getRuntime();
    return { oldScene: runtime?.scene ?? null, oldController: runtime?.identity ?? null };
  }

  function cancelPending() { generation += 1; challenge.cancelPending(); }

  async function observeOutcome(input, controller, ownGeneration) {
    while (ownGeneration === generation && input.ownsTarget()) {
      const runtime = getRuntime();
      if (!runtime || runtime.player !== input.player || runtime.identity !== controller) return;
      let outcome = null;
      if (runtime.level?.gameWon || runtime.level?._cannonVic) outcome = "won";
      else if (runtime.level?.gameLost || runtime.level?.gameOver) outcome = "lost";
      else if (runtime.ui?.exitNextTick || runtime.ui?.restartNextTick || runtime.ui?._exitDealt) outcome = "abandoned";
      if (outcome) {
        await reporter.report({ runId: input.runId, learningSessionId: input.learningSessionId,
          levelIds: input.targetLevelIds, outcome });
        return;
      }
      await nextFrame();
    }
  }

  async function watchReward(input) {
    const count = input.reward?.sunCount;
    if (!input.player || !input.runId) return { status: "disabled", reason: "invalid-run" };
    const ownGeneration = generation;
    let runtime;
    while (ownGeneration === generation && input.ownsTarget()) {
      runtime = getRuntime();
      if (!runtime || runtime.player !== input.player) return;
      if (runtime.identity !== input.oldController) break;
      await nextFrame();
    }
    if (ownGeneration !== generation || !runtime?.identity || !input.ownsTarget()) return;
    const controller = runtime.identity;
    let challengeStatus = challenge.mount({ ...input, runtime });
    while (challengeStatus.status === "pending" && ownGeneration === generation) {
      await nextFrame();
      runtime = getRuntime();
      if (!ownsRuntime(runtime, input, controller) || terminal(runtime)) return;
      challengeStatus = challenge.mount({ ...input, runtime });
    }
    input.onChallengeStatus?.(challengeStatus);
    if (challengeStatus.status === "unsupported") {
      console.info("[quiz] Wave challenge unsupported", challengeStatus.reason, challengeStatus.levelId ?? "custom");
    }
    while (ownGeneration === generation) {
      runtime = getRuntime();
      if (!ownsRuntime(runtime, input, controller) || terminal(runtime)) return;
      if (runtime.gaming && runtime.level?.gameStarted && targetMatches(runtime, input)) break;
      await nextFrame();
    }
    if (reporter) {
      await reporter.report({ runId: input.runId, learningSessionId: input.learningSessionId,
        levelIds: input.targetLevelIds, outcome: "started" });
      observeOutcome(input, controller, ownGeneration)
        .catch((error) => console.error("[quiz] Outcome observer failed", error));
    }
    if (!Number.isSafeInteger(count) || count < 0 || count > 500 || receipts?.has(input.runId) || count === 0) {
      return challengeStatus;
    }
    while (ownGeneration === generation) {
      runtime = getRuntime();
      if (!ownsRuntime(runtime, input, controller) || terminal(runtime)) return;
      if (!validRuntime(runtime)) { await nextFrame(); continue; }
      if (shouldDeferTutorialReward(runtime)) { await nextFrame(); continue; }
      const eligible = runtime.gaming && runtime.level?.gameStarted && runtime.ui.sceneEnabled && !runtime.ui.paused &&
        !runtime.cc?.game?.isPaused?.() && !runtime.cc?.director?.isPaused?.() && targetMatches(runtime, input);
      if (!eligible) { await nextFrame(); continue; }
      const positions = [2, 3, 4, 5, 6].map((column) => runtime.square?.getSquareWorldPosition?.(2, column));
      if (!validRewardResources(runtime, positions)) { await nextFrame(); continue; }
      for (let index = 0; index < count; index += 1) {
        runtime.sunflower.produceSun(50, positions[index % positions.length], 40 + Math.floor(index / 5) * 12,
          false, false, false);
      }
      await receipts?.acknowledge({ grantId: input.reward.grantId, runId: input.runId });
      return challengeStatus;
    }
  }

  return { snapshotRuntime, cancelPending, watchReward };
}
