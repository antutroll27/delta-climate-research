# Plunge Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the hero engulf with crisp caustics + a subtle depth-glow, and resolve it into an animated night sea, so the cut into 01 feels seamless.

**Architecture:** All changes are in the existing engulf `ShaderPass` in `src/scripts/river-scene.ts` (one fullscreen fragment, runs after bloom, already desktop-tier-gated). Three additions fold into that one shader; no new render target, no second scene, no layout change. Source of truth for the GLSL = the approved `previews/plunge.html`; spec = `docs/superpowers/specs/2026-06-20-plunge-phase2-design.md`.

**Tech Stack:** three.js 0.184 vanilla, EffectComposer/ShaderPass, GLSL.

---

## Preconditions (environment + verification)

WebGL/shader work — **no unit-test harness**; verification is **visual via headless screenshots** (the repo's established pattern). Each task drives `window.__riverProgress(p)` and screenshots, checking (a) zero console/shader errors, (b) PNG written non-trivial (>200 KB = rendered; ~32 KB = blank/compile-fail), (c) the expected look vs `previews/plunge.html` at the same progress.

1. Dev server: `npm run dev` (production hero at `http://localhost:4321/`).
2. Harness `/tmp/cdpshot.mjs` (CDP screenshot; usage `node /tmp/cdpshot.mjs <url> <out.png> <waitMs> "<preEvalJS>"`). If `/tmp` was wiped, recreate it (Node built-in WebSocket CDP shot, `--headless=new`, prints `WROTE`/`ERRORS`).
3. **Temp debug hook** — in `src/components/HeroRiver.tsx`, right after `scene.onReady(() => setLoaded(true));` add:
   ```tsx
   (window as any).__riverProgress = (p: number) => scene.setScrollProgress(p); // TEMP — removed in Task 4
   ```
   Drive a stage: `node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/p78.png 9000 "window.__riverProgress && window.__riverProgress(0.78)"`.

The current engulf shader is `src/scripts/river-scene.ts` lines ~242-290 (the `splashPass`). Reference the exact current lines below.

---

## Task 1: Locked engulf params + crisp caustics

Bump the engulf params to the approved values and replace the soft FBM caustic with the iterative-trig Voronoi caustic.

**Files:**
- Modify: `src/scripts/river-scene.ts` (uniforms line ~247; the caustic lines ~281-282; add a function after `fbm` line ~264)
- Modify: `src/components/HeroRiver.tsx` (add the temp hook from Preconditions)

- [ ] **Step 1: Add the temp debug hook** (Preconditions item 3) to `HeroRiver.tsx`.

- [ ] **Step 2: Update the locked engulf uniforms.** Replace:
```ts
      uAmp: { value: 0.07 }, uFoam: { value: 0.0 }, uSpeed: { value: 3.3 },
```
with:
```ts
      uAmp: { value: 0.12 }, uFoam: { value: 0.60 }, uSpeed: { value: 1.8 },   // Phase-2 locked: rougher ripple, foam back on, slower window
```

- [ ] **Step 3: Add the `caustic()` function** right after the `fbm` definition. Find:
```glsl
      float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.0;a*=0.5;}return s*0.5+0.5;}
```
and insert immediately after it:
```glsl
      // caustics: joltz0r/Hoskins iterative-trig (Maxon Redshift FakeCaustics.osl, Apache-2.0)
      float caustic(vec2 uv,float time){
        vec2 p=mod(uv*6.28318530718,6.28318530718)-250.0; vec2 i=p; float c=1.0; const float inten=0.005;
        for(int n=0;n<4;n++){ float tt=time*(1.0-3.5/float(n+1));
          i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
          c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten))); }
        c/=4.0; c=1.17-pow(c,1.4); return pow(abs(c),8.0);
      }
```

- [ ] **Step 4: Replace the FBM caustic in `main()`.** Find:
```glsl
        float ca=fbm(uv*9.0+vec2(t*0.30,-t*0.22)); ca=pow(1.0-abs(ca-0.5)*2.0,3.0);
        vec3 uw=scene + uCyan*ca*0.42*water;
```
and replace with:
```glsl
        float ca=caustic(uv*vec2(uRes.x/uRes.y,1.0)*7.0, t*0.8);
        ca*=(1.0-smoothstep(0.0,0.55,uv.y));            // perspective floor fade
        vec3 uw=scene + uCyan*ca*0.42*water;            // additive, masked by `water`
```

- [ ] **Step 5: Verify the engulf shows crisp caustics.** Reload dev, then:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t1.png 9000 "window.__riverProgress && window.__riverProgress(0.78)"
```
Expected: no console/shader errors (`ERRORS (none)`); `/tmp/t1.png` > 200 KB; at p=0.78 the closing centre shows a crisp lacey caustic web (vs the old soft blur). Open it to confirm.

- [ ] **Step 6: Commit.**
```bash
git add src/scripts/river-scene.ts src/components/HeroRiver.tsx
git commit -m "feat(hero): crisp caustics + locked engulf params (Plunge Phase 2)"
```

---

## Task 2: Subtle depth-glow

Add a soft cyan surface-light wash, gated to the submersion, at the locked intensity 0.2.

**Files:**
- Modify: `src/scripts/river-scene.ts` (add `depthGlow()` after `caustic()`; add a call in `main()` after the foam lines)

- [ ] **Step 1: Add the `depthGlow()` function** right after the `caustic()` function added in Task 1. Find the closing line of `caustic`:
```glsl
        c/=4.0; c=1.17-pow(c,1.4); return pow(abs(c),8.0);
      }
