const IDS = {
  cc: "cc",
  level: "chunks:///_virtual/levelController.ts",
  ui: "chunks:///_virtual/UI.ts",
  keys: "chunks:///_virtual/KeyListener.ts",
  npc: "chunks:///_virtual/NPC_Controller.ts",
  sunflower: "chunks:///_virtual/Sunflower.ts",
  droppings: "chunks:///_virtual/Droppings.ts",
  square: "chunks:///_virtual/Square.ts",
  sunCount: "chunks:///_virtual/SunCount.ts",
};

const ACTIVE_INSTRUCTIONS = [
  "Tutorial_Wave_Stuck",
  "Tutorial_Point_At_Card",
  "Tutorial_Point_At_Card_2",
  "Tutorial_Point_At_Grass",
  "Tutorial_Will_Release_Zombies",
  "Tutorial_Sunflower",
  "Tutorial_Sun_Collect",
  "Tutorial_Sun_Stuck",
  "Tutorial_Plantfood",
  "Tutorial_Point_At_Plantfood",
];

function activeComponent(component, valid) {
  return Boolean(component && valid(component) && component.node && valid(component.node) && component.node.activeInHierarchy);
}

function sameLevelId(left, right) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function finitePosition(position) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y));
}

function activeObjective(level) {
  const shower = level.levelObjectiveShower;
  if (!shower || shower.index !== -1 || shower.faded || !shower.node?.activeInHierarchy) return false;
  const opacity = shower.opacity ?? shower.node._uiProps?.opacity ?? 1;
  return opacity > 0;
}

function validRuntime(runtime) {
  return Boolean(
    runtime?.valid &&
    runtime.scene &&
     runtime.valid(runtime.scene, true) &&
    activeComponent(runtime.level, runtime.valid) &&
    activeComponent(runtime.ui, runtime.valid),
  );
}

function activeLevel(runtime) {
  const { level, ui } = runtime;
  return Boolean(runtime.gaming && !level.gameWon && !level.gameLost && !level.gameOver && !level._cannonVic &&
    !ui.exitNextTick && !ui.restartNextTick && !ui._exitDealt);
}

function validRewardResources(runtime, positions) {
  const { valid, droppings, square, sunCount, sunflower } = runtime;
  return Boolean(
    droppings?.controller && valid(droppings.controller) &&
    droppings.layer && valid(droppings.layer) &&
    droppings.SunMid && valid(droppings.SunMid) &&
    square?.Square00 && valid(square.Square00) &&
    sunCount?.component && valid(sunCount.component) &&
    typeof sunflower?.produceSun === "function" &&
    positions?.length === 5 && positions.every(finitePosition),
  );
}

export function createSystemRuntime(system = globalThis.System) {
  if (!system?.get || !system?.resolve) return null;
  const cached = {};
  for (const [name, id] of Object.entries(IDS)) {
    try {
      cached[name] = system.get(system.resolve(id));
    } catch (error) {
      console.error(`[quiz] Cannot resolve cached module ${id}`, error);
      return null;
    }
    if (!cached[name]) return null;
  }

  const levelClass = cached.level.LevelPlay;
  const level = levelClass?.component;
  const ui = cached.ui.UIInGame?.component;
  return {
    cc: cached.cc,
    valid: cached.cc.isValid,
    scene: cached.cc.director?.getScene?.(),
    identity: level ?? null,
    levelId: levelClass?.thisLevelsID,
    gaming: levelClass?.gaming,
    level,
    ui,
    superSlowed: cached.ui.superSlowed,
    keys: cached.keys.KeyListener,
    npc: cached.npc.npc_controller,
    sunflower: cached.sunflower.sunflower,
    droppings: cached.droppings.droppings,
    square: cached.square.Square,
    sunCount: cached.sunCount.SunCount,
  };
}

