# Shadow, sky view factor, and the missing third dimension

**Date:** 2026-08-09
**Status:** research notes + one pre-registered test. Nothing here is implemented.
**Why it exists:** raw material for the Substack series, and the answer to a question
we have been circling for weeks — *why does our model not beat a vegetation map at
placing heat inside a ward?*

Companion to [gaussian-splatting-and-3d-twins.md](2026-08-09-gaussian-splatting-and-3d-twins.md),
whose closing section named SOLWEIG as the thread to pull first. This is that thread.

---

## 1 · The measurement that started it

Our spatial accuracy pipeline reports two correlations against ECOSTRESS:

| | r |
|---|---|
| our full physical model | **0.303** |
| a vegetation map, alone | **0.314** |

A vegetation raster with no physics in it beats the climate engine at saying *where*
inside a ward the heat is. Ward means are fine — the ±3 K band holds, the model tracks
live met.no, the diurnal cycle is right. It is specifically the **within-ward pattern**
that fails, and it fails against the most trivial possible baseline.

The standing explanation in our notes was "missing ingredients — shadowing, thermal
admittance, moisture, 3-D geometry — not weights." That was a hypothesis. Today it
became a reading of the source.

## 2 · The governing equation, and the two constants that shouldn't be

From `src/scripts/climate-engine/types.ts:9`, our own docstring:

```
dT/dt = D∇²T + S·(1−albedo)·sun − kRad·(T−Tsky) − L·veg − h·wind·(T−Tair) + Q·built
```

And the layers the solver is allowed to see, `types.ts:33`:

```ts
export interface SimLayers {
  albedo: Float32Array;
  veg:    Float32Array;
  built:  Float32Array;
  water:  Float32Array;
}
```

Four rasters. **No height. No shadow. No sky view.** There is not one 3-D quantity in
the physics. Buildings enter the solver as a *fraction* — `built` — which drives the
anthropogenic heat term `Q·built` and damps ventilation, and nothing else.

We do hold heights. `data/geometry/heights-overture.json` carries a per-footprint
height for all 12,767 buildings across the three wards. The renderer extrudes them.
The solver never sees them.

Now look at which terms carry a per-cell geometry factor that is currently a scalar:

| term | what it is now | what geometry says it should be |
|---|---|---|
| `S·(1−albedo)·**sun**` | `sun` is **one number for the whole ward** | `sun · (1 − shade[i])` |
| `**kRad**·(T−Tsky)` | `kRad` is **a constant** | `kRad · svf[i] · (T−Tsky)` |
| `+ **store**` (night release) | a constant | scales with thermal admittance |

Three of the six terms are pretending the ward is a flat plane. The equation is not
wrong; it is *two-dimensional*, and it has been quietly asserting that every cell in
Ballygunge sees the same sun and the same sky.

**The sky-view one is the canonical urban-heat mechanism.** A street canyon at SVF 0.4
radiates 60 % less longwave to the sky than open ground at SVF 1.0. That is the textbook
reason canyons stay warm after sunset — and our night RMSE (2.930 K) is our *worse*
number, worse than peak day (2.310 K). We have been modelling every cell as if it had a
clear view of the whole sky.

That is not a tuning problem. No amount of refitting `kRad` fixes it, because the defect
is that `kRad` is a scalar at all.

## 3 · What SOLWEIG actually is — and the mistake not to make

