# Hero "Plunge" Choreography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hero's camera-dive scroll beat with: the scanned river rotates 90° clockwise (Y+Z) + dollies in, then dark water irises in from all screen edges and engulfs the frame, handing off to the 01/About section.

**Architecture:** All changes live in `src/scripts/river-scene.ts` (the vanilla three.js scene). Wrap the river in a pivot Group so it rotates about its own centre; rewrite the `tick()` choreography (sole camera writer) to do rotate+dolly instead of the dive; swap the `WaterDrop` ShaderPass for a new radial water-engulf shader. `HeroRiver.tsx` / `Hero.astro` are unchanged (the sticky `#hero-track` + ScrollTrigger scrub already feed `setScrollProgress`).

**Tech Stack:** three.js 0.184 (vanilla), EffectComposer/ShaderPass, GSAP ScrollTrigger + Lenis. Spec: `docs/superpowers/specs/2026-06-19-river-plunge-choreography-design.md`. Visual source of truth: `previews/plunge.html`.

---

## Preconditions (environment + verification approach)

**This is WebGL/shader work — there is no unit-test harness for the three.js scene.** Verification is **visual, via headless screenshots** (the established pattern in this repo). Each task drives `setScrollProgress` and screenshots the result, checking for (a) zero shader/console errors and (b) the expected visual stage. Do NOT invent a unit-test framework; follow the steps below.

Before starting, ensure:
1. Dev server running: `cd /Volumes/VSTSAMPLES/Projects/Angad && npm run dev` (serves the production hero at `http://localhost:4321/`).
2. The screenshot harness exists at `/tmp/cdpshot.mjs`. If `/tmp` was wiped, recreate it from `previews/rotate-pick.html`'s sibling — or copy the known-good version used this session (CDP screenshot via Node's built-in WebSocket; usage: `node /tmp/cdpshot.mjs <url> <outfile.png> <waitMs> "<preEvalJS>"`).
3. **Add a temporary debug hook** so headless runs can drive progress (it was stripped from production earlier). In `src/components/HeroRiver.tsx`, inside the `useEffect` right after `scene.onReady(() => setLoaded(true));`, add:
   ```tsx
   (window as any).__riverProgress = (p: number) => scene.setScrollProgress(p); // TEMP — removed in Task 4
   ```
   **Task 4 removes this line before the final commit.**

