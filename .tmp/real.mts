import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const { extractPages } = await import("/vercel/share/v0-project/src/lib/ingestion/client-extract.ts");
const { analyzeDocument } = await import("/vercel/share/v0-project/src/lib/ingestion/pipeline.ts");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
const pages:any[] = [];
for await (const p of extractPages(doc as any, { ocr: "off" } as any)) pages.push(p);
const a:any = analyzeDocument(pages, { documentId: "x" });
(globalThis as any).A = a;
console.log("attempts", a.attempts.length, a.attempts.map((t:any)=>t.questionCount+"@p"+t.startPage).join(" "));
console.log("instances", a.instances.length);
const c=(f:(i:any)=>string)=>{const by:any={}; for (const i of a.instances){const k=f(i); by[k]=(by[k]||0)+1}; return JSON.stringify(by)};
console.log("answer", c(i=>i.answer.status)); console.log("extract", c(i=>i.extractionStatus)); console.log("type", c(i=>i.questionType));
console.log("issues", c(i=>i.issues.join("|")||"-"));
console.log("canonical", a.canonical?.length ?? a.groups?.length, "audit", JSON.stringify(a.audit).slice(0,300));
const sel = process.argv.slice(2).map(Number);
for (const idx of (sel.length?sel:[0,1,2,3,4,5])) { const i=a.instances[idx]; if(!i) continue; console.log("\n#"+idx, "p"+i.physicalPage, "Q"+i.questionNumber, i.questionType, i.extractionStatus, "ans:"+i.answer.status, JSON.stringify(i.score&&{e:i.score.earned,m:i.score.max})); console.log("  stem:", i.stem.slice(0,160)); for (const o of i.options) console.log("   ", o.label, o.text.slice(0,70)); console.log("  answer:", JSON.stringify(i.answer).slice(0,300)); }
const un = a.instances.filter((i:any)=>i.answer.status==="UNRESOLVED");
const by:any={}; for (const i of un){const k=i.questionType+" | "+(i.answer.reasons[0]||"")+" | sel"+i.answer.selectedOptionIds.length+" | score"+(i.score?i.score.earned+"/"+i.score.max:"none"); by[k]=(by[k]||0)+1}
console.log(Object.entries(by).sort((x:any,y:any)=>y[1]-x[1]).slice(0,15).map(e=>e[1]+"  "+e[0]).join("\n"));
const sc = un.filter((i:any)=>i.questionType==="SINGLE_CHOICE").slice(0,2);
for (const i of sc){ console.log("\nSC p"+i.physicalPage,"Q"+i.questionNumber, i.stem.slice(0,90)); for(const o of i.options) console.log("   ",o.label,o.text.slice(0,50)); console.log("  marks", JSON.stringify(i.visualMarks.map((m:any)=>m.type+m.rawGlyph))); }
const p98 = a.instances.filter((i:any)=>i.physicalPage>=97 && i.physicalPage<=100).map((i:any)=>"p"+i.physicalPage+"Q"+i.questionNumber); console.log(p98.join(" "));
const mcu = a.instances.filter((i:any)=>i.answer.status==="UNRESOLVED" && i.questionType!=="SHORT_TEXT" && i.answer.selectedOptionIds.length===0);
const pg:any={}; for (const i of mcu) pg[i.physicalPage]=(pg[i.physicalPage]||0)+1; console.log("MCU pages", JSON.stringify(pg));
const st = a.instances.filter((i:any)=>i.questionType==="SHORT_TEXT").slice(0,3);
for (const i of st){ console.log("\nST p"+i.physicalPage,"Q"+i.questionNumber, JSON.stringify(i.stem.slice(0,200)), "opts", i.options.length, "lines", JSON.stringify((i.rawLines||i.lines||[]).slice?.(0,8))); }
