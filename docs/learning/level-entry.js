function copyLevelObjects(value) {
  return Array.isArray(value) ? value.map((entry) => Array.isArray(entry) ? [...entry] : entry) : value;
}

function restoreLevelState(levelPlay, snapshot) {
  levelPlay.thisLevelsID = Array.isArray(snapshot.thisLevelsID) ? [...snapshot.thisLevelsID] : snapshot.thisLevelsID;
  levelPlay.nextLevelsID = Array.isArray(snapshot.nextLevelsID) ? [...snapshot.nextLevelsID] : snapshot.nextLevelsID;
  levelPlay.levelData = snapshot.levelData;
  levelPlay.rhythmMusicClip = snapshot.rhythmMusicClip;
}

export function createLevelEntry({ keyListener, levelPlay, getPlayer, controller, bridge, log = console }) {
  const original = keyListener?.GoToGame;
  if (typeof original !== "function") throw new TypeError("KeyListener.GoToGame must be available");
  const customIds = new WeakMap();
  const entitlements = new WeakMap();
  let nextCustomId = 0;
  let active = null;
  let targetToken = null;
  let installed = false;
  let stopped = false;

  function target(snapshot) {
    const ids = Array.isArray(snapshot.thisLevelsID) ? snapshot.thisLevelsID : [snapshot.thisLevelsID];
    const serialized = ids.filter((value) => value !== null && value !== undefined && String(value).length > 0).map(String);
    if (serialized.length > 0) return { key: `level:${JSON.stringify(serialized)}`, levelIds: serialized,
      customLevel: false };
    const custom = snapshot.levelData;
    if (!custom || typeof custom !== "object") throw new TypeError("Custom level must provide an object identity");
    if (!customIds.has(custom)) customIds.set(custom, `custom-${++nextCustomId}`);
    const customId = customIds.get(custom);
    return { key: `custom:${customId}`, levelIds: [customId], customLevel: true };
  }

  async function transition(snapshot, destination, self) {
    const { key, levelIds, customLevel } = destination;
    const prior = snapshot.player && entitlements.get(snapshot.player);
    let result;
    if (snapshot.restart === true && prior?.key === key) {
      result = { ...prior.result, completed: true, cancelled: false };
    } else {
      result = await controller.run({ gameId: "pvzge", levelIds, locale: "zh-CN" });
      if (result.completed && snapshot.player) entitlements.set(snapshot.player, { key, result });
    }
    if (stopped || snapshot.player !== (getPlayer?.() ?? null) ||
      (!result.completed && result.reason !== "user")) return undefined;
    restoreLevelState(levelPlay, snapshot);
    const token = {};
    targetToken = token;
    const value = await Reflect.apply(original, self, snapshot.args);
    const runId = `game-${crypto.randomUUID()}`;
    bridge.watchReward({ ...snapshot.runtime, player: snapshot.player, targetLevelIds: levelIds,
      targetLevelData: snapshot.levelData, customLevel, reward: result.reward, runId,
      challenge: result.challenge,
      learningSessionId: result.learningSessionId ?? null,
      ownsTarget: () => targetToken === token })
      .catch((error) => log.error("[quiz] Reward watcher failed", error));
    return value;
  }

  function wrapped(...received) {
    if (stopped) return Promise.resolve();
    const args = [copyLevelObjects(received[0]), received[1] ?? false, ...received.slice(2)];
    const snapshot = { args, restart: args[1] === true, player: getPlayer?.() ?? null,
      thisLevelsID: Array.isArray(levelPlay.thisLevelsID) ? [...levelPlay.thisLevelsID] : levelPlay.thisLevelsID,
      nextLevelsID: Array.isArray(levelPlay.nextLevelsID) ? [...levelPlay.nextLevelsID] : levelPlay.nextLevelsID,
      levelData: levelPlay.levelData, rhythmMusicClip: levelPlay.rhythmMusicClip,
      runtime: bridge.snapshotRuntime() };
    const destination = target(snapshot);
    if (active) {
      if (active.key !== destination.key) log.warn("[quiz] Ignored a concurrent level transition", destination.key);
      return active.promise;
    }
    bridge.cancelPending();
    const entry = { key: destination.key, promise: null };
    entry.promise = transition(snapshot, destination, this).finally(() => { if (active === entry) active = null; });
    active = entry;
    return entry.promise;
  }

  function install() {
    if (!installed) { keyListener.GoToGame = wrapped; installed = true; }
    return wrapped;
  }

  function stop() {
    stopped = true;
    targetToken = null;
    bridge.cancelPending();
    controller.stop();
  }

  function suspend() {
    stopped = true;
    targetToken = null;
    bridge.cancelPending();
    controller.suspend();
  }

  return { install, stop, suspend };
}
