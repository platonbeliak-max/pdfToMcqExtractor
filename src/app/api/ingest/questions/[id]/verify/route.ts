import { NextResponse, type NextRequest } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { canonicalQuestions, verifications } from "@/lib/db/schema";

export const maxDuration = 60;

const MODEL = "openai/gpt-5.4-mini";

const verdictSchema = z.object({
  verdict: z.enum(["AGREES", "DISAGREES", "UNSURE"]),
  suggestedKeys: z.array(z.string()).describe("Option keys the model believes are correct"),
  confidence: z.number().min(0).max(1),
  notes: z.string().describe("Short justification, in Russian"),
});

/**
 * Independent AI check of the document-derived answer. It never overwrites the
 * stored answer: the result is recorded as separate evidence for the reviewer.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [q] = await db.select().from(canonicalQuestions).where(eq(canonicalQuestions.id, id));
  if (!q) return NextResponse.json({ error: "Вопрос не найден" }, { status: 404 });
  if (!q.options.length) return NextResponse.json({ error: "Нет вариантов для проверки" }, { status: 400 });

  const optionsText = q.options.map((o) => `${o.key}) ${o.text}`).join("\n");
  const docAnswer = q.correctKeys.length ? q.correctKeys.join(", ") : "не определён";
  try {
    const { output } = await generateText({
      model: MODEL,
      output: Output.object({ schema: verdictSchema }),
      system:
        "Ты — эксперт-экзаменатор. Проверь правильный ответ на тестовый вопрос по своим знаниям. Не подстраивайся под ответ документа: оцени независимо. Если вопрос неполный или неоднозначный — UNSURE.",
      prompt: `Тип вопроса: ${q.questionType}\nВопрос: ${q.stem}\n\nВарианты:\n${optionsText}\n\nОтвет, извлечённый из документа: ${docAnswer}\n\nВерни ключи правильных вариантов и вердикт относительно ответа документа.`,
    });
    const valid = new Set(q.options.map((o) => o.key));
    const suggestedKeys = output.suggestedKeys.filter((k) => valid.has(k));
    const [row] = await db
      .insert(verifications)
      .values({ canonicalId: id, source: "AI_VERIFICATION", verdict: output.verdict, confidence: output.confidence, suggestedKeys, notes: output.notes.slice(0, 2000), model: MODEL })
      .returning();
    return NextResponse.json({ verification: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка проверки" }, { status: 502 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db.select().from(verifications).where(eq(verifications.canonicalId, id));
  return NextResponse.json({ items: rows });
}
