const BLOCKED_EVENTS = [
  "keydown", "keyup", "keypress", "pointerdown", "pointerup", "pointermove",
  "mousedown", "mouseup", "click", "touchstart", "touchend", "wheel", "contextmenu",
];

export function createQuizGuards(getActive) {
  const guardGameInput = (event) => {
    const active = getActive();
    const inside = event.target instanceof Node && active?.dialog.contains(event.target);
    if (active?.dialog.open && !inside) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  return {
    add() {
      for (const type of BLOCKED_EVENTS) {
        window.addEventListener(type, guardGameInput, { capture: true, passive: false });
      }
    },
    remove() {
      for (const type of BLOCKED_EVENTS) window.removeEventListener(type, guardGameInput, true);
    },
    contain(dialog) {
      for (const type of BLOCKED_EVENTS) {
        dialog.addEventListener(type, (event) => event.stopPropagation());
      }
    },
  };
}
