import { createTimedAttempt } from "./timed-attempt.js";
import { createSolutionPane } from "./quiz-feedback.js";
import { element, prepareDialog } from "./quiz-view-elements.js";
import { createNumericInput } from "./quiz-input.js";

const PROMPT_ID = "addition-quiz-prompt";
const TIMEOUT_ID = "addition-quiz-timeout";

function createPrompt(question) {
  const prompt = element("div", "quiz-view__prompt");
  prompt.id = PROMPT_ID;
  prompt.append(
    element("p", "quiz-view__instruction", question.kind === "numeric_entry"
      ? "填写答案并提交后，可查看题解" : "选择答案后可查看正确答案和题解"),
    element("p", "quiz-view__equation", question.content.prompt),
  );
  prompt.lastElementChild.dataset.testid = "quiz-equation";
  return prompt;
}

function createTiming(question, isFinal) {
  const timing = element("div", "quiz-view__timing");
  const timer = element("p", "quiz-view__timer", `剩余${Math.ceil(question.timeLimitMs / 1_000)}秒`);
  timer.id = "addition-quiz-timer";
  timer.setAttribute("role", "timer");
  timer.setAttribute("aria-live", "off");
  const timeout = element("p", "quiz-view__timeout",
    isFinal ? "超时后仍可阅读题解，再开始游戏" : "超时后仍可阅读题解，再进入下一题");
  timeout.id = TIMEOUT_ID;
  timing.append(timer, timeout);
  return { timing, timer };
}

function createAnswerSurface(question, source, state) {
  if (question.kind === "numeric_entry") {
    source.numericInput = createNumericInput(question.inputSpec, (values) => {
      if (state.isActive(source) && source.kind === "question") {
        source.attempt?.answer({ type: "entered", values });
      }
    });
    return source.numericInput.root;
  }
  const options = element("div", "quiz-view__options");
  options.setAttribute("aria-label", "答案选项");
  source.options = options;
  for (const option of question.options) {
    const button = element("button", "quiz-view__button quiz-view__option", option.content.text);
    button.type = "button";
    button.dataset.quizOption = option.optionId;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.isActive(source) || source.kind !== "question") return;
      button.classList.add("quiz-view__option--selected");
      button.setAttribute("aria-pressed", "true");
      source.attempt?.answer({ type: "answered", optionId: option.optionId });
    });
    options.append(button);
  }
  return options;
}

export function renderQuestion({ question, progress, resolveIntent, state }) {
  const { dialog, panel } = prepareDialog(progress, "question");
  const source = { kind: "question", taskId: question.taskId, dialog, resolveIntent, intentSettled: false,
    continueWaiter: null, attempt: null, startedAt: 0, previousFocus: document.activeElement };
  const { timing, timer } = createTiming(question, progress.current >= progress.total);
  source.timing = timing;
  const answerSurface = createAnswerSurface(question, source, state);
  const actions = element("div", "quiz-view__actions");
  const skip = element("button", "quiz-view__skip", "跳过本题");
  skip.type = "button";
  skip.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.isActive(source) && source.kind === "question") source.attempt?.answer({ type: "skipped" });
  });
  source.skip = skip;
  actions.append(skip);
  const left = element("section", "quiz-view__question-pane");
  left.append(createPrompt(question), timing, answerSurface, actions);
  source.solution = createSolutionPane(question.kind === "numeric_entry"
    ? "提交答案后，这里会出现题解" : undefined);
  const content = element("div", "quiz-view__content");
  content.append(left, source.solution);
  panel.append(content);
  dialog.setAttribute("aria-describedby", `${PROMPT_ID} ${TIMEOUT_ID}`);
  state.guardDialog(source);
  state.mount(source, question.kind === "numeric_entry" ? ".quiz-input__control" : ".quiz-view__option");
  source.startedAt = performance.now();
  source.attempt = createTimedAttempt({ durationMs: question.timeLimitMs,
    onSettle: (value) => state.settleIntent(source, value),
    onUpdate: (remainingMs) => {
      if (state.isActive(source) && source.kind === "question") {
        timer.textContent = `剩余${Math.ceil(remainingMs / 1_000)}秒`;
      }
    } });
}

export function renderStageCard({ card, progress, waiter, state }) {
  const { dialog, panel } = prepareDialog(progress, "stage-card");
  const source = { kind: "stage-card", stageKey: card.stageKey, dialog,
    previousFocus: document.activeElement, cancel: null, intentSettled: true,
    continueWaiter: null, cardWaiter: waiter };
  const article = element("article", "quiz-stage-card");
  article.append(
    element("p", "quiz-stage-card__badge", "不计分示例"),
    element("h3", "quiz-stage-card__title", card.title),
    element("p", "quiz-stage-card__prompt", card.examplePrompt),
    element("p", "quiz-stage-card__answer", `答案：${card.exampleAnswer}`),
    element("p", "quiz-stage-card__explanation", card.explanation),
  );
  const start = element("button", "quiz-view__button quiz-stage-card__start", "开始答题");
  start.type = "button";
  start.dataset.testid = "quiz-stage-start";
  start.addEventListener("click", () => {
    if (!state.isActive(source)) return;
    source.cardWaiter = null;
    state.release(source);
    waiter.resolve({ action: "start" });
  }, { once: true });
  article.append(start);
  panel.append(article);
  state.guardDialog(source);
  state.mount(source, ".quiz-stage-card__start");
}

export function renderLoading({ progress, options, state }) {
  const { dialog, panel } = prepareDialog(progress, "loading");
  const source = { kind: "loading", dialog, previousFocus: document.activeElement,
    cancel: options.onCancel, intentSettled: true, continueWaiter: null };
  const status = element("p", "quiz-view__loading-status", progress.message || "正在准备题目");
  status.setAttribute("role", "status");
  const actions = element("div", "quiz-view__actions");
  if (options.onRetry) {
    const retry = element("button", "quiz-view__button", "重试");
    retry.type = "button";
    retry.addEventListener("click", options.onRetry, { once: true });
    actions.append(retry);
  }
  const cancel = element("button", "quiz-view__skip quiz-view__cancel", "取消练习并开始游戏");
  cancel.type = "button";
  cancel.addEventListener("click", options.onCancel, { once: true });
  actions.append(cancel);
  panel.append(status, actions);
  state.guardDialog(source);
  state.mount(source, ".quiz-view__cancel");
}
