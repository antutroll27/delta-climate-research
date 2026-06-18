// Bake a channel flow-field from the river scan's MESH ELEVATION (min-Y valley floor).
// Output: public/textures/river-flow.webp  RGBA = [downstream tangent RG, speed B, presence A]
// + /tmp/flow_debug.png (RG as colour) and the model-space XZ bbox for the shader uniforms.
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read('/Volumes/VSTSAMPLES/Projects/Angad/public/models/river-2k.glb');

// gather all POSITION verts (model space) across primitives, with node world matrices baked
const verts=[];
for (const mesh of doc.getRoot().listMeshes()){
  for (const prim of mesh.listPrimitives()){
    const pos = prim.getAttribute('POSITION'); if(!pos) continue;
    const a = pos.getArray(); for(let i=0;i<a.length;i+=3) verts.push(a[i],a[i+1],a[i+2]);
  }
}
const N=verts.length/3; console.log('verts',N);

// model-space XZ bbox
let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,minY=1e9,maxY=-1e9;
for(let i=0;i<verts.length;i+=3){ const x=verts[i],y=verts[i+1],z=verts[i+2];
  if(x<minX)minX=x; if(x>maxX)maxX=x; if(z<minZ)minZ=z; if(z>maxZ)maxZ=z; if(y<minY)minY=y; if(y>maxY)maxY=y; }
console.log('bbox X',minX.toFixed(2),maxX.toFixed(2),' Z',minZ.toFixed(2),maxZ.toFixed(2),' Y',minY.toFixed(2),maxY.toFixed(2));

console.log('STRIP_MIN', minX.toFixed(3), minZ.toFixed(3));
console.log('STRIP_MAX', maxX.toFixed(3), maxZ.toFixed(3));

async function bake(GW, GH, outName){
  const bed=new Float32Array(GW*GH).fill(Infinity);
  const fill=new Uint8Array(GW*GH);
  const sx=GW/(maxX-minX), sz=GH/(maxZ-minZ);
  for(let i=0;i<verts.length;i+=3){
    const px=Math.min(GW-1,Math.max(0,((verts[i]-minX)*sx)|0));
    const py=Math.min(GH-1,Math.max(0,((verts[i+2]-minZ)*sz)|0));
    const k=py*GW+px, y=verts[i+1]; if(y<bed[k]){bed[k]=y;} fill[k]=1;
  }
  for(let pass=0;pass<6;pass++){ const nb=bed.slice();
    for(let py=0;py<GH;py++)for(let px=0;px<GW;px++){ const k=py*GW+px; if(fill[k])continue;
      let best=Infinity; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ const x=px+dx,y=py+dy; if(x<0||y<0||x>=GW||y>=GH)continue; const j=y*GW+x; if(fill[j]&&bed[j]<best)best=bed[j]; }
      if(best<Infinity){nb[k]=best;fill[k]=2;} }
    bed.set(nb);
  }
  const vals=[]; for(let k=0;k<bed.length;k++) if(isFinite(bed[k])) vals.push(bed[k]);
  vals.sort((a,b)=>a-b); const thr=vals[Math.floor(vals.length*0.35)];
  const mask=new Uint8Array(GW*GH);
  for(let k=0;k<bed.length;k++) if(isFinite(bed[k]) && bed[k]<=thr) mask[k]=1;
  const lab=new Int32Array(GW*GH).fill(-1); let best=-1,bestN=0,cur=0;
  for(let s=0;s<mask.length;s++){ if(!mask[s]||lab[s]>=0)continue; const st=[s];lab[s]=cur;let cnt=0;
    while(st.length){ const k=st.pop();cnt++; const px=k%GW,py=(k/GW)|0;
      for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=px+dx,y=py+dy;if(x<0||y<0||x>=GW||y>=GH)continue;const j=y*GW+x;if(mask[j]&&lab[j]<0){lab[j]=cur;st.push(j);}} }
    if(cnt>bestN){bestN=cnt;best=cur;} cur++; }
  const chan=new Uint8Array(GW*GH); for(let k=0;k<mask.length;k++) chan[k]=(lab[k]===best)?1:0;
  const cenPy=new Float32Array(GW).fill(-1), width=new Float32Array(GW);
  for(let px=0;px<GW;px++){ let sum=0,cnt=0; for(let py=0;py<GH;py++){ if(chan[py*GW+px]){sum+=py;cnt++;} } if(cnt){cenPy[px]=sum/cnt;width[px]=cnt;} }
  const cs=cenPy.slice(); for(let it=0;it<8;it++){ const t=cs.slice(); for(let px=1;px<GW-1;px++){ if(cs[px]<0)continue; const a=cs[px-1]>=0?cs[px-1]:cs[px],b=cs[px+1]>=0?cs[px+1]:cs[px]; t[px]=(a+2*cs[px]+b)/4; } cs.set(t); }
  const cellDX=(maxX-minX)/GW, cellDZ=(maxZ-minZ)/GH;
  const wsorted=[...width].filter(w=>w>0).sort((a,b)=>a-b); const wmed=wsorted[wsorted.length>>1]||1;
  const dirX=new Float32Array(GW*GH), dirZ=new Float32Array(GW*GH), spd=new Float32Array(GW*GH), pres=new Float32Array(GW*GH);
  for(let px=0;px<GW;px++){ if(cs[px]<0)continue;
    const pxm=Math.max(0,px-1),pxp=Math.min(GW-1,px+1);
    const slope=( (cs[pxp]>=0?cs[pxp]:cs[px]) - (cs[pxm]>=0?cs[pxm]:cs[px]) ) / (pxp-pxm);
    let tx=cellDX, tz=cellDZ*slope; const L=Math.hypot(tx,tz)||1; tx/=L; tz/=L;
    const sp=Math.min(1,Math.max(0.3, wmed/Math.max(width[px],1)));
    for(let py=0;py<GH;py++){ const k=py*GW+px; if(chan[k]){ dirX[k]=tx; dirZ[k]=tz; spd[k]=sp; pres[k]=1; } }
  }
  function blur(src,passes){ let a=src.slice(); for(let p=0;p<passes;p++){ const t=a.slice();
    for(let py=0;py<GH;py++)for(let px=0;px<GW;px++){ let s=0,c=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=px+dx,y=py+dy;if(x<0||y<0||x>=GW||y>=GH)continue;s+=a[y*GW+x];c++;} t[py*GW+px]=s/c; } a=t; } return a; }
  const bDX=blur(dirX,3), bDZ=blur(dirZ,3), bSP=blur(spd,3), bPR=blur(pres,4);
  const out=Buffer.alloc(GW*GH*4);
  for(let k=0;k<GW*GH;k++){ let tx=bDX[k],tz=bDZ[k]; const L=Math.hypot(tx,tz); if(L>1e-4){tx/=L;tz/=L;} else {tx=1;tz=0;}
    out[k*4+0]=Math.round((tx*0.5+0.5)*255); out[k*4+1]=Math.round((tz*0.5+0.5)*255);
    out[k*4+2]=Math.round(Math.min(1,Math.max(0,bSP[k]))*255); out[k*4+3]=Math.round(Math.min(1,Math.max(0,bPR[k]))*255); }
  await sharp(out,{raw:{width:GW,height:GH,channels:4}}).png().toFile('/Volumes/VSTSAMPLES/Projects/Angad/public/textures/'+outName);
  console.log('wrote', outName, GW+'x'+GH, 'channel cells', bestN);
}
await bake(256,128,'river-flow.png');
await bake(128,64,'river-flow-sm.png');
