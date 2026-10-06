import type { StructuredQuestion } from "@/types/question";
import { stripScoreNoise } from "./ingestion/noise";
import { clozeAnswers } from "./cloze";

// Cyrillic stored as cp1251 bytes but read as Latin-1 ("Ãðóäèíî" = "Грудино"). Ÿ/SS come from
// capitalising "ÿ"/"ß" (я/Я) after the damage was done.
const MOJIBAKE_RUN = /(?:SS)?[A-Za-z\u00A0-\u00FF\u0178]*[\u00C0-\u00FF\u0178][A-Za-z\u00A0-\u00FF\u0178]*/g;
let cp1251: TextDecoder | null = null;

export function fixMojibake(s: string): string {
  if (!s || !/[\u00C0-\u00FF\u0178][\u00C0-\u00FF\u0178]/.test(s)) return s;
  cp1251 ??= new TextDecoder("windows-1251");
  return s.replace(MOJIBAKE_RUN, (word) => {
    const body = word.replace(/^SS(?=[\u00C0-\u00FF])/, "\u00DF");
    const high = (body.match(/[\u00C0-\u00FF\u0178]/g) ?? []).length;
    if (high < 2 || high < body.length * 0.5) return word;
    const bytes = Uint8Array.from([...body].map((c) => (c === "\u0178" ? 0xdf : c.charCodeAt(0) & 0xff)));
    return cp1251!.decode(bytes);
  });
}

const DATE_TIME = String.raw`\d{1,2}\.\d{1,2}\.\d{4},?\s+\d{1,2}:\d{2}`;
const PAGE_OF = String.raw`Стр\.?\s*\d+\s*из\s*\d+`;
const ATTEMPT_TITLE = String.raw`[^|\n]{0,220}?просмотр попытки(?:\s*\|\s*[^\s]{0,14})?`;

/** Browser print header/footer etest adds to every page: URL, attempt, date, page counter, test title. */
const FOOTER_PATTERNS = [
  new RegExp(
    String.raw`(?:https?:\/\/)?etest\.bsmu\.by\/\S*(?:\s+\d{1,3}\/\d{1,3})?(?:\s+${DATE_TIME})?(?:\s+${PAGE_OF})?(?:\s+${ATTEMPT_TITLE})?`,
    "giu",
  ),
  new RegExp(String.raw`(?:\d{1,3}\/\d{1,3}\s+)?${DATE_TIME}\s+(?:${PAGE_OF}|${ATTEMPT_TITLE})`, "giu"),
  new RegExp(String.raw`(?<!\S)${PAGE_OF}(?!\S)`, "giu"),
];

