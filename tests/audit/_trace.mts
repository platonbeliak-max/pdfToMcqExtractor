import fs from "node:fs";
import { __internals, figureKey } from "../../src/lib/ingestion/moodle-review";
const [pf, ff, needle] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(pf, "utf8")); const figs = fs.existsSync(ff) ? JSON.parse(fs.readFileSync(ff, "utf8")) : {};
const inst = __internals.readInstances(pages); __internals.annotate(inst, pages); (__internals as any).attachFigures(inst, pages);
for (const q of inst) { const p = __internals.interpret(q); if (!(p.stem + p.options.join(" ")).includes(needle)) continue;
  console.log(`p${q.page} #${q.number} ${q.state} ${q.earned}/${q.max} multi=${q.multi} kind=${p.kind} figs=${q.figures.map((f: any) => figs[figureKey(f)]?.hash.slice(0, 16) ?? "?").join(",")}`);
  console.log("   stem:", p.stem.slice(0, 120)); q.options.forEach((o: any, i: number) => console.log(`   ${o.selected ? "■" : "□"} ${o.mark ?? ""} ${o.stamped ? "STAMP" : ""} ${o.text}`));
  if (p.entries.length) p.entries.forEach((e: any) => console.log(`   • ${e.text} => ${e.value} ${e.mark ?? ""}`));
  console.log("   correct", [...p.correct], "complete", p.complete, "text", p.text, "fb", q.feedback, "notes", q.notes);
}
