# Hero "3D River + Procedural Flora" — research & build plan

Deep-research synthesis (12-agent workflow, web-verified) for the CEO's vision:
a 3D animated river flowing horizontally across the hero behind the text/clock,
surrounded by trees/flora/fauna that **spawn on hover** (desktop) / on
**interaction + scroll** (mobile). Target: Awwwards-level, performant, graceful
degradation.

## Stack decision — VANILLA three.js (no react-three-fiber)
- Build as a new `client:visible` React island (`RiverScene.tsx`) that clones
  the proven `VortexShader.tsx` lifecycle (IntersectionObserver pause,
  visibilitychange, webglcontextlost, reduced-motion single-frame, DPR clamp,
  full dispose). three is already **0.184** in the repo.
- **Avoid R3F**: verified that `@react-three/fiber` 9.6.1 peer-restricts React to
  `>=19 <19.3` (repo is on 19.2.x — works today but a 19.3 bump would break it),
  and it would add a second authoring paradigm + reconciler bundle behind the
  hero LCP for zero gain on one backdrop element.
- **Only package to add:** vanilla `postprocessing@6.39.1` (pmndrs) for the
  merged EffectPass mood layer. Its peer is three `>=0.168 <0.185` → pin three
  `<0.185` (repo's 0.184 is in range; treat them as a coupled pair).

## River — custom shader ribbon (NOT Water2, NOT Gerstner)
Flat elongated `PlaneGeometry`, low-tilt `PerspectiveCamera`, custom
`ShaderMaterial`: dual scrolling simplex-noise layers lerped at a half-cycle
phase offset (kills visible reset), cyan `#6fcad6` fresnel rim, sparse bronze
`#b08d57` speculars over a near-black `#050606` body, `FogExp2` dissolving into
the brand base near the horizon. One draw call, zero render targets. Lenis
scroll velocity → flow-speed uniform. (Water2 carries reflection/refraction
render targets that read "too realistic" — rejected per the locked minimal
aesthetic.)

## Flora — capped InstancedMesh pools, allocation-free spawn
- One `InstancedMesh` per species (cross-quad grass, low-poly tree, leaf),
  pre-allocated MAX (~3000 desktop / ~800 mobile), grow `mesh.count` on spawn,
  ring-buffer recycle oldest.
- **Spawn (hover):** `pointermove` → reuse ONE `Raycaster` + math `Plane(0,1,0)`
  + `Vector3` → `ray.intersectPlane` (no mesh traversal, no `new` in handler) →
  **distance-gate** (`minGap`) + **time-throttle** (~80–120ms) → `setMatrixAt`
  with scale 0.001.
- **Growth + wind** are GPU-side: per-instance `aBirth` attribute + single
  `uTime` uniform grow scale (back.out ease baked in shader); root-anchored sway
  (bottom verts fixed). Reduced-motion = zero amplitude, no teardown.
- **Fauna:** one additive `Points` cloud (cyan fireflies / bronze pollen)
  drifting in the vertex shader + a tiny two-quad butterfly InstancedMesh.

## Mobile — scroll-spawn
`matchMedia('(pointer:coarse)')` swaps hover-spawn for Lenis/ScrollTrigger
**scroll-spawn** (a spawn point walks across the river as scroll advances, banks
grow in); touch-drag `pointermove` still works. Lower MAX, harder throttle, DPR
1.0–1.5, rAF paused off-screen. Gyro is opt-in behind a tap only.

## Mood / post — ONE merged EffectPass
RenderPass → single merged `EffectPass`: high-threshold selective **Bloom**
(only cyan speculars/fireflies glow, keeps `#050606` inky + protects text
contrast), **Vignette**, **LUT3D** cyan→bronze grade, a whisper of
ChromaticAberration. Keep CSS grain at z-1 (decouple from GL budget). **No DoF on
mobile** — fake focus with FogExp2. Entrance: GSAP-tween scene uniforms (fog
density, left→right `uReveal` wipe, bloom 0→1, camera dolly) ~1.2–2s, synced to
the existing `.word` text stagger.

## Performance & a11y guardrails
~4–6 draw calls total. `antialias:false, depth:true, alpha:true`, DPR clamp 1.5
(adaptive downscale on FPS sag), pause off-screen/tab-hidden, full dispose. Pure
procedural — **no GLTF/textures** (zero KTX2/Draco budget, leaner + on-brand).
Reduced-motion = pre-seeded static scatter + one frame + stop; baked poster
`hero-river-poster.webp` for no-JS / no-WebGL / context-lost (LCP paints from
static markup; WebGL streams in behind).

## Three preview directions
1. **Inkwater Ribbon** (recommended baseline) — dark glassy cyan ribbon, minimal
   flora that grows on hover, a few slow fireflies. Quiet/editorial, lightest,
   closest to the locked minimal aesthetic.
2. **Living Banks** — flora is the hero: hovering paints dense grass/trees that
   rise (back.out) + sway, butterflies + pollen; water recessive. Truest to the
   CEO's "trees that spawn on hover" brief; highest interaction wow.
3. **Graded Current** — full post stack: tilt-shift, selective bloom, cyan→bronze
   LUT, grain, subtle CA, scroll-reactive flow. Most cinematic; risk of muddying
   the near-black ground / text contrast if overdone.

## CRITICAL decision to confirm
The river should **replace** the VortexShader on the hero — do **not** stack two
full-screen WebGL contexts behind the same fold (doubles GPU/context cost). The
vortex stays available for other sections.

## Curated resources
- Ronja — Flowing River (directional UV scroll + dual-layer anti-tiling): https://www.ronja-tutorials.com/post/033-river/
- Codrops — Stylized Water with R3F (lift the GLSL: noise surface + painted waterline foam): https://tympanus.net/codrops/2025/03/04/creating-stylized-water-effects-with-react-three-fiber/
- three.js Water2.js (flow-map math reference IF the ribbon must curve; export is named `Water`): https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js
- three.js Raycaster `ray.intersectPlane` (allocation-free hover→ground spawn): https://threejs.org/docs/pages/Raycaster.html
- al-ro — Instanced grass with wind (root-anchored sway vertex shader): https://al-ro.github.io/projects/grass/
- Three.js Journey — Animated Galaxy / Fireflies (Points + ShaderMaterial fauna): https://threejs-journey.com/lessons/animated-galaxy
- pmndrs/postprocessing (merged EffectPass; v6.39.1, peer three `<0.185`): https://github.com/pmndrs/postprocessing
- Codrops — Building Efficient three.js Scenes (DPR cap, gl flags, frameloop): https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/
- Codrops — Astro + three.js + GSAP scroll (Lenis→gsap.ticker single loop, uProgress reveal): https://tympanus.net/codrops/2026/02/02/building-a-scroll-revealed-webgl-gallery-with-gsap-three-js-astro-and-barba-js/
