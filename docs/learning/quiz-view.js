import QUESTION_DURATION_MS from "./timed-attempt.js";
import { parseTask } from "./provider.js";
import { normalizeProgress, updateProgress } from "./quiz-view-elements.js";
import { showSolutionLoading, showSolutionResult } from "./quiz-feedback.js";
import { renderLoading, renderQuestion, renderStageCard } from "./quiz-view-render.js";
import { createQuizViewState } from "./quiz-view-state.js";

export function createQuizView() {
  const state = createQuizViewState();

  return {
    ask(input, progressInput) {
      const question = parseTask(input);
      const progress = normalizeProgress(progressInput);
      const suspended = state.suspendedQuestion(question.taskId);
      if (suspended) {
        if (suspended.pendingIntent) {
          const intent = suspended.pendingIntent;
          suspended.pendingIntent = null;
          state.mount(suspended, question.kind === "numeric_entry" ? ".quiz-input__control" : ".quiz-view__option", true);
          return Promise.resolve(intent);
        }
        const waiter = Promise.withResolvers();
        suspended.resolveIntent = waiter.resolve;
        state.mount(suspended, question.kind === "numeric_entry" ? ".quiz-input__control" : ".quiz-view__option", true);
        return waiter.promise;
      }
      state.replaceActive();
      return new Promise((resolveIntent) => {
        renderQuestion({ question, progress, resolveIntent, state });
      });
    },

    showStageCard(card, progressInput) {
      const suspended = state.suspendedStageCard(card.stageKey);
      if (suspended) {
        const waiter = Promise.withResolvers();
        suspended.cardWaiter = waiter;
        state.mount(suspended, ".quiz-stage-card__start", true);
        return waiter.promise;
      }
      state.replaceActive();
      const waiter = Promise.withResolvers();
      renderStageCard({ card, progress: normalizeProgress(progressInput), waiter, state });
      return waiter.promise;
    },

    showLoading(progressInput, options = {}) {
      const progress = normalizeProgress(progressInput);
      const source = state.submittedSource();
      if (source) {
        if (!state.isActive(source)) state.mount(source, ".quiz-view__cancel", true);
        updateProgress(source.dialog, progress);
        source.cancel = options.onCancel;
        showSolutionLoading(source.solution, progress.message, {
          onCancel: options.onCancel,
          onRetry: options.onRetry,
        });
        return;
      }
      state.replaceActive();
      renderLoading({ progress, options, state });
    },

    showResult(result, progressInput) {
      const source = state.submittedSource();
      if (!source) throw new Error("showResult requires the submitted question view");
      const progress = normalizeProgress(progressInput);
      if (!state.isActive(source)) state.mount(source, ".quiz-solution__next", true);
      updateProgress(source.dialog, progress);
      const waiter = Promise.withResolvers();
      state.settleContinue(source, { action: "dismissed", reason: "superseded" });
      source.continueWaiter = waiter;
      if (result.feedback?.correctOptionId && source.options) {
        for (const button of source.options.querySelectorAll("button")) {
          if (button.dataset.quizOption === result.feedback.correctOptionId) {
            button.classList.add("quiz-view__option--correct");
            button.setAttribute("aria-label", `${button.textContent}，正确答案`);
          } else if (result.status === "graded" && result.correctness === "incorrect" &&
            button.classList.contains("quiz-view__option--selected")) {
            button.classList.add("quiz-view__option--incorrect");
            button.setAttribute("aria-label", `${button.textContent}，你的答案，回答错误`);
          }
        }
      }
      const next = showSolutionResult(source.solution, result, progress.current >= progress.total, () => {
        if (!state.isActive(source) || source.continueWaiter !== waiter) return;
        state.settleContinue(source, { action: "next" });
        state.release(source);
      });
      next.focus({ preventScroll: true });
      return waiter.promise;
    },

    dismiss(reason = "superseded") {
      state.replaceActive(reason);
    },

    isOpen() {
      return state.isOpen();
    },
  };
}

export { QUESTION_DURATION_MS };
