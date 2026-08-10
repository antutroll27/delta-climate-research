# Learning Sunday 01 — 3D twins, simulation, splatting

Delta Climate Research · 9 August 2026 · What we learned, what it changes, and how it makes our digital twin world-class.

---

## How to read this

This is the consolidated record of one day spent reading instead of shipping. It covers
urban microclimate modelling, Gaussian splatting, GPU simulation in the browser, and the
library and paper landscape across all three.

**Three conventions run through it.**

**Verified, contested, unverified.** Every licence and repository statistic here was read
from the GitHub API on 9 August 2026, not from a blog post — a distinction that
immediately changed a conclusion (§6.1). Where a published claim is disputed, it is marked
**contested** and the dispute is cited. Where something is reasoned but unmeasured, it says
**unverified**. Nothing is presented as settled that is not.

**The headline is about our own code, not the literature.** The most consequential thing
learned today came from reading `src/scripts/climate-engine/types.ts`, not from any paper.
The papers explained what it meant.

**Nothing here has been implemented.** This document proposes one measurement, argues for
an order of work, and records a lot of things not to do. That is deliberate.

---

# Part I — The finding

## 1 · Our physics has no third dimension

For weeks the spatial accuracy pipeline has reported an uncomfortable pair of numbers:

| how well does it place heat *inside* a ward? | correlation with ECOSTRESS |
|---|---|
| our full physical model | **r = 0.303** |
| a vegetation map, alone | **r = 0.314** |

A vegetation raster with no physics in it beats the climate engine. Ward-level output is
sound — the ±3.0 K band holds, the model tracks live meteorology, the diurnal cycle is
right. It is specifically the **within-ward pattern** that fails, against the most trivial
baseline available.

The standing explanation was "missing ingredients — shadowing, thermal admittance,
moisture, 3-D geometry — not weights." That was a hypothesis. Today it became a reading of
the source.

### 1.1 The governing equation

From our own docstring at `types.ts:9`:

```
dT/dt = D∇²T + S·(1−albedo)·sun − kRad·(T−Tsky) − L·veg − h·wind·(T−Tair) + Q·built
```

And the layers the solver may see, at `types.ts:33`:

```
SimLayers = { albedo, veg, built, water }
```

Four rasters. **No height, no shadow, no sky view.** There is not one three-dimensional
quantity anywhere in the physics. Buildings enter as an area *fraction* — `built` — which
drives anthropogenic heat and damps ventilation, and nothing else. A ward of towers and a
ward of sheds at equal ground coverage compute identically.

We *hold* the heights. `data/geometry/heights-overture.json` carries a height for each of
**12,767 buildings** across the three wards. The renderer extrudes them into the scene
every frame. The solver has never seen them.

### 1.2 The two constants that geometry says should not be constants

| term | today | what geometry requires |
|---|---|---|
| `S·(1−albedo)·`**`sun`** | `sun` is **one number for the entire ward** | `sun·(1−shade[i])` |
| **`kRad`**`·(T−Tsky)` | `kRad` is **a scalar** | `kRad · svf[i] · (T−Tsky)` |
| `+ store` (night release) | a scalar | scales with thermal admittance |

Three of six terms are asserting that the ward is a flat plane.

**The sky-view term is the canonical urban heat island mechanism.** A street canyon with a
sky view factor of 0.4 radiates roughly 60 % less longwave to the sky than open ground at
1.0. That is the textbook reason canyons stay hot after sunset. Our night RMSE (**2.930 K**)
is our *worse* number — worse than peak daytime (**2.310 K**) — and we have been modelling
every cell in Kolkata as though it had an unobstructed view of the whole sky.

**This is not a calibration problem.** No refit of `kRad` can fix it, because the defect is
that `kRad` is a scalar at all. That distinction — a wrong *value* versus a missing
*degree of freedom* — is the single most useful thing on this page.

### 1.3 Why this reframes months of work

Our standing priority list named **advection** as "the real digital-twin gap". That was
right about the symptom and incomplete about the causes. Advection is one missing term.
Shadow and sky view are two more — and unlike advection, both are computable from data
already on disk, and both can be falsified before a line of solver code is written.

---

# Part II — Urban microclimate modelling

## 2 · SOLWEIG, and the mistake not to make

**SOLWEIG** — Solar and LongWave Environmental Irradiance Geometry — comes from Fredrik
Lindberg and Sue Grimmond (Gothenburg / Reading) and lives inside the **UMEP** QGIS suite.
Given a building-height surface model and ordinary weather, it produces high-resolution
maps of the urban radiation environment.

**The mistake would be to adopt the model.** SOLWEIG computes **mean radiant temperature**
— what a *person standing there* absorbs across a hemisphere, using angular factors of
0.22 toward each cardinal direction and 0.06 up and down (Lindberg & Grimmond 2011, Eq. 1).
That is a human thermal-comfort variable. We predict **land surface temperature**: what a
satellite radiometer sees looking down. Different variable, different validation data,
different customer.

**What we want are its intermediates.** SOLWEIG must compute a shadow raster and a
sky-view-factor raster before it can compute anything. Those two rasters are precisely the
two scalars in §1.2.

Take the intermediates. Leave the model.

### 2.1 A calibration on our own error bars

Lindberg & Grimmond validated Tmrt against five days of integral radiation measurement in
Göteborg and report **R² = 0.91, RMSE = 3.1 K**.

Worth sitting with. A purpose-built, peer-reviewed, fifteen-years-refined urban radiation
model reports 3.1 K on the variable it was designed for. Our 2.310 K peak and 2.930 K night
on land surface temperature is not the embarrassment it can feel like. **This is what the
field's error bars actually look like** — and it corroborates the Columbia read that a
digital twin does not have to be perfect to be useful.

## 3 · The shadow algorithm is thirty-five years old and nearly free

The method traces to **Ratti & Richens (1990)**, redeveloped in Lindberg & Grimmond (2011).
It is not ray tracing:

> Shadow volumes are computed by sequentially moving the surface model at the azimuth angle
> of the sun, reducing the height at each iteration according to the sun's elevation angle.
> Taking the maximum over iterations builds the whole shadow volume.

A shear and a running maximum. No rays, no acceleration structure. It vectorises trivially,
and it is why SOLWEIG runs city-scale on a laptop.

Vegetation is handled with two extra surfaces — a canopy model and a trunk-zone model —
plus a transmissivity constant. UMEP defaults to **3 % light penetration through canopy**
(Konarska et al. 2013) and a trunk zone at **25 % of canopy height**. That matters here:
Ballygunge's cooling comes substantially from mature trees, not buildings.

