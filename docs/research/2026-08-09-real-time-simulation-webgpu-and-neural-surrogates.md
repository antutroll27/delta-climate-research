# Real-time simulation in the browser: WebGPU, readback, and what neural surrogates actually buy

**Date:** 2026-08-09
**Status:** research notes. Nothing here is implemented or specced.
**Why it exists:** raw material for the Substack series, and a decision I want on record
*before* someone spends a month on it.

Third of three. See also
[gaussian-splatting-and-3d-twins.md](2026-08-09-gaussian-splatting-and-3d-twins.md)
and [shadow-svf-and-the-missing-third-dimension.md](2026-08-09-shadow-svf-and-the-missing-third-dimension.md).

---

## 1 · WebGPU shipped, and the reason to want it is not the one everybody gives

The support story resolved while we were not looking. WebGPU
[ships by default in Chrome, Edge, Firefox and Safari](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)
as of late 2025 — Safari 26 brought it to macOS, iOS, iPadOS and visionOS — at roughly
**82 % global support**. Firefox on Android is the notable gap, targeted for late 2026.

Which matters for us, because our audience is substantially Android phones in India, and
our `caps.ts` already tiers devices down to a CPU solver. But the gap is narrower than it
was, and the fallback path already exists.

**The usual argument for WebGPU does not apply to us.** The pitch is compute shaders:
real storage buffers, workgroup shared memory, arbitrary writes, instead of
[coercing fragment shaders into general-purpose maths by encoding state in floating-point textures](https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu)
— the ping-pong technique our `sim-gpu-webgl2.ts` uses today.

That pitch is aimed at people who are compute-bound. **We are not.** Our grid is
192 × 192 = **36,864 cells**, an explicit-Euler five-point stencil. That is nothing. A
2015 integrated GPU does it in microseconds. Rewriting the stencil in WGSL would win us
approximately zero.

## 2 · The actual case: `readPixels` is a synchronous stall on the worst possible hardware

Here is what the GPU solver does to get its answer back to JavaScript
(`sim-gpu-webgl2.ts:142`):

```ts
temperature(): Float32Array {
  const rgba = new Float32Array(this.n * this.n * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontBuffer);
  gl.readPixels(0, 0, this.n, this.n, gl.RGBA, gl.FLOAT, rgba);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const field = new Float32Array(this.n * this.n);
  for (let i = 0; i < field.length; i++) field[i] = rgba[i * 4];   // keep R, discard GBA
  ...
}
```

Three costs stacked in eight lines:

1. **`readPixels` is synchronous.** It blocks until the GPU has finished everything queued.
2. **It reads RGBA when only R carries data.** 576 KB moved to deliver 144 KB. A 4× tax.
3. **Then JavaScript walks 36,864 strided reads** to throw three quarters of it away.

