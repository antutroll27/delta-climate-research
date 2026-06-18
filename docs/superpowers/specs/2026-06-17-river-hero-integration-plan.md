# River hero → production integration — research-backed plan

**Date:** 2026-06-17 · **Source:** 7-agent deep-research workflow (research → adversarial verify → synthesis), all 3 load-bearing claims HELD. Verdicts at bottom.

The four asks: (1) user-specified camera, (2) awwwards scroll-dolly-"splash" into About, (3) riverbed data points from the "Time Left" API, (4) round the far ragged edges.

---

## Architecture — `src/components/HeroRiver.tsx` (vanilla three island)
Port `previews/hero-river-native.html` **verbatim** into a `client:visible` React island following the existing `VortexShader.tsx` shell (IntersectionObserver gate w/ rootMargin, `visibilitychange` pause, `webglcontextlost` handler, full dispose on unmount). Mounted in `Hero.astro` behind a poster/loading state.

Three structural changes from the preview:
1. **Delete the private `requestAnimationFrame` loop.** Export an imperative `tick(dt)` and register it with `gsap.ticker.add` inside the effect → the river renders off the **same single ticker** that already drives Lenis in `src/scripts/smooth-scroll.ts`. **No second Lenis, no second RAF.** Keep the FPS-adaptive downgrade, computed from ticker time inside `tick()`.
2. **Render-gating:** `comp.render()` runs only when on-screen AND (ScrollTrigger active/scrubbing OR a shader is animating OR the splash is in-flight). Pinned-out/off-screen → early return (idle hero ≈ free).
3. **Resolve assets from `/public`** (no importmap/unpkg/localhost:8099); real `three@0.184` from node_modules + `three/examples/jsm` addons.

Keep everything else: GLTFLoader+Meshopt, `gradeMaterial` onBeforeCompile (flow-field, foam, fresnel rim, edge-feather), the 3-tier `TIERS` ladder + `pickInitialTier`/`applyTier`, EffectComposer/Bloom/Output, PMREM, FogExp2, `STRIP_MIN/STRIP_MAX`. Expose imperative refs (camera proxy, splash uniform, facts API) so the scroll module drives it **without React re-renders** (refs + uniforms, never per-frame setState). **Reduced motion** (`motionOK()`): one static framed shot, no ticker/pin/scrub/splash, facts placed statically — mirrors `smooth-scroll.ts`'s early-return.

## Scroll transition — one pinned numeric-scrub ScrollTrigger ("dolly spine")
Init **after** island mount → `ScrollTrigger.refresh()`, `invalidateOnRefresh:true`. Pin the hero ~1 viewport, `scrub:0.6`, `start:'top top'`, `end:'+=100%'`. Never animate the pinned transform — tween a **proxy** `{ z, fov, lookAtY, splash }` (`ease:'none'`) and each ticker tick copy proxy→camera:
- `camera.position.z` dolly `16 → ~9-10` (river comes **closer**),
- `camera.fov 40 → ~46` (Δ<8° → no nausea), `updateProjectionMatrix()`,
- `look.y = proxy.lookAtY` slight tilt, then `camera.lookAt(look)`; keep tiny pointer parallax on x/y.

**Splash** (last ~25%): drive `proxy.splash 0→1` into a new **ripple-dissolve `ShaderPass`** added after Bloom+OutputPass (samples the composed scene; radial ripple `sin(d*38 - t - p*10)*0.012*(1-d)`, then `mix(#050606, rippledScene, smoothstep(...))`) → the river dissolves outward into the brand base exactly like the silhouette feather, while **About scrolls up beneath the pinned canvas**. Canvas also scrubs `scale 1.0→1.06 + autoAlpha→0` in the final sliver (seamless even if the splash pass is off). **Minimal tier / fallback:** skip the GLSL ripple, do the compositor-only crossfade. **Reduced motion:** no pin/scrub/splash; About is a normal section below. All driven by ScrollTrigger progress (never `scrollY`), off the single ticker.

