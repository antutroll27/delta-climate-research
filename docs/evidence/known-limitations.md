# Known limitations

Things wrong with, or unproven about, this engine — written down by us, before someone else finds them.
A limitation recorded here is a limitation we can discuss. One left out is one that ambushes us in a
review.

Each entry states **what is wrong**, **how we know**, **what it does and does not invalidate**, and
**what would close it**.

---

## 1. The published accuracy figures never see the canopy blend

**Status:** CLOSED 2026-08-12 for the model path · **Found:** 2026-08-12, during the CHM v2 upgrade ·
**Pre-existing**, not introduced by that work · **One part deliberately left open** — see *What is still
open* below.

> **Closed by** `scripts/_canopy.py` (the port), `surface_layers()` in `measure-spatial-accuracy.py` (the
> application), `tests/fixtures/canopy-oracle/` + `check-canopy-oracle.py` (the gate that keeps the two
> implementations from drifting), and `measure-canopy-blend-residual.py` (the cost of the one
> simplification taken). **The new spatial figures are below and they are slightly worse than the old
> ones.** That is the point: the old ones described a model nobody ran.

**What was wrong** *(everything from here to "What would close it" is the record as written at discovery,
kept in the present tense it was found in)*. The engine's headline accuracy — **night ±3.5 K, day ±5.0 K**
— is produced by the Python validation stack, which builds each ward's vegetation field from
`{ward}-surface.png` alone:

- `scripts/measure-spatial-accuracy.py` → `surface_layers()` reads only the surface PNG
- `scripts/build-ward-observations.py` derives each ward's `fvc` from the same
- `scripts/measure-shipped-amplitude.py` builds on both

But the browser does something else. `blendCanopyIntoVeg` (`src/scripts/climate-engine/ward-raster.ts`)
mixes the measured canopy raster into `veg[]` before the solver runs — and it is invoked in **exactly one
place, the browser path. No Python script applies it.**

**So the field we score has never been the field we render.**

**How we know.** During the v2 upgrade the accuracy output was byte-identical before and after a canopy
change that nearly doubled the underlying height field. That identity was the clue: it was a *tautology*,
not evidence. Tracing the inputs confirmed the regeneration commit touched only `*-canopy.png` and
`*-trees.json`, while every input to `measure-accuracy.py` was last written by far older commits.

**What it does NOT invalidate.** The ward-mean result is sound, and was verified three independent ways
rather than assumed:

- the blend is **mean-neutral to ≤0.0012** in ward-mean `veg` against a canopy field that moved ×1.7-1.9
  (run through the real shipped TS functions, v1 canopy vs v2) — *later measured at up to 0.0030 against
  the unblended field at the 140 grid; see "What is still open"*;
- driving the **real solver** on the two canopy fields moves ward-mean temperature by **≤0.016 K** — 0.5%
  of the ±3.5 K band;
- the mean-neutrality unit test passes.

So ±3.5 K / ±5.0 K remain defensible **as ward-mean figures**.

**What it DOES leave unproven.** Within-ward spatial skill. The same experiment showed the canopy change
moves the field materially at cell scale — **per-cell RMS 0.26-0.36 K, and spatial SD falling 7-12%** — and
nothing in the repo scores that. Suggestively, `measure-shipped-amplitude.py`'s own docstring notes the
model already draws roughly **2× the observed spatial SD**, so a reduction plausibly moves *toward* reality
— but that is inference, and inference is exactly what this project refuses to publish as measurement.

### What closing it actually changed (2026-08-12)

`surface_layers()` now applies the shipped blend. Same 34 near-nadir scenes, same 87 ward-scenes, same
caches — the only thing that moved is `veg`. Both baselines were re-run on the day, because the
`spatial-accuracy.json` committed in the repo turned out to have been produced against an older
built-footprint cache and was not a valid comparison.

| | before (model nobody ran) | after (model that ships) |
|---|---|---|
| r_physics, overall | 0.2154 | **0.2076** |
| r_physics, day / night | 0.2961 / 0.1556 | **0.2809 / 0.1533** |
| r_veg null, overall | 0.2380 | **0.1987** |
| r_built null, overall | 0.1795 | 0.1795 *(unchanged, as it must be)* |
| anomaly RMSE, overall | 1.836 K | **1.806 K** |
| veg term spatial SD | 0.641 K | **0.613 K** |

**Ward-mean figures did not move at all.** `measure-accuracy.py` re-ran byte-identical: ±3.5 K night /
±5.0 K day stand, exactly as mean-neutrality predicted.

**Read the spatial numbers honestly.** Correlation went *down*. The physics predictor lost 0.008 r and the
day figure lost 0.015 r. Nothing was tuned to recover it; that is the number.

**The uncomfortable finding, stated plainly.** The blend costs the **vegetation null** far more than it
costs the physics: r_veg falls 0.238 → 0.199, a 17% relative loss, at both phases. The shipped canopy
blend redistributes vegetation into a pattern that agrees with measured ECOSTRESS LST **less well** than
raw NDVI-derived FVC does. Two readings are available and we cannot yet separate them: either the CHM adds
vertical information that a 70 m thermal sensor genuinely cannot see, or the redistribution is putting
vegetation in the wrong places. **This is the first evidence either way, and it points the wrong way.** It
is the thing Phase B should test first, and it must not be reported as a win.

