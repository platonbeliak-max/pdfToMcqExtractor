import type { AnswerOption, QuestionInstance } from "./types";
import { jaccard, normalizeForMatch, trigrams, uuid } from "./text";

const LETTERS = "abcde";

/** OCR reads the radio-button circle and bullet icons as these characters. */
const JUNK = "[еeоoOvVФ0©®°«»|\\\\/@*•]";

// Regex source for every spelling of a printed label; Cyrillic look-alikes must be followed by a capital/digit.
const LABEL_SRC: Record<string, string> = {
  a: "a",
  b: "(?:b|БВ|[вВ](?=\\s*[.)]\\s+[А-ЯЁA-Z0-9]))",
  c: "(?:c|[сС](?=\\s*[.)]\\s+[А-ЯЁA-Z0-9]))",
  d: "d",
  e: "(?:e|[еЕ](?=\\s*[.)]\\s+[А-ЯЁA-Z0-9]))",
};

function markerRegex(letter: string): RegExp {
  return new RegExp(`(?:^|\\s)(?:${JUNK}(?:\\s+|(?=${LABEL_SRC[letter]})))*(${LABEL_SRC[letter]})\\s*[.)]\\s+(?=\\S)`, "u");
}

export interface Marker {
  /** Start of the junk + label run (what must be cut from the text before it). */
  start: number;
  /** First character of the text that belongs to the label. */
  end: number;
}

/** Finds an inline "x." label (with the junk OCR puts before it) that splits `text` into a head and a tail. */
export function findMarker(text: string, letter: string): Marker | null {
  const m = markerRegex(letter).exec(text);
  if (!m) return null;
  const start = m.index;
  const end = m.index + m[0].length;
  if (text.slice(0, start).trim().length < 2) return null;
  if (text.slice(end).trim().length < 2) return null;
  return { start, end };
}

// Phone status bar glued into the text: "16:24 2 „ий! 36 (4D", "16:24 2 ull 36 ($)".
const STATUS_BAR = /(?:^|\s)\S{0,3}\s*\b(?:[01]?\d|2[0-3]):[0-5]\d\s+\d{1,2}\s+\S{1,7}\s*\d{2,3}\b(?:\s*[([]\s*[^)\]\s]{0,4}\s*[)\]]?)?/u;
const ANY_MARKER = new RegExp(`(?:^|\\s)(?:${JUNK}\\s+)*[a-e]\\s*[.)]\\s+(?=\\S)`, "u");

function dropTrailingJunk(text: string): string {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const isSymbols = /^[^\p{L}\d]{1,5}$/u.test(last);
    const isShortLatin = /^[A-Za-z]{1,3}$/.test(last) || /^(?:[a-z0-9-]+\.)+(?:by|ru|com|org|net|ua|kz|edu)\S*$/i.test(last);
    if (isSymbols || isShortLatin) tokens.pop();
    else break;
  }
  return tokens.join(" ");
}

/**
 * Removes everything a phone screenshot adds around the text: status-bar clock
 * with its signal/battery digits and the garbage OCR'd after it, the address
 * bar, and stray radio-button symbols.
 */