## Edge rounding — depth-gate the existing feather
Extend (don't replace) the `<dithering_fragment>` grazing feather so it's **depth-selective** — rounds only the FAR ragged perimeter, leaves near banks + water untouched (near bank ~4 units, far ~38 → ~10× depth ratio). Add `w = smoothstep(nearDist, farDist, length(vViewPosition))` (and/or a screen-Y band), then `ef = smoothstep(0, mix(uEdgeFade, uEdgeFadeFar, w), graze)` with `uEdgeFadeFar > uEdgeFade`. Bonus: it darkens the far fresnel rim to #050606 **before** the composer, so Bloom (threshold 0.78) can't smear the ragged rim. **Optional** reinforcement only if still itchy: re-bake a **bed-FOOTPRINT** boundary mask from `bake-river-flow.mjs`'s `fill`/elevation raster (NOT the `river-flow.png` alpha — that's the WATER channel, 0 over the dry banks we want to round), sample in object space, fade the true geometric boundary.

## Data points — DOM overlay facts from Climate Clock v2
**Source = Climate Clock v2 API** (`GET https://api.climateclock.world/v2/clock.json`) — verified 2026-06-17: 200, `access-control-allow-origin: *`, no key. **Pattern:** Astro **build-time fetch** → typed `facts.json` (committed as offline fallback + first paint) + optional client re-fetch on mount. Store `initial/rate/timestamp` per value module and recompute `value = initial + rate*(now - timestamp)` each second so digits tick live offline.
**Render:** HTML/DOM labels (NOT Sprites/CSS2DRenderer) in a `pointer-events:none` layer above the canvas, below nav. 4-6 anchor points in **object space** on the bed → `× river.matrixWorld` → `.project(camera)` each tick (guard behind-camera via clip w/z sign, hide `|ndc|>1`), `translate3d`. **Opacity modulated by fog factor** `exp(-(0.02·dist)²)` so facts dissolve into the base like the river edge. GSAP per-fact state machine: in (opacity 0→1 + rise 12px, ~1.2-1.6s ease-out) → hold ~3-5s → out; 1-2 visible at once, **gated by dolly scroll progress + a timer**. Facts: `carbon_deadline_1` countdown ("time left to 1.5°C"), `renewables_1` %, `loss_damage_*` $; `solution_labels` read as ready facts; **skip `newsfeed_1`** (political). Show "Data: Climate Clock" attribution.

## Build order
1. **Camera lock FIRST** — sign off start pos / look / fov from the preview. Nothing proceeds until frozen.
2. **Island port** — HeroRiver.tsx (VortexShader shell), gsap.ticker, /public assets, tiers, reduced-motion static, poster. Verify 60fps + clean teardown.
3. **Render-gating** — composer renders only when animating/visible.
4. **Scroll transition** — pinned scrub, proxy→camera dolly, splash ShaderPass + crossfade fallback, reveal About, gate on motionOK.
5. **Edge rounding** — depth-gated feather (`uEdgeFadeFar`); bed-footprint mask only if needed.
6. **Data points** — build-time facts.json, DOM overlay, object→world→project anchors, GSAP in/hold/out, live digits, attribution; throttle + fewer labels on mobile.

## Top risks (mitigations in full output)
Two RAF/Lenis loops (→ single ticker + render-gate); `project()` garbage behind camera (→ clip-sign guard); object-vs-world anchor space (→ ×matrixWorld, mirror-x); feather eating near banks (→ depth gate); wrong edge mask (→ bed footprint, not water alpha); Climate Clock down/CORS revoked (→ build-time bake fallback); ScrollTrigger pin measured pre-mount (→ refresh after mount).

## Open questions for the user (decide as we reach each step)
- Scroll length: exactly 1 viewport (`+=100%`) vs longer scrub for a slower reveal.
- Splash trigger: last ~25% vs only at full "close."
- **Facts tone (brand call):** carbon-deadline + renewables feel safe; the $debt/loss&damage counters read more activist — include or not? Live-ticking digits vs static rounded figures?
- Attribution placement (hero corner / near facts / footer).
- Facts visible at once + pacing (proposed 1-2, ~3-5s hold); decorative vs linkable.
- Edge rounding intensity (vs keeping some photogrammetry character).
- Poster: baked static first-paint image vs current dark base + "loading river scan…".

## Verdicts
1. Scroll-dolly-splash at 60fps off the single ticker — **HOLDS (high)**; needs the unbuilt render-gating + splash-overlap coordination.
2. Time Left API real + browser-usable (or build-time bake) + anchored DOM facts — **HOLDS (high)**; live-tested today.
3. Far edges roundable via depth-gated shader feather (+ optional bed mask) without eating near banks/water — **HOLDS (medium-high)**; mask must be the bed footprint, not the water alpha.
