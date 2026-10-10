import { describe, expect, test } from "bun:test";

import { formatRemaining } from "../docs/learning/quiz-view-render.js";

describe("question countdown text", () => {
  test("shows seconds under a minute and minutes once a minute or more is left", () => {
    expect(formatRemaining(20_000)).toBe("剩余20秒");
    expect(formatRemaining(59_001)).toBe("剩余1分00秒");
    expect(formatRemaining(1_200_000)).toBe("剩余20分00秒");
    expect(formatRemaining(1_145_200)).toBe("剩余19分06秒");
    expect(formatRemaining(-5)).toBe("剩余0秒");
  });
});