### 3.1 The observation that made me re-read our renderer

We may not need the shear algorithm at all.

**We already render those buildings, extruded from those heights, in three.js, every
frame.** A shadow map rendered from a directional light at the sun's position *is* this
computation, performed in one pass by hardware that is already running. We are one
framebuffer read away from a shadow raster we are, in a sense, already computing and
discarding.

That is a hypothesis, not a plan — depth-buffer readback on a tier-0 integrated GPU is
exactly the thing §8 says to measure before believing. But the geometry, the light, and the
render pass all exist today.

**Scale check.** UMEP's own manual advises tiling grids larger than 4,000,000 pixels. Our
simulation grid is **192 × 192 = 36,864 cells** over a 1,424 m ward — about **7.4 m per
cell**. We are two orders of magnitude below where SOLWEIG's authors begin to worry.

## 4 · Thermal admittance: our third named ingredient is a 2026 paper

Our notes named *shadowing, thermal admittance, moisture, 3-D geometry*. The second turns
out to be live research published this year.

**Wallenberg et al., *Geoscientific Model Development* 19, 1321 (2026)** — "A simple step
heating approach for wall surface temperature estimation in SOLWEIG."

The physics is the semi-infinite-solid step-heating solution: surface temperature rise
under a step change in net radiation scales as

```
ΔT  ∝  ω · √(t/π) / e            ω = net radiation flux
                                 e = thermal effusivity √(kρc)
```

*(Effusivity belongs in the denominator — a high-effusivity material such as concrete heats
* less *for a given flux. My source extraction placed it in the numerator; treat this
transcription as **unverified** until someone reads the paper directly.)*

Inputs are conductivity, density, specific heat, thickness, albedo and emissivity, with
presets for brick, concrete and wood. Validated on 15,394 observations from two walls in
Gothenburg: **R² = 0.93–0.94, RMSE 1.94–2.09 °C**.

**What it fixes is the interesting part.** The previous scheme used a single empirical peak
time across the whole domain, which cannot represent aspect — east-facing walls peak in the
morning, west-facing walls in the evening. Per-voxel step heating lets peak time fall out of
material and flux instead of being assumed. Reported improvement: **up to 2.5 °C in sunlit
areas.**

**Read against our own open defect.** We carry a **+2.1 K morning bias**. Our standing
diagnosis is evidence distribution — morning is 15 % of training rows while 213 Landsat rows
sit unused — and that diagnosis is well supported and should not be abandoned. But here is a
peer-reviewed model in our exact domain whose previous version had a morning/evening error
caused by assuming one peak time for every surface, fixed by making it depend on aspect and
material.

Our `store` term is one number for the whole ward.

Two independent lines of reasoning now point at the same term. They are not mutually
exclusive: a model that gets morning physics wrong will look worst exactly where it has
least data to correct itself.

## 5 · The test that could kill all of this by Tuesday

Everything above is a *story*. This project's rule is that a story does not get implemented
until it survives a test that could have failed. Emissivity harmonisation, OHM thermal
storage and the cloud-attenuation mechanism were all good stories; all three died on
measurement. This one gets the same chance.

**The test requires no change to the model.** Sky view factor is static per ward — compute
it once from footprints and heights, then correlate against night residuals we already hold.

**Signs fixed in advance:**

- **Night / SVF.** The solver assumes SVF = 1 everywhere, so it over-cools canyons. At low
  SVF the model should run **too cold**: residual `(model − obs)` negative, rising toward
  zero as SVF approaches 1. Therefore **`corr(SVF, model − obs) > 0` at night.**
- **Day / shadow.** The solver gives every cell full sun, so it over-heats shade. Shaded
  cells should run **too warm**. Therefore **`corr(shadeFraction, model − obs) > 0` by day.**

A null result, or either correlation arriving with the wrong sign, kills the idea — exactly
as the OHM sign test killed thermal storage.

**The resolution caveat, stated up front.** Our cells are 7.4 m; ECOSTRESS is 70 m, about
9.5 cells across. We cannot validate a shadow *pattern* against ECOSTRESS — it is sub-pixel.
The test must run on the **aggregate**: mean SVF and mean shadow fraction within each 70 m
pixel, against that pixel's residual. That is weaker than the full-resolution test, and it is
the one our data supports. The literature agrees this is the tractable form; the standing
difficulty in the field is precisely extracting shaded areas at sub-pixel scale.

**And an honesty item.** `data/geometry/height-method.json` records our heights as
*"underpowered: 6 matched pairs < 8 … the heights remain independently unvalidated."*
Everything in Part II rests on a height field we have never validated. If the sign test
passes, those heights become load-bearing for a published number and validating them stops
being optional.

## 6 · Licences: the constraint, and its permissive answer

**SOLWEIG is GPL-3.0.** Its code cannot enter a proprietary site. Algorithms are not
copyrightable, and Ratti & Richens (1990) and Lindberg & Grimmond (2011) are published
descriptions — so the honest path is *read the papers, implement fresh, cite them*. The same
discipline that ruled out Open-Meteo and WAQI on non-commercial terms, and that sent us to
read MOSDAC's licence before touching it. Applied to code instead of data.

So: is anything permissive? Licences read directly from the API, because guessing is how the
Open-Meteo problem happened.

| repository | licence | ★ | updated | does |
|---|---|---|---|---|
| **pybdshadow** | **BSD-3-Clause** | 81 | 2026-04-03 | building shadows from footprints + height |
| **HORAYZON** | **MIT** | 73 | 2026-07-15 | horizon angles, SVF, shadow maps, SW correction |
| UMEP-dev/solweig | GPL-3.0 | 11 | 2026-08-02 | the Rust SOLWEIG |
| python-dem-shadows | GPL-3.0 | 18 | 2025-12-25 | solar shadows on DEMs |
| svfpy | GPL-3.0 | 1 | 2024-02-14 | SVF from a surface model |

**The two permissive ones split our problem exactly in half.**

**pybdshadow (BSD-3-Clause) covers shadow, and eats our data format verbatim.** Its
signature is `bdshadow_sunlight(buildings, date, height='height', …)` where `buildings` is a
GeoDataFrame in WGS84 with a height column — precisely what our footprint files (`lonlat`
rings) plus `heights-overture.json` already are. No surface-model rasterisation step. It
outputs shadow *polygons*, which we would rasterise onto the 192² grid using the
battle-tested rasteriser already in `ward-raster.ts`. It does not compute SVF.

**HORAYZON (MIT) covers SVF — with one caveat.** It computes horizon angles per azimuth,
sky view factor, shadow maps and shortwave correction factors using **Intel Embree** ray
tracing with TBB parallelism. Horizon angle is the right intermediate for both: integrate
over azimuth for SVF, compare against solar altitude for shadow. One computation, both
missing terms.

