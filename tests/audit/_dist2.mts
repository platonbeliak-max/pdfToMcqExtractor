import fs from "node:fs";
const d=(a:string,b:string)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(parseInt(a[i],16)-parseInt(b[i],16));return s/a.length};
for (const [bankF, figF] of [["public/banks/physiology.json","/tmp/kb/all.figs.json"],["public/banks/anatomy.json","/tmp/kb/anat.figs.json"]]) {
  const figs = JSON.parse(fs.readFileSync(figF,"utf8")) as Record<string,{imageId:string,fine:string}>;
  const fine = new Map<string,string>(); for (const v of Object.values(figs)) if (v.fine) fine.set(v.imageId, v.fine);
  const qs = JSON.parse(fs.readFileSync(bankF,"utf8")).questions.filter((q:any)=>q.imageId && fine.get(q.imageId));
  const key=(q:any)=>q.question.text+"|"+q.options.map((o:any)=>o.text).sort().join("|");
  const out:number[]=[];
  for (let i=0;i<qs.length;i++) for (let j=i+1;j<qs.length;j++) if (key(qs[i])===key(qs[j]) && qs[i].imageId!==qs[j].imageId) {
    const x=d(fine.get(qs[i].imageId)!,fine.get(qs[j].imageId)!); out.push(x);
    if (x<1.5) console.log(bankF.slice(13,18), x.toFixed(3), qs[i].id, qs[j].id, qs[i].answer.text.slice(0,40),"||",qs[j].answer.text.slice(0,40));
  }
  console.log(bankF, "pairs", out.length, "min", Math.min(...out).toFixed(3));
}
