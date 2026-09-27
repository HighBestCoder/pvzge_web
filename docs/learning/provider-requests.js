import { LearningProviderError } from "./provider.js";

const END_REASONS = ["game_ended", "replaced", "stopped", "abandoned"];
const CANCEL_REASONS = ["scene_changed", "hidden", "stopped", "superseded"];

function invalid(path, expectation) {
  throw new LearningProviderError("INVALID_REQUEST", `${path} ${expectation}`);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be an object");
  return value;
}

function exactKeys(value, keys, path) {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`${path}.${unknown}`, "is not supported");
}

function literal(value, expected, path) {
  if (value !== expected) invalid(path, `must be ${JSON.stringify(expected)}`);
  return value;
}

function oneOf(value, values, path) {
  if (!values.includes(value)) invalid(path, `must be one of: ${values.join(", ")}`);
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || value.length === 0) invalid(path, "must be a non-empty string");
  return value;
}

function elapsed(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid("response.elapsedMs", "must be a safe integer >= 0");
  return value;
}

function positiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(path, "must be a positive safe integer");
  return value;
}

function base(input, keys) {
  const value = object(input, "request");
  exactKeys(value, ["schemaVersion", ...keys], "request");
  return { value, schemaVersion: literal(value.schemaVersion, 1, "schemaVersion") };
}

export function parseCreateSessionRequest(input) {
  const { value, schemaVersion } = base(input, ["requestId", "gameSessionId", "gameContext"]);
  const context = object(value.gameContext, "gameContext");
  exactKeys(context, ["gameId", "levelIds", "locale"], "gameContext");
  if (!Array.isArray(context.levelIds)) invalid("gameContext.levelIds", "must be an array");
  return {
    schemaVersion,
    requestId: string(value.requestId, "requestId"),
    gameSessionId: string(value.gameSessionId, "gameSessionId"),
    gameContext: {
      gameId: literal(context.gameId, "pvzge", "gameContext.gameId"),
      levelIds: context.levelIds.map((item, index) => string(item, `gameContext.levelIds[${index}]`)),
      locale: literal(context.locale, "zh-CN", "gameContext.locale"),
    },
  };
}

export function parseGetNextTaskRequest(input) {
  const { value, schemaVersion } = base(input, ["requestId", "sessionId"]);
  return { schemaVersion, requestId: string(value.requestId, "requestId"), sessionId: string(value.sessionId, "sessionId") };
}

export function parseEndSessionRequest(input) {
  const { value, schemaVersion } = base(input, ["requestId", "sessionId", "reason"]);
  return {
    schemaVersion,
    requestId: string(value.requestId, "requestId"),
    sessionId: string(value.sessionId, "sessionId"),
    reason: oneOf(value.reason, END_REASONS, "reason"),
  };
}

export function parseSubmitAnswerRequest(input) {
  const { value, schemaVersion } = base(input, ["sessionId", "taskId", "questionId", "questionVersion", "attemptId", "response"]);
  const response = object(value.response, "response");
  const type = oneOf(response.type, ["answered", "timed_out", "skipped", "cancelled"], "response.type");
  const keys = type === "answered" ? ["type", "optionId", "elapsedMs"] : type === "cancelled"
    ? ["type", "reason", "elapsedMs"] : ["type", "elapsedMs"];
  exactKeys(response, keys, "response");
  const parsedResponse = { type };
  if (type === "answered") parsedResponse.optionId = string(response.optionId, "response.optionId");
  if (type === "cancelled") parsedResponse.reason = oneOf(response.reason, CANCEL_REASONS, "response.reason");
  parsedResponse.elapsedMs = elapsed(response.elapsedMs);
  return {
    schemaVersion,
    sessionId: string(value.sessionId, "sessionId"),
    taskId: string(value.taskId, "taskId"),
    questionId: string(value.questionId, "questionId"),
    questionVersion: positiveSafeInteger(value.questionVersion, "questionVersion"),
    attemptId: string(value.attemptId, "attemptId"),
    response: parsedResponse,
  };
}
