import { callProvider } from "./learning-session.js";

const ERROR_MESSAGE = "学习服务暂不可用，可取消练习进入游戏";
const CONFIG_ERROR_MESSAGE = "此关卡尚未配置题库，请前往题库管理；可重试或取消后以 0 奖励进入游戏";

export function createQuizControllerLifecycle({ view, isVisible, timeoutMs, log }) {
  let active = null;
  let visible = isVisible();
  let stopped = false;

  const available = () => visible && isVisible();
  const terminal = (state) => state.cancelled || state.suspended || stopped;

  async function waitUntilVisible(state) {
    if (terminal(state)) return false;
    const waiter = Promise.withResolvers();
    state.visibilityWaiter = waiter;
    if (available()) waiter.resolve(true);
    await waiter.promise;
    if (state.visibilityWaiter === waiter) state.visibilityWaiter = null;
    return !terminal(state);
  }

  function cancel(reason) {
    if (!active || active.cancelled) return;
    active.cancelled = true;
    active.reason = reason;
    active.controller.abort();
    if (active.operation) {
      active.operation.abortReason = reason;
      active.operation.controller.abort();
    }
    active.retry?.resolve(false);
    active.visibilityWaiter?.resolve(false);
    view.dismiss(reason);
  }

  function suspend() {
    if (!active || active.suspended) return;
    active.suspended = true;
    active.reason = "pagehide";
    active.controller.abort();
    if (active.operation) {
      active.operation.abortReason = "pagehide";
      active.operation.controller.abort();
    }
    active.retry?.resolve(false);
    active.visibilityWaiter?.resolve(false);
    view.dismiss("pagehide");
  }

  async function retryable(operation, request, progress, state, parse) {
    while (!terminal(state)) {
      if (!available()) {
        view.dismiss("hidden");
        await waitUntilVisible(state);
        continue;
      }
      view.showLoading(progress, { onCancel: () => cancel("user") });
      const currentOperation = { controller: new AbortController(), abortReason: null };
      try {
        state.operation = currentOperation;
        const value = await callProvider(operation, request, {
          signal: currentOperation.controller.signal, timeoutMs,
        });
        if (state.operation === currentOperation) state.operation = null;
        return parse(value);
      } catch (error) {
        const abortReason = currentOperation.abortReason;
        if (state.operation === currentOperation) state.operation = null;
        if (terminal(state)) return null;
        if (abortReason === "visibility") {
          await waitUntilVisible(state);
          continue;
        }
        log.error("[quiz] Learning provider operation failed", error);
        const retry = Promise.withResolvers();
        state.retry = retry;
        const message = ["LEVEL_CONFIG_NOT_FOUND", "CONFIGURATION_NOT_FOUND"].includes(error?.code)
          ? CONFIG_ERROR_MESSAGE : ERROR_MESSAGE;
        view.showLoading({ ...progress, message }, {
          onCancel: () => cancel("user"), onRetry: () => retry.resolve(true),
        });
        await retry.promise;
        state.retry = null;
      }
    }
    return null;
  }

  function run(execute, gameContext) {
    if (active) return active.promise;
    if (stopped) return Promise.resolve({ correctCount: 0, questionCount: 0,
      completed: false, cancelled: true, reason: "stopped" });
    const state = { controller: new AbortController(), operation: null, cancelled: false,
      suspended: false, reason: null, retry: null, visibilityWaiter: null, promise: null };
    state.promise = execute(gameContext, state).finally(() => { if (active === state) active = null; });
    active = state;
    return state.promise;
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (!visible) {
      view.dismiss("hidden");
      if (active?.operation) {
        active.operation.abortReason = "visibility";
        active.operation.controller.abort();
      }
    } else {
      active?.visibilityWaiter?.resolve(true);
      active?.retry?.resolve(true);
    }
  }

  function stop() {
    stopped = true;
    cancel("stopped");
  }

  return { available, cancel, retryable, run, setVisible, stop, stopped: () => stopped,
    suspend, terminal, waitUntilVisible };
}
