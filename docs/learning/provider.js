import { meetsGameUnlock } from "./quiz-config.js";

export class LearningProviderError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "LearningProviderError";
    this.code = code;
    this.status = status;
  }
}

function invalid(path, expectation) {
  throw new LearningProviderError("INVALID_DTO", `${path} ${expectation}`);
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

function oneOf(value, choices, path) {
  if (!choices.includes(value)) invalid(path, `must be one of: ${choices.join(", ")}`);
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || value.length === 0) invalid(path, "must be a non-empty string");
  return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(path, `must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  return value;
}

function strings(value, path) {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function boundedString(value, path, maximum = 16) {
  const result = string(value, path);
  if (result.length > maximum) invalid(path, `must be at most ${maximum} characters`);
  return result;
}

function decimalGreater(left, right) {
  const normalize = (value) => {
    const [integerPart, fractionPart = ""] = value.split(".");
    return { integer: integerPart.replace(/^0+(?=\d)/, ""), fraction: fractionPart.replace(/0+$/, "") };
  };
  const first = normalize(left);
  const second = normalize(right);
  if (first.integer.length !== second.integer.length) return first.integer.length > second.integer.length;
  if (first.integer !== second.integer) return first.integer > second.integer;
  const width = Math.max(first.fraction.length, second.fraction.length);
  return first.fraction.padEnd(width, "0") > second.fraction.padEnd(width, "0");
}

function feedback(input) {
  if (input === undefined) return undefined;
  const value = object(input, "feedback");
  const expected = value.correctOptionId === undefined
    ? ["correctAnswer", "explanation"] : ["correctOptionId", "correctAnswer", "explanation"];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    invalid("feedback", `must contain exactly: ${expected.join(", ")}`);
  }
  const explanation = string(value.explanation, "feedback.explanation");
  if (explanation.length > 4_000) invalid("feedback.explanation", "must be at most 4000 characters");
  return {
    ...(value.correctOptionId === undefined ? {} : {
      correctOptionId: string(value.correctOptionId, "feedback.correctOptionId"),
    }),
    correctAnswer: string(value.correctAnswer, "feedback.correctAnswer"),
    explanation,
  };
}

export function parseInputSpec(input) {
  const value = object(input, "task.inputSpec");
  const format = oneOf(value.format, ["integer", "decimal", "fraction", "digits", "pair"],
    "task.inputSpec.format");
  if (format === "integer") {
    exactKeys(value, ["format", "min", "max"], "task.inputSpec");
    const result = { format };
    if (value.min !== undefined) result.min = integer(value.min, "task.inputSpec.min");
    if (value.max !== undefined) result.max = integer(value.max, "task.inputSpec.max");
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) {
      invalid("task.inputSpec", "min must not exceed max");
    }
    return result;
  }
  if (format === "decimal") {
    exactKeys(value, ["format", "min", "max"], "task.inputSpec");
    const decimal = (item, path) => {
      const result = boundedString(item, path);
      if (!/^[0-9]+(?:\.[0-9]+)?$/.test(result)) invalid(path, "must be a nonnegative decimal string");
      return result;
    };
    const result = { format };
    if (value.min !== undefined) result.min = decimal(value.min, "task.inputSpec.min");
    if (value.max !== undefined) result.max = decimal(value.max, "task.inputSpec.max");
    if (result.min !== undefined && result.max !== undefined && decimalGreater(result.min, result.max)) {
      invalid("task.inputSpec", "min must not exceed max");
    }
    return result;
  }
  if (format === "fraction") {
    exactKeys(value, ["format", "numeratorLabel", "denominatorLabel", "denominatorMin"], "task.inputSpec");
    return { format, numeratorLabel: boundedString(value.numeratorLabel, "task.inputSpec.numeratorLabel"),
      denominatorLabel: boundedString(value.denominatorLabel, "task.inputSpec.denominatorLabel"),
      denominatorMin: integer(value.denominatorMin, "task.inputSpec.denominatorMin", 1) };
  }
  if (format === "digits") {
    exactKeys(value, ["format", "label"], "task.inputSpec");
    return { format, label: boundedString(value.label, "task.inputSpec.label") };
  }
  exactKeys(value, ["format", "labels", "ordering"], "task.inputSpec");
  const labels = strings(value.labels, "task.inputSpec.labels");
  if (labels.length !== 2) invalid("task.inputSpec.labels", "must contain exactly 2 labels");
  labels.forEach((label, index) => boundedString(label, `task.inputSpec.labels[${index}]`));
  return { format, labels, ordering: oneOf(value.ordering, ["any", "ascending"], "task.inputSpec.ordering") };
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

const DISABLED_CHALLENGE_RULE = Object.freeze({
  enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6,
});
const DISABLED_FINAL_CHALLENGE = Object.freeze({
  enabled: false, ruleVersion: 0, extraPerWave: 0, maxWaves: 3, totalCap: 6,
});

function challengeRule(input, path = "challengeRule") {
  if (input === undefined) return { ...DISABLED_CHALLENGE_RULE };
  const value = object(input, path);
  const result = {
    enabled: boolean(value.enabled, `${path}.enabled`),
    version: integer(value.version, `${path}.version`),
    perWaveCap: literal(value.perWaveCap, 2, `${path}.perWaveCap`),
    maxWaves: literal(value.maxWaves, 3, `${path}.maxWaves`),
    totalCap: literal(value.totalCap, 6, `${path}.totalCap`),
  };
  if (!result.enabled && result.version < 0) invalid(`${path}.version`, "must be non-negative");
  return result;
}

function submissionProgress(input) {
  const value = object(input, "progress");
  const result = {
    correctCount: integer(value.correctCount, "progress.correctCount"),
    wrongCount: integer(value.wrongCount, "progress.wrongCount"),
    completedCount: integer(value.completedCount, "progress.completedCount"),
    rewardSunCount: integer(value.rewardSunCount, "progress.rewardSunCount"),
    rewardSunValue: integer(value.rewardSunValue, "progress.rewardSunValue"),
  };
  if (result.correctCount + result.wrongCount > result.completedCount) {
    invalid("progress", "correctCount + wrongCount must not exceed completedCount");
  }
  if (result.rewardSunCount !== result.correctCount * 5) {
    invalid("progress.rewardSunCount", "must equal correctCount * 5");
  }
  if (result.rewardSunValue !== result.rewardSunCount * 50) {
    invalid("progress.rewardSunValue", "must equal rewardSunCount * 50");
  }
  return result;
}

function finalChallenge(input) {
  if (input === undefined) return { ...DISABLED_FINAL_CHALLENGE };
  const value = object(input, "final.challenge");
  const result = {
    enabled: boolean(value.enabled, "final.challenge.enabled"),
    ruleVersion: integer(value.ruleVersion, "final.challenge.ruleVersion"),
    extraPerWave: integer(value.extraPerWave, "final.challenge.extraPerWave", 0, 2),
    maxWaves: literal(value.maxWaves, 3, "final.challenge.maxWaves"),
    totalCap: literal(value.totalCap, 6, "final.challenge.totalCap"),
  };
  if (!result.enabled && result.extraPerWave !== 0) {
    invalid("final.challenge.extraPerWave", "must be zero when challenge is disabled");
  }
  return result;
}

export function parseSession(input) {
  const value = object(input, "session");
  const plan = object(value.plan, "plan");
  const result = {
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
  const extras = ["questionCount", "completedCount", "correctCount", "wrongCount", "saveId", "configurationVersion"];
  const present = extras.filter((key) => value[key] !== undefined);
  if (present.length !== 0 && present.length !== extras.length) invalid("session", `must include all remote progress fields: ${extras.join(", ")}`);
  if (present.length) {
    result.questionCount = integer(value.questionCount, "questionCount", 1);
    result.completedCount = integer(value.completedCount, "completedCount");
    result.correctCount = integer(value.correctCount, "correctCount");
    result.wrongCount = integer(value.wrongCount, "wrongCount");
    result.saveId = integer(value.saveId, "saveId", 1);
    result.configurationVersion = integer(value.configurationVersion, "configurationVersion", 1);
    if (result.completedCount > result.questionCount) invalid("completedCount", "must not exceed questionCount");
    if (result.correctCount > result.completedCount) invalid("correctCount", "must not exceed completedCount");
    if (result.correctCount + result.wrongCount > result.completedCount) {
      invalid("session", "correctCount + wrongCount must not exceed completedCount");
    }
  }
  result.challengeRule = challengeRule(value.challengeRule);
  if (value.stageCard !== undefined) {
    const card = object(value.stageCard, "stageCard");
    exactKeys(card, ["stageKey", "title", "examplePrompt", "exampleAnswer", "explanation", "scored"], "stageCard");
    result.stageCard = {
      stageKey: boundedString(card.stageKey, "stageCard.stageKey"),
      title: boundedString(card.title, "stageCard.title", 120),
      examplePrompt: boundedString(card.examplePrompt, "stageCard.examplePrompt", 500),
      exampleAnswer: boundedString(card.exampleAnswer, "stageCard.exampleAnswer", 500),
      explanation: boundedString(card.explanation, "stageCard.explanation", 4_000),
      scored: literal(card.scored, false, "stageCard.scored"),
    };
  }
  return result;
}

export function parseEndSessionResult(input) {
  const value = object(input, "endSessionResult");
  const final = object(value.final, "final");
  const reward = object(final.reward, "final.reward");
  const questionCount = integer(final.questionCount, "final.questionCount", 1);
  const correctCount = integer(final.correctCount, "final.correctCount");
  const wrongCount = final.wrongCount === undefined ? 0 : integer(final.wrongCount, "final.wrongCount");
  if (correctCount > questionCount) invalid("final.correctCount", "must not exceed final.questionCount");
  if (correctCount + wrongCount > questionCount) invalid("final", "correctCount + wrongCount must not exceed questionCount");
  return {
    schemaVersion: version(value.schemaVersion), status: literal(value.status, "ended", "status"),
    sessionId: string(value.sessionId, "sessionId"),
    final: {
      correctCount, wrongCount, questionCount,
      passed: boolean(final.passed, "final.passed"),
      // Older servers omit gameUnlocked; fall back to the same accuracy rule.
      gameUnlocked: final.gameUnlocked === undefined
        ? meetsGameUnlock(correctCount, questionCount) : boolean(final.gameUnlocked, "final.gameUnlocked"),
      reward: { grantId: string(reward.grantId, "final.reward.grantId"), sunCount: integer(reward.sunCount, "final.reward.sunCount") },
      challenge: finalChallenge(final.challenge),
    },
  };
}

function boundedList(value, path, minimum, maximum, parseItem) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    invalid(path, `must be an array of ${minimum}-${maximum} items`);
  }
  return value.map((item, index) => parseItem(item, `${path}[${index}]`));
}

function figureCaption(figure, path) {
  return figure.caption === undefined ? {} : { caption: boundedString(figure.caption, `${path}.caption`, 80) };
}

// Optional drawing data next to the prompt (see learning-platform figure_models.py). Limits mirror
// the server so a malformed figure is rejected rather than drawn half-way.
function parseFigure(input, path) {
  const figure = object(input, path);
  const type = oneOf(figure.type, ["sequence", "rows", "order", "grid"], `${path}.type`);
  const token = (value, itemPath) => boundedString(value, itemPath, 8);
  const label = (value, itemPath) => boundedString(value, itemPath, 12);
  if (type === "sequence") {
    exactKeys(figure, ["type", "items", "repeat", "caption"], path);
    return { type, items: boundedList(figure.items, `${path}.items`, 1, 12, token),
      repeat: figure.repeat === undefined ? 2 : integer(figure.repeat, `${path}.repeat`, 1, 4),
      ...figureCaption(figure, path) };
  }
  if (type === "rows") {
    exactKeys(figure, ["type", "rows", "columns", "caption"], path);
    return { type, columns: integer(figure.columns, `${path}.columns`, 2, 16),
      rows: boundedList(figure.rows, `${path}.rows`, 1, 3, (row, rowPath) => {
        object(row, rowPath);
        exactKeys(row, ["label", "pattern"], rowPath);
        return { label: label(row.label, `${rowPath}.label`),
          pattern: boundedList(row.pattern, `${rowPath}.pattern`, 1, 12, token) };
      }), ...figureCaption(figure, path) };
  }
  if (type === "order") {
    exactKeys(figure, ["type", "lanes", "sequence", "caption"], path);
    const lanes = boundedList(figure.lanes, `${path}.lanes`, 2, 8, label);
    const sequence = boundedList(figure.sequence, `${path}.sequence`, 2, 16, label);
    if (new Set(lanes).size !== lanes.length) invalid(`${path}.lanes`, "must be unique");
    if (sequence.some((step) => !lanes.includes(step))) invalid(`${path}.sequence`, "must use declared lanes");
    return { type, lanes, sequence, ...figureCaption(figure, path) };
  }
  exactKeys(figure, ["type", "header", "rowLabels", "cells", "caption"], path);
  const cell = (value, cellPath) => {
    if (typeof value !== "string" || value.length > 8) invalid(cellPath, "must be a string of at most 8 characters");
    return value;
  };
  const cells = boundedList(figure.cells, `${path}.cells`, 1, 8,
    (row, rowPath) => boundedList(row, rowPath, 1, 8, cell));
  if (cells.some((row) => row.length !== cells[0].length)) invalid(`${path}.cells`, "rows must have equal length");
  const header = figure.header === undefined ? undefined : boundedList(figure.header, `${path}.header`, 1, 8, label);
  const rowLabels = figure.rowLabels === undefined ? undefined
    : boundedList(figure.rowLabels, `${path}.rowLabels`, 1, 8, label);
  if (header && header.length !== cells[0].length) invalid(`${path}.header`, "must match grid width");
  if (rowLabels && rowLabels.length !== cells.length) invalid(`${path}.rowLabels`, "must match grid height");
  return { type, cells, ...(header ? { header } : {}), ...(rowLabels ? { rowLabels } : {}),
    ...figureCaption(figure, path) };
}

export function parseTask(input) {
  const value = object(input, "task");
  exactKeys(value, ["taskId", "questionId", "questionVersion", "kind", "content", "options",
    "inputSpec", "metadata", "timeLimitMs"], "task");
  const content = object(value.content, "task.content");
  exactKeys(content, ["format", "prompt", "figure"], "task.content");
  const metadata = object(value.metadata, "task.metadata");
  exactKeys(metadata, ["subjectId", "skillIds", "tableId", "stageKey", "direction", "labels"], "task.metadata");
  const kind = oneOf(value.kind, ["single_choice", "numeric_entry"], "task.kind");
  if (kind === "single_choice" && (!Array.isArray(value.options) || value.options.length !== 4)) {
    invalid("task.options", "must contain exactly 4 options in v1");
  }
  if (kind === "numeric_entry" && value.options !== undefined) invalid("task.options", "is not supported for numeric_entry");
  if (kind === "single_choice" && value.inputSpec !== undefined) invalid("task.inputSpec", "is not supported for single_choice");
  if (kind === "numeric_entry" && value.inputSpec === undefined) invalid("task.inputSpec", "is required for numeric_entry");
  const options = (value.options ?? []).map((entry, index) => {
    const option = object(entry, `task.options[${index}]`);
    exactKeys(option, ["optionId", "content"], `task.options[${index}]`);
    const optionContent = object(option.content, `task.options[${index}].content`);
    exactKeys(optionContent, ["format", "text"], `task.options[${index}].content`);
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
    kind,
    content: {
      format: literal(content.format, "plain_text", "task.content.format"),
      prompt: string(content.prompt, "task.content.prompt"),
      ...(content.figure === undefined ? {} : { figure: parseFigure(content.figure, "task.content.figure") }),
    },
    ...(kind === "single_choice" ? { options } : { inputSpec: parseInputSpec(value.inputSpec) }),
    metadata: {
      subjectId: string(metadata.subjectId, "task.metadata.subjectId"),
      skillIds: strings(metadata.skillIds, "task.metadata.skillIds"),
      ...(metadata.tableId === undefined ? {} : { tableId: string(metadata.tableId, "task.metadata.tableId") }),
      ...(metadata.stageKey === undefined ? {} : { stageKey: string(metadata.stageKey, "task.metadata.stageKey") }),
      ...(metadata.direction === undefined ? {} : {
        direction: oneOf(metadata.direction, ["forward", "reverse"], "task.metadata.direction"),
      }),
      ...(metadata.labels === undefined ? {} : { labels: strings(metadata.labels, "task.metadata.labels") }),
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

export function parseSubmissionResult(input, taskKind) {
  const value = object(input, "submissionResult");
  const schemaVersion = version(value.schemaVersion);
  const status = oneOf(value.status, ["graded", "recorded"], "status");
  exactKeys(value, ["schemaVersion", "status", "sessionId", "taskId", "questionId", "questionVersion",
    "attemptId", "evidenceId", "progress", "feedback", status === "graded" ? "correctness" : "outcome"],
  "submissionResult");
  const result = { schemaVersion, status, ...identities(value), evidenceId: string(value.evidenceId, "evidenceId"),
    progress: submissionProgress(value.progress) };
  const parsedFeedback = feedback(value.feedback);
  if (parsedFeedback && value.outcome === "cancelled") {
    invalid("feedback", "is not supported for cancelled responses");
  }
  if (parsedFeedback && taskKind === "numeric_entry" && parsedFeedback.correctOptionId !== undefined) {
    invalid("feedback.correctOptionId", "is not supported for numeric_entry tasks");
  }
  if (parsedFeedback && taskKind === "single_choice" && parsedFeedback.correctOptionId === undefined) {
    invalid("feedback.correctOptionId", "is required for single_choice tasks");
  }
  const withFeedback = parsedFeedback ? { ...result, feedback: parsedFeedback } : result;
  if (status === "graded") return { ...withFeedback,
    correctness: oneOf(value.correctness, ["correct", "incorrect"], "correctness") };
  return { ...withFeedback, outcome: oneOf(value.outcome, ["timed_out", "skipped", "cancelled"], "outcome") };
}
