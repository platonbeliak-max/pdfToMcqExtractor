"use client";

import type { PageInput, RawImageRegion, RawTextItem } from "./types";

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

async function readImages(pdfjs: PdfJs, page: PdfPage, height: number): Promise<RawImageRegion[]> {
  const ops = await page.getOperatorList();
  const { OPS } = pdfjs;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const out: RawImageRegion[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i] as Matrix);
    else if (imageOps.has(fn)) {
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
  return out.slice(0, 200);
}

async function readTextLayer(page: PdfPage, height: number): Promise<RawTextItem[]> {
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string }>;
  const items: RawTextItem[] = [];
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const it = raw as { str: string; transform: number[]; width: number; height: number; fontName?: string };
    if (!it.str) continue;
    const [, , c, d, e, f] = it.transform;
    const fontH = it.height || Math.hypot(c, d) || 10;
    items.push({
      str: it.str,
      x: e,
      y: height - f - fontH,
      w: it.width,
      h: fontH,
      font: it.fontName ? `${it.fontName}${styles[it.fontName]?.fontFamily ? `|${styles[it.fontName].fontFamily}` : ""}` : undefined,
    });
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
        const vp = page.getViewport({ scale: 1 });
        const [text, images] = await Promise.all([
          readTextLayer(page, vp.height).catch((e) => {
            readErrors.push(`text: ${e instanceof Error ? e.message : e}`);
            return [] as RawTextItem[];
          }),
          readImages(pdfjs, page, vp.height).catch((e) => {
            readErrors.push(`images: ${e instanceof Error ? e.message : e}`);
            return [] as RawImageRegion[];
          }),
        ]);
        const textLayerChars = text.reduce((s, i) => s + i.str.replace(/\s/g, "").length, 0);
        result = { pageNumber: n, width: vp.width, height: vp.height, source: "TEXT_LAYER", items: text, images, textLayerChars };
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
