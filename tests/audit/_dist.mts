import fs from "node:fs";
const figs = JSON.parse(fs.readFileSync("/tmp/kb/anat.figs.json","utf8")) as Record<string,{imageId:string,fine:string}>;
const byId = new Map<string,string>(); for (const v of Object.values(figs)) if (v.fine) byId.set(v.imageId, v.fine);
const d=(a:string,b:string)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(parseInt(a[i],16)-parseInt(b[i],16));return s/(a.length*15)};
const pairs=[["hn54yn1beortx","pz2cb51nbal6p"],["wokm1so964pw","1nydbl72yq3hl"],["1bl2ozj1p0xfi5","1disk3roc2pmb"],["1bl2ozj1p0xfi5","ztvylytz20e4"],["xymhyiyon70o","ztvylytz20e4"],["4n9s2cnxing","hn54yn1beortx"]];
for(const [a,b] of pairs){const A=byId.get("mdl-img-"+a),B=byId.get("mdl-img-"+b);console.log(a,b,A&&B?d(A,B).toFixed(3):"n/a")}
console.log(byId.size);
