import { NextResponse, type NextRequest } from "next/server";
import { createDocument, listDocuments } from "@/lib/ingestion/repo";

export async function GET() {
  const items = await listDocuments();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { filename?: unknown; fileSize?: unknown; pageCount?: unknown; subjectSlug?: unknown } | null;
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const pageCount = Number(body?.pageCount);
  if (!filename || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5000) {
    return NextResponse.json({ error: "Укажите имя файла и количество страниц (1–5000)" }, { status: 400 });
  }
  const fileSize = Number.isFinite(Number(body?.fileSize)) ? Math.round(Number(body?.fileSize)) : null;
  const subjectSlug = typeof body?.subjectSlug === "string" && /^[a-z0-9-]{1,40}$/.test(body.subjectSlug) ? body.subjectSlug : null;
  const id = await createDocument({ filename, fileSize, pageCount, subjectSlug });
  return NextResponse.json({ id });
}
