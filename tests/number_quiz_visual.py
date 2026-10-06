from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Final

from playwright.sync_api import Page, expect

VIEWPORTS: Final = ((390, 844), (812, 375), (1280, 800), (1920, 1080))


def assert_bounded(page: Page) -> None:
    assert page.evaluate("""() => { const d=document.querySelector('#addition-quiz'); const p=d.querySelector('.quiz-view__panel');
      const b=d.getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<=innerHeight && p.scrollWidth<=p.clientWidth; }""")


def assert_prompt_has_no_orphan(page: Page) -> None:
    assert page.evaluate("""() => { const node=document.querySelector('.quiz-view__equation'); const text=node.firstChild;
      const previous=document.createRange(); previous.setStart(text,text.length-2); previous.setEnd(text,text.length-1);
      const last=document.createRange(); last.setStart(text,text.length-1); last.setEnd(text,text.length);
      return Math.abs(previous.getBoundingClientRect().top-last.getBoundingClientRect().top)<1; }""")


def assert_landscape_reachability(page: Page) -> None:
    expect(page.locator(".quiz-view__header")).to_be_in_viewport()
    assert page.evaluate("""() => [...document.querySelectorAll('.quiz-view__question-pane,.quiz-solution')]
      .every(node => node.scrollWidth<=node.clientWidth)""")
    page.get_by_test_id("quiz-submit").scroll_into_view_if_needed()
    expect(page.get_by_test_id("quiz-submit")).to_be_in_viewport()
    page.get_by_test_id("quiz-next").scroll_into_view_if_needed()
    expect(page.get_by_test_id("quiz-next")).to_be_in_viewport()


def fill_fields(page: Page, values: list[str]) -> None:
    fields = page.locator("[data-numeric-field]")
    for index, value in enumerate(values):
        fields.nth(index).fill(value)


def exercise_android_fraction(page: Page, output: Path, formats: tuple[tuple[str, Mapping[str, str | int | list[str]], list[str]], ...]) -> None:
    assert page.evaluate("navigator.userAgent.includes('Android') && navigator.maxTouchPoints > 0")
    fraction = {"format": "fraction", "numeratorLabel": "分子", "denominatorLabel": "分母", "denominatorMin": 1}
    page.evaluate("spec => { qaPromise=qaView.ask(task('fraction',spec),progress); }", fraction)
    numerator = page.locator("[data-numeric-field='0']")
    denominator = page.locator("[data-numeric-field='1']")
    minus = page.get_by_role("button", name="切换负号")
    expect(minus).to_be_enabled()
    numerator.fill("1")
    minus.tap()
    expect(numerator).to_have_value("-1")
    denominator.fill("3")
    denominator.focus()
    expect(minus).to_be_disabled()
    _ = page.screenshot(path=str(output / "android-fraction-denominator-disabled.png"))
    numerator.focus()
    numerator.press("-")
    expect(numerator).to_have_value("1")
    numerator.press("-")
    expect(numerator).to_have_value("-1")
    _ = page.screenshot(path=str(output / "android-fraction-signed.png"))
    page.get_by_test_id("quiz-submit").tap()
    assert page.evaluate("qaPromise.then(intent => JSON.stringify(intent.values)==='[\"-1\",\"3\"]')")
    page.evaluate("qaView.dismiss('android-fraction-complete')")
    for name, spec, _values in formats:
        if name == "fraction":
            continue
        page.evaluate("([name,spec]) => { qaPromise=qaView.ask(task(name,spec),progress); }", [name, spec])
        expect(page.locator("[data-numeric-key='minus']")).to_have_count(0)
        page.evaluate("qaView.dismiss('android-format-complete')")


def exercise_stale_controls(page: Page) -> None:
    page.evaluate("""() => {
      oldPromise=qaView.ask(task('integer',{format:'integer',min:0,max:100}),progress);
      oldSubmit=document.querySelector('[data-testid=quiz-submit]');
      replacementTask=task('digits',{format:'digits',label:'循环节'});
      replacementPromise=qaView.ask(replacementTask,progress);
      replacementSettled=false; replacementPromise.then(() => { replacementSettled=true; });
    }""")
    page.evaluate("oldSubmit.click()")
    assert page.evaluate("""async () => { await Promise.resolve(); return !replacementSettled &&
      document.querySelector('#addition-quiz')?.open && document.querySelector('[data-testid=quiz-equation]')?.textContent==='填写数字答案'; }""")
    page.locator("[data-numeric-field='0']").fill("09")
    page.get_by_test_id("quiz-submit").click()
    assert page.evaluate("replacementPromise.then(intent => JSON.stringify(intent.values)==='[\"09\"]')")
    page.evaluate("qaView.dismiss('stale-control-complete')")


def capture_states(page: Page, output: Path) -> None:
    card = {"stageKey": "CO1", "title": "凑整到100", "examplePrompt": "20+□=100", "exampleAnswer": "80",
            "explanation": "从100里去掉20，空格里应填80。", "scored": False}
    for width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        page.evaluate("card => { cardPromise=qaView.showStageCard(card,progress); }", card)
        assert page.locator("#addition-quiz-timer").count() == 0
        assert_bounded(page)
        if (width, height) == (812, 375):
            expect(page.locator(".quiz-view__header")).to_be_in_viewport()
            expect(page.get_by_test_id("quiz-stage-start")).to_be_in_viewport()
        page.wait_for_timeout(220)
        _ = page.screenshot(path=str(output / f"{width}x{height}-stage-card.png"))
        page.get_by_test_id("quiz-stage-start").click()
        page.evaluate("() => { qaPromise=qaView.ask(task('pair',{format:'pair',labels:['第一个数','第二个数'],ordering:'any'}),progress); }")
        if width >= 1280:
            assert_prompt_has_no_orphan(page)
        fill_fields(page, ["29", "3"])
        page.get_by_test_id("quiz-submit").click()
        page.evaluate("() => { resultPromise=qaView.showResult({status:'graded',correctness:'incorrect',feedback},progress); }")
        if (width, height) == (812, 375):
            assert_landscape_reachability(page)
        else:
            page.locator(".quiz-solution__title").scroll_into_view_if_needed()
        assert_bounded(page)
        page.wait_for_timeout(220)
        _ = page.screenshot(path=str(output / f"{width}x{height}-numeric-feedback.png"))
        page.get_by_test_id("quiz-next").click()
