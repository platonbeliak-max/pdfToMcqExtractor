import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
const [file, ...nums] = process.argv.slice(2);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
for (const n of nums) { const page = await doc.getPage(+n); const vp = page.getViewport({ scale: 0.9 });
 const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); await page.render({ canvasContext: c.getContext("2d") as any, viewport: vp }).promise;
 fs.writeFileSync(`/tmp/page-${n}.png`, await c.encode("png")); }
