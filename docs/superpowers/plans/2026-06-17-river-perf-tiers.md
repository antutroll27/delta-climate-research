# River Hero — Performance Tiers + Debug Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the dev/debug hooks from the river-hero preview and add a 3-tier (full / lite / minimal) performance ladder with hint-based detection + FPS-adaptive downgrade, so the hero stays smooth on phones and weak laptops.

**Architecture:** Two lever classes. *Load-time* levers (scan texture LOD, flow-map size) are chosen once from `pickInitialTier()`. *Runtime* levers (pixel ratio, bloom on/off, water-shader complexity via a `uTier` uniform with a coherent branch) are applied by `applyTier()` and re-applied by an FPS monitor that only ever downgrades.

**Tech Stack:** vanilla three.js 0.184 (raw WebGL island in one HTML file), EffectComposer/UnrealBloomPass, a baked RGBA flow-field PNG, Node + sharp + gltf-transform for the bake. Verification is the headless-Chrome harness `/tmp/cdpshot.mjs` (render → screenshot → grep for shader errors), not unit tests.

**Spec:** `docs/superpowers/specs/2026-06-17-river-perf-tiers-design.md`

**Commits:** Per the repo's "commit only when asked" rule, the inline executor must get explicit user approval before running any `git commit`. Commit steps below are grouped at task end; treat them as "offer to commit," not automatic.

**Harness note:** `/tmp/cdpshot.mjs "<url>" <out.png> <waitMs> "<preEvalJS>"` loads the page, runs `preEvalJS` ~60% through the wait, screenshots, and prints `PROBE {...}` + any console `ERROR`/exceptions. The static server runs at `http://localhost:8099` (project root). Always grep the output for `Shader Error` / `out of range`.

---

## File Structure

- **`scripts/bake-river-flow.mjs`** (modify) — refactor to bake *any* grid size; emit both `river-flow.png` (256×128) and `river-flow-sm.png` (128×64). Runnable only from a dir with `gltf-transform`+`sharp`+`meshoptimizer` installed (`/tmp/glb`), so we edit the canonical repo copy and run a synced copy from `/tmp/glb`.
- **`public/textures/river-flow-sm.png`** (create, via bake) — the 128×64 lite/minimal flow map.
- **`previews/hero-river-native.html`** (modify) — all runtime work: debug strip, `uTier` shader gates, tier detection/config/`applyTier`, FPS monitor, `?tier=` + `?fpscap=` dev hooks.

---

## Task 1: Bake the 128×64 flow map

**Files:**
- Modify: `scripts/bake-river-flow.mjs`
- Create: `public/textures/river-flow-sm.png`

- [ ] **Step 1: Refactor the bake to emit both sizes**

In `scripts/bake-river-flow.mjs`, the script currently hardcodes `const GW=256, GH=128;` and writes one PNG. Wrap everything from the grid allocation through the PNG write in a function and call it twice. Replace the block that starts at `const GW=256, GH=128;` and ends at the `await sharp(out,...).png().toFile('.../river-flow.png');` + debug PNG write with:

```js
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
```