One consequence looks like an improvement and is not: physics-minus-best-null flips from **−0.023 to
+0.009**, so the model now nominally beats both nulls. It beats them because the null got worse, not
because the model got better, and +0.009 is far below the 0.05 the script requires before it will describe
within-ward pattern as carrying information. **The verdict is unchanged: do not describe the within-ward
detail as validated.**

### The one simplification taken, and what it costs

The blend is applied at the validation's own 140 grid, not by replaying the browser's 140 → 192 → blend
path. Approved in the design **on condition the residual be measured rather than assumed** — since the
defect being closed was precisely an unchecked assumption of negligibility.
`scripts/measure-canopy-blend-residual.py`, output in `data/calibration/canopy-blend-residual.json`:

| common grid | Δveg RMS | resample-only control | excess | share of the blend's own effect |
|---|---|---|---|---|
| 140 | 0.054 – 0.071 | 0.031 – 0.034 | 0.042 – 0.063 | 24 – 30 % |
| ECOSTRESS 70 m | 0.006 – 0.010 | 0.004 – 0.004 | 0.004 – 0.009 | **6 – 9 %** |

The control matters: most of a 140 → 192 → 140 difference is the bilinear round trip, not the blend, and
that round trip is a gap which **pre-dates this change** — the browser has always solved on an upsampled
veg field while the validation scores the 140 source. Only the excess is owned by this decision.

The figures are computed at 70 m, where an ECOSTRESS cell is five source cells wide and the area
downsample averages the resample-scale disagreement away. Worst case **0.072 K** equilibrium-equivalent,
and that conversion carries no diffusion, so it is an upper bound. **9.2 % against a stated 20 % threshold:
not material, decision stands.** Re-run the script if the grids, the blend strength, or the canopy rasters
change.

### What is still open

`scripts/build-ward-observations.py` was **deliberately not changed**. It derives each ward's **observed**
`fvc` from the surface PNG, and mixing a model input into an observation may be actively wrong rather than
symmetric with the model path. Measured while doing this work, so the size is known: blending would move
ward-mean `fvc` by **−0.00015 (ballygunge), −0.0030 (baruipur), −0.00051 (barrackpore)** — the clamp
residual, not zero, and larger than the ≤0.0012 recorded above. Small either way, but the question is
about correctness, not size, and it needs its own investigation.

**How to talk about it.** "The validation now scores the field the browser renders, and it is gated by a
parity oracle against the shipped TypeScript so the two cannot drift apart again. Measuring honestly cost
us 0.008 r. The interesting part is that it cost the vegetation baseline more, which is the first real
evidence about whether the canopy blend helps the spatial pattern — and so far it does not."

---

## 2. Roughly 30% of rendered trees stand on rooftops or in roads

**Status:** open, designed but parked (Phase B1) · **Measured:** 2026-08-12

Placement comes from the canopy raster alone, with no exclusion mask. Measured against shipped footprints
and buffered road centrelines:

| ward | on buildings | in roads | total |
|---|---|---|---|
| ballygunge | 19.0% | 17.1% | **36.0%** |
| barrackpore | 16.4% | 15.0% | **31.4%** |
| baruipur | 10.6% | 9.3% | **19.9%** |

The data to fix it — building footprints, road centrelines, water polygons — is already shipped and loaded.
The design exists (`2026-08-11-vegetation-placement-v2-design.md`, Phase B1), including the remedy that
matters: **relocate a blocked candidate to the nearest free cell rather than deleting it**, so canopy
density survives the mask.

Sharpened by the v2 upgrade: **v2's own authors instruct users to "mask non-vegetated areas … using an
independent land cover map."** v1 carried no such instruction. So the mask is now the documented usage of
the product we ship, not merely a nice-to-have.

---

## 3. ETH cross-check is blind over ~72% of each ward

**Status:** measured, documented, not a defect we can fix · **See:** `data-sources.md`

ETH's nodata is an ESA WorldCover **built-up mask** (verified at 99.73% per-pixel agreement), so a street
tree over a built-up cell is erased rather than measured as zero. Where it does report, and compared the way
its authors prescribe, it agrees within its own uncertainty — but it is structurally silent on exactly the
urban-canopy question we ask. It can never be quoted as "two sensors agree" without that blind spot stated
in the same breath.

---

## 4. Building heights are unvalidated, with a suspected low bias

**Status:** open, blocked on data · **See:** `data-sources.md`, [[icesat2-height-validation]]

Google Open Buildings 2.5D gave 98-99% of footprints a direct zonal height measurement, but no independent
Kolkata ground truth exists to check them against. The ICESat-2 comparison returned **`underpowered`**
(n=28 against a pre-registered bar of 30), so no correction was applied and none is claimed. GEDI was
evaluated as a replacement in 2026-08 and is worse — ~2-5 usable shots per ward across the whole mission.

Heights are **not** a physics input (`heat-map-model.ts` has no height term), so this does not touch the
temperature result. It affects the massing you see.

---

## 5. Tree density is a display scaling, not a measurement

**Status:** by design, disclosed in the receipts

`DENSITY_REF_H` (currently 30 m) sets how many sprites represent a given canopy height. Tree **count** is
therefore not a measured quantity and must never be quoted as one — canopy **height** is measured, positions
and species are modelled. The receipt says so. This is listed as a limitation because it is the single
easiest thing for a viewer to misread.
