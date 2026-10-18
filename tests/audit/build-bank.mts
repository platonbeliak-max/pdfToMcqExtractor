/**
 * Publishes a parsed Moodle bank as a built-in test bank:
 *   npx tsx tests/audit/build-bank.mts parsed.json figDir bankId "Bank title"
 * Questions whose answer the printout cannot prove (the student answered wrong / partially) are completed
 * from tests/audit/bank-overrides.json; the build fails if any question is still left without an answer.
 * Writes public/banks/<bankId>.json and copies the referenced pictures to public/banks/img/.
 */
import fs from "node:fs";
import path from "node:path";
import { toStructuredQuestion, type MCQQuestion } from "../../src/types/question";

interface Override {
  q: string;
  opt?: string;
  keys?: string[];
  accept?: boolean;
  text?: string;
  question?: string;
  addOption?: string;
  options?: Record<string, string>;
  matching?: MCQQuestion["matching"];
  /** Ordering answer: option text prefixes in the correct order. */
  sequence?: string[];
  /** Free-text question whose expected answer cannot be recovered from the file — left out of the bank. */
  drop?: boolean;
}

const DROPPED = Symbol("dropped");

const [input, figDir, bankId, title] = process.argv.slice(2);
const parsed = JSON.parse(fs.readFileSync(input, "utf8")) as MCQQuestion[];
const overrides = (JSON.parse(fs.readFileSync(path.resolve("tests/audit/bank-overrides.json"), "utf8"))[bankId] ?? []) as Override[];
const outDir = path.resolve("public/banks");
fs.mkdirSync(path.join(outDir, "img"), { recursive: true });

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const isStructured = (q: MCQQuestion) => q.tags?.includes("ordering") || q.tags?.includes("matching");
const hasAnswer = (q: MCQQuestion) => (isStructured(q) ? !!(q.sequence || q.matching) : !!(q.correctAnswer || q.answerText?.trim()));
const NOTE = "Ответ уточнён: в исходном файле этот вопрос решён неверно или не полностью";

function applyOverride(q: MCQQuestion): MCQQuestion | typeof DROPPED | null {
  const o = overrides.find(
    (x) => norm(q.question).includes(norm(x.q)) && (!x.opt || Object.values(q.options ?? {}).some((v) => norm(v).includes(norm(x.opt!)))),
  );
  if (!o) return null;
  if (o.drop) return DROPPED;
  const done = { ...q, status: "answered" as const, confidence: "medium" as const, explanation: NOTE };
  if (o.accept) return { ...done, explanation: undefined };
  if (o.sequence) {
    const options = q.options ?? {};
    const sequence: Record<string, number> = {};
    o.sequence.forEach((prefix, idx) => {
      const letter = Object.keys(options).find((l) => norm(options[l]).startsWith(norm(prefix)));
      if (!letter) throw new Error(`Sequence step matched nothing: ${prefix} in ${q.question}`);
      sequence[letter] = idx + 1;
    });
    if (Object.keys(sequence).length !== Object.keys(options).length) throw new Error(`Sequence incomplete: ${q.question}`);
    const answerText = Object.entries(sequence)
      .sort((a, b) => a[1] - b[1])
      .map(([l, n]) => `${n}) ${options[l]}`)
      .join("; ");
    return { ...done, sequence, answerText, correctAnswer: null };
  }
  if (o.matching && !o.options) {
    const answerText = Object.entries(q.options ?? {}).map(([k, v]) => `${v} → ${o.matching!.pairs[k]}`).join("; ");
    return { ...done, matching: o.matching, answerText, correctAnswer: null };
  }
  if (o.matching && o.options) {
    const answerText = Object.entries(o.options).map(([k, v]) => `${v} → ${o.matching!.pairs[k]}`).join("; ");
    return { ...done, options: o.options, matching: o.matching, answerText, correctAnswer: null };
  }
  if (o.text) return { ...done, question: o.question ?? q.question, options: {}, correctAnswer: null, answerText: o.text };
  const options = { ...(q.options ?? {}) };
  let letters: string[] = [];
  if (o.addOption) {
    const letter = String.fromCharCode(65 + Object.keys(options).length);
    options[letter] = o.addOption;
    letters = [letter];
  } else {
    letters = Object.entries(options)
      .filter(([, v]) => o.keys!.some((k) => norm(v).startsWith(norm(k))))
      .map(([l]) => l);
  }
  if (!letters.length) throw new Error(`Override matched nothing: ${q.question}`);
  return { ...done, options, correctAnswer: letters.join(","), answerText: letters.map((l) => options[l]).join("; ") };
}

