import { describe, expect, test } from "bun:test";

import { createNativeProfileBinding } from "../docs/learning/native-profile.js";

class MemoryStorage {
  constructor(values) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
}

function fixture({ playerIndex = 1, childName = "小明" } = {}) {
  const profiles = [
    { name: "旧一号", coins: 11, levels: [{ id: "1-1", progress: 4 }] },
    { name: "旧二号", coins: 99, levels: [{ id: "2-4", progress: 3 }] },
  ];
  const storage = new MemoryStorage({
    PvZ2_PlayerProperties: JSON.stringify(profiles),
    PvZ2_Settings: JSON.stringify({ PlayerIndex: playerIndex, MusicVolume: 0.4 }),
  });
  const calls = { getPlayer: [], savePP: 0, originalPlayers: 0, play: 0 };
  const player = {
    allPlayers: profiles,
    currentPlayer: profiles[playerIndex],
    getPlayer(index) { calls.getPlayer.push({ index, receiver: this }); this.currentPlayer = this.allPlayers[index]; },
    savePP() { calls.savePP += 1; storage.setItem("PvZ2_PlayerProperties", JSON.stringify(this.allPlayers)); },
  };
  class MainScene {
    onLoad() { this.version = "native"; }
    players() { calls.originalPlayers += 1; return "opened"; }
    play() { calls.play += 1; }
  }
  const selector = { active: true };
  const menu = new MainScene();
  menu.playersWindow = { active: true };
  menu.playersShown = true;
  const canvas = { getComponent: (type) => type === MainScene ? menu : null };
  const scene = {};
  const director = {
    on() {}, off() {}, getScene: () => scene,
  };
  const binding = createNativeProfileBinding({ childName, storage, player, MainScene,
    director, afterSceneEvent: "after-scene", setIntervalImpl: () => 7, clearIntervalImpl() {},
    findNode: (path, root) => root === scene && path === "Canvas/PlayerSelectorButton" ? selector
      : root === scene && path === "Canvas" ? canvas : null });
  return { binding, calls, director, MainScene, menu, player, profiles, selector, storage };
}

describe("native child identity", () => {
  test("preserves the selected profile and renames only that profile after native onLoad", () => {
    // Given
    const { binding, calls, MainScene, profiles, storage } = fixture();
    const firstBefore = structuredClone(profiles[0]);
    const selectedProgress = structuredClone(profiles[1].levels);

    // When
    binding.install();
    expect(profiles[1].name).toBe("小明");
    expect(calls.savePP).toBe(1);
    const menu = new MainScene();
    menu.onLoad();

    // Then
    expect(JSON.parse(storage.getItem("PvZ2_Settings"))).toEqual({ PlayerIndex: 1, MusicVolume: 0.4 });
    expect(profiles[0]).toEqual(firstBefore);
    expect(profiles[1]).toEqual({ name: "小明", coins: 99, levels: selectedProgress });
    expect(calls.getPlayer).toEqual([]);
    expect(calls.savePP).toBe(1);
  });

  test("normalizes an invalid index to zero without creating or deleting profiles", () => {
    // Given
    const { binding, calls, MainScene, player, profiles, storage } = fixture({ playerIndex: 8 });
    player.currentPlayer = profiles[1];

    // When
    binding.install();
    new MainScene().onLoad();

    // Then
    expect(JSON.parse(storage.getItem("PvZ2_Settings"))).toEqual({ PlayerIndex: 0, MusicVolume: 0.4 });
    expect(profiles).toHaveLength(2);
    expect(calls.getPlayer.map(({ index }) => index)).toEqual([0]);
    expect(player.currentPlayer).toBe(profiles[0]);
  });

  test("leaves first-profile creation to native onLoad for a new realm", () => {
    // Given
    const storage = new MemoryStorage({ PvZ2_PlayerProperties: null, PvZ2_Settings: null });
    const profiles = [];
    const player = {
      allPlayers: profiles,
      currentPlayer: null,
      getPlayer(index) { profiles.push({ name: "New Player", coins: 0 }); this.currentPlayer = profiles[index]; },
      savePP() { storage.setItem("PvZ2_PlayerProperties", JSON.stringify(profiles)); },
    };
    class MainScene {
      onLoad() { player.getPlayer(0); }
      players() {}
    }
    const binding = createNativeProfileBinding({ childName: "小明", storage, player, MainScene,
      setIntervalImpl: () => 1, clearIntervalImpl() {} });

    // When
    binding.install();
    expect(storage.getItem("PvZ2_Settings")).toBeNull();
    new MainScene().onLoad();

    // Then
    expect(profiles).toEqual([{ name: "小明", coins: 0 }]);
    expect(storage.getItem("PvZ2_Settings")).toBeNull();
  });

  test("blocks only the profile chooser and restores owned hooks on stop", () => {
    // Given
    const { binding, calls, menu, selector } = fixture();

    // When
    binding.install();
    const blocked = menu.players();
    menu.play();

    // Then
    expect(blocked).toBe(false);
    expect(menu.playersWindow.active).toBe(false);
    expect(menu.playersShown).toBe(false);
    expect(selector.active).toBe(false);
    expect(calls.originalPlayers).toBe(0);
    expect(calls.play).toBe(1);

    // When
    binding.stop();

    // Then
    expect(menu.players()).toBe("opened");
    expect(calls.originalPlayers).toBe(1);
  });

  test("does nothing when no authoritative child name is provided", () => {
    // Given
    const { calls, MainScene, player, profiles, storage } = fixture();
    const originalOnLoad = MainScene.prototype.onLoad;
    const binding = createNativeProfileBinding({ childName: null, storage, player, MainScene });

    // When
    binding.install();

    // Then
    expect(MainScene.prototype.onLoad).toBe(originalOnLoad);
    expect(profiles[1].name).toBe("旧二号");
    expect(calls.savePP).toBe(0);
  });

  test("propagates malformed scoped settings instead of replacing native state", () => {
    // Given
    const { MainScene, player, profiles } = fixture();
    const storage = new MemoryStorage({
      PvZ2_PlayerProperties: JSON.stringify(profiles),
      PvZ2_Settings: "not-json",
    });
    const binding = createNativeProfileBinding({ childName: "小明", storage, player, MainScene });

    // When / Then
    expect(() => binding.install()).toThrow(SyntaxError);
    expect(storage.getItem("PvZ2_Settings")).toBe("not-json");
  });
});
