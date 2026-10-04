import fs from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), verbosity: 0 }).promise;
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n); const H = page.getViewport({ scale: 1 }).height;
  for (const a of (await page.getAnnotations()) as any[]) if (a.subtype !== "Link") console.log(`p${n}`, a.subtype, "x", a.rect[0].toFixed(0), "-", a.rect[2].toFixed(0), "ytop", (H - a.rect[3]).toFixed(0), "-", (H - a.rect[1]).toFixed(0), JSON.stringify(a.contentsObj?.str || a.contents || ""), a.color ? Array.from(a.color).join(",") : "", a.name||"", a.inkLists?.length||"");
}
