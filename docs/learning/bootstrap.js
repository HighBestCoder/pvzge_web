import { createGameBridge } from "./game-bridge.js";
import { createGameReporter } from "./game-reporter.js";
import { handleAuthorizationFailure } from "./authorization-failure.js";
import { createBootstrapLifecycle, createPagehideHandler } from "./bootstrap-lifecycle.js";
import { PickerRedirectError, prepareGameContext } from "./game-prepare.js";
import { createLevelEntry } from "./level-entry.js";
import { createLocalLearningProvider } from "./local-provider.js";
import { createNativeProfileBinding } from "./native-profile.js";
import { createNativeStart } from "./native-start.js";
import { createNativeStateSync } from "./native-state.js";
import { createQuizController } from "./quiz-controller.js";
import { createQuizView } from "./quiz-view.js";
import { createRemoteLearningProvider } from "./remote-provider.js";
import { createRewardReceipts } from "./reward-receipts.js";
import { createStatusPanel } from "./status-panel.js";

const MODULES = { keys: "chunks:///_virtual/KeyListener.ts", level: "chunks:///_virtual/levelController.ts",
  mainScene: "chunks:///_virtual/mainScene.ts", player: "chunks:///_virtual/PlayerProperties.ts", cc: "cc" };
const DEADLINE_MS = 15_000;
const panel = createStatusPanel();
let entry = null;
let nativeProfile = null;
let nativeStart = null;
let context = null;

function cached(id) { try { return globalThis.System?.get?.(globalThis.System.resolve(id)); } catch { return null; } }

async function prepare() {
  const prepared = await prepareGameContext({ search: location.search });
  if (prepared.demo) { panel.setDemo(); return prepared; }
  const { account, save, saveId, gameState } = prepared;
  panel.setIdentity(account, save);
  const nativeSync = createNativeStateSync({ accountId: account.id, saveId, serverState: gameState,
    onStatus: (status) => panel.setSync(status) });
  if (nativeSync.conflicted) throw new Error("本地进度与服务器冲突，请重新加载页面");
  return { ...prepared, nativeSync };
}

function waitForHookTargets() {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const keys = cached(MODULES.keys)?.KeyListener;
      const level = cached(MODULES.level)?.LevelPlay;
      const MainScene = cached(MODULES.mainScene)?.mainScene;
      const player = cached(MODULES.player)?.AllPlayerProperties;
      const cc = cached(MODULES.cc);
      if (typeof keys?.GoToGame === "function" && level && MainScene && player && cc) {
        resolve({ keys, level, MainScene, player, cc });
      }
      else if (performance.now() - startedAt >= DEADLINE_MS) reject(new Error("Timed out waiting for cached GoToGame modules"));
      else requestAnimationFrame(inspect);
    };
    inspect();
  });
}

async function installHook({ keys, level, MainScene, player, cc }) {
  const provider = context.demo ? createLocalLearningProvider({ learnerRef: "demo-learner" })
    : createRemoteLearningProvider({ saveId: context.saveId });
  const controller = createQuizController({ provider, view: createQuizView() });
  const reporter = context.demo ? null : createGameReporter({ saveId: context.saveId });
  const receipts = context.demo ? null : createRewardReceipts({ saveId: context.saveId,
    snapshot: () => context.nativeSync?.values() ?? null });
  const bridge = createGameBridge({ reporter, receipts });
  if (!context.demo) {
    nativeProfile = createNativeProfileBinding({ childName: context.save.child.name, player, MainScene,
      director: cc.director, afterSceneEvent: cc.Director.EVENT_AFTER_SCENE_LAUNCH, findNode: cc.find });
    nativeProfile.install();
  }
  entry = createLevelEntry({ keyListener: keys, levelPlay: level,
    getPlayer: () => player.currentPlayer ?? null, controller, bridge });
  entry.install();
  nativeStart = createNativeStart();
  nativeStart.install();
  const onVisibility = () => controller.setVisible(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", createPagehideHandler({ document, onVisibility, nativeProfile,
    nativeStart, nativeSync: context.nativeSync, reporter, entry }), { once: true });
  document.documentElement.dataset.learningReady = "true";
  panel.clearError();
}

const lifecycle = createBootstrapLifecycle({
  importGame: async () => { context ??= await prepare(); return System.import("./index.js"); },
  waitForTargets: waitForHookTargets, installHook,
});

function install() {
  document.documentElement.dataset.learningReady = "false";
  panel.clearError();
  return lifecycle.install();
}
function reportFailure(error) {
  if (error instanceof PickerRedirectError) { location.replace("/"); return; }
  if (error?.status === 401) return;
  console.error("[quiz] Bootstrap failed", error);
  panel.showError(error?.message || "初始化学习模块失败，点击重试");
}
globalThis.addEventListener("play:authorization-required", (event) => {
  nativeProfile?.stop();
  handleAuthorizationFailure({ token: event.detail?.token, storage: sessionStorage, entry,
    nativeSync: context?.nativeSync, panel, navigate: (path) => location.replace(path) });
});
document.querySelector("[data-learning-retry]")?.addEventListener("click", (event) => {
  event.preventDefault(); event.stopPropagation(); install().catch(reportFailure);
});
install().catch(reportFailure);