export function stripPrintFooter(s: string): string {
  let out = s;
  for (const re of FOOTER_PATTERNS) out = out.replace(re, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}

// Moodle's icon font (U+F00C "✓" after a correct response) and zero-width marks: invisible in the
// UI, but they make a typed "93" differ from the stored "93\uF00C".
const ICON_GLYPHS = /[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g;

// "×" read through the wrong code page comes out as "ЧЧ" in counts like "2,6ЧЧ10 12 /л".
const BROKEN_TIMES = /(?<=\d)\s?Ч{1,2}\s?(?=10\s?\d)/g;

export const cleanText = (s: string) =>
  stripScoreNoise(stripPrintFooter(fixMojibake((s || "").replace(ICON_GLYPHS, " ")))).replace(BROKEN_TIMES, "×");

const normWords = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** "Назовите инструмент желобоватый зонд" as the answer to "Назовите инструмент" → "желобоватый зонд". */
function dropEchoedStem(answer: string, stem: string): string {
  const a = normWords(answer);
  const q = normWords(stem);
  if (q.length < 8 || !a.startsWith(q + " ")) return answer;
  const stemWords = q.split(" ").length;
  return answer.trim().split(/\s+/).slice(stemWords).join(" ") || answer;
}

/** A labelling option that swallowed the next ones: "Подъязычный сосочек 3.Слизистая оболочка 4. …". */
function splitGluedLabels(q: StructuredQuestion): StructuredQuestion {
  if (!q.options.length || !q.options.every((o) => /^\d+$/.test(o.key))) return q;
  const present = new Set(q.options.map((o) => o.key));
  const out: StructuredQuestion["options"] = [];
  let changed = false;
  for (const o of q.options) {
    let key = Number(o.key);
    let rest = o.text;
    const parts: { key: string; text: string }[] = [];
    for (;;) {
      const next = key + 1;
      const m = new RegExp(String.raw`(?:^|\s)${next}\s*[.)]\s*(?=\S)`).exec(rest);
      if (!m || present.has(String(next)) || m.index < 2) break;
      parts.push({ key: String(key), text: rest.slice(0, m.index).trim() });
      rest = rest.slice(m.index + m[0].length);
      key = next;
      present.add(String(key));
      changed = true;
    }
    parts.push({ key: String(key), text: rest.trim() });
    parts.forEach((p, i) => out.push(i === 0 ? { ...o, text: p.text } : { ...o, key: p.key, text: p.text }));
  }
  return changed ? { ...q, options: out } : q;
}

const TRUE_FALSE = ["Верно", "Неверно"];

/** "… кольцами Верно" + the single option "Неверно": the first choice was glued onto the stem. */
function splitGluedTrueFalse(q: StructuredQuestion): StructuredQuestion {
  if (q.options.length !== 1 || !TRUE_FALSE.includes(q.options[0].text)) return q;
  const other = TRUE_FALSE.find((t) => t !== q.options[0].text)!;
  const m = new RegExp(String.raw`\s+${other}$`).exec(q.question.text);
  if (!m) return q;
  const answerText = q.answer?.key ? q.options.find((o) => o.key === q.answer!.key)?.text : q.answer?.text;
  const options = TRUE_FALSE.map((text, i) => ({ ...q.options[0], key: String.fromCharCode(65 + i), text }));
  const key = options.find((o) => o.text === answerText)?.key ?? "";
  return {
    ...q,
    question: { ...q.question, text: q.question.text.slice(0, m.index).trim() },
    options,
    answer: q.answer ? { ...q.answer, key, text: answerText ?? "" } : q.answer,
  };
}

/** Cleans one stored or freshly extracted question so identical questions get identical text. */
export function repairQuestion(sq: StructuredQuestion): StructuredQuestion {
  const stem = cleanText(sq.question.text);
  const options = sq.options.map((o) => ({ ...o, text: cleanText(o.text) })).filter((o) => o.text || o.key);
  const answer = sq.answer
    ? { ...sq.answer, text: sq.options.length ? cleanText(sq.answer.text || "") : dropEchoedStem(cleanText(sq.answer.text || ""), stem) }
    : sq.answer;
  const base = { ...sq, question: { ...sq.question, text: stem }, options, answer };
  return fitBlanksToAnswer(fixDuplicateKeys(moveStemTail(liftLoneOrdering(splitGluedTrueFalse(splitGluedLabels(base))))));
}

const answerKeys = (q: StructuredQuestion) => (q.answer?.key || "").split(/[,;\s]+/).filter(Boolean);
const withKeys = (q: StructuredQuestion, keys: string[]): StructuredQuestion => ({
  ...q,
  answer: { ...q.answer!, key: keys.join(","), text: keys.map((k) => q.options.find((o) => o.key === k)?.text ?? "").join("; ") },
});

/**
 * Options "С" and "с" (antigens C/c) once collapsed onto one letter, so the key reads "A,A,C".
 * A repeated letter goes to its unused case-variant twin.
 */
function fixDuplicateKeys(q: StructuredQuestion): StructuredQuestion {
  const keys = answerKeys(q);
  if (new Set(keys).size === keys.length) return q;
  const used = new Set<string>();
  const fixed = keys.map((k) => {
    if (!used.has(k)) return used.add(k), k;
    const text = q.options.find((o) => o.key === k)?.text.toLowerCase();
    const twin = q.options.find((o) => !used.has(o.key) && !keys.includes(o.key) && o.text.toLowerCase() === text);
    if (!twin) return "";
    used.add(twin.key);
    return twin.key;
  });
  return withKeys(q, fixed.filter(Boolean));
}

/** An option's wrapped last line ("… в случае" + "невозможности обесточивания установки") that landed after the stem's colon. */
const CUT_OFF = /(?:[-–,]|\s(?:в|во|и|с|со|на|по|при|из|к|от|для|о|об|или|а|что|у|до|за|под|над|как|не|чем|случае|концентрации|клетки|который|которая|которые))$/i;

function moveStemTail(q: StructuredQuestion): StructuredQuestion {
  if (q.options.length < 2 || q.matching || q.sequence) return q;
  const m = /^([\s\S]*?:)\s+([^:]{2,})$/.exec(q.question.text);
  if (!m || !/^[a-zа-яё(]/.test(m[2])) return q;
  const cut = q.options.filter((o) => CUT_OFF.test(o.text.trim()));
  if (!cut.length) return q;
  const tail = m[2].trim();
  const stemmed = { ...q, question: { ...q.question, text: m[1].trim() } };
  if (cut.length > 1) return stemmed;
  const options = q.options.map((o) => (o === cut[0] ? { ...o, text: `${o.text.trim()} ${tail}` } : o));
  const moved = { ...stemmed, options };
  return answerKeys(q).includes(cut[0].key) ? withKeys(moved, answerKeys(q)) : moved;
}

/** An "ordering" item with no stem and a single row is really a short-answer question: "… узла (цифрой)" → 3. */
function liftLoneOrdering(q: StructuredQuestion): StructuredQuestion {
  if (q.question.text || q.options.length !== 1 || !q.sequence) return q;
  const [only] = q.options;
  const value = q.sequence[only.key];
  if (value == null) return q;
  return {
    ...q,
    question: { ...q.question, text: only.text },
    options: [],
    sequence: undefined,
    tags: (q.tags ?? []).filter((t) => t !== "ordering"),
    answer: { key: "", text: String(value) },
  };
}

const ADJACENT_BLANKS = /_{2,}(?:\s+_{2,})+/g;

/**
 * Blanks are rebuilt from the words the student typed, so "___ ___ ___" may sit where the right
 * answer is "надключичная ямка". When the answer can't be laid over the blanks, a run of adjacent
 * blanks becomes one field for the whole phrase.
 */
function fitBlanksToAnswer(q: StructuredQuestion): StructuredQuestion {
  const answer = (q.answer?.text || "").trim();
  if (q.options.length || q.sequence || q.matching || !answer || !/_{2,}\s+_{2,}/.test(q.question.text)) return q;
  if (clozeAnswers(q.question.text, answer)) return q;
  const collapsed = q.question.text.replace(ADJACENT_BLANKS, "___");
  return clozeAnswers(collapsed, answer) ? { ...q, question: { ...q.question, text: collapsed } } : q;
}

const BLANK = /_{2,}/;
const PHONE_STATUS_BAR = /\b\d{1,2}:\d{2}\s+\d\s+\S{2,4}\s+\d{2}\b/;
const INLINE_CHOICE = /(?:^|\s)[a-fабсе]\.\s+\S/gi;

/**
 * Phone screenshots OCR'd into one blob: browser URL bar, status bar ("16:24 ull 36") and the
 * whole a./b./c. list inside the stem. Nothing in them can be tested reliably.
 */
function isScreenshotJunk(q: StructuredQuestion): boolean {
  if (q.options.length || q.sequence || q.matching) return false;
  const t = q.question.text;
  return /etest\.bsmu\.by/i.test(t) || PHONE_STATUS_BAR.test(t) || /^[|\\]/.test(t) || (t.match(INLINE_CHOICE)?.length ?? 0) >= 2;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flat = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** "Сонным бугорком называется ___ бугорок ___ отростка С6." also matches the attempt where the blanks were filled in. */
function clozeFrame(q: StructuredQuestion): RegExp | null {
  if (q.options.length || !BLANK.test(q.question.text) || !(q.answer?.text || "").trim()) return null;
  const parts = flat(q.question.text).split(/\s*_{2,}\s*/).map(escapeRe);
  if (parts.join("").replace(/[^\p{L}]/gu, "").length < 12) return null;
  return new RegExp(`^${parts.join(" ?(.{1,80}?) ?")}$`, "u");
}

/**
 * Bank-level clean-up after merging: drops screenshot junk and copies of a cloze question that
 * carry the student's typed words instead of blanks, and stops a question whose only "answer"
 * is its own text from counting as answered.
 */
export function pruneBank(bank: StructuredQuestion[]): StructuredQuestion[] {
  const frames = bank.map(clozeFrame).filter((r): r is RegExp => !!r);
  const out: StructuredQuestion[] = [];
  for (const q of bank) {
    if (isScreenshotJunk(q)) continue;
    const plain = !q.options.length && !q.sequence && !q.matching && !BLANK.test(q.question.text);
    if (plain && frames.some((re) => re.test(flat(q.question.text)))) continue;
    const echoed = plain && flat(q.answer?.text || "") === flat(q.question.text);
    out.push(echoed ? { ...q, answer: { ...q.answer!, key: "", text: "" }, status: "pending" } : q);
  }
  return out;
}
