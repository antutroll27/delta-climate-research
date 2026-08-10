# Gaussian splatting, 3D twins, and simulation in virtual environments

**Date:** 2026-08-09
**Status:** research notes — nothing here is adopted, specced, or committed to
**Why it exists:** raw material for the Substack series on building a climate engine
under real constraints, and a map of where the field is when we come back to 3D.

---

## 1 · The frame: three different things are called a "digital twin"

Conflating them is how these projects go wrong, and separating them is the most useful
thing in these notes.

| | what it does | who is good at it |
|---|---|---|
| **Visual twin** | looks right | Gaussian splatting, overwhelmingly |
| **Geometric twin** | is measurable | meshes, CityGML — we have this |
| **Physical twin** | **computes** | rare — **we have this** |

Almost every product marketed as an "urban digital twin" is the first two: beautiful and
inert. It renders a city and tells you nothing you did not already know. Ours is the
reverse — it predicts a surface temperature field and it looks procedural.

**That asymmetry is a position, not a weakness.** It argues for treating splats as a
*presentation layer over a physics core*, never as the twin itself. The narrative for the
Substack piece writes itself: everyone else built the postcard; we built the instrument
and the postcard is the easy half.

## 2 · Splatting stopped being a research toy

The important 2026 development is administrative, not algorithmic.

