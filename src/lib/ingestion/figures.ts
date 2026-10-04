import type { BBox, PageInput } from "./types";

/**
 * "Label the picture" questions: a numbered picture followed by a list
 * "1. ⟪…⟫ 2. ⟪…⟫ …" whose blanks hold the student's answers (⟪⟫ marks a
 * filled answer field). The list often continues on the next PDF page, with
 * the LMS info box ("Вопрос 40 … Баллов: 2,79 из 3,00") repeated in between.
 */

export interface FigureLabel {
  n: number;
  text: string;
}

export interface FigureDraft {
  startPage: number;
  endPage: number;
  imagePage: number;
  bbox: BBox | null;
  pageSize: { width: number; height: number };
  labels: FigureLabel[];
  questionNo: number | null;
  score: { got: number; max: number } | null;
  /** True for OCR'd slide screenshots, where the captions are printed on the picture itself. */
  fromOcr?: boolean;
  /** OCR word boxes of the caption text to paint over so the picture doesn't reveal the answers. */
  maskBoxes?: BBox[];
}

interface Tok {
  s: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  field: boolean;
}

const LABEL_NUM_RE = /^(\d{1,2})[.)]$/;
const STOP_RE = /^(?:[□■●○◯▢◻◼◀▶◄►]+|https?:|Отметить|Flag|Информация|Information|Навигация|Navigation|Тест|Начало|Завершен|Затраченное|Оценка|Отзыв|Обучающий|Контролирующий|Перейти|Входной|Итоговый)/i;
const HEADER_RE = /^(?:Вопрос|Question)$/i;

function cleanWord(s: string): string {
  return s.replace(/[⟪⟫]/g, "").replace(/ĸ/g, "к").replace(/\u00a0/g, " ");
}

/** Joins glyph fragments that touch on the same baseline into words, keeping field marks. */
function pageTokens(pg: PageInput): Tok[] {
  const out: Tok[] = [];
  let prev: Tok | null = null;
  let broke = true;
  for (const it of pg.items) {
    if (!it.str || !it.str.trim()) {
      broke = true;
      continue;
    }
    // A lone icon-font glyph is the dropdown arrow Moodle draws inside an answer field.
    const field = /⟪/.test(it.str) || /^[\uE000-\uF8FF\s]+$/.test(it.str);
    const s = cleanWord(it.str);
    if (!s.trim()) continue;
    const h = it.h || 8;
    if (
      prev &&
      !broke &&
      Math.abs(it.y - prev.y) < h * 0.5 &&
      it.x - (prev.x + prev.w) < h * 0.1 &&
      it.x >= prev.x &&
      !LABEL_NUM_RE.test(prev.s) &&
      !/\s/.test(s)
    ) {
      prev.s += s;
      prev.w = it.x + it.w - prev.x;
      prev.field = prev.field || field;
    } else {
      for (const part of s.split(/\s+/).filter(Boolean)) {
        prev = { s: part, page: pg.pageNumber, x: it.x, y: it.y, w: it.w, h, field };
        out.push(prev);
      }
    }
    broke = false;
  }
  return out;
}

