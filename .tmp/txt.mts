import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
const page = await doc.getPage(1); const vp=page.getViewport({scale:1});
const tc:any = await page.getTextContent();
for (const it of tc.items) if (/вартон|Вортан|Запишите|cartilago|бугорк/i.test(it.str)) console.log(JSON.stringify(it.str), Math.round(it.transform[4]), Math.round(vp.height-it.transform[5]));
