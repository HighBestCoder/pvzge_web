import { configureApiAuth, requestJson } from "./api-client.js";
import {
  PLAY_SELECTION_KEY,
  PlaySelectionError,
  clearMatchingPlaySelection,
  readPlaySelection,
  validatePlayContext,
} from "./play-selection.js";

export class PickerRedirectError extends Error {
  constructor(message) {
    super(message);
    this.name = "PickerRedirectError";
  }
}

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function prepareGameContext({ search, storage = sessionStorage, request = requestJson } = {}) {
  const params = new URLSearchParams(search);
  const demo = params.get("demo") === "1";
  const saveId = positiveId(params.get("saveId"));
  if (demo) { configureApiAuth(null); return { demo: true, saveId: saveId ?? 1 }; }
  if (!saveId) throw new PickerRedirectError("请选择存档后再进入游戏");

  let selection;
  try { selection = readPlaySelection(storage); }
  catch (error) {
    if (!(error instanceof PlaySelectionError)) throw error;
    storage.removeItem(PLAY_SELECTION_KEY);
    throw new PickerRedirectError("请选择存档后再进入游戏");
  }
  if (selection.save.id !== saveId) {
    clearMatchingPlaySelection(storage, selection.token);
    throw new PickerRedirectError("存档选择不匹配，请重新选择");
  }

  configureApiAuth(selection.token);
  const response = await request("/api/play/context");
  let identity;
  try { identity = validatePlayContext(selection, response, saveId); }
  catch (error) {
    if (!(error instanceof PlaySelectionError)) throw error;
    clearMatchingPlaySelection(storage, selection.token);
    throw new PickerRedirectError("存档身份不匹配，请重新选择");
  }
  const gameState = await request(`/api/saves/${saveId}/game-state`);
  return { demo: false, saveId, token: selection.token, ...identity, gameState };
}
