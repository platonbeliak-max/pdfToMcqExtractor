import type { ConfidenceLevel, MCQQuestion, QuestionStatus } from "@/types/question";
import type { PageAnnotation, PageInput, RawTextItem } from "./types";

/**
 * Dedicated reader for Moodle "attempt review" printouts (one or many
 * attempts, Moodle 3 and 4 layouts). The layout is regular enough to read
 * exactly: an info box ("Вопрос N", state, "Баллов: X из Y"), the stem, an
 * instruction, then options drawn as checkboxes/radios with ✓/✗ icons, or
 * rows of a matching/ordering question, or an answer field. Answers come from
 * the score, the icons, Moodle's own feedback and the reader's annotations
 * (stamps placed on missed options, typed corrections), pooled over attempts.
 */

const CHECK = "\uf00c";
const CROSS = "\uf00d";
const SELECTED = "■";
const UNSELECTED = "□";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Mark = "correct" | "incorrect" | null;

interface Row {
  page: number;
  y: number;
  bottom: number;
  x: number;
  items: RawTextItem[];
  text: string;
  side: boolean;
}

interface Option {
  text: string;
  selected: boolean;
  mark: Mark;
  y: number;
  bottom: number;
  page: number;
  stamped: boolean;
}

interface Entry {
  text: string;
  value: string;
  mark: Mark;
  y: number;
  page: number;
  override: string | null;
}

interface Instance {
  number: number;
  page: number;
  state: string;
  earned: number | null;
  max: number | null;
  stem: string[];
  multi: boolean | null;
  options: Option[];
  body: Row[];
  response: string | null;
  feedback: string | null;
  fields: string[];
  rows: Row[];
  notes: string[];
  handMarked: boolean;
  y: number;
  figures: MoodleFigure[];
}

export interface MoodleFigure {
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
}

/** Rendered picture of a question: stable id + perceptual hash used to tell variants apart. */
export interface FigureRender {
  imageId: string;
  hash: string;
  fine?: string;
}

