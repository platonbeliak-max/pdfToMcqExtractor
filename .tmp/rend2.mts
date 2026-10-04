import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const [file, out, ...ps] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
for (const s of ps) {
  const [n, y0, y1] = s.split(":").map(Number);
  const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1.6 });
  const c = createCanvas(vp.width, vp.height); const ctx = c.getContext("2d");
  await page.render({ canvasContext: ctx as any, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
  let img = c;
  if (y1) { const h = (y1 - y0) * 1.6; const cc = createCanvas(vp.width, h); cc.getContext("2d").drawImage(c, 0, y0 * 1.6, vp.width, h, 0, 0, vp.width, h); img = cc as any; }
  writeFileSync(`${out}-${n}.png`, img.toBuffer("image/png"));
}
