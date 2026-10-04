import { NextResponse, type NextRequest } from "next/server";
import { del } from "@vercel/blob";
import { deleteDocument, getDocumentDetail } from "@/lib/ingestion/repo";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getDocumentDetail(id);
  if (!detail) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await deleteDocument(id);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (doc.blobUrl) await del(doc.blobUrl).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
