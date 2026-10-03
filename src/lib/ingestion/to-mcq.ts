import type { ConfidenceLevel, MCQQuestion } from "@/types/question";
import type { CanonicalQuestionDraft, PageInput, QuestionInstance } from "./types";
import { aggregate } from "./canonical";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const SCORE_RE = /(?:^|\s)(?:баллов|баллы|балл|оценка|marks?|points?|score)\s*:?\s*-?\d+(?:[.,]\d+)?(?:\s*(?:из|out\s+of|of|\/)\s*\d+(?:[.,]\d+)?)?/gi;

/** Removes Moodle score fragments ("Балл: 1,00", "Баллов: 1,00 из 1,00") that leak into text. */
export function stripScoreNoise(text: string): string {
  return text.replace(SCORE_RE, " ").replace(/\s{2,}/g, " ").trim();
}

function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "needs-review";
}

function canonicalToMcq(c: CanonicalQuestionDraft, index: number, byId: Map<string, QuestionInstance>): MCQQuestion {
  const options: Record<string, string> = {};
  const keyByCanonicalKey = new Map<string, string>();
  c.options.forEach((o, i) => {
    const key = LETTERS[i] ?? String(i + 1);
    options[key] = stripScoreNoise(o.text);
    keyByCanonicalKey.set(o.key, key);
  });

  const correctKeys = c.correctKeys
    .map((k) => keyByCanonicalKey.get(k))
    .filter((k): k is string => !!k)
    .sort();

  let textual: string | undefined;
  if (c.textAnswer) textual = c.textAnswer;
  else if (c.matching) {
    textual = Object.entries(c.matching)
      .map(([k, v]) => `${options[keyByCanonicalKey.get(k) ?? ""] ?? k} → ${v}`)
      .join("; ");
  } else if (c.correctOrder?.length) {
    textual = c.correctOrder.map((k) => options[keyByCanonicalKey.get(k) ?? ""] ?? k).join(" → ");
  }

  const correctAnswer = correctKeys.length ? correctKeys.join(",") : null;
  const answerText = correctKeys.length ? correctKeys.map((k) => options[k]).join("; ") : textual;
  const hasAnswer = !!correctAnswer || !!textual;
  const conflict = c.conflicts.length > 0;
  const level = confidenceLevel(c.confidence);
  const first = byId.get(c.instanceIds[0]);

  return {
    id: c.key,
    number: index + 1,
    question: stripScoreNoise(c.stem),
    options,
    correctAnswer,
    answerText,
    confidence: !hasAnswer || conflict ? "needs-review" : level,
    status: !hasAnswer ? "missing_answer" : conflict || level === "needs-review" ? "needs_review" : "answered",
    pageNumber: first?.physicalPage,
    explanation: first?.feedback ?? undefined,
    attempts: c.instanceIds.length,
  };
}

export function buildQuestions(all: QuestionInstance[]): { questions: MCQQuestion[]; totalFound: number } {
  const instances = all.filter((i) => i.stem.trim());
  let n = 0;
  const { canonicals } = aggregate(instances, [], () => `q${Date.now().toString(36)}${(n++).toString(36)}`);
  const byId = new Map(instances.map((i) => [i.id, i]));
  const ordered = canonicals
    .slice()
    .sort((a, b) => (byId.get(a.instanceIds[0])?.sequence ?? 0) - (byId.get(b.instanceIds[0])?.sequence ?? 0));
  return { questions: ordered.map((c, i) => canonicalToMcq(c, i, byId)), totalFound: instances.length };
}

/**
 * Runs the universal ingestion engine in the browser, merges repeated
 * questions (many attempts of the same test) into unique ones and pools the
 * answer evidence from every attempt.
 */
export async function extractWithEngine(
  data: ArrayBuffer,
  opts: { ocr?: "auto" | "force" | "off"; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ questions: MCQQuestion[]; pageCount: number; totalFound: number }> {
  const [{ openPdf, extractPages }, { analyzeDocument }] = await Promise.all([import("./client-extract"), import("./pipeline")]);
  const doc = await openPdf(data.slice(0));
  const pages: PageInput[] = [];
  for await (const page of extractPages(doc, { ocr: opts.ocr ?? "auto", ocrLang: "rus+eng" })) {
    pages.push(page);
    opts.onProgress?.(page.pageNumber, doc.numPages);
  }
  await doc.cleanup?.();
  const analysis = analyzeDocument(pages, { documentId: "local" });
  const { questions, totalFound } = buildQuestions(analysis.instances);
  return { questions, pageCount: doc.numPages, totalFound };
}
