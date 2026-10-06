# Wrong-answer wave challenge native audit

## Supported stock levels

| Level ID | Status | Evidence |
| --- | --- | --- |
| `egypt3` | Supported | Stock `levels/egypt3` is indexed at path entry `9693` in `docs/assets/resources/config.json`. Runtime smoke loads it through native `KeyListener.goToLevel(["egypt3"])`, observes effective basic type `mummy`, and requires at least three wave definitions with no tutorial, conveyor, vase, danger-room, rhythm, cannon, cowboy-minigame, or boss mode. |

All other stock IDs and every custom level fail closed with a textual `unsupported` status. `egypt1` and `egypt2` remain excluded because the early Egypt sequence may contain introductory mechanics; the challenge does not infer ordinary-level support from a world-name prefix. The allowlist is not a cryptographic payload signature: it combines the exact stock ID with observed runtime invariants (`mummy`, wave count, and excluded mode flags). A modified `egypt3` that preserves all of those invariants is intentionally indistinguishable from stock to this adapter.

## Native source facts

- `docs/assets/main/index.js` SHA-256: `9fcbf8dd378c68fd0a0b16ffe5b49ec815f5a950457b85662a4e8f5a81e8a7be`.
- `docs/assets/resources/config.json` SHA-256: `f7494e94395199e1f90cdda79a86f5030b963f3527c3531ba74c34874e9f20a1`.
- `chunks:///_virtual/levelController.ts` initializes `currentWave` to `-1`. Calling `judgeWaveCount` synchronously resets `_ZombiesInThisWave`, captures the prior index, and increments `currentWave` before its first asynchronous suspension. Native wave-object work is dispatched through async callbacks that are not collectively awaited. The wrapper therefore captures the incremented wave immediately when the native method returns its promise, reserves that wave once, then awaits the native promise before adding extras. Challenge waves are restricted to `1..3`; pre-wave `-1/0` is excluded.
- The same controller's `registerZombieInThisWave` sets `spawnedWave`, appends non-ignored zombies to `_ZombiesInThisWave`, and adds native toughness. The challenge uses this method instead of maintaining a parallel enemy list.
- `chunks:///_virtual/Zombies.ts` exports lowercase `zombies.spawnZombieFromLaneByType(lane, type)` (uppercase `Zombies` is the Cocos component class). It creates a normal pooled zombie, chooses a native lane when `lane` is `null`, parents it to the lane zombie layer, places it at the native spawn edge, and settles it on the lane.
- `chunks:///_virtual/FrontYard.ts` exposes `FrontYard.getCurrentLawnBasicZombie()`, which selects from the effective lawn's `CurrentLawnProps.Basic_Zombie`. This avoids hard-coding an Egypt prefab and keeps the spawned object native to the active lawn.
- The native `KeyListener.goToLevel` calls `LevelPlay.setLevelData` and then `GoToGame`; restart calls `goToLevel(LevelPlay.thisLevelsID, ..., true)`. This confirms that mutating caller arrays would not be a reliable hook and that controller replacement is the safe boundary.

## Runtime contract

The server value is default-off and accepted only when it has this complete bounded shape:

```json
{"enabled":true,"ruleVersion":1,"extraPerWave":0,"maxWaves":3,"totalCap":6}
```

Enabled rules require integer `ruleVersion >= 1`, `extraPerWave` in `0..2`, fixed `maxWaves: 3`, and fixed `totalCap: 6`. The effective total remains `min(totalCap, extraPerWave * maxWaves)`, so backend results for zero, one, and two wrong answers produce 0, 3, and 6 extras. Slots are reserved before asynchronous work, repeated dispatches for one wave are deduplicated, and obsolete reservations never catch up in later waves. Extras are staggered by 0.5 seconds of active native simulation time; paused time does not advance the delay. An explicit restart reuses the prior final result, so it mounts the same rule on the replacement controller without another quiz. Controller replacement, a new transition, authorization stop, and `pagehide` all reach `cancelPending`, which restores the native method and invalidates late asynchronous spawns.

`tests/native-wave-smoke.py` is a low-level browser smoke, not an actual-backend end-to-end test. It fabricates a demo-provider final response with the schema enforced by `learning_results.final_response`, verifies that value reaches stock `egypt3`, and exercises production adapter code with the native `mummy` factory and registration path. To make 0/3/6 counts deterministic, the smoke replaces the controller's wave driver after scene load and force-advances waves 1 through 3; it does not prove database delivery, natural lets-rock state, or natural wave timing.
