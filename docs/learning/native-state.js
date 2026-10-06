import { requestJson } from "./api-client.js";

export const NATIVE_KEYS = ["PvZ2_PlayerProperties", "PvZ2_Settings"];

function validNativeValue(key, value) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    return key === NATIVE_KEYS[0] ? Array.isArray(parsed) : Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch { return false; }
}

function readPending(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return value && Number.isSafeInteger(value.baseRevision) && value.values ? value : null;
  } catch { return null; }
}

function sameValues(left, right) {
  return NATIVE_KEYS.every((key) => left?.[key] === right?.[key]);
}

export function validateGameState(input) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0 || !input.values) {
    throw new TypeError("Invalid game-state response");
  }
  for (const key of NATIVE_KEYS) {
    if (!validNativeValue(key, input.values[key])) throw new TypeError(`Invalid ${key} game-state value`);
  }
  return { revision: input.revision, values: Object.fromEntries(NATIVE_KEYS.map((key) => [key, input.values[key]])) };
}

export function createNativeStateSync({ accountId, saveId, serverState, storage = localStorage,
  fetchImpl = fetch, debounceMs = 250, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (![accountId, saveId].every((value) => Number.isSafeInteger(value) && value > 0)) throw new TypeError("accountId/saveId required");
  const state = validateGameState(serverState);
  const prefix = `pvzge:native:${accountId}:${saveId}:`;
  const pendingKey = `${prefix}pending`;
  const proto = Object.getPrototypeOf(storage);
  const native = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
  const rawGet = (key) => native.getItem.call(storage, key);
  const rawSet = (key, value) => native.setItem.call(storage, key, value);
  const rawRemove = (key) => native.removeItem.call(storage, key);
  const scoped = (key) => `${prefix}${key}`;
  let revision = state.revision;
  let pending = readPending({ getItem: rawGet }, pendingKey);
  let pendingVersion = 0;
  let timer = null;
  let conflict = false;
  let stopped = false;

  function values() { return Object.fromEntries(NATIVE_KEYS.map((key) => [key, rawGet(scoped(key))])); }
  function persistPending() {
    pending = { baseRevision: revision, values: values() };
    pendingVersion += 1;
    rawSet(pendingKey, JSON.stringify(pending));
    onStatus("pending");
  }
  async function flush() {
    if (!pending || conflict || stopped) return false;
    const snapshot = structuredClone(pending);
    const sentVersion = pendingVersion;
    const acceptCommitted = (result) => {
      if (stopped) return false;
      revision = result.revision;
      if (pendingVersion === sentVersion) {
        pending = null; rawRemove(pendingKey); onStatus("synced");
      } else if (pending) {
        pending.baseRevision = revision; rawSet(pendingKey, JSON.stringify(pending)); schedule();
      }
      return true;
    };
    const reconcile = async () => {
      const latest = validateGameState(await requestJson(`/api/saves/${saveId}/game-state`, { fetchImpl }));
      return sameValues(latest.values, snapshot.values) ? acceptCommitted(latest) : false;
    };
    try {
      const result = validateGameState(await requestJson(`/api/saves/${saveId}/game-state`, {
        method: "PUT", body: { revision: snapshot.baseRevision, values: snapshot.values }, fetchImpl,
      }));
      return acceptCommitted(result);
    } catch (error) {
      if (stopped) return false;
      if (error?.code === "REVISION_CONFLICT") {
        try {
          if (await reconcile()) return true;
          conflict = true; onStatus("conflict", error);
        } catch (reconcileError) { onStatus("error", reconcileError); schedule(); }
      } else {
        try { if (await reconcile()) return true; }
        catch {}
        onStatus("error", error); schedule();
      }
      return false;
    }
  }
  function schedule() { if (!conflict && !stopped) { clearTimer(timer); timer = setTimer(() => { timer = null; flush(); }, debounceMs); } }
  function changed() { persistPending(); schedule(); }

  if (pending) {
    if (NATIVE_KEYS.some((key) => !validNativeValue(key, pending.values[key]))) {
      conflict = true; onStatus("conflict");
    } else if (pending.baseRevision !== revision && sameValues(pending.values, state.values)) {
      pending = null; rawRemove(pendingKey);
      for (const key of NATIVE_KEYS) state.values[key] === null ? rawRemove(scoped(key)) : rawSet(scoped(key), state.values[key]);
      onStatus("synced");
    } else if (pending.baseRevision !== revision) {
      conflict = true; onStatus("conflict");
    } else {
      for (const key of NATIVE_KEYS) pending.values[key] === null ? rawRemove(scoped(key)) : rawSet(scoped(key), pending.values[key]);
      onStatus("recovered"); schedule();
    }
  } else {
    for (const key of NATIVE_KEYS) state.values[key] === null ? rawRemove(scoped(key)) : rawSet(scoped(key), state.values[key]);
    onStatus("synced");
  }

  proto.getItem = function (key) {
    return this === storage && NATIVE_KEYS.includes(String(key)) ? rawGet(scoped(String(key))) : native.getItem.call(this, key);
  };
  proto.setItem = function (key, value) {
    if (this !== storage || !NATIVE_KEYS.includes(String(key))) return native.setItem.call(this, key, value);
    const normalized = String(value);
    if (!validNativeValue(String(key), normalized)) throw new TypeError(`Invalid native JSON for ${key}`);
    rawSet(scoped(String(key)), normalized); changed();
  };
  proto.removeItem = function (key) {
    if (this !== storage || !NATIVE_KEYS.includes(String(key))) return native.removeItem.call(this, key);
    rawRemove(scoped(String(key))); changed();
  };

  return {
    flush, values, get revision() { return revision; }, get conflicted() { return conflict; },
    stop() { stopped = true; clearTimer(timer); timer = null; },
    restore() { clearTimer(timer); proto.getItem = native.getItem; proto.setItem = native.setItem; proto.removeItem = native.removeItem; },
  };
}
