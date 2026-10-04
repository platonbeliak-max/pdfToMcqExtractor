import fs from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync("/tmp/kollok.pdf")), verbosity: 0 }).promise;
const { OPS } = pdfjs; const names = Object.fromEntries(Object.entries(OPS).map(([k,v])=>[v,k]));
type M=number[]; const mul=(a:M,b:M):M=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
for (const n of process.argv.slice(2).map(Number)) {
  const p = await doc.getPage(n); const ops = await p.getOperatorList(); const H=p.view[3];
  let ctm:M=[1,0,0,1,0,0]; const st:M[]=[]; let fill="";
  const out:string[]=[];
  for (let i=0;i<ops.fnArray.length;i++){const f=ops.fnArray[i];const a=ops.argsArray[i];
    if(f===OPS.save)st.push(ctm);else if(f===OPS.restore)ctm=st.pop()??[1,0,0,1,0,0];else if(f===OPS.transform)ctm=mul(ctm,a);
    else if(f===OPS.paintFormXObjectBegin){st.push(ctm);if(a?.[0]?.length===6)ctm=mul(ctm,a[0]);}else if(f===OPS.paintFormXObjectEnd)ctm=st.pop()??[1,0,0,1,0,0];
    else if(f===OPS.setFillRGBColor)fill=String(a[0]);
    else if(f===OPS.constructPath){const ol=a[0],c=a[1];const xs:number[]=[],ys:number[]=[];let j=0;
      for(const op of ol){const k=op===OPS.rectangle?4:op===OPS.curveTo?6:(op===OPS.curveTo2||op===OPS.curveTo3)?4:(op===OPS.moveTo||op===OPS.lineTo)?2:0;
        if(op===OPS.rectangle){xs.push(c[j],c[j]+c[j+2]);ys.push(c[j+1],c[j+1]+c[j+3]);}else for(let q=0;q<k;q+=2){xs.push(c[j+q]);ys.push(c[j+q+1]);} j+=k;}
      if(!xs.length)continue;
      const P=[[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]].map(([x,y])=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]]);
      const w=Math.abs(P[1][0]-P[0][0]),h=Math.abs(P[1][1]-P[0][1]);
      if(w<=20&&h<=20&&w>2) out.push(`${names[ops.fnArray[i+1]]} ${fill} x=${Math.min(P[0][0],P[1][0]).toFixed(1)} y=${(H-Math.max(P[0][1],P[1][1])).toFixed(1)} ${w.toFixed(1)}x${h.toFixed(1)} ops=${ol.length}`);
    }}
  console.log("page",n,out.length);out.slice(0,30).forEach(l=>console.log("  ",l));
}
