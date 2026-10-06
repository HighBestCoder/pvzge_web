# PvZ Garden Quiz Design System

The dialog renders provider-owned plain-text content and opaque option IDs. It does not
parse subject content, grade answers, or award resources. The fixed title is “出发前补给”;
question prompts may wrap for any subject, while the local demo supplies two-digit addition.
Before each level, the controller presents the server-configured question count and then starts
uninterrupted gameplay. The task's `timeLimitMs` controls each visible countdown (20 seconds in
the local demo provider); provider fetch and grading states are untimed.

## 1. Atmosphere & Identity

The quiz is a friendly pre-game supply stop laid over the existing lawn, not a new product or a redesign. Its signature is the pause screen's carved garden sign: a warm brown wood face, cream outlined lettering, a gold-brown rim, green success energy, and chunky raised purple or brown controls. The tone rewards trying, never punishes a wrong answer, and always leaves an obvious exit from the whole practice batch.

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
| Error light | `--quiz-error-light` | `#d96b42` | Selected incorrect answer highlight |
| Error | `--quiz-error` | `#a43d25` | Incorrect result face |
| Error dark | `--quiz-error-dark` | `#612315` | Incorrect result depth |
| Focus | `--quiz-focus` | `#fff27a` | Keyboard focus ring |

Translucent material tokens are `--quiz-grain`, `--quiz-wash`, `--quiz-wash-strong`, `--quiz-highlight`, `--quiz-rim-highlight`, and `--quiz-shadow`; they supply only wood grain, inset light, coaching backdrop, and elevation. Geometry tokens are `--quiz-radius-panel: 28px`, `--quiz-radius-control: 14px`, `--quiz-target: 44px`, `--quiz-control-min: 220px`, `--quiz-stage-card-max: 640px`, `--quiz-stroke: 2px`, `--quiz-stroke-bold: 3px`, `--quiz-depth: 4px`, and `--quiz-press: 2px`.

Color rules: cream on dark outlined surfaces is the default text treatment; green and gold communicate reward; purple is the answer family. Correct feedback and the confirmed correct option use the leaf ramp. A selected incorrect option and incorrect result use the muted error ramp with explicit text; timeout and skip remain neutral gold/wood and are never styled as wrong.

## 3. Typography

The required stack is Chinese system UI: `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif`. Heavy weights and a dark offset text shadow approximate the canvas display lettering without external fonts or assets.

| Level | Token | Size | Weight | Line height | Usage |
|---|---|---|---|---|---|
| Title | `--quiz-type-title` | `clamp(1.5rem, 5vw, 2rem)` | 900 | 1.2 | Dialog title |
| Equation | `--quiz-type-equation` | `clamp(2rem, 9vw, 3rem)` | 900 | 1.1 | Addition prompt |
| Landscape equation | `--quiz-type-equation-landscape` | `2rem` | 900 | 1.1 | Standard addition prompt in short landscape |
| Button | `--quiz-type-button` | `clamp(1rem, 3.6vw, 1.25rem)` | 800 | 1.25 | Answers and actions |
| Body | `--quiz-type-body` | `1rem` | 700 | Instructions and timer status |
| Caption | `--quiz-type-caption` | `0.875rem` | Reward and skip |

Body copy never falls below 14px. Instructions use short complete Chinese phrases; progress and quantity phrases such as `第1/10题`, `答对 +5个阳光`, `已答对9题`, `累计奖励45个阳光（2250点）`, and `剩余20秒` remain atomic where space permits and reflow into short rows at 375px. Provider-owned task and option text may wrap anywhere rather than overflow.

## 4. Spacing & Layout

The base unit is 4px. Tokens are `--quiz-space-1: 4px`, `--quiz-space-2: 8px`, `--quiz-space-3: 12px`, `--quiz-space-4: 16px`, `--quiz-space-5: 20px`, `--quiz-space-6: 24px`, and `--quiz-space-8: 32px`.

The modal is centered with a maximum inline size of 960px and viewport/safe-area gutters. The question header places the title/reward and the progress/summary as two compact rows. Each question owns one persistent content grid: the original prompt, timer, options, and skip action remain in the left pane; a right solution pane starts with `选好答案后，这里会出现题解`, then shows judging, retry, timeout/skip, or accepted feedback without replacing the dialog. At widths below 720px the solution pane moves below the question instead of narrowing beside it. The option field remains a two-column grid where space permits and collapses to one column at 480px. The panel and long solution pane may scroll for provider text up to 4000 characters; explanation text preserves plaintext newlines with `white-space: pre-wrap`. Every state must fit 375×812, 768×1024, 1280×800, and 812×375; every interactive target is at least 44px high. Browser mechanics such as `min()`, `clamp()`, percentages, viewport units, and intrinsic sizing do not require tokens.