function tidyLabel(words: string[]): string {
  const text = words
    .join(" ")
    // Icon-font glyphs (Wingdings/FontAwesome arrows and bullets) sit in the private-use area: invisible, but they break word matching.
    .replace(/[\uE000-\uF8FF\u00AD\u200B-\u200F\u2028\u2029\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\u0138/g, "к")
    .replace(/\u00A0/g, " ")
    .replace(/([а-яё]{3,})([А-ЯЁ][а-яё])/g, "$1 $2")
    .replace(/\s*(?:Вопрос|Question)\s*\d+.*$/i, "")
    .replace(/\s+(?:Баллов|Балл|Marks?|Points?|Отметить|Flag|Оценка)(?![а-яёa-z]).*$/i, "")
    .replace(/\s+(?:Выполнен[оа]?|Complete[d]?|Верно|Неверно|Correct|Incorrect)\s*$/i, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[,;:\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text ? text[0].toLocaleUpperCase("ru") + text.slice(1) : text;
}

function readHeader(toks: Tok[], i: number): { end: number; q: number | null; score: { got: number; max: number } | null } {
  let q: number | null = null;
  let score: { got: number; max: number } | null = null;
  let j = i + 1;
  if (j < toks.length && /^\d+$/.test(toks[j].s)) q = Number(toks[j++].s);
  const limit = Math.min(toks.length, i + 14);
  const nums: number[] = [];
  for (let k = j; k < limit; k++) {
    const m = toks[k].s.match(/(\d+[.,]\d+)/);
    if (m) nums.push(Number(m[1].replace(",", ".")));
    if (/^(?:Баллов|Балл|Marks?|Mark|Points?)/i.test(toks[k].s) || /^(?:Выполнен|Complete|Неверно|Верно|Частично|Correct|Incorrect|Partially|из|out|of|:|\d+[.,]\d+|:\s*\d+[.,]\d+)$/i.test(toks[k].s) || m) {
      j = k + 1;
      if (nums.length >= 2) break;
    } else if (k > j + 1) break;
  }
  if (nums.length >= 2) score = { got: nums[0], max: nums[1] };
  return { end: j, q, score };
}

function findStart(toks: Tok[], i: number): boolean {
  if (!LABEL_NUM_RE.test(toks[i].s) || Number(toks[i].s.match(LABEL_NUM_RE)![1]) !== 1) return false;
  let field = false;
  for (let k = i + 1; k < Math.min(toks.length, i + 60); k++) {
    if (toks[k].field) field = true;
    const m = toks[k].s.match(LABEL_NUM_RE);
    if (m && Number(m[1]) === 2) return field || toks.slice(i + 1, k).some((t) => t.field);
    if (m && Number(m[1]) === 1) return false;
  }
  return false;
}

function nextLabelAt(toks: Tok[], from: number): number | null {
  for (let k = from; k < Math.min(toks.length, from + 25); k++) {
    const m = toks[k].s.match(LABEL_NUM_RE);
    if (m) return Number(m[1]);
    if (HEADER_RE.test(toks[k].s)) return null;
  }
  return null;
}

function pickImage(pages: Map<number, PageInput>, page: number, labelY: number): { page: number; bbox: BBox | null } {
  const area = (b: BBox) => b.w * b.h;
  const big = (pg?: PageInput) => (pg?.images ?? []).map((im) => im.bbox).filter((b) => b.w >= 60 && b.h >= 60);
  const here = big(pages.get(page));
  const above = here.filter((b) => b.y + b.h <= labelY + 40);
  const pool = above.length ? above : here;
  if (pool.length) return { page, bbox: pool.reduce((a, b) => (area(b) > area(a) ? b : a)) };
  const prev = big(pages.get(page - 1));
  if (prev.length) return { page: page - 1, bbox: prev.reduce((a, b) => (area(b) > area(a) ? b : a)) };
  return { page, bbox: null };
}

export function detectFigures(pages: PageInput[]): FigureDraft[] {
  const byNo = new Map(pages.map((p) => [p.pageNumber, p]));
  const toks = pages.filter((p) => p.source !== "OCR").flatMap(pageTokens);
  const figures: FigureDraft[] = [];

  let lastHeader: { q: number | null; score: { got: number; max: number } | null; at: number } = { q: null, score: null, at: -1 };
  for (let i = 0; i < toks.length; i++) {
    if (HEADER_RE.test(toks[i].s)) {
      const h = readHeader(toks, i);
      lastHeader = { q: h.q, score: h.score, at: i };
      continue;
    }
    if (!findStart(toks, i)) continue;

    const start = toks[i];
    const questionNo = i - lastHeader.at < 120 ? lastHeader.q : null;
    let score = i - lastHeader.at < 120 ? lastHeader.score : null;
    const labels: FigureLabel[] = [];
    let cur: { n: number; words: string[] } = { n: 1, words: [] };
    let prevTok = start;
    let j = i + 1;
    for (; j < toks.length; j++) {
      const t = toks[j];
      const m = t.s.match(LABEL_NUM_RE) ?? (t.page === start.page || t.x <= start.x + 15 ? t.s.match(/^(\d{1,2})$/) : null);
      if (m && Number(m[1]) === cur.n + 1 && (LABEL_NUM_RE.test(t.s) || Math.abs(t.x - start.x) <= 15)) {
        labels.push({ n: cur.n, text: tidyLabel(cur.words) });
        cur = { n: cur.n + 1, words: [] };
        prevTok = t;
        continue;
      }
      if (m && LABEL_NUM_RE.test(t.s) && Number(m[1]) === 1) break;
      if (HEADER_RE.test(t.s)) {
        const h = readHeader(toks, j);
        const otherQuestion = h.q !== null && questionNo !== null && h.q !== questionNo;
        // The next question's info box often sits beside the continuation of this list on the following page.
        if (otherQuestion && nextLabelAt(toks, h.end) !== cur.n + 1) break;
        if (h.score && !score && !otherQuestion) score = h.score;
        if (otherQuestion) lastHeader = { q: h.q, score: h.score, at: j };
        j = h.end - 1;
        continue;
      }
      // Field boxes surface as tokens holding only spaces or zero-width characters.
      if (!/[\p{L}\p{N}]/u.test(t.s) && !STOP_RE.test(t.s)) continue;
      if (STOP_RE.test(t.s)) break;
      // Label text always sits to the right of its number; a word back at the left margin starts the next question's stem.
      if (cur.words.length && t.s.trim() && !/^\d{1,2}[.)]?$/.test(t.s.trim()) && t.x < start.x - 1) break;
      // Answer fields are drawn as tall boxes, so consecutive lines of one label can be ~4 text heights apart.
      const sameBlock = t.page !== prevTok.page || t.y - prevTok.y < Math.max(prevTok.h, t.h) * 5.5;
      if (cur.words.length && !sameBlock) break;
      if (cur.words.length >= 9) break;
      cur.words.push(t.s);
      prevTok = t;
    }
    if (cur.words.length) labels.push({ n: cur.n, text: tidyLabel(cur.words) });
    const good = labels.filter((l) => /\p{L}{2,}/u.test(l.text));
    if (good.length >= 2) {
      const img = pickImage(byNo, start.page, start.y);
      const pg = byNo.get(img.page);
      figures.push({
        startPage: start.page,
        endPage: prevTok.page,
        imagePage: img.page,
        bbox: img.bbox,
        pageSize: { width: pg?.width ?? 595, height: pg?.height ?? 842 },
        labels: good,
        questionNo,
        score,
      });
    }
    i = j - 1;
  }
  return figures;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\d]+/gu, "");

/** Hamming distance between two hex perceptual hashes. */
function hashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
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

export interface MergedFigure {
  drafts: number[];
  labels: (FigureLabel & { agreed: boolean })[];
  /** True when an attempt scored full marks or every attempt agreed on every label. */
  trusted: boolean;
  primary: number;
}

/**
 * The same picture appears in many attempts. Attempts are grouped by picture
 * hash (or, without one, by matching labels) and every label takes the answer
 * of a full-score attempt, otherwise the weighted majority across attempts.
 */
export function mergeFigures(drafts: FigureDraft[], hashes: (string | null)[] = []): MergedFigure[] {
  const groups: number[][] = [];
  const similar = (a: number, b: number) => {
    const la = drafts[a].labels;
    const lb = drafts[b].labels;
    const mb = new Map(lb.map((l) => [l.n, norm(l.text)]));
    let common = 0;
    let same = 0;
    for (const l of la) {
      if (!mb.has(l.n)) continue;
      common++;
      if (mb.get(l.n) === norm(l.text)) same++;
    }
    const sizeMatch = Math.abs(la.length - lb.length) <= 1;
    if (sizeMatch && same / Math.max(la.length, lb.length) >= 0.6) return true;
    const ha = hashes[a];
    const hb = hashes[b];
    if (!ha || !hb || hashDistance(ha, hb) > 40) return false;
    // Same picture: partial-score attempts may disagree on many labels, and slide screenshots may reveal different numbers.
    return common === 0 ? drafts[a].fromOcr === drafts[b].fromOcr : same / common >= 0.3;
  };
  drafts.forEach((_, i) => {
    const g = groups.find((grp) => similar(grp[0], i));
    if (g) g.push(i);
    else groups.push([i]);
  });

  return groups.map((grp) => {
    const weight = (i: number) => {
      const s = drafts[i].score;
      return s && s.max > 0 ? Math.max(0.05, s.got / s.max) : 0.5;
    };
    const full = grp.filter((i) => {
      const s = drafts[i].score;
      return s && s.max > 0 && s.got >= s.max - 1e-6;
    });
    const maxN = Math.max(...grp.flatMap((i) => drafts[i].labels.map((l) => l.n)));
    const labels: MergedFigure["labels"] = [];
    let allAgreed = true;
    for (let n = 1; n <= maxN; n++) {
      const votes = new Map<string, { text: string; w: number; full: boolean }>();
      for (const i of grp) {
        const l = drafts[i].labels.find((x) => x.n === n);
        if (!l) continue;
        const k = norm(l.text);
        if (!k) continue;
        const v = votes.get(k) ?? { text: l.text, w: 0, full: false };
        v.w += weight(i);
        v.full = v.full || full.includes(i);
        votes.set(k, v);
      }
      if (!votes.size) continue;
      const ranked = [...votes.values()].sort((a, b) => Number(b.full) - Number(a.full) || b.w - a.w);
      const agreed = votes.size === 1 || ranked[0].full;
      if (!agreed) allAgreed = false;
      labels.push({ n, text: ranked[0].text, agreed });
    }
    const primary = full[0] ?? grp.reduce((a, b) => (weight(b) > weight(a) ? b : a));
    const fromOcr = grp.every((i) => drafts[i].fromOcr);
    // A single partial-score attempt can't tell which labels lost the points.
    const trusted = !fromOcr && (full.length > 0 || (grp.length > 1 && allAgreed));
    return { drafts: grp, labels: labels.map((l) => ({ ...l, agreed: l.agreed && trusted })), trusted, primary };
  });
}

const OCR_PROMPT_RE = /обозначенн\p{L}*\s+на\s+рисунк/iu;
const OCR_WORD_RE = /^[а-яё][а-яё-]{1,}$/i;

/**
 * Slide screenshots (OCR pages) print the captions on the picture: "1 жевательная мышца 2 околоушная железа".
 * Each number followed by Cyrillic words on the same line becomes a label; the words are masked on the picture.
 */
export function detectOcrFigures(pages: PageInput[]): FigureDraft[] {
  const out: FigureDraft[] = [];
  for (const pg of pages) {
    if (pg.source !== "OCR") continue;
    const text = pg.items.map((i) => i.str).join(" ");
    if (!OCR_PROMPT_RE.test(text)) continue;
    const words = pg.items
      .filter((i) => i.str.trim())
      .map((i) => ({ s: i.str.trim().replace(/[.,;:)]+$/, ""), x: i.x, y: i.y, w: i.w, h: i.h || 10, conf: i.conf ?? 1 }));
    const lines: (typeof words)[] = [];
    for (const w of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l[0].y - w.y) < Math.max(l[0].h, w.h) * 0.6);
      if (line) line.push(w);
      else lines.push([w]);
    }
    const labels = new Map<number, { text: string; boxes: BBox[] }>();
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      for (let k = 0; k < line.length; k++) {
        const num = line[k].s.match(/^(\d{1,2})$/);
        if (!num) continue;
        const n = Number(num[1]);
        const parts: typeof words = [];
        for (let m = k + 1; m < line.length && parts.length < 5; m++) {
          const w = line[m];
          if (/^\d/.test(w.s) || !OCR_WORD_RE.test(w.s) || w.conf < 0.45) break;
          if (parts.length && w.x - (parts[parts.length - 1].x + parts[parts.length - 1].w) > w.h * 2.5) break;
          parts.push(w);
        }
        const label = parts.map((p) => p.s.toLowerCase()).join(" ");
        if (parts.length && label.replace(/[^а-яё]/gi, "").length >= 5 && !labels.has(n)) {
          labels.set(n, { text: tidyLabel([label]), boxes: [line[k], ...parts].map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })) });
        }
      }
    }
    if (labels.size < 2) continue;
    const sorted = [...labels.entries()].sort((a, b) => a[0] - b[0]);
    out.push({
      startPage: pg.pageNumber,
      endPage: pg.pageNumber,
      imagePage: pg.pageNumber,
      bbox: null,
      pageSize: { width: pg.width, height: pg.height },
      labels: sorted.map(([n, l]) => ({ n, text: l.text })),
      questionNo: null,
      score: null,
      fromOcr: true,
      maskBoxes: sorted.flatMap(([, l]) => l.boxes),
    });
  }
  return out;
}

