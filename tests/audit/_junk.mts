import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { isJunkPicture } from "../../src/lib/blank-image";
for (const b of ["anatomy","physiology"]) {
  const qs = JSON.parse(fs.readFileSync(`public/banks/${b}.json`,"utf8")).questions;
  const ids = new Map<string,string>(); for (const q of qs) if (q.imageId && !ids.has(q.imageId)) ids.set(q.imageId, q.id+" "+q.question.text.slice(0,50));
  let junk=0;
  for (const [id,q] of ids) { const f=`public/banks/img/${id}.webp`; if(!fs.existsSync(f)) continue;
    const img=await loadImage(fs.readFileSync(f)); const c=createCanvas(64,64); const x=c.getContext("2d"); x.drawImage(img,0,0,64,64);
    if (isJunkPicture(x.getImageData(0,0,64,64).data,img.width,img.height)) { junk++; console.log(b,"JUNK",id,`${img.width}x${img.height}`,q); } }
  console.log(b,"images",ids.size,"junk",junk);
}