interface Split {
  q: string;
  question: string;
  options: string[];
  keys: string[];
}
const splits = (JSON.parse(fs.readFileSync(path.resolve("tests/audit/bank-overrides.json"), "utf8"))[`${bankId}:split`] ?? []) as Split[];

/** Inline-option items ("Текст вопроса … opt opt opt") have no option markers, so options are listed by hand. */
function applySplit(q: MCQQuestion): MCQQuestion | null {
  const s = splits.find((x) => norm(q.question).includes(norm(x.q)));
  if (!s) return null;
  const options = Object.fromEntries(s.options.map((t, i) => [String.fromCharCode(65 + i), t]));
  const letters = Object.keys(options).filter((l) => s.keys.some((k) => norm(options[l]) === norm(k)));
  if (letters.length !== s.keys.length) throw new Error(`Split keys mismatch: ${q.question}`);
  return {
    ...q,
    question: s.question,
    options,
    tags: (q.tags ?? []).filter((t) => t !== "ordering" && t !== "matching"),
    sequence: undefined,
    matching: undefined,
    status: "answered",
    correctAnswer: letters.join(","),
    answerText: letters.map((l) => options[l]).join("; "),
  };
}

const unresolved: string[] = [];
const completed = parsed.map((q) => {
  const split = applySplit(q);
  if (split) return split;
  if (overrides.some((x) => x.drop && norm(q.question).includes(norm(x.q)))) return DROPPED;
  if (q.status === "answered" && hasAnswer(q)) return q;
  const fixed = applyOverride(q);
  if (fixed === DROPPED) return DROPPED;
  if (fixed && hasAnswer(fixed)) return fixed;
  unresolved.push(`#${q.number} ${q.question.slice(0, 90)}`);
  return null;
});
if (unresolved.length) {
  console.error(`${unresolved.length} questions still without an answer:\n${unresolved.join("\n")}`);
  process.exit(1);
}

const seen = new Set<string>();
const kept = completed.filter((q): q is MCQQuestion => q !== DROPPED && q !== null).filter((q) => {
  const key = `${norm(q.question)}|${Object.values(q.options ?? {}).map(norm).sort().join("|")}|${q.imageId ?? ""}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const questions = kept.map((q, i) => {
  const sq = toStructuredQuestion({ ...q, number: i + 1, id: `${bankId}-${i + 1}`, explanation: q.explanation === NOTE ? NOTE : undefined }, `bank-${bankId}`, title);
  if (sq.imageId) fs.copyFileSync(path.join(figDir, `${sq.imageId}.webp`), path.join(outDir, "img", `${sq.imageId}.webp`));
  return { ...sq, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "verified" as const };
});

fs.writeFileSync(path.join(outDir, `${bankId}.json`), JSON.stringify({ id: bankId, title, questions }));
const by = (k: string) => questions.filter((q) => q.tags?.includes(k)).length;
console.log({
  bankId,
  parsed: parsed.length,
  published: questions.length,
  fromFile: parsed.filter((q) => q.status === "answered" && hasAnswer(q)).length,
  completedByOverride: completed.filter((q) => q?.explanation === NOTE).length,
  ordering: by("ordering"),
  matching: by("matching"),
  figures: questions.filter((q) => q.imageId).length,
});
