import type { AnswerOption, QuestionType, VisualMark } from "./types";

export interface TypeFeatures {
  stem: string;
  instructionMulti: boolean | null;
  instructionKind: string | null;
  options: AnswerOption[];
  optionKinds: string[];
  marks: VisualMark[];
  hasImage: boolean;
  hasTable: boolean;
  hasFormula: boolean;
  feedbackText: string | null;
  plusCount: number;
}

const TF_WORDS = /^(верно|неверно|да|нет|правда|ложь|true|false|yes|no|правильно|неправильно)$/i;

/**
 * Scores every question type from independent cues and returns the best
 * one plus the signals that produced it. No single regex decides a type.
 */
export function detectQuestionType(f: TypeFeatures): { type: QuestionType; confidence: number; signals: string[] } {
  const score: Partial<Record<QuestionType, number>> = {};
  const signals: string[] = [];
  const add = (t: QuestionType, w: number, why: string) => {
    score[t] = (score[t] ?? 0) + w;
    signals.push(`${t}+${w}:${why}`);
  };

  const n = f.options.length;
  const stem = f.stem.toLowerCase();
  const checks = f.marks.filter((m) => m.type === "CHECKMARK" || m.type === "HANDWRITTEN_CHECK").length;
  const selected = f.marks.filter((m) => m.type === "SELECTED").length;

  if (f.instructionKind === "MATCHING") add("MATCHING", 4, "instruction:matching");
  if (f.instructionKind === "ORDERING") add("ORDERING", 4, "instruction:ordering");
  if (f.instructionKind === "TEXT") add(n === 0 ? "SHORT_TEXT" : "SINGLE_CHOICE", 2, "instruction:enter");
  if (f.instructionMulti === true) add("MULTIPLE_CHOICE", 4, "instruction:multi");
  if (f.instructionMulti === false) add("SINGLE_CHOICE", 4, "instruction:single");

  if (/(соответстви|сопостав|match\s+the|matching)/i.test(stem)) add("MATCHING", 3, "stem:matching");
  if (/(последовательност|по\s+порядку|в\s+порядке|правильный\s+порядок|упорядоч|arrange|correct\s+order|sequence)/i.test(stem)) add("ORDERING", 3, "stem:ordering");
  if (/(все\s+правильн|все\s+верн|несколько|выберите\s+все|all\s+that\s+apply|which\s+of\s+the\s+following\s+are)/i.test(stem)) add("MULTIPLE_CHOICE", 2, "stem:multi");

  const imageCue = /(на\s+рисунке|на\s+изображени|изображен|цифр(?:ой|ами)\s+\d|под\s+номером\s+\d|обозначен[а-яёa-z]*\s+(?:цифр|номер|букв)|отмечен[а-яёa-z]*\s+(?:цифр|стрелк)|стрелк|figure|image|picture|labell?ed|shown\s+in)/i.test(stem);
  if (imageCue && f.hasImage) add("IMAGE_IDENTIFICATION", 3, "stem+image");
  else if (imageCue) add("IMAGE_IDENTIFICATION", 1.5, "stem:image-cue-no-image");
  if (/(подпишите|обозначьте\s+структуры|label\s+the)/i.test(stem) && f.hasImage) add("IMAGE_LABELING", 3, "stem:labeling");

  const bracketCount = f.optionKinds.filter((k) => k === "BRACKET").length;
  if (bracketCount >= 2) {
    add("ORDERING", 1.5, "options:[NN]");
    add("MATCHING", 1, "options:[NN]");
  }
  const pairs = f.options.filter((o) => o.pairText).length;
  if (pairs >= 2) add("MATCHING", 3, "options:pairs");

  if (n === 2 && f.options.every((o) => TF_WORDS.test(o.text.trim()))) add("TRUE_FALSE", 5, "options:true/false");

  if (n >= 2) {
    add("SINGLE_CHOICE", 1, "options>=2");
    const correctSignals = Math.max(checks, f.plusCount);
    if (correctSignals >= 2) add("MULTIPLE_CHOICE", 3, `marks:${correctSignals}-correct`);
    if (selected >= 2) add("MULTIPLE_CHOICE", 2, `marks:${selected}-selected`);
    if (correctSignals === 1 && f.instructionMulti !== true) add("SINGLE_CHOICE", 1, "marks:1-correct");
  }

  if (n === 0) {
    const numericStem = /(рассчитайте|вычислите|определите\s+(?:значение|величину)|чему\s+равн|найдите|calculate|compute|how\s+(?:many|much))/i.test(stem);
    if (numericStem) add("NUMERIC", 3, "stem:compute");
    if (f.feedbackText && /^-?\d+(?:[.,]\d+)?\s*\S{0,6}$/.test(f.feedbackText.trim())) add("NUMERIC", 2, "feedback:number");
    if (f.hasFormula) add("FORMULA", 2, "formula-without-options");
    if (f.hasTable) add("TABLE", 2, "table-without-options");
    add("SHORT_TEXT", f.feedbackText ? 2 : 0.5, f.feedbackText ? "feedback-text" : "no-options");
  }

  if (f.hasTable && n >= 2) add("TABLE", 0.5, "table+options");

  const ranked = (Object.entries(score) as [QuestionType, number][]).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { type: "UNKNOWN", confidence: 0, signals };
  const [best, second] = ranked;
  const total = ranked.reduce((s, [, v]) => s + v, 0);

  // Two strong, structurally different types → combined question.
  if (second && second[1] >= 3 && best[1] - second[1] < 0.5 && !(["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(best[0]) && ["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(second[0]))) {
    return { type: "COMBINATION", confidence: 0.55, signals };
  }

  const margin = second ? (best[1] - second[1]) / Math.max(best[1], 1) : 1;
  const confidence = Math.max(0.3, Math.min(0.99, 0.5 * (best[1] / total) + 0.5 * margin + (best[1] >= 4 ? 0.1 : 0)));
  return { type: best[0], confidence: Number(confidence.toFixed(2)), signals };
}
