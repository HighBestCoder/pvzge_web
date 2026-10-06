const IDS = {
  cards: "chunks:///_virtual/Cards.ts",
  level: "chunks:///_virtual/levelController.ts",
};

export function readNativeStartRuntime(system = globalThis.System) {
  if (!system?.get || !system?.resolve) return null;
  try {
    const levelClass = system.get(system.resolve(IDS.level))?.LevelPlay;
    return {
      levelClass,
      level: levelClass?.component,
      cards: system.get(system.resolve(IDS.cards))?.Cards?.component,
    };
  } catch {
    return null;
  }
}

function isReady(runtime, ownedNode) {
  const { cards, level, levelClass } = runtime ?? {};
  const nativeNode = cards?.gameStartButton?.node;
  return Boolean(level && nativeNode && (nativeNode.activeInHierarchy || nativeNode === ownedNode) &&
    levelClass?.chooseCardMode === true && levelClass.letsRocked !== true &&
    level.gameStarted !== true && cards.GameStartable?.() === true &&
    typeof level.letsRock === "function");
}

export function createNativeStart({
  root = document,
  readRuntime = readNativeStartRuntime,
  every = globalThis.setInterval,
  clearEvery = globalThis.clearInterval,
  intervalMs = 100,
} = {}) {
  let timer = null;
  let completedLevel = null;
  let pendingLevel = null;
  let nativeNode = null;
  let generation = 0;

  function restoreNativeNode() {
    if (nativeNode) nativeNode.active = true;
    nativeNode = null;
  }

  async function render() {
    const runtime = readRuntime();
    const level = runtime?.level ?? null;
    if (completedLevel && level !== completedLevel) completedLevel = null;
    if (root.getElementById("addition-quiz")?.open === true || !level ||
      completedLevel === level || pendingLevel) {
      if (!pendingLevel) restoreNativeNode();
      return;
    }
    if (!isReady(runtime, nativeNode)) { restoreNativeNode(); return; }

    const attempt = generation;
    pendingLevel = level;
    nativeNode = runtime.cards.gameStartButton.node;
    nativeNode.active = false;
    try {
      await runtime.level.letsRock();
      if (generation === attempt) {
        const current = readRuntime();
        const exited = current?.level === level && (level.gameStarted === true ||
          current.levelClass?.letsRocked === true || current.levelClass?.chooseCardMode !== true ||
          current.cards?.GameStartable?.() !== true);
        if (exited) {
          completedLevel = level;
          nativeNode = null;
        } else {
          restoreNativeNode();
        }
      }
    } catch {
      if (generation === attempt) restoreNativeNode();
    } finally {
      if (generation === attempt) pendingLevel = null;
    }
  }

  function install() {
    if (timer !== null) return;
    generation += 1;
    void render();
    timer = every(() => { void render(); }, intervalMs);
  }

  function stop() {
    generation += 1;
    if (timer !== null) clearEvery(timer);
    timer = null;
    completedLevel = null;
    pendingLevel = null;
    restoreNativeNode();
  }

  return { install, render, stop };
}
