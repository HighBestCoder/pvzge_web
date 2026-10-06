#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.51,<2", "pydantic>=2.11,<3"]
# ///

# ─── Low-level adapter smoke (not a native-wave E2E) ───
# This test fabricates the final provider shape, mounts the adapter manually, and replaces
# native wave/terminal state. It checks adapter plumbing only; use challenge-smoke.py for E2E.
# ─── How to run ───
# Start the app at http://127.0.0.1:8080, then run: uv run tests/native-wave-smoke.py
# ──────────────────

from __future__ import annotations

from typing import ClassVar, Final

from playwright.sync_api import Browser, Page, Route, expect, sync_playwright
from pydantic import BaseModel, ConfigDict, TypeAdapter

URL: Final = "http://127.0.0.1:8080/game/?demo=1"
LEVEL: Final = "chunks:///_virtual/levelController.ts"


class Observation(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    wrongCount: int
    extraPerWave: int
    registered: int
    basic: str
    validNodes: bool


OBSERVATION: Final = TypeAdapter(Observation)


def instrument_final(route: Route, wrong_count: int) -> None:
    response = route.fetch()
    source = response.text()
    target = "return { createSession, getNextTask, submitAnswer, endSession };"
    replacement = f"""const nativeEndSession = endSession;
  endSession = async function(...args) {{
    const result = await Reflect.apply(nativeEndSession, this, args);
    result.final.challenge = {{enabled:true,ruleVersion:1,extraPerWave:Math.min({wrong_count},2),maxWaves:3,totalCap:6}};
    globalThis.__backendFinalChallenge = structuredClone(result.final.challenge);
    return result;
  }};
  return {{ createSession, getNextTask, submitAnswer, endSession }};"""
    assert target in source, "local provider final-response seam changed"
    route.fulfill(response=response, body=source.replace(target, replacement))


def answer_batch(page: Page) -> None:
    for question in range(1, 11):
        expect(page.get_by_test_id("quiz-progress")).to_have_text(f"第{question}/10题", timeout=30_000)
        page.locator("[data-quiz-option]").first.click()
    expect(page.locator("#addition-quiz[open]")).to_have_count(0, timeout=30_000)


def run_case(browser: Browser, wrong_count: int) -> Observation:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    _ = context.route("**/learning/local-provider.js", lambda route: instrument_final(route, wrong_count))
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    _ = page.goto(URL)
    _ = page.wait_for_function("""() => {
      try {
        const cc = System.get(System.resolve('cc'));
        const module = System.get('chunks:///_virtual/mainScene.ts');
        const menu = module && cc?.director.getScene()?.getComponentInChildren(module.mainScene);
        return document.documentElement.dataset.learningReady === 'true' && menu?.sceneColor.a === 0 && !menu.haveWindow();
      } catch { return false; }
    }""", timeout=60_000)
    handle = page.evaluate_handle("""() => { void System.get('chunks:///_virtual/KeyListener.ts').KeyListener.goToLevel(['egypt3'], [], false, false); }""")
    handle.dispose()
    answer_batch(page)
    _ = page.wait_for_function(f"""() => {{
      const level = System.get('{LEVEL}').LevelPlay;
      const component = level.component;
      return String(level.thisLevelsID?.[0]) === 'egypt3' && component?.waveManagerProps?.Waves?.length >= 3 &&
        globalThis.__backendFinalChallenge;
    }}""", timeout=60_000)
    handle = page.evaluate_handle("""async wrongCount => {
      const {createSystemRuntime} = await import('/game/learning/game-bridge.js');
      const {createNewWaveChallenge} = await import('/game/learning/newwave-challenge.js');
      const runtime = createSystemRuntime();
      const challengeRuntime = {...runtime, zombies:{...runtime.zombies}};
      challengeRuntime.gaming = true;
      challengeRuntime.superSlowed = false;
      challengeRuntime.level.gameStarted = true;
      challengeRuntime.cc.director.gameSpeed = 1;
      const nativeSpawn = runtime.zombies.spawnZombieFromLaneByType;
      challengeRuntime.zombies.spawnZombieFromLaneByType = async function(...args) {
        const zombie = await Reflect.apply(nativeSpawn, runtime.zombies, args);
        zombie.__waveSmokeExtra = true;
        return zombie;
      };
      const registered = [];
      const originalRegister = runtime.level.registerZombieInThisWave;
      runtime.level.registerZombieInThisWave = function(zombie) {
        if (zombie.__waveSmokeExtra) registered.push(zombie);
        return Reflect.apply(originalRegister, this, [zombie]);
      };
      runtime.level.judgeWaveCount = async function() { this.currentWave += 1; };
      const adapter = createNewWaveChallenge({getRuntime:() => challengeRuntime});
      const status = adapter.mount({challenge:globalThis.__backendFinalChallenge, runtime:challengeRuntime,
        targetLevelIds:['egypt3'], customLevel:false, ownsTarget:() => true});
      if (status.status !== 'active') throw new Error(`challenge mount failed: ${JSON.stringify(status)}`);
      for (const target of [runtime.level, runtime.ui]) {
        for (const key of ['gameWon','gameLost','gameOver','_cannonVic','exitNextTick','restartNextTick','_exitDealt']) {
          Object.defineProperty(target, key, {configurable:true, get:() => false, set() {}});
        }
      }
      runtime.level.currentWave = 0;
      while (runtime.level.currentWave < 3) {
        await runtime.level.judgeWaveCount(false);
      }
      const validNodes = registered.every(zombie => runtime.valid(zombie.node));
      registered.forEach(zombie => zombie?.node?.destroy());
      adapter.cancelPending();
      document.documentElement.dataset.waveSmokeObservation = JSON.stringify({wrongCount,
        extraPerWave:globalThis.__backendFinalChallenge.extraPerWave, registered:registered.length,
        basic: runtime.frontYard.getCurrentLawnBasicZombie(),
        validNodes});
    }""", wrong_count)
    handle.dispose()
    observation_json = page.locator("html").get_attribute("data-wave-smoke-observation")
    assert observation_json is not None
    assert not errors, errors
    context.close()
    return OBSERVATION.validate_json(observation_json)


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            observations = [run_case(browser, wrong_count) for wrong_count in (0, 1, 2)]
        finally:
            browser.close()
    assert [value.registered for value in observations] == [0, 3, 6], observations
    assert all(value.basic == "mummy" and value.validNodes for value in observations), observations
    print("PASS (low-level only): fabricated provider shape and wave counters exercised adapter plumbing")


if __name__ == "__main__":
    main()
