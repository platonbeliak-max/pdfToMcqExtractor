/**
 * Runs the site's text engine on PDFs and prints answer coverage.
 *   npx tsx tests/audit/engine-stats.mts a.pdf b.pdf [--dump out.json]
 */
import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { analyzeDocument } from "../../src/lib/ingestion/pipeline";
import { buildQuestions } from "../../src/lib/ingestion/to-mcq";
import type { PageInput } from "../../src/lib/ingestion/types";

const args = process.argv.slice(2);
const dumpAt = args.indexOf("--dump");
const dump = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const pages: PageInput[] = [];
for (const file of args) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const offset = pages.length;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const p = await readPageStructure(pdfjs, page, offset + n, []);
    pages.push(p);
    page.cleanup();
  }
}
const analysis = analyzeDocument(pages, { documentId: "audit" });
const { questions, totalFound } = buildQuestions(analysis.instances);
const by = (f: (q: (typeof questions)[number]) => string) => questions.reduce<Record<string, number>>((a, q) => ((a[f(q)] = (a[f(q)] ?? 0) + 1), a), {});
console.log({ pages: pages.length, instances: totalFound, unique: questions.length, status: by((q) => q.status), kind: by((q) => (Object.keys(q.options).length ? "options" : "text")) });
if (dump) fs.writeFileSync(dump, JSON.stringify(questions, null, 1));
