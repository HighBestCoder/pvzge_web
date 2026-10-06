#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.51,<2"]
# ///

# ─── How to run ───
# uv run tests/number-quiz-smoke.py --evidence-dir ../.omo/evidence/number-training/run-20261004/task-8-ui
# Uses installed system Chrome; no browser download and no live database.
# ──────────────────

from __future__ import annotations

import json
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final, override

from playwright.sync_api import Page, expect, sync_playwright

from number_quiz_visual import (
    capture_states,
    exercise_android_fraction,
    exercise_stale_controls,
    fill_fields,
)

ROOT: Final = Path(__file__).resolve().parents[1]
FORMATS: Final = (
    ("integer", {"format": "integer", "min": 0, "max": 100}, ["0"]),
    ("decimal", {"format": "decimal", "min": "0", "max": "100"}, ["18.50"]),
    ("digits", {"format": "digits", "label": "最短循环节"}, ["09"]),
    ("fraction", {"format": "fraction", "numeratorLabel": "分子", "denominatorLabel": "分母", "denominatorMin": 1}, ["-1", "3"]),
    ("pair", {"format": "pair", "labels": ["第一个数", "第二个数"], "ordering": "any"}, ["29", "3"]),
)


class QuietHandler(SimpleHTTPRequestHandler):
    @override
    def log_message(self, format: str, *args: object) -> None:
        del format, args