export function stripScreenshotNoise(input: string): string {
  let s = input;
  for (let guard = 0; guard < 4; guard++) {
    const m = STATUS_BAR.exec(s);
    if (!m) break;
    const head = dropTrailingJunk(s.slice(0, m.index));
    const rest = s.slice(m.index + m[0].length);
    const marker = ANY_MARKER.exec(rest);
    const tail = marker ? rest.slice(marker.index).trim() : "";
    s = [head, tail].filter(Boolean).join(" ");
  }
  return s
    .replace(/(?:^|\s)(?:[\w-]+\.)+(?:by|ru|com|org|net|ua|kz|edu)\S*/gi, " ")
    .replace(/\s\+\s*(?=[|\\])/g, " ")
    .replace(/(^|\s)[|\\]+(?=\p{L})/gu, "$1")
    .replace(/^[\\|/]\s*\p{L}{0,2}(?=\s+\p{Lu})/u, "")
    .replace(/(^|\s)[|\\«»@*•]+(?=\s|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tidyOptionText(text: string): string {
  return stripScreenshotNoise(text)
    .replace(/\s+[|\\/«»@*•]+$/u, "")
    .replace(/^[|\\/«»@*•]+\s+/u, "")
    .replace(/^[a-eA-E][.)](?=[А-ЯЁ])/, "")
    .trim();
}

function labelLetter(o: Pick<AnswerOption, "label">): string | null {
  const raw = (o.label ?? "").toLowerCase();
  if (/^[a-e]$/.test(raw)) return raw;
  const lookalike: Record<string, string> = { а: "a", с: "c", е: "e" };
  return lookalike[raw] ?? null;
}

function makeOption(letter: string | null, text: string, like: { page: number; bbox: AnswerOption["bbox"] }): AnswerOption {
  return {
    id: uuid(),
    label: letter,
    position: 0,
    rawText: text,
    text,
    normalizedText: normalizeForMatch(text),
    page: like.page,
    bbox: like.bbox,
    pairText: null,
    orderIndex: null,
  };
}

/** Cuts `text` at inline labels "from, from+1, …"; returns the text before the first label and one piece per label. */
function chainSplit(text: string, from: string): { head: string; parts: { letter: string; text: string }[] } {
  const parts: { letter: string; text: string }[] = [];
  let head = text;
  let rest = text;
  let letter = from;
  for (;;) {
    const m = findMarker(rest, letter);
    if (!m) break;
    const before = rest.slice(0, m.start).trim();
    if (parts.length === 0) head = before;
    else parts[parts.length - 1].text = before;
    parts.push({ letter, text: "" });
    rest = rest.slice(m.end).trim();
    const next = LETTERS[LETTERS.indexOf(letter) + 1];
    if (!next) break;
    letter = next;
  }
  if (parts.length) parts[parts.length - 1].text = rest;
  return { head, parts };
}

/**
 * Repairs the label structure of one question:
 *  - options printed inline inside the stem ("…блокада? v a. С целью…") become real options,
 *  - labels glued into the previous option ("…трахею е b. Голосовая щель") are split off,
 *  - screenshot noise is removed everywhere,
 *  - options are put in label order.
 */
export function repairStemAndOptions(
  stemIn: string,
  optionsIn: AnswerOption[],
  page: number,
): { stem: string; options: AnswerOption[] } {
  let stem = stripScreenshotNoise(stemIn);
  const like = { page: optionsIn[0]?.page ?? page, bbox: optionsIn[0]?.bbox ?? null };
  let options = optionsIn.map((o) => ({ ...o, text: tidyOptionText(o.text) }));

  const firstLetter = options.length ? labelLetter(options[0]) : "a";
  const leading: AnswerOption[] = [];
  const lettersMissing = firstLetter && firstLetter !== "a" ? LETTERS.slice(0, LETTERS.indexOf(firstLetter)) : options.length === 0 ? "a" : "";
  if (lettersMissing) {
    const { head, parts } = chainSplit(stem, lettersMissing[0]);
    const enough = options.length === 0 ? parts.length >= 2 : parts.length >= 1;
    if (enough) {
      stem = head;
      for (const p of parts) leading.push(makeOption(p.letter, tidyOptionText(p.text), like));
    }
  }
  options = [...leading, ...options];

  // Labels glued inside an option's own text.
  const expanded: AnswerOption[] = [];
  for (const o of options) {
    const letter = labelLetter(o);
    if (!letter || letter === "e") {
      expanded.push(o);
      continue;
    }
    const { head, parts } = chainSplit(o.text, LETTERS[LETTERS.indexOf(letter) + 1]);
    if (parts.length === 0) {
      expanded.push(o);
      continue;
    }
    expanded.push({ ...o, text: tidyOptionText(head), normalizedText: normalizeForMatch(head) });
    for (const p of parts) expanded.push(makeOption(p.letter, tidyOptionText(p.text), o));
  }
  options = expanded.filter((o) => o.text || o.pairText);

  // Label order wins over the order the lines were read in.
  if (options.length > 1 && options.every((o) => labelLetter(o))) {
    options = options
      .map((o, i) => ({ o, i }))
      .sort((x, y) => LETTERS.indexOf(labelLetter(x.o)!) - LETTERS.indexOf(labelLetter(y.o)!) || x.i - y.i)
      .map((x) => x.o);
  }
  options = options.map((o, i) => ({ ...o, position: i, normalizedText: normalizeForMatch(o.text) }));
  return { stem, options };
}

// ───────── fill-in questions that already contain their own answer ─────────

const HINT_PAREN = /\(\s*(?:название|в\s+(?:именительном|алфавитном|единственном|родительном)|единственн|множественн|одно\s+слово|одним\s+словом|термин|эпоним|латинск|в\s+ответе|ответ|через\s+запят|без\s+пробел|числ|слово|мужск|женск)[^)]*\)/iu;
const HINT_PLAIN = /(?:в\s+ответе\s+(?:указать|укажите|напишите|запишите|написать|вписать|впишите)|ответ\s+(?:запишите|напишите|укажите|впишите))[^.?!]*/iu;
const LINKING = /^(.*(?<![\p{L}])(?:называется|называются|называют|именуется|носит\s+название|обозначается|является|это|—))\s+([\p{L}][\p{L}\p{N}\- ,]{1,60})$/iu;

const BLANK = "_____";

/**
 * "…?  Блуждающий нерв, барабанный нерв (название нервов…)" or
 * "…называется канюля люэра в ответе указать эпоним": the stem carries the
 * typed answer. Returns the stem with a blank in its place plus that answer.
 */
export function splitFilledAnswer(stem: string): { stem: string; answer: string } | null {
  const trimmed = stem.trim().replace(/[.]+$/, "");
  const paren = HINT_PAREN.exec(trimmed);
  const plain = paren ? null : HINT_PLAIN.exec(trimmed);
  const hintMatch = paren ?? plain;
  if (!hintMatch) return null;

  let hint = hintMatch[0].trim();
  if (!paren) hint = `(${hint.replace(/[.]+$/, "")})`;
  const before = trimmed.slice(0, hintMatch.index).trim();
  const after = trimmed.slice(hintMatch.index + hintMatch[0].length).trim();
  if (after) return null;

  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

  const sentence = before.match(/^([\s\S]*[?!:.])\s+([^?!:.]{2,120})$/u);
  if (sentence && sentence[1].length >= 15 && wordCount(sentence[2]) <= 12) {
    const answer = sentence[2].trim();
    return { stem: `${sentence[1].trim()} ${BLANK} ${hint}`, answer: answer.charAt(0).toUpperCase() + answer.slice(1) };
  }
  const link = before.match(LINKING);
  if (link && link[1].length >= 15 && wordCount(link[2]) <= 6) {
    return { stem: `${link[1].trim()} ${BLANK} ${hint}`, answer: link[2].trim() };
  }
  return null;
}

/** Empty answer boxes OCR'd as squares become explicit blanks. */
export function normalizeBlanks(stem: string): string {
  return stem.replace(/\s*[□☐▢]\s*/g, ` ${BLANK} `).replace(/(?:_{3,}\s*){2,}/g, `${BLANK} `).replace(/\s{2,}/g, " ").trim();
}

// ───────── headings and fragments ─────────

const VERB_LIKE = /(?:ован[аоы]?|ан[аоы]?|ен[аоы]?|ён|ёна|ется|ются|ится|ится|ает|ают|яет|яют|ует|уют|ёт|ет|ит|ут|ют|ат|ят|ть|ться|ся|л|ла|ло|ли|но|ны)$/u;

/** "Топографическая анатомия и оперативная хирургия" – a textbook title, not a question. */
export function isHeadingStem(stem: string): boolean {
  const s = stem.trim();
  if (!s || /[?:.,;!()_\d]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 8) return false;
  if (/\p{Lu}{2,}/u.test(s)) return false;
  return words.filter((w) => w.length > 3).every((w) => !VERB_LIKE.test(w.toLowerCase()));
}

const tokensOf = (s: string) => normalizeForMatch(s).split(" ").filter(Boolean);

function isPrefixTokens(short: string[], long: string[]): boolean {
  if (short.length < 3 || long.length <= short.length) return false;
  return short.every((t, i) => long[i] === t);
}

const GENERIC_OPTION = /^(?:верно|неверно|да|нет|правильно|неправильно|все\s+перечисленное)$/i;

/** True when the option text is distinctive enough to prove that two blocks overlap. */
function isDistinctive(o: AnswerOption): boolean {
  return o.normalizedText.length >= 10 && !GENERIC_OPTION.test(o.text.trim());
}

function withoutOptions(q: QuestionInstance, drop: Set<string>): QuestionInstance {
  if (drop.size === 0) return q;
  const options = q.options.filter((o) => !drop.has(o.id)).map((o, i) => ({ ...o, position: i }));
  return { ...q, options, visualMarks: q.visualMarks.filter((m) => !m.associatedOptionId || !drop.has(m.associatedOptionId)) };
}

/**
 * Neighbouring screenshots overlap: the tail of the previous question is read
 * again at the top of the next one, together with a cut-off copy of the
 * question itself. This removes those leaked options and fragments.
 */
export function repairSequence(all: QuestionInstance[]): QuestionInstance[] {
  const kept: QuestionInstance[] = [];
  for (let i = 0; i < all.length; i++) {
    let q = all[i];
    const recent = kept.slice(-2);

    // 1. Options that are really the previous question's options.
    const drop = new Set<string>();
    for (const prev of recent) {
      if (prev.options.length === 0) continue;
      if (q.normalizedStem && jaccard(trigrams(q.normalizedStem), trigrams(prev.normalizedStem)) >= 0.8) continue;
      const prevTexts = new Set(prev.options.map((o) => o.normalizedText));
      for (const o of q.options) {
        if (isDistinctive(o) && prevTexts.has(o.normalizedText)) drop.add(o.id);
      }
    }
    q = withoutOptions(q, drop);

    // 2. A cut-off copy of the same question: every option is the beginning of a fuller option nearby.
    const neighbours = [...recent, ...all.slice(i + 1, i + 3)];
    const fragment = neighbours.some((n) => {
      if (n.id === q.id || n.normalizedStem !== q.normalizedStem || n.options.length <= q.options.length) return false;
      return q.options.every((o) => o.normalizedText.length >= 8 && n.options.some((p) => p.normalizedText.startsWith(o.normalizedText)));
    });
    if (fragment && q.options.length > 0) continue;

    // 3. A stem that is only the first words of the question printed right after it.
    if (q.options.length === 0) {
      const cut = ANY_MARKER.exec(q.stem);
      const headTokens = tokensOf(cut ? q.stem.slice(0, cut.index) : q.stem);
      const cutOff = all.slice(i + 1, i + 3).some((n) => isPrefixTokens(headTokens, tokensOf(n.stem)));
      if (cutOff) continue;
    }

    kept.push(q);
  }
  return kept;
}
