"use client";

import type { PageAnnotation, PageInput, RawImageRegion, RawTextItem } from "./types";

/**
 * Reads a PDF in the browser and yields one raw PageInput per page: text items
 * with geometry (top-left origin, PDF points), image regions, and an OCR
 * fallback for pages whose text layer is empty. No question parsing happens
 * here — that is the server engine's job.
 */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDoc["getPage"]>>;
type TessWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

const MIN_TEXT_LAYER_CHARS = 25;

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Served from /public (copied from pdfjs-dist) so it always matches the installed version and needs no CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stroke-only paths are usually ink annotations, not form controls. */
  filled: boolean;
}

/**
 * Bounds from the path's own coordinates. pdf.js's precomputed minMax is
 * [0,0,0,0] for curve-only paths (radio-button circles), so it can't be trusted.
 */
function pathBounds(OPS: PdfJs["OPS"], args: unknown[]): [number, number, number, number] | null {
  const opList = args[0] as ArrayLike<number> | undefined;
  const coords = args[1] as ArrayLike<number> | undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  if (opList && coords) {
    let j = 0;
    for (let k = 0; k < opList.length; k++) {
      const op = opList[k];
      if (op === OPS.rectangle) {
        add(coords[j], coords[j + 1]);
        add(coords[j] + coords[j + 2], coords[j + 1] + coords[j + 3]);
        j += 4;
      } else if (op === OPS.curveTo) {
        for (let p = 0; p < 6; p += 2) add(coords[j + p], coords[j + p + 1]);
        j += 6;
      } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
        add(coords[j], coords[j + 1]);
        add(coords[j + 2], coords[j + 3]);
        j += 4;
      } else if (op === OPS.moveTo || op === OPS.lineTo) {
        add(coords[j], coords[j + 1]);
        j += 2;
      }
    }
  }
  const mm = args[2] as ArrayLike<number> | null | undefined;
  if (mm && mm.length >= 4 && (mm[2] - mm[0] > 0 || mm[3] - mm[1] > 0)) {
    add(mm[0], mm[1]);
    add(mm[2], mm[3]);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/**
 * Small square vector shapes are LMS checkboxes / radio buttons (Moodle prints
 * them as paths, not glyphs). A control with a smaller filled shape inside is
 * "selected". Each control becomes a synthetic bullet glyph ("■" selected,
 * "□" empty) so the text engine can attach it to the option on that row.
 */
function controlsToItems(shapes: Shape[], text: RawTextItem[]): RawTextItem[] {
  const square = (s: Shape) => s.w >= 4 && s.w <= 14 && s.h >= 4 && s.h <= 14 && s.w / s.h > 0.7 && s.w / s.h < 1.4;
  const candidates = shapes.filter((s) => s.filled && square(s));
  const outers: Shape[] = [];
  for (const s of [...candidates].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const dup = outers.some((o) => Math.abs(o.x - s.x) < 0.8 && Math.abs(o.y - s.y) < 0.8 && Math.abs(o.w - s.w) < 0.8);
    const inside = outers.some((o) => s.w < o.w * 0.8 && s.x >= o.x - 0.5 && s.y >= o.y - 0.5 && s.x + s.w <= o.x + o.w + 0.5 && s.y + s.h <= o.y + o.h + 0.5);
    if (!dup && !inside) outers.push(s);
  }
  const items: RawTextItem[] = [];
  for (const o of outers) {
    const cy = o.y + o.h / 2;
    const hasLabel = text.some((t) => t.x > o.x + o.w - 1 && t.x - (o.x + o.w) < 30 && t.y <= cy && t.y + t.h >= cy);
    if (!hasLabel) continue;
    // Selected = a smaller mark inside the box: a filled dot/square, or (Chrome
    // print of Moodle 4) a check tick drawn as a stroked polyline.
    const filled = shapes.some(
      (s) => s !== o && s.w <= o.w * 0.8 && s.w >= o.w * 0.25 && s.x >= o.x - 0.5 && s.y >= o.y - 0.5 && s.x + s.w <= o.x + o.w + 0.5 && s.y + s.h <= o.y + o.h + 0.5,
    );
    // Align the glyph with the row's text baseline so layout puts it on the option line.
    const row = text.find((t) => t.x > o.x && t.x - (o.x + o.w) < 30 && t.y <= cy && t.y + t.h >= cy);
    items.push({ str: filled ? "■" : "□", x: o.x, y: row ? row.y : o.y, w: o.w, h: row ? row.h : o.h });
  }
  return items;
}

/**
 * Moodle prints short-answer inputs as a standalone filled box with the typed
 * text inside. Table cells (attempt summary) are rejected because they abut
 * neighbouring boxes. Text inside a field is wrapped in ⟪…⟫ so the engine can
 * separate the student's response from the question stem.
 */
function markAnswerFields(shapes: Shape[], text: RawTextItem[]): RawTextItem[] {
  const boxes = shapes.filter((s) => s.filled && s.h >= 10 && s.h <= 44 && s.w >= 30 && s.w <= 460);
  const same = (a: Shape, b: Shape) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.w - b.w) < 3;
  const abuts = (a: Shape, b: Shape) =>
    !same(a, b) &&
    Math.abs(a.y - b.y) < 2 &&
    (Math.abs(a.x + a.w - b.x) < 2 || Math.abs(b.x + b.w - a.x) < 2 || (Math.abs(a.x - b.x) < 2 && Math.abs(a.y + a.h - b.y) < 2));
  const stacked = (a: Shape, b: Shape) => !same(a, b) && Math.abs(a.x - b.x) < 2 && (Math.abs(a.y + a.h - b.y) < 2 || Math.abs(b.y + b.h - a.y) < 2);
  const fields = boxes.filter((b) => !boxes.some((o) => abuts(b, o) || stacked(b, o)));
  if (!fields.length) return text;
  return text.map((t) => {
    const cx = t.x + Math.max(t.w, 1) / 2;
    const cy = t.y + t.h / 2;
    const inField = fields.some((f) => cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h && t.w <= f.w + 2);
    return inField && t.str.trim() ? { ...t, str: `⟪${t.str}⟫` } : t;
  });
}

