import { afterEach, describe, expect, test } from "bun:test";

import { configureApiAuth, requestJson } from "../docs/learning/api-client.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => configureApiAuth(null));

describe("play API authentication", () => {
  test("injects the configured bearer and omits cookies for same-origin API requests", async () => {
    const calls = [];
    configureApiAuth("child-token");

    await requestJson("/api/play/context", {
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return json({ account: { id: 3 }, save: { id: 7 } });
      },
    });

    expect(calls[0].options.credentials).toBe("omit");
    expect(calls[0].options.headers.Authorization).toBe("Bearer child-token");
  });

  test("captures the token at request start when auth is reconfigured in another selection", async () => {
    let release;
    let capturedHeaders;
    configureApiAuth("old-token");
    const pending = requestJson("/api/play/context", {
      fetchImpl: async (_path, options) => {
        capturedHeaders = options.headers;
        return new Promise((resolve) => { release = () => resolve(json({ ok: true })); });
      },
    });

    while (!release) await Promise.resolve();
    configureApiAuth("new-token");
    release();
    await pending;

    expect(capturedHeaders.Authorization).toBe("Bearer old-token");
  });

  test("emits authorization-required with the captured token on 401", async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    globalThis.addEventListener("play:authorization-required", listener);
    configureApiAuth("expired-token");

    await expect(requestJson("/api/game-runs", {
      fetchImpl: async () => json({ error: { code: "AUTH_REQUIRED", message: "expired" } }, 401),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });

    globalThis.removeEventListener("play:authorization-required", listener);
    expect(events).toEqual([{ token: "expired-token" }]);
  });

  test("emits authorization-required before parsing a malformed 401 response", async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    globalThis.addEventListener("play:authorization-required", listener);
    configureApiAuth("expired-token");

    await expect(requestJson("/api/play/context", {
      fetchImpl: async () => new Response("not-json", { status: 401 }),
    })).rejects.toMatchObject({ code: "INVALID_JSON", status: 401 });

    globalThis.removeEventListener("play:authorization-required", listener);
    expect(events).toEqual([{ token: "expired-token" }]);
  });
});
