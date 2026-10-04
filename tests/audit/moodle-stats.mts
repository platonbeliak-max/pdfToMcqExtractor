/** npx tsx tests/audit/moodle-stats.mts out.json a.pdf [b.pdf …] — runs the Moodle review parser and prints coverage. */
import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { parseMoodleReview } from "../../src/lib/ingestion/moodle-review";
import type { PageInput } from "../../src/lib/ingestion/types";
const [out, ...files] = process.argv.slice(2);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const pages: PageInput[] = [];
for (const file of files) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const offset = pages.length;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(await readPageStructure(pdfjs, page, offset + n, []));
    page.cleanup();
  }
}
if (out.endsWith(".pages.json")) fs.writeFileSync(out, JSON.stringify(pages));
const r = parseMoodleReview(pages);
if (!r) { console.log("NOT MOODLE"); process.exit(0); }
const by = (f: (q: (typeof r.questions)[number]) => string) => r.questions.reduce<Record<string, number>>((a, q) => ((a[f(q)] = (a[f(q)] ?? 0) + 1), a), {});
console.log({ pages: pages.length, instances: r.totalFound, unique: r.questions.length, status: by((q) => q.status), kind: by((q) => q.tags?.[0] ?? (Object.keys(q.options).length ? "choice" : "text")) });
fs.writeFileSync(out.replace(".pages.json", ".json"), JSON.stringify(r.questions, null, 1));
