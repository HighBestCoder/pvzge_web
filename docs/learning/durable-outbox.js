function parseEntries(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function createDurableOutbox({ storage, key }) {
  if (!storage || typeof key !== "string" || !key) throw new TypeError("storage and key are required");
  let entries = parseEntries(storage, key);
  const persist = () => storage.setItem(key, JSON.stringify(entries));
  return {
    list: () => structuredClone(entries),
    put(id, payload, context) {
      const index = entries.findIndex((entry) => entry.id === id);
      const entry = { id, payload: structuredClone(payload),
        ...(context === undefined ? {} : { context: structuredClone(context) }) };
      if (index < 0) entries.push(entry); else entries[index] = entry;
      persist();
    },
    remove(id) { entries = entries.filter((entry) => entry.id !== id); persist(); },
  };
}
