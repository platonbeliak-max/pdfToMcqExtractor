import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
const [file, pageArg] = process.argv.slice(2);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
const page = await doc.getPage(Number(pageArg));
const p = await readPageStructure(pdfjs, page, Number(pageArg), []);
for (const it of p.items.slice(0, 40)) console.log(Math.round(it.x), Math.round(it.y), JSON.stringify(it.str));
