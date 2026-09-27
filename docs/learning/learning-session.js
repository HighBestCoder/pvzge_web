export const PROVIDER_TIMEOUT_MS = 10_000;

// A timed-out submission has an unknown recording state. Durable recovery should
// persist and retry its unchanged attemptId in a future remote-provider layer.

function abortError(message) {
  return new DOMException(message, "AbortError");
}

export function callProvider(operation, request, {
  signal,
  timeoutMs = PROVIDER_TIMEOUT_MS,
  onLateValue,
} = {}) {
  const controller = new AbortController();
  let timer;
  let settled = false;
  let rejectAbort;
  let removeParent = () => {};
  const abortFromParent = () => {
    controller.abort(signal?.reason);
    rejectAbort?.(abortError("Provider operation aborted"));
  };
  if (signal?.aborted) controller.abort(signal.reason);
  else if (signal) {
    signal.addEventListener("abort", abortFromParent, { once: true });
    removeParent = () => signal.removeEventListener("abort", abortFromParent);
  }

  const providerPromise = Promise.resolve().then(() => operation(request, { signal: controller.signal }));
  providerPromise.then(
    (value) => { if (settled) onLateValue?.(value); },
    () => {},
  );
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(abortError("Provider operation timed out"));
      reject(abortError("Provider operation timed out"));
    }, timeoutMs);
  });
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    rejectAbort = reject;
    if (signal.aborted) reject(abortError("Provider operation aborted"));
  });
  return Promise.race([providerPromise, deadline, aborted]).finally(() => {
    settled = true;
    clearTimeout(timer);
    removeParent();
  });
}

export function createRequestFactory(id = () => crypto.randomUUID()) {
  return (prefix) => `${prefix}-${id()}`;
}
