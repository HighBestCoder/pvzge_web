const QUESTION_DURATION_MS = 20_000;

export default QUESTION_DURATION_MS;

export function createTimedAttempt({
  durationMs = QUESTION_DURATION_MS,
  now = () => performance.now(),
  onSettle,
  onUpdate,
  setDue = setTimeout,
  clearDue = clearTimeout,
  setUpdate = setInterval,
  clearUpdate = clearInterval,
  updateMs = 100,
}) {
  const deadline = now() + durationMs;
  let settled = false;
  let dueId;
  let updateId;

  const remainingMs = () => Math.max(0, deadline - now());
  const update = () => {
    if (!settled) onUpdate(remainingMs());
  };
  const settle = (value) => {
    if (settled) return false;
    settled = true;
    clearDue(dueId);
    clearUpdate(updateId);
    onSettle(value);
    return true;
  };
  const expire = () => {
    if (settled) return;
    const remaining = remainingMs();
    if (remaining === 0) {
      settle(null);
    } else {
      dueId = setDue(expire, remaining);
    }
  };

  update();
  dueId = setDue(expire, durationMs);
  updateId = setUpdate(update, updateMs);

  return {
    answer(value) {
      return settle(now() >= deadline ? null : value);
    },
    dismiss(value = null) {
      return settle(value);
    },
  };
}
