import { StructuredQuestion, answerKeys } from "@/types/question";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?«»"'()]/g, "").trim();

/** Same question re-extracted from another attempt collapses onto one key. */
export function dedupeKey(q: StructuredQuestion): string {
  return norm(q.question.text) + "|" + q.options.map((o) => norm(o.text)).sort().join("|");
}

/** Single source of truth for "can be tested": overview, bank filter and test all use this. */
export function hasAnswer(q: StructuredQuestion): boolean {
  if (q.tags?.includes("unreadable") && !q.isEdited) return false;
  if (q.options.length) return answerKeys(q.answer?.key).some((k) => q.options.some((o) => o.key === k));
  return !!(q.answer?.text || "").trim();
}

export function uniqueQuestions(questions: StructuredQuestion[]): StructuredQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const k = dedupeKey(q);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function answerStats(questions: StructuredQuestion[]) {
  const unique = uniqueQuestions(questions);
  const answered = unique.filter(hasAnswer).length;
  return { unique: unique.length, answered, missing: unique.length - answered };
}
