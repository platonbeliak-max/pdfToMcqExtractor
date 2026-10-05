import type { MCQQuestion, StructuredQuestion } from "@/types/question";
import { hasAnswer } from "@/lib/answerable";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Same stem and the same set of options (in any order) means the same question. */
export const questionKey = (stem: string, options: string[]) =>
  `${normalize(stem)}#${options.map(normalize).filter(Boolean).sort().join("|")}`;

const mcqKey = (q: MCQQuestion) => questionKey(q.question, Object.values(q.options ?? {}));
const structuredKey = (q: StructuredQuestion) => questionKey(q.question.text, q.options.map((o) => o.text));

const mcqHasAnswer = (q: MCQQuestion) => !!q.correctAnswer || !!q.answerText?.trim();

/** Collapses repeats inside one extraction, keeping the copy that carries an answer. */
export function dedupeMcq(questions: MCQQuestion[]): MCQQuestion[] {
  const byKey = new Map<string, MCQQuestion>();
  for (const q of questions) {
    const key = mcqKey(q);
    const kept = byKey.get(key);
    if (!kept) byKey.set(key, q);
    else if (!mcqHasAnswer(kept) && mcqHasAnswer(q)) byKey.set(key, { ...q, attempts: (q.attempts ?? 1) + (kept.attempts ?? 1) });
    else byKey.set(key, { ...kept, attempts: (kept.attempts ?? 1) + (q.attempts ?? 1) });
  }
  return [...byKey.values()].map((q, i) => ({ ...q, number: i + 1 }));
}

/**
 * Adds new questions to an existing bank without creating repeats. A repeat that brings an answer
 * the bank copy lacks fills that answer in instead of being dropped.
 */
export function mergeIntoBank(
  bank: StructuredQuestion[],
  incoming: StructuredQuestion[],
): { bank: StructuredQuestion[]; added: number; filled: number } {
  const index = new Map(bank.map((q, i) => [structuredKey(q), i]));
  const next = bank.slice();
  const fresh: StructuredQuestion[] = [];
  let filled = 0;
  for (const q of incoming) {
    const key = structuredKey(q);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, -1 - fresh.length);
      fresh.push(q);
      continue;
    }
    if (at < 0) continue;
    if (!hasAnswer(next[at]) && hasAnswer(q)) {
      next[at] = { ...next[at], answer: q.answer, explanation: q.explanation ?? next[at].explanation, status: q.status };
      filled++;
    }
  }
  return { bank: [...fresh, ...next], added: fresh.length, filled };
}
