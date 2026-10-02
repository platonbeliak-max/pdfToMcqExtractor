import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const { extractPages } = await import("/vercel/share/v0-project/src/lib/ingestion/client-extract.ts");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
let n=0;
for await (const p of extractPages(doc as any, { ocr: "off" } as any)) { const it=(p as any).items.filter((i:any)=>/⟪|вартон|cartilago|С6|C6/.test(i.str)); console.log(p.pageNumber, JSON.stringify(it.map((i:any)=>[i.str,Math.round(i.x),Math.round(i.y),Math.round(i.w),Math.round(i.h)]))); if(++n>=6) break; }
