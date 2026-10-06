import { requestJson } from "./api-client.js";

export function createRewardReceipts({ saveId, storage = localStorage, fetchImpl = fetch,
  id = () => crypto.randomUUID(), snapshot = () => null } = {}) {
  const prefix = `pvzge:reward-receipt:${saveId}:`;
  return {
    has(runId) { return storage.getItem(`${prefix}${runId}`) !== null; },
    async acknowledge({ grantId, runId }) {
      const key = `${prefix}${runId}`;
      if (!storage.getItem(key)) storage.setItem(key, JSON.stringify({ grantId, runId, snapshot: snapshot(), createdAt: Date.now() }));
      return requestJson(`/api/rewards/${encodeURIComponent(grantId)}/ack`, {
        method: "POST", body: { requestId: `ack-${id()}`, runId }, fetchImpl,
      });
    },
  };
}
