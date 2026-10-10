export const BATCH_SIZE = 10;
export const SUNS_PER_CORRECT = 5;
// A round must reach this accuracy before the game starts; mirrors the server's GAME_UNLOCK_PERCENT.
export const GAME_UNLOCK_PERCENT = 90;

export function requiredCorrect(questionCount) {
  return Math.ceil((questionCount * GAME_UNLOCK_PERCENT) / 100);
}

export function meetsGameUnlock(correctCount, questionCount) {
  return questionCount > 0 && correctCount * 100 >= questionCount * GAME_UNLOCK_PERCENT;
}
