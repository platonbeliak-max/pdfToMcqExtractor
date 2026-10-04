/** Re-runs the parser on cached inputs: npx tsx tests/audit/moodle-cached.mts pages.json figs.json out.json */
import fs from "node:fs";
import { parseMoodleReview } from "../../src/lib/ingestion/moodle-review";
const [inp, figs, out] = process.argv.slice(2);
const renders = new Map(Object.entries(fs.existsSync(figs) ? JSON.parse(fs.readFileSync(figs, "utf8")) : {})) as any;
const r = parseMoodleReview(JSON.parse(fs.readFileSync(inp, "utf8")), renders)!;
const by = (f: (q: (typeof r.questions)[number]) => string) => r.questions.reduce<Record<string, number>>((a, q) => ((a[f(q)] = (a[f(q)] ?? 0) + 1), a), {});
console.log({ instances: r.totalFound, unique: r.questions.length, withImage: r.questions.filter((q) => q.imageId).length, status: by((q) => q.status), kind: by((q) => q.tags?.[0] ?? (Object.keys(q.options).length ? "choice" : "text")) });
fs.writeFileSync(out, JSON.stringify(r.questions, null, 1));
