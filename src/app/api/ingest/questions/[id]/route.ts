import { NextResponse, type NextRequest } from "next/server";
import { getCanonical, rejectCanonical, updateCanonicalManual, type ManualAnswer } from "@/lib/ingestion/repo";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getCanonical(id);
  if (!detail) return NextResponse.json({ error: "Вопрос не найден" }, { status: 404 });
  return NextResponse.json(detail);
}

const strArr = (v: unknown, max = 30) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((s) => s.slice(0, 40)) : undefined);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (body.action === "reject") {
    await rejectCanonical(id);
    return NextResponse.json({ ok: true });
  }

  const patch: ManualAnswer = {};
  const keys = strArr(body.correctKeys);
  if (keys) patch.correctKeys = keys;
  if (body.correctOrder === null || Array.isArray(body.correctOrder)) patch.correctOrder = body.correctOrder === null ? null : strArr(body.correctOrder)!;
  if (body.matching === null) patch.matching = null;
  else if (body.matching && typeof body.matching === "object") {
    patch.matching = Object.fromEntries(
      Object.entries(body.matching as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .slice(0, 30)
        .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 40)]),
    );
  }
  if (typeof body.textAnswer === "string" || body.textAnswer === null) patch.textAnswer = body.textAnswer === null ? null : body.textAnswer.slice(0, 2000);
  if (typeof body.stem === "string") patch.stem = body.stem.slice(0, 5000);
  if (body.optionTexts && typeof body.optionTexts === "object") {
    patch.optionTexts = Object.fromEntries(
      Object.entries(body.optionTexts as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => [k, String(v).slice(0, 2000)]),
    );
  }
  if (typeof body.questionType === "string") patch.questionType = body.questionType.slice(0, 40);
  if (typeof body.topic === "string" || body.topic === null) patch.topic = body.topic === null ? null : body.topic.slice(0, 200);
  if (body.subjectSlug === null || (typeof body.subjectSlug === "string" && /^[a-z0-9-]{1,40}$/.test(body.subjectSlug))) patch.subjectSlug = body.subjectSlug as string | null;
  if (typeof body.inBank === "boolean") patch.inBank = body.inBank;

  const updated = await updateCanonicalManual(id, patch, body.action === "approve");
  if (!updated) return NextResponse.json({ error: "Вопрос не найден" }, { status: 404 });
  return NextResponse.json({ canonical: updated });
}
