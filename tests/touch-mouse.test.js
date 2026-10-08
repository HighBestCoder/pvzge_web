import { describe, expect, test } from "bun:test";

import { FRAME_GAP, installTouchAsMouse } from "../docs/learning/touch-mouse.js";

class FakeMouseEvent {
  constructor(type, init) { this.type = type; Object.assign(this, init); }
}

function setup() {
  const listeners = new Map();
  const target = {
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const sent = [];
  const canvas = { dispatchEvent(event) { sent.push(`${event.type}@${event.clientX},${event.clientY}`); return true; } };
  const emitted = [];
  const touchInput = { _eventTarget: { emit(type) { emitted.push(type); } } };
  let frames = [];
  const requestFrame = (callback) => { frames.push(callback); };
  const advance = (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      const pending = frames; frames = [];
      pending.forEach((callback) => callback());
    }
  };
  const fire = (type, id, x, y, { touches = 1, onCanvas = true } = {}) => {
    const touch = { identifier: id, clientX: x, clientY: y };
    listeners.get(type).handler({ type, target: onCanvas ? canvas : {}, changedTouches: [touch],
      touches: Array.from({ length: type === "touchend" ? touches - 1 : touches }, () => touch) });
  };
  const bridge = installTouchAsMouse({ canvas, touchInput, target, MouseEventImpl: FakeMouseEvent, requestFrame });
  return { bridge, sent, emitted, touchInput, listeners, advance, fire, pendingFrames: () => frames.length };
}

describe("touch replayed as a desktop mouse", () => {
  test("a tap becomes move, down, move, up with frames between each event", () => {
    const { sent, advance, fire, pendingFrames } = setup();

    fire("touchstart", 7, 10, 20);
    fire("touchend", 7, 10, 20);
    expect(sent).toEqual(["mousemove@10,20"]);

    advance(FRAME_GAP);
    expect(sent).toEqual(["mousemove@10,20", "mousedown@10,20"]);
    advance(FRAME_GAP * 2);
    expect(sent).toEqual(["mousemove@10,20", "mousedown@10,20", "mousemove@10,20", "mouseup@10,20"]);
    advance(FRAME_GAP);
    expect(pendingFrames()).toBe(0);
  });

  test("a burst of finger moves collapses to the latest position", () => {
    const { sent, advance, fire } = setup();

    fire("touchstart", 1, 0, 0);
    advance(FRAME_GAP);
    fire("touchmove", 1, 5, 5);
    fire("touchmove", 1, 9, 9);
    advance(FRAME_GAP);

    expect(sent).toEqual(["mousemove@0,0", "mousedown@0,0", "mousemove@9,9"]);
  });

  test("extra fingers are ignored while the first is down", () => {
    const { sent, advance, fire } = setup();

    fire("touchstart", 1, 1, 1);
    fire("touchstart", 2, 50, 50, { touches: 2 });
    fire("touchend", 2, 50, 50, { touches: 2 });
    advance(FRAME_GAP * 4);

    expect(sent).toEqual(["mousemove@1,1", "mousedown@1,1"]);
  });

  test("touchcancel releases the mouse", () => {
    const { sent, advance, fire } = setup();

    fire("touchstart", 3, 4, 4);
    fire("touchcancel", 3, 4, 4);
    advance(FRAME_GAP * 4);

    expect(sent.at(-1)).toBe("mouseup@4,4");
  });

  test("a lost touchend does not lock input: a lone new finger releases the stale one", () => {
    const { sent, advance, fire } = setup();

    fire("touchstart", 1, 1, 1);
    advance(FRAME_GAP * 2);
    fire("touchstart", 2, 30, 30, { touches: 1 });
    advance(FRAME_GAP * 4);

    expect(sent).toEqual(["mousemove@1,1", "mousedown@1,1", "mouseup@30,30", "mousemove@30,30", "mousedown@30,30"]);
  });

  test("touches outside the game canvas are left to the page", () => {
    const { sent, advance, fire } = setup();

    fire("touchstart", 1, 1, 1, { onCanvas: false });
    advance(FRAME_GAP * 4);

    expect(sent).toEqual([]);
  });

  test("Cocos' own touch emitter is muted, DOM touch events are not intercepted, restore undoes both", () => {
    const { bridge, emitted, touchInput, listeners } = setup();

    touchInput._eventTarget.emit("touch-start");
    expect(emitted).toEqual([]);
    expect(listeners.get("touchend").options).toEqual({ capture: true, passive: true });

    bridge.restore();
    touchInput._eventTarget.emit("touch-start");
    expect(emitted).toEqual(["touch-start"]);
    expect(listeners.size).toBe(0);
  });

  test("fails loudly when the engine seam changes", () => {
    const canvas = { dispatchEvent() {} };
    expect(() => installTouchAsMouse({ canvas, touchInput: {}, target: { addEventListener() {} },
      MouseEventImpl: FakeMouseEvent, requestFrame() {} })).toThrow(TypeError);
  });
});
