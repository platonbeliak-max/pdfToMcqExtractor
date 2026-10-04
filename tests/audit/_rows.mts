import fs from "node:fs";
import { __internals } from "../../src/lib/ingestion/moodle-review";
const pages = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cut = __internals.sideColumnCut(pages);
const [pn, from, to] = process.argv.slice(3).map(Number);
const p = pages.find((x: any) => x.pageNumber === pn);
for (const r of __internals.rowsOf(p, cut)) if (r.y >= (from||0) && r.y <= (to||9999)) console.log(r.side ? "S" : " ", r.y.toFixed(1), r.bottom.toFixed(1), r.items.map((i: any) => `<${i.x.toFixed(0)}>${i.str.replace(/\uf00c/g, "✓").replace(/\uf00d/g, "✗")}`).join(" "));
