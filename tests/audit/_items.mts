import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), useSystemFonts: true, verbosity: 0 }).promise;
const page = await doc.getPage(Number(process.argv[3]));
const p = await readPageStructure(pdfjs, page, 1, []);
for (const i of p.items.sort((a,b)=>a.y-b.y||a.x-b.x)) console.log(i.x.toFixed(0), i.y.toFixed(1), i.h.toFixed(1), JSON.stringify(i.str), [...i.str].filter(c=>c.codePointAt(0)!>0xe000&&c.codePointAt(0)!<0xf900).map(c=>c.codePointAt(0)!.toString(16)).join(","), (i.font||"").slice(-25));
const an = await page.getAnnotations(); console.log("ANNOTS", an.filter(a=>a.subtype!=="Link").map(a=>a.subtype+"@"+a.rect.map((v:number)=>v.toFixed(0))).join(" "));
