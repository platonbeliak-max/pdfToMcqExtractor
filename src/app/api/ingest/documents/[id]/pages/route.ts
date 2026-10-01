import { NextResponse, type NextRequest } from "next/server";
import { getDocumentRow, savePages } from "@/lib/ingestion/repo";
import type { PageInput } from "@/lib/ingestion/types";

const MAX_PAGES_PER_BATCH = 25;
const MAX_ITEMS_PER_PAGE = 20000;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizePage(raw: unknown): PageInput | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const pageNumber = Number(p.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  const items = Array.isArray(p.items) ? p.items.slice(0, MAX_ITEMS_PER_PAGE) : [];
  const images = Array.isArray(p.images) ? p.images.slice(0, 200) : [];
  return {
    pageNumber,
    width: num(p.width, 595),
    height: num(p.height, 842),
    source: p.source === "OCR" ? "OCR" : "TEXT_LAYER",
    textLayerChars: num(p.textLayerChars),
    ocrConfidence: p.ocrConfidence == null ? undefined : num(p.ocrConfidence),
    readErrors: Array.isArray(p.readErrors) ? p.readErrors.filter((e): e is string => typeof e === "string").slice(0, 20) : undefined,
    items: items
      .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as { str?: unknown }).str === "string")
      .map((i) => ({
        str: String(i.str).slice(0, 2000),
        x: num(i.x),
        y: num(i.y),
        w: num(i.w),
        h: num(i.h),
        ...(typeof i.font === "string" ? { font: i.font.slice(0, 80) } : {}),
        ...(i.conf != null ? { conf: num(i.conf) } : {}),
      })),
    images: images
      .filter((im): im is { bbox: Record<string, unknown> } => !!im && typeof im === "object" && !!(im as { bbox?: unknown }).bbox)
      .map((im) => ({ bbox: { x: num(im.bbox.x), y: num(im.bbox.y), w: num(im.bbox.w), h: num(im.bbox.h) } })),
  };
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await getDocumentRow(id);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { pages?: unknown[] } | null;
  if (!Array.isArray(body?.pages) || body.pages.length === 0 || body.pages.length > MAX_PAGES_PER_BATCH) {
    return NextResponse.json({ error: `Отправляйте от 1 до ${MAX_PAGES_PER_BATCH} страниц за раз` }, { status: 400 });
  }
  const pages = body.pages.map(sanitizePage).filter((p): p is PageInput => !!p && p.pageNumber <= doc.pageCount);
  if (pages.length !== body.pages.length) return NextResponse.json({ error: "Некорректные данные страницы" }, { status: 400 });
  const received = await savePages(id, pages);
  return NextResponse.json({ received, total: doc.pageCount });
}
