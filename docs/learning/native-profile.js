const PLAYER_KEY = "PvZ2_PlayerProperties";
const SETTINGS_KEY = "PvZ2_Settings";
const CANVAS_PATH = "Canvas";
const SELECTOR_PATH = "Canvas/PlayerSelectorButton";

function readNativeState(storage) {
  const storedProfiles = JSON.parse(storage.getItem(PLAYER_KEY));
  const profiles = storedProfiles ?? [];
  const settings = JSON.parse(storage.getItem(SETTINGS_KEY));
  if (!Array.isArray(profiles)) throw new TypeError("Invalid native player profiles");
  if (settings !== null && (typeof settings !== "object" || Array.isArray(settings))) {
    throw new TypeError("Invalid native settings");
  }
  const playerIndex = settings?.PlayerIndex;
  const selectedIndex = Number.isSafeInteger(playerIndex) && playerIndex >= 0 && playerIndex < profiles.length
    ? playerIndex : 0;
  return { profiles, settings, selectedIndex, normalized: settings !== null && selectedIndex !== playerIndex };
}

export function createNativeProfileBinding({ childName, storage = localStorage, player, MainScene,
  director = null, afterSceneEvent = null, findNode = null,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let installed = false;
  let interval = null;
  let originalOnLoad = null;
  let originalPlayers = null;
  let wrappedOnLoad = null;
  let wrappedPlayers = null;

  function bindProfile(nativeState) {
    if (player.allPlayers.indexOf(player.currentPlayer) !== nativeState.selectedIndex) {
      player.getPlayer.call(player, nativeState.selectedIndex);
    }
    if (player.currentPlayer.name !== childName) {
      player.currentPlayer.name = childName;
      player.savePP.call(player);
    }
  }

  function secureMenu() {
    const scene = director?.getScene?.();
    const selector = scene && findNode ? findNode(SELECTOR_PATH, scene) : null;
    if (selector) selector.active = false;
    const menu = scene && findNode ? findNode(CANVAS_PATH, scene)?.getComponent?.(MainScene) : null;
    if (menu?.playersWindow) menu.playersWindow.active = false;
    if (menu) menu.playersShown = false;
  }

  function install() {
    if (installed || typeof childName !== "string" || childName.length === 0) return;
    const nativeState = readNativeState(storage);
    if (nativeState.normalized) {
      storage.setItem(SETTINGS_KEY, JSON.stringify({ ...nativeState.settings, PlayerIndex: nativeState.selectedIndex }));
    }

    originalOnLoad = MainScene.prototype.onLoad;
    originalPlayers = MainScene.prototype.players;
    wrappedOnLoad = function (...args) {
      const result = originalOnLoad.apply(this, args);
      bindProfile(nativeState);
      if (this.playersWindow) this.playersWindow.active = false;
      this.playersShown = false;
      secureMenu();
      return result;
    };
    wrappedPlayers = function () {
      if (this.playersWindow) this.playersWindow.active = false;
      this.playersShown = false;
      return false;
    };
    MainScene.prototype.onLoad = wrappedOnLoad;
    MainScene.prototype.players = wrappedPlayers;
    installed = true;
    if (player.currentPlayer) bindProfile(nativeState);
    secureMenu();
    if (director && afterSceneEvent) director.on(afterSceneEvent, secureMenu);
    interval = setIntervalImpl(secureMenu, 250);
  }

  function stop() {
    if (!installed) return;
    if (MainScene.prototype.onLoad === wrappedOnLoad) MainScene.prototype.onLoad = originalOnLoad;
    if (MainScene.prototype.players === wrappedPlayers) MainScene.prototype.players = originalPlayers;
    if (director && afterSceneEvent) director.off(afterSceneEvent, secureMenu);
    clearIntervalImpl(interval);
    interval = null;
    installed = false;
  }

  return { install, stop };
}
