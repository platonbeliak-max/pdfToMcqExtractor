/**
 * End-to-end audit of a set of Moodle attempt PDFs, mirroring what the browser does on a multi-file upload:
 * every file's attempts are pooled and parsed together, then each question's text, answer and picture is checked.
 *
 *   npx tsx tests/audit/full-run.mts pages.json figs.json imgDir a.pdf [b.pdf …]
 */
import fs from "node:fs";
import { parseMoodleReview, type FigureRender } from "../../src/lib/ingestion/moodle-review";
import { isBlankFingerprint } from "../../src/lib/blank-image";
import { blankCount, clozeAnswers } from "../../src/lib/cloze";
import type { PageInput } from "../../src/lib/ingestion/types";
import type { MCQQuestion } from "../../src/types/question";

const [pagesFile, figsFile, imgDir, ...files] = process.argv.slice(2);
const pages: PageInput[] = JSON.parse(fs.readFileSync(pagesFile, "utf8"));
const renders = new Map<string, FigureRender>(Object.entries(JSON.parse(fs.readFileSync(figsFile, "utf8"))));

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const ranges: { name: string; from: number; to: number }[] = [];
let off = 0;
for (const f of files) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0 }).promise;
  ranges.push({ name: f, from: off + 1, to: off + doc.numPages });
  off += doc.numPages;
  await doc.destroy();
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const keyOf = (q: MCQQuestion) => `${norm(q.question)}|${Object.values(q.options).map(norm).sort().join("|")}`;
const answered = (q: MCQQuestion) => q.status === "answered" || !!q.correctAnswer || !!q.answerText || !!q.sequence || !!q.matching;
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});

const all = parseMoodleReview(pages, renders)!;
const Q = all.questions;
console.log("\n=== Combined base (all files pooled) ===");
console.log({ pages: pages.length, attempts_found: all.totalFound, unique: Q.length, status: count(Q, (q) => q.status), kind: count(Q, (q) => q.tags?.[0] ?? (Object.keys(q.options).length ? "choice" : "text")) });

console.log("\n=== Per file vs pooled: answers recovered from other files ===");
const pooled = new Map(Q.map((q) => [keyOf(q), q]));
let totalRescued = 0;
for (const r of ranges) {
  const solo = parseMoodleReview(pages.filter((p) => p.pageNumber >= r.from && p.pageNumber <= r.to), renders);
  if (!solo) continue;
  const unanswered = solo.questions.filter((q) => !answered(q));
  const rescued = unanswered.filter((q) => {
    const p = pooled.get(keyOf(q));
    return p && answered(p);
  });
  totalRescued += rescued.length;
  console.log(`${r.name}: unique ${solo.questions.length}, without answer alone ${unanswered.length}, answered thanks to other files ${rescued.length}`);
}

const issues: Record<string, { q: MCQQuestion; note?: string }[]> = {};
const flag = (name: string, q: MCQQuestion, note?: string) => (issues[name] ??= []).push({ q, note });
const CHROME = /(Выберите один|Выберите (один )?или несколько|Отметить вопрос|Баллов?:|Вопрос \d+|Верно$|Неверно$|Частично правильный|Правильный ответ:|Ваш ответ|Отзыв|Начат |Завершен |Затраченное время|Оценка \d)/i;

for (const q of Q) {
  const opts = Object.entries(q.options);
  const stem = q.question.trim();
  if (stem.length < 6) flag("empty/too short stem", q);
  if (CHROME.test(stem)) flag("Moodle UI text inside the stem", q);
  for (const [, t] of opts) if (CHROME.test(t)) flag("Moodle UI text inside an option", q, t);
  for (const [, t] of opts) if (t.trim().length > 6 && norm(stem).includes(norm(t)) && !q.sequence && !q.matching) flag("option text leaked into the stem", q, t);
  if (new Set(opts.map(([, t]) => norm(t))).size !== opts.length) flag("duplicate options", q);
  if (opts.some(([, t]) => !t.trim())) flag("empty option", q);
  if (opts.length === 1) flag("only one option", q);
  if (q.correctAnswer) {
    const keys = q.correctAnswer.split(/[,;|]/).map((k) => k.trim());
    if (keys.some((k) => !(k in q.options))) flag("answer key points to a missing option", q, q.correctAnswer);
  }
  if (q.answerText && CHROME.test(q.answerText)) flag("Moodle UI text inside the answer", q, q.answerText);
  if (!opts.length && blankCount(stem) && q.answerText && !clozeAnswers(stem, q.answerText)) flag("fill-in blanks cannot be matched to the answer", q, q.answerText);
  if (q.imageId) {
    const file = `${imgDir}/${q.imageId}.webp`;
    if (!fs.existsSync(file)) flag("picture referenced but not rendered", q);
    else if (fs.statSync(file).size < 600) flag("picture file suspiciously small", q);
    const r = [...renders.values()].find((x) => x.imageId === q.imageId) as (FigureRender & { fine?: string }) | undefined;
    if (r?.fine && isBlankFingerprint(r.fine)) flag("blank picture", q);
  } else if (/(на рисунке|на изображении|на картинке|обозначен[аоы]? цифр|под цифрой|на схеме)/i.test(stem)) flag("stem mentions a picture but none attached", q);
  if (!answered(q)) flag("no answer in any file (would go to PubMed)", q);
}

console.log("\n=== Pictures ===");
const withImg = Q.filter((q) => q.imageId);
console.log({ questions_with_picture: withImg.length, distinct_pictures: new Set(withImg.map((q) => q.imageId)).size, rendered_crops: renders.size });

console.log("\n=== Quality checks ===");
const names = Object.keys(issues).sort();
if (!names.length) console.log("no issues found");
for (const name of names) {
  console.log(`\n[${issues[name].length}] ${name}`);
  for (const { q, note } of issues[name].slice(0, Number(process.env.SHOW ?? 6)))
    console.log(`   p${q.pageNumber} | ${q.question.slice(0, 110)}${note ? `  →  ${note.slice(0, 90)}` : ""}`);
}
console.log(`\nTotal answered thanks to pooling: ${totalRescued}`);
fs.writeFileSync(pagesFile.replace(".pages.json", ".audit.json"), JSON.stringify(Q, null, 1));
