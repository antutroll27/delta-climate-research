# Make the validation score the field we actually render — design

**Date:** 2026-08-12 · **Status:** approved (CEO) · **Closes:** `docs/evidence/known-limitations.md` §1

## The problem, in the code's own words

`surface_layers()` in `scripts/measure-spatial-accuracy.py` carries this docstring:

> "Read back from the SHIPPED texture rather than recomputed from the composite cache: **this is what the
> browser actually runs on**, quantisation included, **so validating anything else would validate a model
> nobody uses.**"

It then does exactly that. The browser takes the same surface PNG and applies `blendCanopyIntoVeg`
(`src/scripts/climate-engine/ward-raster.ts:130`) before solving — mixing measured canopy height into
`veg[]`. **No Python script applies that blend.** So every published spatial figure describes a model that
has never shipped.

Found 2026-08-12 during the CHM v2 upgrade: the accuracy output was byte-identical across a canopy change
that nearly doubled the height field. That identity was the tell — a tautology, not evidence.

**What is and is not at risk.** Ward-mean accuracy (±3.5 K night / ±5.0 K day) is sound and was verified
three ways: the blend is mean-neutral to ≤0.0012, the real solver's ward mean moves ≤0.016 K under a
canopy change of ×1.7–1.9, and the mean-neutrality unit test passes. **Within-ward spatial skill is the
unproven part** — and the same experiment showed the canopy change moves the field at cell scale (per-cell
RMS 0.26–0.36 K, spatial SD −7–12%), so it is not a small effect being ignored.

## Decision

Port the blend to Python and apply it in `surface_layers()`, **at the validation's own 140 grid**, then
measure and publish how far that lands from the browser's 192-grid result.

**Why 140 rather than replicating the browser's 140→192→blend path:** smallest change, one function, and it
keeps the 192-grid resample out of the laboratory. The blend is mean-neutral at any grid, so ward means
agree exactly; only the spatial pattern differs slightly.

**The condition attached:** the residual must be *measured and published*, not asserted to be small. The
defect being fixed is precisely a difference someone assumed was negligible without checking. If the
measured residual turns out to be material relative to the spatial signal, that is a finding and the
decision gets revisited — do not absorb it.

## The port needs a parity oracle

`blendCanopyIntoVeg` will exist twice. Two implementations of one equation drift silently, and this repo
already gates its Go port that way (`scripts/dump-parity-oracle.py`, `tests/fixtures/geo-oracle/`).

**TypeScript is the oracle.** It is the shipped instrument; Python is the laboratory that must reproduce
it. (Consistent with the standing rule that Python reads `types.ts`, never the reverse.)

Capture the TS implementation's output on fixed synthetic inputs as a JSON fixture, and check the Python
port against it — including the edge cases the TS code explicitly handles: mismatched lengths, `cSum <= 0`,
and the `[0,1]` clamp that makes the operator only *approximately* mean-neutral.

## What changes

- **New shared Python module** (e.g. `scripts/_canopy.py`) holding the port: canopy PNG decode
  (R channel ÷255 × `CANOPY_HI`, **N→S row flip** — the flip is a documented past bug source) and the
  blend itself.
- **`surface_layers()`** applies it when a canopy raster exists, and the docstring stops being ironic.
- **Parity fixture + check**, wired so it runs in CI rather than on request.
- **The residual measurement**, recorded in the evidence library.

## Consequences to expect

- **The published spatial figures will move.** That is the point. The new numbers describe the shipped
  model for the first time; the old ones described a model nobody ran. Both should be stated during the
  transition rather than quietly swapped.
- **Ward-mean figures should not move** (mean-neutrality). If they do, the blend is not as neutral as
  documented — a real finding, to be reported rather than tuned away.
- Downstream consumers of `surface_layers()` — `measure-shipped-amplitude.py`,
  `build-ward-observations.py` — inherit the change. Whether `build-ward-observations.py` *should* blend is
  a separate question: it derives observed `fvc`, and blending an observation with a model input may be
  wrong. **Investigate before changing it; do not assume symmetry with the model path.**

## Non-goals

- No physics change. `blendCanopyIntoVeg` itself is not modified.
- No re-tuning of anything to make a number come out. If accuracy worsens once measured honestly, that is
  the honest number.
- No Phase-B canopy work (built-up mask, ETH weighting) — that is the *next* phase, deliberately after
  this one so its effect is measurable.
