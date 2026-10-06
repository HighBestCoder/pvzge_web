const LABELS = { loading: "正在验证存档", synced: "已同步", pending: "等待同步", recovered: "正在恢复未同步进度",
  error: "同步失败，将自动重试", conflict: "同步冲突，请重新加载页面" };

export function createStatusPanel(root = document) {
  const panel = root.getElementById("pvz-learning-status");
  const identity = panel?.querySelector("[data-save-identity]");
  const sync = panel?.querySelector("[data-sync-status]");
  const error = root.getElementById("learning-bootstrap-status");
  return {
    setIdentity(account, save) {
      if (identity) identity.textContent = `${save.child.name} / ${save.name}`;
    },
    setDemo() { if (identity) identity.textContent = "模拟练习"; },
    setSync(status) {
      if (sync) { sync.textContent = LABELS[status] ?? status; sync.dataset.state = status; }
      if (status === "conflict") this.showError(LABELS.conflict, false);
    },
    showError(message, retry = true) {
      if (!error) return;
      error.hidden = false;
      const text = error.querySelector("[data-learning-message]");
      if (text) text.textContent = message;
      error.querySelector("[data-learning-retry]")?.toggleAttribute("hidden", !retry);
    },
    clearError() { if (error) error.hidden = true; },
  };
}
