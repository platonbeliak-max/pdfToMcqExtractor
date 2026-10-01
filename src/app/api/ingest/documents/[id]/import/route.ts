import { NextResponse, type NextRequest } from "next/server";
import { importDocument, setStage } from "@/lib/ingestion/repo";

export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { subjectSlug?: unknown };
  const subjectSlug =
    body.subjectSlug === null ? null : typeof body.subjectSlug === "string" && /^[a-z0-9-]{1,40}$/.test(body.subjectSlug) ? body.subjectSlug : undefined;
  try {
    const result = await importDocument(id, { subjectSlug });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка импорта";
    await setStage(id, "FAILED", "FAILED", message).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
