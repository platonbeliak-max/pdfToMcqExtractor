import { readFileSync, existsSync } from "node:fs";
import { buildPool, blankAnswers, isRight, type Answer, type TestItem } from "../../src/components/test-view";

const BANKS = process.argv.slice(2).length ? process.argv.slice(2) : ["etest2", "physexam4"];

function perfectAnswer(it: TestItem): Answer {
  const blanks = blankAnswers(it);
  if (blanks) return { picked: [], typed: "", labels: Object.fromEntries(blanks.map((w, i) => [`b${i}`, w])) };
  if (it.sequence) return { picked: [], typed: "", slots: Object.fromEntries(it.options.map((o) => [o.key, String(it.sequence![o.key])])) };
  if (it.matching) return { picked: [], typed: "", slots: Object.fromEntries(it.options.map((o) => [o.key, it.matching!.pairs[o.key]])) };
  if (it.figure) return { picked: [], typed: "", labels: Object.fromEntries(it.options.map((o) => [o.key, o.text])) };
  if (it.correct.length) return { picked: [...it.correct], typed: "" };
  return { picked: [], typed: it.textAnswer.split(/\s+\/\s+/).at(-1)! };
}

function wrongAnswer(it: TestItem): Answer | null {
  if (it.correct.length && !it.figure && !it.sequence && !it.matching) {
    const other = it.options.find((o) => !it.correct.includes(o.key));
    return other ? { picked: [other.key], typed: "" } : null;
  }
  return null;
}

let failed = 0;
for (const id of BANKS) {
  const { questions } = JSON.parse(readFileSync(`public/banks/${id}.json`, "utf8"));
  const { pool, skipped } = buildPool(questions);
  const problems: string[] = [];
  const kinds: Record<string, number> = {};
  for (const it of pool) {
    const kind = blankAnswers(it) ? "blank" : it.sequence ? "sequence" : it.matching ? "matching" : it.figure ? "figure" : it.correct.length > 1 ? "multi" : it.correct.length ? "single" : "text";
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const why: string[] = [];
    if (!it.text.trim()) why.push("empty text");
    if (!isRight(it, perfectAnswer(it))) why.push("correct answer graded wrong");
    const w = wrongAnswer(it);
    if (w && isRight(it, w)) why.push("wrong answer graded right");
    if ((kind === "single" || kind === "multi") && it.options.length < 2) why.push("<2 options");
    if (it.options.some((o) => !o.text.trim())) why.push("empty option");
    if (new Set(it.options.map((o) => o.text.trim().toLowerCase())).size !== it.options.length && !it.figure) why.push("duplicate options");
    if (it.sequence) {
      const nums = Object.values(it.sequence).sort((a, b) => a - b);
      if (nums.length !== it.options.length || nums.some((n, i) => n !== i + 1)) why.push("sequence not 1..n");
    }
    if (it.matching && it.options.some((o) => !it.matching!.choices.includes(it.matching!.pairs[o.key]))) why.push("matching pair not in choices");
    for (const img of [it.imageId, it.figure?.imageId].filter(Boolean)) {
      if (!existsSync(`public/banks/img/${img}.webp`)) why.push(`missing image ${img}`);
    }
    if (kind === "text" && it.textAnswer.length > 80) why.push("long free-text answer");
    if (why.length) problems.push(`${it.id}: ${why.join(", ")} | ${it.text.slice(0, 90)}`);
  }
  failed += problems.length;
  console.log(`\n== ${id}: pool ${pool.length}, skipped ${skipped}, kinds ${JSON.stringify(kinds)}, problems ${problems.length}`);
  for (const p of problems) console.log("  " + p);
}
process.exit(failed ? 1 : 0);
