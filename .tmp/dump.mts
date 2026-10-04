import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const { extractPages } = await import("/vercel/share/v0-project/src/lib/ingestion/client-extract.ts");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
let n=0;
for await (const p of extractPages(doc as any, { ocr: "off" } as any)) { n++; if (n>2) break;
  console.log("=== PAGE", p.pageNumber, p.width, p.height, "imgs", p.images?.length);
  for (const it of p.items.slice(0,90)) console.log(Math.round(it.x), Math.round(it.y), Math.round(it.width), Math.round(it.height), JSON.stringify(it.str), it.fontName??"", it.bold??"", it.color??"");
}
