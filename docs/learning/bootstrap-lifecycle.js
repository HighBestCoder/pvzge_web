export function createBootstrapLifecycle({ importGame, waitForTargets, installHook }) {
  let importPromise = null;
  let installPromise = null;
  let installed = false;

  function ensureGameImported() {
    if (!importPromise) {
      importPromise = Promise.resolve().then(importGame).catch((error) => {
        importPromise = null;
        throw error;
      });
    }
    return importPromise;
  }

  function install() {
    if (installed) return Promise.resolve();
    if (installPromise) return installPromise;
    installPromise = (async () => {
      await ensureGameImported();
      const targets = await waitForTargets();
      if (installed) return;
      await installHook(targets);
      installed = true;
    })().finally(() => { installPromise = null; });
    return installPromise;
  }

  return { install };
}

export function createPagehideHandler({ document, onVisibility, nativeProfile, nativeStart, nativeSync, reporter, entry }) {
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    nativeProfile?.stop();
    nativeStart?.stop();
    nativeSync?.flush();
    reporter?.pagehide();
    entry?.suspend();
  };
}
