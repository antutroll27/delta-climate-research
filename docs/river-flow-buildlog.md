# Building an Awwwards-grade animated river for the Delta hero — a build log

> A behind-the-scenes record of how the hero river went from "global +X scroll" to a
> channel-following flow-field that actually flows *along* a photogrammetry-scanned river.
> Written for two audiences: the engineer who picks this up next, and the version of me/you
> that wants to turn it into a LinkedIn post. Dates are 2026-06.

---

## TL;DR

The CEO wanted a 3D river flowing horizontally across the hero, with flora that spawns on hover —
"Awwwards level." We tried a lot of clever things that looked like slop, then the breakthrough was
realising **the photogrammetry scan already *contained* a river** — water baked into the geometry and
texture. So instead of faking water, we **animate the scan's own water in-place**.

The hard part — making it flow *along* the meandering channel instead of a flat global direction —
was solved by **baking a flow-field from the mesh's valley floor (lowest elevation), not from the
water's colour**. That single insight came not from a tutorial but from a research agent **measuring
the actual asset**.

Result: a real flowing river at ~85fps from a **17KB** flow-map texture. No fluid sim, no overlay,
no Blender.

---

## The brief

- A 3D animated **river flowing horizontally** across the hero, behind the headline.
- Surrounded by **flora/fauna that spawns when the user hovers** (and on interaction/scroll on mobile).
- **Awwwards-level**, performant, on-brand (dark editorial: near-black `#050606`, cyan `#6fcad6`,
  bronze `#b08d57`, fog + bloom + ACES).

---

## The dead ends (and why they died)

Honest accounting, because the failures are the most useful part.

| Attempt | Why it died |
|---|---|
| **Procedural river + procedural flora** (pure shader primitives) | "ALL 3 look horrible." Procedural primitives read as cheap/gamey. |
| **Separate animated water plane / ribbon overlay** | The "ribbon laid on top" problem — water sat *over* the terrain, never *in* it. |
| **three.js `Water2`** (planar reflection/refraction) | Carries reflection+refraction render targets; reads "too realistic" against the locked minimal aesthetic. |
| **Live GPU fluid sim** (`GPUComputationRenderer` height-field) | A/B'd it. Behind fog + ACES + bloom at distance, the gain over a flow shader is near-zero. The wave equation also ripples *in place* — no downstream advection. Rejected as too subtle for the cost. |
| **Blender-baked fluid → import** | glTF physically cannot carry topology-changing fluid. The workarounds (Alembic mesh-cache, VAT) are tens of MB, can't loop seamlessly, and are non-interactive — strictly worse than the shader for this job. |
| **Procedural cone-flora** | "Looks very weird, revert." Real low-poly plant GLBs were the fix (later thread). |

**Lesson:** for a fogged, behind-text hero, the realism that survives the pipeline is the *perturbed
normals catching the rim light* — not literal simulated mass. Spend effort there.

---

## The breakthrough (the client's own idea)

> "The 3D model that I loaded already has water. Check it out."

A top-down render confirmed it: the scan is a long strip (≈221×11×63 units) with the **river running
straight down the middle**, water captured in both the geometry and the albedo. Everything we'd been
bolting on was reinventing what was already baked in.

**New approach:** detect the scan's water in-shader and animate *only* those texels — leaving the
banks as the natural low-grade look. Plus reframe the camera to a **drone angle** so the channel runs
horizontally behind the headline. No overlay, no sim. Confinement is free, because the water is exactly
where the photogrammetry put it.

This shipped and the client liked it — but the flow was a **flat global +X scroll**, which has three
tells:
1. **Direction is global.** The river *meanders*; "+X" flows diagonally across the banks on bends.
2. **Uniform speed.** Real rivers speed up in narrows, pool in the wide parts, churn at rapids.
3. **Swimming/stretching.** Single-phase UV scroll visibly repeats and resets.

Fixing those three is "the flow algorithm upgrade" — the meat of this log.

---

## The research method (why it "ran for 20 hours")

