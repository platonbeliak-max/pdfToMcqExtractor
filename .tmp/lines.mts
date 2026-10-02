import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const { extractPages } = await import("/vercel/share/v0-project/src/lib/ingestion/client-extract.ts");
const L:any = await import("/vercel/share/v0-project/src/lib/ingestion/layout.ts");
const C:any = await import("/vercel/share/v0-project/src/lib/ingestion/classify.ts");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
const from = Number(process.argv[2]||1), to = Number(process.argv[3]||2);
let n=0;
for await (const p of extractPages(doc as any, { ocr: "off" } as any)) { n++; if (n<from) continue; if (n>to) break;
  const lines = L.buildLines(p);
  const cl = C.classifyLine ? lines.map((l:any)=>C.classifyLine(l,{runningNoise:new Set()})) : (C.classifyLines?.(lines) ?? lines);
  console.log("=== PAGE", n);
  for (const l of cl) console.log(Math.round(l.bbox.y), Math.round(l.bbox.x), l.role??"", JSON.stringify(l.text).slice(0,110));
}
