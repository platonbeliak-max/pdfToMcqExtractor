import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const bank = JSON.parse(fs.readFileSync("public/banks/anatomy.json","utf8")).questions;
const ids = new Map<string, {n:number, tags:Set<string>, q:string}>();
for (const q of bank) if (q.imageId) { const e = ids.get(q.imageId) ?? {n:0,tags:new Set(),q:q.question.text.slice(0,40)}; e.n++; e.tags.add(q.options.length?"mcq":"text"); ids.set(q.imageId,e); }
for (const [id,e] of ids) {
  const f = `public/banks/img/${id}.webp`; if (!fs.existsSync(f)) { console.log(id,"MISSING"); continue; }
  const img = await loadImage(fs.readFileSync(f)); const w=img.width,h=img.height;
  const c=createCanvas(w,h); const x=c.getContext("2d"); x.drawImage(img,0,0); const p=x.getImageData(0,0,w,h).data;
  let white=0,cyan=0,gray=0,sat=0,n=0;
  for(let i=0;i<p.length;i+=16){const r=p[i],g=p[i+1],b=p[i+2];n++;
    if(r>244&&g>244&&b>244)white++; else if(b>=228&&g>=222&&r>=195&&r<=238&&b-r>=10)cyan++;
    else if(Math.max(r,g,b)-Math.min(r,g,b)<12 && r>225) gray++;
    if(Math.max(r,g,b)-Math.min(r,g,b)>40)sat++;}
  console.log(id.padEnd(22), `${w}x${h}`.padEnd(10), "white",(white/n).toFixed(2),"cyan",(cyan/n).toFixed(2),"gray",(gray/n).toFixed(2),"sat",(sat/n).toFixed(2), e.n, [...e.tags].join(","), e.q);
}
