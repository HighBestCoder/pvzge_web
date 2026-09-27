# PvZ Garden Quiz Design System

The dialog renders provider-owned plain-text content and opaque option IDs. It does not
parse arithmetic or grade answers. The generic title is “阳光学习挑战”; question prompts
may wrap for language subjects, while the local demo supplies two-digit addition.
The task's `timeLimitMs` controls the visible countdown (20 seconds in the local provider).

## 1. Atmosphere & Identity

The quiz is a friendly bonus laid over the existing lawn, not a new product or a redesign. Its signature is the pause screen's carved garden sign: a warm brown wood face, cream outlined lettering, a gold-brown rim, green success energy, and chunky raised purple or brown controls. The tone rewards trying, never punishes a wrong answer, and always leaves an obvious exit.

## 2. Color

All quiz colors are exposed as custom properties on `#addition-quiz`; quiz CSS uses only those properties.

| Role | Token | Value | Usage |
|---|---|---|---|
| Backdrop | `--quiz-backdrop` | `rgb(10 16 7 / 72%)` | Separates the DOM dialog from the active lawn |
| Wood light | `--quiz-wood-light` | `#c58850` | Upper panel highlight |
| Wood | `--quiz-wood` | `#ad7040` | Main panel face |
| Wood dark | `--quiz-wood-dark` | `#71401f` | Lower panel shade and carved detail |
| Rim gold | `--quiz-rim-gold` | `#d89a4b` | Outer sign rim and reward emphasis |
| Rim dark | `--quiz-rim-dark` | `#3b2415` | Inner carved line and strong separation |
| Cream | `--quiz-cream` | `#fff4cf` | Primary text |
| Ink | `--quiz-ink` | `#24170f` | Text outline/shadow and high-contrast detail |
| Purple light | `--quiz-purple-light` | `#9561d4` | Secondary-button highlight |
| Purple | `--quiz-purple` | `#6330a2` | Answer/secondary button face |
| Purple dark | `--quiz-purple-dark` | `#35185f` | Secondary-button raised edge |
| Leaf light | `--quiz-leaf-light` | `#73d43a` | Reward badge highlight |
| Leaf | `--quiz-leaf` | `#2f8a25` | Reward badge face |
| Leaf dark | `--quiz-leaf-dark` | `#155417` | Reward badge depth |
| Focus | `--quiz-focus` | `#fff27a` | Keyboard focus ring |

Translucent material tokens are `--quiz-grain`, `--quiz-wash`, `--quiz-wash-strong`, `--quiz-highlight`, `--quiz-rim-highlight`, and `--quiz-shadow`; they supply only wood grain, inset light, coaching backdrop, and elevation. Geometry tokens are `--quiz-radius-panel: 28px`, `--quiz-radius-control: 14px`, `--quiz-target: 44px`, `--quiz-control-min: 220px`, `--quiz-stroke: 2px`, `--quiz-stroke-bold: 3px`, `--quiz-depth: 4px`, and `--quiz-press: 2px`.

Color rules: cream on dark outlined surfaces is the default text treatment; green and gold communicate reward; purple is the answer family. No red failure treatment is used because an incorrect answer has no penalty.

## 3. Typography