- **[Khronos added `KHR_gaussian_splatting` to glTF](https://www.khronos.org/blog/khronos-ogc-and-geospatial-leaders-add-3d-gaussian-splats-to-the-gltf-asset-standard)**
  (February 2026), **with OGC involvement** — the geospatial standards body was at the
  table, which is the tell that this is aimed at exactly our kind of use.
- **`KHR_gaussian_splatting_compression_spz`** standardises Niantic's SPZ format:
  roughly 90 % smaller, and streamable rather than download-then-view.
- Converters already exist ([spz2glb](https://github.com/spz-ecosystem/spz2glb)).

A splat is now a first-class asset with a container and a compression story. For anything
delivered to a browser — which is our whole product — that is the difference between a
demo and a shippable feature.

### Browser renderers, ranked by fit for us

| | notes |
|---|---|
| **[Spark](https://news.ycombinator.com/item?id=44249565)** | WebGL2, three.js-native, built around `.spz`. Closest to our stack. |
| **[PlayCanvas SuperSplat](https://developer.playcanvas.com/user-manual/gaussian-splatting/)** | The mature editor *and* a strong runtime. Different engine from ours. |
| **[GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D)** | The popular three.js implementation; introduced `.ksplat` for streaming. |

### The constraint that would bite us first

PlayCanvas exposes `app.scene.gsplat.splatBudget` and defaults around **4 million splats**.
More importantly: **fragment processing is the bottleneck, not geometry**. Splat rendering
is fill-rate bound, and anti-aliasing multiplies fragments per pixel.

Set that against what we already know about our own runtime — the site's signature is
buttery 60 fps motion, `caps.ts` tiers integrated GPUs down to the CPU solver, and most
Indian visitors are on exactly that hardware. A splat scene is a *fill-rate* cost landing
on devices we already classify as tier 0–1. This is the number to measure before promising
anything.

## 3 · The no-drone route — CLOSED (see the correction at the end of this section)

**[Gaussian Building Mesh (GBM)](https://arxiv.org/html/2501.00625)** — Google Earth Studio
+ SAM2/GroundingDINO segmentation + 2D Gaussian splatting → a coloured 3D mesh of *any
building, addressed by name, postcode or coordinates*.

This matters because of a constraint that is central to the Substack story: **we cannot
fly drones over one of our three wards.** Barrackpore sits on an air-force station, a DGCA
red zone, and street-level survey there is barred under India's geospatial rules too. Our
standing conclusion was that drone→splat was the only true path to photoreal here, which
made photoreal effectively unreachable for a third of our study area.

GBM sidesteps flight entirely.

**Two caveats to carry:**

- Quality tracks the **multi-view coherence** of Google Earth Studio's data far more than
  its resolution. Kolkata coverage would need checking before any promise.
- **The licence question is real.** Google Earth Studio's terms for commercial derivative
  work need reading properly before a pixel of it enters the product — the same discipline
  that killed Open-Meteo and WAQI for us, and that we applied to MOSDAC.

> ### CORRECTION — 2026-08-09, later the same day
>
> The licence was read. **The route is closed for us.** Two independent prohibitions, both
> from Google's primary sources:
>
> - [Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/):
>   *"You may not use output, or use third party tools to capture output, from Google Earth,
>   Google Earth Pro, or **Earth Studio** to **reconstruct 3D models** or create similar
>   content…"* — this names the GBM technique specifically, not incidentally.
> - Same page: *"Google Earth content may not be used for any commercial or promotional
>   purposes."*
> - [Earth Studio FAQ](https://www.google.com/earth/studio/faq/): *"We currently do not
>   offer a license to use Google Earth imagery for commercial applications"*, listing
>   permitted uses as *"research, education, film and nonprofit."*
>
> GBM is valid academic work and remains worth reading. It is not available to a commercial
> consultancy. **Do not revisit this without a licence change from Google** — the wording is
> specific enough that there is no interpretation to argue about.
>
> Photoreal capture must therefore come from imagery we may derive from: our own flights
> where airspace permits, ground-level capture, or a purchased commercial licence
> (Maxar/Planet/Airbus). Airspace status for Ballygunge and Baruipur is **unverified** —
> Kolkata's proximity to NSCBI airport likely puts much of the metro in a yellow zone
> requiring permission, which is a process rather than a prohibition, unlike Barrackpore.

## 4 · Thermal Gaussian splatting exists

The genuinely exciting one, and the least expected.

- **[MrGS](https://arxiv.org/abs/2511.22997)** (Nov 2025) reconstructs RGB **and thermal**
  radiance fields together — and does it with actual physics rather than treating thermal
  as a second colour channel. It applies **Fourier's law of heat conduction** between
  neighbouring Gaussians before alpha blending, and uses **Stefan-Boltzmann plus the
  inverse-square law** to build a depth-aware thermal radiation map that constrains the
  geometry.
- **[Thermal3D-GS](https://www.researchgate.net/publication/385505712_Thermal3D-GS_Physics-Induced_3D_Gaussians_for_Thermal_Infrared_Novel-View_Synthesis)**
  — physics-induced Gaussians for thermal IR novel-view synthesis.
- **[Unpaired RGB-Thermal splatting](https://arxiv.org/pdf/2606.05491)** (2026) via visual
  geometric transformers — relaxes the requirement for registered RGB/thermal pairs.

**Why this lands for us specifically.** Our within-ward pattern is unvalidated and the
blocker is ground truth finer than ECOSTRESS's 70 m. The route we had identified was a
*night UAV thermal survey timed to an ECOSTRESS overpass*. A thermal splat turns that from
a set of 2D thermal images into a **3D thermal field** — which is a categorically better
thing to validate a 3D model against, and one you can re-render from any viewpoint the
model claims to predict.

Speculative, but the alignment is not a coincidence: this is a field converging on the
problem we already have.

## 5 · Physics *on* splats — real, and not our physics

- **[PhysGaussian](https://xpandora.github.io/PhysGaussian/)** (CVPR 2024) runs a
  **Material Point Method** on the Gaussian kernels themselves. No meshing, no marching
  cubes, no cage mesh — simulation and rendering share one discrete representation.
- **[i-PhysGaussian](https://www.themoonlight.io/en/review/i-physgaussian-implicit-physical-simulation-for-3d-gaussian-splatting)**
  makes the integrator implicit: stable at up to **20× larger timesteps**.
- **GaussianFluent** handles mixed materials; there is 2026 work on scene-level
  heterogeneous physics over splats; NVIDIA's **Kaolin + Warp** convert 3DGS to simulatable
  volumes without meshing.

**Be honest about relevance.** This is continuum mechanics — elastic solids, plastic
metals, non-Newtonian fluids, granular media. It is **not** heat diffusion over a field,
and anyone presenting PhysGaussian as our path has not read it.

What *does* transfer is the architectural idea: **one primitive carrying both appearance
and physical state.** Our raster already works that way. Worth understanding the analogy;
worth refusing the sales pitch.

### When you do need a mesh

**[SuGaR](https://github.com/Anttwo/SuGaR)** (CVPR 2024) is the standard bridge —
regularise the Gaussians to align with the surface, sample points on it, Poisson-reconstruct.
Relevant to us because shadows, our extruded buildings, and any collision or occlusion
query all want a mesh, not a cloud.

## 6 · The enterprise version, for reference only

OpenUSD as the interchange, Omniverse connecting CFD solvers or AI surrogates into a live
twin, and real work on
[city-scale microclimate — wind comfort, outdoor thermal comfort, greening strategies](https://doi.org/10.3390/smartcities9020039).
That last one is literally our domain, and worth reading properly.

**Honest read:** heavy, NVIDIA-centric, aimed at workstations and cloud. We ship a web
page to a phone in Kolkata. Worth knowing **OpenUSD as an interchange format**; not worth
adopting the stack. Useful mainly as a picture of what the well-funded version of this
looks like — which is itself Substack material about doing it without that budget.

## 7 · Limitations to remember

- **Thin structures artefact badly** — power lines, fences, antennas, railings. A Kolkata
  street is *made* of those. SPZ v2.0's rotational accuracy helps; it does not solve it.
- **Editing is primitive.** Select, delete, merge. No booleans, no semantic editing, no
  text-driven modification. Those remain research topics.
- **Mobile is hard.** High compute and storage; edge inference is an active research area
  rather than a solved one.

## 8 · The architectural conclusion

**The visual representation and the physical representation should not be the same thing.**

PhysGaussian can unify them because it simulates *the object it captured*. We simulate a
**field over a domain** — a temperature raster whose cells are not objects at all. The
natural architecture is:

- **splats** for appearance and context
- **raster** for physics
- **one shared coordinate frame** between them

We already paid for that third item the hard way, during the north–south mirror bug, when
the render, the terrain and the surface rasters each disagreed about which row was north.
The frame is the asset; the representations plug into it.

---

## Threads worth pulling next

- **SOLWEIG / UMEP** — open-source urban microclimate: shadow casting from building
  geometry, mean radiant temperature. Our own measurements say the within-ward shortfall is
  *missing ingredients — shadowing, thermal admittance, moisture, 3-D geometry* — and
  shadowing is the one we have the geometry for already.
- **WebGPU compute** as the successor to our WebGL2 ping-pong solver.
- **Neural surrogates** — what Omniverse markets as "AI physics"; relevant if the solver
  ever needs to be faster than real time.
- **4D / dynamic splatting** for time-varying scenes.
- **CityGML, 3D Tiles, OGC standards** for the geometric-twin layer.
