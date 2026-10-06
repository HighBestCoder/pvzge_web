from __future__ import annotations

import re
from pathlib import Path
from collections.abc import Callable
from typing import Final

from playwright.sync_api import Browser, BrowserContext, Page, Route, expect

URL: Final = "http://127.0.0.1:8080/game/?demo=1"
BATCH_SIZE: Final = 10
SUNS_PER_CORRECT: Final = 5
MENU_READY: Final = """() => {
  const system = globalThis.System;
  if (!system) return false;
  const cc = system.get(system.resolve('cc'));
  const module = system.get('chunks:///_virtual/mainScene.ts');
  const menu = module && cc?.director.getScene()?.getComponentInChildren(module.mainScene);
  return document.documentElement.dataset.learningReady === 'true' &&
    menu?.sceneColor.a === 0 && !menu.haveWindow();
}"""
LEVEL: Final = "chunks:///_virtual/levelController.ts"
UI: Final = "chunks:///_virtual/UI.ts"


def click_game(page: Page, x: int, y: int) -> None:
    page.mouse.move(x, y, steps=5)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.mouse.down()
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.mouse.up()
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def instrument_provider(route: Route) -> None:
    response = route.fetch()
    source = response.text()
    target = "return { createSession, getNextTask, submitAnswer, endSession };"
    replacement = """const provider = { createSession, getNextTask, submitAnswer, endSession };
  for (const name of Object.keys(provider)) {
    const original = provider[name];
    provider[name] = async function(...args) {
      globalThis.__quizProviderCalls.push({name, request: structuredClone(args[0])});
      return Reflect.apply(original, this, args);
    };
  }
  return provider;"""
    assert target in source, "local provider instrumentation seam changed"
    route.fulfill(response=response, body=source.replace(target, replacement))


def fresh_page(browser: Browser, errors: list[str], viewport: tuple[int, int] = (1280, 800)) -> tuple[BrowserContext, Page]:
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
    context.add_init_script("globalThis.__quizProviderCalls = []; globalThis.__quizRewards = [];")
    context.route("**/learning/local-provider.js", instrument_provider)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_function(MENU_READY, timeout=60_000)
    expect(page.locator("#learning-bootstrap-status")).to_be_hidden()
    page.evaluate("""async () => {
      const {createSystemRuntime} = await import('/game/learning/game-bridge.js');
      const runtime = createSystemRuntime();
      const original = runtime.sunflower.produceSun;
      runtime.sunflower.produceSun = function(...args) {
        const nodes = Reflect.apply(original, this, args);
        __quizRewards.push({args, nodes});
        return nodes;
      };
    }""")
    return context, page


def answer(page: Page, correct: bool) -> None:
    page.evaluate("globalThis.__answerDialog = document.getElementById('addition-quiz')")
    prompt = page.get_by_test_id("quiz-equation").inner_text()
    expected = sum(int(value) for value in re.findall(r"\d+", prompt))
    options = page.locator("[data-quiz-option]")
    for index in range(options.count()):
        button = options.nth(index)
        if (button.inner_text() == str(expected)) is correct:
            button.click()
            timer = page.locator("#addition-quiz-timer").inner_text()
            assert page.locator("[data-quiz-option]:not(:disabled)").count() == 0
            expect(page.get_by_test_id("quiz-result")).to_be_visible()
            assert page.evaluate("document.getElementById('addition-quiz') === __answerDialog")
            page.wait_for_timeout(2_000)
            expect(page.get_by_test_id("quiz-result")).to_be_visible()
            expect(page.locator("#addition-quiz-timer")).to_have_text(timer)
            page.get_by_test_id("quiz-next").click()
            page.evaluate("delete globalThis.__answerDialog")
            return
    raise AssertionError(f"No {'correct' if correct else 'wrong'} option for {prompt}")


def assert_question(page: Page, current: int, correct_count: int, output: Path) -> None:
    expect(page.locator("#addition-quiz[open]")).to_be_visible()
    expect(page.get_by_test_id("quiz-progress")).to_have_text(f"第{current}/{BATCH_SIZE}题")
    expect(page.get_by_test_id("quiz-summary")).to_contain_text(
        f"累计奖励{correct_count * SUNS_PER_CORRECT}个阳光（{correct_count * SUNS_PER_CORRECT * 50}点）",
    )
    page.wait_for_timeout(400)
    expect(page.locator("[data-quiz-option]")).to_have_count(4)
    page.screenshot(path=str(output / f"pregame-question-{current}.png"))