export function createGameBridge({
  getRuntime = () => createSystemRuntime(),
  nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve)),
  log = console,
} = {}) {
  const attempted = new Set();
  const ownedPauses = new WeakSet();
  const acquiredPauses = new WeakSet();
  let identityScene = null;
  let identityComponent = null;
  let identityLevelId;
  let identityToken = null;

  const current = () => getRuntime();
  const getLevelIdentity = () => {
    const runtime = current();
    if (!runtime?.scene || !runtime.identity || !validRuntime(runtime) || !activeLevel(runtime)) return null;
    if (runtime.scene !== identityScene || runtime.identity !== identityComponent || !sameLevelId(runtime.levelId, identityLevelId)) {
      identityScene = runtime.scene;
      identityComponent = runtime.identity;
      identityLevelId = Array.isArray(runtime.levelId) ? [...runtime.levelId] : runtime.levelId;
      identityToken = {};
    }
    return identityToken;
  };

  function getGameContext(snapshot) {
    const runtime = current();
    if (snapshot && !isCurrent(snapshot)) return null;
    if (!runtime?.scene || !runtime.identity || !validRuntime(runtime) || !activeLevel(runtime)) return null;
    const source = snapshot?.levelId ?? runtime.levelId;
    const levelIds = (Array.isArray(source) ? source : [source])
      .filter((value) => value !== null && value !== undefined)
      .map(String)
      .filter((value) => value.length > 0);
    if (levelIds.length === 0) return null;
    return { gameId: "pvzge", levelIds, locale: "zh-CN" };
  }

  function hasEnded() {
    return getLevelIdentity() === null;
  }

  function isEligible() {
    const runtime = current();
    if (!runtime?.cc || !validRuntime(runtime)) return false;
    const { cc, level, ui, keys, npc } = runtime;
    if (!runtime.gaming || !ui.sceneEnabled || ui.paused || runtime.superSlowed) return false;
    if (!keys?.isInGame || cc.game?.isPaused?.() || cc.director?.isPaused?.() || !(cc.director?.gameSpeed > 0)) return false;
    if (ui.exitNextTick || ui.restartNextTick || ui._exitDealt || level._cannonVic) return false;
    if (level.isIntroNarrating || level.isOutroNarrating || npc?.HasFlow?.() || level.viewingLawn) return false;
    if (level.isSeedChooserMode?.() || level.carddeck_displayer_isActive?.() || activeObjective(level)) return false;
    if (ui.index !== -1 || ui.mouseDown || ACTIVE_INSTRUCTIONS.some((name) => level[name] || ui[name])) return false;
    return true;
  }

  function preflight() {
    const runtime = current();
    if (!runtime || !isEligible()) return null;
    const { square } = runtime;
    if (typeof square?.getSquareWorldPosition !== "function") return null;
    const positions = [2, 3, 4, 5, 6].map((column) => square.getSquareWorldPosition(2, column));
    if (!validRewardResources(runtime, positions)) return null;
    const levelId = Array.isArray(runtime.levelId) ? [...runtime.levelId] : runtime.levelId;
    return { scene: runtime.scene, identity: runtime.identity, levelId, level: runtime.level, ui: runtime.ui, positions };
  }

  function isCurrent(snapshot) {
    const runtime = current();
    return Boolean(
      snapshot && validRuntime(runtime) &&
      runtime.scene === snapshot.scene && runtime.identity === snapshot.identity &&
      sameLevelId(runtime.levelId, snapshot.levelId) &&
      runtime.level === snapshot.level && runtime.ui === snapshot.ui,
    );
  }

  async function pauseForQuiz(snapshot) {
    const runtime = current();
    if (!isCurrent(snapshot) || !isEligible() || runtime.ui.paused || typeof runtime.ui.pauseMenu !== "function") return false;
    runtime.ui.pauseMenu();
    for (let frame = 0; frame < 12; frame += 1) {
      if (!isCurrent(snapshot)) break;
      const latest = current();
      if (latest.ui.paused) ownedPauses.add(snapshot);
      if (latest.ui.paused && latest.cc?.director?.gameSpeed === 0) {
        acquiredPauses.add(snapshot);
        return true;
      }
      await nextFrame();
    }
    try {
      releasePause(snapshot);
    } catch (error) {
      log.error("[quiz] Failed to release an unconfirmed quiz pause", error);
    }
    return false;
  }

  function releasePause(snapshot) {
    if (!snapshot || !ownedPauses.has(snapshot)) return;
    ownedPauses.delete(snapshot);
    if (!snapshot.ui?.paused || !isCurrent(snapshot)) return;
    snapshot.ui.pauseMenu();
  }

  function isQuizActive(snapshot) {
    if (!snapshot || !ownedPauses.has(snapshot) || !isCurrent(snapshot)) return false;
    const runtime = current();
    const { level, ui } = runtime;
    return Boolean(runtime.gaming && ui.paused && !level._cannonVic &&
      !ui.exitNextTick && !ui.restartNextTick && !ui._exitDealt);
  }

  function award(snapshot, attemptId) {
    if (!snapshot || typeof attemptId !== "string" || attemptId.length === 0 ||
      attempted.has(attemptId) || !acquiredPauses.has(snapshot)) return;
    if (!isCurrent(snapshot)) return;
    const runtime = current();
    if (!runtime.gaming || runtime.ui.paused || runtime.cc?.game?.isPaused?.() ||
      runtime.cc?.director?.isPaused?.() || !runtime.ui.sceneEnabled || runtime.superSlowed) return;
    if (runtime.level._cannonVic || runtime.ui.exitNextTick || runtime.ui.restartNextTick || runtime.ui._exitDealt) return;
    if (!validRewardResources(runtime, snapshot.positions)) return;
    attempted.add(attemptId);
    for (const position of snapshot.positions) {
      runtime.sunflower.produceSun(50, position, 40, false, false, false);
    }
  }

  return { getLevelIdentity, getGameContext, hasEnded, isEligible, preflight, isCurrent,
    isQuizActive, pauseForQuiz, releasePause, award };
}
