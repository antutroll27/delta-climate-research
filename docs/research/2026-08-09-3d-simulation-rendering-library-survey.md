# 3D, simulation, splatting and rendering: a surveyed shortlist

**Date:** 2026-08-09
**Status:** survey. Nothing adopted, nothing specced.
**Why it exists:** a map of what is worth reaching for when we come back to 3D, and
source material for the Substack series.

Fourth of four from Learning Sunday. See also
[gaussian-splatting-and-3d-twins.md](2026-08-09-gaussian-splatting-and-3d-twins.md),
[shadow-svf-and-the-missing-third-dimension.md](2026-08-09-shadow-svf-and-the-missing-third-dimension.md),
[real-time-simulation-webgpu-and-neural-surrogates.md](2026-08-09-real-time-simulation-webgpu-and-neural-surrogates.md).

---

## How to read this

**Every licence and star count below was read from the GitHub API on 2026-08-09**, not
from a blog post or a search summary. That distinction earned its keep immediately — see
§1. Star counts are a popularity signal, not a quality one; the *last-updated* column is
the more useful number, because an abandoned graphics repo is a trap.

Where a claim is contested, it is marked contested. Where I have not verified something,
it says so.

## 1 · The licence map, which is the finding nobody puts in the README

The single most important thing I learned today about this ecosystem:

> **The canonical 3D Gaussian Splatting repository cannot be used commercially.**

