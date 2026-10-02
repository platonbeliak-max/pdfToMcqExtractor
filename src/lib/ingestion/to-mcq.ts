import type { ConfidenceLevel, MCQQuestion } from "@/types/question";
import type { PageInput, QuestionInstance } from "./types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "needs-review";
}

function toMcq(inst: QuestionInstance, index: number): MCQQuestion {
  const options: Record<string, string> = {};
  const keyById = new Map<string, string>();
  inst.options.forEach((o, i) => {
    const key = LETTERS[i] ?? String(i + 1);
    options[key] = o.text;
    keyById.set(o.id, key);
  });

  const correctKeys = inst.answer.correctOptionIds.map((id) => keyById.get(id)).filter((k): k is string => !!k);
  const correctAnswer = correctKeys.length ? correctKeys.join(",") : null;
  const answerText = correctKeys.length ? correctKeys.map((k) => options[k]).join("; ") : inst.answer.textAnswer ?? undefined;
  const hasAnswer = !!correctAnswer || !!inst.answer.textAnswer;
  const level = confidenceLevel(Math.min(inst.answer.confidence || 0, inst.questionTypeConfidence || 1));

  return {
    id: inst.id,
    number: inst.questionNumber ?? index + 1,
    question: inst.stem,
    options,
    correctAnswer,
    answerText,
    confidence: hasAnswer ? level : "needs-review",
    status: !hasAnswer ? "missing_answer" : level === "needs-review" ? "needs_review" : "answered",
    pageNumber: inst.physicalPage,
    explanation: inst.feedback ?? undefined,
  };
}

/**
 * Runs the universal ingestion engine fully in the browser and maps its
 * question instances to the legacy MCQ model. Used when the legacy parser
 * finds nothing (Moodle/LMS exports, Cyrillic tests, multi-attempt files).
 */
export async function extractWithEngine(
  data: ArrayBuffer,
  opts: { ocr?: "auto" | "force" | "off"; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ questions: MCQQuestion[]; pageCount: number }> {
  const [{ openPdf, extractPages }, { analyzeDocument }] = await Promise.all([import("./client-extract"), import("./pipeline")]);
  const doc = await openPdf(data.slice(0));
  const pages: PageInput[] = [];
  for await (const page of extractPages(doc, { ocr: opts.ocr ?? "auto", ocrLang: "rus+eng" })) {
    pages.push(page);
    opts.onProgress?.(page.pageNumber, doc.numPages);
  }
  await doc.cleanup?.();
  const analysis = analyzeDocument(pages, { documentId: "local" });
  return {
    questions: analysis.instances.filter((i) => i.stem.trim()).map(toMcq),
    pageCount: doc.numPages,
  };
}