/** Stable id for a picture, so the same picture from any upload maps to one stored image. */
export function pictureId(fine: string): string {
  let h = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < fine.length; i++) {
    const c = fine.charCodeAt(i);
    h = Math.imul(h ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `mdl-img-${h.toString(36)}${h2.toString(36)}`;
}

function fineDistance(a: string, b: string): number {
  if (a.length !== b.length || !a.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  return s / a.length;
}

export const figureKey = (f: MoodleFigure) => `${f.page}:${Math.round(f.bbox.x)}:${Math.round(f.bbox.y)}`;

type Kind = "choice" | "order" | "match" | "text";

interface Parsed {
  kind: Kind;
  inst: Instance;
  stem: string;
  options: string[];
  entries: Entry[];
  correct: Set<number>;
  incorrect: Set<number>;
  complete: boolean;
  order: (number | null)[];
  pairs: (string | null)[];
  text: string | null;
  wrongTexts: string[];
  selected: Set<number>;
  /** Several inline blanks: confirmed value per blank (null = unknown) and values known to be wrong. */
  blanks?: (string | null)[];
  blankWrong?: string[][];
}

export const clean = (s: string) =>
  s
    .replace(/ĸ/g, "к")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const norm = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[⟪⟫]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const num = (s: string | undefined) => (s === undefined ? null : Number(s.replace(",", ".")));

const HEADER_RE = /^Вопрос\s*(\d+)$/;
const STATE_RE = /^(?:Верно|Неверно|Частично правильный|Частично|правильный|Выполнен|Нет ответа|Не отвечено|Не завершено|Ответ сохранен|Отметить вопрос|Отметить|вопрос|Пропущено)$/i;
const SCORE_RE = /^Балл(?:ов)?:\s*(-?\d+(?:,\d+)?)\s*(?:из\s*(\d+(?:,\d+)?)?)?$/;
const MAX_RE = /^(?:из\s*)?(\d+(?:,\d+)?)$/;
const MAX_ONLY_RE = /^Макс(?:\.|имальный)?\s*балл:?\s*(\d+(?:,\d+)?)$/i;
// Attempt-summary rows only: stems like «Состояние клетки…» or «Оценка вариабельности…» must not match.
const META_RE =
  /^(?:Тест начат|Состояние(?:\s+Заверш\p{L}*)?$|Завершен(?:ные|о)?(?:\s+\p{Lu}\p{L}*,.*)?$|Прошло\s*времени|Оценка(?:\s+\d.*)?$|Баллы\s+\d|В начало|Мои курсы)/u;
const INSTRUCTION_RE = /^Выберите\s+(?:один|одно|несколько)(?=\s)[^:]*(?:ответ|вариант)\S*:?$/iu;
const FEEDBACK_RE = /^⟪?\s*Правильн(?:ый|ые) ответ(?:ы)?\s*:?\s*(.*?)\s*⟫?$/i;
const VERDICT_RE = /^(?:Ваш ответ (?:верный|неправильный|частично правильный)|Отзыв)\.?$/i;
const ANSWER_RE = /^Ответ\s*:?\s*(.*)$/;
const FIELD_RE = /^⟪(.*)⟫$/;
const MATCH_STEM_RE = /Соотнесите|Сопоставьте|соответстви/i;
const ORDER_FIELD_RE = /^⟪\s*\[?\s*(\d{1,2})\s*\]?\s*⟫$/;
const LABEL_RE = /^[a-zа-я]\.\s*/i;

function rowsOf(page: PageInput, sideCut: number | null): Row[] {
  const items = page.items.filter((i) => i.str.trim());
  const groups: { side: boolean; items: RawTextItem[] }[] = [];
  const add = (side: boolean, list: RawTextItem[]) => {
    const sorted = list.slice().sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
    let cur: RawTextItem[] = [];
    let cy = 0;
    for (const it of sorted) {
      const c = it.y + it.h / 2;
      if (cur.length && Math.abs(c - cy) > Math.max(2.6, Math.min(it.h, cur[0].h) * 0.4)) {
        groups.push({ side, items: cur });
        cur = [];
      }
      if (!cur.length) cy = c;
      cur.push(it);
    }
    if (cur.length) groups.push({ side, items: cur });
  };
  if (sideCut === null) add(false, items);
  else {
    add(true, items.filter((i) => i.x < sideCut));
    add(false, items.filter((i) => i.x >= sideCut));
  }
  return groups
    .map(({ side, items: g }) => {
      const s = g.slice().sort((a, b) => a.x - b.x);
      return {
        page: page.pageNumber,
        y: Math.min(...s.map((i) => i.y)),
        bottom: Math.max(...s.map((i) => i.y + i.h)),
        x: s[0].x,
        items: s,
        text: clean(s.map((i) => i.str).join(" ")),
        side,
      };
    })
    .sort((a, b) => a.y - b.y || (a.side === b.side ? 0 : a.side ? -1 : 1));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Moodle 4 prints the info box in a left column; Moodle 3/mobile prints it above the question. */
function sideColumnCut(pages: PageInput[]): number | null {
  const headerX: number[] = [];
  const contentX: number[] = [];
  for (const p of pages)
    for (const i of p.items) {
      const t = i.str.trim();
      if (t === "Вопрос") headerX.push(i.x);
      else if (/^Выберите(?:\s|$)/.test(t)) contentX.push(i.x);
    }
  const h = median(headerX);
  const c = median(contentX);
  if (h === null || c === null || c - h < 45) return null;
  return c - 8;
}

/** Layout differs between uploaded files, so decide per page; pages without evidence inherit from the nearest page that has it. */
function sideCutsByPage(pages: PageInput[]): (number | null)[] {
  const has = (p: PageInput) => p.items.some((i) => i.str.trim() === "Вопрос") && p.items.some((i) => /^Выберите(?:\s|$)/.test(i.str.trim()));
  const own = pages.map((p) => (has(p) ? { cut: sideColumnCut([p]) } : null));
  return pages.map((_, idx) => {
    for (let d = 0; d < pages.length; d++) {
      const back = own[idx - d];
      if (back) return back.cut;
      const fwd = own[idx + d];
      if (fwd) return fwd.cut;
    }
    return null;
  });
}

export function looksLikeMoodleReview(pages: PageInput[]): boolean {
  let headers = 0;
  let scores = 0;
  for (const p of pages)
    for (const i of p.items) {
      const t = i.str.trim();
      if (t === "Вопрос") headers++;
      else if (/^Балл(?:ов)?:/.test(t)) scores++;
    }
  return headers >= 3 && scores >= headers * 0.6;
}

function newInstance(number: number, page: number, y: number): Instance {
  return { number, page, y, figures: [], state: "", earned: null, max: null, stem: [], multi: null, options: [], body: [], response: null, feedback: null, fields: [], rows: [], notes: [], handMarked: false };
}

/** Course/test titles printed at the top of each attempt ("24. КОНТРОЛЬНЫЙ ТЕСТ. …"). */
function isTitleRow(t: string): boolean {
  if (t.startsWith(SELECTED) || t.startsWith(UNSELECTED)) return false;
  if (/^(?:\d{1,3}\.\s*)?(?:КОНТРОЛЬН\p{Lu}*|ИТОГОВ\p{Lu}*)\s+(?:ТЕСТ|ЗАНЯТИЕ)|Перейти на\.\.\.|^Студентам и курсантам\s*\//u.test(t)) return true;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 20 || !/\p{Lu}{7,}/u.test(t)) return false;
  if (t.includes("___")) return false;
  return letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length >= 0.6;
}

function markOf(row: Row): Mark {
  const t = row.items.map((i) => i.str).join("");
  if (t.includes(CROSS)) return "incorrect";
  if (t.includes(CHECK)) return "correct";
  return null;
}

const stripGlyphs = (s: string) => clean(s.replace(new RegExp(`[${CHECK}${CROSS}]`, "g"), ""));

function readInstances(pages: PageInput[]): Instance[] {
  const cuts = sideCutsByPage(pages);
  const out: Instance[] = [];
  let q: Instance | null = null;
  let inHeader = false;
  let section: "stem" | "options" | "feedback" = "stem";
  let optionX = 0;

  for (const [pageIdx, page] of pages.entries()) {
    for (const row of rowsOf(page, cuts[pageIdx])) {
      const t = row.text;
      const head = HEADER_RE.exec(t);
      if (head) {
        q = newInstance(Number(head[1]), row.page, row.y);
        out.push(q);
        inHeader = true;
        section = "stem";
        continue;
      }
      if (!q) continue;
      if (row.side || inHeader) {
        const sc = SCORE_RE.exec(t);
        if (sc) {
          q.earned = num(sc[1]);
          if (sc[2]) q.max = num(sc[2]);
          continue;
        }
        const mx = MAX_ONLY_RE.exec(t);
        if (mx) {
          q.max = num(mx[1]);
          continue;
        }
        if (q.earned !== null && q.max === null && MAX_RE.test(t)) {
          q.max = num(MAX_RE.exec(t)![1]);
          continue;
        }
        if (STATE_RE.test(t)) {
          if (!/^(?:Отметить|вопрос)/i.test(t)) q.state = clean(`${q.state} ${t}`);
          continue;
        }
        if (row.side) continue;
        inHeader = false;
      }
      if (META_RE.test(t) || isTitleRow(t)) {
        // A new attempt's summary: anything above it on this page (the course title) is not part of the previous question.
        if (q && /^Тест начат/.test(t)) {
          const above = (r: Row) => !(r.page === row.page && r.y < row.y);
          q.rows = q.rows.filter(above);
          q.body = q.body.filter(above);
        }
        q = null;
        continue;
      }
      q.rows.push(row);

      const fb = FEEDBACK_RE.exec(t);
      if (fb) {
        q.feedback = fb[1];
        section = "feedback";
        continue;
      }
      if (VERDICT_RE.test(t)) continue;
      if (section === "feedback") {
        if (!q.options.length && !FIELD_RE.test(t)) q.feedback = clean(`${q.feedback ?? ""} ${t}`);
        continue;
      }
      if (INSTRUCTION_RE.test(t)) {
        q.multi = /несколько/i.test(t);
        section = "options";
        continue;
      }
      const first = row.items[0].str.trim();
      if (first === SELECTED || first === UNSELECTED) {
        const textItems = row.items.slice(1);
        optionX = textItems[0]?.x ?? row.x;
        q.options.push({
          text: stripGlyphs(textItems.map((i) => i.str).join(" ")).replace(LABEL_RE, ""),
          selected: first === SELECTED,
          mark: markOf(row),
          y: row.y,
          bottom: row.bottom,
          page: row.page,
          stamped: false,
        });
        section = "options";
        continue;
      }
      const ans = ANSWER_RE.exec(t);
      if (ans && !q.options.length) {
        q.response = clean(ans[1].replace(/[⟪⟫]/g, "")) || null;
        if (!q.response) section = "options";
        continue;
      }
      if (section === "options" && q.options.length) {
        const last = q.options[q.options.length - 1];
        const glyphOnly = !stripGlyphs(t);
        if (glyphOnly) {
          last.mark = last.mark ?? markOf(row);
          continue;
        }
        if (row.x >= optionX - 4 && row.page === last.page && row.y - last.bottom < 14) {
          last.text = clean(`${last.text} ${stripGlyphs(t)}`);
          last.mark = last.mark ?? markOf(row);
          last.bottom = row.bottom;
          continue;
        }
      }
      if (section === "options" && q.response === null && !q.options.length && FIELD_RE.test(t)) {
        q.response = clean(FIELD_RE.exec(t)![1]);
        continue;
      }
      q.body.push(row);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

function annotate(instances: Instance[], pages: PageInput[]) {
  const byPage = new Map<number, Instance[]>();
  for (const q of instances) for (const p of new Set(q.rows.map((r) => r.page))) (byPage.get(p) ?? byPage.set(p, []).get(p)!).push(q);
  for (const page of pages) {
    for (const a of page.annotations ?? []) {
      const cy = a.bbox.y + a.bbox.h / 2;
      const owner = ownerOf(byPage.get(page.pageNumber) ?? [], page.pageNumber, a);
      if (!owner) continue;
      if (a.kind === "STAMP") {
        const target = owner.options
          .filter((o) => o.page === page.pageNumber)
          .map((o) => ({ o, d: Math.abs((o.y + o.bottom) / 2 - (a.bbox.y + a.bbox.h * 0.62)) }))
          .sort((x, y) => x.d - y.d)[0];
        if (target && target.d < 14) target.o.stamped = true;
        else owner.handMarked = true;
        void cy;
      } else if (a.kind === "FREETEXT" && a.text) {
        owner.notes.push(a.text);
        (owner as Instance & { noteBoxes?: { text: string; y: number }[] }).noteBoxes ??= [];
        (owner as Instance & { noteBoxes?: { text: string; y: number }[] }).noteBoxes!.push({ text: a.text, y: cy });
      } else owner.handMarked = true;
    }
  }
}

function ownerOf(candidates: Instance[], page: number, a: PageAnnotation): Instance | null {
  const top = a.bbox.y;
  const bottom = a.bbox.y + a.bbox.h;
  let best: Instance | null = null;
  let bestScore = -Infinity;
  for (const q of candidates) {
    const rows = q.rows.filter((r) => r.page === page);
    if (!rows.length) continue;
    const qTop = Math.min(...rows.map((r) => r.y));
    const qBottom = Math.max(...rows.map((r) => r.bottom));
    const overlap = Math.min(bottom, qBottom + 20) - Math.max(top, qTop - 6);
    const dist = overlap > 0 ? overlap : overlap - 1000;
    if (dist > bestScore) {
      bestScore = dist;
      best = q;
    }
  }
  return bestScore > -1000 + -40 ? best : null;
}

/* ------------------------------------------------------------------ */

const isFull = (q: Instance) => q.earned !== null && q.max !== null && q.max > 0 && q.earned >= q.max - 1e-6;
const isZero = (q: Instance) => q.earned !== null && q.max !== null && q.max > 0 && q.earned <= 1e-6;
const noteBoxes = (q: Instance) => (q as Instance & { noteBoxes?: { text: string; y: number }[] }).noteBoxes ?? [];

const isField = (i: RawTextItem) => FIELD_RE.test(i.str.trim());
const isGlyph = (i: RawTextItem) => !stripGlyphs(i.str);
const wordItems = (r: Row) => r.items.filter((i) => !isGlyph(i));

/** x where the right-hand cell of a plain matching table starts (cells may sit on different lines). */
function rightColumnX(rows: Row[], entries: number): number {
  const words = rows.map(wordItems).filter((w) => w.length);
  if (!words.length) return Infinity;
  const leftX = Math.min(...words.map((w) => w[0].x));
  const candidates: number[] = [];
  for (const w of words) {
    if (w[0].x > leftX + 30) {
      candidates.push(w[0].x);
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      if (w[k].x - (w[k - 1].x + w[k - 1].w) > 12) {
        candidates.push(w[k].x);
        break;
      }
    }
  }
  if (candidates.length < Math.max(1, entries / 2)) return Infinity;
  return Math.min(...candidates.filter((c) => c >= (median(candidates) ?? 0) - 40));
}

/**
 * Inline blanks ("Сонным бугорком называется ⟪передний⟫ бугорок ⟪поперечного⟫ …",
 * labelled pictures "1. ⟪…⟫ мышца 2. ⟪…⟫"). Unlike a matching table, the fields sit
 * inside the sentence: text follows them on the same line, or they stand on their own line.
 */
const isSideText = (s: string) => {
  const t = clean(s);
  return SCORE_RE.test(t) || MAX_RE.test(t) || /^из$/.test(t) || STATE_RE.test(t);
};

function clozeOf(rows: Row[]): FillInfo | null {
  const ordered = rows.flatMap((r) => r.items.slice().sort((a, b) => a.x - b.x));
  if (ordered.some((i) => ORDER_FIELD_RE.test(i.str.trim()))) return null;
  const fieldRows = rows.filter((r) => r.items.some(isField));
  let inline = 0;
  let alone = 0;
  for (const r of fieldRows) {
    const words = r.items.filter((i) => !isGlyph(i)).sort((a, b) => a.x - b.x);
    const fIdx = words.findIndex(isField);
    if (words.slice(fIdx + 1).some((i) => !isField(i))) inline++;
    else if (fIdx === 0) alone++;
  }
  if (!inline && alone * 2 <= fieldRows.length) return null;
  const fieldCount = ordered.filter(isField).length;
  const marked = rows.some((r) => markOf(r) !== null);
  // Matching tables with wrapped left cells look inline too; they carry one ✓/✗ per row, cloze in these files does not.
  if (fieldCount > 1 && (marked || MATCH_STEM_RE.test(rows.map((r) => r.text).join(" ")))) return null;
  const blanks: string[] = [];
  const marks: Mark[] = [];
  const parts: string[] = [];
  const ys: number[] = [];
  for (const i of ordered) {
    if (isField(i) && isSideText(FIELD_RE.exec(i.str.trim())![1])) continue;
    if (isField(i)) {
      blanks.push(clean(FIELD_RE.exec(i.str.trim())![1]));
      ys.push(i.y + i.h / 2);
      marks.push(null);
      parts.push("___");
    } else if (isGlyph(i)) {
      const m = i.str.includes(CROSS) ? "incorrect" : i.str.includes(CHECK) ? "correct" : null;
      if (m && marks.length && marks[marks.length - 1] === null) marks[marks.length - 1] = m;
    } else parts.push(i.str);
  }
  return { text: clean(parts.join(" ")), value: blanks.join(" "), mark: marks.length === 1 ? marks[0] : null, blanks, marks, ys };
}

/** Matching printed without drop-down boxes: "удаление слюнной железы   cиалэктомия". Only trusted with full score. */
function plainMatch(q: Instance): Structured | null {
  if (!isFull(q)) return null;
  const rows = q.body;
  if (rows.length < 3) return null;
  const stemX = rows[0].x;
  let start = rows.length;
  while (start > 1 && rows[start - 1].x >= stemX + 0.3) start--;
  const tail = rows.slice(start);
  if (tail.length < 2) return null;
  let rightX = rightColumnX(tail, tail.length);
  if (!Number.isFinite(rightX)) {
    const shared = wordItems(tail[0])
      .slice(1)
      .map((i) => i.x)
      .filter((x) => tail.every((r) => wordItems(r).slice(1).some((i) => Math.abs(i.x - x) < 3)));
    if (!shared.length) return null;
    rightX = Math.max(...shared);
  }
  const entries: Entry[] = [];
  for (const r of tail) {
    const w = wordItems(r);
    const left = clean(w.filter((i) => i.x < rightX - 2).map((i) => i.str).join(" "));
    const right = clean(w.filter((i) => i.x >= rightX - 2).map((i) => i.str).join(" "));
    if (!left || !right) return null;
    entries.push({ text: left, value: right, mark: null, y: r.y, page: r.page, override: null });
  }
  return { kind: "match", stem: rows.slice(0, start), entries };
}

interface FillInfo {
  text: string;
  value: string;
  mark: Mark;
  blanks?: string[];
  marks?: Mark[];
  ys?: number[];
}

interface Structured {
  kind: "order" | "match" | "fill" | null;
  stem: Row[];
  entries: Entry[];
  fill?: FillInfo;
}

/**
 * Matching, ordering and fill-in rows. Moodle prints one ✓/✗ icon after each
 * answered row, so the icons are the row terminators; the row's value is its
 * drop-down field (⟪��⟫) or, for plain tables, the right-hand column.
 */
function parseStructured(q: Instance): Structured {
  const rows = q.body;
  const hasFields = rows.some((r) => r.items.some(isField));
  const hasMarks = rows.some((r) => markOf(r) !== null);
  if (!hasFields && !hasMarks) return plainMatch(q) ?? { kind: null, stem: rows, entries: [] };
  const cloze = hasFields ? clozeOf(rows) : null;
  if (cloze) return { kind: "fill", stem: [], entries: [], fill: cloze };

  const firstIdx = rows.findIndex((r) => r.items.some(isField) || markOf(r) !== null);
  const stemX = rows[0]?.x ?? 0;
  let start = firstIdx;
  if (!rows[firstIdx].items.some(isField) || rows[firstIdx].items.length === 1) {
    while (start > 0 && rows[start - 1].x >= stemX + 0.3 && rows[start - 1].page === rows[firstIdx].page && rows[firstIdx].y - rows[start - 1].bottom < 30) start--;
  }
  const stem = rows.slice(0, start);
  const tail = rows.slice(start);

  const groups: Row[][] = [];
  let cur: Row[] = [];
  const anyGlyph = tail.some((r) => markOf(r) !== null);
  for (const r of tail) {
    cur.push(r);
    if (anyGlyph && markOf(r) !== null) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    if (anyGlyph && groups.length && !cur.some((r) => r.items.some(isField))) groups[groups.length - 1].push(...cur);
    else groups.push(cur);
  }
  if (!anyGlyph) {
    const split: Row[][] = [];
    for (const r of tail) {
      if (!split.length || r.items.some(isField) || wordItems(r).length >= 2) split.push([r]);
      else split[split.length - 1].push(r);
    }
    groups.splice(0, groups.length, ...split);
  }

  // A lone numeric field ("…узла (указать цифрой) ⟪3⟫") is a short answer, not a one-row ordering task.
  const orderLike = groups.length >= 2 && tail.some((r) => r.items.some((i) => ORDER_FIELD_RE.test(i.str.trim())));
  const plain = !tail.some((r) => r.items.some(isField));
  const rightX = plain ? rightColumnX(tail, groups.length) : Infinity;

  const entries: Entry[] = groups
    .map((g) => {
      const items = g.flatMap((r) => r.items).filter((i) => !isGlyph(i));
      const fieldVals = items.filter(isField).map((i) => clean(FIELD_RE.exec(i.str.trim())![1]));
      const leftItems = items.filter((i) => !isField(i) && i.x < rightX - 2);
      const rightItems = items.filter((i) => !isField(i) && i.x >= rightX - 2);
      const byPos = (a: RawTextItem, b: RawTextItem) => a.y - b.y || a.x - b.x;
      const text = clean(leftItems.sort(byPos).map((i) => i.str).join(" "));
      const value = fieldVals.length ? fieldVals.join(" ") : clean(rightItems.sort(byPos).map((i) => i.str).join(" "));
      const mark = g.map(markOf).find((m) => m !== null) ?? null;
      const top = Math.min(...g.map((r) => r.y));
      const bottom = Math.max(...g.map((r) => r.bottom));
      return { text, value: orderLike ? value.replace(/\D/g, "").padStart(2, "0") : value, mark, y: (top + bottom) / 2, page: g[0].page, override: null };
    })
    .filter((e) => e.text || e.value);

  if (!orderLike && entries.length === 1) {
    const g = tail;
    const text = clean(
      [...stem, ...g]
        .flatMap((r) => r.items)
        .filter((i) => !isGlyph(i))
        .map((i) => (isField(i) ? "___" : i.str))
        .join(" "),
    );
    return { kind: "fill", stem: [], entries: [], fill: { text, value: entries[0].value, mark: entries[0].mark } };
  }
  return { kind: orderLike ? "order" : "match", stem, entries };
}

/** Unique assignment of the remaining values to the remaining rows, given rows that are known wrong with their own value. */
function solveRemaining(values: string[], entries: Entry[], known: (string | null)[]): (string | null)[] {
  const freeIdx = known.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (!freeIdx.length) return known;
  const pool = values.slice();
  for (const v of known) if (v !== null) pool.splice(pool.indexOf(v), 1);
  if (pool.length !== freeIdx.length || freeIdx.length > 7) return known;
  const solutions: string[][] = [];
  const pick = (k: number, acc: string[], left: string[]) => {
    if (solutions.length > 1) return;
    if (k === freeIdx.length) {
      solutions.push(acc.slice());
      return;
    }
    const e = entries[freeIdx[k]];
    const seen = new Set<string>();
    for (let j = 0; j < left.length; j++) {
      const v = left[j];
      if (seen.has(v)) continue;
      seen.add(v);
      if (e.mark === "incorrect" && v === e.value) continue;
      pick(k + 1, [...acc, v], [...left.slice(0, j), ...left.slice(j + 1)]);
    }
  };
  pick(0, [], pool);
  if (solutions.length !== 1) return known;
  const out = known.slice();
  freeIdx.forEach((idx, k) => (out[idx] = solutions[0][k]));
  return out;
}

/**
 * Moodle grades a multiple-answer attempt as (right picks)/(correct count) − (wrong picks)/(wrong count).
 * Enumerates every answer key compatible with the visible marks and the printed score; returns it when unique.
 */
function solveByScore(q: Instance, p: Parsed): Set<number> | null {
  const n = q.options.length;
  if (n < 2 || n > 10 || !q.max || q.earned === null || q.earned <= 1e-6 || isFull(q)) return null;
  const target = q.earned / q.max;
  const found: number[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const isKey = (i: number) => !!(mask & (1 << i));
    if ([...p.correct].some((i) => !isKey(i)) || [...p.incorrect].some((i) => isKey(i))) continue;
    const k = q.options.filter((_, i) => isKey(i)).length;
    const right = [...p.selected].filter(isKey).length;
    const wrong = p.selected.size - right;
    const grade = k === n ? right / k : Math.max(0, right / k - wrong / (n - k));
    if (Math.abs(grade - target) < 0.006) found.push(mask);
    if (found.length > 1) return null;
  }
  if (found.length !== 1) return null;
  return new Set(q.options.map((_, i) => i).filter((i) => found[0] & (1 << i)));
}

function interpret(q: Instance): Parsed {
  const base = { inst: q, correct: new Set<number>(), incorrect: new Set<number>(), selected: new Set<number>(), complete: false, order: [], pairs: [], text: null, wrongTexts: [] as string[], entries: [] as Entry[], options: [] as string[] };
  if (q.options.length) {
    const stem = clean([...q.body.map((r) => r.text)].join(" "));
    const p: Parsed = { ...base, kind: "choice", stem, options: q.options.map((o) => o.text) };
    const single = q.multi === false || (q.multi === null && q.options.filter((o) => o.selected).length <= 1 && q.options.length > 1 && !/несколько/i.test(stem));
    q.options.forEach((o, i) => {
      if (o.selected) p.selected.add(i);
      if (o.mark === "correct" || o.stamped) p.correct.add(i);
      if (o.mark === "incorrect" && !o.stamped) p.incorrect.add(i);
    });
    if (isFull(q)) {
      p.correct = new Set(p.selected);
      p.complete = p.correct.size > 0;
    }
    if (isZero(q) && single) for (const i of p.selected) if (!q.options[i].stamped) p.incorrect.add(i);
    if (q.feedback) {
      const fbIdx = matchFeedback(q.feedback, p.options);
      if (fbIdx.length) {
        p.correct = new Set(fbIdx);
        p.complete = true;
      }
    }
    if (single && !p.complete) {
      if (p.correct.size === 1) p.complete = true;
      else if (!p.correct.size && p.options.length - p.incorrect.size === 1) {
        p.correct.add(p.options.findIndex((_, i) => !p.incorrect.has(i)));
        p.complete = true;
      }
    }
    if (!single && !p.complete) {
      const stamps = q.options.some((o) => o.stamped);
      const okSelected = q.options.filter((o) => o.selected && o.mark === "correct").length;
      const badSelected = q.options.filter((o) => o.selected && o.mark === "incorrect").length;
      if (stamps && !badSelected) p.complete = true;
      else if (q.earned && q.max && okSelected && !badSelected) {
        const k = Math.round((okSelected * q.max) / q.earned);
        const unselected = q.options.map((o, i) => (o.selected ? -1 : i)).filter((i) => i >= 0);
        if (k === p.correct.size) p.complete = true;
        // e.g. 4 ticked-correct for 0,80 → 5 correct in total; if that equals ticked + unticked, every unticked option is correct too.
        else if (k > p.correct.size && k - okSelected === unselected.length) {
          for (const i of unselected) p.correct.add(i);
          p.complete = true;
        }
      }
      if (stamps && badSelected) p.complete = true;
      if (!p.complete) {
        const key = solveByScore(q, p);
        if (key) {
          p.correct = key;
          p.complete = true;
        }
      }
    }
    if (p.complete && single) for (let i = 0; i < p.options.length; i++) if (!p.correct.has(i)) p.incorrect.add(i);
    return p;
  }

  const structured = parseStructured(q);
  if (structured.kind === "fill" && structured.fill) {
    const f = structured.fill;
    const p: Parsed = { ...base, kind: "text", stem: f.text };
    const notes = q.notes.map(clean).filter(Boolean);
    const overrides = new Map<number, string>();
    if (f.blanks && f.ys)
      for (const n of noteBoxes(q)) {
        const best = f.ys.map((y, i) => ({ i, d: Math.abs(y - n.y) })).sort((a, b) => a.d - b.d)[0];
        if (best && best.d < 20 && n.text.trim()) overrides.set(best.i, clean(n.text));
      }
    if (f.blanks && f.blanks.length > 1 && !q.feedback && (!notes.length || overrides.size)) {
      const n = f.blanks.length;
      // A partial score with exactly the hand-corrected blanks wrong confirms every other blank.
      const restConfirmed = overrides.size > 0 && q.earned !== null && !!q.max && Math.round((q.earned / q.max) * n) === n - overrides.size;
      const full = isFull(q) || restConfirmed;
      const zero = isZero(q);
      p.blanks = f.blanks.map((v, i) => overrides.get(i) ?? (v && (full || f.marks![i] === "correct") ? v : null));
      p.blankWrong = f.blanks.map((v, i) => (v && (f.marks![i] === "incorrect" || (zero && f.marks![i] !== "correct")) ? [v] : []));
      p.complete = p.blanks.every((v) => v !== null);
      p.text = p.complete ? fillBlanks(f.text, p.blanks) : null;
      if (!p.complete && !p.blanks.some((v) => v !== null) && !zero && f.value) p.text = fillBlanks(f.text, f.blanks);
      return p;
    }
    if (notes.length) {
      p.text = notes.join(" ");
      p.complete = true;
    } else if (q.feedback) {
      p.text = clean(q.feedback);
      p.complete = true;
    } else if (f.value && (isFull(q) || f.mark === "correct")) {
      p.text = f.value;
      p.complete = true;
    } else if (f.value && (isZero(q) || f.mark === "incorrect")) p.wrongTexts.push(f.value);
    else if (f.value) p.text = f.value;
    return p;
  }
  if (structured.kind === "order" || structured.kind === "match") {
    const kind = structured.kind;
    const stem = clean(structured.stem.map((r) => r.text).join(" "));
    const entries = structured.entries;
    const notes = noteBoxes(q);
    for (const n of notes) {
      const target = entries
        .map((e) => ({ e, d: Math.abs(e.y - n.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (target && target.d < 20) target.e.override = n.text.trim();
    }
    const p: Parsed = { ...base, kind, stem, entries, options: entries.map((e) => e.text) };
    const values = entries.map((e) => e.value);
    let known: (string | null)[] = entries.map((e) => (e.override ? normalizeValue(e.override, kind) : isFull(q) || e.mark === "correct" ? e.value : null));
    if (!entries.some((e) => e.override)) known = solveRemaining(values, entries, known);
    p.complete = known.every((v) => v !== null && v !== "");
    if (kind === "order") p.order = known.map((v) => (v ? Number(v) : null));
    else p.pairs = known;
    return p;
  }

  const fields = q.body.flatMap((r) => r.items.map((i) => FIELD_RE.exec(i.str.trim())?.[1]).filter((v): v is string => !!v));
  const stem = clean(
    q.body
      .map((r) => r.items.map((i) => (FIELD_RE.test(i.str.trim()) ? "___" : i.str)).join(" "))
      .join(" "),
  );
  const p: Parsed = { ...base, kind: "text", stem };
  const response = q.response ?? (fields.length ? fields.map(clean).join(" ") : null);
  const notes = q.notes.map(clean).filter(Boolean);
  if (notes.length) {
    p.text = notes.join(" ");
    p.complete = true;
  } else if (q.feedback) {
    p.text = clean(q.feedback);
    p.complete = true;
  } else if (response && isFull(q)) {
    p.text = response;
    p.complete = true;
  } else if (response && isZero(q)) p.wrongTexts.push(response);
  else if (response) p.text = response;
  return p;
}

function fillBlanks(template: string, values: (string | null)[]): string {
  let k = 0;
  return template.replace(/___/g, () => {
    const v = values[k++];
    return v ? `«${v}»` : "___";
  });
}

function normalizeValue(v: string, kind: "order" | "match"): string {
  return kind === "order" ? v.replace(/\D/g, "").padStart(2, "0") : v;
}

function matchFeedback(feedback: string, options: string[]): number[] {
  const f = norm(feedback);
  if (!f) return [];
  const exact = options.findIndex((o) => norm(o) === f);
  if (exact >= 0) return [exact];
  const hits = options.map((o, i) => ({ i, n: norm(o) })).filter((o) => o.n && f.includes(o.n));
  const covered = hits.reduce((s, h) => s + h.n.length, 0);
  return covered >= f.replace(/\s/g, "").length * 0.6 ? hits.map((h) => h.i) : [];
}

/* ------------------------------------------------------------------ */

interface Group {
  key: string;
  first: Parsed;
  items: Parsed[];
  imageId?: string;
}

function keyOf(p: Parsed, picture: string): string {
  const stem = norm(p.stem);
  if (p.kind === "text") return `t|${stem}|${picture}`;
  return `${p.kind}|${stem}|${p.options.map(norm).sort().join("��")}|${picture}`;
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Same picture from different attempts (slightly different crops) → one cluster. */
function pictureClusters(renders: FigureRender[]): (r: FigureRender) => FigureRender {
  const reps: FigureRender[] = [];
  const cache = new Map<string, FigureRender>();
  const id = (r: FigureRender) => r.fine || r.hash;
  for (const r of renders) {
    if (cache.has(id(r))) continue;
    const rep = reps.find((x) => (x.fine && r.fine ? fineDistance(x.fine, r.fine) <= 0.06 : hamming(x.hash, r.hash) === 0));
    if (rep) cache.set(id(r), rep);
    else {
      reps.push(r);
      cache.set(id(r), r);
    }
  }
  return (r) => cache.get(id(r)) ?? r;
}

/**
 * Pasted screenshots of the Moodle page itself (with the student's marks on the answers) and thin slivers
 * cut from them are not question figures: showing them would leak the answer or display garbage.
 */
function isJunkFigure(page: PageInput, b: { x: number; y: number; w: number; h: number }): boolean {
  if (b.w < 24 || b.h < 24) return true;
  if (b.w < 70 && b.h / b.w > 1.8) return true;
  const words = page.items.filter(
    (i) => /\p{L}{3,}/u.test(i.str) && i.x >= b.x - 2 && i.x + i.w <= b.x + b.w + 2 && i.y >= b.y - 2 && i.y + i.h <= b.y + b.h + 2,
  );
  return words.length >= 3 || words.some((i) => /Баллов|Вопрос|Выполнен|Выберите/i.test(i.str));
}

function attachFigures(instances: Instance[], pages: PageInput[]) {
  const starts = instances.map((q, i) => ({ i, page: q.page, y: q.y }));
  for (const p of pages)
    for (const img of p.images) {
      if (isJunkFigure(p, img.bbox)) continue;
      let owner = -1;
      for (const s of starts) if (s.page < p.pageNumber || (s.page === p.pageNumber && s.y <= img.bbox.y + 4)) owner = s.i;
      if (owner >= 0) instances[owner].figures.push({ page: p.pageNumber, bbox: img.bbox });
    }
}

/** Every picture that belongs to a Moodle question, for the caller to render before grouping. */
export function moodleFigures(pages: PageInput[]): MoodleFigure[] {
  if (!looksLikeMoodleReview(pages)) return [];
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const instances = readInstances(sorted);
  attachFigures(instances, sorted);
  return instances.flatMap((q) => q.figures);
}

function confidenceOf(status: QuestionStatus, votes: number): ConfidenceLevel {
  if (status !== "answered") return "needs-review";
  return votes >= 1 ? "high" : "medium";
}

function resolveGroup(g: Group, index: number): MCQQuestion {
  const base = g.first;
  const options: Record<string, string> = {};
  base.options.forEach((t, i) => (options[LETTERS[i] ?? String(i + 1)] = t));
  const pageNumber = base.inst.page;
  const common = { id: `mdl-${index}-${norm(base.stem).slice(0, 24).replace(/\s/g, "-")}`, number: index + 1, question: base.stem, pageNumber, attempts: g.items.length };

  if (base.kind === "choice") {
    const pos = (p: Parsed, i: number) => base.options.findIndex((t) => norm(t) === norm(p.options[i]));
    const completeSets = new Map<string, number>();
    const correct = new Set<number>();
    const incorrect = new Set<number>();
    for (const p of g.items) {
      const mapIdx = (s: Set<number>) => [...s].map((i) => pos(p, i)).filter((i) => i >= 0);
      if (p.complete) {
        const k = mapIdx(p.correct).sort().join(",");
        completeSets.set(k, (completeSets.get(k) ?? 0) + 1);
      }
      for (const i of mapIdx(p.correct)) correct.add(i);
      for (const i of mapIdx(p.incorrect)) incorrect.add(i);
    }
    let keys: number[] = [];
    let status: QuestionStatus = "missing_answer";
    let note: string | undefined;
    const sets = [...completeSets.entries()].sort((a, b) => b[1] - a[1]);
    const single = base.inst.multi === false;
    if (sets.length) {
      keys = sets[0][0].split(",").filter(Boolean).map(Number);
      status = sets.length > 1 ? "needs_review" : "answered";
      if (sets.length > 1) note = "Попытки дают разные правильные ответы — проверьте";
    } else if (correct.size && (single || correct.size + incorrect.size === base.options.length)) {
      keys = [...correct];
      status = "answered";
    } else if (single && !correct.size && base.options.length - incorrect.size === 1) {
      keys = [base.options.findIndex((_, i) => !incorrect.has(i))];
      status = "answered";
    } else if (correct.size) {
      keys = [...correct];
      status = "needs_review";
      note = "Известна только часть правильных вариантов — проверьте остальные";
    } else {
      const provisional = g.items.find((p) => p.selected.size && p.inst.earned && p.inst.earned > 0);
      if (provisional) {
        keys = [...provisional.selected].map((i) => pos(provisional, i)).filter((i) => i >= 0 && !incorrect.has(i));
        if (keys.length) {
          status = "needs_review";
          note = `Ответ студента с частичным баллом (${provisional.inst.earned?.toString().replace(".", ",")} из ${provisional.inst.max?.toString().replace(".", ",")}) — проверьте`;
        }
      }
    }
    if (g.items.some((p) => p.inst.handMarked) && status !== "answered") note = `${note ? `${note}. ` : ""}В файле есть рукописные пометки к этому вопросу`;
    const letters = keys.sort((a, b) => a - b).map((i) => LETTERS[i]);
    return {
      ...common,
      options,
      correctAnswer: letters.length ? letters.join(",") : null,
      answerText: letters.length ? letters.map((l) => options[l]).join("; ") : undefined,
      confidence: confidenceOf(status, completeSets.size),
      status,
      explanation: note,
    };
  }

  if (base.kind === "order" || base.kind === "match") {
    const best = g.items.find((p) => p.complete) ?? mergeStructured(g.items, base);
    const letterAt = (i: number) => LETTERS[i] ?? String(i + 1);
    const optionMap = Object.fromEntries(best.options.map((t, i) => [letterAt(i), t]));
    // A "matching" table whose right column is only position numbers ("[03]") is really an ordering task.
    const numericPairs = base.kind === "match" && best.pairs.length > 1 && best.pairs.every((v) => !v || /^\[?\s*\d{1,2}\s*\]?$/.test(v));
    const kind = numericPairs ? "order" : base.kind;
    const order = numericPairs ? best.pairs.map((v) => (v ? Number(v.replace(/\D/g, "")) : null)) : best.order;
    let answerText: string | undefined;
    let complete = best.complete;
    let sequence: Record<string, number> | undefined;
    let matching: { pairs: Record<string, string>; choices: string[] } | undefined;
    if (kind === "order") {
      const rows = best.entries.map((e, i) => ({ key: letterAt(i), text: e.text, n: order[i] }));
      if (rows.some((r) => r.n !== null)) {
        answerText = rows
          .slice()
          .sort((a, b) => (a.n ?? 99) - (b.n ?? 99))
          .map((r) => `${r.n ?? "?"}) ${r.text}`)
          .join("; ");
      }
      complete = complete && order.every((n) => n !== null) && new Set(order).size === order.length;
      if (complete) sequence = Object.fromEntries(rows.map((r) => [r.key, r.n as number]));
    } else {
      const rows = best.entries.map((e, i) => ({ key: letterAt(i), text: e.text, v: best.pairs[i] }));
      if (rows.some((r) => r.v)) answerText = rows.map((r) => `${r.text} → ${r.v ?? "?"}`).join("; ");
      complete = complete && rows.every((r) => !!r.v);
      if (complete) {
        // Moodle prints only the chosen value per row, so the drop-down list is rebuilt from every value seen in any attempt.
        const seen = new Map<string, string>();
        for (const v of [...rows.map((r) => r.v as string), ...g.items.flatMap((p) => p.entries.map((e) => e.value))])
          if (v && !seen.has(norm(v))) seen.set(norm(v), v);
        matching = { pairs: Object.fromEntries(rows.map((r) => [r.key, r.v as string])), choices: [...seen.values()] };
      }
    }
    const status: QuestionStatus = !answerText ? "missing_answer" : complete ? "answered" : "needs_review";
    return {
      ...common,
      options: optionMap,
      correctAnswer: null,
      answerText,
      confidence: confidenceOf(status, 1),
      status,
      tags: [kind === "order" ? "ordering" : "matching"],
      sequence,
      matching,
      explanation: status === "needs_review" ? "Часть ответа не подтверждена баллом — проверьте" : undefined,
    };
  }

  const blankItems = g.items.filter((p) => p.blanks);
  if (blankItems.length && !g.items.some((p) => !p.blanks && p.complete && p.text)) {
    const n = Math.max(...blankItems.map((p) => p.blanks!.length));
    const merged: (string | null)[] = Array.from({ length: n }, (_, i) => blankItems.map((p) => p.blanks![i]).find((v) => v) ?? null);
    const known = merged.filter((v) => v !== null).length;
    const answerText = known ? fillBlanks(base.stem, merged) : (blankItems.find((p) => p.text)?.text ?? undefined);
    const status: QuestionStatus = known === n ? "answered" : answerText ? "needs_review" : "missing_answer";
    const note = status === "answered" ? undefined : known ? `Подтверждено ${known} из ${n} пропусков — проверьте остальные` : answerText ? "Ответ студента без подтверждения баллом — проверьте" : undefined;
    return { ...common, options: {}, correctAnswer: null, answerText, confidence: confidenceOf(status, 1), status, explanation: note };
  }

  const confirmed = g.items.filter((p) => p.complete && p.text);
  const counts = new Map<string, { text: string; n: number }>();
  for (const p of confirmed) {
    const k = norm(p.text!);
    counts.set(k, { text: p.text!, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  const wrong = new Set(g.items.flatMap((p) => p.wrongTexts.map(norm)));
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  let text = ranked[0]?.text;
  let status: QuestionStatus = text ? (ranked.length > 1 ? "needs_review" : "answered") : "missing_answer";
  let note: string | undefined = ranked.length > 1 ? "Попытки дают разные ответы — проверьте" : undefined;
  if (!text) {
    const guess = g.items.find((p) => p.text && !wrong.has(norm(p.text)));
    if (guess?.text) {
      text = guess.text;
      status = "needs_review";
      note = "Ответ студента без подтверждения баллом — проверьте";
    } else if (wrong.size) note = `Неверный ответ в файле: ${g.items.flatMap((p) => p.wrongTexts)[0]}`;
    else if (!base.stem.includes("___") && g.items.some((p) => isFull(p.inst))) {
      text = base.stem;
      status = "needs_review";
      note = "Поля ввода не видны в файле: ответ вписан в текст вопроса (засчитан полностью) — выделите его";
    }
  }
  return { ...common, options: {}, correctAnswer: null, answerText: text, confidence: confidenceOf(status, 1), status, explanation: note };
}

function mergeStructured(items: Parsed[], base: Parsed): Parsed {
  const merged = { ...base, order: base.order.slice(), pairs: base.pairs.slice() };
  for (const p of items) {
    const taken = new Set<number>();
    p.entries.forEach((e, i) => {
      const j = base.entries.findIndex((b, k) => !taken.has(k) && norm(b.text) === norm(e.text));
      if (j < 0) return;
      taken.add(j);
      if (base.kind === "order" && merged.order[j] === null && p.order[i] !== null) merged.order[j] = p.order[i];
      if (base.kind === "match" && !merged.pairs[j] && p.pairs[i]) merged.pairs[j] = p.pairs[i];
    });
  }
  merged.complete = base.kind === "order" ? merged.order.every((v) => v !== null) : merged.pairs.every((v) => !!v);
  return merged;
}

/**
 * Some printouts draw fill-in answers without their input boxes, so the attempt reads as one
 * plain sentence ("Сонным бугорком называется передний бугорок поперечного отростка С6.").
 * Such a sentence is matched against the blank templates of boxed attempts of the same
 * question; the words in the blanks' places are that attempt's answers.
 */
function adoptUnboxedAttempts(groups: Map<string, Group>) {
  const templates = [...groups.values()].filter((g) => g.first.kind === "text" && g.first.stem.includes("___"));
  if (!templates.length) return;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const patterns = templates.map((t) => {
    const parts = clean(t.first.stem.replace(/[«»]/g, "")).split(/\s*___\s*/);
    return { t, n: parts.length - 1, re: new RegExp(`^${parts.map(esc).join("\\s*(\\S.*?)\\s*")}\\.?$`, "iu") };
  });
  for (const [key, g] of groups) {
    if (g.first.kind !== "text" || g.first.stem.includes("___") || g.items.some((p) => p.complete)) continue;
    const text = clean(g.first.stem);
    const hit = patterns.map((p) => ({ p, m: p.re.exec(text) })).find((x) => x.m && x.m.slice(1).every((v) => v && v.length <= 60));
    if (!hit) continue;
    const values = hit.m!.slice(1).map(clean);
    const target = hit.p.t;
    for (const item of g.items) {
      const full = isFull(item.inst);
      const adopted: Parsed = { ...item, stem: target.first.stem };
      if (hit.p.n === 1) {
        adopted.text = values[0];
        adopted.complete = full;
        if (!full && isZero(item.inst)) {
          adopted.text = null;
          adopted.wrongTexts = [values[0]];
        }
      } else {
        adopted.blanks = values.map((v) => (full ? v : null));
        adopted.blankWrong = values.map(() => []);
        adopted.complete = full;
        adopted.text = full ? fillBlanks(target.first.stem, values) : null;
      }
      target.items.push(adopted);
    }
    groups.delete(key);
  }
}

/**
 * An attempt printed without its picture (cropped page, image not rendered) is the same question as the
 * pictured one with identical text and options — join them when that pictured variant is unambiguous.
 */
function mergePictureless(groups: Map<string, Group>) {
  const textKey = (k: string) => k.slice(0, k.lastIndexOf("|"));
  for (const [key, g] of [...groups]) {
    if (!key.endsWith("|")) continue;
    const twins = [...groups.values()].filter((o) => o !== g && !o.key.endsWith("|") && textKey(o.key) === textKey(key));
    if (twins.length !== 1) continue;
    twins[0].items.push(...g.items);
    groups.delete(key);
  }
}

export interface MoodleReviewResult {
  questions: MCQQuestion[];
  totalFound: number;
  pagesUsed: Set<number>;
}

export function parseMoodleReview(pages: PageInput[], renders: Map<string, FigureRender> = new Map()): MoodleReviewResult | null {
  if (!looksLikeMoodleReview(pages)) return null;
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const instances = readInstances(sorted);
  if (instances.length < 3) return null;
  annotate(instances, sorted);
  attachFigures(instances, sorted);
  const clusterOf = pictureClusters([...renders.values()]);
  const parsed = instances.map(interpret).filter((p) => p.stem || p.options.length);
  const groups = new Map<string, Group>();
  for (const p of parsed) {
    const pics = p.inst.figures.map((f) => renders.get(figureKey(f))).filter((r): r is FigureRender => !!r).map(clusterOf);
    const picture = pics.map((r) => r.imageId).join("+");
    const k = keyOf(p, picture);
    const g = groups.get(k);
    if (g) g.items.push(p);
    else groups.set(k, { key: k, first: p, items: [p], imageId: pics[0]?.imageId });
  }
  adoptUnboxedAttempts(groups);
  mergePictureless(groups);
  const questions = [...groups.values()].map((g, i) => ({ ...resolveGroup(g, i), ...(g.imageId ? { imageId: g.imageId } : {}) }));
  return { questions, totalFound: parsed.length, pagesUsed: new Set(instances.flatMap((q) => q.rows.map((r) => r.page))) };
}

/** Exposed for the audit scripts. */
export const __internals = { solveByScore, readInstances, interpret, annotate, rowsOf, sideColumnCut, attachFigures, parseStructured };