/**
 * The text parser also sees a figure's label list and turns it into broken
 * "questions" ("1. вена 2. артерия 3."). Returns a predicate that flags those.
 */
export function figureNoise(drafts: FigureDraft[]): (q: { question: string; options: Record<string, string>; pageNumber?: number }) => boolean {
  const pages = new Set<number>();
  const vocab = new Set<string>();
  for (const d of drafts) {
    for (let p = d.startPage; p <= d.endPage; p++) pages.add(p);
    pages.add(d.imagePage);
    // The question header ("Вопрос N / Баллов …") often sits on the page before its figure.
    if (d.startPage > 1) pages.add(d.startPage - 1);
    for (const l of d.labels) for (const w of l.text.toLowerCase().split(/[^\p{L}]+/u)) if (w.length >= 4) vocab.add(w.replace(/ё/g, "е"));
  }
  return (q) => {
    if (!q.pageNumber || !pages.has(q.pageNumber)) return false;
    const text = q.question;
    if (OCR_PROMPT_RE.test(text)) return true;
    if ((text.match(/(?:^|\s)\d{1,2}[.)]\s/g) ?? []).length >= 2) return true;
    // A stem cut off at a bare list number ("…отверстие рта 1.") is a label list read as a question.
    if (/(?:^|\s)\d{1,2}[.)]?\s*$/.test(text) && /^[^?]*\p{L}/u.test(text)) return true;
    const numberedOptions = Object.values(q.options).filter((o) => /\s\d{1,2}[.)]\s/.test(o)).length;
    if (numberedOptions >= 1 && Object.keys(q.options).length >= 2 && /^(?:Назовите|Укажите|Подпишите|Обозначьте|Определите)/i.test(text)) return true;
    const words = text.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
    if (!words.length) return true;
    return words.filter((w) => vocab.has(w)).length / words.length >= 0.6;
  };
}

export const FIGURE_TAG = "figure";
export const FIGURE_PROMPT = "Назовите структуры, обозначенные на рисунке";