```
and insert immediately after it:
```glsl
      // subtle volumetric light from the surface above (not god-rays); hand-written
      vec3 depthGlow(vec2 uv){ float v=smoothstep(1.25,-0.35,uv.y); float sh=0.7+0.3*fbm(uv*4.0+vec2(0.0,uTime*0.25));
        return uCyan*pow(v,2.0)*sh*0.6; }
```

- [ ] **Step 2: Call it in `main()` after the foam.** Find:
```glsl
        float foam=crest*smoothstep(0.45,0.8, fbm(uv*20.0+t*0.85));
        col+=foam*vec3(0.8,0.92,1.0)*uFoam*(0.5+0.6*sp);
        col=mix(col, uDeep, smoothstep(winEnd, min(winEnd+0.12,1.0), uProgress)*0.94);
```
and replace with (this also widens the end-window 0.12→0.18 for a longer dissolve; the flat-deep line is replaced fully in Task 3):
```glsl
        float foam=crest*smoothstep(0.45,0.8, fbm(uv*20.0+t*0.85));
        col+=foam*vec3(0.8,0.92,1.0)*uFoam*(0.5+0.6*sp);
        float gGate=smoothstep(0.55,0.95,uProgress);
        if(gGate>0.001) col+=depthGlow(uv)*gGate*0.2;   // 0.2 = locked subtle amount
        col=mix(col, uDeep, smoothstep(winEnd, min(winEnd+0.18,1.0), uProgress)*0.94);
```

- [ ] **Step 3: Verify the glow is present + subtle.** Reload, then:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t2.png 9000 "window.__riverProgress && window.__riverProgress(0.86)"
```
Expected: no errors; a faint cyan light wash from the top of the frame as it submerges (subtle, not a blob). Open to confirm.

- [ ] **Step 4: Commit.**
```bash
git add src/scripts/river-scene.ts
git commit -m "feat(hero): subtle depth-glow during submersion (Plunge Phase 2)"
```

---

## Task 3: Living-sea end-state

Resolve the engulf into an animated night ocean (horizon + moon-glint + Fresnel) instead of flat deep.

**Files:**
- Modify: `src/scripts/river-scene.ts` (add 4 functions after `depthGlow()`; replace the flat-deep end line in `main()`)

- [ ] **Step 1: Add the living-sea functions** right after the `depthGlow()` function from Task 2. Find:
```glsl
      vec3 depthGlow(vec2 uv){ float v=smoothstep(1.25,-0.35,uv.y); float sh=0.7+0.3*fbm(uv*4.0+vec2(0.0,uTime*0.25));
        return uCyan*pow(v,2.0)*sh*0.6; }
```
and insert immediately after it:
```glsl
      // living sea: clean-room exp(sin) FBM ocean (technique origin: afl_ext; reimplemented). iq + Ashima MIT.
      vec2 wavedx(vec2 p,vec2 d,float freq,float tt){ float x=dot(d,p)*freq+tt; float w=exp(sin(x)-1.0); return vec2(w,-w*cos(x)); }
      float seaWaves(vec2 p,int iters,float tt){ float f=1.0,spd=2.0,wt=1.0,sum=0.0,sw=0.0,ang=0.0;
        for(int i=0;i<8;i++){ if(i>=iters)break; vec2 d=vec2(sin(ang),cos(ang)); vec2 r=wavedx(p,d,f,tt*spd);
          p+=d*r.y*wt*0.30; sum+=r.x*wt; sw+=wt; wt=mix(wt,0.0,0.2); f*=1.18; spd*=1.07; ang+=12.0; } return sum/sw; }
      vec3 nightSky(vec3 rd){ float h=clamp(rd.y*0.5+0.5,0.0,1.0); vec3 sky=mix(uDeep*1.6,uDeep*0.6,h);
        vec3 L=normalize(vec3(0.35,0.12,-1.0)); float moon=pow(max(dot(rd,L),0.0),200.0); return sky+uCyan*moon*0.8; }
      vec3 livingSea(vec2 uv,float tt){
        vec2 s=(uv-0.5); s.x*=uRes.x/uRes.y; vec3 rd=normalize(vec3(s.x,s.y+0.18,-1.0));
        if(rd.y>-0.001) return nightSky(rd);
        float dist=-1.0/rd.y; vec3 hit=rd*dist; vec2 wp=hit.xz*0.6; float e=0.06;
        float H=seaWaves(wp,8,tt); float Hx=seaWaves(wp+vec2(e,0.0),8,tt); float Hy=seaWaves(wp+vec2(0.0,e),8,tt);
        vec3 N=normalize(vec3(H-Hx,e*2.0,H-Hy)); N=mix(N,vec3(0.0,1.0,0.0),0.8*min(1.0,sqrt(dist*0.01)*1.1));
        vec3 V=-rd,R=reflect(rd,N); R.y=abs(R.y); float F=0.04+0.96*pow(1.0-max(0.0,dot(N,V)),5.0);
        vec3 refl=nightSky(R); vec3 sss=uCyan*0.12*(0.2+H); vec3 c=mix(uDeep,refl,F)+sss;
        c+=smoothstep(0.85,1.0,H)*vec3(0.8,0.92,1.0)*0.5; return c; }
```

