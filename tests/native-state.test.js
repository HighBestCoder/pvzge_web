import { describe, expect, test } from "bun:test";
import { createNativeStateSync } from "../docs/learning/native-state.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}
const serverState = { revision: 2, values: { PvZ2_PlayerProperties: "[]", PvZ2_Settings: "{\"PlayerIndex\":0}" } };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

describe("native save virtualization", () => {
  test("maps only native keys to immutable account/save scope and leaves unrelated keys untouched", async () => {
    const storage = new MemoryStorage();
    storage.setItem("other", "keep");
    storage.setItem("PvZ2_PlayerProperties", "old-unscoped");
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async () => new Response() });
    expect(storage.getItem("PvZ2_PlayerProperties")).toBe("[]");
    expect(storage.values.get("PvZ2_PlayerProperties")).toBe("old-unscoped");
    storage.setItem("PvZ2_PlayerProperties", "[{\"marker\":\"save-7\"}]");
    expect(storage.values.get("pvzge:native:3:7:PvZ2_PlayerProperties")).toContain("save-7");
    expect(storage.getItem("other")).toBe("keep");
    sync.restore();
  });

  test("sends both values with base revision and stops on CAS conflict", async () => {
    const storage = new MemoryStorage();
    const statuses = [];
    let body;
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      onStatus: (status) => statuses.push(status), setTimer: () => 1, clearTimer() {},
      fetchImpl: async (_path, options) => {
        if (options.method === "GET") return jsonResponse(serverState);
        body = JSON.parse(options.body);
        return jsonResponse({ error: { code: "REVISION_CONFLICT", message: "stale" } }, 409);
      } });
    storage.setItem("PvZ2_Settings", "{\"PlayerIndex\":1}");
    expect(await sync.flush()).toBe(false);
    expect(body.revision).toBe(2);
    expect(body.values.PvZ2_PlayerProperties).toBe("[]");
    expect(sync.conflicted).toBe(true);
    expect(statuses).toContain("conflict");
    sync.restore();
  });

  test("recovers when a successful PUT response is lost and retry observes the committed values", async () => {
    const storage = new MemoryStorage();
    const committed = { revision: 3, values: { ...serverState.values, PvZ2_Settings: "{\"PlayerIndex\":1}" } };
    let putCalls = 0;
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async (_path, options) => {
        if (options.method === "GET") return jsonResponse(committed);
        putCalls += 1;
        if (putCalls === 1) throw new TypeError("response lost after commit");
        return jsonResponse({ error: { code: "REVISION_CONFLICT", message: "stale" } }, 409);
      } });
    storage.setItem("PvZ2_Settings", committed.values.PvZ2_Settings);
    expect(await sync.flush()).toBe(true);
    expect(sync.conflicted).toBe(false);
    expect(sync.revision).toBe(3);
    expect(storage.values.has("pvzge:native:3:7:pending")).toBe(false);
    sync.restore();
  });

  test("reconciles matching pending state on reload without another PUT", () => {
    const storage = new MemoryStorage();
    const values = { PvZ2_PlayerProperties: "[{\"marker\":\"saved\"}]", PvZ2_Settings: "{\"PlayerIndex\":1}" };
    storage.setItem("pvzge:native:3:7:pending", JSON.stringify({ baseRevision: 2, values }));
    let requests = 0;
    const sync = createNativeStateSync({ accountId: 3, saveId: 7,
      serverState: { revision: 3, values }, storage, setTimer: () => 1, clearTimer() {},
      fetchImpl: async () => { requests += 1; return jsonResponse({}); } });
    expect(sync.conflicted).toBe(false);
    expect(sync.revision).toBe(3);
    expect(storage.values.has("pvzge:native:3:7:pending")).toBe(false);
    expect(requests).toBe(0);
    sync.restore();
  });

  test("keeps a true divergent reload conflict blocked", async () => {
    const storage = new MemoryStorage();
    const pendingValues = { PvZ2_PlayerProperties: "[{\"marker\":\"local\"}]", PvZ2_Settings: "{\"PlayerIndex\":1}" };
    storage.setItem("pvzge:native:3:7:pending", JSON.stringify({ baseRevision: 2, values: pendingValues }));
    const sync = createNativeStateSync({ accountId: 3, saveId: 7,
      serverState: { revision: 3, values: serverState.values }, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async () => jsonResponse({}) });
    expect(sync.conflicted).toBe(true);
    expect(await sync.flush()).toBe(false);
    expect(JSON.parse(storage.values.get("pvzge:native:3:7:pending")).values).toEqual(pendingValues);
    sync.restore();
  });

  test("rebases rather than drops a newer local write during lost-response reconciliation", async () => {
    const storage = new MemoryStorage();
    const sentValues = { ...serverState.values, PvZ2_Settings: "{\"PlayerIndex\":1}" };
    let releasePut;
    let calls = 0;
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async (_path, options) => {
        if (options.method === "GET") return jsonResponse({ revision: 3, values: sentValues });
        calls += 1;
        if (calls === 1) return new Promise((_, reject) => { releasePut = () => reject(new TypeError("response lost")); });
        const request = JSON.parse(options.body);
        return jsonResponse({ revision: request.revision + 1, values: request.values });
      } });
    storage.setItem("PvZ2_Settings", sentValues.PvZ2_Settings);
    const first = sync.flush();
    while (!releasePut) await Promise.resolve();
    storage.setItem("PvZ2_PlayerProperties", "[{\"marker\":\"newer\"}]");
    releasePut();
    expect(await first).toBe(true);
    const rebased = JSON.parse(storage.values.get("pvzge:native:3:7:pending"));
    expect(rebased.baseRevision).toBe(3);
    expect(rebased.values.PvZ2_PlayerProperties).toContain("newer");
    expect(await sync.flush()).toBe(true);
    expect(storage.values.has("pvzge:native:3:7:pending")).toBe(false);
    expect(sync.conflicted).toBe(false);
    sync.restore();
  });

  test("rejects wrong native JSON shapes without changing scoped state", () => {
    const storage = new MemoryStorage();
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async () => new Response() });
    expect(() => storage.setItem("PvZ2_PlayerProperties", "{}" )).toThrow(TypeError);
    expect(storage.getItem("PvZ2_PlayerProperties")).toBe("[]");
    sync.restore();
  });

  test("stops pending and future server writes after authorization is lost", async () => {
    const storage = new MemoryStorage();
    let requests = 0;
    const sync = createNativeStateSync({ accountId: 3, saveId: 7, serverState, storage,
      setTimer: () => 1, clearTimer() {}, fetchImpl: async () => {
        requests += 1;
        return jsonResponse({ revision: 3, values: serverState.values });
      } });
    storage.setItem("PvZ2_Settings", "{\"PlayerIndex\":1}");
    sync.stop();

    expect(await sync.flush()).toBe(false);
    expect(requests).toBe(0);
    sync.restore();
  });
});
