import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("public/__real.pdf")), useSystemFonts: true }).promise;
const page = await doc.getPage(Number(process.argv[2]||2));
const ol = await page.getOperatorList();
const OPS:any = pdfjs.OPS; const name:any = {}; for (const k in OPS) name[OPS[k]] = k;
const vp = page.getViewport({scale:1});
let ctm=[1,0,0,1,0,0]; const stack:any[]=[]; let fill="", stroke="";
const counts:any={};
ol.fnArray.forEach((fn:number,i:number)=>{ const nm=name[fn]; counts[nm]=(counts[nm]||0)+1;
  const a:any=ol.argsArray[i];
  if (nm==="save") stack.push([...ctm]); else if (nm==="restore") ctm=stack.pop()??ctm;
  else if (nm==="paintFormXObjectBegin") { stack.push([...ctm]); const m=a[0]; if(m) ctm=[ctm[0]*m[0]+ctm[2]*m[1],ctm[1]*m[0]+ctm[3]*m[1],ctm[0]*m[2]+ctm[2]*m[3],ctm[1]*m[2]+ctm[3]*m[3],ctm[0]*m[4]+ctm[2]*m[5]+ctm[4],ctm[1]*m[4]+ctm[3]*m[5]+ctm[5]]; } else if (nm==="paintFormXObjectEnd") ctm=stack.pop()??ctm;
  else if (nm==="transform") { const m=a; ctm=[ctm[0]*m[0]+ctm[2]*m[1],ctm[1]*m[0]+ctm[3]*m[1],ctm[0]*m[2]+ctm[2]*m[3],ctm[1]*m[2]+ctm[3]*m[3],ctm[0]*m[4]+ctm[2]*m[5]+ctm[4],ctm[1]*m[4]+ctm[3]*m[5]+ctm[5]]; }
  else if (nm==="setFillRGBColor") fill=a.join? a.join(","):String(a); else if (nm==="setStrokeRGBColor") stroke=a.join?a.join(","):String(a);
  else if (nm==="constructPath") { const mm=a[2]; if(!mm) return; const x0=ctm[0]*mm[0]+ctm[2]*mm[1]+ctm[4], y0=ctm[1]*mm[0]+ctm[3]*mm[1]+ctm[5], x1=ctm[0]*mm[2]+ctm[2]*mm[3]+ctm[4], y1=ctm[1]*mm[2]+ctm[3]*mm[3]+ctm[5];
    const w=Math.abs(x1-x0), h=Math.abs(y1-y0); const top = vp.height-Math.max(y0,y1);
    if (process.argv[3] ? (h>8 && h<40 && w>25 && w<480) : (w<20 && h<20 && w>1)) { const next=name[ol.fnArray[i+1]]; console.log("path", Math.round(Math.min(x0,x1)), Math.round(top), w.toFixed(1), h.toFixed(1), "ops", JSON.stringify(a[0]).slice(0,60), "n", a[1].length, "->", next, "fill", fill, "stroke", stroke); } }
  else if (nm==="paintImageXObject"||nm==="paintInlineImageXObject") console.log("image", JSON.stringify(ctm.map(v=>Math.round(v))));
});
console.log(JSON.stringify(counts));
