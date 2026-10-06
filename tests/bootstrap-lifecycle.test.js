import { describe, expect, test } from "bun:test";

import { createBootstrapLifecycle, createPagehideHandler } from "../docs/learning/bootstrap-lifecycle.js";

describe("bootstrap lifecycle", () => {
  test("pagehide suspends resumable learning without explicit terminal stop", () => {
    const calls = [];
    const onVisibility = () => {};
    const handler = createPagehideHandler({
      document: { removeEventListener(type, listener) { calls.push([type, listener]); } }, onVisibility,
      nativeProfile: { stop() { calls.push("profile"); } },
      nativeStart: { stop() { calls.push("native-start"); } },
      nativeSync: { flush() { calls.push("sync"); } }, reporter: { pagehide() { calls.push("reporter"); } },
      entry: { suspend() { calls.push("suspend"); }, stop() { calls.push("stop"); } },
    });

    handler();

    expect(calls).toEqual([["visibilitychange", onVisibility], "profile", "native-start", "sync", "reporter", "suspend"]);
  });

  test("retries a rejected game import and installs the wrapper once", async () => {
    let imports = 0;
    let installs = 0;
    const lifecycle = createBootstrapLifecycle({
      importGame: async () => {
        imports += 1;
        if (imports === 1) throw new Error("load failed");
      },
      waitForTargets: async () => ({ keys: {}, level: {}, MainScene: class {}, player: {}, cc: {} }),
      installHook: async () => { installs += 1; },
    });

    await expect(lifecycle.install()).rejects.toThrow("load failed");
    await Promise.all([lifecycle.install(), lifecycle.install()]);

    expect(imports).toBe(2);
    expect(installs).toBe(1);
  });
});
