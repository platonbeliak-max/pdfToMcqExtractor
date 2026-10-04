/**
 * Lists every question the pipeline could not resolve, with its score, marks
 * and the resolver's reasons, grouped by cause.
 *
 *   npx tsx tests/audit/missing.mts file.pdf
 */
import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { analyzeDocument } from "../../src/lib/ingestion/pipeline";
import type { PageInput } from "../../src/lib/ingestion/types";

const file = process.argv[2];
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
const pages: PageInput[] = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  pages.push(await readPageStructure(pdfjs, page, n, []));
  page.cleanup();
}
const analysis = analyzeDocument(pages, { documentId: "audit" });
const groups = new Map<string, string[]>();
for (const q of analysis.instances) {
  const a = q.answer as unknown as { status: string; reasons?: string[]; optionIds?: string[] };
  if (a.status === "CONFIRMED_BY_DOCUMENT" || a.status === "CONFIRMED_BY_SCORE") continue;
  const marks = q.visualMarks.map((m) => `${m.type}:${m.associatedOptionId ?? "-"}`).join(" ");
  const key = `${a.status} | score=${q.score?.kind ?? "none"} | type=${q.questionType} | ${(a.reasons ?? []).join("; ")}`;
  const line = `#${q.sequence + 1} p${q.physicalPage} opts=${q.options.length} marks=[${marks}] resp=${q.studentResponse ?? ""} :: ${q.stem.slice(0, 90)}`;
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(line);
}
for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n=== ${list.length} × ${k}`);
  for (const l of list.slice(0, 6)) console.log("  ", l);
}
await doc.destroy();
