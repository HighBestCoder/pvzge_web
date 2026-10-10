// Draws the optional question figure (validated by provider.parseFigure) as plain DOM, so it stays
// crisp on an iPad and needs no image files. Four shapes cover the grade-3 cycle puzzles:
//   sequence – a repeating group drawn a few times (beads, balls, digits)
//   rows     – rows that repeat their own pattern, aligned under column numbers
//   order    – which lane (row name / person) each step 1, 2, 3 … lands on
//   grid     – a small table with optional headers and blank cells

// Literal colour words get a real colour chip; anything else is a neutral text chip.
const COLOURS = { 黑: "black", 白: "white", 红: "red", 橙: "orange", 黄: "yellow", 绿: "green",
  青: "cyan", 蓝: "blue", 紫: "purple" };

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function chip(token) {
  const colour = token.length <= 2 ? COLOURS[token[0]] : undefined;
  const result = node("span", colour ? `quiz-figure__chip quiz-figure__chip--${colour}` : "quiz-figure__chip", token);
  return result;
}

function more(tag = "span") {
  const result = node(tag, "quiz-figure__more", "……");
  result.setAttribute("aria-hidden", "true");
  return result;
}

function sequence(figure) {
  const strip = node("div", "quiz-figure__strip");
  for (let group = 0; group < figure.repeat; group += 1) {
    const box = node("span", "quiz-figure__group");
    figure.items.forEach((item) => box.append(chip(item)));
    strip.append(box);
  }
  strip.append(more());
  return strip;
}

function table() {
  const result = node("table", "quiz-figure__table");
  result.append(node("thead"), node("tbody"));
  return result;
}

function headerRow(corner, labels) {
  const row = node("tr");
  row.append(node("th", "quiz-figure__corner", corner));
  labels.forEach((label) => row.append(node("th", "quiz-figure__head", label)));
  return row;
}

function rows(figure) {
  const grid = table();
  const columns = Array.from({ length: figure.columns }, (_, index) => index + 1);
  const head = headerRow("列", columns.map(String));
  head.append(more("th"));
  grid.tHead.append(head);
  figure.rows.forEach(({ label, pattern }) => {
    const row = node("tr");
    row.append(node("th", "quiz-figure__label", label));
    columns.forEach((column) => {
      const offset = column - 1;
      // Shade every other repetition so each row's own group length is visible.
      const alternate = Math.floor(offset / pattern.length) % 2 === 1;
      row.append(node("td", alternate ? "quiz-figure__cell quiz-figure__cell--alt" : "quiz-figure__cell",
        pattern[offset % pattern.length]));
    });
    row.append(more("td"));
    grid.tBodies[0].append(row);
  });
  return grid;
}

function order(figure) {
  const grid = table();
  const steps = figure.sequence.map((_, index) => String(index + 1));
  const head = headerRow("第几个", steps);
  head.append(more("th"));
  grid.tHead.append(head);
  figure.lanes.forEach((lane) => {
    const row = node("tr");
    row.append(node("th", "quiz-figure__label", lane));
    figure.sequence.forEach((step, index) => {
      const hit = step === lane;
      row.append(node("td", hit ? "quiz-figure__cell quiz-figure__cell--hit" : "quiz-figure__cell",
        hit ? String(index + 1) : ""));
    });
    row.append(more("td"));
    grid.tBodies[0].append(row);
  });
  return grid;
}

function grid(figure) {
  const result = table();
  if (figure.header) result.tHead.append(headerRow("", figure.header));
  figure.cells.forEach((cells, index) => {
    const row = node("tr");
    if (figure.rowLabels) row.append(node("th", "quiz-figure__label", figure.rowLabels[index]));
    cells.forEach((value) => row.append(node("td",
      value === "" ? "quiz-figure__cell quiz-figure__cell--blank" : "quiz-figure__cell", value)));
    result.tBodies[0].append(row);
  });
  return result;
}

const RENDERERS = { sequence, rows, order, grid };

export function createFigure(figure) {
  const render = RENDERERS[figure?.type];
  if (!render) return null;
  const container = node("figure", `quiz-figure quiz-figure--${figure.type}`);
  container.dataset.testid = "quiz-figure";
  const body = node("div", "quiz-figure__body");
  body.append(render(figure));
  container.append(body);
  if (figure.caption) container.append(node("figcaption", "quiz-figure__caption", figure.caption));
  return container;
}
