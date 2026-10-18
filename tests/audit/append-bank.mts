/**
 * Adds questions from a newly parsed Moodle printout to an existing built-in bank:
 *   npx tsx tests/audit/append-bank.mts parsed.json bankId [skipNumbers,comma,separated] [pages.json]
 * Only questions with a proven answer that the bank does not already contain are added. Questions that refer
 * to a picture the printout did not carry, or whose layout could not be read cleanly, are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { toStructuredQuestion, type MCQQuestion } from "../../src/types/question";

const [input, bankId, skipArg = "", pagesPath = ""] = process.argv.slice(2);
const skip = new Set(skipArg.split(",").filter(Boolean).map(Number));
const parsed = JSON.parse(fs.readFileSync(input, "utf8")) as MCQQuestion[];
const bankPath = path.resolve("public/banks", `${bankId}.json`);
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8")) as { id: string; title: string; questions: { id: string; question: { text: string } }[] };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
const seen = new Set(bank.questions.map((q) => norm(q.question.text)));
const isStructured = (q: MCQQuestion) => q.tags?.includes("ordering") || q.tags?.includes("matching");
const hasAnswer = (q: MCQQuestion) => (isStructured(q) ? !!(q.sequence || q.matching) : !!(q.correctAnswer || q.answerText?.trim()));
const NEEDS_PICTURE = /рисунк|график|спирограмм|сфигмограмм|ЭКГ|изображен/i;
const NOISE = /[\u0000-\u001f]|https?:|review\.php|[□■]/;

type Item = { str: string; x?: number; transform?: number[] };
const xOf = (i: Item) => i.transform?.[4] ?? i.x ?? 0;
const pages = pagesPath ? (JSON.parse(fs.readFileSync(pagesPath, "utf8")) as { items: Item[] }[]) : [];
const LABEL = /^Текст\s+вопроса\s*/u;
const SELECT_HINT = /^Выберите (?:один|одн[иу]|несколько)/u;
const END = /^(?:Правильн|Ваш ответ|Ответ:|Вопрос \d)/u;

/**
 * Some printouts lay checkbox questions out without option letters, so the parser folds every option into the
 * stem and keeps only the comma list of correct answers. The original rows are still on the page: the stem
 * sits at the left margin, the "Выберите…" hint follows, and each option is one indented row.
 */
function recoverCheckboxOptions(q: MCQQuestion): MCQQuestion | null {
  const text = q.question.replace(LABEL, "");
  for (const page of pages) {
    const items = page.items.filter((i) => i.str.trim());
    for (let k = 0; k < items.length; k++) {
      const head = items[k].str.trim();
      if (head.length < 12 || !text.startsWith(head)) continue;
      const stem = [head];
      let j = k + 1;
      while (j < items.length && !SELECT_HINT.test(items[j].str) && !END.test(items[j].str) && xOf(items[j]) <= xOf(items[k]) + 2) stem.push(items[j++].str.trim());
      if (!SELECT_HINT.test(items[j]?.str ?? "")) continue;
      const opts: string[] = [];
      for (j++; j < items.length && !END.test(items[j].str.trim()); j++) {
        if (xOf(items[j]) > xOf(items[k]) + 10) opts.push(items[j].str.trim());
        else break;
      }
      const correct = (q.answerText ?? "").split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
      const keys = opts.map((_, i) => String.fromCharCode(65 + i));
      const hits = correct.map((c) => opts.findIndex((o) => norm(o) === norm(c)));
      if (opts.length < 2 || hits.some((h) => h < 0)) return null;
      return {
        ...q,
        question: stem.join(" "),
        options: Object.fromEntries(opts.map((o, i) => [keys[i], o])),
        correctAnswer: [...new Set(hits)].sort((a, b) => a - b).map((h) => keys[h]).join(","),
        answerText: correct.join("; "),
      };
    }
  }
  return null;
}

const skipped: string[] = [];
const added: MCQQuestion[] = [];
for (const raw of parsed) {
  const stripped = { ...raw, question: raw.question.replace(LABEL, "") };
  const listAnswer = !Object.keys(raw.options ?? {}).length && LABEL.test(raw.question) && !/^-?[\d.,]+\s*\S{0,6}$/.test((raw.answerText ?? "").trim());
  const recovered = listAnswer ? recoverCheckboxOptions(raw) : null;
  if (listAnswer && !recovered) {
    skipped.push(`#${raw.number} [options unreadable] ${stripped.question.slice(0, 80)}`);
    continue;
  }
  const q = recovered ?? stripped;
  const key = norm(q.question);
  if (seen.has(key)) continue;
  const reason = skip.has(q.number)
    ? "layout"
    : q.status !== "answered" || !hasAnswer(q)
      ? "no proven answer"
      : !q.imageId && NEEDS_PICTURE.test(q.question)
        ? "picture missing"
        : NOISE.test(q.question + JSON.stringify(q.options) + (q.answerText ?? ""))
          ? "noise"
          : null;
  if (reason) {
    skipped.push(`#${q.number} [${reason}] ${q.question.slice(0, 80)}`);
    continue;
  }
  seen.add(key);
  added.push(q);
}

const start = Math.max(...bank.questions.map((q) => Number(q.id.split("-").pop()) || 0));
const fresh = added.map((q, i) => {
  const n = start + i + 1;
  const sq = toStructuredQuestion({ ...q, number: n, id: `${bankId}-${n}`, explanation: undefined }, `bank-${bankId}`, bank.title);
  return { ...sq, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "verified" as const };
});
bank.questions.push(...(fresh as never[]));
fs.writeFileSync(bankPath, JSON.stringify(bank));
console.log({ bankId, added: fresh.length, total: bank.questions.length, skipped: skipped.length });
console.log(skipped.join("\n"));
