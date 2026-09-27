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

## Addition quiz runtime

The browser build includes a small addition practice prompt during active level play. The first question becomes eligible after 20 seconds of eligible, visible play in a level; later questions use a 60-second eligible-play cooldown. Pauses, tutorials, narration, selection modes, scene transitions, hidden tabs, and other blocked game states do not count toward either delay. Dismissing a question starts the regular cooldown again.

The quiz shows a 20-second countdown. Clicking any answer closes it immediately: a correct answer creates exactly five normal 50-value `SunMid` objects at row 2, columns 2 through 6, while a wrong answer has no penalty. If time expires, the quiz closes and returns to play with no reward. The suns are not auto-collected and the counter is not edited directly. Skipping, changing scenes, hiding the page while a question is open, or losing ownership of the native game pause also cancels the reward.

Runtime integration lives in `docs/learning/`; it uses only already-cached SystemJS game modules and does not alter `docs/assets/main/index.js`. Run the pure fake-based unit tests with:

```sh
bun test
```

For a real Chrome smoke test, start the local server and run `uv run tests/quiz-smoke.py`.
It plays the first tutorial through the first automatically scheduled quiz, verifies five
collectible suns and a 250-point collection, then tests wrong/skip paths and responsive
dialog states. Screenshots are written to a temporary directory printed by the test.
The normal first question waits until the tutorial's active instructions have finished.
The UI consumes the versioned learning-provider contract documented in [LEARNING_API.md](LEARNING_API.md).
`bootstrap.js` injects the local provider for rapid iteration: both addends are two-digit
integers and their sum is at most 100. The public task contains question/task IDs, content,
stable option IDs and a time limit, but no correct answer. The provider alone grades the
submitted option ID. A non-math text task also uses the same renderer.

Provider operations are asynchronous and bounded: fetching never pauses gameplay, and
choosing an answer resumes gameplay before grading finishes. Rewards only apply to a
matching, still-valid game attempt. Transport failures are not incorrect answers.
The demo learner is configured only at the composition root; there is no login, remote
learning planner, persistent progress or cross-refresh submission recovery yet. Local
private answers are an architectural boundary, not a browser anti-cheating mechanism.