## 5. Components

### Quiz Dialog / Wood Panel
- **Structure**: native `dialog#addition-quiz` > `.quiz-view__panel` > header, batch status, and state-specific content. The stable ID remains compatible with the existing page-level input guard.
- **Spacing**: viewport gutter uses `--quiz-space-4`; panel rhythm uses `--quiz-space-4` through `--quiz-space-8`.
- **States**: closed, generic pre-task loading, active timed question, submitted judging/retry, and accepted-result reading. A submitted question retains the same dialog and left-pane DOM nodes through judging and feedback. Only a new question, controller dismissal, or explicit continuation removes it; stale events cannot settle a replacement.
- **Accessibility**: modal `showModal()`, labelled title, state-specific descriptions, native focus containment, Escape behavior, and previous-focus restoration. The changing timer has `role="timer"` and `aria-live="off"` to avoid per-second announcements.
- **Motion**: a standard 180ms opacity/transform entrance; absent under reduced motion.
- **Layout**: centered stack; the panel owns overflow in short viewports.

### Batch Progress
- **Structure**: `[data-testid="quiz-progress"]` shows `第{current}/{total}题`; `[data-testid="quiz-summary"]` shows server-confirmed `已答对{correctCount}题 · 累计奖励{rewardSunCount}个阳光（{rewardSunValue}点）`. When the frozen rule is enabled, a wrapping third line states the per-wave, max-wave, and total caps before the first answer, names Egypt level 3 ordinary waves as the current supported scope, and excludes teaching/special levels.
- **Defaults**: omitted progress means `{ current: 1, total: 10, correctCount: 0 }` for both question and loading states.
- **Responsibility**: progress is display-only controller input. After each accepted submission the controller replaces every count with `result.progress`; retries and network failures do not mutate it. The view never infers correctness, mutates counts, or awards sunlight.

### Raised Button
- **Variants**: purple answer, quiet `跳过本题`, and quiet `取消练习并开始游戏`.
- **States**: default gradient face, brighter hover, 2px pressed translation, and yellow focus ring.
- **Accessibility**: semantic `button`, at least 44px high, visible `:focus-visible`, state is never conveyed by color alone.
- **Motion**: micro 120ms transform/filter only; disabled with reduced motion.

### Countdown Status
- **Structure**: `.quiz-view__timing` contains `.quiz-view__timer[role="timer"][aria-live="off"]` and a static timeout explanation.
- **States**: starts visibly from the task limit, decreases from the monotonic absolute deadline, and disappears with the dialog at expiry. Intermediate questions say `超时后进入下一题，不获得奖励`; the final question says `超时后开始游戏，不获得奖励`.
- **Accessibility**: the static timeout consequence is part of the dialog description; countdown updates are visual only and never spam an assistive-technology live region.

### Numeric Entry / Digit Pad
- **Structure**: numeric tasks replace the option grid with `.quiz-input`; integer, decimal, and digits use one labelled field, fraction uses labelled numerator and denominator fields separated visually by a rule, and pair uses two labelled fields. The shared `.quiz-keypad` provides digits `0` through `9`, backspace, a decimal key only for decimal tasks, and a minus toggle only while a fraction numerator is focused; a separate raised `提交答案` button is always required.
- **States**: editable draft, accessible malformed hint, submitted/pending, retry, and accepted result. Draft text including `0` and `09`, the focused field, and the original absolute deadline survive temporary page hiding in the same detached DOM. Every field and keypad/action control locks after a valid submission and remains visible through retry and feedback.
- **Validation boundary**: the view normalizes surrounding whitespace and full-width digits, then checks only lexical format and arity. It never compares against an expected answer. Empty input is invalid rather than zero; fraction numerator may be signed while content remains nonnegative by policy.
- **Accessibility**: native labelled text inputs retain hardware keyboard, Tab, Enter, and contextual minus-key support; malformed text uses an assertive status linked through `aria-describedby`. Keypad buttons name their action, the minus control visibly disables on the denominator, targets remain at least `--quiz-target`, and mobile fields use numeric/decimal input modes without changing stored draft text.

### Unscored Stage Example
- **Structure**: `.quiz-stage-card` uses the existing wood panel and solution material to present the stage title, worked prompt, answer, and explanation with an explicit `开始答题` button and an `不计分示例` label.
- **Lifecycle**: it appears only for a session with `completedCount === 0` and an optional provider `stageCard` whose `scored` value is false. No task is requested and no timer exists while it is open. Legacy sessions omit it; resumed sessions never repeat it.
- **Accessibility**: the card is plain text rendered with `textContent`, its explanation preserves newlines, and focus begins on the explicit start button.

