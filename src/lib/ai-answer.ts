import type { StructuredQuestion } from "@/types/question";

interface AiAnswerResponse {
  keys: string[];
  answerText: string;
  explanation: string;
  confidence: "high" | "medium" | "low";
  mode?: "free" | "ai";
  sources: { title: string; url: string; kind?: "wikipedia" | "pubmed" | "europepmc" }[];
}

export class AiBillingError extends Error {
  constructor() {
    super("AI provider key is missing");
  }
}

export class AiRateLimitError extends Error {
  constructor() {
    super("AI provider rate limit reached");
  }
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestAnswer(q: StructuredQuestion): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q.question.text, options: q.options }),
    });
    if (res.status !== 429) return res;
    if (attempt >= RATE_LIMIT_RETRIES) throw new AiRateLimitError();
    await sleep(RATE_LIMIT_WAIT_MS * (attempt + 1));
  }
}

export async function lookupAiAnswer(q: StructuredQuestion): Promise<StructuredQuestion> {
  const res = await requestAnswer(q);
  if (res.status === 500 && (await res.clone().json().catch(() => null))?.error === "missing_key") {
    throw new AiBillingError();
  }
  if (!res.ok) throw new Error(`lookup failed (${res.status})`);
  const data = (await res.json()) as AiAnswerResponse;

  const key = data.keys.join(",");
  const text =
    data.keys.length > 0
      ? q.options.filter((o) => data.keys.includes(o.key.toUpperCase())).map((o) => o.text).join("; ")
      : data.answerText;
  if (!key && !text.trim()) throw new Error("empty answer");

  return {
    ...q,
    answer: { key, text: text || data.answerText },
    explanation: data.explanation,
    answerOrigin: "ai",
    aiSources: data.sources,
    aiConfidence: data.confidence,
    aiMode: data.mode ?? "ai",
    status: "review",
    updatedAt: new Date().toISOString(),
  };
}

export async function lookupMany(
  targets: StructuredQuestion[],
  onResult: (q: StructuredQuestion) => void,
  onProgress: (done: number, failed: number) => void,
  concurrency = 1
): Promise<void> {
  let next = 0;
  let done = 0;
  let failed = 0;
  let fatalError: AiBillingError | AiRateLimitError | null = null;
  const worker = async () => {
    while (next < targets.length && !fatalError) {
      const q = targets[next++];
      try {
        onResult(await lookupAiAnswer(q));
      } catch (err) {
        if (err instanceof AiBillingError || err instanceof AiRateLimitError) fatalError = err;
        failed++;
      }
      done++;
      onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  if (fatalError) throw fatalError;
}
