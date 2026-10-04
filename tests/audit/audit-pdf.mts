/**
 * Runs any PDF through the same extraction path the site uses (minus OCR and
 * image rendering) and reports defects in the resulting questions, options and
 * figure captions.
 *
 *   npx tsx tests/audit/audit-pdf.mts [file.pdf ...]
 *
 * With no arguments it audits every PDF in test-fixtures/ plus public/__e2e.pdf.
 * Exit code 1 when any "error" finding exists.
 */
import fs from "node:fs";
import path from "node:path";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { analyzeDocument } from "../../src/lib/ingestion/pipeline";
import { buildQuestions } from "../../src/lib/ingestion/to-mcq";
import { detectFigures, detectOcrFigures, figureNoise, mergeFigures } from "../../src/lib/ingestion/figures";
import type { PageInput } from "../../src/lib/ingestion/types";

type Severity = "error" | "warn";
interface Finding {
  code: string;
  severity: Severity;
  where: string;
  text: string;
}

const CYR = /\p{Script=Cyrillic}/u;
const LAT = /\p{Script=Latin}/u;

const RULES: { code: string; severity: Severity; test: (s: string) => boolean; note: string }[] = [
  { code: "GLUED_WORDS", severity: "error", note: "слова слиплись (нижний→ВЕРХНИЙ регистр внутри слова)", test: (s) => /[а-яё]{2}[А-ЯЁ][а-яё]/.test(s) },
  { code: "LMS_NOISE", severity: "error", note: "мусор Moodle в тексте", test: (s) => /(?:Балл(?:ов|ы)?\s*[:;]?\s*\d|Вопрос\s*\d+\s*(?:Выполнен|Верно|Неверно|Балл)|Выполнен[оа]?\s*$|Отметить вопрос|Правильный ответ\s*:|Ваш ответ\s*(?:верный|неверный)|Marks?\s*:\s*\d|Question\s*\d+\s*(?:Correct|Incorrect|Answer))/i.test(s) },
  { code: "BAD_CHAR", severity: "error", note: "служебные/подменённые символы (ĸ, �, PUA, управляющие)", test: (s) => /[\u0138\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u2028\u2029\uFEFF]/.test(s) },
  { code: "LETTER_SPACED", severity: "error", note: "буквы через пробел (р а з р я д к а)", test: (s) => /(?:^|\s)(?:[а-яё]\s){3,}[а-яё](?:\s|$)/i.test(s) },
  { code: "MIXED_SCRIPT", severity: "warn", note: "слово из кириллицы и латиницы", test: (s) => s.split(/\s+/).some((w) => { const t = w.replace(/[^\p{L}]/gu, ""); return t.length > 2 && CYR.test(t) && LAT.test(t); }) },
  { code: "ANSWER_LABEL_IN_TEXT", severity: "error", note: "«Ответ: …» остался внутри текста", test: (s) => /(?:^|\s)(?:Ответ|Answer)\s*:\s*\S/.test(s) },
  { code: "FIELD_MARKER_LEAK", severity: "error", note: "служебные скобки ⟪⟫ в тексте", test: (s) => /[⟪⟫■]/.test(s) },
  { code: "OPTION_LABEL_LEAK", severity: "error", note: "метка варианта (a. / б) / 1.) осталась в тексте варианта", test: (s) => /^(?:[a-eA-EаАбБвВгГдДеЕ]|\d{1,2})\s?[.)]\s*\p{L}/u.test(s) },
  { code: "TRAILING_JUNK", severity: "warn", note: "хвост из знаков (…, ;;, —)", test: (s) => /[;,:]\s*[;,:]|\s[-–—]\s*$|\.{4,}/.test(s) },
  { code: "DOUBLE_SPACE_OR_EDGE", severity: "warn", note: "лишние пробелы", test: (s) => /\s{2,}/.test(s) || s !== s.trim() },
  { code: "STRAY_PUNCT", severity: "warn", note: "висящая пунктуация в начале/конце", test: (s) => /^[\s,;:.\-–—)\]]+\S/.test(s) && !/^[-–—]\s?\S/.test(s) || /[(\[]\s*$/.test(s) },
];