The caveat: **HORAYZON is terrain-only.** Its documentation discusses elevation models and
mountains and never mentions buildings. Whether it transfers is a real question — an urban
surface is all vertical walls and discontinuities, where terrain codes assume smooth
interpolable surfaces. Embree ray-traces a triangle mesh and does not care what the mesh
represents, so it *should* work. "Should" is not "does". Test on one ward before believing.

**Position:** no GPL entanglement is required. This is materially cheaper than §5 assumed —
and it changes nothing about order. **The sign test still runs first.** A free library for a
term that improves nothing is still not worth adding.

### 6.1 The general pattern, which cost nothing to learn and will save a lot

The same check applied to Gaussian splatting produced the day's most surprising result:

> **The canonical 3D Gaussian Splatting repository cannot be used commercially.**

`graphdeco-inria/gaussian-splatting` — **22,909 stars**, the reference implementation of the
original SIGGRAPH 2023 paper — carries a bespoke Inria/MPII licence whose own text states
the *"Licensor's goal is to allow the research community to use, test and evaluate the
Software."* GitHub reports it as `NOASSERTION`, which skims as "probably fine".

Meanwhile every ecosystem reimplementation is clean: `gsplat` Apache-2.0, `spark` MIT,
`GaussianSplats3D` MIT, `spz` MIT, `FastGS` MIT.

**The rule to carry: in this field, the paper repository is usually research-licensed and
the ecosystem reimplementation is usually permissive. Check the reimplementation.**

---

# Part III — The visual layer

## 7 · Splatting stopped being a research toy, and the reason is administrative

The important 2026 development is not algorithmic.

- **Khronos added `KHR_gaussian_splatting` to glTF** (February 2026), **with OGC
  involvement** — the geospatial standards body was at the table, which is the tell that
  this is aimed at exactly our kind of use. Release candidate February, ratification
  targeted Q2 2026.
- **`KHR_gaussian_splatting_compression_spz`** standardises Niantic's SPZ format: roughly
  90 % smaller than PLY via quantisation plus gzip, and streamable rather than
  download-then-view. Version 2.0 encodes rotations as normalised quaternions for better
  rotational accuracy.
- **Cesium shipped hierarchical level-of-detail for splats in 3D Tiles** (27 April 2026)
  across CesiumJS, Cesium for Unreal and Cesium ion — 3D Tiles as spatial index, glTF as
  payload, so city-scale splat datasets stream with proper LOD instead of arriving as one
  monolith. 3DGS is slated for the proposed **3D Tiles 2.0 OGC community standard**.

A splat is now a first-class asset with a container, a compression story and a streaming
story. For anything delivered to a browser — our entire product — that is the difference
between a demo and a shippable feature.

**Scale marker worth keeping.** The Microsoft Redmond Campus tileset: **20,169 photos over
~3.7 km², reconstructed as 110 million splats.** One of our wards is 1.42 km square — about
2 km², the same order of magnitude. That is the number to reason from if anyone asks what
capturing Ballygunge would cost.

### 7.1 The constraint that would bite us first

PlayCanvas defaults to a splat budget around **4 million splats**, and more importantly:
**fragment processing is the bottleneck, not geometry.** Splat rendering is fill-rate bound,
and anti-aliasing multiplies fragments per pixel.

Set that against what we know about our own runtime. The site's signature is 60 fps motion;
`caps.ts` tiers integrated GPUs down to a CPU solver; most Indian visitors are on exactly
that hardware. **A splat scene is a fill-rate cost landing on devices we already classify as
tier 0–1.** This is the number to measure before promising anything.

### 7.2 The no-drone route — investigated, and closed

**Gaussian Building Mesh (GBM)** — Google Earth Studio imagery + SAM2/GroundingDINO
segmentation + 2D Gaussian splatting → a coloured 3D mesh of *any building, addressed by
name, postcode or coordinates*.

This looked like the answer to a constraint central to our whole story: **we cannot fly
drones over one of our three wards.** Barrackpore sits on an air-force station, a DGCA red
zone. Our standing conclusion was that drone-to-splat was the only true path to photoreal,
which made photoreal unreachable for a third of our study area. GBM appeared to sidestep
flight entirely.

> **CORRECTION, 2026-08-09 (after this document first circulated).** The original text
> flagged Earth Studio's commercial terms as merely "needing reading". They were read. **The
> route is closed for us**, by two independent prohibitions in Google's own primary sources.
>
> Google's Geo Guidelines: *"You may not use output, or use third party tools to capture
> output, from Google Earth, Google Earth Pro, or **Earth Studio** to **reconstruct 3D
> models** or create similar content…"* — which names the GBM technique specifically, not
> incidentally. And: *"Google Earth content may not be used for any commercial or promotional
> purposes."*
>
> The Earth Studio FAQ concurs: *"We currently do not offer a license to use Google Earth
> imagery for commercial applications"*, listing permitted uses as *"research, education,
> film and nonprofit"*. We are a commercial consultancy. GBM remains valid academic work; it
> is not available to us.
>
> **This is §6.1's rule collecting a fourth scalp** — after Open-Meteo, WAQI and Inria. It is
> also the cost of that discipline being real: it removes an option we wanted. Capture for
> any photoreal layer must come from imagery we are licensed to derive from — our own
> flights where airspace permits, ground-level capture, or a purchased commercial licence.

**A caveat that would have applied anyway:** GBM's quality tracks the *multi-view coherence*
of Earth Studio's data more than its resolution, so Kolkata coverage was never guaranteed.

### 7.3 Thermal splatting exists, and it aims at our exact blocker

- **MrGS** (November 2025) reconstructs RGB **and thermal** radiance fields together — with
  actual physics, not thermal-as-a-fourth-colour. It applies **Fourier's law of heat
  conduction** between neighbouring Gaussians before alpha blending, and uses
  **Stefan–Boltzmann plus the inverse-square law** to build a depth-aware thermal radiation
  map that constrains geometry.
- **Thermal3D-GS** — physics-induced Gaussians for thermal infrared novel-view synthesis.
- **Unpaired RGB-Thermal splatting** (2026) — relaxes the need for registered RGB/thermal
  pairs via visual geometric transformers.

**Why this lands for us.** Our within-ward pattern is unvalidated and the blocker is ground
truth finer than ECOSTRESS's 70 m — the same 70 m that forces §5's test onto aggregates. The
route we had identified was a night UAV thermal survey timed to an overpass. A thermal splat
turns that from a set of 2D thermal images into a **3D thermal field** — categorically better
to validate a 3D model against, and re-renderable from any viewpoint the model claims to
predict.

