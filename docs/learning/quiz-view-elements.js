import { BATCH_SIZE, SUNS_PER_CORRECT } from "./quiz-config.js";

const DIALOG_ID = "addition-quiz";
export const TITLE_ID = "addition-quiz-title";
const DEFAULT_PROGRESS = { current: 1, total: BATCH_SIZE, correctCount: 0 };

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function normalizeProgress(progress = {}) {
  const total = Number.isSafeInteger(progress.total) && progress.total > 0
    ? progress.total : DEFAULT_PROGRESS.total;
  const current = Number.isSafeInteger(progress.current) && progress.current > 0
    ? Math.min(progress.current, total) : DEFAULT_PROGRESS.current;
  const correctCount = Number.isSafeInteger(progress.correctCount) && progress.correctCount >= 0
    ? progress.correctCount : DEFAULT_PROGRESS.correctCount;
  return { current, total, correctCount, challengeRule: progress.challengeRule ?? null,
    message: progress.message };
}

export function formatProgressSummary(progress) {
  const rewardSunCount = Number.isSafeInteger(progress.rewardSunCount)
    ? progress.rewardSunCount : progress.correctCount * SUNS_PER_CORRECT;
  const rewardSunValue = Number.isSafeInteger(progress.rewardSunValue)
    ? progress.rewardSunValue : rewardSunCount * 50;
  return `已答对${progress.correctCount}题 · 达标后可得${rewardSunCount}个阳光（${rewardSunValue}点）`;
}

export function updateProgress(dialog, progress) {
  dialog.querySelector('[data-testid="quiz-progress"]').textContent =
    `第${progress.current}/${progress.total}题`;
  dialog.querySelector('[data-testid="quiz-summary"]').textContent = formatProgressSummary(progress);
}

function appendHeader(panel, progress) {
  const header = element("header", "quiz-view__header");
  const heading = element("div", "quiz-view__heading");
  const title = element("h2", "quiz-view__title", "出发前补给");
  title.id = TITLE_ID;
  heading.append(title, element("p", "quiz-view__reward", `答对 +${SUNS_PER_CORRECT}个阳光`));

  const batch = element("div", "quiz-view__batch");
  const position = element("p", "quiz-view__progress", `第${progress.current}/${progress.total}题`);
  position.dataset.testid = "quiz-progress";
  const summary = element(
    "p",
    "quiz-view__summary",
    formatProgressSummary(progress),
  );
  summary.dataset.testid = "quiz-summary";
  batch.append(position, summary);
  if (progress.challengeRule?.enabled) {
    const challenge = element("p", "quiz-view__challenge",
      `错题挑战已开启：答错后每波最多增加${progress.challengeRule.perWaveCap}只，最多${progress.challengeRule.maxWaves}波，共${progress.challengeRule.totalCap}只；仅埃及第3关普通波次生效，教学/特殊关不生效`);
    challenge.setAttribute("role", "status");
    batch.append(challenge);
  }
  header.append(heading, batch);
  panel.append(header);
}

export function prepareDialog(progress, mode) {
  const dialog = element("dialog", `quiz-view quiz-view--${mode}`);
  dialog.id = DIALOG_ID;
  dialog.setAttribute("aria-labelledby", TITLE_ID);
  const panel = element("section", "quiz-view__panel");
  appendHeader(panel, progress);
  dialog.append(panel);
  return { dialog, panel };
}
