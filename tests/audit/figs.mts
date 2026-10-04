import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
import { detectFigures } from "../../src/lib/ingestion/figures";
import type { PageInput } from "../../src/lib/ingestion/types";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), useSystemFonts: true, verbosity: 0 }).promise;
const pages: PageInput[] = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  pages.push(await readPageStructure(pdfjs, page, n, []));
  page.cleanup();
}
for (const d of detectFigures(pages)) console.log(`q${d.questionNo} p${d.startPage}-${d.endPage} img${d.imagePage} n=${d.labels.length} score=${d.score ? d.score.got + "/" + d.score.max : "-"} | ${d.labels.map((l) => l.text).join(" / ").slice(0, 150)}`);
