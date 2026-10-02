import type { BBox, LayoutLine, PageInput, RawTextItem } from "./types";
import { cleanDisplayText, unionBBox } from "./text";

/** Short "side-box" labels LMSs render in a left column next to the question. */
const SIDE_META_RE =
  /^(?:вопрос|question|задание|питання|frage|pregunta)\s*№?\s*\d{1,4}$|^(?:верно|неверно|частично\s+правильный|частично\s+верно|нет\s+ответа|correct|incorrect|partially\s+correct|not\s+answered|отметить\s+вопрос|flag\s+question|не\s+завершено|выполнен)$|^(?:баллов|балл|баллы|mark|marks|points?)\s*:?\s*[\d.,]+\s*(?:из|out\s+of|of|\/)\s*[\d.,]+$/i;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface WorkingLine {
  items: RawTextItem[];
  yCenter: number;
  height: number;
}

function joinItems(items: RawTextItem[]): { text: string; cells: { text: string; bbox: BBox }[] } {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const hMed = median(sorted.map((i) => i.h)) || 10;
  const cellGap = Math.max(hMed * 2.2, 18);

  const cells: { items: RawTextItem[] }[] = [];
  let current: RawTextItem[] = [];
  let lastRight = -Infinity;

  for (const it of sorted) {
    if (!it.str) continue;
    const gap = it.x - lastRight;
    if (current.length > 0 && gap > cellGap) {
      cells.push({ items: current });
      current = [];
    }
    current.push(it);
    lastRight = Math.max(lastRight, it.x + it.w);
  }
  if (current.length) cells.push({ items: current });

  const cellOut = cells.map((c) => {
    let text = "";
    let prevRight = -Infinity;
    for (const it of c.items) {
      const gap = it.x - prevRight;
      const needsSpace =
        text.length > 0 && !text.endsWith(" ") && !it.str.startsWith(" ") && gap > hMed * 0.15;
      text += (needsSpace ? " " : "") + it.str;
      prevRight = it.x + it.w;
    }
    return {
      text: cleanDisplayText(text),
      bbox: unionBBox(c.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })))!,
    };
  });

  return { text: cleanDisplayText(cellOut.map((c) => c.text).join("  ")), cells: cellOut };
}

/**
 * Groups raw positioned text items into reading-order lines.
 * Items sharing a baseline band become one line; large horizontal gaps
 * become cells (tables, LMS side boxes). LMS side-box labels that share a
 * baseline with question text are split into their own line so that
 * "Вопрос 14" never merges with the stem.
 */
export function buildLines(page: PageInput): LayoutLine[] {
  const items = page.items.filter((i) => i.str && i.str.trim().length > 0);
  if (items.length === 0) return [];

  const hMed = median(items.map((i) => i.h)) || 10;
  const tol = Math.max(hMed * 0.45, 2);

  const sorted = [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const working: WorkingLine[] = [];

  for (const it of sorted) {
    const yc = it.y + it.h / 2;
    const last = working[working.length - 1];
    if (last && Math.abs(last.yCenter - yc) <= tol) {
      last.items.push(it);
      const n = last.items.length;
      last.yCenter = (last.yCenter * (n - 1) + yc) / n;
      last.height = Math.max(last.height, it.h);
    } else {
      working.push({ items: [it], yCenter: yc, height: it.h });
    }
  }

  const out: LayoutLine[] = [];
  const push = (text: string, bbox: BBox, cells: { text: string; bbox: BBox }[], conf: number) => {
    if (!text) return;
    const index = out.length;
    out.push({
      id: `p${page.pageNumber}-l${index}`,
      page: page.pageNumber,
      index,
      text,
      bbox,
      source: page.source,
      conf,
      cells,
    });
  };

  for (const wl of working) {
    const { text, cells } = joinItems(wl.items);
    const confs = wl.items.map((i) => (typeof i.conf === "number" ? i.conf : 1));
    const conf = confs.reduce((a, b) => a + b, 0) / confs.length;
    const bbox = unionBBox(wl.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })))!;

    if (cells.length >= 2 && SIDE_META_RE.test(cells[0].text)) {
      push(cells[0].text, cells[0].bbox, [cells[0]], conf);
      const rest = cells.slice(1);
      push(
        cleanDisplayText(rest.map((c) => c.text).join("  ")),
        unionBBox(rest.map((c) => c.bbox))!,
        rest,
        conf,
      );
      continue;
    }
    push(text, bbox, cells, conf);
  }

  return out;
}

/**
 * Text that repeats at the same vertical band across many pages is running
 * header/footer noise (LMS URL, print date, page counters).
 */
export function detectRunningNoise(pages: { lines: LayoutLine[]; height: number }[]): Set<string> {
  const noise = new Set<string>();
  if (pages.length < 3) return noise;
  const counts = new Map<string, number>();

  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) {
      const band = l.bbox.y / Math.max(p.height, 1);
      if (band > 0.08 && band < 0.92) continue;
      // Question side-boxes ("Вопрос 4", "Выполнен", "Баллов: 1 из 1") often sit at the top
      // of a page; they are structure, not running headers.
      if (SIDE_META_RE.test(l.text.trim())) continue;
      const key = l.text
        .toLowerCase()
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim();
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  for (const [k, c] of counts) if (c >= threshold) noise.add(k);
  return noise;
}

export function noiseKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}