def runtime(page: Page, expression: str) -> bool:
    return page.evaluate(f"""async () => {{
      const {{createSystemRuntime}} = await import('/game/learning/game-bridge.js');
      const r = createSystemRuntime(); return ({expression});
    }}""")


def finish_tutorial(page: Page, on_wave_open: Callable[[], None] | None = None) -> None:
    page.wait_for_function(f"""() => {{
      const level = System.get('{LEVEL}').LevelPlay.component;
      const ui = System.get('{UI}').UIInGame.component;
      const cards = System.get('chunks:///_virtual/Cards.ts').Cards.component;
      return level?.gameStarted && ui?.gameStarted && cards?.gameStarted &&
        !level.Tutorial_Point_At_Card && ui.cf_arrow?.activeInHierarchy &&
        cards.cardsUIUpper?.[0]?.selectable && !ui.paused;
    }}""", timeout=60_000)
    click_game(page, 498, 46)
    page.wait_for_function(f"() => System.get('{UI}').UIInGame.component.index === 0")
    click_game(page, 490, 470)
    page.wait_for_function(f"() => !System.get('{LEVEL}').LevelPlay.component.Tutorial_Point_At_Grass")
    for _ in range(8):
        page.wait_for_timeout(2_000)
        for y in range(120, 720, 65):
            for x in range(460, 1200, 80):
                page.mouse.move(x, y, steps=2)
        if runtime(page, "r.sunCount.component.CurrentValue >= 100"):
            break
    click_game(page, 498, 46)
    click_game(page, 577, 470)
    page.wait_for_function(
        f"() => System.get('{LEVEL}').LevelPlay.component.Tutorial_Wave_Stuck === false",
        timeout=30_000,
    )
    if on_wave_open is not None:
        on_wave_open()
    for _ in range(12):
        page.wait_for_timeout(1_000)
        page.mouse.move(440, 100)
        page.mouse.down()
        for y in range(100, 720, 55):
            for x in range(440, 1220, 65):
                page.mouse.move(x, y, steps=2)
        page.mouse.up()
        if page.evaluate(f"""() => {{
          const level = System.get('{LEVEL}').LevelPlay.component;
          const ui = System.get('{UI}').UIInGame.component;
          return !level.Tutorial_Point_At_Card && !level.Tutorial_Point_At_Grass &&
            !ui.cf_arrow?.activeInHierarchy && !ui.cf_tip?.activeInHierarchy;
        }}"""):
            return
    raise AssertionError("first tutorial remained active after planting and collecting native suns")


