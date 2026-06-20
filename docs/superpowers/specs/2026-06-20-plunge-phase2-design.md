# Hero Plunge — Phase 2 (richer engulf) Design

**Status:** Approved (prototype-validated). **Date:** 2026-06-20. **Branch target:** `feat/river-plunge-phase2` (off `main`).

## Goal
Enrich the Phase-1 radial water-engulf with two in-shader effects and resolve it into a believable night sea, so the cut into the 01/About section feels seamless and majestic — without changing the architecture.

## Scope (locked after live prototyping in `previews/plunge.html`)
Three additions, all folded into the SINGLE existing engulf `ShaderPass` in `src/scripts/river-scene.ts` (no new render target, no second scene, no ping-pong sim, no layout change):

1. **Crisp caustics** — replace the soft ridged-FBM caustic with an iterative-trig Voronoi-style caustic, full strength, masked to the submerged region.
2. **Subtle depth-glow** — a soft cyan light wash bleeding down from the surface (NOT god-rays/shafts), low intensity, gated to the submersion.
3. **Living-sea end-state** — the engulf resolves into an animated night ocean (horizon + moon-glint + Fresnel reflection) instead of flat deep, matching About's night-ocean for an invisible scroll hand-off.

**Locked look values** (from the approved prototype panel):
- Atmosphere = **Depth Glow @ 0.2** (subtle). Caustics = **1.0** (full new caustic). Living-sea = **on**.
- Engulf params: **ripple `uAmp` 0.12**, **foam `uFoam` 0.60**, **speed `uSpeed` 1.8**, rotation **Y 90° / Z 45°** (unchanged from Phase 1).

### Explicitly rejected during prototyping (do NOT build)
God-rays / light shafts, marine snow, light streaks (radial zoom-blur), bubbles (all were prototyped as alternative "atmosphere" modes and not chosen); dual-RT on-canvas emerge; reactive ping-pong ripple sim. The prototype's `uMode` selector + the unused mode functions (`godrays`, `marineSnow`, `lightStreaks`, `bubbles`) are prototype-only and are NOT ported to production.

## Architecture
The engulf `ShaderPass` (one fullscreen fragment, runs AFTER `UnrealBloomPass`, currently ends `col=mix(col,uDeep,…)`) gains three additions. Source of truth = `previews/plunge.html` (the approved build). Production = `src/scripts/river-scene.ts`. `HeroRiver.tsx` / `Hero.astro` unchanged. Already desktop-tier-gated (`splashPass.enabled = t < 2`).

### New uniforms (production)
**None.** Bake the locked values as GLSL constants (depth-glow `0.2`, caustics full, living-sea on). Reuse existing `uCyan`, `uDeep`, `uRes`, `uTime`, `uProgress`. The prototype's `uMode`/`uGod`/`uSea`/`uCau` toggles are NOT ported.

### Effect 1 — Caustics (REPLACE the ridged caustic)
**License:** port of `Maxon-Computer Redshift-OSL-Shaders/FakeCaustics.osl` — cite the in-file **Apache-2.0** header (repo has no top-level LICENSE; rely on the per-file header). Keep the joltz0r / David Hoskins / Saul Espinosa attribution comment. Do NOT copy ShaderToy `MdlXz8` (CC BY-NC-SA).
```glsl
float caustic(vec2 uv,float time){
  vec2 p=mod(uv*6.28318530718,6.28318530718)-250.0; vec2 i=p; float c=1.0; const float inten=0.005;
  for(int n=0;n<4;n++){ float tt=time*(1.0-3.5/float(n+1));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten))); }
  c/=4.0; c=1.17-pow(c,1.4); return pow(abs(c),8.0);
}
```
Replace the current caustic lines with:
```glsl
float ca=caustic(uv*vec2(uRes.x/uRes.y,1.0)*7.0, t*0.8);
ca*=(1.0-smoothstep(0.0,0.55,uv.y));            // perspective floor fade
vec3 uw=scene + uCyan*ca*0.42*water;            // additive, masked by `water`
```

### Effect 2 — Depth glow (subtle, additive)
Hand-written; no external source. Add the function + a gated additive call before the end-state:
```glsl
vec3 depthGlow(vec2 uv){ float v=smoothstep(1.25,-0.35,uv.y); float sh=0.7+0.3*fbm(uv*4.0+vec2(0.0,uTime*0.25));
  return uCyan*pow(v,2.0)*sh*0.6; }
// …in main(), after foam:
float gGate=smoothstep(0.55,0.95,uProgress);
if(gGate>0.001) col+=depthGlow(uv)*gGate*0.2;   // 0.2 = the locked subtle amount
```

### Effect 3 — Living-sea end-state (REPLACE the flat-deep crush)
**License:** clean-room reimplementation of the `exp(sin)` FBM-wave technique (origin: afl_ext `MdXyzX`, CC BY-NC-SA — technique only). **Do NOT** copy afl_ext or the `MiniMax-AI/skills` water-ocean file (verified to contain afl_ext's `getwaves`/`wavedx` verbatim under an invalid MIT relicense — a laundering trap). Ship the reimplemented `wavedx/seaWaves/nightSky/livingSea` below; credit afl_ext as technique origin; iq (MIT) + Ashima snoise (MIT) already in the shader.
```glsl
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
// replace the final flat-deep line with (guard REQUIRED for perf):
float endMix=smoothstep(winEnd, min(winEnd+0.18,1.0), uProgress);
if(endMix>0.001) col=mix(col, livingSea(vUv,uTime*0.6), endMix);
```

## Performance / degradation
- The whole effect stays one fullscreen pass; already gated to desktop (`splashPass.enabled = t<2`).
- `livingSea` (the only heavy part: 8-iter × 3-tap wave loop) MUST stay behind `if(endMix>0.001)` so it only runs the last ~5% of the scrub; the in-function horizon early-out keeps sky pixels cheap. Verified 60fps-safe on M-series / RTX 3060 at 1440p with bloom.
- Reduced-motion / mobile: unchanged (no engulf builds; `scrollP=0`).

## Verification (visual, headless)
Drive `window.__riverProgress(p)` (temp hook, as in Phase 1) and screenshot p = 0.7 / 0.84 / 0.96: confirm crisp caustic web in the closing centre, subtle glow, and the moonlit living-sea end-state — matching `previews/plunge.html` at the same progress. No console/shader errors; `npm run build` green.

## Out of scope (future)
Dual-RT on-canvas emerge; reactive ripple sim; the rejected atmosphere modes. Bio/team copy unrelated.
