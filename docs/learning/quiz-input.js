import { element } from "./quiz-view-elements.js";

const FULLWIDTH_ZERO = "０".charCodeAt(0);
const ASCII_ZERO = "0".charCodeAt(0);
const MAX_LENGTH = 16;

export function normalizeNumericValues(values) {
  return values.map((value) => Array.from(value.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9
      ? String.fromCharCode(ASCII_ZERO + code - FULLWIDTH_ZERO) : character;
  }).join(""));
}

export function validateNumericValues(inputSpec, drafts) {
  const values = normalizeNumericValues(drafts);
  const arity = ["fraction", "pair"].includes(inputSpec.format) ? 2 : 1;
  if (values.length !== arity || values.some((value) => value.length === 0 || value.length > MAX_LENGTH)) {
    return { valid: false, message: "请填写完整答案" };
  }
  let valid;
  if (inputSpec.format === "decimal") valid = /^[0-9]+(?:\.[0-9]+)?$/.test(values[0]);
  else if (["integer", "digits", "pair"].includes(inputSpec.format)) {
    valid = values.every((value) => /^[0-9]+$/.test(value));
  } else valid = /^-?[0-9]+$/.test(values[0]) && /^0*[1-9][0-9]*$/.test(values[1]);
  return valid ? { valid: true, values } : { valid: false, message: "请按题目要求填写数字" };
}

export function applyNumericKey(value, key, inputSpec, fieldIndex = 0) {
  if (key === "backspace") return value.slice(0, -1);
  if (key === "minus") {
    if (inputSpec.format !== "fraction" || fieldIndex !== 0) return value;
    return value.startsWith("-") ? value.slice(1) : `-${value}`;
  }
  if (key === "." && (inputSpec.format !== "decimal" || value.includes("."))) return value;
  return value.length < MAX_LENGTH && (/^[0-9]$/.test(key) || key === ".") ? `${value}${key}` : value;
}

function fieldDefinitions(inputSpec) {
  if (inputSpec.format === "fraction") return [inputSpec.numeratorLabel, inputSpec.denominatorLabel];
  if (inputSpec.format === "pair") return inputSpec.labels;
  if (inputSpec.format === "digits") return [inputSpec.label];
  return [inputSpec.format === "decimal" ? "填写小数" : "填写整数"];
}

export function createNumericInput(inputSpec, onSubmit) {
  const root = element("form", `quiz-input quiz-input--${inputSpec.format}`);
  root.noValidate = true;
  const fields = element("div", "quiz-input__fields");
  const inputs = fieldDefinitions(inputSpec).map((labelText, index) => {
    const label = element("label", "quiz-input__field");
    const caption = element("span", "quiz-input__label", labelText);
    const input = element("input", "quiz-input__control");
    input.type = "text";
    input.inputMode = inputSpec.format === "decimal" ? "decimal" : "numeric";
    input.autocomplete = "off";
    input.maxLength = MAX_LENGTH;
    input.dataset.numericField = String(index);
    input.setAttribute("aria-describedby", "quiz-input-hint");
    label.append(caption, input);
    fields.append(label);
    return input;
  });
  const hint = element("p", "quiz-input__hint", "");
  hint.id = "quiz-input-hint";
  hint.setAttribute("role", "alert");
  hint.hidden = true;
  const keypad = element("div", "quiz-keypad");
  keypad.setAttribute("aria-label", "数字键盘");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  if (inputSpec.format === "decimal") keys.push(".");
  if (inputSpec.format === "fraction") keys.push("minus");
  keys.push("backspace");
  let focused = inputs[0];
  let focusedIndex = 0;
  let minusButton = null;
  const updateFocused = (input, index) => {
    focused = input;
    focusedIndex = index;
    if (minusButton) minusButton.disabled = index !== 0;
  };
  for (const [index, input] of inputs.entries()) {
    input.addEventListener("focus", () => updateFocused(input, index));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "-") return;
      event.preventDefault();
      input.value = applyNumericKey(input.value, "minus", inputSpec, index);
      hint.hidden = true;
    });
  }
  for (const key of keys) {
    const text = key === "backspace" ? "退格" : key === "minus" ? "±" : key;
    const button = element("button", "quiz-keypad__key", text);
    button.type = "button";
    button.dataset.numericKey = key;
    button.setAttribute("aria-label", key === "backspace" ? "删除一位" : key === "minus" ? "切换负号" : `输入${text}`);
    if (key === "minus") minusButton = button;
    button.addEventListener("click", () => {
      focused.value = applyNumericKey(focused.value, key, inputSpec, focusedIndex);
      focused.focus({ preventScroll: true });
      hint.hidden = true;
    });
    keypad.append(button);
  }
  const submit = element("button", "quiz-view__button quiz-input__submit", "提交答案");
  submit.type = "submit";
  submit.dataset.testid = "quiz-submit";
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = validateNumericValues(inputSpec, inputs.map((input) => input.value));
    if (!result.valid) {
      hint.textContent = result.message;
      hint.hidden = false;
      inputs.find((input) => input.value.trim().length === 0)?.focus({ preventScroll: true });
      return;
    }
    onSubmit(result.values);
  });
  root.append(fields, hint, keypad, submit);
  return {
    root, inputs,
    disable() { root.querySelectorAll("input, button").forEach((control) => { control.disabled = true; }); },
    focus() { inputs[0].focus({ preventScroll: true }); },
  };
}
