import fs from "node:fs";
import { readPageStructure } from "../../src/lib/ingestion/client-extract";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const out: string[] = [];
for (const file of process.argv.slice(3)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const p = await readPageStructure(pdfjs, page, n, []);
    const an = (await page.getAnnotations()).filter((a: any) => a.subtype !== "Link");
    out.push(`=== ${file.split("/").pop()} p${n} annots=${an.map((a: any) => a.subtype + "[" + a.rect.map((v: number) => v.toFixed(0)).join(",") + "]").join(" ")}`);
    const items = p.items.filter((i) => i.str.trim()).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
    let line: typeof items = [];
    const flush = () => { if (line.length) out.push(line.sort((a, b) => a.x - b.x).map((i) => `<${i.x.toFixed(0)}>${[...i.str].map((c) => (c.codePointAt(0)! >= 0xe000 && c.codePointAt(0)! < 0xf900 ? `{${c.codePointAt(0)!.toString(16)}}` : c)).join("")}`).join(" ")); line = []; };
    for (const it of items) { if (line.length && Math.abs(line[0].y + line[0].h / 2 - (it.y + it.h / 2)) > 3) flush(); line.push(it); }
    flush();
    page.cleanup();
  }
}
fs.writeFileSync(process.argv[2], out.join("\n"));