def serve() -> tuple[ThreadingHTTPServer, str]:
    handler = partial(QuietHandler, directory=str(ROOT / "docs"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    return server, f"http://127.0.0.1:{port}/"


def install_harness(page: Page) -> None:
    page.set_content("<link rel='stylesheet' href='/learning/quiz.css'><link rel='stylesheet' href='/learning/quiz-solution.css'><link rel='stylesheet' href='/learning/quiz-input.css'>")
    page.evaluate("""async () => {
      const {createQuizView} = await import('/learning/quiz-view.js');
      globalThis.qaView = createQuizView(); globalThis.serial = 0;
      globalThis.task = (format, inputSpec, limit = 120000) => ({
        taskId:`task-${++serial}`,questionId:`question-${serial}`,questionVersion:1,kind:'numeric_entry',
        content:{format:'plain_text',prompt:'填写数字答案'},inputSpec,
        metadata:{subjectId:'math',skillIds:['number'],tableId:'CO',stageKey:'CO1',direction:'forward'},timeLimitMs:limit});
      globalThis.progress = {current:1,total:15,correctCount:0,rewardSunCount:0,rewardSunValue:0};
      globalThis.feedback = {correctAnswer:'29 和 3',explanation:'这是一段足够长的题解，用来验证窄屏、横屏和软键盘出现时仍能滚动阅读。\\n第二行保留换行，并且不会覆盖输入草稿。'};
    }""")


def exercise_fifteen_task_batch(page: Page, output: Path) -> None:
    page.evaluate("""async () => {
      const {createQuizController} = await import('/learning/quiz-controller.js');
      const specs=[
        {format:'integer',min:0,max:100},{format:'decimal',min:'0',max:'100'},
        {format:'digits',label:'循环节'},{format:'fraction',numeratorLabel:'分子',denominatorLabel:'分母',denominatorMin:1},
        {format:'pair',labels:['第一个数','第二个数'],ordering:'any'}];
      globalThis.batchCalls={next:0,submit:0,end:0};
      const provider={
        async createSession(){return {schemaVersion:1,status:'active',sessionId:'batch',learnerRef:'learner',
          plan:{planId:'p',title:'数字训练',subjectId:'math',skillIds:['number']},questionCount:15,completedCount:0,
          correctCount:0,wrongCount:0,saveId:1,configurationVersion:1,
          challengeRule:{enabled:false,version:0,perWaveCap:2,maxWaves:3,totalCap:6},
          stageCard:{stageKey:'CO1',title:'凑整到100',examplePrompt:'20+□=100',exampleAnswer:'80',
            explanation:'从100里去掉20，空格里应填80。',scored:false}}},
        async getNextTask(){const index=batchCalls.next++; return {schemaVersion:1,status:'task',task:{
          taskId:`batch-${index}`,questionId:`q-${index}`,questionVersion:1,kind:'numeric_entry',
          content:{format:'plain_text',prompt:`第${index+1}题：填写数字`},inputSpec:specs[index%5],
          metadata:{subjectId:'math',skillIds:['number'],tableId:'CO',stageKey:'CO1',direction:index%2?'reverse':'forward'},
          timeLimitMs:120000}}},
        async submitAnswer(request){batchCalls.submit++; return {schemaVersion:1,status:'graded',sessionId:'batch',
          taskId:request.taskId,questionId:request.questionId,questionVersion:1,attemptId:request.attemptId,
          evidenceId:`e-${batchCalls.submit}`,correctness:'correct',progress:{correctCount:batchCalls.submit,wrongCount:0,
            completedCount:batchCalls.submit,rewardSunCount:batchCalls.submit*5,rewardSunValue:batchCalls.submit*250},
          feedback:{correctAnswer:'示例答案',explanation:'服务端已完成判定。'}}},
        async endSession(){batchCalls.end++; return {schemaVersion:1,status:'ended',sessionId:'batch',final:{
          correctCount:15,wrongCount:0,questionCount:15,passed:true,reward:{grantId:'grant',sunCount:75}}}}
      };
      let serial=0; const controller=createQuizController({provider,view:qaView,id:()=>`batch-id-${++serial}`});
      globalThis.batchPromise=controller.run({gameId:'pvzge',levelIds:['1'],locale:'zh-CN'});
    }""")
    expect(page.get_by_test_id("quiz-stage-start")).to_be_visible()
    assert page.evaluate("batchCalls.next") == 0
    page.get_by_test_id("quiz-stage-start").click()
    answers = (["0"], ["18.5"], ["09"], ["1", "3"], ["29", "3"])
    for index in range(15):
        expect(page.get_by_test_id("quiz-progress")).to_have_text(f"第{index + 1}/15题")
        fill_fields(page, list(answers[index % len(answers)]))
        page.get_by_test_id("quiz-submit").click()
        expect(page.get_by_test_id("quiz-result")).to_be_visible()
        if index == 14:
            expect(page.get_by_test_id("quiz-next")).to_have_text("开始游戏")
            _ = page.screenshot(path=str(output / "task-15-start-game.png"))
        page.get_by_test_id("quiz-next").click()
    assert page.evaluate("async () => { const result=await batchPromise; return result.completed===true && result.reward.sunCount===75; }")
    assert page.evaluate("batchCalls") == {"next": 15, "submit": 15, "end": 1}


def exercise_formats(page: Page, output: Path) -> None:
    for name, spec, values in FORMATS:
        page.evaluate("([name,spec]) => { qaPromise=qaView.ask(task(name,spec),progress); }", [name, spec])
        expect(page.locator("[data-numeric-field]")).to_have_count(len(values))
        fill_fields(page, values)
        if name == "pair":
            fields = page.locator("[data-numeric-field]")
            fields.nth(0).focus()
            fields.nth(0).press("Tab")
            expect(fields.nth(1)).to_be_focused()
        if name == "digits":
            page.locator("[data-numeric-field='0']").fill("")
            page.get_by_role("button", name="输入0").click()
            page.get_by_role("button", name="输入9").click()
            expect(page.locator("[data-numeric-field='0']")).to_have_value("09")
        expect(page.locator("[data-numeric-key='.']")).to_have_count(1 if name == "decimal" else 0)
        page.get_by_test_id("quiz-submit").press("Enter")
        assert page.evaluate("expected => qaPromise.then(intent => intent.type==='entered' && JSON.stringify(intent.values)===JSON.stringify(expected))", values), name
        assert page.locator(".quiz-input input:not(:disabled),.quiz-input button:not(:disabled)").count() == 0
        page.evaluate("qaView.dismiss('format-complete')")
    _ = page.screenshot(path=str(output / "all-formats-complete.png"))


def exercise_adversarial(page: Page, output: Path) -> None:
    page.evaluate("() => { qaPromise=qaView.ask(task('decimal',{format:'decimal',min:'0',max:'100'},2500),progress); }")
    page.evaluate("globalThis.sameDialog=document.querySelector('#addition-quiz')")
    field = page.locator("[data-numeric-field='0']")
    field.fill("1.")
    before = page.locator("#addition-quiz-timer").inner_text()
    page.get_by_test_id("quiz-submit").click()
    expect(page.locator(".quiz-input__hint")).to_be_visible()
    page.wait_for_timeout(1100)
    assert page.locator("#addition-quiz-timer").inner_text() != before
    field.fill("１８.５")
    field.press("Enter")
    assert page.evaluate("qaPromise.then(intent => JSON.stringify(intent.values)==='[\"18.5\"]')")
    page.evaluate("qaView.showLoading({...progress,message:'网络暂不可用'}, {onRetry(){globalThis.retryCount=(retryCount||0)+1}})")
    assert page.evaluate("document.querySelector('#addition-quiz')===sameDialog")
    expect(field).to_have_value("１８.５")
    _ = page.screenshot(path=str(output / "network-retry-same-dom.png"))
    page.evaluate("qaView.dismiss('retry-complete')")

    page.evaluate("() => { hiddenTask=task('integer',{format:'integer',min:0,max:100},120); hiddenPromise=qaView.ask(hiddenTask,progress); }")
    page.locator("[data-numeric-field='0']").fill("09")
    page.evaluate("qaView.dismiss('hidden')")
    page.wait_for_timeout(180)
    page.evaluate("() => { restoredPromise=qaView.ask(hiddenTask,progress); }")
    assert page.evaluate("restoredPromise.then(intent => intent.type==='timed_out')")
    page.evaluate("qaView.dismiss('hidden-timeout-complete')")


def smoke_options(arguments: list[str]) -> tuple[Path, bool]:
    default = ROOT.parent / ".omo/evidence/number-training/run-20261004/task-8-ui"
    match arguments:
        case []:
            return default.resolve(), False
        case ["--evidence-dir", value]:
            return Path(value).resolve(), False
        case ["--view-only", "--evidence-dir", value] | ["--evidence-dir", value, "--view-only"]:
            return Path(value).resolve(), True
        case _:
            raise SystemExit("usage: number-quiz-smoke.py [--view-only] [--evidence-dir PATH]")


def main() -> None:
    output, view_only = smoke_options(sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    server, url = serve()
    assertions = {"systemChrome": False, "allFiveFormats": False, "adversarial": False,
                  "signedFractionTouch": False, "fourViewports": False, "landscapeReachability": False}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            assertions["systemChrome"] = True
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.set_default_timeout(10_000)
            _ = page.goto(f"{url}__quiz_qa__.html", wait_until="domcontentloaded")
            install_harness(page)
            if not view_only:
                exercise_fifteen_task_batch(page, output)
            exercise_formats(page, output)
            assertions["allFiveFormats"] = True
            exercise_adversarial(page, output)
            assertions["adversarial"] = True
            exercise_stale_controls(page)
            android_context = browser.new_context(
                viewport={"width": 412, "height": 915}, has_touch=True, is_mobile=True,
                user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
            )
            android_page = android_context.new_page()
            _ = android_page.goto(f"{url}__quiz_android_qa__.html", wait_until="domcontentloaded")
            install_harness(android_page)
            exercise_android_fraction(android_page, output, FORMATS)
            android_context.close()
            assertions["signedFractionTouch"] = True
            capture_states(page, output)
            assertions["fourViewports"] = True
            assertions["landscapeReachability"] = True
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    _ = (output / "assertions.json").write_text(json.dumps(assertions, ensure_ascii=False, indent=2) + "\n")
    _ = (output / "cleanup.txt").write_text("Random loopback HTTP server stopped; system Chrome closed; no database opened.\n")
    print(f"PASS: numeric quiz browser evidence at {output}")


if __name__ == "__main__":
    main()
