# Known limitations

Things wrong with, or unproven about, this engine — written down by us, before someone else finds them.
A limitation recorded here is a limitation we can discuss. One left out is one that ambushes us in a
review.

Each entry states **what is wrong**, **how we know**, **what it does and does not invalidate**, and
**what would close it**.

---

## 1. The published accuracy figures never see the canopy blend — and once they did, the blend lost

**Status:** CLOSED 2026-08-12 · **Found:** 2026-08-12, during the CHM v2 upgrade · **Pre-existing**, not
introduced by that work.

> **Closed by** `scripts/_canopy.py` (the port), `surface_layers()` in `measure-spatial-accuracy.py` (the
> application), `tests/fixtures/canopy-oracle/` + `check-canopy-oracle.py` (the gate that keeps the two
> implementations from drifting), and `measure-canopy-blend-residual.py` (the cost of the one
> simplification taken).
>
> **AND THEN THE MEASUREMENT KILLED THE OPERATOR IT WAS BUILT TO SCORE.** The same day, the first strength
> sweep possible in this repo's history said the canopy→vegetation blend degrades agreement with
> ECOSTRESS monotonically. `CANOPY_BLEND_STRENGTH` (`src/scripts/climate-engine/types.ts`) is now **0**:
> the canopy raster is **render-only** and does not enter the temperature solve. See *The sweep, and the
> decision to switch the blend off* below. The published spatial figures are the strength-0 column, which
> is also the best column.

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

| | strength 0 (blend absent) | strength 0.5 (as shipped that morning) |
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

### The sweep, and the decision to switch the blend off (2026-08-12)

The paragraph above says "Phase B should test this first." Phase B was the same afternoon, and the answer
was decisive enough to act on immediately. The full sweep, same 34 scenes / 87 ward-scenes / three wards,
only the strength varying:

| strength | r_physics | r_veg | anomaly RMSE | veg term spatial SD |
|---|---|---|---|---|
| **0.00** | **0.2154** | **0.2380** | 1.8358 | 0.64 |
| 0.15 | 0.2145 | 0.2321 | 1.8308 | 0.63 |
| 0.25 | 0.2129 | 0.2245 | 1.8251 | 0.63 |
| 0.50 *(was shipped)* | 0.2076 | 0.1987 | **1.8061** | 0.61 |

**Four independent lines say the operator does not earn its place.**

**1. It monotonically degrades spatial agreement.** Not a threshold effect, not noise at one strength —
every step of the sweep costs correlation, in both predictors, at both phases.

**2. Its only benefit is an artefact.** RMSE is the one column that improves with strength, and the veg
term's spatial SD falls monotonically alongside it (0.64 → 0.61 K). `measure-shipped-amplitude.py` already
records that **the model draws ~2× the observed spatial SD**. So the blend buys its RMSE by *compressing an
amplitude we over-draw* — largely through its own `[0,1]` clamp, which bites **3–10 %** of cells. That is
error reduced by damping, not by getting the pattern right. The correct fix for an over-drawn amplitude is
the amplitude.

**3. It implies a cooling ratio outside the published range.** Schwaab et al. 2021 (*Nat Commun* 12:6763,
293 European cities) puts tree cooling at **2–4×** treeless green. At strength 0.5 our implied tree:grass
veg ratio is **4.9–8.1×**. Raw NDVI FVC is already in band at **2.0–2.7×**. The operator pushed a
physically-interpretable ratio out of the literature and nothing in the model noticed.

**4. It cannot use the information it appears to use.** `blendCanopyIntoVeg` is **exactly scale-invariant
in canopy height**: its target is `v̄ · hᵢ / h̄`, and the magnitude cancels, so `blend(2h) == blend(h)`
bit-for-bit. It consumes only the *normalised* canopy pattern. Two consequences, both important:

- the CHM v2 upgrade's accuracy gain (**MAE 4.3 → 3.0 m**) could never have reached the physics through
  this path, whatever we did — v2 is a render-quality argument, not an accuracy one;
- the single thing the operator *does* consume, the pattern, is the thing the sweep shows it makes worse.

**Decision: `CANOPY_BLEND_STRENGTH = 0`** (`src/scripts/climate-engine/types.ts`). The canopy layer stays —
it drives the rendered tree layer — but it **no longer enters the temperature solve at all**. The canopy
raster is now render-only, in the same sense the relief field is, and the provenance receipt says so
(`kind: "reference"`, `confidence: "… NOT used by the simulation"`).

**What that costs, honestly.** Nothing measured. Every spatial figure improves back to the strength-0
column, ward-mean accuracy is untouched (the blend was mean-neutral, so it never reached `measure-accuracy.py`
in the first place), and `physics − best null` returns to **−0.023**: the model once again does *not* beat
the vegetation null on within-ward pattern. That is a worse-looking number and the true one. The +0.009 we
briefly had was purchased by degrading the baseline.

**What it does not resolve.** We still cannot separate "the CHM adds vertical information a 70 m sensor
cannot see" from "the redistribution puts vegetation in the wrong places". Turning the blend off is not a
verdict on the CHM; it is a verdict on *this operator*, at the only scale we can score it. A canopy term
that is not scale-invariant, or an observation that can resolve street trees, would both be new evidence.

**Reversibility, and why it is one constant.** The strength used to be a bare `0.5` at the TypeScript call
site plus a separate literal in `scripts/_canopy.py` — the same two-implementations-of-one-equation shape
this whole entry is about. It is now `CANOPY_BLEND_STRENGTH` in `types.ts`, imported by
`dump-canopy-oracle.mjs`, frozen into the fixture as `shippedStrength`, and asserted against the Python
constant by `check-canopy-oracle.py` on every `npm run test:py`. `blendCanopyIntoVeg` itself is unchanged
and still oracle-checked at strengths 0, 0.5 and 1. Re-enabling is a one-line change — and must be
accompanied by a re-run of the sweep above, not an argument.

### The one simplification taken, and what it costs

> **Now moot in production, kept as the record.** At `CANOPY_BLEND_STRENGTH = 0` the blend is an identity,
> so applying it at 140 or at 192 makes no difference — the residual below is exactly zero for the shipped
> configuration. It is preserved because it is the evidence that the *measurement* on which the strength-0
> decision rests was itself sound, and because it becomes live again the moment anyone re-enables the blend.

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

### What was still open, and how switching the blend off closed it

`scripts/build-ward-observations.py` was **deliberately not changed**. It derives each ward's **observed**
`fvc` from the surface PNG, and mixing a model input into an observation may be actively wrong rather than
symmetric with the model path. Measured while doing this work, so the size is known: blending would move
ward-mean `fvc` by **−0.00015 (ballygunge), −0.0030 (baruipur), −0.00051 (barrackpore)** — the clamp
residual, not zero, and larger than the ≤0.0012 recorded above. Small either way, but the question is
about correctness, not size, and it needs its own investigation.

**Resolved by the strength-0 decision, for the right reason rather than by luck.** The question was whether
an *observation* should have a *model input* mixed into it. There is now no model input to mix: the canopy
does not enter the solve, so the observed `fvc` and the modelled `veg[]` come from the same measured
Sentinel-2 surface and no asymmetry exists. The question would return, unchanged and still unanswered, if
the blend were ever re-enabled — which is why the measurement above is recorded rather than deleted.

**How to talk about it.** "The validation now scores the field the browser renders, gated by a parity
oracle against the shipped TypeScript so the two cannot drift apart again. The first thing that honest
measurement told us was that our own canopy operator was making the model worse — so we turned it off the
same day. The canopy still draws the trees; it no longer touches the temperature. We lost a number we
liked (the model briefly beat both nulls) because that number came from degrading the baseline."

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
