import { NextResponse, type NextRequest } from "next/server";
import { get } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { attachBlob, getDocumentRow } from "@/lib/ingestion/repo";

/** Client-side direct upload of the original PDF (bypasses the 4.5 MB body limit). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await getDocumentRow(id);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`documents/${id}/`)) throw new Error("Invalid path");
        return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true };
      },
      onUploadCompleted: async ({ blob }) => {
        await attachBlob(id, { url: blob.url, pathname: blob.pathname });
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}

/** Records the blob after a successful client upload (onUploadCompleted does not fire in local previews). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { url?: string; pathname?: string } | null;
  if (!body?.url || !body.pathname?.startsWith(`documents/${id}/`)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  await attachBlob(id, { url: body.url, pathname: body.pathname });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await getDocumentRow(id);
  if (!doc?.blobPathname) return new NextResponse("Not found", { status: 404 });
  const result = await get(doc.blobPathname, { access: "private", ifNoneMatch: req.headers.get("if-none-match") ?? undefined });
  if (!result) return new NextResponse("Not found", { status: 404 });
  if (result.statusCode === 304) return new NextResponse(null, { status: 304, headers: { ETag: result.blob.etag, "Cache-Control": "private, no-cache" } });
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
      ETag: result.blob.etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