async function readGraphics(pdfjs: PdfJs, page: PdfPage, height: number): Promise<{ images: RawImageRegion[]; shapes: Shape[] }> {
  const ops = await page.getOperatorList();
  const { OPS } = pdfjs;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
  const paintOps = new Set(
    [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.stroke, OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((x) => x != null),
  );
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const out: RawImageRegion[] = [];
  const shapes: Shape[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i] as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = (ops.argsArray[i] as unknown[])?.[0] as Matrix | null;
      if (m && m.length === 6) ctm = mul(ctm, m);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      if (!paintOps.has(ops.fnArray[i + 1])) continue;
      if (shapes.length > 4000) continue;
      const local = pathBounds(OPS, ops.argsArray[i] as unknown[]);
      if (!local) continue;
      const corners = [
        [local[0], local[1]],
        [local[2], local[1]],
        [local[0], local[3]],
        [local[2], local[3]],
      ];
      const px = corners.map(([x, y]) => ctm[0] * x + ctm[2] * y + ctm[4]);
      const py = corners.map(([x, y]) => ctm[1] * x + ctm[3] * y + ctm[5]);
      const w = Math.max(...px) - Math.min(...px);
      const h = Math.max(...py) - Math.min(...py);
      const filled = ops.fnArray[i + 1] !== OPS.stroke && ops.fnArray[i + 1] !== OPS.closeStroke;
      if ((w <= 20 && h <= 20) || (filled && h >= 10 && h <= 32 && w >= 30 && w <= 460)) shapes.push({ x: Math.min(...px), y: height - Math.max(...py), w, h, filled });
    } else if (imageOps.has(fn)) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      const x = Math.min(...xs);
      const w = Math.max(...xs) - x;
      const yTop = height - Math.max(...ys);
      const h = Math.max(...ys) - Math.min(...ys);
      // Ignore hairlines / tiny glyph images (checkbox ticks are handled as marks by layout).
      if (w >= 12 && h >= 12) out.push({ bbox: { x, y: yTop, w, h } });
    }
  }
  return { images: out.slice(0, 200), shapes };
}

async function readTextLayer(page: PdfPage, height: number): Promise<RawTextItem[]> {
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const items: RawTextItem[] = [];
  // Letter-spaced fonts arrive as one item per glyph ("Тес","т"," ","н","а"…).
  // Glyphs that touch on the same baseline belong to one word; explicit space
  // items mark the real word boundaries, so they block merging.
  let last: { item: RawTextItem; end: number; base: number } | null = null;
  let afterSpace = false;
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const it = raw as { str: string; transform: number[]; width: number; height: number; fontName?: string };
    if (!it.str) continue;
    if (!it.str.trim()) {
      afterSpace = true;
      continue;
    }
    const [, , c, d, e, f] = it.transform;
    const fontH = it.height || Math.hypot(c, d) || 10;
    if (last && !afterSpace && Math.abs(last.base - f) < 0.5 && Math.abs(e - last.end) <= Math.max(0.6, fontH * 0.12)) {
      last.item.str += it.str;
      last.item.w = e + it.width - last.item.x;
      last.end = e + it.width;
      continue;
    }
    afterSpace = false;
    const item: RawTextItem = {
      str: it.str,
      x: e,
      y: height - f - fontH,
      w: it.width,
      h: fontH,
      font: it.fontName ? `${it.fontName}${styles[it.fontName]?.fontFamily ? `|${styles[it.fontName].fontFamily}` : ""}` : undefined,
    };
    last = { item, end: e + it.width, base: f };
    items.push(item);
  }
  return items;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

