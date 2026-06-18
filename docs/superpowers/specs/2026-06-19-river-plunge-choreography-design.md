# Hero "Plunge" choreography — rotate → radial water engulf → 01

**Goal:** Replace the hero's camera-dive scroll beat with a cinematic one: as the user scrolls toward the 01/About section, the scanned river **rotates 90° clockwise (Y+Z)** while the camera dollies in, then **dark water irises in from every screen edge** and engulfs the frame, splashing into 01.

**Status:** Look + timing approved via live prototype `previews/plunge.html` (the visual source of truth). This spec ports that prototype into the production scene and defines phased "majestic" upgrades on top.

**Tech stack:** three.js 0.184 (vanilla) · EffectComposer post-processing · GSAP ScrollTrigger + Lenis (single scrub progress) · Astro island. No new heavy deps.

---

## Context — what exists today

The hero is a single scanned river model (`river = gltf.scene`; land + water are one captured mesh, water animated in-shader) rendered by `src/scripts/river-scene.ts` off the shared `gsap.ticker`. `src/components/HeroRiver.tsx` owns one `ScrollTrigger` over a sticky `#hero-track` (`src/components/Hero.astro`) that scrubs 0→1 into `scene.setScrollProgress(p)`. `tick()` is the **sole camera writer**.

Current `tick()` choreography (to be replaced):
- phase 1 dolly-in (z 16→8.5), phase 2 camera **dive** + cyan takeover, phase 3 **WaterDrop** ripple-dissolve ShaderPass (gl-transitions, MIT).

The river is currently added straight to the scene (`river.position.set(-cc.x*scl, -cc.y*scl-3.5, -cc.z*scl-5)`) with **no rotation** animated.

## What changes (summary)
1. **Wrap the river in a pivot Group** so it can rotate about its own visual centre (in place), not orbit the GLB origin.
2. **`tick()` phase 2 becomes rotate + dolly** (Y+Z to 90° CW) — the camera **dive block is removed**.
3. **Swap the `WaterDrop` ShaderPass for a new radial "engulf" shader** (FBM refraction + caustics + deep tint; foam off by default).
4. `HeroRiver.tsx` / `Hero.astro` are unchanged (same sticky track + scrub already feed `setScrollProgress`).

---

## Locked look (from the approved prototype)

| Param | Value | Notes |
|-------|-------|-------|
| Rotation axis | **Y + Z** | `rot.y = -p1·turn`, `rot.z = -p1·turn·0.5` (negative = clockwise from this camera) |
| Turn | **90°** | `turn = π/2`; Z roll is half (45°) |
| Dolly | y −1.5, z −8.5 over phase 1 | from base camera `(0, 6, 16)`, look `(0,-3.2,-7)` |
| Splash speed | **3.3** | engulf window `[0.56, winEnd]`, `winEnd = clamp(0.58 + 0.34/speed, 0.66, 0.96)` ≈ **0.68** |
| Ripple (uAmp) | **0.07** | FBM-normal refraction strength |
| Foam (uFoam) | **0.0** | crest foam OFF per art direction (keep uniform; default 0) |
| Deep colour (uDeep) | **#062028** | darker than the old teal |
| Engulf shape | **radial from all edges** | a dry centre circle that collapses to 0 |

### Phase map (single scrub progress `p` 0→1)
- **`p 0 → 0.55` — turn + dolly.** `p1 = smoothstep(p, 0, 0.55)`. `pivot.rotation.y = -p1·(π/2)`, `pivot.rotation.z = -p1·(π/4)`. `camera.position = (0, 6 − p1·1.5, 16 − p1·8.5)`, `lookAt(0,-3.2,-7)`. Splash shader passthrough (`uProgress<0.56` ⇒ water=0).
- **`p 0.56 → ~0.68` — engulf.** Splash shader active. Exposure lifts `1.0 + smoothstep(p,0.55,0.92)·0.35` (bloom catches the surface).
- **`p ~0.68 → 1.0` — submerged → reveal 01.** Frame settles to `uDeep`; About/01 (its night-ocean) is revealed beneath the sticky canvas (same uncover-beneath model as today).

---

## The radial-engulf shader (replaces WaterDrop ShaderPass)

A single fullscreen `ShaderPass` after `UnrealBloomPass`, before `OutputPass`. Uniforms: `tDiffuse, uProgress, uTime, uRes, uDeep, uCyan, uAmp, uFoam, uSpeed`. Note `ShaderPass` **clones** its uniforms — write `splashPass.uniforms.X.value` in `tick()`, not the source object (a bug already fixed once in this codebase).