**[SOLWEIG](https://umep-dev.github.io/solweig/)** (Solar and LongWave Environmental
Irradiance Geometry), from Lindberg and Grimmond at Gothenburg/Reading, inside the
**[UMEP](https://umep-docs.readthedocs.io/en/latest/OtherManuals/SOLWEIG.html)** QGIS
suite. Given a building-height DSM and ordinary weather, it produces high-resolution
maps of the radiation environment.

**The mistake would be to adopt the model.** SOLWEIG computes **mean radiant
temperature** — what a *person standing there* absorbs, integrated over a hemisphere
with angular factors of 0.22 to the four cardinal directions and 0.06 up and down
([Lindberg & Grimmond 2011](https://rslab.gr/projects/bridge/resources/publications/9_Lindberg%20and%20Grimmond%202011.pdf),
Eq. 1). That is a thermal-comfort variable. We predict **land surface temperature** —
what a *satellite radiometer* sees looking down. Different variable, different validation
data, different customer.

What we want are its **intermediates**. SOLWEIG has to compute a shadow raster and a
sky-view-factor raster before it can compute anything else. Those two rasters are
exactly the two scalars in our equation that should not be scalars.

Take the intermediates. Leave the model.

### The reported skill, for calibration

Lindberg & Grimmond 2011 validate Tmrt at **R² = 0.91, RMSE = 3.1 K** against five days
of integral radiation measurements in Göteborg. Worth sitting with: a purpose-built,
peer-reviewed, fifteen-years-refined urban radiation model reports 3.1 K on the variable
it was designed for. Our 2.310 K peak / 2.930 K night on LST is not the embarrassment
it sometimes feels like at 2 a.m. This is what the field's error bars look like.

## 4 · The shadow algorithm is thirty-five years old and nearly free

The method traces to **Ratti & Richens (1990)**, re-described in Lindberg & Grimmond
2011. It is not ray tracing:

> shadow volumes are computed by sequentially moving the DSM at the azimuth angle of the
> Sun, reducing the height at each iteration according to the Sun's elevation angle. At
> each iteration a part of the shadow volume is derived, and taking the maximum over
> iterations builds the whole shadow volume.

A shear and a running max. No rays, no BVH, no acceleration structure. It vectorises
trivially and it is what makes SOLWEIG tractable over a whole city on a laptop.

Vegetation gets the same treatment with two extra rasters — a canopy DSM and a trunk-zone
DSM — plus a transmissivity constant. UMEP's default is **3 % light penetration through
canopy** (Konarska et al. 2013), with the trunk zone defaulting to **25 % of canopy
height**. Cheap, and it matters here: Ballygunge's cooling comes substantially from
mature trees, not buildings.

**And here is the part that made me stop and re-read the code.** We do not necessarily
need the shear algorithm at all. We already render those buildings, extruded from those
heights, in three.js, every frame. **A shadow map from a directional light at the sun's
position IS this computation**, done in one render pass by hardware that is already
running. We are one framebuffer read away from a shadow raster we are, in a sense,
already computing and throwing away.

That is not a proposal — reading a depth buffer back per frame on a tier-0 integrated
GPU is exactly the kind of thing our own performance notes say to measure before
believing. But the geometry, the light, and the render pass all exist today.

The UMEP docs' own caution is useful for scoping: *"large grids, e.g. larger than
4,000,000 pixels, should be tiled."* Our sim grid is **192 × 192 = 36,864 cells** over a
1,424 m ward — about **7.4 m per cell**. We are two orders of magnitude below where
SOLWEIG's authors start worrying.

### There is a Rust port, and it uses WebGPU

**[UMEP-dev/solweig](https://github.com/UMEP-dev/solweig)** re-implements the pipeline in
Rust with PyO3 bindings — and *"can optionally accelerate shadow casting and anisotropic
sky computations via GPU using WebGPU."*

Two things follow. The urban-climate field independently arrived at WebGPU for exactly
this kernel, which is a decent external signal for the WebGPU thread already on our list.
And a Rust core with Python bindings is structurally the same bet as our own additive Go
pipeline — a fast native core behind a Python-shaped interface, with the Python kept.

**Licence, stated plainly: SOLWEIG is GPL-3.0.** Its code cannot enter a proprietary
site. Algorithms are not copyrightable, and Ratti & Richens 1990 and Lindberg & Grimmond
2011 are published descriptions — so the honest path is *read the papers, implement
fresh, cite them*. That is the same discipline that ruled out Open-Meteo and WAQI on
non-commercial terms and sent us to read MOSDAC's licence before touching it. Same rule,
applied to code instead of data.

## 5 · Thermal admittance: the third named ingredient, and it's a 2026 paper

Our notes named *shadowing, thermal admittance, moisture, 3-D geometry*. The second one
turns out to be live research, published this year.

**[Wallenberg et al., GMD 19, 1321 (2026)](https://gmd.copernicus.org/articles/19/1321/2026/)**
— *"A simple step heating approach for wall surface temperature estimation in SOLWEIG."*

The physics is the semi-infinite-solid step-heating solution: the surface temperature
rise under a step change in net radiation goes as

```
ΔT ∝ ω·√(t/π) / e        ω = net radiation flux, e = thermal effusivity √(kρc)
```

*(Effusivity in the denominator is the physically meaningful sense — a high-effusivity
material like concrete heats* less *for the same flux. The extraction I pulled had it in
the numerator; treat my transcription as unverified until someone reads the paper
directly.)*

Inputs are conductivity, density, specific heat capacity, thickness, albedo, emissivity —
with three presets: brick, concrete, wood. Validated against 15,394 observations on two
walls in Gothenburg: **R² = 0.93–0.94, RMSE 1.94–2.09 °C**.

What it *fixes* is the interesting part. The old SOLWEIG scheme used a single empirical
peak time across the whole domain. That cannot represent aspect: east-facing walls peak
in the morning, west-facing walls peak in the evening. Per-voxel step heating makes the
peak time fall out of the material and the flux instead of being assumed. Reported gains:
**up to 2.5 °C in sunlit areas.**

**Read that against our own open defect.** We carry a **+2.1 K morning bias**. Our
standing diagnosis is evidence distribution — morning is only 15 % of training rows while
213 Landsat rows sit unused — and that diagnosis is well-supported and should not be
abandoned. But here is a peer-reviewed model, in our exact domain, whose *previous*
version had a morning/evening error caused by assuming one peak time for every surface,
fixed by making the peak time depend on aspect and material.

Our `store` term is one number for the whole ward.

I am not claiming that is our bias. I am recording that two independent lines of
reasoning point at the same term, which is more than we had yesterday, and that the
distribution explanation and the physics explanation are not mutually exclusive — a
model that gets morning physics wrong will look worst exactly where it has least data to
correct it.

## 6 · The pre-registered test — RUN 2026-08-10. SVF REJECTED.

> **RESULT, before you read the argument below.** The test was run on 87 ward-scenes
> (`scripts/measure-svf-signtest.py`, artefact `data/calibration/svf-signtest.json`).
>
> **The pre-registered statistic was REJECTED with the WRONG SIGN**: night mean
> r = **−0.514**, **0 of 50** scenes positive, p = 1.8e-15.
>
> The negative sign is collinearity — SVF proxies for `built` (r −0.43…−0.84) and `veg`
> (+0.36…+0.69), and the existing `Q·built` term already over-warms dense cells. Post-hoc,
> with built and veg regressed out, night flips to the predicted direction at
> **r = +0.048** — 0.2 % of variance. Not a lever.
>
> **The physical reason, which §1's argument missed:** our wards have no canyons. Measured
> SVF is 0.82–0.92 with sd 0.04–0.07 across all three — low-rise sprawl. The canyon
> mechanism is real in the literature and near-absent in our study area. §1 argued from the
> mechanism's textbook importance without first checking whether our geometry exhibits it.
>
> **Shadow is untested** and is a different question — it varies far more than SVF in
> low-rise terrain. The rest of this section stands as the reasoning that produced a
> falsifiable test, which is what let an appealing idea die in an afternoon.

### The original argument, kept as written

Everything above is a *story*. This project's rule is that a story does not get
implemented until it survives a test that could have failed. Emissivity harmonisation,
OHM thermal storage and the cloud-attenuation mechanism were all good stories, and all
three died on measurement. This one should get the same chance to die.

**The test needs no change to the model.** SVF is static per ward — compute it once from
footprints + heights, correlate it against night residuals we *already have*.

Signs, fixed in advance:

- **Night, SVF.** Our solver assumes SVF = 1 everywhere, so it over-cools canyons. At low
  SVF the model should run **too cold**: residual `(model − obs)` negative. At SVF ≈ 1 the
  assumption is correct and the residual should approach zero. Therefore
  **`corr(SVF, model − obs) > 0` at night.**
- **Day, shadow.** Our solver gives every cell full sun, so it over-heats shade. Shaded
  cells should run **too warm**: residual positive. Therefore
  **`corr(shadeFraction, model − obs) > 0` by day.**

A null result, or either correlation coming out with the wrong sign, kills it — the same
way the OHM sign test killed thermal storage. Cheap to run, honest, and pre-registered
before anyone has seen a number.

**The resolution caveat, stated up front.** Our cells are 7.4 m; ECOSTRESS is 70 m, about
9.5 cells across. We cannot validate a shadow *pattern* against ECOSTRESS — it is
sub-pixel. The test must run on the **aggregate**: mean SVF and mean shadow fraction
within each 70 m pixel, correlated against that pixel's residual. That is a weaker test
than the full-resolution one, and it is the one the data supports. The literature agrees
this is the tractable form — the standing difficulty in the field is precisely
*"extracting shaded areas at subpixel scale."*

**One more honesty item.** `data/geometry/height-method.json` records our heights as
*"underpowered: 6 matched pairs < 8 … the heights remain independently unvalidated."*
Everything in this note is built on a height field we have never validated. If the sign
test passes, the heights become load-bearing for a published number, and validating them
stops being optional.

## 7 · Why this is different from the last three ideas we killed

Worth being explicit, because the pattern-matching cuts the other way.

Emissivity harmonisation, OHM storage and cloud attenuation were all attempts to improve
the **mean** — and the mean was already good. They were pushing on a number that had
little room to move, which is a large part of why they found nothing.

This is about the **pattern** — a different quantity, currently the one that is failing,
with a specific measured shortfall (`rModel 0.303 < rVegOnly 0.314`) and a named
mechanism. And the mechanism is not a refinement of something we model crudely. It is
something we do not model *at all*: there is no term in our equation where 3-D geometry
could enter even in principle.

That does not make it right. It makes it worth one afternoon of measurement.

## 8 · The licence problem has a permissive answer — checked, not assumed

§4 concluded that SOLWEIG's GPL-3.0 means reading the papers and implementing fresh. So
the obvious question: is anything that does this permissively licensed? I checked the
LICENSE metadata directly rather than trusting a search summary, because guessing
licences is precisely how the Open-Meteo problem happened.

| repo | licence | ★ | last update | what it does |
|---|---|---|---|---|
| **[pybdshadow](https://github.com/ni1o1/pybdshadow)** | **BSD-3-Clause** | 81 | 2026-04-03 | building shadows from footprints + height |
| **[HORAYZON](https://github.com/ChristianSteger/HORAYZON)** | **MIT** | 73 | 2026-07-15 | horizon angles, SVF, shadow maps, SW correction |
| [UMEP-dev/solweig](https://github.com/UMEP-dev/solweig) | GPL-3.0 | 11 | 2026-08-02 | the Rust SOLWEIG |
| [python-dem-shadows](https://github.com/tomderuijter/python-dem-shadows) | GPL-3.0 | 18 | 2025-12-25 | solar shadows on DEMs |
| [svfpy](https://github.com/AndaSampa/svfpy) | GPL-3.0 | 1 | 2024-02-14 | SVF from a DSM |
| [michaeldorman/shadow](https://github.com/michaeldorman/shadow) | unparsed | 33 | 2026-07-17 | R geometric shadow package |

**The two permissive ones split our problem exactly in half.**

**pybdshadow (BSD-3-Clause) covers shadow, and it takes our data shape verbatim.** Its
signature is `bdshadow_sunlight(buildings, date, height='height', roof=False, ...)` where
`buildings` is a **GeoDataFrame in WGS84 with a height column** — which is precisely what
`*-footprints.json` (`lonlat` rings) plus `heights-overture.json` already is. No DSM
rasterisation step at all. It outputs shadow *polygons*, which we would rasterise onto the
192² grid — and we already have a battle-tested polygon rasteriser in `ward-raster.ts`
that does exactly this for `built`. It does not compute SVF.

**HORAYZON (MIT) covers SVF — with one caveat I nearly missed.** It computes horizon
angles per azimuth, sky view factor, shadow maps and shortwave correction factors, using
**Intel Embree** ray tracing with TBB parallelism. Horizon angle is the right intermediate:
integrate it over azimuth and you have SVF; test it against the sun's altitude and you
have shadow. One computation, both of our missing terms.

The caveat: **HORAYZON is terrain-only.** The README talks about DEMs and mountains and
never mentions buildings. Whether it transfers is a real question, not a formality — a
building DSM is all vertical walls and discontinuities, where terrain codes assume smooth
interpolable surfaces. Embree ray-traces a triangle mesh and does not care what the mesh
represents, so it *should* work; "should" is not "does", and that is a thing to test on
one ward before believing.

**So the honest position:** no GPL entanglement is required. Shadow has a permissive
library that eats our exact input format. SVF has a permissive library whose fit is
plausible but unverified, with a published fallback method if it does not transfer. That
is a materially cheaper starting point than §6 assumed — but note it changes nothing about
the order of operations. **The sign test still runs first.** A free library for a term
that does not improve anything is still not worth adding.

---

## Threads still worth pulling

- **SUEWS**, the other half of UMEP, and our existing SuPy work — the energy-balance
  scheme we already touched, now with a reason to look at its storage term specifically.
- **WebGPU compute** — now with an external signal: the Rust SOLWEIG chose it for this
  exact kernel.
- **Shadow map readback cost on tier-0 iGPUs** — the measurement that decides whether the
  shadow raster is free or expensive. Everything in §4 is contingent on it.
- **Anisotropic sky** — SOLWEIG models a non-uniform sky radiance. Our `tSky` is one
  number. Same class of defect as `kRad`, probably smaller.
- **Validating the heights** — deferred as underpowered at 6 matched pairs. §6 is the
  argument for un-deferring it.
