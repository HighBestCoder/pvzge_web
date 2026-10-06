import { describe, expect, test } from "bun:test";

import { handleAuthorizationFailure } from "../docs/learning/authorization-failure.js";
import { PLAY_SELECTION_KEY } from "../docs/learning/play-selection.js";

class MemoryStorage {
  constructor(selection) { this.value = JSON.stringify(selection); }
  getItem(key) { return key === PLAY_SELECTION_KEY ? this.value : null; }
  removeItem(key) { if (key === PLAY_SELECTION_KEY) this.value = null; }
}

const selection = {
  token: "new-token",
  account: { id: 3 },
  save: { id: 7, name: "花园", childId: 2, child: { id: 2, name: "小明", grade: 3 } },
};

describe("authorization failure", () => {
  test("stops game persistence and preserves a newer selection before returning to picker", () => {
    const storage = new MemoryStorage(selection);
    const calls = [];
    handleAuthorizationFailure({ token: "old-token", storage,
      entry: { stop: () => calls.push("entry") }, nativeSync: { stop: () => calls.push("sync") },
      panel: { showError: (_message, retry) => calls.push(retry) }, navigate: (path) => calls.push(path) });

    expect(calls).toEqual(["entry", "sync", false, "/"]);
    expect(storage.value).not.toBeNull();
  });
});