Algorithm (verbatim from the approved prototype — see `previews/plunge.html`):
1. `sp = smoothstep(uProgress, 0.56, winEnd)`; `winEnd = clamp(0.58 + 0.34/uSpeed, 0.66, 0.96)`.
2. **Radial mask:** aspect-corrected `dist = length((uv-0.5)·vec2(aspect,1))`; `dry = mix(1.22, -0.06, sp)`; `water = smoothstep(dry, dry+0.22, dist)` (1 at outer edges, 0 in the shrinking dry centre); `crest = smoothstep(0.22, 0, abs(dist-dry))`.
3. **Refraction:** FBM-height normal `n`; sample `tDiffuse` at `uv + n·(uAmp·water + 1.8·uAmp·crest)`.
4. **Caustics:** `ca = pow(1 - abs(fbm(...)-0.5)·2, 3)`; add `uCyan·ca·0.42·water`.
5. **Tint:** `mix(scene, uDeep, water·(0.42 + 0.45·sp))`.
6. **Foam (off):** `crest · fbm(...) · uFoam` (uFoam=0 ships clean).
7. **Submersion:** `mix(col, uDeep, smoothstep(uProgress, winEnd, winEnd+0.12)·0.94)`.

**Noise source:** inline Ashima/McEwan `snoise` + 4-octave `fbm` (**MIT** — or pull from **LYGIA**, MIT). No Shadertoy code (default CC-BY-**NC** = unusable on a commercial site).

---

## Files & changes

**`src/scripts/river-scene.ts`**
- **Pivot:** on load, create `pivot = new THREE.Group()`; set `river.position` so the model centre sits at the pivot origin; `pivot.position.set(0, -3.5, -5)`; `scene.add(pivot)`; `pivot.add(river)`. (Replaces the current direct `scene.add(river)` + offset position.)
- **`tick()`:** remove the dive block; add `pivot.rotation.y/z` from `p1`; keep the dolly; set `splashPass.uniforms.uProgress/uTime/uRes/...`. Keep `tick()` the sole camera writer.
- **Passes:** delete the `WaterDrop` ShaderPass; add the radial-engulf ShaderPass (uniforms above). Add it to `dispose()`.
- **Tiers:** the splash pass is enabled on tier 0–1, skipped on tier 2 (mobile/minimal) — matches the existing `t < 2` gate.

**`src/components/HeroRiver.tsx`**, **`src/components/Hero.astro`** — no change (sticky `#hero-track` + scrub + `matchMedia` gating already in place). reduced-motion / `<768px` already collapse to a static hero.

---

## Production upgrades (phased — Phase 2, on top of the approved look)

Ship the faithful prototype port first (Phase 1), then layer these without changing the approved aesthetic:
- **Dual render-target "emerge":** render the About night-ocean to an FBO and `mix()` it in as the water clears, so 01 genuinely *rises through* the water instead of a tint-cut. (fernandojsg crossfade + Maxime Heckel render-target ping-pong; MIT/open.) Gate RT rendering to `uProgress>0` for perf.
- **Reactive ping-pong ripples:** a quarter-res height-field (Verlet/Laplacian) stamped at the river mouth so waves propagate/reflect at impact. (**DCtheTall/webgl-ripple, Apache-2.0** ✅.) Desktop-only; mobile keeps FBM ripples.
- **Sharper caustics + subtle god-rays** underwater near the end of the engulf.

All Phase-2 pieces are perf-gated to the transition window and desktop-tier only; mobile/reduced-motion never build them.

## OSS / licensing
- Noise: **LYGIA / Ashima snoise** — MIT ✅
- Ripple sim: **DCtheTall/webgl-ripple** — Apache-2.0 ✅
- three.js `Water`/render-targets — MIT ✅
- **Avoid:** Shadertoy water/caustics/“Heartfelt” (CC-BY-NC = non-commercial, unusable). Reference only.

## Degradation & perf
- **reduced-motion / `<768px`:** no rotation, no splash — static hero (unchanged gate).
- **Tiers:** splash pass on tier 0–1; tier 2 skips it (dolly/rotate only or static). Phase-2 upgrades desktop-tier only.
- 60fps target: FBM octaves ≤4 (≤2 on lower tiers); engulf is one fullscreen pass; Phase-2 RT/sim gated to the active transition.

## Verification
1. Headless (`/tmp/cdpshot.mjs`) drive `setScrollProgress` at p = 0 / 0.4 / 0.62 / 0.7 / 1.0 → confirm rotate→radial-engulf→submerge, no shader errors, frame settles to `#062028` near p=1.
2. Live scroll on `:4321`: smooth rotate + dolly, radial water close-in from all edges, hand-off reveals About; no jank / blank-space / double-scroll over the sticky track.
3. reduced-motion + narrow viewport → static hero (no rotation/splash).
4. `npm run build` green; About ocean still boots.

## Out of scope
- Climate-Clock riverbed data points; far-edge depth rounding; any About-section redesign. The hand-off still *uncovers* the existing About section (no change to About itself in Phase 1).
