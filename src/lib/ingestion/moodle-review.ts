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
const META_RE = /^(?:Тест начат|Состояние|Завершен|Прошло\s*времени|Оценка|Баллы\s+\d|В начало|Мои курсы)/;
const INSTRUCTION_RE = /^Выберите\s+(?:один|одно|несколько)(?=\s)[^:]*(?:ответ|вариант)\S*:?$/iu;
const FEEDBACK_RE = /^⟪?\s*Правильн(?:ый|ые) ответ(?:ы)?\s*:?\s*(.*?)\s*⟫?$/i;
const VERDICT_RE = /^(?:Ваш ответ (?:верный|неправильный|частично правильный)|Отзыв)\.?$/i;
const ANSWER_RE = /^Ответ\s*:?\s*(.*)$/;
const FIELD_RE = /^⟪(.*)⟫$/;
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
      else if (/^Выберите\s/.test(t)) contentX.push(i.x);
    }
  const h = median(headerX);
  const c = median(contentX);
  if (h === null || c === null || c - h < 45) return null;
  return c - 8;
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
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 20 || !/\p{Lu}{7,}/u.test(t)) return false;
  const head = letters.slice(0, 25);
  return head.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / head.length >= 0.6;
}

function markOf(row: Row): Mark {
  const t = row.items.map((i) => i.str).join("");
  if (t.includes(CROSS)) return "incorrect";
  if (t.includes(CHECK)) return "correct";
  return null;
}

const stripGlyphs = (s: string) => clean(s.replace(new RegExp(`[${CHECK}${CROSS}]`, "g"), ""));

