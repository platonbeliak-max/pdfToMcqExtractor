import { z } from "zod";

export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

const requestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  options: z
    .array(z.object({ key: z.string().max(4), text: z.string().max(600) }))
    .max(10)
    .default([]),
});

interface GroqSearchResult {
  title?: string;
  url?: string;
}

interface GroqResponse {
  choices?: {
    message?: {
      content?: string | null;
      executed_tools?: { search_results?: { results?: GroqSearchResult[] } }[];
    };
  }[];
}

const SYSTEM_PROMPT =
  "You are a medical exam assistant (anatomy, physiology, histology, clinical medicine). " +
  "Search medical sources before answering and base the answer on what they say. " +
  "Answer in the same language as the question. Never call a tool other than the search tool. " +
  "Reply in plain text using exactly these four lines and nothing else:\n" +
  "KEYS: <letters of correct options separated by commas, or - if there are no options>\n" +
  "ANSWER: <the correct answer, short and precise>\n" +
  "EXPLANATION: <1-3 sentences explaining why>\n" +
  "CONFIDENCE: <high|medium|low>";

function stripCitations(text: string): string {
  return text.replace(/【[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
}

function field(text: string, name: string): string {
  const match = text.match(new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.+)$`, "im"));
  return match ? stripCitations(match[1].replace(/\*\*/g, "")) : "";
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "missing_key" }, { status: 500 });
  }

  const { question, options } = parsed.data;
  const optionBlock = options.length
    ? options.map((o) => `${o.key}) ${o.text}`).join("\n")
    : "(no options — open answer: give the exact term)";

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question:\n${question}\n\nOptions:\n${optionBlock}\n\nIf several options can be correct, list all of them.`,
          },
        ],
        tools: [{ type: "browser_search" }],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (res.status === 429) {
      return Response.json({ error: "rate_limit" }, { status: 429 });
    }
    if (!res.ok) {
      console.error("[answer] groq error:", res.status, await res.text().catch(() => ""));
      return Response.json({ error: "Lookup failed" }, { status: 502 });
    }

    const data = (await res.json()) as GroqResponse;
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";

    const validKeys = new Set(options.map((o) => o.key.toUpperCase()));
    const keys = Array.from(
      new Set(
        field(content, "KEYS")
          .toUpperCase()
          .split(/[^A-ZА-Я0-9]+/)
          .filter((k) => validKeys.has(k)),
      ),
    );

    const answerText = field(content, "ANSWER");
    if (!answerText && keys.length === 0) {
      return Response.json({ error: "Lookup failed" }, { status: 502 });
    }

    const confidenceRaw = field(content, "CONFIDENCE").toLowerCase();
    const confidence = ["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "medium";

    const seen = new Set<string>();
    const sources = (message?.executed_tools ?? [])
      .flatMap((t) => t.search_results?.results ?? [])
      .filter((s): s is { title?: string; url: string } => !!s.url && /^https?:\/\//.test(s.url))
      .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
      .slice(0, 5)
      .map((s) => ({ title: s.title || new URL(s.url).hostname, url: s.url }));

    return Response.json({
      keys,
      answerText,
      explanation: field(content, "EXPLANATION"),
      confidence,
      sources,
    });
  } catch (err) {
    console.error("[answer] lookup failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