def render_view_evidence(page: Page, output: Path) -> None:
    page.evaluate("""async () => {
      const {createQuizView} = await import('/game/learning/quiz-view.js');
      globalThis.__qaView = createQuizView();
      globalThis.__fixtureSerial = 0;
      globalThis.__newFixture = (timeLimitMs = 20000) => ({
        taskId:`fixture-task-${++__fixtureSerial}`,questionId:`fixture-question-${__fixtureSerial}`,
        questionVersion:7,kind:'single_choice',content:{format:'plain_text',prompt:'64 + 36 = ?'},
        options:[99,98,100,97].map((n,i)=>({optionId:'opaque-'+i,
          content:{format:'plain_text',text:String(n)}})),
        metadata:{subjectId:'math',skillIds:['addition']},timeLimitMs
      });
      globalThis.__qaProgress = {current:2,total:10,correctCount:1,rewardSunCount:5,
        rewardSunValue:250,challengeRule:{enabled:true,version:1,perWaveCap:2,maxWaves:3,totalCap:6}};
      globalThis.__qaFeedback = {correctOptionId:'opaque-2',correctAnswer:'100',
        explanation:'64 + 36 = 100\\n先算个位，再算十位。'};
    }""")
    states = (("question-1", 1, 0), ("question-2", 2, 1), ("question-10", 10, 9))
    for width, height in ((1280, 800), (768, 1024), (375, 812), (812, 375)):
        page.set_viewport_size({"width": width, "height": height})
        for name, current, correct in states:
            page.evaluate(
                "([current, correct]) => { __qaView.ask(__newFixture(), {current,total:10,correctCount:correct,"
                "rewardSunCount:correct*5,rewardSunValue:correct*250,challengeRule:{enabled:true,version:1,"
                "perWaveCap:2,maxWaves:3,totalCap:6}}); }",
                [current, correct],
            )
            _capture_bounded(page, output / f"view-{width}x{height}-{name}.png")
            page.evaluate("() => __qaView.dismiss('next-fixture')")
        page.evaluate("""() => {
          __qaView.ask(__newFixture(), __qaProgress);
          document.querySelector('[data-quiz-option]').click();
          __qaView.showLoading({...__qaProgress,message:'正在判题'}, {onCancel(){}});
        }""")
        _capture_bounded(page, output / f"view-{width}x{height}-pending.png")
        page.evaluate("() => __qaView.dismiss('next-fixture')")
        page.evaluate("""() => {
          __qaView.ask(__newFixture(), __qaProgress);
          document.querySelector('[data-quiz-option]').click();
          __qaView.showLoading({...__qaProgress,message:'服务暂不可用'}, {onCancel(){},onRetry(){}});
        }""")
        _capture_bounded(page, output / f"view-{width}x{height}-error.png")
        page.evaluate("() => __qaView.dismiss('next-fixture')")
        for name, selector, result in (
            ("correct", "[data-quiz-option='opaque-2']", {"status": "graded", "correctness": "correct"}),
            ("wrong", "[data-quiz-option='opaque-0']", {"status": "graded", "correctness": "incorrect"}),
        ):
            page.evaluate("""([selector, result]) => {
              __qaView.ask(__newFixture(), __qaProgress);
              document.querySelector(selector).click();
              __qaContinueCount = 0;
              __qaView.showResult({...result,feedback:__qaFeedback}, __qaProgress)
                .then(() => { __qaContinueCount += 1; });
            }""", [selector, result])
            assert page.locator(".quiz-view__option--correct").get_attribute("data-quiz-option") == "opaque-2"
            if name == "correct":
                assert page.locator(".quiz-view__option--incorrect").count() == 0
            else:
                expect(page.locator("[data-quiz-option='opaque-0']")).to_have_class(
                    re.compile(r"quiz-view__option--incorrect"),
                )
            _capture_result_and_continue(page, output, width, height, name)
        page.evaluate("""async () => {
          await __qaView.ask(__newFixture(80), __qaProgress);
          __qaContinueCount = 0;
          __qaView.showResult({status:'recorded',outcome:'timed_out',feedback:__qaFeedback}, __qaProgress)
            .then(() => { __qaContinueCount += 1; });
        }""")
        assert page.locator(".quiz-view__option--incorrect").count() == 0
        assert page.locator(".quiz-view__option--selected").count() == 0
        assert page.locator(".quiz-view__option--correct").get_attribute("data-quiz-option") == "opaque-2"
        expect(page.locator(".quiz-solution__title")).to_have_text("本题已超时")
        expect(page.locator(".quiz-solution__detail")).to_have_text("本题不计分")
        expect(page.get_by_role("button", name="跳过本题", exact=True)).to_have_text("跳过本题")
        _capture_result_and_continue(page, output, width, height, "timeout")
    page.evaluate("() => __qaView.dismiss('evidence-complete')")


def _capture_result_and_continue(
    page: Page,
    output: Path,
    width: int,
    height: int,
    name: str,
) -> None:
    progress = page.get_by_test_id("quiz-progress").inner_text()
    _capture_bounded(page, output / f"view-{width}x{height}-{name}.png")
    page.wait_for_timeout(2_000)
    assert page.evaluate("__qaContinueCount") == 0
    expect(page.get_by_test_id("quiz-progress")).to_have_text(progress)
    expect(page.get_by_test_id("quiz-result")).to_be_visible()
    next_button = page.get_by_test_id("quiz-next")
    next_button.scroll_into_view_if_needed()
    expect(next_button).to_be_visible()
    if width <= 720 or height <= 520:
        page.screenshot(path=str(output / f"view-{width}x{height}-{name}-next-visible.png"))
    next_button.click()
    expect(page.locator("#addition-quiz[open]")).to_have_count(0)
    page.wait_for_function("() => __qaContinueCount === 1")
    assert page.evaluate("__qaContinueCount") == 1


def _capture_bounded(page: Page, path: Path) -> None:
    page.wait_for_timeout(400)
    assert page.evaluate("""() => {
      const box = document.getElementById('addition-quiz').getBoundingClientRect();
      const panel = document.querySelector('.quiz-view__panel');
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
        panel.scrollWidth <= panel.clientWidth;
    }"""), f"quiz overflow at {page.viewport_size}"
    page.screenshot(path=str(path))
