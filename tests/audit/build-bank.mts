/**
 * Publishes a parsed Moodle bank as a built-in test bank, keeping only questions with a confirmed answer:
 *   npx tsx tests/audit/build-bank.mts parsed.json figDir bankId "Bank title"
 * Writes public/banks/<bankId>.json and copies the referenced pictures to public/banks/img/.
 */
import fs from "node:fs";
import path from "node:path";
import { toStructuredQuestion, type MCQQuestion } from "../../src/types/question";

const [input, figDir, bankId, title] = process.argv.slice(2);
const parsed = JSON.parse(fs.readFileSync(input, "utf8")) as MCQQuestion[];
const outDir = path.resolve("public/banks");
fs.mkdirSync(path.join(outDir, "img"), { recursive: true });

const isStructured = (q: MCQQuestion) => q.tags?.includes("ordering") || q.tags?.includes("matching");
const kept = parsed.filter((q) => {
  if (q.status !== "answered") return false;
  if (isStructured(q)) return !!(q.sequence || q.matching);
  return !!(q.correctAnswer || q.answerText?.trim());
});

const questions = kept.map((q, i) => {
  const sq = toStructuredQuestion({ ...q, number: i + 1, explanation: undefined, id: `${bankId}-${i + 1}` }, `bank-${bankId}`, title);
  const { createdAt: _c, updatedAt: _u, confidence: _f, ...rest } = sq;
  if (sq.imageId) fs.copyFileSync(path.join(figDir, `${sq.imageId}.webp`), path.join(outDir, "img", `${sq.imageId}.webp`));
  return { ...rest, status: "verified" as const };
});

fs.writeFileSync(path.join(outDir, `${bankId}.json`), JSON.stringify({ id: bankId, title, questions }));
const by = (k: string) => questions.filter((q) => q.tags?.includes(k)).length;
console.log({ bankId, input: parsed.length, kept: questions.length, ordering: by("ordering"), matching: by("matching"), figures: questions.filter((q) => q.imageId).length });