async function readOcr(page: PdfPage, worker: TessWorker, scale = 2): Promise<{ items: RawTextItem[]; confidence: number }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<PdfPage["render"]>[0]).promise;
  const res = await worker.recognize(canvas, {}, { blocks: true });
  const words: TessWord[] = [];
  for (const b of res.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push(w as TessWord);
  canvas.width = canvas.height = 0;
  const items = words
    .filter((w) => w.text.trim())
    .map((w) => ({
      str: w.text,
      x: w.bbox.x0 / scale,
      y: w.bbox.y0 / scale,
      w: (w.bbox.x1 - w.bbox.x0) / scale,
      h: (w.bbox.y1 - w.bbox.y0) / scale,
      conf: Math.max(0, Math.min(1, w.confidence / 100)),
    }));
  const confidence = items.length ? items.reduce((s, i) => s + (i.conf ?? 0), 0) / items.length : 0;
  return { items, confidence };
}

/** 16×16 average hash (64 hex chars): near-identical pictures from different attempts land within a small Hamming distance. */
function averageHash(source: HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, 16, 16);
  const px = ctx.getImageData(0, 0, 16, 16).data;
  const gray: number[] = [];
  for (let i = 0; i < px.length; i += 4) gray.push(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  let hex = "";
  for (let i = 0; i < gray.length; i += 4) {
    let nib = 0;
    for (let k = 0; k < 4; k++) nib = (nib << 1) | (gray[i + k] > avg ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

/** 32×32 grayscale at 16 levels (1024 hex chars): tells apart near-identical pictures (e.g. agglutination plates) that share an average hash. */
function fineFingerprint(source: HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let out = "";
  for (let i = 0; i < px.length; i += 4) out += Math.min(15, Math.floor((px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 16)).toString(16);
  return out;
}

/**
 * Renders part of a page (PDF points, top-left origin) to a JPEG. `masks`
 * are painted over first so captions printed on slides don't give answers away.
 */
export async function renderRegion(
  doc: PdfDoc,
  pageNumber: number,
  bbox: { x: number; y: number; w: number; h: number } | null,
  masks: { x: number; y: number; w: number; h: number }[] = [],
  maxWidth = 1000,
): Promise<{ blob: Blob; hash: string; fine: string } | null> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const region = bbox ?? { x: 0, y: 0, w: base.width, h: base.height };
    const scale = Math.min(4, Math.max(1, maxWidth / Math.max(1, region.w)));
    const viewport = page.getViewport({ scale });
    const full = document.createElement("canvas");
    full.width = Math.ceil(viewport.width);
    full.height = Math.ceil(viewport.height);
    const ctx = full.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvas: full, canvasContext: ctx, viewport } as Parameters<PdfPage["render"]>[0]).promise;
    ctx.fillStyle = "#ffffff";
    for (const m of masks) {
      const pad = 2;
      ctx.fillRect((m.x - pad) * scale, (m.y - pad) * scale, (m.w + pad * 2) * scale, (m.h + pad * 2) * scale);
    }
    const sx = Math.max(0, Math.floor(region.x * scale));
    const sy = Math.max(0, Math.floor(region.y * scale));
    const sw = Math.min(full.width - sx, Math.ceil(region.w * scale));
    const sh = Math.min(full.height - sy, Math.ceil(region.h * scale));
    if (sw < 8 || sh < 8) return null;
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    crop.getContext("2d")?.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    full.width = full.height = 0;
    const hash = averageHash(crop);
    const fine = fineFingerprint(crop);
    const blob = await new Promise<Blob | null>((r) => crop.toBlob(r, "image/jpeg", 0.85));
    crop.width = crop.height = 0;
    return blob ? { blob, hash, fine } : null;
  } finally {
    page.cleanup();
  }
}

