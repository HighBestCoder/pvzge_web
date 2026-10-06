#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.51,<2"]
# ///

# ─── How to run ───
# 1. Start the app with ../start.sh.
# 2. Run: uv run tests/native-profile-smoke.py
# ──────────────────

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Final

from browser_helpers import MENU_READY, URL
from playwright.sync_api import Route, sync_playwright

GAME_URL: Final = "http://127.0.0.1:8080/game/?saveId=7"
SELECTION: Final = {
    "token": "browser-profile-token",
    "account": {"id": 3},
    "save": {
        "id": 7,
        "name": "数学花园",
        "childId": 2,
        "child": {"id": 2, "name": "小明", "grade": 3},
    },
}


def fulfill_json(route: Route, body: dict[str, object]) -> None:
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def main() -> None:
    output = Path(tempfile.mkdtemp(prefix="pvz-native-profile-evidence-"))
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        demo = browser.new_context(viewport={"width": 1280, "height": 800})
        demo_page = demo.new_page()
        demo_page.goto(URL)
        demo_page.wait_for_function(MENU_READY, timeout=60_000)
        native = demo_page.evaluate("""() => ({
          profiles: localStorage.getItem('PvZ2_PlayerProperties'),
          settings: localStorage.getItem('PvZ2_Settings')
        })""")
        demo.close()

        profiles = json.loads(native["profiles"])
        first = json.loads(json.dumps(profiles[0]))
        selected = json.loads(json.dumps(profiles[0]))
        first.update({"name": "保留一号", "browserMarker": "first-progress"})
        selected.update({"name": "保留二号", "browserMarker": "selected-progress"})
        settings = json.loads(native["settings"] or "{}")
        settings["PlayerIndex"] = 1
        values = {
            "PvZ2_PlayerProperties": json.dumps([first, selected]),
            "PvZ2_Settings": json.dumps(settings),
        }

        context = browser.new_context(viewport={"width": 1280, "height": 800})
        context.add_init_script(
            f"sessionStorage.setItem('pvz.play.selection', {json.dumps(json.dumps(SELECTION))})",
        )
        context.route("**/api/play/context", lambda route: fulfill_json(route, {
            "account": SELECTION["account"], "save": SELECTION["save"],
        }))
        context.route("**/api/saves/7/game-state", lambda route: fulfill_json(route, {
            "revision": 4, "values": values,
        }))
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(GAME_URL)
        page.wait_for_function(MENU_READY, timeout=60_000)
        observation = page.evaluate("""() => {
          const cc = System.get(System.resolve('cc'));
          const MainScene = System.get('chunks:///_virtual/mainScene.ts').mainScene;
          const player = System.get('chunks:///_virtual/PlayerProperties.ts').AllPlayerProperties;
          const menu = cc.director.getScene().getComponentInChildren(MainScene);
          const selector = cc.find('Canvas/PlayerSelectorButton', cc.director.getScene());
          const stored = JSON.parse(localStorage.getItem('PvZ2_PlayerProperties'));
          const settings = JSON.parse(localStorage.getItem('PvZ2_Settings'));
          return {
            currentIndex: player.allPlayers.indexOf(player.currentPlayer),
            currentName: player.currentPlayer.name,
            selectedMarker: player.currentPlayer.browserMarker,
            firstName: player.allPlayers[0].name,
            firstMarker: player.allPlayers[0].browserMarker,
            storedNames: stored.map(profile => profile.name),
            profileCount: stored.length,
            playerIndex: settings.PlayerIndex,
            selectorActive: selector?.active,
            playersWindowActive: menu.playersWindow.active,
            playersShown: menu.playersShown,
            chooserResult: menu.players(),
            canPlay: typeof menu.goToGame === 'function',
            canOpenSettings: typeof menu.setting === 'function'
          };
        }""")
        assert observation == {
            "currentIndex": 1,
            "currentName": "小明",
            "selectedMarker": "selected-progress",
            "firstName": "保留一号",
            "firstMarker": "first-progress",
            "storedNames": ["保留一号", "小明"],
            "profileCount": 2,
            "playerIndex": 1,
            "selectorActive": False,
            "playersWindowActive": False,
            "playersShown": False,
            "chooserResult": False,
            "canPlay": True,
            "canOpenSettings": True,
        }, observation
        for width, height in ((1280, 800), (768, 1024), (375, 812), (812, 375)):
            page.set_viewport_size({"width": width, "height": height})
            page.screenshot(path=str(output / f"native-profile-{width}x{height}.png"))
        assert not errors, errors
        context.close()
        browser.close()
    print(f"PASS: preserved selected profile index/progress and removed only native chooser; evidence: {output}")


if __name__ == "__main__":
    main()
