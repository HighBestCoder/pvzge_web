import { describe, expect, test } from "bun:test";

import {
  PLAY_SELECTION_KEY,
  clearMatchingPlaySelection,
  parsePlaySelection,
  validatePlayContext,
} from "../docs/learning/play-selection.js";

class MemoryStorage {
  constructor(value = null) { this.value = value; }
  getItem(key) { return key === PLAY_SELECTION_KEY ? this.value : null; }
  setItem(key, value) { if (key === PLAY_SELECTION_KEY) this.value = String(value); }
  removeItem(key) { if (key === PLAY_SELECTION_KEY) this.value = null; }
}

const selection = {
  token: "child-token",
  account: { id: 3 },
  save: { id: 7, name: "花园", childId: 2, child: { id: 2, name: "小明", grade: 3 } },
};

describe("play selection", () => {
  test("parses the picker handoff and validates authoritative matching context", () => {
    const parsed = parsePlaySelection(JSON.stringify(selection));
    const context = validatePlayContext(parsed, {
      account: { id: 3 },
      save: { id: 7, name: "新名称", childId: 2, child: { id: 2, name: "小明", grade: 3 } },
    }, 7);

    expect(context.save.name).toBe("新名称");
    expect(context.account.id).toBe(3);
  });

  test("rejects a URL save or owner account mismatch", () => {
    const parsed = parsePlaySelection(JSON.stringify(selection));
    expect(() => validatePlayContext(parsed, { ...selection, token: undefined }, 8)).toThrow();
    expect(() => validatePlayContext(parsed, {
      account: { id: 4 }, save: selection.save,
    }, 7)).toThrow();
  });

  test("clears only the selection belonging to the failed token", () => {
    const storage = new MemoryStorage(JSON.stringify(selection));
    expect(clearMatchingPlaySelection(storage, "old-token")).toBe(false);
    expect(storage.value).not.toBeNull();
    expect(clearMatchingPlaySelection(storage, "child-token")).toBe(true);
    expect(storage.value).toBeNull();
  });
});