function scan(text: string, where: string, out: Finding[]) {
  for (const r of RULES) if (r.test(text)) out.push({ code: r.code, severity: r.severity, where, text: text.length > 140 ? `${text.slice(0, 140)}…` : text });
}

async function auditFile(file: string): Promise<{ findings: Finding[]; stats: Record<string, number | string> }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages: PageInput[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const errs: string[] = [];
    const result = await readPageStructure(pdfjs, page, n, errs);
    if (errs.length) result.readErrors = errs;
    pages.push(result);
    page.cleanup();
  }

  const findings: Finding[] = [];
  const analysis = analyzeDocument(pages, { documentId: "audit" });
  const drafts = [...detectFigures(pages), ...detectOcrFigures(pages)];
  const merged = mergeFigures(drafts, drafts.map(() => null));
  const isFigureNoise = figureNoise(drafts);
  const questions = buildQuestions(analysis.instances)
    .questions.filter((q) => !isFigureNoise(q))
    .map((q, i) => ({ ...q, number: i + 1 }));
  if (process.env.AUDIT_DUMP) {
    fs.writeFileSync(
      process.env.AUDIT_DUMP,
      JSON.stringify({ questions, figures: merged.map((m) => ({ page: drafts[m.primary].imagePage, labels: m.labels })) }, null, 1),
    );
  }

  if (!questions.length && !merged.length) {
  findings.push({ code: "NO_QUESTIONS", severity: "error", where: "документ", text: "ни вопросов, ни рисунков: это не тест (например, подписи к атласу) или формат не распознан" });
  }
  for (const p of pages) for (const e of p.readErrors ?? []) findings.push({ code: "PAGE_READ_ERROR", severity: "error", where: `стр.${p.pageNumber}`, text: e });

  for (const q of questions) {
    const w = `Q${q.number} (стр.${q.pageNumber ?? "?"})`;
    scan(q.question, `${w} вопрос`, findings);
    if (q.question.trim().length < 8) findings.push({ code: "SHORT_STEM", severity: "error", where: w, text: q.question });
    const opts = Object.entries(q.options);
    const seen = new Map<string, string>();
    for (const [k, v] of opts) {
      scan(v, `${w} вариант ${k}`, findings);
      if (!v.trim()) findings.push({ code: "EMPTY_OPTION", severity: "error", where: `${w} вариант ${k}`, text: "" });
      const norm = v.toLowerCase().replace(/\s+/g, " ").trim();
      if (norm && seen.has(norm)) findings.push({ code: "DUPLICATE_OPTION", severity: "warn", where: `${w} варианты ${seen.get(norm)}/${k}`, text: v });
      seen.set(norm, k);
    }
    if (opts.length === 1) findings.push({ code: "SINGLE_OPTION", severity: "warn", where: w, text: q.question });
    if (q.correctAnswer) {
      for (const k of q.correctAnswer.split(",")) if (opts.length && !(k in q.options)) findings.push({ code: "ANSWER_NOT_IN_OPTIONS", severity: "error", where: w, text: `${q.correctAnswer} / ${Object.keys(q.options).join("")}` });
    }
    if (q.answerText) scan(q.answerText, `${w} ответ`, findings);
  }

  merged.forEach((m, i) => {
    const d = drafts[m.primary];
    const w = `Рисунок ${i + 1} (стр.${d.imagePage})`;
    if (!m.labels.length) findings.push({ code: "FIGURE_NO_LABELS", severity: "error", where: w, text: "" });
    if (!d.bbox) findings.push({ code: "FIGURE_NO_IMAGE_REGION", severity: "warn", where: w, text: "рисунок будет целой страницей" });
    const nums = m.labels.map((l) => l.n).sort((a, b) => a - b);
    nums.forEach((n, idx) => { if (idx > 0 && n === nums[idx - 1]) findings.push({ code: "FIGURE_DUP_NUMBER", severity: "error", where: w, text: String(n) }); });
    if (nums.length && nums[0] !== 1) findings.push({ code: "FIGURE_NUMBERING_GAP", severity: "warn", where: w, text: `нумерация начинается с ${nums[0]}` });
    for (let k = 1; k < nums.length; k++) if (nums[k] - nums[k - 1] > 1) findings.push({ code: "FIGURE_NUMBERING_GAP", severity: "warn", where: w, text: `пропуск между ${nums[k - 1]} и ${nums[k]}` });
    const seen = new Set<string>();
    for (const l of m.labels) {
      scan(l.text, `${w} подпись ${l.n}`, findings);
      const t = l.text.trim();
      if (t.length < 3) findings.push({ code: "FIGURE_LABEL_TOO_SHORT", severity: "error", where: `${w} подпись ${l.n}`, text: t });
      if (t.length > 90) findings.push({ code: "FIGURE_LABEL_TOO_LONG", severity: "error", where: `${w} подпись ${l.n}`, text: t });
      if (!/\p{L}{3}/u.test(t)) findings.push({ code: "FIGURE_LABEL_NO_WORDS", severity: "error", where: `${w} подпись ${l.n}`, text: t });
      if (/\d{2,}/.test(t) && !/^[\p{L}\s,.\-–()\d/]+$/u.test(t)) findings.push({ code: "FIGURE_LABEL_NUMBERS", severity: "warn", where: `${w} подпись ${l.n}`, text: t });
      const key = t.toLowerCase();
      if (seen.has(key)) findings.push({ code: "FIGURE_DUP_LABEL", severity: "warn", where: w, text: t });
      seen.add(key);
    }
  });

  const answered = questions.filter((q) => q.status === "answered").length;
  const stats = {
    pages: doc.numPages,
    source: analysis.profile.sourceType,
    questions: questions.length,
    answered,
    needsReview: questions.filter((q) => q.status === "needs_review").length,
    missingAnswer: questions.filter((q) => q.status === "missing_answer").length,
    figures: merged.length,
    figureLabels: merged.reduce((s, m) => s + m.labels.length, 0),
    auditStatus: analysis.audit.status,
  };
  await doc.destroy();
  return { findings, stats };
}

