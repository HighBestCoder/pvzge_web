import { element } from "./quiz-view-elements.js";

const FALLBACK_EXPLANATION = "这道题暂无详细题解";

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "quiz-solution__icon");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  const paths = {
    correct: "M14 33 26 45 51 18",
    incorrect: "M18 18 46 46M46 18 18 46",
    neutral: "M32 15v18l12 7M32 5a27 27 0 1 0 0 54 27 27 0 0 0 0-54Z",
  };
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}

function clear(pane) {
  pane.replaceChildren();
  pane.className = "quiz-solution";
}

export function createSolutionPane(placeholder = "选好答案后，这里会出现题解") {
  const pane = element("aside", "quiz-solution quiz-solution--placeholder");
  pane.dataset.testid = "quiz-solution";
  pane.setAttribute("aria-live", "polite");
  pane.setAttribute("aria-atomic", "true");
  pane.append(element("p", "quiz-solution__placeholder", placeholder));
  return pane;
}

export function showSolutionLoading(pane, message, { onCancel, onRetry } = {}) {
  clear(pane);
  pane.classList.add("quiz-solution--pending");
  const status = element("p", "quiz-solution__status", message || "正在判题");
  status.setAttribute("role", "status");
  pane.append(status);
  const actions = element("div", "quiz-solution__actions");
  if (onRetry) {
    const retry = element("button", "quiz-view__button", "重试");
    retry.type = "button";
    retry.addEventListener("click", onRetry, { once: true });
    actions.append(retry);
  }
  if (onCancel) {
    const cancel = element("button", "quiz-view__skip quiz-view__cancel", "取消练习并开始游戏");
    cancel.type = "button";
    cancel.addEventListener("click", onCancel, { once: true });
    actions.append(cancel);
  }
  if (actions.childElementCount) pane.append(actions);
}

function resultDetails(result) {
  if (result?.status === "graded" && result.correctness === "correct") {
    return { title: "回答正确", tone: "correct", icon: "correct" };
  }
  if (result?.status === "graded" && result.correctness === "incorrect") {
    return { title: "回答错误", tone: "incorrect", icon: "incorrect" };
  }
  if (result?.status === "recorded" && result.outcome === "timed_out") {
    return { title: "本题已超时", detail: "本题不计分", tone: "neutral", icon: "neutral" };
  }
  if (result?.status === "recorded" && result.outcome === "skipped") {
    return { title: "已跳过", tone: "neutral", icon: "neutral" };
  }
  throw new TypeError("Result feedback requires an accepted submission result");
}

export function showSolutionResult(pane, result, isFinal, onNext) {
  const details = resultDetails(result);
  clear(pane);
  pane.classList.add(`quiz-solution--${details.tone}`);
  const status = element("div", "quiz-view__result");
  status.id = "addition-quiz-result";
  status.dataset.testid = "quiz-result";
  status.setAttribute("role", "status");
  status.append(icon(details.icon), element("h3", "quiz-solution__title", details.title));
  if (details.detail) {
    status.append(element("p", "quiz-solution__detail", details.detail));
  }
  const feedback = result.feedback;
  if (feedback) {
    status.append(element("p", "quiz-solution__answer", `正确答案：${feedback.correctAnswer}`));
  }
  status.append(element("p", "quiz-solution__explanation",
    feedback?.explanation ?? FALLBACK_EXPLANATION));
  const next = element("button", "quiz-view__button quiz-solution__next",
    isFinal ? "开始游戏" : "下一题");
  next.type = "button";
  next.dataset.testid = "quiz-next";
  next.addEventListener("click", onNext, { once: true });
  pane.append(status, next);
  return next;
}
