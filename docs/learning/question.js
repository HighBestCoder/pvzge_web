const MIN_OPERAND = 10;
const MAX_VALUE = 100;
const OPTION_COUNT = 4;

function randomInteger(random, minimumInclusive, maximumInclusive) {
  const sample = Number(random());
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.9999999999999999) : 0;
  return minimumInclusive + Math.floor(normalized * (maximumInclusive - minimumInclusive + 1));
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = randomInteger(random, 0, index);
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

export function createAdditionQuestion(random = Math.random) {
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }

  const left = randomInteger(random, MIN_OPERAND, MAX_VALUE - MIN_OPERAND);
  const right = randomInteger(random, MIN_OPERAND, MAX_VALUE - left);
  const answer = left + right;
  const options = new Set([answer]);

  for (let distance = 1; options.size < OPTION_COUNT; distance += 1) {
    const lower = answer - distance;
    const upper = answer + distance;
    if (lower >= 0) options.add(lower);
    if (options.size < OPTION_COUNT && upper <= MAX_VALUE) options.add(upper);
  }

  return { left, right, answer, options: shuffle([...options], random) };
}
