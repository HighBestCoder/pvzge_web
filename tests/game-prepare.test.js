import { afterEach, describe, expect, test } from "bun:test";

import { configureApiAuth } from "../docs/learning/api-client.js";
import { PickerRedirectError, prepareGameContext } from "../docs/learning/game-prepare.js";
import { PLAY_SELECTION_KEY } from "../docs/learning/play-selection.js";

class MemoryStorage {
  constructor(selection) { this.values = new Map([[PLAY_SELECTION_KEY, JSON.stringify(selection)]]); }
  getItem(key) { return this.values.get(key) ?? null; }
  removeItem(key) { this.values.delete(key); }
}

const selection = {
  token: "child-token",
  account: { id: 3 },
  save: { id: 7, name: "花园", childId: 2, child: { id: 2, name: "小明", grade: 3 } },
};

afterEach(() => configureApiAuth(null));

describe("game preparation", () => {
  test("uses authoritative context before loading game state", async () => {
    const paths = [];
    const prepared = await prepareGameContext({ search: "?saveId=7", storage: new MemoryStorage(selection),
      request: async (path) => {
        paths.push(path);
        if (path === "/api/play/context") return {
          account: { id: 3 },
          save: { ...selection.save, name: "服务器花园" },
        };
        return { revision: 0, values: { PvZ2_PlayerProperties: null, PvZ2_Settings: null } };
      } });

    expect(paths).toEqual(["/api/play/context", "/api/saves/7/game-state"]);
    expect(prepared.save.name).toBe("服务器花园");
  });

  test("clears the selection and redirects on save mismatch", async () => {
    const storage = new MemoryStorage(selection);
    await expect(prepareGameContext({ search: "?saveId=8", storage,
      request: async () => { throw new Error("must not request"); } })).rejects.toBeInstanceOf(PickerRedirectError);
    expect(storage.getItem(PLAY_SELECTION_KEY)).toBeNull();
  });

  test("keeps the selection when context loading has a network failure", async () => {
    const storage = new MemoryStorage(selection);
    await expect(prepareGameContext({ search: "?saveId=7", storage,
      request: async () => { throw new TypeError("offline"); } })).rejects.toThrow("offline");
    expect(storage.getItem(PLAY_SELECTION_KEY)).not.toBeNull();
  });

  test("keeps demo mode local and does not call the API", async () => {
    const prepared = await prepareGameContext({ search: "?demo=1", storage: new MemoryStorage(selection),
      request: async () => { throw new Error("must not request"); } });
    expect(prepared).toEqual({ demo: true, saveId: 1 });
  });
});
