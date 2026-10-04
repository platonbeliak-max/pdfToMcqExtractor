import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
for (const n of process.argv.slice(2).map(Number)) {
  const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1.3 });
  const c = createCanvas(vp.width, vp.height); const ctx = c.getContext("2d");
  await page.render({ canvasContext: ctx as any, viewport: vp }).promise;
  writeFileSync(`/tmp/page${n}.png`, c.toBuffer("image/png"));
}