The upgrade was scoped by a **multi-agent research workflow** run *in the background* while normal
work continued. The "20 hours" is wall-clock — it idled across an entire working session. Actual
compute for the deciding run: **7 sub-agents, ~466K tokens, 146 tool calls** (a few hours of agent
work, not 20). It ran in three phases:

1. **Research fan-out** — 3 agents in parallel, each on a different angle:
   - best flow-aligned water shader technique (anti-swimming),
   - how to *bake* a channel flow-field from our specific scan,
   - a no-bake, runtime-only alternative.
2. **Adversarial verification** — 3 agents whose *job was to refute* the findings. This is what killed
   the runtime-gradient idea and forced the "elevation, not colour" pivot.
3. **Synthesis** — one lead agent merging it into the build plan that was actually followed.

(Earlier threads used the same pattern for the GPU-fluid go/no-go and the Blender question.)

---

## The two insights that actually mattered — from measuring the asset, not the web

The tutorials told us the *shape* of the answer. The **load-bearing decisions came from an agent
decoding the real `.glb` and measuring it.**

### Insight 1 — bake the channel from ELEVATION, not colour
The obvious move is to find the water by its colour (teal/grey) and trace a centerline. The agent
measured the albedo water-mask and proved it's unusable for that: it fires on **<1% of texels**, in
**~45–205 disconnected blobs** (a photogrammetry atlas of disconnected UV islands). You cannot
skeletonise confetti.

But the **valley floor** — the per-cell *minimum Y* (lowest geometry) — is **one clean connected
ribbon** that traces the channel perfectly. So we bake the flow-field from elevation.

A runtime mask-gradient was also formally rejected: `grad(mask)` only gives the *unsigned* bank-normal
axis; the *downstream* sign is information not present in a single frame, so no runtime trick can
recover it. The offline bake supplies that global sign once, by walking the centerline.

### Insight 2 — sample the flow-map in OBJECT space, not world space
The live scene rescales the GLB (`120/sizeX`), recenters it, and mirror-flips alternate tiles. So
`vWPos.xz` (world position) is an **unstable** key for a fixed texture. The fix is a new object-space
varying `vLocalXZ3 = transformed` (the raw geometry position, *before* the model matrix), normalised by
the model-space bbox. Invariant to all three transforms — and mirrored tiles correctly mirror their
flow.

---

## The build

### The bake (`scripts/bake-river-flow.mjs`)
Node + `gltf-transform` (read positions) + `sharp` (write PNG):
1. Read `POSITION` from `river-2k.glb`; compute the model-space XZ bbox.
2. Rasterise a **min-Y valley-floor heightfield** into a 256×128 grid (vertex-splat + dilation fill).
3. Threshold the lowest ~35% of bed elevation → channel mask → keep the **largest connected
   component** (auto-excludes the dry-left third and isolated low spots).
4. **Per-column Z-centroid centerline** (the river runs along X, so the channel center is a function
   `z = f(x)`); smooth it; the **downstream tangent** is its finite difference, oriented consistently
   to +X — which solves the global sign problem trivially because the river is roughly axis-aligned.
5. **Speed** from local channel width (narrow → fast). **Presence** from the blurred mask.
6. Blur direction and speed *separately*, **renormalise RG to unit length** (or speed leaks into
   direction and the current looks lumpy).
7. Encode `RG = downstream unit tangent`, `B = speed`, `A = presence` → `public/textures/river-flow.png`
   (**17KB**).

### The shader (`previews/hero-river-native.html`, `gradeMaterial` `onBeforeCompile`)
Per water fragment, replacing the old global +X scroll:
- Sample the flow-map by `fuv = (vLocalXZ3.xz - stripMin)/(stripMax - stripMin)`.
- **Presence (A) is the primary water mask** — gate flow by `gChan`, not the sparse colour detector.
- **Directional flow:** rotate the ripple tile by the flow vector (`mat2(dir.y,dir.x,-dir.x,dir.y)`),
  anisotropic along-flow. Catlike Coding's directional-flow trick.