Cost 1 is the one that bites, and it bites hardest exactly where we care. Every phone
in our target market runs a **tile-based deferred renderer** — Adreno, Mali, PowerVR.
On those architectures, per
[Mozilla's own mobile-GPU notes](https://wiki.mozilla.org/Platform/GFX/MobileGPUs),
*changing the framebuffer binding forces immediately resolving the rendering of the
current framebuffer*, and anything depending on framebuffer pixel values stalls the
pipeline. Tile-based GPUs win by keeping colour and depth on-chip and resolving once;
a mid-frame readback is a demand to resolve now, and it throws that win away.

And our own source comment says this page holds **three WebGL contexts** — MapLibre, the
relief renderer, and the solver. The stall is not competing with nothing. It is competing
with the basemap.

**WebGPU's answer is `mapAsync` on a staging buffer** — the readback is a promise, the
pipeline does not stall, and an `r32float` storage buffer moves exactly the 144 KB that
carries information, with no de-interleave loop.

So the honest framing: **the WebGPU case for us is I/O, not compute.** That is a smaller,
more specific claim than the marketing one, and a much more likely one to survive contact
with a profiler.

**Two caveats, stated so nobody quotes the paragraph above as a finding.** The readback
is already cached — `if (this.readback) return this.readback` — so it happens at most
once per solver step, not once per frame. And our own performance notes say the landing
page is GPU-bound with no JS hotspot. **I have not measured this.** It is a hypothesis
with a clear mechanism, which is exactly the kind of thing this project has learned to
measure before believing. A cheap first probe: time `temperature()` on a mid-tier Android
device and see whether it shows up at all.

## 3 · Neural surrogates: a speed technology, sold as an accuracy technology

This is the section I most want on record, because it is the expensive mistake available
to us right now, and the literature reads *very* seductively if you skim it.

The framing is that neural surrogates
[generate physically plausible flow fields directly from geometry without case-specific solver runs, enabling real-time microclimate assessment](https://arxiv.org/html/2512.14725).
Read that after weeks of staring at `rModel 0.303 < rVegOnly 0.314` and it sounds like
the answer to everything.

Two representative results, with their real numbers:

### Localized Fourier Neural Operator

[Local-FNO](https://arxiv.org/abs/2411.11348) predicts multivariable 3-D urban
microclimate: **0.35 m/s velocity error, 0.30 °C temperature error** over a 60-second
horizon, at roughly **50× the speed of a CFD solver**, with a 23.9 % error reduction over
plain FNO.

0.30 °C is a genuinely excellent number. Then read the hardware line: 150 million feature
dimensions **on a single 32 GB GPU**. Our target device shares system RAM with the
browser and the basemap.

### Graph diffusion for urban flow

[Generative Urban Flow Modeling](https://arxiv.org/html/2512.14725) (Dec 2025) trains a
score-based diffusion model on a hierarchical multiscale GNN over unstructured CFD
meshes. Input: building geometry plus a wind direction. Output: a steady-state 2-D
velocity field.

The reported accuracy is the part that skimming hides:

| metric | value |
|---|---|
| relative L² error | **0.45 – 0.58** |
| cosine similarity (direction) | 0.56 – 0.71 |
| inference | **7.5 s per case on an A100** |
| training data | one Bristol neighbourhood, ~40 M cells, 4 slices |
| code / weights | not released |

A relative L² error near 0.5 means the field is about half wrong. It captures wakes and
recirculation zones qualitatively — a real achievement against a CFD baseline costing
days — but it is not a number you build a municipal recommendation on. And "real-time"
here means *7.5 seconds on a data-centre GPU*, which is real-time compared to CFD and
nowhere near real-time compared to our 60 fps budget on an iGPU.

### The structural point, which is the actual lesson

**Every one of these is a surrogate for a high-fidelity solver you already ran.** They
are trained on CFD output. The value proposition is: you have an expensive correct thing,
and you want a cheap approximate thing that mimics it.

**We do not have the expensive correct thing.** We have no CFD. So a surrogate cannot
give us physics we never simulated — it can only give us a faster copy of physics we
already have, and our physics already runs at 60 fps on a phone.

Put bluntly: **neural surrogates buy speed, and we do not have a speed problem.** We have
a physics-completeness problem. Those trade against each other in the opposite direction.

I am writing this down because in six months someone — possibly me — will read "AI physics"
in an NVIDIA deck and propose this, and the counter-argument should already be on disk.

### The exception worth keeping

One result does complicate the dismissal.
[FLUME-FNO](https://arxiv.org/abs/2503.19708) reports robust learning of 3-D wind and
temperature fields in **unseen urban morphologies** from just **23 CFD simulations**,
by computing multi-directional distance features over the domain and cropping the encoded
geometry into patches.

Twenty-three runs is not absurd. OpenFOAM is free. And this points straight at
**advection** — our own notes' name for the real digital-twin gap, the reason the model
cannot beat a vegetation map at placing heat, and the thing our equation has no term for.
The chain would be: run ~23 OpenFOAM cases over our wards → train a surrogate → get a
wind field → finally have an advection term.

That is a multi-week project with real uncertainty at every link, and the honest thing is
to size it against the alternative rather than get excited about it.

## 4 · The comparison that decides the next move

Both roads lead to the same failing metric — the within-ward pattern. They cost
differently by about two orders of magnitude.

| | shadow + SVF | CFD-trained advection surrogate |
|---|---|---|
| new data needed | **none** — footprints + heights are on disk | ~23 OpenFOAM runs per ward |
| new infrastructure | none | CFD meshing, HPC time, a training pipeline |
| runtime cost | two multiplier textures, same solver | model inference, or a precomputed field |
| runs on a tier-0 iGPU | yes | unknown, probably not |
| targets | `sun` and `kRad` — both currently scalars | the missing advection term |
| falsifiable before building | **yes, and cheaply** — see the sign test | no |
| effort to first number | an afternoon | weeks |

The tiebreaker is not the table. It is that **the cheap road can be killed before it is
built.** The SVF sign test in the companion note needs no model change at all: compute
SVF once, correlate it against night residuals we already hold, check the sign we fixed
in advance. If it comes out null or backwards, we have lost an afternoon and learned
something true — the same way the OHM sign test killed thermal storage and the
propagation test killed the 1.5 K claim.

The expensive road has no equivalent early exit. You find out after the CFD runs.

**So: shadow and SVF first, and specifically the test before the implementation.** Not
because advection is wrong — it is still the deepest gap we have named — but because one
of these two can prove itself wrong by Tuesday and the other cannot.

---

## Threads still worth pulling

- **Measure the readback.** Time `temperature()` on a mid-tier Android. Everything in §2
  is contingent on a number nobody has taken.
- **OpenFOAM over a Kolkata ward** — what does one case actually cost, in mesh prep and
  wall time? That sizes the whole right-hand column.
- **WebGPU as a `caps.ts` tier**, not a replacement. The CPU fallback already exists; a
  WebGPU path would be a fourth rung, not a rewrite.
- **`tSky` is one number**, like `kRad` was. SOLWEIG models an anisotropic sky. Same class
  of defect, probably smaller effect.