(The `verts`, `minX/maxX/minZ/maxZ` computed earlier in the file stay as-is, above this block. Delete the old single-size body and the old `/tmp/flow_debug.png` write — it referenced `/tmp` and isn't needed.)

- [ ] **Step 2: Run the bake from a deps-equipped dir**

```bash
cp /Volumes/VSTSAMPLES/Projects/Angad/scripts/bake-river-flow.mjs /tmp/glb/bakeflow.mjs
cd /tmp/glb && node /tmp/glb/bakeflow.mjs 2>&1 | grep -v "objc\|GNotification"
```
Expected: two `wrote ... channel cells ####` lines (256×128 ≈ 7879 cells, 128×64 a smaller count), and:
```bash
ls -la /Volumes/VSTSAMPLES/Projects/Angad/public/textures/river-flow*.png
```
Expected: both `river-flow.png` (~17KB) and `river-flow-sm.png` (smaller) exist.

- [ ] **Step 3: Verify the small map decodes with the right channel coverage**

```bash
cd /tmp/glb && node -e "import('sharp').then(async({default:s})=>{const m=await s('/Volumes/VSTSAMPLES/Projects/Angad/public/textures/river-flow-sm.png').metadata();const{data,info}=await s('/Volumes/VSTSAMPLES/Projects/Angad/public/textures/river-flow-sm.png').raw().toBuffer({resolveWithObject:true});let a=0;for(let i=0;i<info.width*info.height;i++)a+=data[i*4+3];console.log(m.width+'x'+m.height,'meanA',(a/(info.width*info.height)).toFixed(1));})"
```
Expected: `128x64 meanA ~50-70` (non-zero channel presence, same ballpark as the 256 map's ~61).

- [ ] **Step 4 (offer commit):** `git add scripts/bake-river-flow.mjs public/textures/river-flow-sm.png && git commit -m "feat(river): bake 128x64 flow map for mobile tiers"` — only after user approves committing.

---

## Task 2: Strip the debug hooks

**Files:**
- Modify: `previews/hero-river-native.html`

- [ ] **Step 1: Un-seed `UTIME` (remove `?t0=`)**

Line 101 — replace:
```js
const UG={value:0.55}, UTIME={value:+(new URLSearchParams(location.search).get('t0')||0)}, UWGAIN={value:1.2}, UWFLOW={value:0.12}, UWAMP={value:0.5}, UMASK={value:0};
```
with:
```js
const UG={value:0.55}, UTIME={value:0}, UWGAIN={value:1.2}, UWFLOW={value:0.12}, UWAMP={value:0.5};
```
(also drops `UMASK`.)

- [ ] **Step 2: Remove `uMaskDebug` from the `u` object (line 118)**

Replace `uTime:UTIME, uGrade:UG, uWGain:UWGAIN, uWFlow:UWFLOW, uWAmp:UWAMP, uMaskDebug:UMASK,` with `uTime:UTIME, uGrade:UG, uWGain:UWGAIN, uWFlow:UWFLOW, uWAmp:UWAMP,` (delete `uMaskDebug:UMASK,`).

- [ ] **Step 3: Remove `uMaskDebug` from the fragment uniform declaration (line 134)**

Replace `uniform float uTime,uGrade,uWGain,uWFlow,uWAmp,uMaskDebug,uScaleN,uFField,uFoamAmt,uEdgeFade;` with `uniform float uTime,uGrade,uWGain,uWFlow,uWAmp,uScaleN,uFField,uFoamAmt,uEdgeFade;`.

- [ ] **Step 4: Remove the emissive mask-debug line (line 203)**

Delete the whole line `totalEmissiveRadiance += vec3(0.0,1.6,2.2)*gWater*uMaskDebug;   // (debug overlay overridden at output)`.

- [ ] **Step 5: Remove the `gl_FragColor` mask override (line 212), keep the edge feather**

The `<dithering_fragment>` injection currently ends with the edge-feather block followed by `if(uMaskDebug>0.5){ ... gl_FragColor.rgb=mix(...) }`. Delete only that `if(uMaskDebug>0.5){ ... }` line, leaving the edge-feather block intact.

- [ ] **Step 6: Remove the "Show mask" button (line 48) and its handler (lines 292-295)**

Delete `<button data-mask="0">Show mask</button>` from the panel. Delete the handler:
```js
document.querySelectorAll('.panel button[data-mask]').forEach(b=>b.addEventListener('click',()=>{
  const on=!b.classList.contains('on'); b.classList.toggle('on',on); b.textContent=on?'Hide mask':'Show mask';
  UMASK.value=on?1:0;
}));
```

- [ ] **Step 7: Verify no dangling references**

```bash
grep -nE "uMaskDebug|UMASK|data-mask|Show mask|t0=|'t0'" previews/hero-river-native.html || echo "clean"
```
Expected: `clean`.

- [ ] **Step 8: Verify it still renders without shader errors**

```bash
node /tmp/cdpshot.mjs "http://localhost:8099/previews/hero-river-native.html?q=4k" /tmp/strip.png 6500 "1" 2>&1 | grep -iE "PROBE|Shader Error|is not defined" | grep -v favicon
```
Expected: `PROBE {"ready":true,...,"fps":...}`, no errors. Read `/tmp/strip.png` — water + edge feather look unchanged.

- [ ] **Step 9 (offer commit):** `git add previews/hero-river-native.html && git commit -m "chore(river): strip debug hooks (t0, mask override)"`.

---

## Task 3: `uTier` water-shader gates

**Files:**
- Modify: `previews/hero-river-native.html`

- [ ] **Step 1: Add the `UTIER` uniform, seeded from `?tier=` (dev override)**

After the `const UFFIELD=...; const UEDGE=...;` lines (near line 109), add:
```js
const TIERQ = new URLSearchParams(location.search).get('tier');
const UTIER={value: TIERQ!=null ? Math.max(0,Math.min(2,+TIERQ)) : 0};   // 0 full · 1 lite · 2 minimal (shader complexity)
```

- [ ] **Step 2: Pass `uTier` into the material**

In the `u={...}` object (line ~118-121), add `uTier:UTIER,` alongside the other uniforms.

- [ ] **Step 3: Declare `uTier` in the fragment shader**

In the fragment uniform line (now `uniform float uTime,uGrade,uWGain,uWFlow,uWAmp,uScaleN,uFField,uFoamAmt,uEdgeFade;`), append `uTier`: `...,uFoamAmt,uEdgeFade,uTier;`.

- [ ] **Step 4: Gate flow direction (minimal → global +X) in `<map_fragment>`**

In the `if(gChan>0.001 && uWFlow>0.0001){` block, immediately after `gTj = ...;`, add:
```glsl
          vec2 dirT = (uTier < 1.5) ? gDir : vec2(1.0,0.0);   // full+lite follow channel; minimal = global +X
```
Then change the streak line `float sAlong = dot(vLocalXZ3.xz, gDir);` to use `dirT`:
```glsl
          float sAlong = dot(vLocalXZ3.xz, dirT);
```

- [ ] **Step 5: Gate foam by tier (shore: full+lite; rapids: full only; minimal: none)**

Replace the foam block:
```glsl
          mat2 frot = mat2(gDir.y,gDir.x,-gDir.x,gDir.y); vec2 ruvF = frot*(gFuv*uScaleN); ruvF.y*=0.45;
          float shore = smoothstep(0.06,0.4,gChan)*(1.0-smoothstep(0.4,0.85,gChan));
          float rapids = smoothstep(0.74,1.0,gSpd)*gChan*0.55;
          float fn = texture2D(uWaterNorm, ruvF*1.7 - vec2(0.0,fract(gTj))).g;
          gFoam = smoothstep(0.5,0.8,fn)*max(shore,rapids);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, gFoam*uFoamAmt);
```
with:
```glsl
          if(uTier < 1.5){                                                   // no foam on minimal
            mat2 frot = mat2(dirT.y,dirT.x,-dirT.x,dirT.y); vec2 ruvF = frot*(gFuv*uScaleN); ruvF.y*=0.45;
            float shore = smoothstep(0.06,0.4,gChan)*(1.0-smoothstep(0.4,0.85,gChan));
            float rapids = (uTier < 0.5) ? smoothstep(0.74,1.0,gSpd)*gChan*0.55 : 0.0;  // rapids foam: full only
            float fn = texture2D(uWaterNorm, ruvF*1.7 - vec2(0.0,fract(gTj))).g;
            gFoam = smoothstep(0.5,0.8,fn)*max(shore,rapids);
            diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, gFoam*uFoamAmt);
          }
```

- [ ] **Step 6: Gate the normal-tile rotation in `<normal_fragment_maps>`**

Replace the normal block body:
```glsl
      if(gChan>0.001 && uWFlow>0.0001){
        mat2 rot = mat2(gDir.y,gDir.x,-gDir.x,gDir.y);
        vec2 ruv = rot*(gFuv*uScaleN); ruv.y*=0.45;
        float p0=fract(gTj), p1=fract(gTj+0.5);
        vec3 n0 = texture2D(uWaterNorm, ruv - vec2(0.0,p0)).xyz*2.0-1.0;
        vec3 n1 = texture2D(uWaterNorm, ruv - vec2(0.0,p1)).xyz*2.0-1.0;
        vec3 wn = mix(n0, n1, 1.0-abs(1.0-2.0*fract(gTj)));
        wn.xy = transpose(rot)*wn.xy;
        normal = normalize(normal + vec3(wn.xy,0.0)*gChan*uWAmp);
      }
```
with (full = rotated tile; lite/minimal = unrotated tile, two-phase offset along the flow direction — no `mat2`):
```glsl
      if(gChan>0.001 && uWFlow>0.0001){
        vec2 dirN = (uTier < 1.5) ? gDir : vec2(1.0,0.0);
        float p0=fract(gTj), p1=fract(gTj+0.5);
        vec3 wn;
        if(uTier < 0.5){                                                     // FULL: rotate tile down-channel
          mat2 rot = mat2(dirN.y,dirN.x,-dirN.x,dirN.y);
          vec2 ruv = rot*(gFuv*uScaleN); ruv.y*=0.45;
          vec3 n0 = texture2D(uWaterNorm, ruv - vec2(0.0,p0)).xyz*2.0-1.0;
          vec3 n1 = texture2D(uWaterNorm, ruv - vec2(0.0,p1)).xyz*2.0-1.0;
          wn = mix(n0, n1, 1.0-abs(1.0-2.0*fract(gTj)));
          wn.xy = transpose(rot)*wn.xy;
        } else {                                                            // LITE/MINIMAL: unrotated tile, offset along flow
          vec2 ruv = gFuv*uScaleN;
          vec3 n0 = texture2D(uWaterNorm, ruv - dirN*p0).xyz*2.0-1.0;
          vec3 n1 = texture2D(uWaterNorm, ruv - dirN*p1).xyz*2.0-1.0;
          wn = mix(n0, n1, 1.0-abs(1.0-2.0*fract(gTj)));
        }
        normal = normalize(normal + vec3(wn.xy,0.0)*gChan*uWAmp);
      }
```

- [ ] **Step 7: Verify each tier compiles and renders**

```bash
for T in 0 1 2; do
  node /tmp/cdpshot.mjs "http://localhost:8099/previews/hero-river-native.html?q=4k&tier=$T" /tmp/tier_$T.png 6500 "1" 2>&1 | grep -iE "PROBE|Shader Error|out of range" | grep -v favicon | sed "s/^/tier$T: /";
done
```
Expected: each prints `PROBE {"ready":true,...}`, no `Shader Error`. Read `/tmp/tier_0.png`, `/tmp/tier_1.png`, `/tmp/tier_2.png`: all three show flowing water; tier 1/2 are simpler (no rotation; tier 2 flat +X, no foam) but still read as a flowing river, no obvious breakage.

- [ ] **Step 8 (offer commit):** `git add previews/hero-river-native.html && git commit -m "feat(river): uTier water-shader complexity gates"`.

---

## Task 4: Tier detection + config + `applyTier` (load-time + runtime levers)

**Files:**
- Modify: `previews/hero-river-native.html`

- [ ] **Step 1: Add `pickInitialTier()` and the `TIERS` config near the top (after line 76, `const reduce = ...`)**

```js
function pickInitialTier(){
  const q = new URLSearchParams(location.search).get('tier');
  if(q!=null) return Math.max(0,Math.min(2,+q));
  const coarse = matchMedia('(pointer:coarse)').matches;
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  let t = 0;
  if(coarse) t = 1;
  if(mem <= 2 || cores <= 4) t = 2;
  return t;
}
const TIERS = [
  { q:'4k', flow:'river-flow.png',    dpr:1.6,  bloom:true  },
  { q:'2k', flow:'river-flow-sm.png', dpr:1.25, bloom:false },
  { q:'2k', flow:'river-flow-sm.png', dpr:1.0,  bloom:false },
];
let TIER = pickInitialTier();
console.log('[river] initial tier', TIER);
```

- [ ] **Step 2: Drive the scan LOD + flow map from the tier (load-time levers)**

Replace lines 77-79:
```js
const Q = (new URLSearchParams(location.search).get('q') || '8k').toLowerCase();
const GLBNAME = ['2k','4k','8k'].includes(Q) ? `river-${Q}.glb` : 'river-8k.glb';
const GLB = location.protocol==='file:' ? `http://localhost:8099/public/models/${GLBNAME}` : `/public/models/${GLBNAME}`;
```
with (an explicit `?q=` still overrides the tier's LOD for dev):
```js
const Q = (new URLSearchParams(location.search).get('q') || TIERS[TIER].q).toLowerCase();
const GLBNAME = ['2k','4k','8k'].includes(Q) ? `river-${Q}.glb` : `river-${TIERS[TIER].q}.glb`;
const GLB = location.protocol==='file:' ? `http://localhost:8099/public/models/${GLBNAME}` : `/public/models/${GLBNAME}`;
```

Replace the flow-texture URL (line 108) `const flowTex = new THREE.TextureLoader().load(TEXBASE+'river-flow.png');` with:
```js
const flowTex = new THREE.TextureLoader().load(TEXBASE+TIERS[TIER].flow, undefined, undefined, ()=>{ if(TIERS[TIER].flow!=='river-flow.png') new THREE.TextureLoader().load(TEXBASE+'river-flow.png', t=>{ t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping; t.flipY=false; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.LinearFilter; t.colorSpace=THREE.NoColorSpace; flowTex.image=t.image; flowTex.needsUpdate=true; }); });
```
(the onError fallback loads the full map if the sm one 404s.)

- [ ] **Step 3: Set `UTIER` from the resolved tier (replace the Task-3 `?tier`-only seeding)**

Replace the Task-3 lines:
```js
const TIERQ = new URLSearchParams(location.search).get('tier');
const UTIER={value: TIERQ!=null ? Math.max(0,Math.min(2,+TIERQ)) : 0};
```
with:
```js
const UTIER={value: TIER};   // shader-complexity tier (driven by applyTier)
```

- [ ] **Step 4: Add `applyTier()` (runtime levers) after the bloom pass is created (after line 230)**

```js
function applyTier(t){
  TIER=t; const cfg=TIERS[t];
  renderer.setPixelRatio(Math.min(cfg.dpr, devicePixelRatio||1));
  comp.setSize(innerWidth,innerHeight); bloom.setSize(innerWidth,innerHeight);
  bloom.enabled=cfg.bloom;
  UTIER.value=t;
  console.log('[river] applyTier', t, 'dpr', renderer.getPixelRatio(), 'bloom', cfg.bloom);
}
```

- [ ] **Step 5: Call `applyTier(TIER)` once after the scene is built**

In the GLB `loader.load` success callback, right after `applyControls();` (near line 250), add `applyTier(TIER);`.

- [ ] **Step 6: Verify each forced tier loads the right LOD + levers**

```bash
for T in 0 1 2; do
  node /tmp/cdpshot.mjs "http://localhost:8099/previews/hero-river-native.html?tier=$T" /tmp/ftier_$T.png 7000 "JSON.stringify({tier:(window.TIER),dpr:0})" 2>&1 | grep -iE "river\]|PROBE|Shader Error" | grep -v favicon | sed "s/^/T$T /";
done
```
Expected per tier: console shows `[river] initial tier T` and `[river] applyTier T dpr <X> bloom <bool>` with dpr 1.6/1.25/1.0 and bloom true/false/false; `PROBE ready:true`; no shader errors. Read the three PNGs — all render a flowing river (tier 1/2 visibly simpler, no crash). Confirm the network LOD by checking the loading path in console or trusting `TIERS[TIER].q`.

- [ ] **Step 7 (offer commit):** `git add previews/hero-river-native.html && git commit -m "feat(river): tier detection + config + applyTier (DPR/bloom/LOD)"`.

---

## Task 5: FPS monitor + adaptive downgrade

**Files:**
- Modify: `previews/hero-river-native.html`

- [ ] **Step 1: Add the FPS monitor state + a `?fpscap=` dev hook near the clock (line ~312, `const clock=...`)**

```js
const FPSCAP = +(new URLSearchParams(location.search).get('fpscap')||0);   // dev: force a low fps reading to test downgrades
let fpsWarm=0, fpsAcc=0, fpsN=0;
```

- [ ] **Step 2: Wire the monitor into the loop (downgrade-only)**

In `function loop(){ ... }`, after the existing `comp.render(); frames++; ...` fps-text line, add:
```js
  if(!reduce && TIER<2){
    if(fpsWarm<30){ fpsWarm++; }
    else { fpsAcc += (FPSCAP>0?FPSCAP:(dt>0?1/dt:60)); fpsN++;   // FPSCAP=20 → feeds 20fps → forces downgrade
      if(fpsN>=60){ const medianish=fpsAcc/fpsN; if(medianish<45){ applyTier(TIER+1); } fpsAcc=0; fpsN=0; } }
  }
```
(Note: `1/dt` is instantaneous fps; averaging 60 frames is the simple "median-ish" the spec calls for. `?fpscap=20` overrides the reading to force a downgrade for testing.)

- [ ] **Step 3: Verify a forced-low cap downgrades through the tiers**

```bash
node /tmp/cdpshot.mjs "http://localhost:8099/previews/hero-river-native.html?tier=0&fpscap=20" /tmp/fpscap.png 9000 "1" 2>&1 | grep -iE "applyTier|Shader Error" | grep -v favicon
```
Expected: console shows `[river] applyTier 1 ...` then `[river] applyTier 2 ...` (two downgrades within the window), no shader errors, no further downgrade past 2. Read `/tmp/fpscap.png` — renders fine at the degraded tier.

- [ ] **Step 4: Verify no spurious downgrade at the top tier without the cap**

```bash
node /tmp/cdpshot.mjs "http://localhost:8099/previews/hero-river-native.html?tier=0" /tmp/nocap.png 9000 "1" 2>&1 | grep -iE "applyTier" | grep -v favicon
```
Expected: only the initial `[river] applyTier 0 ...` (the headless GPU may be slow and trigger a downgrade — if it does, note it's a headless artifact; on a real desktop tier 0 holds). If headless reliably downgrades, that's acceptable (it proves the monitor works); real-device behavior is the user's spot-check.

- [ ] **Step 5 (offer commit):** `git add previews/hero-river-native.html && git commit -m "feat(river): FPS-adaptive tier downgrade"`.

---

## Final verification (whole feature)

- [ ] Run the per-tier screenshots (`?tier=0|1|2`) one more time and eyeball: full = rich rotated flow + foam; lite = simpler unrotated flow + light shore foam, no bloom; minimal = flat +X flow, no foam, no bloom. All read as a flowing river.
- [ ] `grep -nE "uMaskDebug|UMASK|data-mask|'t0'" previews/hero-river-native.html` → clean (debug strip held).
- [ ] Re-run `node /tmp/cdpshot.mjs "...hero-river-native.html?q=4k" /tmp/final.png 6500 "1"` → `PROBE ready:true`, no errors, looks like the approved hero.
- [ ] Sync the bake script: confirm `scripts/bake-river-flow.mjs` matches the `/tmp/glb/bakeflow.mjs` that produced the assets.

## Self-Review

- **Spec coverage:** debug strip → Task 2; 128×64 bake → Task 1; `uTier` gates (rotation/foam/dir) → Task 3; `pickInitialTier`/`TIERS`/load-time LOD+flow/`applyTier` runtime levers → Task 4; FPS monitor downgrade-only + `?fpscap` → Task 5; `?tier=` override → Tasks 3/4; reduced-motion unchanged (loop guard `!reduce`); poster deferred (not in plan, per spec non-goals). ✓
- **Type/name consistency:** `TIER` (current tier int), `UTIER` (uniform), `TIERS` (config array), `applyTier()`, `pickInitialTier()`, `uTier`/`dirT`/`dirN` used consistently across Tasks 3-5. `bloom` is the existing UnrealBloomPass var (line 230); `comp` is the composer; both exist. ✓
- **Placeholder scan:** every step has concrete code/commands; no TBDs. ✓