- **Two-phase advection:** sample the normal map at `phase` and `phase+0.5`, crossfade by
  `1-abs(1-2·frac(t))`, plus a per-texel time **jitter** from a noise tap — kills the swimming/reset.
- **Speed** scales `t` (and tiling) so narrows churn faster.
- **Foam** at the channel-edge waterline + rapids, scrolled along flow.
- Flow-aligned glint streaks travel **downstream** (`dot(localXZ, dir)`), band-limited to avoid
  aliasing through the headline.

Cost: ~6–8 texture taps + one `mat2`. ~85fps on an M4 (headless).

---

## Debugging war stories (the relatable bit)

- **PNG, not WebP.** The flow texture was first written as lossless WebP-with-alpha. Chrome decoded it
  as **white everywhere** — silently breaking the whole field (every pixel read "channel, full speed").
  The file was perfect; the browser's decoder wasn't. Switching to PNG fixed it instantly. *Data
  textures: prefer PNG.*
- **The phantom misalignment.** A lighting-free debug override made the baked channel look offset onto
  the upper bank — I nearly re-baked it. The channel was actually *dead-on the water*; the bug was the
  debug view, not the data. Proof came from **blending the channel tint over the lit scene** instead of
  replacing it. *Trust the overlay that keeps the reference visible.*
- **The starved flow.** First wiring gated flow by `gWater · gChan`. Because the colour detector fires
  on <1% of texels, it zeroed almost everything — motion diff went from 0.92 (expected) down to ~0 in
  the channel. Switching the gate to `gChan` (baked presence) alone took channel motion to ~29. *The
  baked mask is the source of truth, not the fragile per-fragment detector.*

Every claim above was verified **in-engine** with the headless Chrome harness: bake → alignment
overlay → two-timepoint motion diffs → FPS probes → screenshots.

---

## Sources

