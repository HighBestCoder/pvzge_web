# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.51,<2"]
# ///
"""Run with uv run tests/quiz-smoke.py while the local server is running."""

import os
import re
import tempfile
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright


def click_game(page: Page, x: int, y: int) -> None:
    """Let Cocos process cursor movement before the following click."""
    page.mouse.move(x, y, steps=5)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.mouse.down()
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.mouse.up()
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def main() -> None:
    """Verify a real tutorial reward, then exercise the isolated dialog states."""
    output = Path(tempfile.mkdtemp(prefix="pvz-quiz-evidence-"))
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(os.environ.get("PVZ_URL", "http://127.0.0.1:8080/"))
            page.wait_for_function("""() => {
              const cc = System.get(System.resolve('cc'));
              const m = System.get('chunks:///_virtual/mainScene.ts');
              const menu = m && cc?.director.getScene()?.getComponentInChildren(m.mainScene);
              return menu?.sceneColor.a === 0 && !menu.haveWindow();
            }""", timeout=60000)
            assert page.locator("#addition-quiz[open]").count() == 0
            click_game(page, 640, 724)
            page.wait_for_function("""() => {
              const level = System.get('chunks:///_virtual/levelController.ts').LevelPlay.component;
              const ui = System.get('chunks:///_virtual/UI.ts').UIInGame.component;
              const cards = System.get('chunks:///_virtual/Cards.ts').Cards.component;
              return level?.gameStarted && ui?.gameStarted && cards?.gameStarted &&
                !level.Tutorial_Point_At_Card && ui.cf_arrow?.activeInHierarchy &&
                cards.cardsUIUpper?.[0]?.selectable && cards.CFs?.[0]?.ca?.getSelectable() &&
                !ui.paused && !ui.indexLocked && ui.MouseClickCoolingDown === 0;
            }""", timeout=60000)
            page.wait_for_function("""() =>
              System.get('chunks:///_virtual/KeyListener.ts').KeyListener.cp.screenSplash.opacity === 0
            """)
            assert page.locator("#addition-quiz[open]").count() == 0
            click_game(page, 498, 46)
            page.wait_for_function("() => System.get('chunks:///_virtual/UI.ts').UIInGame.component.index === 0")
            click_game(page, 490, 470)
            page.wait_for_function("""() =>
              !System.get('chunks:///_virtual/levelController.ts').LevelPlay.component.Tutorial_Point_At_Grass
            """)
            for _ in range(8):
                page.wait_for_timeout(2000)
                for y in range(120, 720, 65):
                    for x in range(460, 1200, 80):
                        page.mouse.move(x, y, steps=2)
                if page.evaluate("""() =>
                  System.get('chunks:///_virtual/SunCount.ts').SunCount.component.CurrentValue >= 100
                """):
                    break
            click_game(page, 498, 46)
            click_game(page, 577, 470)
            page.mouse.move(40, 740)
            page.wait_for_function("""async () => {
              const m = await import('/learning/game-bridge.js');
              return m.createGameBridge().isEligible();
            }""", timeout=20000)
            # Observe real factory output without replacing its behavior.
            page.evaluate("""async () => {
              const m = await import('/learning/game-bridge.js');
              const r = m.createSystemRuntime();
              window.quizRewards = [];
              const original = r.sunflower.produceSun;
              r.sunflower.produceSun = function(...args) {
                const suns = original.apply(this, args);
                if (args[0] === 50 && args[2] === 40 && args[3] === false) quizRewards.push(...suns);
                return suns;
              };
            }""")
            expect(page.locator("#addition-quiz[open]")).to_be_visible(timeout=40000)
            assert page.evaluate("""async () => {
              const {createSystemRuntime} = await import('/learning/game-bridge.js');
              const r = createSystemRuntime(); return r.ui.paused && r.cc.director.gameSpeed === 0;
            }""")
            page.screenshot(path=str(output / "natural-question.png"))
            equation = page.locator('[data-testid="quiz-equation"]').inner_text()
            answer = sum(int(value) for value in re.findall(r"\d+", equation))
            # Duplicate DOM clicks are intentional: settlement must be idempotent.
            page.get_by_role("button", name=str(answer), exact=True).evaluate("button => {button.click(); button.click();}")
            expect(page.locator("#addition-quiz[open]")).to_have_count(0)
            page.mouse.move(40, 740)
            page.wait_for_timeout(300)
            assert page.evaluate("""async () => {
              const {createSystemRuntime} = await import('/learning/game-bridge.js');
              const r = createSystemRuntime();
              return quizRewards.length === 5 && new Set(quizRewards).size === 5 &&
                quizRewards.every(s => r.valid(s) && s.value === 50 && !s.collected) &&
                !r.ui.paused && r.cc.director.gameSpeed > 0;
            }""")
            page.screenshot(path=str(output / "natural-five-suns.png"))
            assert page.evaluate("""async () => {
              const {createSystemRuntime} = await import('/learning/game-bridge.js');
              const r = createSystemRuntime(); const before = r.sunCount.component.CurrentValue;
              quizRewards.forEach(s => s.collect());
              return r.sunCount.component.CurrentValue - before === 250;
            }""")
            # Shorten only the test scheduler's clock; keep real game and reward APIs.
            page.evaluate("""async () => {
              const {createGameBridge} = await import('/learning/game-bridge.js');
              const {createQuizView} = await import('/learning/quiz-view.js');
              const {createQuizController} = await import('/learning/quiz-controller.js');
              const {createLocalLearningProvider} = await import('/learning/local-provider.js');
              window.lastIntent = null;
              window.exerciseQuiz = async () => {
                const local = createLocalLearningProvider();
                const provider = {...local, submitAnswer: async (...args) => {
                  window.lastIntent = args[0].response; return local.submitAnswer(...args);
                }};
                const controller = createQuizController({provider, bridge: createGameBridge(), view: createQuizView(), firstDelayMs: 1});
                await controller.tick(0);
                window.exerciseDone = controller.tick(1).finally(() => controller.stop());
              };
            }""")
            for action in ["wrong", "skip", "timeout"]:
                page.evaluate("() => exerciseQuiz()")
                expect(page.locator("#addition-quiz[open]")).to_be_visible()
                if action == "wrong":
                    prompt = page.locator('[data-testid="quiz-equation"]').inner_text()
                    correct = sum(int(value) for value in re.findall(r"\d+", prompt))
                    for button in page.locator("[data-quiz-option]").all():
                        if button.inner_text() != str(correct):
                            button.click()
                            break
                elif action == "skip":
                    page.get_by_role("button", name="暂时跳过").click()
                else:
                    expect(page.locator("#addition-quiz-timer")).to_contain_text("20")
                    page.wait_for_timeout(1100)
                    assert "20" not in page.locator("#addition-quiz-timer").inner_text()
                    page.screenshot(path=str(output / "natural-countdown.png"))
                    expect(page.locator("#addition-quiz[open]")).to_have_count(0, timeout=22000)
                page.evaluate("() => exerciseDone")
                expected_type = {"wrong": "answered", "skip": "skipped", "timeout": "timed_out"}[action]
                assert page.evaluate("lastIntent.type") == expected_type
                page.wait_for_function("""() =>
                  System.get(System.resolve('cc')).director.gameSpeed > 0
                """)
                assert page.evaluate("""async () => {
                  const m = await import('/learning/game-bridge.js');
                  return !m.createSystemRuntime().ui.paused && quizRewards.length === 5;
                }""")
            # Hold a player-owned native pause for isolated responsive UI checks.
            page.evaluate("""async () => {
              const m = await import('/learning/game-bridge.js'); m.createSystemRuntime().ui.pauseMenu();
              const {createQuizView} = await import('/learning/quiz-view.js'); window.qaView = createQuizView();
              window.fixture = {taskId:'fixture-task',questionId:'fixture-question',questionVersion:7,
                kind:'single_choice',content:{format:'plain_text',prompt:'64 + 36 = ?'},
                options:[99,98,100,97].map((n,i)=>({optionId:'opaque-'+i,content:{format:'plain_text',text:String(n)}})),
                metadata:{subjectId:'math',skillIds:['addition']},timeLimitMs:20000};
            }""")
            for width, height in [(1280, 800), (768, 1024), (375, 812), (812, 375)]:
                page.set_viewport_size({"width": width, "height": height})
                for state, choice in [("question", None), ("correct", 100), ("wrong", 99)]:
                    page.evaluate("""() => {
                      window.qaResult = 'pending';
                      qaView.ask(fixture)
                        .then(result => {window.qaResult = result;});
                    }""")
                    page.wait_for_timeout(250)
                    assert page.evaluate("""() => {
                      const d = document.getElementById('addition-quiz').getBoundingClientRect();
                      const panel = document.querySelector('.quiz-view__panel');
                      return d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight &&
                        panel.scrollWidth <= panel.clientWidth;
                    }""")
                    page.screenshot(path=str(output / f"{width}-{height}-{state}.png"))
                    if choice is not None:
                        page.get_by_role("button", name=str(choice), exact=True).click()
                        assert page.evaluate("qaResult.type") == "answered"
                        assert page.evaluate("qaResult.optionId") == ("opaque-2" if choice == 100 else "opaque-0")
                    else:
                        page.keyboard.press("Escape")
                        assert page.evaluate("qaResult.type") == "skipped"
                    assert page.evaluate("""async () => {
                      const m = await import('/learning/game-bridge.js');
                      return m.createSystemRuntime().ui.paused && quizRewards.length === 5;
                    }""")
            page.evaluate("""() => {
              qaView.ask(fixture).then(value => {window.replacedResult = value;});
              qaView.ask(fixture).then(value => {window.replacementResult = value;});
            }""")
            page.wait_for_timeout(300)
            expect(page.locator("#addition-quiz[open]")).to_have_count(1)
            assert page.evaluate("replacedResult.type") == "cancelled"
            page.locator('[data-quiz-option="opaque-2"]').click()
            assert page.evaluate("replacementResult.optionId") == "opaque-2"
            page.evaluate("""() => {
              qaView.ask({...fixture,content:{format:'plain_text',prompt:'请选择与“苹果”对应的英文单词。'},
                options:['Apple','Orange','Banana','Grape'].map((text,i)=>({optionId:'word-'+i,content:{format:'plain_text',text}}))})
                .then(value=>{window.wordResult=value;});
            }""")
            page.screenshot(path=str(output / "non-math-question.png"))
            page.get_by_role("button", name="Apple", exact=True).click()
            assert page.evaluate("wordResult.optionId") == "word-0"
            assert not errors, errors
            print(f"PASS: immediate answer, 5 collectible suns, +250, duplicate click, wrong/skip/20s timeout no reward, 12 responsive checks, Escape, manual pause, replacement. Evidence: {output}")
        finally:
            page.screenshot(path=str(output / "last-state.png"))
            print(f"Evidence: {output}")
            browser.close()


if __name__ == "__main__":
    main()
