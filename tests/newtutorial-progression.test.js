import { describe, expect, test } from "bun:test";

import { shouldDeferTutorialReward } from "../docs/learning/newtutorial-progression.js";

describe("tutorial reward progression gate", () => {
  test("defers bonus suns while tutorial one owns the native wave gate", () => {
    const level = { Tutorial_Wave_Stuck: true };
    const runtime = { level, levelId: ["tutorial1"] };

    const deferred = shouldDeferTutorialReward(runtime);

    expect(deferred).toBe(true);
    expect(level).toEqual({ Tutorial_Wave_Stuck: true });
  });

  test("releases bonus suns after tutorial one naturally opens its wave gate", () => {
    const runtime = { level: { Tutorial_Wave_Stuck: false }, levelId: ["tutorial1"] };

    const deferred = shouldDeferTutorialReward(runtime);

    expect(deferred).toBe(false);
  });

  test("does not delay rewards in ordinary levels", () => {
    const runtime = { level: { Tutorial_Wave_Stuck: true }, levelId: ["egypt1"] };

    const deferred = shouldDeferTutorialReward(runtime);

    expect(deferred).toBe(false);
  });
});