Speculative, but the alignment is not coincidence: this field is converging on the problem we
already have.

### 7.4 Physics *on* splats — real, and not our physics

**PhysGaussian** (CVPR 2024) runs a **Material Point Method** on the Gaussian kernels
themselves — no meshing, no marching cubes; simulation and rendering share one discrete
representation. **i-PhysGaussian** makes the integrator implicit, stable at up to **20×
larger timesteps**. NVIDIA's Kaolin + Warp convert 3DGS to simulatable volumes without
meshing.

**Be honest about relevance.** This is continuum mechanics — elastic solids, plastic metals,
non-Newtonian fluids, granular media. It is **not** heat diffusion over a field, and anyone
presenting PhysGaussian as our path has not read it.

What *does* transfer is the architectural idea: **one primitive carrying both appearance and
physical state.** Our raster already works that way. Worth understanding the analogy; worth
refusing the sales pitch.

## 8 · The most interesting paper of the day: splat triangles

**Triangle Splatting** (arXiv 2505.19175, Apache-2.0, 1,189★, updated 9 August 2026) is a
differentiable renderer that splats *a soup of triangles* into screen space with end-to-end
gradient optimisation, and reportedly **surpasses 3DGS, 2DGS and 3D Convex Splatting on
visual fidelity, training speed and rendering throughput simultaneously**.

This is more than a benchmark win. Gaussians were chosen because they are smooth and
differentiable, and the field has spent three years discovering that **infinite support and
smooth falloff are exactly wrong for hard edges and flat surfaces** — buildings, in other
words. The alternatives now include **3D Convex Splatting** (CVPR 2025 Highlight; **+0.81
PSNR and −0.026 LPIPS** against 3DGS with *fewer* primitives), Beta kernels, learnable basis
functions, and Fourier Splatting. Note also the repeated move to **2D Gaussians / surfels** —
oriented discs rather than blobs — throughout the inverse-rendering literature, for the same
reason.

**And triangles are the primitive every GPU ever made is built to rasterise.** §7.1's worry
was fill rate, and fill rate is exactly what tier-0 integrated GPUs have least of. A
triangle-based radiance field needs no custom splat renderer, no per-frame depth sort, and no
fill-rate blowup — it drops into three.js's existing pipeline as geometry.

**If splats ever become real for us, this is the branch to watch, not vanilla 3DGS.**

---

# Part IV — Compute

## 9 · WebGPU shipped, and the reason to want it is not the usual one

WebGPU now ships by default in Chrome, Edge, Firefox and Safari — Safari 26 brought it to
macOS, iOS, iPadOS and visionOS — at roughly **82 % global support**. Firefox on Android is
the notable gap, targeted late 2026. That matters because our audience is substantially
Android in India; the gap is narrower than it was, and our CPU fallback already exists.

**The usual argument does not apply to us.** The pitch is compute shaders: storage buffers,
workgroup shared memory, arbitrary writes, instead of coercing fragment shaders into
general-purpose maths by encoding state in floating-point textures — the ping-pong technique
`sim-gpu-webgl2.ts` uses today.

That pitch is aimed at people who are compute-bound. **We are not.** 36,864 cells on a
five-point explicit-Euler stencil is nothing; a 2015 integrated GPU does it in microseconds.
Rewriting the stencil in WGSL wins approximately zero.

### 9.1 The actual case: a synchronous stall on the worst possible hardware

```
temperature() {
  const rgba = new Float32Array(n * n * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frontBuffer);
  gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, rgba);   // synchronous
  for (let i = 0; i < field.length; i++) field[i] = rgba[i * 4];   // discard G,B,A
}
```

Three costs in eight lines: **`readPixels` blocks** until the GPU drains its queue; it moves
**576 KB to deliver 144 KB**; then JavaScript walks 36,864 strided reads to throw three
quarters away.

The first bites hardest exactly where we care. Every phone in our target market runs a
**tile-based deferred renderer** — Adreno, Mali, PowerVR. On those, changing the framebuffer
binding forces an immediate resolve of the current framebuffer, and anything depending on
framebuffer pixel values stalls the pipeline. Tile-based GPUs win by keeping colour and depth
on-chip and resolving once; a mid-frame readback demands a resolve *now* and throws that win
away. And our own source comment records that this page holds **three WebGL contexts** —
MapLibre, the relief renderer, the solver. The stall competes with the basemap.

**WebGPU's answer is `mapAsync` on a staging buffer**: the readback becomes a promise, the
pipeline does not stall, and an `r32float` storage buffer moves exactly the 144 KB that
carries information, with no de-interleave loop.

**The honest framing: the WebGPU case for us is I/O, not compute.** Smaller, more specific,
and far likelier to survive a profiler.

**Two caveats so nobody quotes this as a finding.** The readback is already cached, so it
happens at most once per solver step, not once per frame; and our own performance notes say
the landing page is GPU-bound with no JavaScript hotspot. **This is unverified.** A cheap
first probe: time `temperature()` on a mid-tier Android and see whether it registers at all.

## 10 · Neural surrogates: a speed technology, sold as an accuracy technology

This is the expensive mistake currently available to us, and the literature reads very
seductively if skimmed. Surrogates "generate physically plausible flow fields directly from
geometry without case-specific solver runs, enabling real-time microclimate assessment."
Read that after weeks of staring at r = 0.303 and it sounds like the answer.

**Localized Fourier Neural Operator (Local-FNO)** predicts multivariable 3-D urban
microclimate at **0.35 m/s velocity error and 0.30 °C temperature error** over 60 seconds, at
roughly **50× a CFD solver**, with 23.9 % lower error than plain FNO. 0.30 °C is genuinely
excellent — then read the hardware line: 150 million feature dimensions **on a single 32 GB
GPU**. Our target device shares system RAM with the browser and the basemap.

**Generative Urban Flow Modeling** (December 2025) trains score-based diffusion on a
hierarchical multiscale GNN over unstructured CFD meshes; input building geometry plus wind
direction, output a steady-state velocity field:

| metric | value |
|---|---|
| relative L² error | **0.45 – 0.58** |
| cosine similarity (direction) | 0.56 – 0.71 |
| inference | **7.5 s per case on an A100** |
| training data | one Bristol neighbourhood, ~40 M cells, 4 slices |
| code / weights | not released |

A relative L² near 0.5 means the field is about half wrong. It recovers wakes and
recirculation qualitatively — a real achievement against a baseline costing days — but it is
not a number to build a municipal recommendation on. And "real-time" here means 7.5 seconds
on a data-centre GPU: real-time relative to CFD, nowhere near our 60 fps on an integrated GPU.

