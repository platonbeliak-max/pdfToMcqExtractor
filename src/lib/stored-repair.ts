import type { StructuredQuestion } from "@/types/question";
import { stripScoreNoise } from "./ingestion/noise";

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

export const cleanText = (s: string) => stripScoreNoise(stripPrintFooter(fixMojibake(s || "")));

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

/** Cleans one stored or freshly extracted question so identical questions get identical text. */
export function repairQuestion(sq: StructuredQuestion): StructuredQuestion {
  const stem = cleanText(sq.question.text);
  const options = sq.options.map((o) => ({ ...o, text: cleanText(o.text) })).filter((o) => o.text || o.key);
  const answer = sq.answer
    ? { ...sq.answer, text: sq.options.length ? cleanText(sq.answer.text || "") : dropEchoedStem(cleanText(sq.answer.text || ""), stem) }
    : sq.answer;
  return splitGluedLabels({ ...sq, question: { ...sq.question, text: stem }, options, answer });
}
