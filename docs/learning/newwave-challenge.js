const SUPPORTED_LEVELS = new Set(["egypt3"]);
const STAGGER_SECONDS = 0.5;

function disabled(value, reason = "disabled") {
  return { enabled: false, ruleVersion: Number.isSafeInteger(value?.ruleVersion) ? value.ruleVersion : 0,
    extraPerWave: 0, maxWaves: Number.isSafeInteger(value?.maxWaves) ? value.maxWaves : 3,
    totalCap: Number.isSafeInteger(value?.totalCap) ? value.totalCap : 6, reason };
}

export function parseWaveChallenge(value) {
  if (!value?.enabled) return disabled(value);
  const valid = Number.isSafeInteger(value.ruleVersion) && value.ruleVersion >= 1 && Number.isSafeInteger(value.extraPerWave) &&
    value.extraPerWave >= 0 && value.extraPerWave <= 2 && Number.isSafeInteger(value.maxWaves) &&
    value.maxWaves === 3 && Number.isSafeInteger(value.totalCap) && value.totalCap === 6;
  if (!valid) return disabled(value, "invalid-rule");
  return { enabled: true, ruleVersion: value.ruleVersion, extraPerWave: value.extraPerWave,
    maxWaves: value.maxWaves, totalCap: value.totalCap };
}

function paused(runtime) {
  return Boolean(runtime.ui?.paused || runtime.superSlowed || runtime.cc?.game?.isPaused?.() ||
    runtime.cc?.director?.isPaused?.() || !(runtime.cc?.director?.gameSpeed > 0));
}

function disposeZombie(zombie) {
  if (zombie?.node?.destroy) zombie.node.destroy();
}

function terminal(runtime) {
  return Boolean(runtime.level?.gameWon || runtime.level?.gameLost || runtime.level?.gameOver ||
    runtime.level?._cannonVic || runtime.ui?.exitNextTick || runtime.ui?.restartNextTick || runtime.ui?._exitDealt);
}

function auditedRuntime(runtime) {
  const level = runtime?.identity;
  const waves = level?.waveManagerProps?.Waves;
  const basic = runtime?.frontYard?.getCurrentLawnBasicZombie?.();
  return basic === "mummy" && Array.isArray(waves) && waves.length >= 3 && !level.conveyor &&
    !level.Tutorial_Wave_Stuck && !level.isCowboyMinigame && !level.isVasebreaker && !level.isDangerroom &&
    !level.isDangerroomMiniGame && !level.bossProps && !level.rhythmGameProps && !level.cannonMinigameProperties;
}

function runtimeInitializing(runtime) {
  const waves = runtime?.identity?.waveManagerProps?.Waves;
  return !Array.isArray(waves) || waves.length === 0 || !runtime?.frontYard?.getCurrentLawnBasicZombie?.();
}

function sameTarget(runtime, input) {
  if (input.customLevel) return runtime.levelData === input.targetLevelData;
  const currentIds = Array.isArray(runtime.levelId) ? runtime.levelId : [runtime.levelId];
  return currentIds.length === input.targetLevelIds.length &&
    currentIds.every((value, index) => String(value) === String(input.targetLevelIds[index]));
}

function stable(runtime, controller, input, generation, ownGeneration, wave, player) {
  const valid = runtime?.valid;
  return ownGeneration === generation() && input.ownsTarget() && runtime?.identity === controller &&
    runtime.player === player && controller.currentWave === wave && !terminal(runtime) && sameTarget(runtime, input) &&
    typeof valid === "function" && valid(controller) && valid(controller.node) && controller.node.activeInHierarchy;
}

function active(runtime, controller, input, generation, ownGeneration, wave, player) {
  return stable(runtime, controller, input, generation, ownGeneration, wave, player) && runtime.gaming &&
    controller.gameStarted && !paused(runtime);
}

export function createNewWaveChallenge({
  getRuntime,
  nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve)),
  log = console,
}) {
  let generation = 0;
  let mounted = null;

  function cancelPending() {
    generation += 1;
    if (mounted && mounted.controller?.judgeWaveCount === mounted.wrapper) {
      mounted.controller.judgeWaveCount = mounted.original;
    }
    mounted = null;
  }

  function mount(input) {
    cancelPending();
    const rule = parseWaveChallenge(input.challenge);
    const levelId = input.targetLevelIds?.length === 1 ? String(input.targetLevelIds[0]) : null;
    if (!rule.enabled) return { status: "disabled", reason: rule.reason };
    if (input.customLevel || !SUPPORTED_LEVELS.has(levelId)) {
      return { status: "unsupported", reason: input.customLevel ? "custom-level" : "level-not-audited", levelId };
    }
    const controller = input.runtime?.identity;
    if (!controller || typeof controller.judgeWaveCount !== "function") {
      return { status: "unsupported", reason: "native-controller-unavailable", levelId };
    }
    if (runtimeInitializing(input.runtime)) return { status: "pending", reason: "runtime-initializing", levelId };
    if (!auditedRuntime(input.runtime)) return { status: "unsupported", reason: "runtime-not-audited", levelId };
    const original = controller.judgeWaveCount;
    const ownGeneration = generation;
    const player = input.player ?? input.runtime.player;
    const reservedWaves = new Set();
    let reserved = 0;
    let failed = false;

    async function waitForActive(wave, seconds = 0) {
      let elapsed = 0;
      let runtime = getRuntime();
      while (stable(runtime, controller, input, () => generation, ownGeneration, wave, player) && runtime.gaming &&
        controller.gameStarted &&
        (paused(runtime) || elapsed < seconds)) {
        await nextFrame();
        runtime = getRuntime();
        if (!paused(runtime)) elapsed += Math.max(0, runtime.cc?.director?.getDeltaTime?.() ?? 0);
      }
      return active(runtime, controller, input, () => generation, ownGeneration, wave, player) ? runtime : null;
    }

    async function addExtras(wave, count) {
      for (let index = 0; index < count && !failed; index += 1) {
        let runtime = await waitForActive(wave, index === 0 ? 0 : STAGGER_SECONDS);
        if (!runtime) return;
        let zombie = null;
        try {
          const type = runtime.frontYard?.getCurrentLawnBasicZombie?.();
          if (!type || typeof runtime.zombies?.spawnZombieFromLaneByType !== "function") return;
          zombie = await runtime.zombies.spawnZombieFromLaneByType(null, type);
          runtime = await waitForActive(wave);
          if (!runtime) { disposeZombie(zombie); return; }
          zombie?.judgeInLnC?.();
          controller.registerZombieInThisWave(zombie);
        } catch (error) {
          disposeZombie(zombie);
          failed = true;
          log.error("[quiz] Native wave challenge disabled after spawn failure", error);
        }
      }
    }

    async function wrapper(...args) {
      const nativeResult = Reflect.apply(original, this, args);
      const wave = this.currentWave;
      const runtime = getRuntime();
      let count = 0;
      if (!failed && this === controller && active(runtime, controller, input, () => generation, ownGeneration, wave, player) &&
        Number.isSafeInteger(wave) && wave >= 1 && wave <= rule.maxWaves && !reservedWaves.has(wave)) {
        reservedWaves.add(wave);
        count = Math.min(rule.extraPerWave, rule.totalCap - reserved);
        reserved += count;
      }
      const result = await nativeResult;
      if (count > 0) await addExtras(wave, count);
      return result;
    }

    controller.judgeWaveCount = wrapper;
    mounted = { controller, original, wrapper };
    return { status: "active", levelId, ruleVersion: rule.ruleVersion };
  }

  return { cancelPending, mount };
}
