import { requestJson } from "./api-client.js";
import { createDurableOutbox } from "./durable-outbox.js";
import { parseInputSpec, parseSession, parseSubmissionResult, parseTaskResponse } from "./provider.js";
import { parseCreateSessionRequest, parseEndSessionRequest, parseGetNextTaskRequest,
  parseSubmitAnswerRequest } from "./provider-requests.js";

function submissionMatches(result, request) {
  return ["sessionId", "taskId", "questionId", "questionVersion", "attemptId"]
    .every((key) => result[key] === request[key]);
}

function expectedArity(task) {
  return ["fraction", "pair"].includes(task.inputSpec.format) ? 2 : 1;
}

function taskContext(task, sessionId) {
  return { sessionId, taskId: task.taskId, questionId: task.questionId, questionVersion: task.questionVersion,
    kind: task.kind, ...(task.kind === "numeric_entry" ? { inputSpec: task.inputSpec }
      : { optionIds: task.options.map(({ optionId }) => optionId) }) };
}

function exactContextKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseContext(input, request) {
  if (input === undefined) {
    if (request.response.type === "entered") throw new TypeError("Queued numeric submission has no trusted task context");
    return { kind: "single_choice", legacy: true };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid queued task context");
  const identityMatches = input.sessionId === request.sessionId && input.taskId === request.taskId &&
    input.questionId === request.questionId &&
    input.questionVersion === request.questionVersion;
  if (!identityMatches) throw new TypeError("Queued submission task context identity mismatch");
  if (input.kind === "numeric_entry") {
    if (!exactContextKeys(input, ["sessionId", "taskId", "questionId", "questionVersion", "kind", "inputSpec"])) {
      throw new TypeError("Invalid queued numeric task context");
    }
    return { sessionId: input.sessionId, taskId: input.taskId, questionId: input.questionId,
      questionVersion: input.questionVersion,
      kind: input.kind, inputSpec: parseInputSpec(input.inputSpec) };
  }
  if (input.kind === "single_choice" &&
    exactContextKeys(input, ["sessionId", "taskId", "questionId", "questionVersion", "kind", "optionIds"]) &&
    Array.isArray(input.optionIds) && input.optionIds.length === 4 &&
    input.optionIds.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(input.optionIds).size === input.optionIds.length) {
    return { sessionId: input.sessionId, taskId: input.taskId, questionId: input.questionId,
      questionVersion: input.questionVersion,
      kind: input.kind, optionIds: [...input.optionIds] };
  }
  throw new TypeError("Invalid queued task context");
}

function validateSubmission(request, context) {
  if (context.kind === "single_choice") {
    if (request.response.type === "entered") throw new TypeError("Submission response kind does not match issued task");
    if (request.response.type === "answered" && !context.legacy &&
      !context.optionIds.includes(request.response.optionId)) {
      throw new TypeError("Submission option does not match issued task");
    }
    return;
  }
  if (request.response.type === "answered") throw new TypeError("Submission response kind does not match issued task");
  if (request.response.type === "entered" && request.response.values.length !== expectedArity(context)) {
    throw new TypeError("Submission response arity does not match issued task");
  }
}

export function createRemoteLearningProvider({ saveId, storage = localStorage, fetchImpl = fetch } = {}) {
  if (!Number.isSafeInteger(saveId) || saveId < 1) throw new TypeError("saveId must be a positive integer");
  const outbox = createDurableOutbox({ storage, key: `pvzge:learning-submissions:${saveId}` });
  const post = (path, body, signal) => requestJson(path, { method: "POST", body, signal, fetchImpl });
  const issuedTasks = new Map();

  async function sendSubmission(request, context, signal) {
    validateSubmission(request, context);
    const result = parseSubmissionResult(await post("/api/learning/submit-answer", request, signal), context.kind);
    if (!submissionMatches(result, request)) throw new Error("Submission result identity mismatch");
    outbox.remove(request.attemptId);
    return result;
  }

  async function flush(signal) {
    for (const entry of outbox.list()) {
      const request = parseSubmitAnswerRequest(entry.payload);
      await sendSubmission(request, parseContext(entry.context, request), signal);
    }
  }

  return {
    async createSession(input, { signal } = {}) {
      await flush(signal);
      const request = parseCreateSessionRequest({ ...input, saveId });
      const result = parseSession(await post("/api/learning/create-session", request, signal));
      if (result.saveId !== saveId) throw new Error("Learning session save mismatch");
      return result;
    },
    async getNextTask(input, { signal } = {}) {
      await flush(signal);
      const request = parseGetNextTaskRequest(input);
      const result = parseTaskResponse(await post("/api/learning/get-next-task", request, signal));
      if (result.status === "task") issuedTasks.set(`${request.sessionId}:${result.task.taskId}`, result.task);
      return result;
    },
    async submitAnswer(input, { signal } = {}) {
      const request = parseSubmitAnswerRequest(input);
      const task = issuedTasks.get(`${request.sessionId}:${request.taskId}`);
      if (!task) throw new TypeError("Submission does not match an issued task");
      const context = taskContext(task, request.sessionId);
      validateSubmission(request, context);
      outbox.put(request.attemptId, request, context);
      return sendSubmission(request, context, signal);
    },
    async endSession(input, { signal } = {}) {
      await flush(signal);
      return post("/api/learning/end-session", parseEndSessionRequest(input), signal);
    },
  };
}
