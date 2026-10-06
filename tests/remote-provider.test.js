import { describe, expect, test } from "bun:test";
import { createRemoteLearningProvider } from "../docs/learning/remote-provider.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

const session = { schemaVersion: 1, status: "active", sessionId: "s", learnerRef: "1",
  plan: { planId: "p", title: "P", subjectId: "math", skillIds: ["addition"] },
  questionCount: 3, completedCount: 0, correctCount: 0, wrongCount: 0,
  challengeRule: { enabled: false, version: 0, perWaveCap: 2, maxWaves: 3, totalCap: 6 },
  saveId: 7, configurationVersion: 2 };
const submission = { schemaVersion: 1, sessionId: "s", taskId: "t", questionId: "q",
  questionVersion: 1, attemptId: "a", response: { type: "skipped", elapsedMs: 5 } };
const result = { schemaVersion: 1, status: "recorded", sessionId: "s", taskId: "t", questionId: "q",
  questionVersion: 1, attemptId: "a", evidenceId: "e", outcome: "skipped",
  progress: { correctCount: 0, wrongCount: 0, completedCount: 1,
    rewardSunCount: 0, rewardSunValue: 0 } };
const taskResponse = { schemaVersion: 1, status: "task", task: { taskId: "t", questionId: "q",
  questionVersion: 1, kind: "single_choice", content: { format: "plain_text", prompt: "1 + 1 = ?" },
  options: ["a", "b", "c", "d"].map(optionId => ({ optionId,
    content: { format: "plain_text", text: optionId } })),
  metadata: { subjectId: "math", skillIds: ["addition"] }, timeLimitMs: 20_000 } };

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

describe("remote learning provider", () => {
  test("binds only create-session to save, omits cookies, and forwards signal", async () => {
    const calls = [];
    const controller = new AbortController();
    const provider = createRemoteLearningProvider({ saveId: 7, storage: new MemoryStorage(),
      fetchImpl: async (path, options) => { calls.push({ path, options }); return response(session); } });
    await provider.createSession({ schemaVersion: 1, requestId: "r", gameSessionId: "g",
      gameContext: { gameId: "pvzge", levelIds: ["tutorial-1"], locale: "zh-CN" } }, { signal: controller.signal });
    expect(JSON.parse(calls[0].options.body).saveId).toBe(7);
    expect(calls[0].options.credentials).toBe("omit");
    expect(calls[0].options.signal).toBe(controller.signal);
  });

  test("persists submission before POST and replays exact payload after reload", async () => {
    const storage = new MemoryStorage();
    const offline = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async path => path.endsWith("get-next-task")
        ? response(taskResponse) : (() => { throw new TypeError("offline"); })() });
    await offline.getNextTask({ schemaVersion: 1, requestId: "next", sessionId: "s" });
    await expect(offline.submitAnswer(submission)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const saved = JSON.parse(storage.getItem("pvzge:learning-submissions:7"));
    expect(saved[0].payload).toEqual(submission);
    const calls = [];
    const online = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async (path, options) => { calls.push({ path, body: JSON.parse(options.body) });
        return path.endsWith("submit-answer") ? response(result) : response(session); } });
    await online.createSession({ schemaVersion: 1, requestId: "r", gameSessionId: "g",
      gameContext: { gameId: "pvzge", levelIds: ["tutorial-1"], locale: "zh-CN" } });
    expect(calls[0].body).toEqual(submission);
    expect(storage.getItem("pvzge:learning-submissions:7")).toBe("[]");
  });

  test("replays a legacy queued choice attempt without persisted task context", async () => {
    const storage = new MemoryStorage();
    storage.setItem("pvzge:learning-submissions:7", JSON.stringify([{ id: submission.attemptId,
      payload: submission }]));
    const calls = [];
    const provider = createRemoteLearningProvider({ saveId: 7, storage,
      fetchImpl: async (path, options) => { calls.push({ path, body: JSON.parse(options.body) });
        return path.endsWith("submit-answer") ? response(result) : response(session); } });
    await provider.createSession({ schemaVersion: 1, requestId: "r", gameSessionId: "g",
      gameContext: { gameId: "pvzge", levelIds: ["tutorial-1"], locale: "zh-CN" } });
    expect(calls[0].body).toEqual(submission);
    expect(storage.getItem("pvzge:learning-submissions:7")).toBe("[]");
  });

  test("rejects malformed and wrong-save responses", async () => {
    for (const payload of [{ ...session, saveId: 8 }, { ...session, completedCount: 4 }]) {
      const provider = createRemoteLearningProvider({ saveId: 7, storage: new MemoryStorage(),
        fetchImpl: async () => response(payload) });
      await expect(provider.createSession({ schemaVersion: 1, requestId: "r", gameSessionId: "g",
        gameContext: { gameId: "pvzge", levelIds: ["x"], locale: "zh-CN" } })).rejects.toThrow();
    }
  });
});
