#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.51,<2"]
# ///

# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Start the app at http://127.0.0.1:8080.
# 3. Run: uv run tests/quiz-smoke.py
# ──────────────────

from __future__ import annotations

import tempfile
from pathlib import Path

from browser_helpers import (
    BATCH_SIZE,
    LEVEL,
    answer,
    assert_question,
    click_game,
    finish_tutorial,
    fresh_page,
    render_view_evidence,
    runtime,
)
from playwright.sync_api import Browser, Page, expect, sync_playwright


def provider_count(page: Page, name: str) -> int:
    return page.evaluate("name => __quizProviderCalls.filter(call => call.name === name).length", name)


def verify_reward(page: Page) -> None:
    page.wait_for_function("() => __quizRewards.flatMap(call => call.nodes).length >= 10", timeout=30_000)
    observation = page.evaluate("""async () => {
       const {createSystemRuntime} = await import('/game/learning/game-bridge.js');
      const r = createSystemRuntime();
      const rewardCalls = __quizRewards.filter(({args}) => args[0] === 50 &&
        [40, 52].includes(args[2]) && args[3] === false);
      const nodes = rewardCalls.flatMap(({nodes}) => nodes);
      return {count: nodes.length, distinct: new Set(nodes).size,
        heights: rewardCalls.map(({args}) => args[2]),
        countProduction: rewardCalls.map(({args}) => args[3]),
        valid: nodes.every(node => r.valid(node) && node.value === 50 && !node.collected)};
    }""")
    assert observation == {"count": 10, "distinct": 10, "heights": [40] * 5 + [52] * 5,
                           "countProduction": [False] * 10, "valid": True}, observation
    delta = page.evaluate("""async () => {
      const {createSystemRuntime} = await import('/game/learning/game-bridge.js');
      const r = createSystemRuntime(); const before = r.sunCount.component.CurrentValue;
      __quizRewards.filter(({args}) => args[0] === 50 && [40,52].includes(args[2]) && args[3] === false)
        .flatMap(({nodes}) => nodes).forEach(node => node.collect());
      return r.sunCount.component.CurrentValue - before;
    }""")
    assert delta == 500, f"collecting ten reward suns changed counter by {delta}"


def happy_path(browser: Browser, output: Path, errors: list[str]) -> None:
    context, page = fresh_page(browser, errors)
    try:
        assert page.locator("#addition-quiz[open]").count() == 0
        assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
        click_game(page, 640, 724)
        assert_question(page, 1, 0, output)
        assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
        answer(page, True)
        assert_question(page, 2, 1, output)
        assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
        answer(page, True)
        for current in range(3, BATCH_SIZE + 1):
            assert_question(page, current, 2, output)
            assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
            answer(page, False)
        expect(page.locator("#addition-quiz[open]")).to_have_count(0)
        assert provider_count(page, "getNextTask") == BATCH_SIZE
        assert provider_count(page, "submitAnswer") == BATCH_SIZE
        page.wait_for_function(f"() => System.get('{LEVEL}').LevelPlay.component?.gameStarted", timeout=60_000)
        finish_tutorial(page, lambda: verify_reward(page))
        page.screenshot(path=str(output / "battle-ten-suns.png"))
        calls_before = len(page.evaluate("__quizProviderCalls"))
        render_view_evidence(page, output)
        page.wait_for_timeout(75_000)
        assert len(page.evaluate("__quizProviderCalls")) == calls_before
        assert page.locator("#addition-quiz[open]").count() == 0
        assert not runtime(page, "r.level.gameLost || r.level.gameOver")
    finally:
        page.screenshot(path=str(output / "happy-last-state.png"))
        context.close()


def zero_reward_path(browser: Browser, output: Path, errors: list[str]) -> None:
    context, page = fresh_page(browser, errors)
    try:
        click_game(page, 640, 724)
        assert_question(page, 1, 0, output / "zero")
        expect(page.locator("#addition-quiz-timer")).to_contain_text("20")
        page.wait_for_timeout(1_100)
        assert "20" not in page.locator("#addition-quiz-timer").inner_text()
        expect(page.get_by_test_id("quiz-result")).to_be_visible(timeout=22_000)
        page.wait_for_timeout(2_000)
        expect(page.get_by_test_id("quiz-progress")).to_have_text("第1/10题")
        page.get_by_test_id("quiz-next").click()
        expect(page.get_by_test_id("quiz-progress")).to_have_text("第2/10题")
        assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
        for current in range(2, BATCH_SIZE + 1):
            if current == BATCH_SIZE:
                expect(page.get_by_test_id("quiz-progress")).to_have_text("第10/10题")
            assert runtime(page, "!r?.level?.gameStarted && !r?.gaming")
            page.get_by_role("button", name="跳过本题").click()
            expect(page.get_by_test_id("quiz-result")).to_be_visible()
            page.get_by_test_id("quiz-next").click()
        page.wait_for_function(f"() => System.get('{LEVEL}').LevelPlay.component?.gameStarted", timeout=60_000)
        page.wait_for_timeout(1_000)
        assert provider_count(page, "getNextTask") == BATCH_SIZE
        assert provider_count(page, "submitAnswer") == BATCH_SIZE
        assert page.evaluate("__quizRewards.flatMap(call => call.nodes).length") == 0
        page.screenshot(path=str(output / "zero-reward-battle.png"))
    finally:
        page.screenshot(path=str(output / "zero-last-state.png"))
        context.close()


def main() -> None:
    output = Path(tempfile.mkdtemp(prefix="pvz-pregame-evidence-"))
    (output / "zero").mkdir()
    errors: list[str] = []
    print(f"Evidence: {output}")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            happy_path(browser, output, errors)
            zero_reward_path(browser, output, errors)
            assert not errors, f"browser page errors: {errors}"
        finally:
            browser.close()
    print("PASS: real ten-question gate, +500 collectible reward, tutorial/75s stability, zero-reward timeout branch, responsive view evidence")


if __name__ == "__main__":
    main()
