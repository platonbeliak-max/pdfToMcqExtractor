/** Renders every Moodle question picture and caches {key: {imageId, hash}}: npx tsx tests/audit/moodle-figs.mts pages.json out.json a.pdf [b.pdf…] */
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { moodleFigures, figureKey, pictureId } from "../../src/lib/ingestion/moodle-review";
import { isJunkPicture, isBlankFingerprint } from "../../src/lib/blank-image";
const [pagesFile, out, ...files] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(pagesFile, "utf8"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const docs: { doc: any; offset: number; n: number }[] = [];
let off = 0;
for (const f of files) { const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true, verbosity: 0 }).promise; docs.push({ doc, offset: off, n: doc.numPages }); off += doc.numPages; }
const res: Record<string, { imageId: string; hash: string }> = {};
const figs = moodleFigures(pages);
const byPage = new Map<number, typeof figs>();
for (const f of figs) (byPage.get(f.page) ?? byPage.set(f.page, []).get(f.page)!).push(f);
for (const [pn, list] of byPage) {
  const d = docs.find((x) => pn > x.offset && pn <= x.offset + x.n)!;
  const page = await d.doc.getPage(pn - d.offset);
  for (const f of list) {
    const scale = Math.min(4, Math.max(1, 1000 / Math.max(1, f.bbox.w)));
    const vp = page.getViewport({ scale });
    const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: c.getContext("2d") as any, viewport: vp }).promise;
    const sx = Math.floor(f.bbox.x * scale), sy = Math.floor(f.bbox.y * scale), sw = Math.ceil(f.bbox.w * scale), sh = Math.ceil(f.bbox.h * scale);
    const s = createCanvas(16, 16); const ctx = s.getContext("2d");
    ctx.drawImage(c, sx, sy, sw, sh, 0, 0, 16, 16);
    const px = ctx.getImageData(0, 0, 16, 16).data; const g: number[] = [];
    for (let i = 0; i < px.length; i += 4) g.push(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    const avg = g.reduce((a, b) => a + b, 0) / g.length; let hex = "";
    for (let i = 0; i < g.length; i += 4) { let nib = 0; for (let k = 0; k < 4; k++) nib = (nib << 1) | (g[i + k] > avg ? 1 : 0); hex += nib.toString(16); }
    const f2 = createCanvas(32, 32); const c2 = f2.getContext("2d"); c2.drawImage(c, sx, sy, sw, sh, 0, 0, 32, 32);
    const j = createCanvas(64, 64); j.getContext("2d").drawImage(c, sx, sy, sw, sh, 0, 0, 64, 64);
    if (isJunkPicture(j.getContext("2d").getImageData(0, 0, 64, 64).data, sw, sh)) continue;
    const p2 = c2.getImageData(0, 0, 32, 32).data; let fine = "";
    for (let i = 0; i < p2.length; i += 4) fine += Math.min(15, Math.floor((p2[i] * 0.299 + p2[i + 1] * 0.587 + p2[i + 2] * 0.114) / 16)).toString(16);
    if (isBlankFingerprint(fine)) continue;
    res[figureKey(f)] = { imageId: pictureId(fine), hash: hex, fine } as any;
    if (process.env.FIG_DIR) {
      const k = Math.min(1, 1600 / Math.max(sw, sh));
      const crop = createCanvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
      crop.getContext("2d").drawImage(c, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
      fs.writeFileSync(`${process.env.FIG_DIR}/${pictureId(fine)}.webp`, await crop.encode("webp", 80));
    }
  }
  page.cleanup();
}
fs.writeFileSync(out, JSON.stringify(res));
console.log("figures", figs.length, "rendered", Object.keys(res).length);