- [ ] **Step 2: Replace the flat-deep end in `main()` with the living-sea blend.** Find:
```glsl
        col=mix(col, uDeep, smoothstep(winEnd, min(winEnd+0.18,1.0), uProgress)*0.94);
```
and replace with (the `if(endMix>0.001)` guard is REQUIRED — the wave loop only runs the last ~5% of the scrub):
```glsl
        float endMix=smoothstep(winEnd, min(winEnd+0.18,1.0), uProgress);
        if(endMix>0.001) col=mix(col, livingSea(vUv,uTime*0.6), endMix);   // resolve into the night sea → seamless cut to 01
```

- [ ] **Step 3: Verify the sea end-state.** Reload, then:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t3.png 9000 "window.__riverProgress && window.__riverProgress(0.97)"
```
Expected: no errors; at p=0.97 a night sea with a horizon, a cyan moon-glow and its rippled reflection on the water (matches `previews/plunge.html` at 0.97). Open to confirm.

- [ ] **Step 4: Commit.**
```bash
git add src/scripts/river-scene.ts
git commit -m "feat(hero): living-sea end-state — engulf resolves into a night ocean (Plunge Phase 2)"
```

---

## Task 4: Strip debug hook, verify build + full sequence

**Files:**
- Modify: `src/components/HeroRiver.tsx` (remove the temp hook)

- [ ] **Step 1: Remove the temp hook** added in Task 1 (delete the `window.__riverProgress` line from `HeroRiver.tsx`). Confirm none left:
```bash
grep -n "__riverProgress" src/components/HeroRiver.tsx
```
Expected: no output.

- [ ] **Step 2: Production build green.**
```bash
npm run build
```
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Confirm the live scroll reads end-to-end.** Open `localhost:4321`, scroll the hero: river rotates + dollies, water engulfs with the crisp caustic web + subtle glow, resolves into the moonlit sea, hands off to 01 — no jank, no shader errors in the console.

- [ ] **Step 4: Commit (no-op if Step 1 already committed).**
```bash
git add src/components/HeroRiver.tsx
git commit -m "chore(hero): strip the dev progress hook (Plunge Phase 2 complete)"
```

---

## Self-Review

**1. Spec coverage:** caustics replace (Task 1 ✓), locked params uAmp 0.12 / uFoam 0.60 / uSpeed 1.8 (Task 1 Step 2 ✓), depth-glow @0.2 gated (Task 2 ✓), living-sea end-state with required `if(endMix>0.001)` guard (Task 3 ✓), no new uniforms / prototype toggles not ported (✓ — nothing adds uMode/uGod/uSea/uCau), tier-gate + reduced-motion unchanged (✓ — `splashPass.enabled=t<2` and the scroll gating are untouched), licenses cited in comments (✓). Rejected effects (god-rays/marine-snow/etc., dual-RT, ripple sim) correctly absent. No gaps.

**2. Placeholder scan:** No TBD/TODO; every code step shows the full GLSL block with exact find/replace anchors. Verification steps are visual (called out in Preconditions), with exact commands + expected outcome. ✓

**3. Type/name consistency:** `caustic` (Task 1) → called Task 1 Step 4 ✓. `depthGlow` (Task 2 Step 1) → called Task 2 Step 2 ✓. `wavedx/seaWaves/nightSky/livingSea` (Task 3 Step 1) → `livingSea` called Task 3 Step 2 ✓. Insert anchors chain correctly: caustic after `fbm`; depthGlow after caustic's `return pow(abs(c),8.0); }`; sea fns after depthGlow's `return …*sh*0.6; }`. The `endMix`/`gGate` locals are defined before use. Existing `uRes`, `uDeep`, `uCyan`, `uTime`, `uProgress`, `vUv`, `winEnd`, `sp`, `t` are all in scope. No collisions with the river grade shader (separate ShaderMaterial; these names live only in the splash pass).