Drive a stage headlessly with, e.g.:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/p62.png 9000 "window.__riverProgress && window.__riverProgress(0.62)"
```

---

## Task 1: Pivot group — rotate the river about its own centre

The river is currently added straight to the scene with a baked offset, so `pivot.rotation` would orbit the GLB origin, not spin in place. Wrap it in a pivot Group whose origin sits at the model's visual centre, preserving the exact current framing.

**Files:**
- Modify: `src/scripts/river-scene.ts` (the `let river` declaration area, and the `loader.load(...)` success block at lines ~272-285)

- [ ] **Step 1: Add the `pivot` field next to `river`**

Find the declaration of `river` (a `let river: THREE.Object3D | null = null;` style line near the top of `createRiverScene`, just above `const loader = new GLTFLoader()`). Immediately after it add:

```ts
let pivot: THREE.Group | null = null; // wraps `river` so the model spins about its own centre
```

- [ ] **Step 2: Wrap the model in the pivot on load**

Replace this block (the loader success body, lines ~274-282):

```ts
    river = g.scene;
    river.traverse((o: any) => { if (o.isMesh) { gradeMaterial(o.material); o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(river);
    const cc = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const scl = 120 / s.x; river.scale.setScalar(scl);
    river.position.set(-cc.x * scl, -cc.y * scl - 3.5, -cc.z * scl - 5);
    river.updateMatrixWorld(true);
    scene.add(river);
```

with:

```ts
    river = g.scene;
    river.traverse((o: any) => { if (o.isMesh) { gradeMaterial(o.material); o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(river);
    const cc = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const scl = 120 / s.x; river.scale.setScalar(scl);
    // centre the model at the pivot origin so pivot.rotation spins it in place (not orbiting the GLB origin)
    river.position.set(-cc.x * scl, -cc.y * scl, -cc.z * scl);
    pivot = new THREE.Group();
    pivot.position.set(0, -3.5, -5);          // same world centre as before → identical framing
    pivot.add(river);
    pivot.updateMatrixWorld(true);
    scene.add(pivot);
```

- [ ] **Step 3: Verify the hero frame is unchanged**

Reload dev, then:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t1_p0.png 9000 "window.__riverProgress && window.__riverProgress(0)"
```
Expected: river renders exactly as before this task (same framing/scale/position); no console errors. Open `/tmp/t1_p0.png` and confirm it matches the current hero.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/river-scene.ts src/components/HeroRiver.tsx
git commit -m "refactor(hero): wrap river in a pivot group (rotate about centre)"
```

---

## Task 2: Radial water-engulf ShaderPass (replace WaterDrop)

Swap the `WaterDrop` ripple-dissolve for the approved radial-engulf shader (FBM-normal refraction + caustics + deep tint, foam off), ported verbatim from `previews/plunge.html`.

**Files:**
- Modify: `src/scripts/river-scene.ts` (the `DEEP` colour near `FOG` line ~70; the splash-pass block lines 238-256; the `resize()` function ~lines 344-348)

- [ ] **Step 1: Add the deep-sea colour**

Find `const FOG = new THREE.Color('#050606');` (line ~70). Immediately after it add:

```ts
const DEEP = new THREE.Color('#062028');   // engulf deep-sea tint (darker than FOG; user-locked 2026-06-19)
```

- [ ] **Step 2: Replace the splash pass definition**

Replace this entire block (lines 238-256):

```ts
  // ── splash: a ripple-dissolve transition pass driven by scroll progress (the "splash into About") ──
  const USPLASH = { value: 0 };   // smoothstep(0.92,1, scrollP) — 0 = passthrough
  // ripple-dissolve = a hand-port of gl-transitions WaterDrop.glsl (Pawel Plociennik, MIT)
  // — an expanding concentric wavefront that displaces then crossfades the river frame to the brand base.
  const splashPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSplash: USPLASH, uBase: { value: FOG } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uSplash; uniform vec3 uBase; varying vec2 vUv;
      const float amp = 18.0, speed = 22.0;
      void main(){
        vec2 dir = vUv - 0.5; float dist = length(dir);
        vec3 col;
        if (dist > uSplash) { col = mix(texture2D(tDiffuse, vUv).rgb, uBase, uSplash); }
        else { vec2 off = dir * sin(dist*amp - uSplash*speed); col = mix(texture2D(tDiffuse, vUv+off).rgb, uBase, uSplash); }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  comp.addPass(splashPass);
```

with:

```ts
  // ── splash: radial water-engulf driven by scroll progress (river → sea, "The Plunge") ──
  // Dark water irises in from every edge, refracting the frame via an FBM-normal (Ashima snoise, MIT),
  // caustics + deep tint, then settles to DEEP → hands off to 01. Ported from previews/plunge.html.
  const splashPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uProgress: { value: 0 }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(sizeW(), sizeH()) },
      uDeep: { value: DEEP }, uCyan: { value: new THREE.Color('#6fcad6') },
      uAmp: { value: 0.07 }, uFoam: { value: 0.0 }, uSpeed: { value: 3.3 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uProgress,uTime,uAmp,uFoam,uSpeed; uniform vec2 uRes;
      uniform vec3 uDeep,uCyan; varying vec2 vUv;
      vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
      float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
        vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
        vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
        vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;
        vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
        m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
        vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}
      float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.0;a*=0.5;}return s*0.5+0.5;}
      void main(){
        float winEnd = clamp(0.58 + 0.34/uSpeed, 0.66, 0.96);
        float sp = smoothstep(0.56, winEnd, uProgress);
        vec2 uv=vUv; float t=uTime;
        vec2 q=(uv-0.5); q.x*=uRes.x/uRes.y; float dist=length(q);
        float dry = mix(1.22, -0.06, sp);
        float feather=0.22;
        float water = smoothstep(dry, dry+feather, dist);
        float crest = smoothstep(feather, 0.0, abs(dist-dry));
        float e=1.6/uRes.y;
        float h0=fbm(uv*6.0+vec2(0.0,t*0.35));
        float hx=fbm((uv+vec2(e,0.0))*6.0+vec2(0.0,t*0.35));
        float hy=fbm((uv+vec2(0.0,e))*6.0+vec2(0.0,t*0.35));
        vec2 n=vec2(h0-hx,h0-hy)*8.0;
        float amp=uAmp*water + uAmp*1.8*crest;
        vec3 scene=texture2D(tDiffuse, uv+n*amp).rgb;
        float ca=fbm(uv*9.0+vec2(t*0.30,-t*0.22)); ca=pow(1.0-abs(ca-0.5)*2.0,3.0);
        vec3 uw=scene + uCyan*ca*0.42*water;
        uw=mix(uw, uDeep, water*(0.42+0.45*sp));
        vec3 col=mix(texture2D(tDiffuse,uv).rgb, uw, water);
        float foam=crest*smoothstep(0.45,0.8, fbm(uv*20.0+t*0.85));
        col+=foam*vec3(0.8,0.92,1.0)*uFoam*(0.5+0.6*sp);
        col=mix(col, uDeep, smoothstep(winEnd, min(winEnd+0.12,1.0), uProgress)*0.94);
        gl_FragColor=vec4(col,1.0);
      }`,
  });
  comp.addPass(splashPass);
```

- [ ] **Step 3: Keep `uRes` in sync on resize**

In the `resize()` function, after `camera.aspect = w / h; camera.updateProjectionMatrix();` add:

```ts
    (splashPass.uniforms as any).uRes.value.set(w, h);
```

- [ ] **Step 4: Verify it compiles and is passthrough before the splash window**

Reload dev, then:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t2_p0.png 9000 "window.__riverProgress && window.__riverProgress(0.0)"
```
Expected: no console/shader-compile errors; at progress 0 the splash is fully passthrough (hero looks identical to Task 1). A compile error would blank the canvas — if so, check the GLSL was pasted intact.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/river-scene.ts
git commit -m "feat(hero): radial water-engulf ShaderPass (replaces WaterDrop)"
```

---

## Task 3: tick() — rotate + dolly + drive the engulf (replace the dive)

Rewrite the choreography block so phase 2 is the Y+Z rotation + dolly (not the camera dive), and drive the new splash uniforms. `tick()` stays the sole camera writer.

**Files:**
- Modify: `src/scripts/river-scene.ts` (the choreography block inside `tick()`, lines ~320-336)

- [ ] **Step 1: Replace the choreography block**

Replace from the `const sm = THREE.MathUtils.smoothstep;` line through the `(splashPass.uniforms as any).uSplash.value = e3;` line (the block currently reading):

```ts
    const sm = THREE.MathUtils.smoothstep;
    const e1 = sm(scrollP, 0.0, 0.62);     // phase 1: dolly-in
    const e2 = sm(scrollP, 0.62, 0.92);    // phase 2: dive + cyan takeover
    const e3 = sm(scrollP, 0.92, 1.0);     // phase 3: ripple splash
    const dolly = e1 * 7.5 + e2 * 1.5;     // z: 16 → 8.5 → 7
    const takeover = e2;                   // camera dives + bloom floods cyan
    const lookY = e1 * 1.2 + e2 * 1.2;     // look.y: -3.2 → -2.0 → -0.8 (sink toward the surface)
    const par = 1 - e1;                    // fade the drone parallax as the dive commits
    camO.x += (camT.x - camO.x) * 0.04; camO.y += (camT.y - camO.y) * 0.04;
    camera.position.x = camO.x * 4.0 * par;
    camera.position.y = (camBaseY - camO.y * 1.6 * par) - takeover * 5.2;
    camera.position.z = camBaseZ - dolly;
    const fov = 40 - e1 * 6;               // 40 → 34: NARROW on approach (wide+dolly = motion sickness)
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    look.set(0, -3.2 + lookY, -7); camera.lookAt(look);
    renderer.toneMappingExposure = 1.0 + takeover * 0.3;   // bloom blooms harder → cyan floods the frame
    (splashPass.uniforms as any).uSplash.value = e3;       // ShaderPass clones its uniforms — write the clone, not USPLASH
```

with:

```ts
    // ── "The Plunge": phase 1 (0→0.55) rotate Y+Z 90° CW + dolly; phase 2 (0.56→~0.68) radial water engulf ──
    const sm = THREE.MathUtils.smoothstep;
    const p1 = sm(scrollP, 0.0, 0.55);     // rotate + dolly amount
    const par = 1 - p1;                    // fade the idle drone parallax as the move commits
    camO.x += (camT.x - camO.x) * 0.04; camO.y += (camT.y - camO.y) * 0.04;
    if (pivot) { pivot.rotation.set(0, 0, 0); pivot.rotation.y = -p1 * (Math.PI / 2); pivot.rotation.z = -p1 * (Math.PI / 4); }
    camera.position.x = camO.x * 4.0 * par;
    camera.position.y = (camBaseY - camO.y * 1.6 * par) - p1 * 1.5;
    camera.position.z = camBaseZ - p1 * 8.5;
    look.set(0, -3.2, -7); camera.lookAt(look);
    renderer.toneMappingExposure = 1.0 + sm(scrollP, 0.55, 0.92) * 0.35;   // bloom catches the surface
    const su = splashPass.uniforms as any;  // ShaderPass clones its uniforms — write the clone
    su.uProgress.value = scrollP; su.uTime.value = UTIME.value;
```

(Note: `UTIME.value` already advances by `dt` each frame at the top of `tick()` when not reduced-motion — reuse it as the splash time.)

- [ ] **Step 2: Verify the full choreography stages**

Reload dev, then render the key stages:
```bash
for P in 0 0.4 0.62 0.7 1.0; do
  node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t3_$P.png 9000 "window.__riverProgress && window.__riverProgress($P)"
done
```
Expected, with NO console/shader errors:
- `t3_0` — hero, no rotation.
- `t3_0.4` — river visibly **rotated** (Y turntable + Z roll, clockwise) and dollied closer; no water yet.
- `t3_0.62` — dark water **irising in from all edges**, refraction over the rotated river.
- `t3_0.7` — nearly engulfed.
- `t3_1.0` — frame settled to deep `#062028`.

Open each and confirm. (Compare the engulf to `previews/plunge.html` at the same progress.)

- [ ] **Step 3: Commit**

```bash
git add src/scripts/river-scene.ts
git commit -m "feat(hero): rotate+dolly+engulf choreography in tick() (replaces dive)"
```

---

## Task 4: Strip debug hook, verify build + degradation, final commit

**Files:**
- Modify: `src/components/HeroRiver.tsx` (remove the temp hook), `src/scripts/river-scene.ts` (no further change — confirm tier gate + dispose)

- [ ] **Step 1: Confirm tier gate + dispose are intact**

Verify (read, no edit needed) that `applyTier()` still has `splashPass.enabled = t < 2;` (the engulf is skipped on the minimal/mobile tier) and that `dispose()` still calls `splashPass.material?.dispose?.()`. Both predate this plan and should be unchanged. There is no `USPLASH` reference left anywhere:
```bash
grep -n "USPLASH\|uSplash\|WaterDrop\|e1\|e2\|e3" src/scripts/river-scene.ts
```
Expected: no matches (all removed). If any remain, delete them.

- [ ] **Step 2: Remove the temporary debug hook**

In `src/components/HeroRiver.tsx`, delete the line added in Preconditions:
```tsx
(window as any).__riverProgress = (p: number) => scene.setScrollProgress(p); // TEMP — removed in Task 4
```

- [ ] **Step 3: Production build green**

Run:
```bash
npm run build
```
Expected: `[build] Complete!` with no errors.

- [ ] **Step 4: Verify reduced-motion / mobile degrade (static hero)**

Reduced-motion and `<768px` already gate the ScrollTrigger off in `HeroRiver.tsx` (the move never builds; `scrollP` stays 0 → `p1=0` → no rotation, splash passthrough). Confirm with an emulated reduced-motion headless shot:
```bash
# (the harness window is desktop; the matchMedia gate in HeroRiver keeps scrollP=0 when reduced-motion)
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t4_static.png 9000 ""
```
Expected: a normal, un-rotated hero (progress 0). Also manually scroll `localhost:4321` once to confirm the live rotate→engulf→reveal-01 reads smoothly with no blank-space/double-scroll over the sticky track.

- [ ] **Step 5: Final commit**

```bash
git add src/components/HeroRiver.tsx
git commit -m "chore(hero): strip the dev progress hook (Plunge choreography complete)"
```

---

## Phase 2 — majestic upgrades (DEFERRED to its own plan)

The spec fences these as optional polish on top of the approved look: **dual render-target so 01 genuinely emerges**, **reactive ping-pong ripples** (DCtheTall/webgl-ripple, Apache-2.0), **sharper caustics + god-rays**. They are intentionally **not** in this plan: Phase 1 ships a complete, working, approved feature on its own (YAGNI), and we'll scope Phase 2 better after seeing Phase 1 live (perf headroom, whether the tint-cut already reads well enough). When ready, brainstorm → spec → a separate `docs/superpowers/plans/` plan, desktop-tier-gated.

---

## Self-Review

**1. Spec coverage:** Y+Z 90° rotation (Task 3 ✓), replaces the dive (Task 3 removes the dive block ✓), pivot-in-place (Task 1 ✓), radial engulf from all edges (Task 2 shader ✓), darker `#062028` (Task 2 `DEEP` ✓), speed 3.3 / ripple 0.07 / foam 0 (Task 2 uniform defaults ✓), submerge→reveal-01 via uncover-beneath (unchanged architecture ✓), tier gate + reduced-motion degrade (Task 4 ✓), ShaderPass-clone gotcha (Task 3 `su` comment ✓). Phase-2 upgrades deferred per spec. No gaps.

**2. Placeholder scan:** No TBD/TODO; every code step shows the full block. Verification steps give exact commands + expected visual outcome (visual, not unit — called out honestly in Preconditions). ✓

**3. Type/name consistency:** `pivot` declared `THREE.Group | null` (Task 1) and guarded with `if (pivot)` (Task 3) ✓. `splashPass` uniforms `uProgress/uTime/uRes/uDeep/uCyan/uAmp/uFoam/uSpeed` defined in Task 2, written in Task 3 (`su.uProgress`, `su.uTime`) and Task 2 resize (`uRes`) ✓. `DEEP` defined Task 2 Step 1, used in the same pass ✓. `camBaseY/camBaseZ/camO/camT/look/UTIME/sizeW/sizeH` are all pre-existing in `river-scene.ts` (used by the old block being replaced) ✓.
