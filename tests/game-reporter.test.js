import { describe, expect, test } from "bun:test";
import { createGameReporter } from "../docs/learning/game-reporter.js";
import { createRewardReceipts } from "../docs/learning/reward-receipts.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("game persistence", () => {
  test("durably reports save/session-bound outcomes with stable queued payload", async () => {
    const storage = new MemoryStorage();
    let online = false;
    const calls = [];
    const reporter = createGameReporter({ saveId: 4, storage, id: () => "event",
      log: { error() {} }, fetchImpl: async (_path, options) => {
        calls.push(JSON.parse(options.body));
        if (!online) throw new TypeError("offline");
        return json({ outcome: "started" });
      } });
    await reporter.report({ runId: "run-1", learningSessionId: "learning-1", levelIds: ["1-1"], outcome: "started" });
    const pending = JSON.parse(storage.getItem("pvzge:game-events:4"))[0].payload;
    expect(pending).toMatchObject({ requestId: "run-event", saveId: 4, runId: "run-1",
      learningSessionId: "learning-1", outcome: "started" });
    online = true;
    await reporter.flush();
    expect(calls.at(-1)).toEqual(pending);
    expect(storage.getItem("pvzge:game-events:4")).toBe("[]");
  });

  test("writes a per-run receipt and native snapshot before server acknowledgement", async () => {
    const storage = new MemoryStorage();
    let receiptAtRequest = null;
    const receipts = createRewardReceipts({ saveId: 4, storage, id: () => "1",
      snapshot: () => ({ PvZ2_PlayerProperties: "[]" }),
      fetchImpl: async (_path, options) => {
        receiptAtRequest = storage.getItem("pvzge:reward-receipt:4:run-1");
        expect(JSON.parse(options.body)).toEqual({ requestId: "ack-1", runId: "run-1" });
        return json({ grantId: "grant-1", runId: "run-1", applied: true, appliedAt: "now" });
      } });
    await receipts.acknowledge({ grantId: "grant-1", runId: "run-1" });
    expect(JSON.parse(receiptAtRequest).snapshot.PvZ2_PlayerProperties).toBe("[]");
    expect(receipts.has("run-1")).toBe(true);
  });
});
