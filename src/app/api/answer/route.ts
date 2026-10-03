import { gateway, generateText, isStepCount, Output } from "ai";
import { z } from "zod";

export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  options: z
    .array(z.object({ key: z.string().max(4), text: z.string().max(600) }))
    .max(10)
    .default([]),
});

const answerSchema = z.object({
  keys: z
    .array(z.string())
    .describe("Option letters that are correct. Empty array if the question has no options."),
  answerText: z.string().describe("The correct answer in the question's language, short and precise."),
  explanation: z
    .string()
    .describe("1-3 sentences in the question's language explaining why, based on the sources."),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .describe("Medical sources actually used, with real URLs from the search results."),
});

const MEDICAL_DOMAINS = [
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "medscape.com",
  "radiopaedia.org",
  "kenhub.com",
  "teachmeanatomy.info",
  "msdmanuals.com",
  "britannica.com",
  "wikipedia.org",
  "rosmedlib.ru",
  "rmj.ru",
  "cyberleninka.ru",
  "bigenc.ru",
  "medportal.ru",
  "studfile.net",
];

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { question, options } = parsed.data;
  const optionBlock = options.length
    ? options.map((o) => `${o.key}) ${o.text}`).join("\n")
    : "(no options — open answer: give the exact term)";

  try {
    const { output } = await generateText({
      model: "openai/gpt-5-mini",
      tools: {
        search: gateway.tools.perplexitySearch({
          maxResults: 6,
          searchDomainFilter: MEDICAL_DOMAINS.slice(0, 20),
        }),
      },
      stopWhen: isStepCount(5),
      output: Output.object({ schema: answerSchema }),
      system:
        "You are a medical exam assistant (anatomy, physiology, histology, clinical medicine). " +
        "Always search medical sources before answering. Base the answer on what the sources say, " +
        "cite only URLs that appeared in search results, and lower confidence when sources disagree or are missing. " +
        "Answer in the same language as the question.",
      prompt: `Question:\n${question}\n\nOptions:\n${optionBlock}\n\nIf several options can be correct, return all of them.`,
    });

    const validKeys = new Set(options.map((o) => o.key.toUpperCase()));
    const keys = output.keys.map((k) => k.trim().toUpperCase()).filter((k) => validKeys.has(k));
    return Response.json({
      ...output,
      keys,
      sources: output.sources.filter((s) => /^https?:\/\//.test(s.url)).slice(0, 5),
    });
  } catch (err) {
    console.error("[answer] lookup failed:", err);
    const message = err instanceof Error ? err.message : "";
    if (/credit card|billing|insufficient/i.test(message)) {
      return Response.json({ error: "gateway_billing" }, { status: 402 });
    }
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