/**
 * Text layer + vector controls + image regions of one page, without OCR. Shared by the
 * browser extractor and the Node audit script so both see identical page inputs.
 */
export async function readPageStructure(pdfjs: PdfJs, page: PdfPage, pageNumber: number, readErrors: string[]): Promise<PageInput> {
  const vp = page.getViewport({ scale: 1 });
  const [text, graphics] = await Promise.all([
    readTextLayer(page, vp.height).catch((e) => {
      readErrors.push(`text: ${e instanceof Error ? e.message : e}`);
      return [] as RawTextItem[];
    }),
    readGraphics(pdfjs, page, vp.height).catch((e) => {
      readErrors.push(`images: ${e instanceof Error ? e.message : e}`);
      return { images: [] as RawImageRegion[], shapes: [] as Shape[] };
    }),
  ]);
  const textLayerChars = text.reduce((s, i) => s + i.str.replace(/\s/g, "").length, 0);
  let controls: RawTextItem[] = [];
  try {
    controls = controlsToItems(graphics.shapes, text);
  } catch (e) {
    readErrors.push(`controls: ${e instanceof Error ? e.message : e}`);
  }
  let marked = text;
  try {
    marked = markAnswerFields(graphics.shapes, text);
  } catch (e) {
    readErrors.push(`fields: ${e instanceof Error ? e.message : e}`);
  }
  const annotations = await readAnnotations(page, vp.height).catch((e) => {
    readErrors.push(`annotations: ${e instanceof Error ? e.message : e}`);
    return [] as PageAnnotation[];
  });
  return { pageNumber, width: vp.width, height: vp.height, source: "TEXT_LAYER", items: [...controls, ...marked], images: graphics.images, textLayerChars, annotations };
}

const ANNOTATION_KINDS: Record<string, PageAnnotation["kind"]> = { Stamp: "STAMP", FreeText: "FREETEXT", Ink: "INK", Square: "SQUARE" };

async function readAnnotations(page: PdfPage, height: number): Promise<PageAnnotation[]> {
  const raw = (await page.getAnnotations()) as { subtype?: string; rect?: number[]; contentsObj?: { str?: string }; contents?: string }[];
  const out: PageAnnotation[] = [];
  for (const a of raw) {
    if (!a.subtype || a.subtype === "Link" || a.subtype === "Widget" || !a.rect) continue;
    const [x1, y1, x2, y2] = a.rect;
    if (x2 - x1 < 1 && y2 - y1 < 1) continue;
    out.push({
      kind: ANNOTATION_KINDS[a.subtype] ?? "OTHER",
      bbox: { x: x1, y: height - y2, w: x2 - x1, h: y2 - y1 },
      text: (a.contentsObj?.str ?? a.contents ?? "").trim(),
    });
  }
  return out;
}

export interface ExtractOptions {
  ocrLang?: string;
  /** "auto" runs OCR only on pages with an empty text layer. */
  ocr?: "auto" | "force" | "off";
  signal?: AbortSignal;
  onPage?: (page: PageInput, done: number, total: number) => void;
}

export async function* extractPages(doc: PdfDoc, opts: ExtractOptions = {}): AsyncGenerator<PageInput> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const mode = opts.ocr ?? "auto";
  let worker: TessWorker | null = null;
  const getWorker = async () => {
    if (!worker) {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker(opts.ocrLang ?? "rus+eng");
    }
    return worker;
  };
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const readErrors: string[] = [];
      let page: PdfPage | null = null;
      let result: PageInput;
      try {
        page = await doc.getPage(n);
        result = await readPageStructure(pdfjs, page, n, readErrors);
        const textLayerChars = result.textLayerChars ?? 0;
        if (mode === "force" || (mode === "auto" && textLayerChars < MIN_TEXT_LAYER_CHARS)) {
          try {
            const ocr = await readOcr(page, await getWorker());
            if (ocr.items.length) result = { ...result, source: "OCR", items: ocr.items, ocrConfidence: ocr.confidence };
          } catch (e) {
            readErrors.push(`ocr: ${e instanceof Error ? e.message : e}`);
          }
        }
      } catch (e) {
        readErrors.push(`page: ${e instanceof Error ? e.message : e}`);
        result = { pageNumber: n, width: 595, height: 842, source: "TEXT_LAYER", items: [], images: [], textLayerChars: 0 };
      } finally {
        page?.cleanup();
      }
      if (readErrors.length) result.readErrors = readErrors;
      opts.onPage?.(result, n, doc.numPages);
      yield result;
    }
  } finally {
    if (worker) await (worker as TessWorker).terminate();
  }
}
