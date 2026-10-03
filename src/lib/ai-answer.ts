import type { StructuredQuestion } from "@/types/question";

interface AiAnswerResponse {
  keys: string[];
  answerText: string;
  explanation: string;
  confidence: "high" | "medium" | "low";
  sources: { title: string; url: string }[];
}

export class AiBillingError extends Error {
  constructor() {
    super("AI Gateway billing not set up");
  }
}

export async function lookupAiAnswer(q: StructuredQuestion): Promise<StructuredQuestion> {
  const res = await fetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: q.question.text, options: q.options }),
  });
  if (res.status === 402) throw new AiBillingError();
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
    status: "review",
    updatedAt: new Date().toISOString(),
  };
}

export async function lookupMany(
  targets: StructuredQuestion[],
  onResult: (q: StructuredQuestion) => void,
  onProgress: (done: number, failed: number) => void,
  concurrency = 3
): Promise<void> {
  let next = 0;
  let done = 0;
  let failed = 0;
  let billingError: AiBillingError | null = null;
  const worker = async () => {
    while (next < targets.length && !billingError) {
      const q = targets[next++];
      try {
        onResult(await lookupAiAnswer(q));
      } catch (err) {
        if (err instanceof AiBillingError) billingError = err;
        failed++;
      }
      done++;
      onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  if (billingError) throw billingError;
}