function fixtureList(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args;
  const out: string[] = [];
  const dir = path.resolve("test-fixtures");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.pdf$/i.test(f)) out.push(path.join(dir, f));
  const e2e = path.resolve("public/__e2e.pdf");
  if (fs.existsSync(e2e)) out.push(e2e);
  return out;
}

const files = fixtureList();
if (!files.length) {
  console.error("Нет PDF для проверки. Положите файлы в test-fixtures/ или передайте путь аргументом.");
  process.exit(2);
}

let errors = 0;
for (const file of files) {
  console.log(`\n=== ${path.relative(process.cwd(), file)} ===`);
  const { findings, stats } = await auditFile(file);
  console.log(Object.entries(stats).map(([k, v]) => `${k}=${v}`).join("  "));
  const byCode = new Map<string, Finding[]>();
  for (const f of findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
  if (!byCode.size) console.log("Замечаний нет");
  for (const [code, list] of [...byCode].sort((a, b) => (a[1][0].severity === "error" ? 0 : 1) - (b[1][0].severity === "error" ? 0 : 1))) {
    const rule = RULES.find((r) => r.code === code);
    console.log(`\n[${list[0].severity.toUpperCase()}] ${code}${rule ? ` — ${rule.note}` : ""}: ${list.length}`);
    for (const f of list.slice(0, 8)) console.log(`   ${f.where}: ${JSON.stringify(f.text)}`);
    if (list.length > 8) console.log(`   … ещё ${list.length - 8}`);
    if (list[0].severity === "error") errors += list.length;
  }
}
console.log(errors ? `\nИТОГО ошибок: ${errors}` : "\nИТОГО: ошибок нет");
process.exit(errors ? 1 : 0);
