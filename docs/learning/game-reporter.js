import { requestJson } from "./api-client.js";
import { createDurableOutbox } from "./durable-outbox.js";

const OUTCOMES = ["started", "won", "lost", "abandoned"];

export function createGameReporter({ saveId, storage = localStorage, fetchImpl = fetch,
  id = () => crypto.randomUUID(), log = console } = {}) {
  if (!Number.isSafeInteger(saveId) || saveId < 1) throw new TypeError("saveId must be a positive integer");
  const outbox = createDurableOutbox({ storage, key: `pvzge:game-events:${saveId}` });
  let chain = Promise.resolve();

  async function send(entry, keepalive = false) {
    await requestJson("/api/game-runs", { method: "POST", body: entry.payload, fetchImpl, keepalive });
    outbox.remove(entry.id);
  }
  function flush(keepalive = false) {
    chain = chain.then(async () => {
      for (const entry of outbox.list()) await send(entry, keepalive);
    }).catch((error) => log.error("[quiz] Failed to report game outcome", error));
    return chain;
  }
  function report({ runId, learningSessionId = null, levelIds, outcome }) {
    if (!OUTCOMES.includes(outcome)) throw new TypeError("Invalid game outcome");
    const requestId = `run-${id()}`;
    const payload = { requestId, saveId, learningSessionId, levelIds: levelIds.map(String), outcome, runId };
    outbox.put(requestId, payload);
    return flush();
  }
  function start(input) { const runId = `game-${id()}`; report({ ...input, runId, outcome: "started" }); return runId; }
  function pagehide() {
    flush(true);
  }
  flush();
  return { start, report, flush, pagehide };
}
