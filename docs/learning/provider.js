export class LearningProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LearningProviderError";
    this.code = code;
  }
}

function invalid(path, expectation) {
  throw new LearningProviderError("INVALID_DTO", `${path} ${expectation}`);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be an object");
  return value;
}

function literal(value, expected, path) {
  if (value !== expected) invalid(path, `must be ${JSON.stringify(expected)}`);
  return value;
}

function oneOf(value, choices, path) {
  if (!choices.includes(value)) invalid(path, `must be one of: ${choices.join(", ")}`);
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || value.length === 0) invalid(path, "must be a non-empty string");
  return value;
}

function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(path, `must be a safe integer >= ${minimum}`);
  return value;
}

function strings(value, path) {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function version(value) {
  return literal(value, 1, "schemaVersion");
}

function identities(value) {
  return {
    sessionId: string(value.sessionId, "sessionId"),
    taskId: string(value.taskId, "taskId"),
    questionId: string(value.questionId, "questionId"),
    questionVersion: integer(value.questionVersion, "questionVersion", 1),
    attemptId: string(value.attemptId, "attemptId"),
  };
}

export function parseSession(input) {
  const value = object(input, "session");
  const plan = object(value.plan, "plan");
  return {
    schemaVersion: version(value.schemaVersion),
    status: literal(value.status, "active", "status"),
    sessionId: string(value.sessionId, "sessionId"),
    learnerRef: string(value.learnerRef, "learnerRef"),
    plan: {
      planId: string(plan.planId, "plan.planId"),
      title: string(plan.title, "plan.title"),
      subjectId: string(plan.subjectId, "plan.subjectId"),
      skillIds: strings(plan.skillIds, "plan.skillIds"),
    },
  };
}

export function parseTask(input) {
  const value = object(input, "task");
  const content = object(value.content, "task.content");
  const metadata = object(value.metadata, "task.metadata");
  if (!Array.isArray(value.options) || value.options.length !== 4) invalid("task.options", "must contain exactly 4 options in v1");
  const options = value.options.map((entry, index) => {
    const option = object(entry, `task.options[${index}]`);
    const optionContent = object(option.content, `task.options[${index}].content`);
    return {
      optionId: string(option.optionId, `task.options[${index}].optionId`),
      content: {
        format: literal(optionContent.format, "plain_text", `task.options[${index}].content.format`),
        text: string(optionContent.text, `task.options[${index}].content.text`),
      },
    };
  });
  if (new Set(options.map(({ optionId }) => optionId)).size !== options.length) invalid("task.options", "must have unique optionId values");
  return {
    taskId: string(value.taskId, "task.taskId"),
    questionId: string(value.questionId, "task.questionId"),
    questionVersion: integer(value.questionVersion, "task.questionVersion", 1),
    kind: literal(value.kind, "single_choice", "task.kind"),
    content: {
      format: literal(content.format, "plain_text", "task.content.format"),
      prompt: string(content.prompt, "task.content.prompt"),
    },
    options,
    metadata: {
      subjectId: string(metadata.subjectId, "task.metadata.subjectId"),
      skillIds: strings(metadata.skillIds, "task.metadata.skillIds"),
    },
    timeLimitMs: integer(value.timeLimitMs, "task.timeLimitMs", 1),
  };
}

export function parseTaskResponse(input) {
  const value = object(input, "taskResponse");
  const schemaVersion = version(value.schemaVersion);
  const status = oneOf(value.status, ["task", "no_task", "session_ended"], "status");
  return status === "task" ? { schemaVersion, status, task: parseTask(value.task) } : { schemaVersion, status };
}

export function parseSubmissionResult(input) {
  const value = object(input, "submissionResult");
  const schemaVersion = version(value.schemaVersion);
  const status = oneOf(value.status, ["graded", "recorded"], "status");
  const result = { schemaVersion, status, ...identities(value), evidenceId: string(value.evidenceId, "evidenceId") };
  if (status === "graded") return { ...result, correctness: oneOf(value.correctness, ["correct", "incorrect"], "correctness") };
  return { ...result, outcome: oneOf(value.outcome, ["timed_out", "skipped", "cancelled"], "outcome") };
}