The required stack is Chinese system UI: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif`. Heavy weights and a dark offset text shadow approximate the canvas display lettering without external fonts or assets.

| Level | Token | Size | Weight | Line height | Usage |
|---|---|---|---|---|---|
| Title | `--quiz-type-title` | `clamp(1.5rem, 5vw, 2rem)` | 900 | 1.2 | Dialog title |
| Equation | `--quiz-type-equation` | `clamp(2rem, 9vw, 3rem)` | 900 | 1.1 | Addition prompt |
| Button | `--quiz-type-button` | `clamp(1rem, 3.6vw, 1.25rem)` | 800 | 1.25 | Answers and actions |
| Body | `--quiz-type-body` | `1rem` | 700 | Instructions and timer status |
| Caption | `--quiz-type-caption` | `0.875rem` | Reward and skip |

Body copy never falls below 14px. Instructions use complete Chinese phrases; equations and quantity phrases such as `5 个阳光` and `剩余 20 秒` remain atomic rather than breaking across lines.

## 4. Spacing & Layout

The base unit is 4px. Tokens are `--quiz-space-1: 4px`, `--quiz-space-2: 8px`, `--quiz-space-3: 12px`, `--quiz-space-4: 16px`, `--quiz-space-5: 20px`, `--quiz-space-6: 24px`, and `--quiz-space-8: 32px`.

The modal is centered with a maximum inline size of 640px and viewport/safe-area gutters. The desktop answer field is a two-column grid; it collapses to one column at 480px. In short landscape it becomes a compact two-column content layout, remains vertically scrollable inside the panel, and never exceeds the dynamic viewport. Every interactive target is at least 44px high. Browser mechanics such as `min()`, `clamp()`, percentages, viewport units, and intrinsic sizing do not require tokens.

## 5. Components

### Quiz Dialog / Wood Panel
- **Structure**: native `dialog#addition-quiz` > `.quiz-view__panel` > header, prompt, timer status, answer grid, skip action.
- **Spacing**: viewport gutter uses `--quiz-space-4`; panel rhythm uses `--quiz-space-4` through `--quiz-space-8`.
- **States**: closed and active question; selecting any answer closes immediately, while deadline/skip/dismiss close without a result.
- **Accessibility**: modal `showModal()`, labelled title, described prompt and timeout instruction, native focus containment, Escape exit, and previous-focus restoration. The changing timer has `role="timer"` and `aria-live="off"` to avoid per-second announcements.
- **Motion**: a standard 180ms opacity/transform entrance; absent under reduced motion.
- **Layout**: centered stack; the panel owns overflow in short viewports.

### Raised Button
- **Variants**: purple answer and quiet text skip.
- **States**: default gradient face, brighter hover, 2px pressed translation, and yellow focus ring.
- **Accessibility**: semantic `button`, at least 44px high, visible `:focus-visible`, state is never conveyed by color alone.
- **Motion**: micro 120ms transform/filter only; disabled with reduced motion.

### Countdown Status
- **Structure**: `.quiz-view__timing` contains `.quiz-view__timer[role="timer"][aria-live="off"]` and a static timeout explanation.
- **States**: starts visibly at `剩余 20 秒`, decreases from the monotonic absolute deadline, and disappears with the dialog at expiry.
- **Accessibility**: the static sentence `超时返回游戏，不获得奖励` is part of the dialog description; countdown updates are visual only and never spam an assistive-technology live region.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|---|---|---|---|
| Micro | `120ms` | `ease-out` | Button press/hover |
| Standard | `180ms` | `ease-out` | Dialog entrance |

Only `transform`, `opacity`, and `filter` animate. `prefers-reduced-motion: reduce` removes transitions and entrance motion. An answer click stops propagation, checks the monotonic deadline, then closes immediately and resolves `true` or `false`; a click at or after the deadline resolves `null`. The 20-second deadline uses an absolute `performance.now()` target plus a one-shot due timer, while interval updates are cosmetic. Skip, Escape, timeout, replacement, programmatic dismiss, and native cancellation resolve `null`. Every path clears timers and settles at most once so stale callbacks cannot affect a later question.

## 7. Depth & Surface

Depth uses a mixed rim-and-shadow strategy observed in the pause screenshot. The sign has a dark outer shadow, gold-brown outer rim, cream highlight line, and dark carved inner line over a subtle vertical wood gradient. Raised controls have a cream rim, dark outline, top highlight, and a 4px colored lower edge; active controls translate toward that edge. No image texture or external asset is introduced.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- Target WCAG 2.2 AA: 4.5:1 body-text contrast, 3:1 large text and control boundaries, full keyboard operation, visible focus, and 44px touch targets.
- The native dialog provides focus containment; code restores the invoking focus after close.
- Capture-phase guards stop game keyboard and pointer handlers while preserving events whose target is inside the dialog.
- Dialog dismissal is always available through Skip, Escape, or the public `dismiss()` method.
- Timer changes are not live-announced; the timeout consequence is static, visible, and included in the dialog description.
- The layout must fit 375px portrait and short landscape without page-level horizontal overflow.

### Accepted Debt

The original fixed-aspect canvas can crop or letterbox on narrow screens; this feature does not redesign the base game. The dialog is independently verified at 1280×800, 768×1024, 375×812, and 812×375 using `tests/quiz-smoke.py`, including active-question and timeout states. Full-game accessibility and every special game mode remain outside this bonus-quiz validation.
