import { createQuizGuards } from "./quiz-view-guards.js";

export function createQuizViewState() {
  let active = null;
  let suspended = null;
  const guards = createQuizGuards(() => active);

  const remove = (source) => {
    if (active === source) active = null;
    guards.remove();
    if (source.dialog.open) source.dialog.close();
    source.dialog.remove();
  };

  const release = (source) => {
    remove(source);
    if (suspended === source) suspended = null;
    source.previousFocus?.focus?.({ preventScroll: true });
  };

  const settleIntent = (source, value) => {
    if (source.intentSettled) return;
    source.intentSettled = true;
    source.kind = "submitted";
    source.attempt = null;
    source.options?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    source.numericInput?.disable();
    source.skip.disabled = true;
    source.timing.hidden = true;
    const elapsedMs = Math.max(0, Math.floor(performance.now() - source.startedAt));
    const intent = { ...(value ?? { type: "timed_out" }), elapsedMs };
    if (source.resolveIntent) source.resolveIntent(intent);
    else source.pendingIntent = intent;
  };

  const settleContinue = (source, value) => {
    if (!source.continueWaiter) return;
    const waiter = source.continueWaiter;
    source.continueWaiter = null;
    waiter.resolve(value);
  };

  const mount = (source, focusSelector, restore = false) => {
    active = source;
    suspended = null;
    document.body.append(source.dialog);
    guards.add();
    source.dialog.showModal();
    const target = restore && source.restoreFocus
      ? source.dialog.querySelector(source.restoreFocus) : source.dialog.querySelector(focusSelector);
    if (!restore || target) (target ?? source.dialog).focus({ preventScroll: true });
    source.restoreFocus = null;
  };

  const suspend = (source, reason) => {
    const focused = source.dialog.contains(document.activeElement) ? document.activeElement : null;
    source.restoreFocus = focused?.dataset.numericField === undefined
      ? null : `[data-numeric-field="${focused.dataset.numericField}"]`;
    remove(source);
    suspended = source;
    if (source.kind === "question") {
      const resolve = source.resolveIntent;
      source.resolveIntent = null;
      resolve?.({ type: "cancelled", reason, elapsedMs: Math.max(0, Math.floor(performance.now() - source.startedAt)) });
    } else if (source.kind === "stage-card") {
      const waiter = source.cardWaiter;
      source.cardWaiter = null;
      waiter?.resolve({ action: "dismissed", reason });
    } else settleContinue(source, { action: "dismissed", reason });
  };

  const dismissSource = (source, reason) => {
    if (reason === "hidden" && ["question", "submitted", "stage-card"].includes(source.kind)) {
      suspend(source, reason);
      return;
    }
    if (source.kind === "stage-card") {
      const waiter = source.cardWaiter;
      source.cardWaiter = null;
      waiter?.resolve({ action: "dismissed", reason });
      release(source);
      return;
    }
    if (!source.intentSettled) source.attempt?.dismiss({ type: "cancelled", reason });
    else settleContinue(source, { action: "dismissed", reason });
    release(source);
  };

  const replaceActive = (reason = "superseded") => {
    if (active) dismissSource(active, reason);
    if (suspended && reason !== "hidden") {
      settleContinue(suspended, { action: "dismissed", reason });
      release(suspended);
    }
  };

  const guardDialog = (source) => {
    source.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (active !== source) return;
      if (source.kind === "question") source.attempt?.answer({ type: "skipped" });
      else if (source.kind !== "stage-card") source.cancel?.();
    });
    guards.contain(source.dialog);
  };

  return {
    guardDialog,
    isActive: (source) => active === source,
    isOpen: () => Boolean(active?.dialog.open),
    mount,
    release,
    replaceActive,
    settleContinue,
    settleIntent,
    submittedSource() {
      const source = active?.kind === "submitted" ? active : suspended;
      return source?.kind === "submitted" ? source : null;
    },
    suspendedQuestion(taskId) {
      return ["question", "submitted"].includes(suspended?.kind) && suspended.taskId === taskId
        ? suspended : null;
    },
    suspendedStageCard(stageKey) {
      return suspended?.kind === "stage-card" && suspended.stageKey === stageKey ? suspended : null;
    },
  };
}
