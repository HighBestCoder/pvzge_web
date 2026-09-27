import { createGameBridge, createSystemRuntime } from "./game-bridge.js";
import { createLocalLearningProvider } from "./local-provider.js";
import { createQuizController } from "./quiz-controller.js";
import { createQuizView } from "./quiz-view.js";

const RETRY_MS = 250;

function waitForRuntime() {
  return new Promise((resolve) => {
    const inspect = () => {
      const runtime = createSystemRuntime();
      if (runtime?.cc?.director) {
        resolve();
      } else {
        setTimeout(inspect, RETRY_MS);
      }
    };
    inspect();
  });
}

async function start() {
  await waitForRuntime();
  const view = createQuizView();
  const bridge = createGameBridge();
  const provider = createLocalLearningProvider({ learnerRef: "demo-learner" });
  const controller = createQuizController({ bridge, view, provider });
  let frameId = 0;

  const frame = (now) => {
    frameId = requestAnimationFrame(frame);
    controller.tick(now).catch((error) => console.error("[quiz] Scheduler tick failed", error));
  };
  const onVisibility = () => controller.setVisible(document.visibilityState === "visible");
  const stop = () => {
    cancelAnimationFrame(frameId);
    controller.stop().catch((error) => console.error("[quiz] Failed to stop learning session", error));
    document.removeEventListener("visibilitychange", onVisibility);
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", stop, { once: true });
  frameId = requestAnimationFrame(frame);
}

start().catch((error) => console.error("[quiz] Bootstrap failed", error));