### Bucket 1 — the flow-water canon (technique leads)
- **Catlike Coding — [Texture Distortion](https://catlikecoding.com/unity/tutorials/flow/texture-distortion/)
  & [Directional Flow](https://catlikecoding.com/unity/tutorials/flow/directional-flow/)** — the
  two-phase anti-swimming math *and* the rotate-tile-by-flow-vector trick. The backbone.
- **three.js [`Water2.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js)** —
  the `flow = rg*2-1` flow-map convention.
- **[IceFall Games — Water flow shader](https://mtnphil.wordpress.com/2012/08/25/water-flow-shader/)** —
  Valve-style flow maps, two-phase sampling, per-pixel noise to decorrelate the reset pulse.
- **[Ronja — Flowing River](https://www.ronja-tutorials.com/post/033-river/)** and
  **[Lettier — Flow Mapping](https://lettier.github.io/3d-game-shaders-for-beginners/flow-mapping.html)**.
- Foam: **[Roystan — Toon Water](https://roystan.net/articles/toon-water/)**,
  **[Cyanilux — Shoreline](https://www.cyanilux.com/tutorials/shoreline-shader-breakdown/)**,
  **[Alexander Ameye — Stylized Water](https://ameye.dev/notes/stylized-water-shader/)**.
- Bake math: **Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions"** (2-pass EDT);
  classic **Laplace/potential-flow** for channel-following streamlines (considered, simpler centerline
  approach shipped).
- Tiling/decorrelation: **[Ubisoft La Forge — tiling & blending](https://www.ubisoft.com/en-us/studio/laforge/news/5WHMK3tLGMGsqhxmWls1Jw/making-waves-in-ocean-surface-rendering-using-tiling-and-blending)**.

### Bucket 2 — ground truth (the part that actually decided it)
Measured this session by decoding the real asset:
- `public/models/river-2k.glb` — single mesh, **261,842 verts / 509,300 tris**, POSITION bbox
  **221.08 × 11.05 × 62.77** (min `-117.42, -4.82, -26.22`), TEXCOORD_0 a multi-chart atlas (~0.19
  median per-cell UV scatter → UV-adjacent ≠ world-adjacent, which is *why* a UV-space flow field is
  meaningless).
- The albedo water-mask: **<1% of texels**, fragmented → unusable for centerline tracing.
- The min-Y valley floor: **one connected component** → the channel.

> **The honest caveat:** treat Bucket 1 as *leads*, not gospel — the research agents surfaced those URLs
> and I haven't re-verified every one is live/accurate. The decisions I'd stake my name on are the ones
> grounded in Bucket 2 (your real geometry) **and proven empirically in-engine**. The tutorials told us
> the shape of the answer; the asset and the screenshots told us it was true.

---

## Status & what's next
- ✅ Channel-following direction, two-phase (no swimming), speed variation, foam. ~85fps. 17KB texture.
- ⏳ **Mobile degrade ladder** — 128×64 map, drop the rotation/foam on low-end (desktop = full;
  mobile = baked two-phase no-rotation; lowest = global two-phase + crossfade). No device ships the
  bare single-direction scroll.
- ⏳ Wire into the production hero (lazy island, reduced-motion poster).
- 🌱 The hover-spawn flora (separate thread) hangs off the same object-space plumbing.

## The water physics pass (2026-09-06)

Three months in production and the water still read as a wet matte surface: the scan's photogrammetry
roughness (~0.9) meant the key light and the environment barely reflected off it, the channel was a
tint rather than a volume, and the bed did not move under the surface. Three groups landed, A/B'd on
`previews/river-physics.html` (gitignored — the real GLB, the production shader verbatim as state A,
every upgrade a toggle with a slider, frame p75/p95 on screen), values signed off by the client:

- **On the bed.** `roughnessFactor` mixes to **0.15** inside the channel mask so three's own Fresnel and
  GGX light the water, with the environment term scaled **1.05** there; **Beer–Lambert absorption**
  through a depth proxy (channel mask, pools deeper than riffles) at strength **1.10**, red absorbed
  first; the **albedo is sampled through the surface** — the flow field and the water normal are
  computed first (position and time only), then the bed is fetched at a UV offset of **0.006** × normal.
- **Reacts to you.** Each ripple ring carries a **capillary companion** (shorter, faster, dies sooner —
  the dispersion a real drop shows), ripple amplitude **1.5**; a fast pointer spawns every 35 ms instead
  of 70 and at up to **1.85×** the ring — a wake. The ripple uniform is `vec4` now: x, z, birth, amp.
- **How it flows.** The jitter fetch's `.gb` bend the flow direction into **eddies (0.54)** where the
  water is slow; **speed shaping (0.5)** makes fast reaches choppier with more glint and lower foam
  threshold, and slow reaches glassier and deeper. Base `wAmp` dropped **1.0 → 0.42** on the tiers that
  have the sheen; the flat tier keeps 1.0.

**Cost.** No new pass, no new texture fetch: refraction reorders the albedo sample behind the water
normal, the eddy field rides the jitter fetch. Measured on an M-series Mac: vsync-bound at every
production scale (7.0 ms p75 A and B); at a 3× stress scale where the GPU is the bottleneck, A 14.3–14.7
ms vs B 14.5–16.0 ms p75 — inside run-to-run spread, an upper bound of ~10 % of fragment cost. The
adaptive governor still steps weaker machines down.

**Tiers.** Full and balanced get everything. The low tier gets specular and absorption only (free) and
keeps its flat chop. **Kill switch:** `#water=classic` in the URL hash zeroes the pass without a deploy.

**Dropped:** the fallback for a missing flow field (`uFField`), unreachable since the bake shipped and
circular once the albedo is sampled after the normal.

## Files
- `previews/river-physics.html` — the water-physics A/B harness (gitignored; serve the repo root).
- `previews/hero-river-native.html` — the working preview (water shader in `gradeMaterial`).
- `public/textures/river-flow.png` — the baked flow-field (RG=tangent, B=speed, A=presence).
- `scripts/bake-river-flow.mjs` — the bake (needs `gltf-transform`, `sharp`, `meshoptimizer` installed).
- `public/models/river-{2k,4k,8k}.glb` — the optimised scan variants.