### 10.1 The structural point, which is the actual lesson

**Every one of these is a surrogate for a high-fidelity solver you already ran.** They are
trained on CFD output. The proposition is: you have an expensive correct thing and want a
cheap approximate one.

**We do not have the expensive correct thing.** We have no CFD. A surrogate cannot give us
physics we never simulated — only a faster copy of physics we already have, and ours already
runs at 60 fps on a phone.

**Neural surrogates buy speed. We do not have a speed problem.** We have a
physics-completeness problem. These trade in opposite directions.

This is written down because in six months someone will read "AI physics" in a vendor deck
and propose it, and the counter-argument should already exist on disk.

### 10.2 The exception worth keeping

**FLUME-FNO** reports robust learning of 3-D wind and temperature fields in **unseen urban
morphologies from just 23 CFD simulations**, by computing multi-directional distance features
over the domain and cropping encoded geometry into patches.

Twenty-three runs is not absurd. OpenFOAM is free. And this points straight at **advection** —
our own name for the deepest gap. The chain: ~23 OpenFOAM cases over our wards → train a
surrogate → obtain a wind field → finally have an advection term. A multi-week project with
real uncertainty at every link.

## 11 · The comparison that decides the next move

Both roads target the same failing metric. They differ in cost by about two orders of
magnitude.

| | shadow + SVF | CFD-trained advection surrogate |
|---|---|---|
| new data needed | **none** — footprints + heights on disk | ~23 OpenFOAM runs per ward |
| new infrastructure | none (two permissive libraries exist) | meshing, HPC time, training pipeline |
| runtime cost | two multiplier textures, same solver | inference, or a precomputed field |
| runs on a tier-0 iGPU | yes | unknown, probably not |
| targets | `sun` and `kRad` — both currently scalars | the missing advection term |
| **falsifiable before building** | **yes, cheaply** | no |
| effort to first number | an afternoon | weeks |

The tiebreaker is not the table. It is that **the cheap road can be killed before it is
built.** The expensive road has no early exit — you find out after the CFD runs.

**Shadow and SVF first, and specifically the test before the implementation.** Not because
advection is wrong — it remains the deepest gap — but because one of these can prove itself
wrong by Tuesday and the other cannot.

---

# Part V — The surveyed landscape

## 12 · Libraries, with licences read today

Star counts are a popularity signal, not a quality one; **last-updated is the more useful
column**, because an abandoned graphics repository is a trap.

### Splatting

