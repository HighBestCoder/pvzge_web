import QUESTION_DURATION_MS, { createTimedAttempt } from "./timed-attempt.js";
import { parseTask } from "./provider.js";

const DIALOG_ID = "addition-quiz";
const TIMER_ID = "addition-quiz-timer";
const TIMEOUT_ID = "addition-quiz-timeout";
const BLOCKED_EVENTS = [
  "keydown",
  "keyup",
  "keypress",
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "click",
  "touchstart",
  "touchend",
  "wheel",
  "contextmenu",
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createQuizView() {
  let dialog = null;
  let timer = null;
  let previousFocus = null;
  let resolveAsk = null;
  let attempt = null;
  let startedAt = 0;

  const containsTarget = (event) =>
    event.target instanceof Node && dialog?.contains(event.target);

  const guardGameInput = (event) => {
    if (dialog?.open && !containsTarget(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const addGuards = () => {
    for (const type of BLOCKED_EVENTS) {
      window.addEventListener(type, guardGameInput, {
        capture: true,
        passive: false,
      });
    }
  };

  const removeGuards = () => {
    for (const type of BLOCKED_EVENTS) {
      window.removeEventListener(type, guardGameInput, true);
    }
  };

  const finish = (value) => {
    if (!resolveAsk) return;
    const resolve = resolveAsk;
    resolveAsk = null;
    attempt = null;
    removeGuards();
    if (dialog?.open) dialog.close();
    dialog?.remove();
    dialog = null;
    timer = null;
    previousFocus?.focus?.({ preventScroll: true });
    previousFocus = null;
    resolve({ ...(value ?? { type: "timed_out" }), elapsedMs: Math.max(0, Math.floor(performance.now() - startedAt)) });
  };

  const buildDialog = (question) => {
    dialog = element("dialog", "quiz-view");
    const sourceDialog = dialog;
    dialog.id = DIALOG_ID;
    dialog.setAttribute("aria-labelledby", "addition-quiz-title");
    dialog.setAttribute(
      "aria-describedby",
      `addition-quiz-prompt ${TIMEOUT_ID}`,
    );

    const panel = element("section", "quiz-view__panel");
    const header = element("header", "quiz-view__header");
    const title = element("h2", "quiz-view__title", "阳光学习挑战");
    title.id = "addition-quiz-title";
    header.append(title, element("p", "quiz-view__reward", "+5 个阳光"));

    const prompt = element("div", "quiz-view__prompt");
    prompt.id = "addition-quiz-prompt";
    prompt.append(
      element("p", "quiz-view__instruction", "点击答案立即返回游戏"),
      element("p", "quiz-view__equation", question.content.prompt),
    );
    prompt.lastElementChild.dataset.testid = "quiz-equation";

    const timing = element("div", "quiz-view__timing");
    timer = element("p", "quiz-view__timer", `剩余 ${Math.ceil(question.timeLimitMs / 1_000)} 秒`);
    timer.id = TIMER_ID;
    timer.setAttribute("role", "timer");
    timer.setAttribute("aria-live", "off");
    const timeout = element("p", "quiz-view__timeout", "超时返回游戏，不获得奖励");
    timeout.id = TIMEOUT_ID;
    timing.append(timer, timeout);

    const options = element("div", "quiz-view__options");
    options.setAttribute("aria-label", "答案选项");
    for (const option of question.options) {
      const button = element("button", "quiz-view__button quiz-view__option", option.content.text);
      button.type = "button";
      button.dataset.quizOption = option.optionId;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (dialog === sourceDialog) attempt?.answer({ type: "answered", optionId: option.optionId });
      });
      options.append(button);
    }

    const actions = element("div", "quiz-view__actions");
    const skipButton = element("button", "quiz-view__skip", "暂时跳过");
    skipButton.type = "button";
    skipButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (dialog === sourceDialog) attempt?.answer({ type: "skipped" });
    });
    actions.append(skipButton);
    panel.append(header, prompt, timing, options, actions);
    dialog.append(panel);

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (dialog === sourceDialog) attempt?.answer({ type: "skipped" });
    });
    dialog.addEventListener("close", () => {
      if (dialog === sourceDialog) attempt?.dismiss({ type: "cancelled", reason: "superseded" });
    });
    for (const type of BLOCKED_EVENTS) {
      dialog.addEventListener(type, (event) => event.stopPropagation());
    }
    return dialog;
  };

  return {
    ask(input) {
      const question = parseTask(input);
      attempt?.dismiss({ type: "cancelled", reason: "superseded" });
      previousFocus = document.activeElement;
      return new Promise((resolve) => {
        resolveAsk = resolve;
        document.body.append(buildDialog(question));
        addGuards();
        dialog.showModal();
        startedAt = performance.now();
        attempt = createTimedAttempt({
          durationMs: question.timeLimitMs,
          onSettle: finish,
          onUpdate: (remainingMs) => {
            timer.textContent = `剩余 ${Math.ceil(remainingMs / 1_000)} 秒`;
          },
        });
        dialog.querySelector(".quiz-view__option")?.focus({ preventScroll: true });
      });
    },

    dismiss(reason = "superseded") {
      attempt?.dismiss({ type: "cancelled", reason });
    },

    isOpen() {
      return Boolean(dialog?.open);
    },
  };
}

export { QUESTION_DURATION_MS };