function readInstances(pages: PageInput[]): Instance[] {
  const cut = sideColumnCut(pages);
  const out: Instance[] = [];
  let q: Instance | null = null;
  let inHeader = false;
  let section: "stem" | "options" | "feedback" = "stem";
  let optionX = 0;

  for (const page of pages) {
    for (const row of rowsOf(page, cut)) {
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

interface Structured {
  kind: "order" | "match" | "fill" | null;
  stem: Row[];
  entries: Entry[];
  fill?: { text: string; value: string; mark: Mark };
}

/**
 * Matching, ordering and fill-in rows. Moodle prints one ✓/✗ icon after each
 * answered row, so the icons are the row terminators; the row's value is its
 * drop-down field (⟪…⟫) or, for plain tables, the right-hand column.
 */
function parseStructured(q: Instance): Structured {
  const rows = q.body;
  const hasFields = rows.some((r) => r.items.some(isField));
  const hasMarks = rows.some((r) => markOf(r) !== null);
  if (!hasFields && !hasMarks) return { kind: null, stem: rows, entries: [] };

  const firstIdx = rows.findIndex((r) => r.items.some(isField) || markOf(r) !== null);
  const stemX = rows[0]?.x ?? 0;
  let start = firstIdx;
  if (!rows[firstIdx].items.some(isField) || rows[firstIdx].items.length === 1) {
    while (start > 0 && rows[start - 1].x >= stemX + 0.6 && rows[start - 1].page === rows[firstIdx].page && rows[firstIdx].y - rows[start - 1].bottom < 30) start--;
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

  const orderLike = tail.some((r) => r.items.some((i) => ORDER_FIELD_RE.test(i.str.trim())));
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
        if (k === p.correct.size) p.complete = true;
      }
      if (stamps && badSelected) p.complete = true;
    }
    if (p.complete && single) for (let i = 0; i < p.options.length; i++) if (!p.correct.has(i)) p.incorrect.add(i);
    return p;
  }

  const structured = parseStructured(q);
  if (structured.kind === "fill" && structured.fill) {
    const f = structured.fill;
    const p: Parsed = { ...base, kind: "text", stem: f.text };
    const notes = q.notes.map(clean).filter(Boolean);
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
    const stem = clean(structured.stem.map((r) => r.text).join(" "));
    const entries = structured.entries;
    const notes = noteBoxes(q);
    for (const n of notes) {
      const target = entries
        .map((e) => ({ e, d: Math.abs(e.y - n.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (target && target.d < 20) target.e.override = n.text.trim();
    }
    const p: Parsed = { ...base, kind: structured.kind, stem, entries, options: entries.map((e) => e.text) };
    const values = entries.map((e) => e.value);
    let known: (string | null)[] = entries.map((e) => (e.override ? normalizeValue(e.override, structured.kind!) : isFull(q) || e.mark === "correct" ? e.value : null));
    if (!entries.some((e) => e.override)) known = solveRemaining(values, entries, known);
    p.complete = known.every((v) => v !== null && v !== "");
    if (structured.kind === "order") p.order = known.map((v) => (v ? Number(v) : null));
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
  return `${p.kind}|${stem}|${p.options.map(norm).sort().join("¦")}|${picture}`;
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

function attachFigures(instances: Instance[], pages: PageInput[]) {
  const starts = instances.map((q, i) => ({ i, page: q.page, y: q.y }));
  for (const p of pages)
    for (const img of p.images) {
      if (img.bbox.w < 24 || img.bbox.h < 24) continue;
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
    let answerText: string | undefined;
    let complete = best.complete;
    if (base.kind === "order") {
      const order = best.order;
      const rows = best.entries.map((e, i) => ({ text: e.text, n: order[i] }));
      if (rows.some((r) => r.n !== null)) {
        answerText = rows
          .slice()
          .sort((a, b) => (a.n ?? 99) - (b.n ?? 99))
          .map((r) => `${r.n ?? "?"}) ${r.text}`)
          .join("; ");
      }
      complete = complete && new Set(order).size === order.length;
    } else {
      const rows = best.entries.map((e, i) => ({ text: e.text, v: best.pairs[i] }));
      if (rows.some((r) => r.v)) answerText = rows.map((r) => `${r.text} → ${r.v ?? "?"}`).join("; ");
    }
    const status: QuestionStatus = !answerText ? "missing_answer" : complete ? "answered" : "needs_review";
    return {
      ...common,
      options: Object.fromEntries(best.options.map((t, i) => [LETTERS[i] ?? String(i + 1), t])),
      correctAnswer: null,
      answerText,
      confidence: confidenceOf(status, 1),
      status,
      tags: [base.kind === "order" ? "ordering" : "matching"],
      explanation: status === "needs_review" ? "Часть ответа не подтверждена баллом — проверьте" : undefined,
    };
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
  }
  return { ...common, options: {}, correctAnswer: null, answerText: text, confidence: confidenceOf(status, 1), status, explanation: note };
}

function mergeStructured(items: Parsed[], base: Parsed): Parsed {
  const merged = { ...base, order: base.order.slice(), pairs: base.pairs.slice() };
  for (const p of items) {
    p.entries.forEach((e, i) => {
      const j = base.entries.findIndex((b) => norm(b.text) === norm(e.text));
      if (j < 0) return;
      if (base.kind === "order" && merged.order[j] === null && p.order[i] !== null) merged.order[j] = p.order[i];
      if (base.kind === "match" && !merged.pairs[j] && p.pairs[i]) merged.pairs[j] = p.pairs[i];
    });
  }
  merged.complete = base.kind === "order" ? merged.order.every((v) => v !== null) : merged.pairs.every((v) => !!v);
  return merged;
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
  const questions = [...groups.values()].map((g, i) => ({ ...resolveGroup(g, i), ...(g.imageId ? { imageId: g.imageId } : {}) }));
  return { questions, totalFound: parsed.length, pagesUsed: new Set(instances.flatMap((q) => q.rows.map((r) => r.page))) };
}

/** Exposed for the audit scripts. */
export const __internals = { readInstances, interpret, annotate, rowsOf, sideColumnCut, attachFigures };