| | licence | ★ | updated |
|---|---|---|---|
| [nerfstudio-project/gsplat](https://github.com/nerfstudio-project/gsplat) — CUDA training | **Apache-2.0** | 5,507 | 2026-08-09 |
| [sparkjsdev/spark](https://github.com/sparkjsdev/spark) — three.js renderer | **MIT** | 3,477 | 2026-08-09 |
| [mkkellogg/GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) — three.js renderer | **MIT** | 2,850 | 2026-08-07 |
| [aras-p/UnityGaussianSplatting](https://github.com/aras-p/UnityGaussianSplatting) | **MIT** | 3,378 | 2026-08-09 |
| [nianticlabs/spz](https://github.com/nianticlabs/spz) — compressed format | **MIT** | 902 | 2026-08-06 |
| [fastgs/FastGS](https://github.com/fastgs/FastGS) — CVPR'26, training in 100 s | **MIT** | 1,193 | 2026-08-08 |
| [nerficg-project/faster-gaussian-splatting](https://github.com/nerficg-project/faster-gaussian-splatting) — CVPR'26 | **Apache-2.0** | 212 | 2026-08-08 |
| [trianglesplatting/triangle-splatting](https://github.com/trianglesplatting/triangle-splatting) | **Apache-2.0** | 1,189 | 2026-08-09 |
| [convexsplatting/convex-splatting](https://github.com/convexsplatting/convex-splatting) — CVPR'25 Highlight | **Apache-2.0** | 384 | 2026-07-19 |
| [graphdeco-inria/gaussian-splatting](https://github.com/graphdeco-inria/gaussian-splatting) | **research only** | 22,909 | 2026-08-09 |
| [DekuLiuTesla/CityGaussian](https://github.com/DekuLiuTesla/CityGaussian) | NOASSERTION | 1,238 | 2026-08-05 |
| [city-super/Octree-GS](https://github.com/city-super/Octree-GS) — TPAMI 2025 | NOASSERTION | 857 | 2026-08-01 |
| [longxiang-ai/awesome-gaussians](https://github.com/longxiang-ai/awesome-gaussians) — daily arXiv feed | none | 330 | 2026-08-09 |

### Rendering and geospatial

| | licence | ★ | updated |
|---|---|---|---|
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | 31,676 | 2026-08-09 |
| [playcanvas/engine](https://github.com/playcanvas/engine) | MIT | 16,448 | 2026-08-09 |
| [CesiumGS/cesium](https://github.com/CesiumGS/cesium) | Apache-2.0 | 15,545 | 2026-08-08 |
| [google/model-viewer](https://github.com/google/model-viewer) | Apache-2.0 | 8,190 | 2026-08-08 |
| [mitsuba-renderer/mitsuba3](https://github.com/mitsuba-renderer/mitsuba3) — differentiable | BSD-3 style | 2,880 | 2026-08-09 |
| [mitsuba-renderer/drjit](https://github.com/mitsuba-renderer/drjit) — JIT compiler | BSD-3-Clause | 794 | 2026-08-08 |
| [microsoft/renderformer](https://github.com/microsoft/renderformer) — SIGGRAPH 2025 | MIT | 968 | 2026-08-03 |

### Simulation

| | licence | ★ | updated |
|---|---|---|---|
| [taichi-dev/taichi](https://github.com/taichi-dev/taichi) — GPU programming in Python | Apache-2.0 | 28,322 | 2026-08-09 |
| [Genesis-Embodied-AI/Genesis](https://github.com/Genesis-Embodied-AI/Genesis) | Apache-2.0 | 29,719 | 2026-08-09 |
| [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 | 14,493 | 2026-08-09 |
| [jrouwe/JoltPhysics](https://github.com/jrouwe/JoltPhysics) | MIT | 11,303 | 2026-08-09 |
| [NVIDIA/warp](https://github.com/NVIDIA/warp) | Apache-2.0 | 6,964 | 2026-08-09 |
| [dimforge/rapier](https://github.com/dimforge/rapier) | Apache-2.0 | 5,624 | 2026-08-09 |
| [NVIDIA-Omniverse/PhysX](https://github.com/NVIDIA-Omniverse/PhysX) | BSD-3-Clause | 4,706 | 2026-08-09 |

### 12.1 Two things worth reading properly

**RenderFormer** (SIGGRAPH 2025, MIT) renders triangle meshes with **full global illumination
using no physics at all**: rendering reformulated as sequence-to-sequence, tokens-of-triangles
→ tokens-of-pixel-patches, in two transformer stages — view-independent triangle-to-triangle
light transport, then view-dependent ray-bundle to pixels. **No per-scene training or
fine-tuning.** A RenderFormer++ on scalability already exists.

Not useful to us — we need a temperature field, not a beauty pass. Worth reading as the
clearest example of a learned model displacing a simulator *wholesale* rather than
approximating one.

**Mitsuba 3 + Dr.Jit** (EPFL) is a fully **differentiable** renderer: derivatives of the
entire light-transport simulation with respect to camera pose, geometry, BSDFs, textures and
volumes, JIT-fused via LLVM (CPU) and CUDA/OptiX (GPU). Differentiable means invertible — the
machinery for asking "what surface properties would have produced the image I observed",
which is our inverse-problem shape in a different domain.

### 12.2 One number not to repeat

**Genesis** bundles rigid-body, MPM, SPH, FEM, PBD and stable-fluid solvers in pure Python
across CUDA, ROCm and Apple Metal — genuinely unusual breadth. Its headline figures —
"43 M FPS", "430,000× real time", "10–80× faster than Isaac Gym and MuJoCo MJX" — are
**contested**. An independent analysis found the benchmark scripts used the fastest, least
accurate solver settings (physics substeps = 1) on a scene of one plane and one arm, and
called the presentation *"egregiously misleading"*. To their credit the Genesis team re-ran
and published a fuller report with open code afterwards.

Keep the engine on the list; do not quote the number.

**Also note:** none of the simulation engines above simulates atmospheric heat. They are
rigid-body and continuum-mechanics engines. "Simulation" spans two unrelated fields here, and
the gap is where an expensive month could disappear.

---

# Part VI — How this makes our twin world-class

## 13 · What "world-class" actually means here

It does not mean photoreal, and it does not mean a lower RMSE than everyone else. Lindberg &
Grimmond's 3.1 K (§2.1) is the field's own bar for a purpose-built model, and Urban-PLUMBER
found an empirical benchmark beat all thirty urban land-surface models it tested. Chasing an
asymptote is not the job.

Three things separate a world-class twin from a beautiful inert one, and today's reading
sharpened all three.

### 13.1 It computes, and almost none of them do

Conflating three different things called a "digital twin" is how these projects go wrong:

| | what it does | who is good at it |
|---|---|---|
| **Visual twin** | looks right | Gaussian splatting, overwhelmingly |
| **Geometric twin** | is measurable | meshes, CityGML — we have this |
| **Physical twin** | **computes** | rare — **we have this** |

Almost every product marketed as an urban digital twin is the first two: beautiful and inert.
It renders a city and tells you nothing you did not already know. Ours is the reverse — it
predicts a surface temperature field and looks procedural.

**That asymmetry is a position, not a weakness.** It argues for treating splats as a
*presentation layer over a physics core*, never as the twin itself. Everyone else built the
postcard; we built the instrument, and the postcard is the easy half.

**The architectural conclusion follows:** the visual representation and the physical
representation should not be the same thing. PhysGaussian can unify them because it simulates
*the object it captured*; we simulate a **field over a domain**, whose cells are not objects
at all. So:

- **splats** for appearance and context
- **raster** for physics
- **one shared coordinate frame** between them

We already paid for that third item the hard way, during the north–south mirror bug, when the
render, the terrain and the surface rasters each disagreed about which row was north. **The
frame is the asset**; the representations plug into it.

### 13.2 It gets the within-ward pattern right — and now we know how

This is the concrete upgrade path, and it is the whole point of Part II.

A twin whose ward means are correct but whose internal pattern loses to a vegetation map is a
*thermometer*, not a twin. The value proposition — telling a municipal officer *where* to
plant, *which* corridor to shade — lives entirely in the pattern.

Today established the mechanism (§1), the literature (§2–4), a falsifiable test (§5),
permissively-licensed tooling (§6), and the honest cost comparison against the alternative
(§11). That is a complete, ordered path from "we don't know why" to "here is the measurement
that decides it" — assembled in a day, from free sources.

**Sequenced:**

1. **Compute SVF once; run the sign test.** No model change. An afternoon. Kills or confirms.
2. **If confirmed:** shadow via pybdshadow, SVF via HORAYZON or a fresh implementation, both
   as multiplier textures into the existing solver.
3. **Then validate the heights**, which stop being optional the moment they are load-bearing.
4. **Then thermal admittance** (§4) — the third named ingredient, with a 2026 method and a
   1.94–2.09 °C validation to aim at.
5. **Advection last**, via §10.2, and only if the earlier steps leave the pattern short.

### 13.3 It is honest in a way the field can check

The rarest property, and the one hardest to copy.

Every discrepancy in our published figures runs in the **conservative** direction: we tell
people the daytime view is worse than it measures. `pending_recalibration` discloses drift in
machine-readable form. Assertions in `assertAccuracyLogic` fire if anyone edits around the
guards. `underpowered` was published rather than resolved by relaxing a threshold. Three good
stories — emissivity harmonisation, OHM storage, cloud attenuation — were killed by our own
measurements and recorded as killed.

Today added two more entries in the same ledger: a pre-registered sign test written down
*before* any number was computed (§5), and a contested benchmark cited as contested rather
than quoted (§12.2).

**That posture is the brand.** In a field where "digital twin" is mostly a rendering, being
the one that publishes its error bars, its refusals and its dead ends is a durable position —
and it is the reason the credibility research (see companion note) matters as much as the
physics.

### 13.4 The constraints turned out to be architecture

The three constraints that felt like handicaps each forced a decision that is simply better:

- **No drones over Barrackpore** → we never coupled the twin to a capture pipeline, so the
  physics core stands alone and GBM (§7.2) can be evaluated on its own merits later.
- **Delivery to tier-0 integrated GPUs in India** → a 36,864-cell solver that runs anywhere,
  a CPU fallback that already exists, and a healthy scepticism toward 32 GB-GPU results
  (§10) that most teams would have skipped past.
- **Free and open data only, licences read** → the discipline that caught Open-Meteo, WAQI
  and MOSDAC is the same one that caught Inria's research licence today (§6.1), and it means
  nothing in the stack is a legal surprise waiting to happen.

**That is the Substack thesis in one line: the constraints did not make a worse twin, they
made a more honest one — and honesty is the thing that scales.**

---

# References

Full sources for every claim above. Grouped by part.

## Urban microclimate modelling

- **SOLWEIG project site** — <https://umep-dev.github.io/solweig/>
- **UMEP SOLWEIG manual** — <https://umep-docs.readthedocs.io/en/latest/OtherManuals/SOLWEIG.html>
- **UMEP Daily Shadow Pattern tool** (3 % canopy transmissivity, 25 % trunk zone, 4 M-pixel tiling advice) — <https://umep-docs.readthedocs.io/en/latest/processor/Solar%20Radiation%20Daily%20Shadow%20Pattern.html>
- **UMEP Sky View Factor Calculator** — <https://umep-docs.readthedocs.io/en/latest/pre-processor/Urban%20Geometry%20Sky%20View%20Factor%20Calculator.html>
- **Lindberg, F. & Grimmond, C.S.B. (2011)**, "The influence of vegetation and building morphology on shadow patterns and mean radiant temperatures in urban areas: model development and evaluation", *Theoretical and Applied Climatology* 105:311–323, DOI 10.1007/s00704-010-0382-8 — <https://rslab.gr/projects/bridge/resources/publications/9_Lindberg%20and%20Grimmond%202011.pdf>
- **Ratti, C. & Richens, P. (1990/1999)** — the shear-and-maximum shadow volume method; described in Lindberg & Grimmond (2011). Context: <https://senseable.mit.edu/papers/pdf/20050701_Ratti_LineageLine_EnvironmentPlanning.pdf>
- **Wallenberg et al. (2026)**, "A simple step heating approach for wall surface temperature estimation in SOLWEIG", *Geoscientific Model Development* 19:1321 — <https://gmd.copernicus.org/articles/19/1321/2026/>
- **Konarska et al. (2013)** — vegetation transmissivity default (cited via UMEP documentation)
- **Jiao et al. (2019)**, "Evaluation of Four Sky View Factor Algorithms Using Digital Surface and Elevation Model Data", *Earth and Space Science* — <https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018EA000475>
- **Sky View Factor Calculation in Urban Context: Computational Performance and Accuracy of Two Open and Free GIS Tools**, *Climate* 6(3):60 — <https://www.mdpi.com/2225-1154/6/3/60>
- **Study of the Seasonal Effect of Building Shadows on Urban Land Surface Temperatures Based on Remote Sensing Data**, *Remote Sensing* 11(5):497 — <https://doi.org/10.3390/rs11050497>
- **The effect of extremely low sky view factor on land surface temperatures in urban residential areas** — <https://www.sciencedirect.com/science/article/abs/pii/S2210670722001287>
- **Revealing the impacts of 3D urban morphology on surface temperature** — <https://www.sciencedirect.com/science/article/abs/pii/S2210670724009156>
- **Satellite-derived Land Surface Temperatures Strongly Mischaracterise Urban Heat Hazard** — <https://arxiv.org/pdf/2509.16568>

### Shadow / SVF implementations

- **pybdshadow** (BSD-3-Clause) — <https://github.com/ni1o1/pybdshadow> · docs <https://pybdshadow.readthedocs.io/>
- **HORAYZON** (MIT) — <https://github.com/ChristianSteger/HORAYZON>
- **UMEP-dev/solweig**, Rust + WebGPU (GPL-3.0) — <https://github.com/UMEP-dev/solweig>
- **python-dem-shadows** (GPL-3.0) — <https://github.com/tomderuijter/python-dem-shadows>
- **svfpy** (GPL-3.0) — <https://github.com/AndaSampa/svfpy>
- **shadow: R Package for Geometric Shadow Calculations in an Urban Environment**, *The R Journal* — <https://journal.r-project.org/articles/RJ-2019-024/>

## Gaussian splatting and 3D twins

- **Khronos, OGC and geospatial leaders add 3D Gaussian splats to the glTF asset standard** — <https://www.khronos.org/blog/khronos-ogc-and-geospatial-leaders-add-3d-gaussian-splats-to-the-gltf-asset-standard>
- **Cesium — Introducing 3D Gaussian Splats with Hierarchical Level of Detail Using 3D Tiles** (27 Apr 2026) — <https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/>
- **Cesium — View 3D Gaussian Splat Tilesets with LODs in CesiumJS** — <https://cesium.com/learn/cesiumjs-learn/3d-guassian-splat-tilesets-lods/>
- **The State of Gaussian Splatting in 2026: Standards and Tools** — <https://www.thefuture3d.com/blog-0/2026/4/4/state-of-gaussian-splatting-2026>
- **Gaussian Building Mesh (GBM)** — <https://arxiv.org/html/2501.00625>
- **MrGS** — RGB + thermal radiance fields with Fourier conduction and Stefan–Boltzmann — <https://arxiv.org/abs/2511.22997>
- **Thermal3D-GS** — <https://www.researchgate.net/publication/385505712_Thermal3D-GS_Physics-Induced_3D_Gaussians_for_Thermal_Infrared_Novel-View_Synthesis>
- **Unpaired RGB-Thermal splatting (2026)** — <https://arxiv.org/pdf/2606.05491>
- **PhysGaussian** (CVPR 2024) — <https://xpandora.github.io/PhysGaussian/>
- **i-PhysGaussian** — <https://www.themoonlight.io/en/review/i-physgaussian-implicit-physical-simulation-for-3d-gaussian-splatting>
- **SuGaR** — mesh extraction from Gaussians (CVPR 2024) — <https://github.com/Anttwo/SuGaR>
- **Spark** — WebGL2 / three.js splat renderer — <https://github.com/sparkjsdev/spark>
- **GaussianSplats3D** — <https://github.com/mkkellogg/GaussianSplats3D>
- **PlayCanvas SuperSplat** — <https://developer.playcanvas.com/user-manual/gaussian-splatting/>
- **spz** — Niantic compressed splat format — <https://github.com/nianticlabs/spz>
- **awesome-gaussians** — daily arXiv tracker — <https://github.com/longxiang-ai/awesome-gaussians>
- **City-scale**: CityGaussian <https://github.com/DekuLiuTesla/CityGaussian> · Octree-GS <https://arxiv.org/pdf/2403.17898> · BlitzGS <https://arxiv.org/pdf/2605.13794> · MetroGS <https://arxiv.org/pdf/2511.19172> · TraGraph-GS <https://arxiv.org/pdf/2506.08704> · Momentum-GS <https://arxiv.org/pdf/2412.04887>
- **Urban microclimate in Omniverse-class twins** — *Smart Cities* 9(2):39 — <https://doi.org/10.3390/smartcities9020039>

### New primitives

- **Triangle Splatting for Real-Time Radiance Field Rendering** — <https://trianglesplatting.github.io/> · <https://arxiv.org/html/2505.19175>
- **3D Convex Splatting: Radiance Field Rendering with 3D Smooth Convexes** (CVPR 2025 Highlight) — <https://arxiv.org/html/2411.14974v1>
- **Fourier Splatting: Generalized Fourier encoded primitives for scalable radiance fields** — <https://arxiv.org/pdf/2603.19834>
- **Beyond Spherical Harmonics: Rethinking Appearance Models for Radiance Reconstruction** — <https://arxiv.org/pdf/2606.09794>

### Inverse rendering and relighting

- **SSD-GS: Scattering and Shadow Decomposition for Relightable 3D Gaussian Splatting** — <https://arxiv.org/pdf/2604.13333>
- **BRDFusion: Physics Meets Generation for Urban Scene Inverse Rendering** — <https://arxiv.org/pdf/2606.17049>
- **MaterialClusterGS** — <https://arxiv.org/pdf/2606.09018>
- **RTR-GS** (ACM MM) — <https://arxiv.org/pdf/2507.07733>
- **GI-GS: Global Illumination Decomposition on Gaussian Splatting** — <https://arxiv.org/pdf/2410.02619>
- **Phys3DGS** — <https://arxiv.org/pdf/2409.10335>
- **TRON: Tracing Rays to Orchestrate a Neural Renderer** — <https://arxiv.org/pdf/2606.11314>
- **Differentiable Inverse Rendering with Interpretable Basis BRDFs** — <https://arxiv.org/pdf/2411.17994>

## Rendering

- **RenderFormer** (SIGGRAPH 2025) — <https://microsoft.github.io/renderformer/> · arXiv 2505.21925 <https://arxiv.org/abs/2505.21925> · code <https://github.com/microsoft/renderformer>
- **RenderFormer++: Scalable and Physically Grounded Feed-Forward Neural Rendering** — <https://arxiv.org/html/2606.30380v1>
- **Mitsuba 3** — <https://www.mitsuba-renderer.org/> · <https://github.com/mitsuba-renderer/mitsuba3>
- **Dr.Jit** — <https://github.com/mitsuba-renderer/drjit>
- **Differentiable Rendering: A Survey** — <https://arxiv.org/pdf/2006.12057>
- **SIGGRAPH 2025 Technical Papers** — <https://s2025.siggraph.org/program/technical-papers/>
- **SIGGRAPH Asia 2025 papers index** — <https://www.realtimerendering.com/kesen/siga2025Papers.htm>

## Browser compute and simulation

- **From WebGL to WebGPU** (Chrome for Developers) — <https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu>
- **WebGPU Hits Critical Mass: All Major Browsers Now Ship It** — <https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/>
- **three.js WebGPU and node-based materials (TSL)** — <https://deepwiki.com/mrdoob/three.js/3.5-webgpu-and-node-based-materials>
- **Reaction-Diffusion Compute Shader in WebGPU** (Codrops) — <https://tympanus.net/codrops/2024/05/01/reaction-diffusion-compute-shader-in-webgpu/>
- **Mozilla — Platform/GFX/MobileGPUs** (tile-based deferred renderers, framebuffer resolve costs) — <https://wiki.mozilla.org/Platform/GFX/MobileGPUs>
- **Samsung — GPU Framebuffer Memory: Understanding Tiling** — <https://developer.samsung.com/galaxy-gamedev/resources/articles/gpu-framebuffer.html>
- **Qualcomm — Adreno GPU on Mobile: Best Practices** — <https://docs.qualcomm.com/nav/home/mobile_best_practices.html>
- **Rapier — 2025 review and 2026 goals** (SIMD WASM) — <https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/>
- **Genesis — why a new simulator** — <https://genesis-world.readthedocs.io/en/latest/user_guide/overview/why_a_new_simulator.html>
- **Stone Tao — "How fast is the new hyped Genesis simulator?"** (the benchmark critique) — <https://stoneztao.substack.com/p/the-new-hyped-genesis-simulator-is>

## Neural surrogates for microclimate

- **Modeling Multivariable High-resolution 3D Urban Microclimate Using Localized Fourier Neural Operator** — <https://arxiv.org/abs/2411.11348> · journal version <https://www.sciencedirect.com/science/article/pii/S0360132325001507>
- **FLUME-FNO: data-efficient and scalable prediction of 3D wind and temperature fields in unseen urban morphologies** — <https://arxiv.org/abs/2503.19708>
- **Generative Urban Flow Modeling: From Geometry to Airflow with Graph Diffusion** — <https://arxiv.org/html/2512.14725>
- **Fourier neural operator for real-time simulation of 3D dynamic urban microclimate** — <https://www.sciencedirect.com/science/article/abs/pii/S0360132323010909>
- **Surrogate modeling of urban boundary layer flows**, *Physics of Fluids* 36(7) — <https://pubs.aip.org/aip/pof/article/36/7/076625/3304721/>
- **Integrating CFD and machine learning to improve urban green infrastructure for heat mitigation and air quality: a systematic review** — <https://www.sciencedirect.com/science/article/pii/S0360132325009898>
- **CFD and machine learning in building performance simulation: towards urban microclimate integration** — <https://www.tandfonline.com/doi/full/10.1080/19401493.2025.2561864>

---

## Appendix — what is verified, contested, and unverified

**Verified this session** (read directly from a primary source or API): all licence and star
figures in §12 and §6; the Inria licence text; our own `SimLayers` definition, solver update
equation, grid size and ward extent; the ward footprint extent of 1,424 m; the presence of
12,767 building heights; the `height-method.json` "underpowered" note.

**Contested** (dispute cited, not resolved by us): Genesis's throughput claims (§12.2);
third-party Rapier-versus-Jolt benchmark ratios.

**Unverified** (reasoned, not measured): the readback-stall hypothesis (§9.1); the claim that
HORAYZON transfers from terrain to urban surfaces (§6); the step-heating equation's placement
of effusivity (§4); TSL's dual WGSL/GLSL compilation as applied to *our* shader.

**Moved from unverified to settled, after first circulation:** Google Earth Studio's terms
**prohibit** commercial use and explicitly prohibit reconstructing 3D models from its output.
The GBM route is closed for us — see the correction in §7.2. Recorded here rather than
quietly edited, because a document that claims to label its own uncertainty has to show what
happened when an uncertainty resolved against it.

**Pre-registered and not yet run:** the SVF and shadow sign tests (§5), including their
directions and the 70 m aggregation rule.