[`graphdeco-inria/gaussian-splatting`](https://github.com/graphdeco-inria/gaussian-splatting)
— 22,909 stars, the reference implementation of the original SIGGRAPH 2023 paper —
carries a bespoke Inria/MPII licence whose own text says the *"Licensor's goal is to allow
the research community to use, test and evaluate the Software."* GitHub reports it as
`NOASSERTION`, which is easy to skim past as "probably fine". It is not fine.

Meanwhile the things you would actually build on are clean:

| what | repo | licence | ★ | updated |
|---|---|---|---|---|
| splat training (CUDA) | [nerfstudio-project/gsplat](https://github.com/nerfstudio-project/gsplat) | **Apache-2.0** | 5,507 | 2026-08-09 |
| three.js splat renderer | [sparkjsdev/spark](https://github.com/sparkjsdev/spark) | **MIT** | 3,477 | 2026-08-09 |
| three.js splat renderer | [mkkellogg/GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) | **MIT** | 2,850 | 2026-08-07 |
| compressed splat format | [nianticlabs/spz](https://github.com/nianticlabs/spz) | **MIT** | 902 | 2026-08-06 |
| fast training (CVPR'26) | [fastgs/FastGS](https://github.com/fastgs/FastGS) | **MIT** | 1,193 | 2026-08-08 |
| research framework (CVPR'26) | [nerficg-project/faster-gaussian-splatting](https://github.com/nerficg-project/faster-gaussian-splatting) | **Apache-2.0** | 212 | 2026-08-08 |

**The pattern to carry:** in this field the paper repo is usually research-licensed and
the ecosystem reimplementation is usually permissive. Check the reimplementation, not the
paper. Same discipline that sent us to read MOSDAC's terms and that made SOLWEIG's GPL-3.0
a read-the-paper situation rather than a vendor-the-code one.

## 2 · The most interesting paper I read today: splat *triangles*

**[Triangle Splatting](https://trianglesplatting.github.io/)**
([arXiv 2505.19175](https://arxiv.org/html/2505.19175), Apache-2.0,
[1,189★, updated today](https://github.com/trianglesplatting/triangle-splatting)).

A differentiable renderer that splats *a soup of triangles* into screen space with
end-to-end gradient optimisation, and reportedly **surpasses 3DGS, 2DGS and 3D Convex
Splatting on visual fidelity, training speed and rendering throughput** simultaneously.

The reason this is more than a benchmark win: Gaussians were chosen because they are
smooth and differentiable, and the field has spent three years discovering that
**infinite support and smooth falloff are exactly wrong for hard edges and flat
surfaces** — buildings, in other words. The alternatives now include
[3D Convex Splatting](https://arxiv.org/html/2411.14974v1) (CVPR 2025 Highlight,
Apache-2.0, +0.81 PSNR over 3DGS with *fewer* primitives), Beta kernels, learnable basis
functions, and [Fourier Splatting](https://arxiv.org/pdf/2603.19834).

And triangles are the primitive **every GPU ever made is built to rasterise.** File 1's
main worry about splats for us was that they are *fill-rate bound*, and fill rate is
precisely what tier-0/1 integrated GPUs have least of. A triangle-based radiance field
needs no custom splat renderer, no per-frame depth sort, and no fill-rate blowup — it
drops into three.js's existing pipeline as geometry.

If splats ever become real for us, **this is the branch to watch**, not vanilla 3DGS.

## 3 · Geospatial splatting became a standards story this year

The single biggest practical shift, and it happened in April:

**[Cesium shipped hierarchical LOD for Gaussian splats in 3D Tiles](https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/)**
(2026-04-27) across CesiumJS, Cesium for Unreal and Cesium ion. 3D Tiles as the spatial
index, glTF as the payload — so city-scale splat datasets stream with proper LOD instead
of being a single monolithic download. 3DGS is slated for the proposed **3D Tiles 2.0 OGC
community standard**, and `KHR_gaussian_splatting` hit release candidate in February with
ratification targeted Q2 2026.

Scale datapoint worth keeping: the Microsoft Redmond Campus tileset is **20,169 photos
over ~3.7 km², reconstructed as 110 million splats.** One of our wards is 1.42 km square,
about 2 km² — the same order of magnitude. That is the number to reason from if anyone
asks what capturing Ballygunge would cost.

[CesiumGS/cesium](https://github.com/CesiumGS/cesium) is Apache-2.0, 15,545★, updated
yesterday.

**Research on the same problem:** [CityGaussian](https://github.com/DekuLiuTesla/CityGaussian)
(ECCV'24 + ICLR'25, 1,238★), [Octree-GS](https://github.com/city-super/Octree-GS)
(TPAMI 2025, 857★ — LOD-structured Gaussians for *consistent* real-time rendering),
[BlitzGS](https://arxiv.org/pdf/2605.13794), [MetroGS](https://arxiv.org/pdf/2511.19172),
[TraGraph-GS](https://arxiv.org/pdf/2506.08704). Both major repos are `NOASSERTION` —
check before use.

## 4 · Rendering research worth actually reading

**[RenderFormer](https://microsoft.github.io/renderformer/)** (SIGGRAPH 2025, MIT licence,
[968★](https://github.com/microsoft/renderformer)) — the one that made me stop. It renders
triangle meshes **with full global illumination using no physics at all**: rendering is
reformulated as sequence-to-sequence, tokens-of-triangles → tokens-of-pixel-patches, in
two transformer stages (view-independent triangle-to-triangle light transport, then
view-dependent ray-bundle→pixels). **No per-scene training or fine-tuning.** There is
already a [RenderFormer++](https://arxiv.org/html/2606.30380v1) on scalability and
physical grounding.

Not useful to us — we need a temperature field, not a beauty pass. Worth reading anyway,
because it is the clearest example of a learned model displacing a simulator *wholesale*
rather than approximating one, which is the shape of thing worth recognising early.

**[Mitsuba 3](https://github.com/mitsuba-renderer/mitsuba3)** (EPFL; BSD-3-style — the
`NOASSERTION` is just GitHub failing to parse a hand-written BSD-3 header; 2,880★) plus
**[Dr.Jit](https://github.com/mitsuba-renderer/drjit)** (BSD-3-Clause, 794★). A fully
**differentiable** renderer: derivatives of the whole light-transport simulation with
respect to camera pose, geometry, BSDFs, textures and volumes. Dr.Jit fuses the render
into JIT kernels with LLVM (CPU) and CUDA/OptiX (GPU) backends.

The reason to care: *differentiable* means invertible. This is the machinery for asking
"what surface properties would have produced the image I observed" — the same question
shape as our inverse problems, in a different domain.

## 5 · Simulation engines

| | licence | ★ | note |
|---|---|---|---|
| [taichi-dev/taichi](https://github.com/taichi-dev/taichi) | Apache-2.0 | 28,322 | GPU programming in Python; the DSL a lot of graphics research is written in |
| [Genesis-Embodied-AI/Genesis](https://github.com/Genesis-Embodied-AI/Genesis) | Apache-2.0 | 29,719 | pure-Python multi-solver platform — see caveat |
| [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 | 14,493 | the reference contact-dynamics engine |
| [jrouwe/JoltPhysics](https://github.com/jrouwe/JoltPhysics) | MIT | 11,303 | the *Horizon* engine; WASM port reaching browsers |
| [NVIDIA/warp](https://github.com/NVIDIA/warp) | Apache-2.0 | 6,964 | Python → GPU kernels for simulation |
| [dimforge/rapier](https://github.com/dimforge/rapier) | Apache-2.0 | 5,624 | fastest browser physics; SIMD-WASM builds |
| [NVIDIA-Omniverse/PhysX](https://github.com/NVIDIA-Omniverse/PhysX) | BSD-3-Clause | 4,706 | |

**Genesis, honestly.** It bundles Rigid / MPM / SPH / FEM / PBD / Stable-Fluid solvers in
pure Python across CPU, NVIDIA, AMD and **Apple Metal** backends, which is a genuinely
unusual breadth. The headline numbers — "43 M FPS", "430,000× real time", "10–80× faster
than Isaac Gym and MuJoCo MJX" — **are contested.**
[Stone Tao's analysis](https://stoneztao.substack.com/p/the-new-hyped-genesis-simulator-is)
found the benchmark scripts used the fastest solver settings (physics substeps = 1, i.e.
least accurate), on a scene of one plane and one arm, and called the presentation
*"egregiously misleading"*. To their credit the Genesis team re-ran and published a fuller
report with open code afterwards.

Keep the engine on the list; do not quote the number. Note also that this is *robotics*
simulation — rigid bodies and contact — not atmospheric physics. Same word, different
field.

**Rapier vs Jolt for the browser**, which is the practically relevant comparison: Rapier's
SIMD-WASM packages (`@dimforge/rapier3d-simd`) are reported 2–5× faster than its 2024
releases and roughly 3–4× Cannon-es on large scenes, with cross-platform determinism.
Jolt's WASM port shows early benchmarks around **2× Rapier on large scenes** and adds soft
bodies and cloth. Both numbers are third-party summaries I have not reproduced.

## 6 · Inverse rendering and relighting — the branch pointing at our problem

Standard splats bake illumination into radiance, so you cannot move the sun. The 2026 work
is about decomposing it back out, and one paper sits directly on today's other thread:

- **[SSD-GS](https://arxiv.org/pdf/2604.13333)** — *Scattering and Shadow Decomposition*
  for relightable 3DGS. Separating shadow from material is the same quantity §6 of the
  shadow note wants to *predict*, approached from the observation side.
- **[BRDFusion](https://arxiv.org/pdf/2606.17049)** — physics + generation for **urban
  scene** inverse rendering.
- **[MaterialClusterGS](https://arxiv.org/pdf/2606.09018)** — palette-based material
  decomposition with 2D Gaussian Splatting.
- **[RTR-GS](https://arxiv.org/pdf/2507.07733)** (ACM MM), **[GI-GS](https://arxiv.org/pdf/2410.02619)**,
  **[Phys3DGS](https://arxiv.org/pdf/2409.10335)**, **[TRON](https://arxiv.org/pdf/2606.11314)**.

Note the recurring move to **2D Gaussians / surfels** — oriented discs instead of blobs —
because they give cleaner surfaces and play better with material-aware rendering. Same
lesson as §2: the smooth 3D blob is not the right primitive for built surfaces.

## 7 · Keeping current without re-doing this

[longxiang-ai/awesome-gaussians](https://github.com/longxiang-ai/awesome-gaussians) (330★)
tracks 3DGS arXiv papers with **daily automated updates** — a feed rather than a list, and
the cheapest way to not fall behind.
[realtimerendering.com's paper indexes](https://www.realtimerendering.com/kesen/siga2025Papers.htm)
remain the best SIGGRAPH/SIGGRAPH-Asia roundups. SIGGRAPH 2026 is 19–23 July.

## 8 · What I would actually reach for, for this project

Ordered by how likely it is to matter to us, which is not the same as how exciting it is.

1. **[TSL (Three.js Shading Language)](https://deepwiki.com/mrdoob/three.js/3.5-webgpu-and-node-based-materials)**
   — the boring one that wins. A single TSL shader is reported to compile to **both WGSL
   and GLSL**, so one solver source targets WebGPU *and* our existing WebGL2 path. That
   maps exactly onto the `caps.ts` tiering problem: today a WebGPU backend would mean
   maintaining two shader implementations, and TSL is the reason it would not have to.
   Cheap to evaluate, no research risk. *(Claim taken from three.js docs and 2026
   write-ups; not yet reproduced against our own shader.)*
2. **Spark** (MIT, three.js-native, updated daily) — if splats ever ship, this is the
   renderer, and file 1's fill-rate question is the measurement that decides it.
3. **Triangle Splatting** — the branch to watch, for the fill-rate reason in §2.
4. **Cesium 3D Tiles + LOD** — the reference architecture for streaming city-scale 3D,
   whether or not we use Cesium itself.
5. **Dr.Jit / Mitsuba 3** — not for rendering. For the differentiable-inverse-problem
   machinery, if we ever want to invert observations into surface properties.
6. **Rapier** — only if the product ever needs interaction physics. It does not today.

**And the thing not to reach for:** none of §5 simulates atmospheric heat. They are
rigid-body and continuum-mechanics engines. The word "simulation" spans two unrelated
fields here, and the gap between them is where an expensive month could disappear.

---

## Threads still worth pulling

- **Evaluate TSL against our WebGL2 solver** — the highest-value item on this page, and
  the least glamorous.
- **Triangle Splatting on a real capture** — does the fidelity claim hold outside the
  paper's scenes?
- **Read SSD-GS properly** — shadow decomposition from observation, against our shadow
  prediction from geometry. Two directions on one quantity.
- **`KHR_gaussian_splatting` ratification** (targeted Q2 2026) — check whether it landed.
