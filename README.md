<div align="center">

<img width=20% src="https://pvzge.com/pvz_logo-round.webp" alt="">

# PvZ2 Gardendless

**An endless garden requires an endless defense!**

Thanks to everyone who has supported this project!

![](https://img.shields.io/badge/author-Gaozih-%2366ccff)
![](https://img.shields.io/github/license/Gzh0821/pvzge_web)
![](https://img.shields.io/docker/pulls/gaozih/pvzge)
![](https://img.shields.io/discord/1265377295846346803?label=discord)
![](https://img.shields.io/github/stars/Gzh0821/pvzge_web)
</div>

### Info

This is the open source repo of the web version of "PvZ2 Gardendless".

"PvZ2 Gardendless" is a rewritten "Plants vs Zombies 2" entirely using only Web technologies(including the cocos engine)!

Visit our [website](https://pvzge.com/en/) for download links, game guides and more. You can also report bugs, make comments and suggestions in the feedback module of the website or in the issues and discussions of this project!

## Web Play

Try PvZ2 Gardendless online in [here](https://play.pvzge.com/) !

- Note: The version for online play may not be the latest version and may load slowly. For more related issues, please refer to the relevant instructions on the official website

## Source checkout

Install Git LFS before cloning this repository. After pulling updates, run `git lfs pull` to download large game assets before serving `docs/` or building a Docker image.

## Using Docker

Deploy the game locally by using [Docker image](https://hub.docker.com/r/gaozih/pvzge)

## Pre-level learning gate

The passwordless child app runs at `http://localhost:8080/`. Its save picker stores the selected `{token, account, save}` capability only in `sessionStorage["pvz.play.selection"]`, then opens `/game/?saveId=<id>` in the same tab. The game validates that selection with bearer-authenticated `GET /api/play/context` before importing the engine. The parent management app is separate at `http://localhost:8081/`; its login cookie is neither sent nor used by the child game, and parent logout does not stop an already selected child tab. `?demo=1` is the only explicit local-provider mode and makes no API calls.

The browser build runs the selected save's server-configured learning batch before each native game scene starts. The integration wraps the cached static `KeyListener.GoToGame(levelObjectArrays, restart)` method, so normal `goToLevel` calls and direct custom-level calls share one gate before resource, tutorial, card-selection, and countdown loading. There is no periodic in-battle quiz timer.

Questions are sequential and resume the server's completed/correct/wrong counters. Every loading, question, and result header shows only the latest server-confirmed correct count and cumulative sunlight count/value; a failed submission does not change them. Selecting an answer immediately submits it, freezes the countdown, disables the choices, and keeps the same dialog open. Its right pane shows “正在判题”, then the server-authoritative correct answer and plaintext explanation when available; legacy responses display `这道题暂无详细题解` without inventing an answer. Correct, wrong, skipped, and timed-out results remain visible for unlimited reading time and advance only after the user clicks `下一题` or final `开始游戏`. Provider failures stay in the same right-pane retry flow and never appear as a wrong answer. Hiding the page aborts the current provider wait and retains the accepted result until the page becomes visible; stopping the page never invokes the pending native transition.

The create-session response freezes the save's optional wrong-answer challenge rule for the whole practice, including resume and failed-level retry. When enabled the quiz announces the fixed cap before answering; the audited runtime currently applies it only to ordinary waves in Egypt level 3, never teaching or special levels. The local demo defaults the rule off. Final game integration consumes only the normalized challenge returned by end-session.

After the native scene loads and starts gaming, the validated server `sunCount` creates normal 50-value `SunMid` objects (0–500), distributed at row 2, columns 2 through 6. Tutorial 1 is the sole timing exception: its bonus drops wait until the native first-plant, tutorial-sun, and second-plant sequence opens the wave gate, then the complete entitlement is produced and acknowledged once. A durable per-run receipt precedes reward acknowledgement; game started/won/lost/abandoned events use a durable idempotent outbox. An explicit restart of the same destination by the same in-memory player skips a second batch but creates a distinct run eligible for the same grant's server-supported per-run acknowledgement.

Runtime integration lives in `docs/learning/`; it uses only already-cached SystemJS game modules and does not alter `docs/assets/main/index.js`. Run the pure fake-based unit tests with:

```sh
bun test
```

For a real Chrome smoke test, start the local server and run `uv run tests/quiz-smoke.py`.
The browser bootstrap blocks game input until the `GoToGame` wrapper is installed; hook failures expose a retry control instead of leaving a blank page.
The original full-viewport game layout is preserved: there is no added account/sync header or tutorial hint row. Save synchronization remains active in the background; blocking errors still appear separately. The native first tutorial releases zombies after its first-plant, tutorial-sun collection, and second-plant sequence. The layout regression verifies natural zombie appearance with both zero and twenty bonus suns, without forcing tutorial flags or waves.
The UI consumes the versioned learning-provider contract documented in [LEARNING_API.md](LEARNING_API.md).
`bootstrap.js` uses the real same-origin play API after validating the session selection, authoritative
account/save context and game state before engine import. Every `/api/` request uses the selected
bearer with `credentials: "omit"`; a 401 stops game entry/native synchronization, clears only the
selection for that failed token, and returns to the save picker. Network failures retain the selection
and expose retry. The public task contains question/task IDs, content, stable
option IDs and a time limit, but no correct answer. The provider alone grades the submitted
option ID. A non-math text task also uses the same renderer.

Provider network operations are bounded to ten seconds per attempt. The server supplies each question's separate answer deadline: numeric training uses 120 seconds normally and 180 seconds for the configured advanced square and fraction stages. Retry reuses the exact request and identity payload; transport failures are never converted into incorrect answers or silent game launches.
The two native PvZ storage keys are virtualized per account/save and synchronized with server CAS;
submission and game-event outboxes survive reload. See `LEARNING_API.md` for failure, conflict,
receipt and non-atomic browser/server boundaries.

For an authenticated child save, the server-authoritative child name is bound to the native profile
already selected by `PvZ2_Settings.PlayerIndex`. A valid existing index is retained so its progress
remains active; only an invalid index falls back to profile `0`. The profile array is never reset,
created, deleted, or imported by this binding: only the selected profile's `name` is updated through
the native save API. The native profile-selector button and its player window are disabled, while
Play, settings, and the rest of the main menu remain unchanged. Demo mode keeps the native behavior.
