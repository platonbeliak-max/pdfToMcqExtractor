/**
 * Prints classified layout lines of a PDF (role + text) for debugging the parser.
 *
 *   npx tsx tests/audit/lines.mts file.pdf [fromPage] [toPage] [textFilter]
 */
import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { buildLines, detectRunningNoise } from "../../src/lib/ingestion/layout";
import { classifyLine } from "../../src/lib/ingestion/classify";
import type { PageInput } from "../../src/lib/ingestion/types";

const [file, fromArg, toArg, filter] = process.argv.slice(2);
if (!file) {
  console.error("usage: lines.mts file.pdf [fromPage] [toPage] [textFilter]");
  process.exit(2);
}
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
const pages: PageInput[] = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  pages.push(await readPageStructure(pdfjs, page, n, []));
  page.cleanup();
}
const pageLines = pages.map((p) => ({ page: p, lines: buildLines(p) }));
const runningNoise = detectRunningNoise(pageLines.map((x) => ({ lines: x.lines, height: x.page.height })));
console.log("runningNoise:", [...runningNoise].slice(0, 12));
const from = Number(fromArg) || 1;
const to = Number(toArg) || doc.numPages;
for (const { page, lines } of pageLines) {
  if (page.pageNumber < from || page.pageNumber > to) continue;
  console.log(`\n--- page ${page.pageNumber} (h=${Math.round(page.height)}) ---`);
  for (const l of lines) {
    if (filter && !l.text.includes(filter)) continue;
    const c = classifyLine(l, { runningNoise });
    console.log(`${c.role.padEnd(16)} y=${(l.bbox.y / page.height).toFixed(2)} ${l.text.slice(0, 110)}`);
  }
}
await doc.destroy();
