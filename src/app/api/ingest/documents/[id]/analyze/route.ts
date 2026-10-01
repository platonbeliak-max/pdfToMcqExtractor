import { NextResponse, type NextRequest } from "next/server";
import { runAnalysis, setStage } from "@/lib/ingestion/repo";

export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await runAnalysis(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка анализа";
    await setStage(id, "FAILED", "FAILED", message).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