### Provider Loading Status
- **Structure**: before the first task, the generic panel displays `.quiz-view__loading-status[role="status"]`, defaulting to `正在准备题目`. After an answer/timeout/skip, the existing question's right pane displays the same status treatment; the left pane and selected option remain mounted.
- **States**: untimed and non-periodic. Submitted loading has no countdown or interval, may expose retry/cancel actions in the right pane, and never rebuilds the question. The visible cancel action and Escape each invoke the current loading state's `onCancel` callback at most once.
- **Programmatic close**: `dismiss(reason)` closes loading without invoking `onCancel`, preventing recursive controller cancellation.

### Result Feedback
- **Structure**: the persistent right pane uses a large inline SVG check, cross, or neutral clock plus `.quiz-view__result[role="status"][aria-live="polite"]`. Accepted graded results show `回答正确` or `回答错误`, the provider's correct answer when supplied, and its plaintext explanation. Legacy responses omit an invented answer and display `这道题暂无详细题解`. Timeout displays `时间到了，本题不计分`; skip displays `已跳过` using the neutral wood/gold treatment.
- **Authority**: feedback is created only after the provider DTO, request identity, and answer/outcome status all validate. The client never compares option IDs, reveals the correct answer, or converts a transport/validation failure into wrong-answer feedback.
- **Timing**: feedback reading is unlimited. Only an accepted response enables `下一题`, or `开始游戏` on the final question. The controller awaits that explicit action before requesting another task, ending the session, or entering the game.
- **Lifecycle**: `showResult()` returns `{ action: "next" }` for the explicit button or `{ action: "dismissed", reason }` for controller/visibility/stop dismissal, resolving exactly once. If accepted feedback is hidden, the controller caches it and presents the same result again on visibility restoration; it never requests the next task until the user continues.
- **Accessibility**: outcome text duplicates the icon meaning; correct option and selected incorrect option use text/ARIA state as well as color. Focus moves to the enabled continue button after accepted feedback without scrolling the viewport. The solution region is polite-live, while the timer remains silent.

### Native Game Layout
- The game canvas retains the original full viewport. No account/sync header or added tutorial guide occupies layout space.
- Save authorization and synchronization continue in the background. Blocking errors still use the fixed bootstrap alert without resizing the game canvas.
- The original game tutorial is unchanged; supplementary Chinese tutorial guidance is not mounted.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|---|---|---|---|
| Micro | `120ms` | `ease-out` | Button press/hover |
| Standard | `180ms` | `ease-out` | Dialog entrance |

Only `transform`, `opacity`, and `filter` animate. `prefers-reduced-motion: reduce` removes transitions and entrance motion. An answer click stops propagation, checks the monotonic deadline, freezes the countdown, disables every choice and skip action, retains the selected highlight, changes the source to `submitted`, and resolves `{ type: "answered", optionId, elapsedMs }` without closing. Skip resolves `skipped`; expiry resolves `timed_out` and changes the same solution pane to a neutral submitted state. Programmatic dismissal resolves either the answer intent or continuation promise with its reason exactly once. The per-task deadline uses an absolute `performance.now()` target plus a one-shot due timer, while interval updates are cosmetic. Every native event verifies its source dialog so queued events from an old question cannot submit twice or dismiss a replacement.

## 7. Depth & Surface

Depth uses a mixed rim-and-shadow strategy observed in the pause screenshot. The sign has a dark outer shadow, gold-brown outer rim, cream highlight line, and dark carved inner line over a subtle vertical wood gradient. Raised controls have a cream rim, dark outline, top highlight, and a 4px colored lower edge; active controls translate toward that edge. No image texture or external asset is introduced.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- Target WCAG 2.2 AA: 4.5:1 body-text contrast, 3:1 large text and control boundaries, full keyboard operation, visible focus, and 44px touch targets.
- The native dialog provides focus containment; code restores the invoking focus after close.
- Capture-phase guards stop game keyboard and pointer handlers while preserving events whose target is inside the dialog.
- A question can skip only its current item through `跳过本题` or Escape. Loading exposes `取消练习并开始游戏`; its button and Escape call `onCancel` exactly once. The public `dismiss()` remains available to the controller and never simulates user cancellation.
- Timer changes are not live-announced; the timeout consequence is static, visible, and included in the dialog description.
- Correct-answer and explanation content are never rendered before a valid provider submission result. Explanation remains provider-owned plaintext; newlines are preserved and HTML is never interpreted.
- The layout must fit 375px portrait and short landscape without page-level horizontal overflow.

### Accepted Debt

The original fixed-aspect canvas can crop or letterbox on narrow screens; this feature does not redesign the base game. Browser integration, batch control, provider interception, network abort, grading, reward queueing, and starting the level remain parent/controller responsibilities. Full-game accessibility and every special game mode remain outside this pre-game quiz validation.
