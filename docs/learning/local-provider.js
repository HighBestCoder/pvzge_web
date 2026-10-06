import { createAdditionQuestion } from "./question.js";
import { LearningProviderError, parseSession, parseSubmissionResult, parseTaskResponse } from "./provider.js";
import {
  parseCreateSessionRequest,
  parseEndSessionRequest,
  parseGetNextTaskRequest,
  parseSubmitAnswerRequest,
} from "./provider-requests.js";

const PLAN = {
  planId: "local-addition-v1",
  title: "百以内加法",
  subjectId: "math",
  skillIds: ["addition-within-100"],
};
const QUESTION_COUNT = 10;

function clone(value) {
  return structuredClone(value);
}

function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(code, message) {
  throw new LearningProviderError(code, message);
}

function checkSignal(signal) {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

export function createLocalLearningProvider({
  learnerRef = "demo-learner",
  random = Math.random,
  id = () => crypto.randomUUID(),
} = {}) {
  if (typeof learnerRef !== "string" || learnerRef.length === 0) throw new TypeError("learnerRef must be a non-empty string");
  if (typeof random !== "function") throw new TypeError("random must be a function");
  if (typeof id !== "function") throw new TypeError("id must be a function");

  const sessions = new Map();
  const requests = new Map();

  function replayRequest(operation, request, createResult) {
    const key = request.requestId;
    const payload = fingerprint({ operation, request });
    const prior = requests.get(key);
    if (prior) {
      if (prior.payload !== payload) fail("REQUEST_CONFLICT", `requestId ${key} was already used with a different payload`);
      return clone(prior.result);
    }
    const result = createResult();
    requests.set(key, { payload, result: clone(result) });
    return clone(result);
  }

  function requireSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) fail("SESSION_NOT_FOUND", `Unknown sessionId: ${sessionId}`);
    return session;
  }

  function createTask(session) {
    const question = createAdditionQuestion(random);
    const options = question.options.map((answer) => ({
      optionId: id(),
      content: { format: "plain_text", text: String(answer) },
    }));
    const correctOptionId = options.find(({ content }) => content.text === String(question.answer)).optionId;
    const task = parseTaskResponse({
      schemaVersion: 1,
      status: "task",
      task: {
        taskId: id(),
        questionId: id(),
        questionVersion: 1,
        kind: "single_choice",
        content: { format: "plain_text", prompt: `${question.left} + ${question.right} = ?` },
        options,
        metadata: { subjectId: PLAN.subjectId, skillIds: PLAN.skillIds },
        timeLimitMs: 20_000,
      },
    });
    session.openTaskId = task.task.taskId;
    session.tasks.set(task.task.taskId, { publicResponse: task, correctOptionId,
      correctAnswer: String(question.answer), explanation: `${question.left} + ${question.right} = ${question.answer}`,
      terminalAttemptId: null });
    return task;
  }

  async function createSession(input, { signal } = {}) {
    checkSignal(signal);
    const request = parseCreateSessionRequest(input);
    return replayRequest("createSession", request, () => {
      const sessionId = id();
      const response = parseSession({ schemaVersion: 1, status: "active", sessionId, learnerRef, plan: PLAN,
        questionCount: QUESTION_COUNT, completedCount: 0, correctCount: 0, wrongCount: 0,
        challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
        saveId: request.saveId ?? 1, configurationVersion: 1 });
      sessions.set(sessionId, { ended: false, openTaskId: null, tasks: new Map(), attempts: new Map(),
        completedCount: 0, correctCount: 0, wrongCount: 0 });
      return response;
    });
  }

  async function getNextTask(input, { signal } = {}) {
    checkSignal(signal);
    const request = parseGetNextTaskRequest(input);
    return replayRequest("getNextTask", request, () => {
      const session = requireSession(request.sessionId);
      if (session.ended) return parseTaskResponse({ schemaVersion: 1, status: "session_ended" });
      if (session.openTaskId) return session.tasks.get(session.openTaskId).publicResponse;
      if (session.completedCount >= QUESTION_COUNT) return parseTaskResponse({ schemaVersion: 1, status: "no_task" });
      return createTask(session);
    });
  }

  async function submitAnswer(input, { signal } = {}) {
    checkSignal(signal);
    const request = parseSubmitAnswerRequest(input);
    const session = requireSession(request.sessionId);
    const payload = fingerprint(request);
    const prior = session.attempts.get(request.attemptId);
    if (prior) {
      if (prior.payload !== payload) fail("ATTEMPT_CONFLICT", `attemptId ${request.attemptId} has a conflicting payload`);
      return clone(prior.result);
    }
    const record = session.tasks.get(request.taskId);
    if (!record) fail("TASK_NOT_FOUND", `Unknown taskId: ${request.taskId}`);
    const task = record.publicResponse.task;
    if (request.questionId !== task.questionId) fail("QUESTION_MISMATCH", "questionId does not match the issued task");
    if (request.questionVersion !== task.questionVersion) fail("QUESTION_VERSION_MISMATCH", "questionVersion does not match the issued task");
    if (record.terminalAttemptId) fail("TASK_ALREADY_TERMINAL", `Task was completed by ${record.terminalAttemptId}`);
    if (request.response.type === "answered" && !task.options.some(({ optionId }) => optionId === request.response.optionId)) {
      fail("INVALID_OPTION", "optionId does not belong to the issued task");
    }
    const common = {
      schemaVersion: 1,
      sessionId: request.sessionId,
      taskId: request.taskId,
      questionId: request.questionId,
      questionVersion: request.questionVersion,
      attemptId: request.attemptId,
      evidenceId: id(),
    };
    const correctness = request.response.type === "answered"
      ? request.response.optionId === record.correctOptionId ? "correct" : "incorrect" : null;
    record.terminalAttemptId = request.attemptId;
    session.completedCount += 1;
    if (correctness === "correct") session.correctCount += 1;
    if (correctness === "incorrect") session.wrongCount += 1;
    const progress = { correctCount: session.correctCount, wrongCount: session.wrongCount,
      completedCount: session.completedCount, rewardSunCount: session.correctCount * 5,
      rewardSunValue: session.correctCount * 250 };
    const feedback = { correctOptionId: record.correctOptionId, correctAnswer: record.correctAnswer,
      explanation: record.explanation };
    const result = request.response.type === "answered"
      ? parseSubmissionResult({ ...common, status: "graded", correctness, progress, feedback }, task.kind)
      : parseSubmissionResult({ ...common, status: "recorded", outcome: request.response.type,
        progress, ...(request.response.type === "cancelled" ? {} : { feedback }) }, task.kind);
    if (session.openTaskId === request.taskId) session.openTaskId = null;
    session.attempts.set(request.attemptId, { payload, result: clone(result) });
    return clone(result);
  }

  async function endSession(input, { signal } = {}) {
    checkSignal(signal);
    const request = parseEndSessionRequest(input);
    return replayRequest("endSession", request, () => {
      const session = requireSession(request.sessionId);
      session.ended = true;
      return { schemaVersion: 1, status: "ended", sessionId: request.sessionId,
        final: { correctCount: session.correctCount, wrongCount: session.wrongCount,
          questionCount: QUESTION_COUNT,
          passed: session.correctCount >= 8,
          reward: { grantId: `local-${request.sessionId}`, sunCount: session.correctCount * 5 },
          challenge: { enabled: false, ruleVersion: 0, extraPerWave: 0, maxWaves: 3,
            totalCap: 6 } } };
    });
  }

  return { createSession, getNextTask, submitAnswer, endSession };
}
