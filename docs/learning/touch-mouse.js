// The game was built for desktop: seed packets and lawn planting listen for MOUSE_DOWN/MOUSE_MOVE.
// On iPad, Cocos turns canvas touches into TOUCH_* events only (and prevents the browser's
// compatibility mouse events), so a finger tap never reaches those handlers. This replays the first
// finger as a mouse and mutes Cocos' own touch emitter, so iPad input follows the desktop mouse path.
// Cocos already simulates node TOUCH_* events from the mouse, so buttons still work and fire once.
//
// The DOM touch events themselves are left alone: Cocos unlocks iOS audio from a capture listener
// on the canvas' trusted "touchend", which must still run.

const TOUCH_EVENTS = ["touchstart", "touchmove", "touchend", "touchcancel"];
// Mouse events go out two animation frames apart, like a real mouse (and the desktop smoke test):
// the game resolves the hovered lawn tile in update(), so move+down+up in one frame plants nowhere.
export const FRAME_GAP = 2;

export function installTouchAsMouse({
  canvas, touchInput, target = globalThis, MouseEventImpl = globalThis.MouseEvent,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
}) {
  if (!canvas || typeof canvas.dispatchEvent !== "function") throw new TypeError("game canvas is required");
  if (typeof MouseEventImpl !== "function") throw new TypeError("MouseEvent is required");
  const emitter = touchInput?._eventTarget;
  if (typeof emitter?.emit !== "function") throw new TypeError("Cocos touch input emitter must be available");

  const originalEmit = emitter.emit;
  emitter.emit = function muted() {};

  const queue = [];
  let gap = 0;
  let scheduled = false;
  let activeId = null;
  let stopped = false;

  function dispatch({ type, x, y, buttons }) {
    canvas.dispatchEvent(new MouseEventImpl(type, {
      bubbles: true, cancelable: true, view: globalThis.window ?? null,
      clientX: x, clientY: y, button: 0, buttons,
    }));
  }

  function schedule() {
    if (scheduled || stopped) return;
    scheduled = true;
    requestFrame(tick);
  }

  function tick() {
    scheduled = false;
    if (stopped) return;
    if (gap > 0) gap -= 1;
    if (gap === 0 && queue.length > 0) { dispatch(queue.shift()); gap = FRAME_GAP; }
    if (queue.length > 0 || gap > 0) schedule();
  }

  function enqueue(type, touch, buttons) {
    const last = queue[queue.length - 1];
    // Collapse a burst of finger moves into the latest position, so dragging never lags behind.
    if (type === "mousemove" && last?.type === "mousemove") {
      last.x = touch.clientX; last.y = touch.clientY; last.buttons = buttons;
      return;
    }
    queue.push({ type, x: touch.clientX, y: touch.clientY, buttons });
    if (!scheduled && gap === 0) { dispatch(queue.shift()); gap = FRAME_GAP; }
    schedule();
  }

  function findTracked(list) {
    for (let index = 0; index < list.length; index += 1) {
      if (list[index].identifier === activeId) return list[index];
    }
    return null;
  }

  function handle(event) {
    if (stopped || event.target !== canvas) return;
    if (event.type === "touchstart") {
      // iOS can drop touchend/touchcancel (system alert, app switch). A lone new finger means any
      // tracked one is gone; release it instead of ignoring every later touch.
      if (activeId !== null && event.touches?.length === 1) {
        const stale = event.changedTouches[0];
        activeId = null;
        enqueue("mouseup", stale, 0);
      }
      if (activeId !== null) return;  // extra fingers are ignored, like a single mouse
      const touch = event.changedTouches[0];
      activeId = touch.identifier;
      enqueue("mousemove", touch, 0);
      enqueue("mousedown", touch, 1);
      return;
    }
    const touch = findTracked(event.changedTouches);
    if (!touch) return;
    if (event.type === "touchmove") { enqueue("mousemove", touch, 1); return; }
    activeId = null;
    enqueue("mousemove", touch, 1);
    enqueue("mouseup", touch, 0);
  }

  for (const type of TOUCH_EVENTS) target.addEventListener(type, handle, { capture: true, passive: true });
  return {
    restore() {
      stopped = true;
      for (const type of TOUCH_EVENTS) target.removeEventListener(type, handle, { capture: true });
      emitter.emit = originalEmit;
      queue.length = 0;
      activeId = null;
    },
  };
}
