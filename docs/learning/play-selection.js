export const PLAY_SELECTION_KEY = "pvz.play.selection";

export class PlaySelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaySelectionError";
  }
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseIdentity(input, source) {
  if (!input || typeof input !== "object" || !positiveId(input.account?.id)
    || !positiveId(input.save?.id) || !positiveId(input.save?.childId)
    || !positiveId(input.save?.child?.id) || input.save.child.id !== input.save.childId
    || typeof input.save.name !== "string" || typeof input.save.child.name !== "string"
    || !Number.isSafeInteger(input.save.child.grade)) {
    throw new PlaySelectionError(`Invalid ${source}`);
  }
  return { account: input.account, save: input.save };
}

export function parsePlaySelection(raw) {
  let input;
  try { input = JSON.parse(raw); }
  catch { throw new PlaySelectionError("Invalid play selection"); }
  if (!input || typeof input.token !== "string" || input.token.length === 0) {
    throw new PlaySelectionError("Invalid play selection");
  }
  const identity = parseIdentity(input, "play selection");
  return { token: input.token, ...identity };
}

export function readPlaySelection(storage = sessionStorage) {
  return parsePlaySelection(storage.getItem(PLAY_SELECTION_KEY));
}

export function validatePlayContext(selection, input, urlSaveId) {
  const context = parseIdentity(input, "play context");
  if (selection.save.id !== urlSaveId || context.save.id !== urlSaveId
    || context.account.id !== selection.account.id) {
    throw new PlaySelectionError("Play selection does not match context");
  }
  return context;
}

export function clearMatchingPlaySelection(storage, token) {
  let selection;
  try { selection = parsePlaySelection(storage.getItem(PLAY_SELECTION_KEY)); }
  catch { return false; }
  if (selection.token !== token) return false;
  storage.removeItem(PLAY_SELECTION_KEY);
  return true;
}
