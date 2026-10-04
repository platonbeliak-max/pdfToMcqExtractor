/**
 * Prints the raw text of a PDF line by line (as pdf.js sees it), so unknown
 * layouts can be inspected before teaching the parser about them.
 *
 *   npx tsx tests/audit/dump-text.mts file.pdf [maxPages]
 */
import fs from "node:fs";

const [file, maxArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: dump-text.mts file.pdf [maxPages]");
  process.exit(2);
}
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
const limit = Math.min(doc.numPages, Number(maxArg) || doc.numPages);
for (let n = 1; n <= limit; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of content.items as { str: string; transform: number[] }[]) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3;
    (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
  }
  console.log(`\n----- page ${n} / ${doc.numPages} -----`);
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    console.log(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(" "));
  }
  page.cleanup();
}
await doc.destroy();
