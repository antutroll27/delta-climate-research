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

*Update, 2026-09-24: the headline night band is now ±3.0 K, after the forcing-date correction in §15; the ±3.5 K below is the band as it stood at discovery.*

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

**0. The sweep above was measured on CHM v1 — and re-measuring on the shipped v2 canopy makes the case
STRONGER, not weaker.** This branch was cut before the v2 upgrade landed, so the table above describes the
v1 field. Publishing figures measured on data we no longer serve is precisely the error this whole section
exists to document, so the two decisive arms were re-run on the merged v2 tree:

| canopy | r_veg @ strength 0 | r_veg @ strength 0.5 | degradation |
|---|---|---|---|
| v1 | 0.2380 | 0.1987 | −0.039 |
| **v2 (shipped)** | **0.2380** | **0.1718** | **−0.066** |

r_physics @ 0.5 also falls further, 0.2076 → 0.2028. **The blend hurts roughly 70% more with v2 than with
v1.** Better canopy heights, redistributed by an operator that reads only pattern, push the vegetation field
further from what ECOSTRESS sees.

An internal check worth recording, because it is what makes the two runs comparable: the **strength-0 arm is
identical to four decimal places across both** (0.2154 / 0.2380 / 1.8358). It has to be — at strength 0 the
canopy is unused, so which version produced it cannot matter. That the harness reproduces it exactly means
the difference at 0.5 is signal, not run-to-run noise.

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

**Bangalore inherits this by construction (2026-09-10).** Its tree scatter is the same
`_generate` function, imported from `fetch-canopy.py` rather than reimplemented, so the
Bangalore tree counts (27,408 / 28,573 / 12,015) are display scalings in exactly the same
sense. The two cities differ in one respect: Bangalore drops candidates that fall inside a
building footprint, which closes the roof half of limitation 2 there and measures it at 6–9 %.

---

## 6. The ward-mean observations do not identify `Q` — they only pin the product `Q·built`

**Status:** open, quantified, gated · **Found:** 2026-08-13, while fixing the stale built-footprint cache

**What is wrong.** `Q` (`types.ts`, currently 0.419) is the anthropogenic/built heating coefficient, and the
calibration cannot measure it. It enters the ward-scale fit only as `Q·built`, so a change in the building
raster is absorbed by a compensating change in `Q` with almost no effect on fit quality. The engine's
rendered field, however, is *not* indifferent to which factor carries the magnitude.

**How we know.** Correcting the stale built cache changed ward built fractions by −14% (ballygunge
0.3691 → 0.3189, barrackpore 0.3572 → 0.2605, baruipur 0.2208 → 0.2013). Refitting candidate G on the
corrected observations moved the free `q_day` **0.419 → 0.5175, a 23% swing**, and bought:

| on the corrected observations (n = 82) | Q = 0.419 | Q = 0.5175 |
|---|---|---|
| in-sample RMSE | 2.966 K | 2.943 K |
| \|bias\| | 0.201 K | 0.229 K |
| leave-one-ward-out RMSE | 2.976 K | 2.963 K |

A paired bootstrap (B = 20,000, seed pinned) of `RMSE(0.419) − RMSE(0.5175)` gives **+0.024 K, 95% CI
[−0.076, +0.125] K** — straddling zero, a gap of **0.10 SE**. Profiling `q_day` across candidate G's whole
admissible range while refitting every other constant, RMSE spans 2.943–2.984 K: **a 57% change in Q costs
0.04 K.** The interval the data cannot reject is **[0.14, 0.60]**, and its upper edge is *censored* — 0.60
is candidate G's fit bound, not a point the observations rule out.

**What it does and does not invalidate.** It does not invalidate the headline ward-mean accuracy: that is
the `Q·built` product, which is constrained. It does mean **`Q` must never be quoted as a measured
anthropogenic heat flux**, and it means the rendered field carries uncertainty the accuracy figures do not
express. Driving the real solver at both values over 24 ward-scenes, the map differs by **+0.57 K mean
(+0.75 K day), worst cell +2.47 K, spatial SD +12% on every ward-scene** — and the published amplitude
over-draw goes **1.170× → 1.333×** (measured by re-running `measure-shipped-amplitude.py`, not estimated).

**Why `Q` was left at 0.419.** Adopting the argmin would spend 60% of the amplitude win just recovered from
the stale-cache fix, worsen absolute bias, and slightly worsen skill (r 0.2974 → 0.2942), in exchange for
an RMSE gain the data cannot resolve. Its provenance is nonetheless weaker than it looks: 0.419 was fitted
against footprints we no longer ship, and it survives because the corrected data cannot refute it, not
because it was re-derived.

**How it is gated.** `fit-ward-scale.py` now emits `q_identifiability` into
`data/calibration/ward-scale-fit.json`, and `tests/unit/heat-map-validation.test.mjs` asserts the shipped
`Q` lies inside it. That replaced an equality-to-the-argmin assertion which was testing sampling noise.
The interval is computed, not chosen; it narrows as the ECOSTRESS record grows, and when it narrows past
0.419 the test fails and `Q` has to move.

**What would close it.** An independent constraint on `Q` that does not come from ward means — either
sub-ward spatial structure (the built term varies within a ward where the ward mean cannot see it), or an
external anthropogenic-heat estimate for Kolkata to use as a prior. More ECOSTRESS overpasses narrow the
interval but cannot break the `Q·built` degeneracy on their own.
## 7. The engine models open water as land — knowingly, because modelling it as water is worse

**Status:** open, measured, gated off · **Measured:** 2026-08-13 · Full record:
[`docs/heat-map-water-layer.md`](../heat-map-water-layer.md)

**What is wrong.** Ballygunge, Baruipur and Barrackpore contain 0.72 %, 1.30 % and 4.88 % open water, and
the temperature solve treats every square metre of it as warm ground. `SimLayers.water` is an all-zero
array. `sim-ts.ts` reads it in two terms — a ventilation boost and a relaxation toward `tAir − 1.5` — and
both collapse to the identity against zeros. `water-layer.ts` has drawn those same polygons, in blue, the
whole time.

**How we know, and why it is still open.** The layer was filled, ported to Python
(`scripts/_water.py`, oracle-checked against the shipped rasteriser), and scored on the real solver over
the same 34 near-nadir ECOSTRESS scenes / 87 ward-scenes / 3 wards the canopy sweep used. It made agreement
**worse**:

| | dry (shipped) | wet | Δ |
|---|---|---|---|
| r vs ECOSTRESS | **0.3031** | **0.2544** | −0.0487 |
| day / night | 0.3883 / 0.2400 | 0.3593 / 0.1768 | −0.029 / −0.063 |
| spatial SD (observed 0.925 K) | 1.345 K | 1.514 K | over-draw 1.45× → 1.64× |

and it did so **in proportion to each ward's water** — ballygunge 0.72 % → −0.013 r, baruipur 1.30 % →
−0.061, barrackpore 4.88 % → −0.071. That ordering is what makes it a finding about water rather than
noise; it would have been the argument *for* shipping had the sign gone the other way.

The cause is diagnosable rather than mysterious. At the shipped `D`, the relaxation is a **clamp**: a
fully-wet cell converges on `tAir − 1.5` whatever the energy balance says (measured: +0.8 to +1.9 K by day,
−1.1 to −2.0 K by night). And `tAir − 1.5` is a daytime assumption applied around the clock, which is why
night degrades twice as hard — water is the *warmest* surface ECOSTRESS sees over these wards after
sunset. `WATER_LAYER_ENABLED` (types.ts) is therefore `false`, pinned to `_water.LAYER_ENABLED` by the
water parity oracle so the instrument and the laboratory cannot disagree about which arm is live.

**What it does NOT invalidate.** Nothing published moves: the shipped figures are the dry arm, which is the
arm they have always been. What it *does* mean is that the within-ward pattern over open water is known to
be wrong, and should not be presented as a cooling estimate for a pond, a tank or a river edge.

**What would close it.** Make the relaxation a rate rather than a clamp (scale by `dt`), and give water a
diurnal target or an actual heat capacity instead of a fixed `tAir − 1.5`. Both are physics changes and
need their own spec. The measurement to judge them by now exists, which it did not before —
`measure-shipped-amplitude.py`, per ward, requiring the 0.72 / 1.30 / 4.88 % ordering to run the other way.

**A second, quieter limitation this exposed.** `measure-spatial-accuracy.py` — the source of the published
within-ward figures — **cannot see water at all**. Its predictor mirrors
`equilibriumC(p, albedo, veg, built)`, which has no water term; the water terms exist only in the
time-stepped solver, and the relaxation has no dt-free steady state. So that script is structurally blind
to this whole layer, and its output is annotated to say so. Any future cover layer that enters only the
time-stepped solve will be invisible to it in exactly the same way.

## 8. Rooftop-PV screening: the capacity figure rests on a Mumbai constant, and the shading claim is a Ballygunge claim

**Status:** OPEN · **Found:** 2026-08-21, while extending the shading gate to all three wards · **Scope:**
`scripts/measure-pv-shading.py`, `scripts/build-pv-yield.py`, `data/calibration/pv-*.json`.

**Shading is robust; capacity is not.** Per-building shading loss is a *ratio*, so the roof-packing
assumption cancels out of it. Every MWp and GWh does not: they scale linearly with `PACKING_FACTOR = 0.28`,
imported from Singh & Banerjee 2015 (*Solar Energy*) — a **Mumbai** sample, range 0.28–0.40, conservative
end adopted. No Kolkata measurement exists. The artefact therefore publishes an **interval**
(`totals_packing_range`), and the headline is its floor: Ballygunge 17.49–24.99 MWp, 22.24–31.78 GWh/yr.
The band is one-sided (+43 %) and bounds our *imported assumption*, not the truth.

**The pre-registered gate passes on all roofs and fails on the roofs the scheme addresses.** Restricted
post hoc to ≥ 3 kWp, Barrackpore (1.22 % / 6.8 %) and Baruipur (1.12 % / 7.1 %) do not clear the rule; only
Ballygunge does (3.32 % / 20.3 %). Correct physics — shading tracks built density (median heights 7.0 / 4.9
/ 4.5 m) — but it means "a quarter of roofs are materially shaded" is a **Ballygunge** statement, and on
installable roofs a fifth. The rule was not re-registered; the stratum is reported alongside it
(`installable_ge_3kwp`).

**Heights understate shading, in a known direction.** Building heights are unvalidated with a suspected low
bias (§ICESat-2 in `accuracy.ts`), so shadows are too short and shading is *understated* — a PASS is safe, a
FAIL means "not detected". ~13 % of buildings (465 / 597 / 629) sit on Google's 2.5 m no-confident-height
fill; 5–6 % of ≥ 3 kWp roofs. The p65→p75 caster swap was tested and is a null (+0.01–0.04 pp): the lever
is the raster, not the quantile.

**Screening, not bankable.** NASA POWER publishes no per-site uncertainty, so no honest P50/P90 pair can be
built from it; only one of three uncertainty terms (interannual, ~3 %) is in hand, and the dominant one
(site bias) is unquantified. The artefacts self-label `SCREENING ONLY`.

**What would close it.** In order of leverage: (1) a **Kolkata roof-packing measurement** from overhead
imagery — collapses the +43 % band; ground-level imagery cannot resolve it. (2) **Ground irradiance** to
bias-correct POWER for the whole metro — the NIWE SRRA Advanced Measurement Station at IIEST Shibpur sits
inside our POWER cell (see `data-sources.md`, Candidate). (3) **Height data**, not height statistics —
stereo VHR photogrammetry or lidar. Terrain is ~0 % (Kolkata's true relief is 3–5 m; ground moves < 1 m
over a 25–50 m shadow run).

> **ADDENDUM 2026-09-05 — trees are now in the shading pass, and the shipped loss is buildings + trees.**
> Pre-registered (`docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md`, Amendments A1–A4) and run
> as written: raster shadow-casting on a 0.5 m surface of footprints plus the Meta/WRI CHM v2, cross-checked
> against the registered polygon run on buildings alone, and refusing to publish anything if that check fails.
> Central cell = τ 0.30, stated canopy heights, A1 connectedness mask, receiver at the roof plane. Both
> predictions held in all three wards: trees exceed buildings on installable roofs, and the total never falls
> below buildings-only.
>
> | ward | cross-check mean / share (pp of 1.0 / 3.0) | all roofs: total mean · share ≥ 5 % | ≥ 3 kWp: total · share | trees vs buildings, ≥ 3 kWp | overhang kept | mask lever |
> |---|---|---|---|---|---|---|
> | Ballygunge | 0.29 / 1.56 | **21.95 %** · 67.7 % | 14.34 % · 58.2 % | 11.17 vs 3.16 | 99 % | 9.13 pp |
> | Barrackpore | 0.20 / 1.38 | **19.03 %** · 64.2 % | 14.96 % · 59.9 % | 13.86 vs 1.10 | 98 % | 10.26 pp |
> | Baruipur | 0.32 / 2.23 | **18.67 %** · 61.2 % | 11.54 % · 48.5 % | 10.59 vs 0.95 | 99 % | 9.14 pp |
>
> Generation falls by the tree term, capacity unchanged: 22.24 → 19.76, 18.70 → 15.90, 14.40 → 12.47 GWh/yr
> (17.49 / 14.40 / 11.13 MWp floor). Shading now costs 3.22 / 3.05 / 2.14 GWh/yr against 0.74 / 0.25 / 0.20
> before.
>
> **What the honest sentence now says.** The building term is still robust. The tree term is larger and
> less certain, and the published figure sits at the **high end** of its own sensitivity table (Ballygunge
> 12.8–24.4 %, Barrackpore 8.8–21.5 %, Baruipur 8.1–21.1 % across the eight registered cells). Four things
> set that width, in order: (1) **the mask rule is the largest lever in every ward** (A1 → strict mask:
> −9.1 / −10.3 / −9.1 pp). In continuous canopy the connectedness rule barely fires — 98–99 % of canopy over
> roofs is kept as overhang — and overhang is 53–58 % of the whole tree term; the strict row is the floor.
> (2) Crown opacity: τ across its 0.20–0.50 band moves the total 7.3–7.5 pp. (3) Canopy heights carry the
> model's 3.0 m MAE and only the minus-MAE cell is run (−5.7 / −7.3 / −8.0 pp), so the shipped figure is not
> the upper bound. (4) **The numbers are not grid-converged**: halving the grid from 1 m to 0.5 m raised
> Ballygunge's total by 2.0 pp and Barrackpore's by 2.5 pp (Baruipur has no 1 m total: it refused before
> publishing one), and the raster still reads low against the polygon sweep in all three wards (4.83 vs 5.12,
> 1.46 vs 1.66, 1.47 vs 1.79 % on buildings alone), so these are floors within the A1 rule. A crown standing
> directly over its own roof is also invisible to the march near zenith (27 % of the year's GHI weight at 2 m
> above the roof) — understated, same direction. No species, no seasonal leaf drop.
>
> **Baruipur refused at 1 m, certified at 0.5 m (A4).** On the ward with the smallest roofs (88 pixels each
> at 1 m against 177 in Ballygunge) the buildings-only raster undercounted the share of roofs above 5 % by
> 3.60 pp against a 3.0 pp tolerance while the mean passed. The tolerance was not loosened; the grid was
> refined for all three wards, everything else as registered, and the 1 m failure stays in history
> (commit `cf7e60d`) and in every artefact's `notes.grid`. At 0.5 m Baruipur consumes 74 % of the share
> budget — still the tight one.
>
> **The ≥ 3 kWp stratum, restated alongside the registered verdict, never as a re-registration.** On
> building-only shading the registered gate still fails in Barrackpore (1.10 % / 6.0 %) and Baruipur
> (0.95 % / 5.8 %) and passes in Ballygunge (3.16 % / 19.2 %) — the same finding as the PREREG addendum, to
> within 0.18 pp. On the total it passes comfortably in all three. The `stratum.n` in the shading artefact
> (1841 / 1771 / 1141) is computed from unrounded areas; the yield artefact's `installable_ge_3kwp.n`
> (1840 / 1771 / 1140) from 1-dp areas — one boundary roof, not the same population, do not quote both as one.
>
> **A lever the consultant can pull.** Raising the array 2 m on an elevated mounting structure recovers
> 5.2 / 6.0 / 6.6 pp of the total; it ships per building as `loss_raised` and is a what-if, not a claim.
>
> **The card prints the floor (closed 2026-09-06).** The console's Solar section, card block and
> ward-panel block (spec `docs/superpowers/specs/2026-09-05-solar-console-design.md`) read
> `loss_strict` and print "at least X % under a strict roof mask" wherever the headline appears,
> with the tariff shown as an assumption the reader can change. The eight-cell table still lives
> only in `data/calibration/pv-shading-trees-<ward>.json`.
>
> **Artefacts:** `data/calibration/pv-shading-trees-<ward>.json` (sensitivity table, levers, predictions,
> cross-check with the registered comparands, per-sun shaded fractions); the registered
> `pv-shading-<ward>.json` is untouched and no longer read by the yield chain.
>
> **A reader property found on the way.** `fetch-canopy.read_chm_grid` returns a 1 m floor over the whole
> box — the native v2 tile is 47.9 % exact zeros in Ballygunge (uint8, `nodata=None`, zeros under a
> per-dataset mask band; the boundless average read fills them at 1). It cannot touch this result: the
> fraction above the 2 m tree threshold agrees native vs reader (42.6 vs 42.8 %), and nothing below 2 m
> enters the mask or clears a 2.5 m roof. The artefact's fingerprint is therefore `canopy.px_over_min_m`, a
> count above the threshold, not a nonzero count. Whether the render layer's density mapping is affected
> by the same floor is a separate question for the vegetation layer, not answered here.


### The ladder on the card (2026-09-07)

Every solar figure on the building card and in the Solar pane now leads with its interval and wears a
tier chip (*screened* today). Under the block, a "How sure, and what would make it surer" disclosure
lists the five limits, each with the fix that narrows it. The bands are the artefacts' own; the
"narrows to" column is an engineering expectation, labelled as such until the rungs are measured.

| limit | today | the fix | narrows to (expectation) |
|---|---|---|---|
| roof obstacles unknown (tanks, stair rooms, parapets) | capacity at packing 0.28–0.40, up to +43 % on the floor | a ten-minute walk of the roof with a phone | about ±10 % |
| canopy over the roof: usable or not | shading headline vs strict floor, up to ten points (Barrackpore 10.3) | one photo from the roof | settled for that roof |
| irradiance from a coarse satellite cell | yield bracket 1,200–1,450 kWh/kWp | the ground station inside that cell | about ±5 %, city-wide |
| building height unverified | ward-scale only | a survey or a drone pass | per roof |
| never compared with real rooftops | no measured error | the pre-registered validation study | a measured spread, with its n |

Each line is a button that opens a pre-filled email to the technical-queries address with the ward, the
building index and the limit named; the survey and the measured rung do not exist yet and the button
does not pretend they do. A one-page **installer brief** prints from the card (the browser's own print,
no server): the roof's outline from its own footprint, the ranges, the shading split, the ladder, and six
questions a vendor's quote must answer. When the validation study publishes at n ≥ 25, the fifth line
prints the measured spread and the chip reads *checked*; the footer still says *not bankable*, because
a comparison with real roofs is not an engineer's stamp.

**The pre-registration** for that study is `docs/superpowers/specs/2026-09-07-pv-rooftop-validation-design.md`;
its predictions are committed before any measured kilowatt-hour enters the repository, and the result is
published whichever way it falls.
---

## 8. Bangalore's building heights have two sources that disagree, and no Indian ground truth

**Status:** open by design, published rather than hidden · **See:**
[data-sources.md](data-sources.md),
[../superpowers/specs/2026-09-10-bangalore-obos-wards-design.md](../superpowers/specs/2026-09-10-bangalore-obos-wards-design.md)

Bangalore is the first city where the project has **two independent per-building height estimates** —
Google Open Buildings 2.5D and UT-GLOBUS. That is an improvement on Kolkata (limitation 4 above), and it
produced a harder problem rather than an answer: **the two disagree, and nothing available says which is
right.**

Measured at building centroids, 385 and 373 buildings:

| site | UT-GLOBUS p50 | Google p50 | MAE | correlation | disagree > 5 m |
|---|---:|---:|---:|---:|---:|
| Indiranagar | 8.0 m | 5.3 m | 4.00 m | **+0.176** | 26.0 % |
| Whitefield | 7.0 m | 5.0 m | 3.60 m | **+0.815** | 18.5 % |

**The two correlations do not mean the same thing, and quoting them side by side without saying so would
be the misleading move.** Whitefield's +0.815 is genuine cross-validation: there is real height variance
and two independent methods track it. **Indiranagar's +0.176 is largely an artefact** — where almost
every building is 5–8 m there is little variance to correlate, and the coefficient is measuring noise.
**MAE is the honest statistic there, and 4.0 m on an 8 m building is a 50 % error.**

**Full-ward results, 2026-09-14** (`python3 scripts/fetch-bangalore.py --layer crosscheck`, every
Overture footprint whose centroid matches a UT-GLOBUS building to 5 m; the table above is the earlier
385/373-building sample and stands as that):

| ward | tile | matched | MAE | flagged > 5 m |
|---|---|---:|---:|---:|
| Indiranagar | Bangalore_2 | 2,274 of 14,867 | 2.83 m | 302 |
| Whitefield | Bangalore_2 | 2,532 of 10,897 | 2.80 m | 178 |
| MG Road | Bangalore_1 | 2,100 of 11,045 | 3.65 m | 339 |

These are measured against the **shipped** heights. The earlier strings (Indiranagar 3.12 m / 391, Whitefield
3.13 m / 295) were measured against the Google 2.5D baseline before OSM-measured heights replaced 1,941 and
1,430 buildings (`1fec16e`). They reproduce to the digit on those older heights, so they were stale, not wrong.
The two sets are not like-for-like (the fill set changed too), so read the drop as consistent with the OSM
heights, not as a measured improvement.

This generalises past Bangalore: **correlation is the wrong summary for a low-variance population**, and
a homogeneous neighbourhood will make any two height sources look uncorrelated no matter how good they
both are.

**UT-GLOBUS reads systematically 2–3 m higher at both sites.** Neither source has published Indian
validation. Google's own documentation says the 1.5 m MAE *"was only evaluated in North America, Europe
and Japan… heights prediction might not be as good in the Global South"*; UT-GLOBUS validates against US
LiDAR only, at RMSE 9.1 m per building.

**What we do about it.** Nothing that manufactures a number. Google 2.5D stays primary, UT-GLOBUS is
attached as a second field, and where they differ by more than 5 m the building carries a **flag** (a widened on-screen uncertainty band is
designed but not yet built) — it is not corrected and not averaged. Blending would invent a value neither
source states, and would hide the disagreement precisely where it is most informative.

**What would close it.** Ground truth: a LiDAR or photogrammetric survey of a few hundred Bengaluru
buildings. That is a procurement, not a download, and the sub-metre licence wall in
[regulatory-and-licensing.md](regulatory-and-licensing.md) is why.

---

## 9. Bangalore's tree census is an inventory, not a density field

**Status:** by design, disclosed · **See:** [data-sources.md](data-sources.md)

The BBMP tree census is **702,109 individual trees with species** — nothing comparable exists for
Kolkata, and it is genuinely better data than we have anywhere else. It also cannot be used the obvious
way.

**Counts track enumeration effort, not tree density.** Only **144 of 198 wards** appear at all; per-ward
counts run from 1 to 45,831; 13 wards hold fewer than 100 trees; and **24.3 % of trees are recorded as
species "Others"**. A ward with few trees in this dataset is a ward that was surveyed less, and a map
shaded by census count would be a map of survey effort presented as a map of canopy.

**It also carries no girth, height or crown diameter**, so crown radius has to be modelled from species —
derived, not measured, and the artefact must say so.

**So the two datasets do different jobs and are not substitutes:** canopy *fraction* comes from Meta CHM
v1, which is a measurement; the census supplies *species and position*, which is an inventory. This is
the same distinction as limitation 5 above — measured height versus modelled count — arriving from the
opposite direction.

**One consequence worth stating separately:** the census numbers its wards on the **dead 198-ward
scheme**, two reorganisations behind the current 369-ward GBA-2025 geometry. Trees are therefore consumed
**by position and never by ward join**, which sidesteps the problem rather than solving it.

---

## 10. A height percentile means two different things, and the gap is 4x on tall buildings

**Status:** measured 2026-09-10, disclosed · **See:** [data-sources.md](data-sources.md)

Building the Bangalore wards produced two sets of height statistics from **the same
raster on the same day**, differing by far more than rounding:

| | over built PIXELS | over FOOTPRINTS (zonal p65) |
|---|---:|---:|
| Indiranagar, share ≥ 15 m | 3.3 % | **0.8 %** |
| MG Road, share ≥ 15 m | 15.5 % | **3.7 %** |
| Whitefield, share ≥ 15 m | 19.7 % | **5.1 %** |

**Neither is wrong. They answer different questions, and the tall-building share is
where that stops being pedantry** — MG Road's differs by a factor of four.

A **pixel** census asks "how tall is the built surface here?", and every pixel of a
tower is a tall pixel. A **footprint** statistic asks "how tall is this building?",
and a zonal percentile over the footprint mixes the tower's core with its podium,
courtyards, annexes, roof plant and edge pixels. It averages down, and it averages
down hardest on exactly the large, complex buildings whose height people care most
about.

**This is a known property, not a discovery.** Kolkata's `compute-heights.py` names
it in its own docstring and offers p75 as the candidate correction. What is new is
the *size* of the effect on a derived share rather than on a median: the medians
here differ by 0.6–2.6 m, which looks tolerable, while the ≥15 m share differs by
4x from the same data.

**The operational rule.** Any published tall-building share must name which
statistic it came from. A massing render is built from the footprint statistic,
because you extrude a building by its own height, so **renders will show a lower
skyline than a pixel census implies** and that is correct behaviour, not a bug.

**What would close it.** The same thing that would close limitation 8: Indian
ground truth. Failing that, running p65 and p75 side by side and choosing against
OSM `building:levels` evidence, which is what Kolkata's `validate-heights.py` does
and what Bangalore has not yet done — it ships p65 for parity with Kolkata.

---

## 11. Three statistical fixes for Bengaluru's heights, all measured, all rejected

**Status:** measured 2026-09-11, all three refused · **See:** `scripts/measure-bangalore-prior.py`

Bengaluru's shipped heights are Google Open Buildings 2.5D at zonal p65, and that
estimator has a known, measured weakness: it collapses on tall buildings. Against
1,926 buildings carrying independent OSM evidence, its bias runs from **−0.68 m
below 10 m to −27.09 m above 60 m** — at the top end it reads barely a third of
the building.

Three statistical repairs were tried against held-out data. **None ships.**

| approach | result vs raw Google | why refused |
|---|---:|---|
| Neighbourhood spatial prior, 400 m cells | **−36 to −39 %** | loses outright |
| Global linear fit, `0.846·g + 3.42` | **+7 %** MAE | shrinks the skyline |
| Band-limited linear, 8–45 m only | **+1.5 %** MAE | 19.7 % made worse |

**The spatial prior lost, and that is a finding about the cities, not the method.**
On Dubai the same prior halved the error over 152,942 buildings — because 87 % of
Dubai had no measured height at all, so anything beat nothing. Bengaluru already
has a real estimator on every building, and a neighbourhood median cannot beat it:
MAE 3.74 m for Google against 5.11 m for the prior on held-out storey-derived
truth, and 16.58 m against 22.96 m on stated heights. **A method that transformed
one city can be worthless in the next; re-test, never port.**

**The linear fit is a regression-to-the-mean trap, and it is the instructive one.**
It improves aggregate MAE by 7 % and would have been easy to ship on that number
alone. Broken out by true height it improves the 10–60 m middle by 10–27 % and
makes **both tails worse** — and the slope below 1 means it pulls tall buildings
*down*. Five of the six tallest test buildings moved FURTHER from the truth,
including one whose true height is 93.2 m being pushed from 50.8 m to 46.4 m.

**An aggregate metric can improve while the thing you care about gets worse.** The
skyline is what a viewer checks first and what the founder's demo rests on, so a
correction that trades the towers for the mid-rise is a loss dressed as a gain.

### What this leaves, and it is not nothing

**Statistics on Google's own value cannot rescue the towers — only evidence can.**
That is exactly what the measured tier does, and it is already shipped: a cited
published height moved UB Tower from 18.2 m to 123 m, which no correction fitted
to Google's reading could ever have achieved from an input of 10 m.

So the route to better Bengaluru heights is **more evidence, not better maths**:
the OSM buildings Overture is missing entirely (Vidhana Soudha among them), and
the Karnataka RERA elevation figures for Whitefield's under-construction towers.

---

## 12. The fallback air temperature is a climatology, not a forecast

**Status:** accepted · **See:** [data-sources.md](data-sources.md) (IMD 1991–2020)

When there is no live met.no reading — including the first seconds of every page load — the instrument
models air temperature from the city's IMD 1991–2020 monthly normals: that month's mean daily minimum at
06:00 and maximum at 14:00, joined by half-cosines. Three things this is not:

- **Not today's weather.** A heatwave day or a cool monsoon afternoon sits far from its monthly mean; the
  live reading replaces this the moment it arrives.
- **Not the recent climate.** The normals end in 2020, and the last decade has run warmer (GHCN-Daily,
  Bengaluru: April 2016–2025 averaged 34.9 °C against a normal of 34.1 °C).
- **Not an observed diurnal cycle.** The tables give only daily extremes; the 06:00 / 14:00 placement and
  the curve between them are the standard assumption.

It replaced a single 32 °C for both Indian cities, which ran up to 16 °C too hot at Bengaluru nights.

---

## 13. The pocket-park size is a design default, not a measurement

**Status:** accepted · **See:** [park-size-tvoe-preregistration.md](park-size-tvoe-preregistration.md)

The pocket-parks slider paints discs of 50 m radius (~0.8 ha) in every city. (That control is not exposed
in the console today — see §14 — so this describes the model, not a lever a user can currently move.) That number was justified as
Kolkata's "efficient park size" (TVoE 0.77 ha, Li et al. 2022). It is not one: TVoE is a regression slope
whose value does not change with the area unit, the paper is internally inconsistent, and the Kolkata
sample was hand-picked in Google Earth and cannot be reproduced from open data. The radius stands as a
reasonable pocket-park size; the cooling it produces comes from the solver running on the painted
vegetation, not from the radius itself.

The same borrowed number sets the DC-URS thermal-refuge floor (`MIN_REFUGE_HA = 0.77`,
`MIN_PATCH_M2 = 7,700` in `scripts/compute-tra.py` and `cooling-surfaces.ts`) — it too is a design
threshold, kept because it keeps the index discriminating, not because it is a measured minimum cooling
area.

---

## 14. Bengaluru's resilience score: what is measured, what is borrowed, what is missing

**Status:** accepted · **See:** [design spec](../superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md), [data-sources.md](data-sources.md) (Bangalore — Bengaluru DC-URS inputs)

*Figures are as of `3052c7c`: ECOSTRESS searched to 2026-09-01, Kolkata inputs as served then, and the
slider rule as it stands at that commit. Re-running `--layer dcurs-lst` changes them, and nothing checks
this section.*

Indiranagar, MG Road and Whitefield are scored by the same DC-URS v1 engine as Kolkata, against Kolkata's
normalisation anchors, from their own inputs file `data/bangalore/dc-urs-inputs.json` (served byte-identical
as `public/heat-map/data/bengaluru-dc-urs-inputs.json`). This section records what that file measures, what
it borrows, and what it lacks.

**Quoting the score.** Quote a Bengaluru score only as a best case ("up to 8.8 pts lower") and never beside
Kolkata's; the gap is confounded (see "The scores are not yet comparable"). Within Bengaluru, the ranking is
inside the unmeasured `socioVuln` range.

**Heat vulnerability is unmeasured (up to 8.75 points).** `socioVuln` sits at 0, its optimistic endpoint, so
every Bengaluru score is shown at its **best case**, and the confidence chip says so: "Best case · up to 8.8
pts lower". No source checked is commercially clear at ward level:

- **District and parliamentary-constituency data:** identical for all three wards (Bengaluru Urban;
  Bangalore Central), so they cannot discriminate.
- **WorldPop R2025A age/sex (CC BY 4.0):** spreads India's age structure from state-level inputs, so every
  Karnataka pixel reads 65+ = 8.024 % and under-5 = 6.673 % (measured 2026-09-14).
- **Census 2011 BBMP ward tables:** would discriminate, but the catalogue is marked "All Rights Reserved"
  and the houselisting copies carry uploader-set labels.

The open route is a written request to ORGI (Office of the Registrar General of India) for commercial use.
`canopyFrac` is a placeholder, as in Kolkata; its weight is 0, so it is inert in the v1 formula.

**Population density is modelled, and the obvious grid was wrong.** `popDensity` is WorldPop R2025A
constrained 2025 at 100 m, summed over exactly the 2.8 km × 2.8 km box (7.84 km²) with fractional
edge-pixel weights: 79,524 / 74,927 / 68,138 people, or 10,143 / 9,557 / 8,691 per km², labelled
`modelled`. Before it was chosen, each candidate grid was tested against the Census 2011 counts of all 198
BBMP wards (PCA workbook total 8,443,675, joined to DataMeet `BBMP_oldWards.geojson`, 198/198 matched;
each grid summed over each ward polygon by fractional coverage):

| Grid | Pearson r of log(pop) | Mean abs log error | Total |
|---|---:|---:|---:|
| GHS-POP E2010 | −0.03 | 1.12 | 8.54 M |
| GHS-POP E2020 | −0.01 | 1.20 | 11.9 M |
| WorldPop 2011 unconstrained | −0.07 | 1.16 | 7.25 M |
| **WorldPop R2025A constrained (2015 layer)** | **0.595** | **0.64** | 5.61 M |
| Uniform density (baseline) | 0.56 | 0.88 | – |

**Only constrained WorldPop beats a uniform density.** **GHS-POP misplaces the south-east:** 64 contiguous
south and east wards (BTM, Jayanagar, CV Raman Nagar, KR Puram, Mahadevapura) hold 3.01 M people in the
census, and GHS E2010 gives them 0.29 M. The error is already there in E2010, so it is not growth. A
sub-district disaggregation artefact is a likely cause; that has **not** been tested.

At box scale, in people/km² (census figure = ward population × box overlap share ÷ ward area):

| Box | Census 2011 | GHS E2020 | WorldPop constrained 2015 |
|---|---:|---:|---:|
| Indiranagar | 16,671 | 16,026 | 9,399 |
| MG Road | 11,151 | 43,584 | 8,889 |
| Whitefield | 4,010 | 565 | 8,083 |

**WorldPop's own bias is flatness.** It reads about 0.34× the census in wards within 7 km of the centre and
about 1.7× in Mahadevapura, with a low total. Bengaluru's central wards are therefore **understated**, and
Whitefield is overstated relative to the census.

**Kolkata's density method over-counts: recorded, not fixed.** `scripts/fetch-worldpop.py` sums every
pixel in the projected (Mollweide) envelope of the lat/lon box but divides by the nominal box area.
Recomputed on GHS-POP, Indiranagar read 20,028 against 16,026 exactly in the box, and MG Road 48,368
against 43,584. Kolkata's live `popDensity` is probably inflated the same way. Correcting it would move
Kolkata's scores, so it needs founder sign-off. Bengaluru's exporter uses the exact box sum instead.

**The anchors are Kolkata's, and these Bengaluru terms clamp against them.** The exporter's CLAMP report,
verbatim:

- `indiranagar: heat island at or below 0: the UHI term reads 0`
- `mg-road: heat island at or below 0: the UHI term reads 0`
- `whitefield: heat island at or below 0: the UHI term reads 0`

**No other term clamps.** Day and night LST sit above their floors of 25 / 20 °C, population is below
25,000, FAR is below 5 and albedo is below 0.6.

**Bengaluru is cooler than its countryside by day, and that is measured, not a bug.** LST in °C; the heat
island is the median of per-scene (ward − rural) differences:

| Ward | Day LST | Night LST | Day heat island | Night heat island | `ruralBaseC` |
|---|---:|---:|---:|---:|---:|
| indiranagar | 29.5 | 20.71 | −1.38 | 1.44 | 30.88 |
| mg-road | 29.49 | 21.47 | −1.12 | 1.59 | 30.61 |
| whitefield | 29.58 | 20.3 | −0.84 | 1.06 | 30.42 |

A daytime surface cool island over Bengaluru is in the literature, and both sources were read:

- **Sussman, H. S. (2022).** *The urban heat island of Bengaluru, India: characteristics, trends, and
  mechanisms.* PhD dissertation, University at Albany, SUNY. doi:10.54014/BEQ7-GX6J. Mean surface UHI
  intensity from MODIS LST 2003–2018: Dec–Feb (dry) night 1.43 °C; Aug–Oct (wet) day 1.14 °C; Aug–Oct night
  1.02 °C; **Dec–Feb day −0.60 °C**. Our night values (1.06–1.59 °C) are of similar magnitude to her
  1.02–1.43 °C, which come from 1 km MODIS. Her daytime sign depends on season; our day median pools every
  season in the record.
- **Shastri, H., Barik, B., Ghosh, S., Venkataraman, C., & Sadavarte, P. (2017).** Flip flop of day-night and
  summer-winter surface urban heat island intensity in India. *Scientific Reports* 7, 40178.
  doi:10.1038/srep40178. MODIS-Aqua 2003–2013 over 84 Indian urban locations: **negative daytime SUHII in
  the pre-monsoon (Mar–May) season over a majority of the urban areas studied**, associated with sparse
  vegetation and low evapotranspiration on non-urban land. It gives no Bengaluru-specific value, so it is
  cited for the **mechanism only**.

Our rural reference is the GHS-SMOD rural class (11–13) within 77.22–78.02 E, 12.57–13.37 N. Those pixels
cover 55 % of the bbox. In ESA WorldCover 2021 (tile N12E075, which ends at 78.0 E, so the last 0.02° is
not sampled) they read cropland 47 %, shrub 20 %, tree 15 %, grassland 13 %, built-up 3 %, bare 1 % and
water 0.5 % (sampled at ~90 m, 2026-09-16). Per scene, the rural mask is further cut by cloud and excludes
the ward boxes. **Whether that surface is dry enough for the mechanism Shastri et al. describe has not been
tested.** Their result is also for the pre-monsoon (March–May) season, while our median pools every season.

The night heat-island refusal (above 2.5 °C refuses the export) did not fire.

**The dead heat-island term, and a knock-on effect on the structural floor.**

- **The term is dead in all three wards.** The day heat island is negative everywhere (−1.38 / −1.12 /
  −0.84 °C), so the engine's UHI term `max(0, lstDayC − ruralBaseC) / uhiSpan` reads 0. Its 5 points of
  weight carry no information for Bengaluru and are identical across the wards.
- **Knock-on:** `structuralFloor` models a "perfect retrofit" by setting `lstDayC = ruralBaseC`. Where the
  rural baseline is **warmer** than the ward, that "retrofit" warms the ward. This is true for all three
  Bengaluru wards, and also for Kolkata, where `ruralBaseC` 30.96 °C exceeds the wards' 30.72 °C.
- **Size of the error:** the displayed "withheld by exposure" figure is overstated by roughly 0.4–0.7
  points. MG Road's ceiling computes to 87.77 instead of 88.33. Computed with the engine, the overstatement
  is 0.69 / 0.56 / 0.42 points for Indiranagar / MG Road / Whitefield, and 0.12 in each Kolkata ward.
- **Status:** this predates Bengaluru and is recorded, not fixed.

**The thermal inputs come from scenes clear in all three wards at once.** NASA ECOSTRESS L2T LSTE v002 via
CMR / LP DAAC, searched from 2018-07-01 to 2026-09-01, with scenes from the last 14 days excluded as
unsettled: 690 acquisitions (333 day, 357 night) over MGRS tiles 43PGP/PGQ/PHP/PHQ, of which 480 were
recorded and 210 had no usable granule. **46 day and 49 night scenes are clear (≥ 10 %) in all three wards
at once, near-nadir (view-zenith difference ≤ 0.75°), with a rural reference present.** The pre-registered
gate was ≥ 8 per phase, and both phases pass. Shared scenes mean the three wards are compared under the same
overpass.

- **Median of differences, not difference of medians.** `ruralBaseC` is an **effective** baseline
  (`lstDayC` − median day heat island), so the unchanged engine reproduces the median heat island. It is not
  a rural LST anyone could observe.
- **"Night" mixes dusk and predawn acquisitions,** because the ISS orbit precesses. Of the 49 shared night
  scenes, 23 are dusk (17–23 h local) and 26 are predawn (0–6 h). Kolkata selects night scenes with the
  same CMR `day_night_flag="night"` (`_ecostress.cmr_search`), so its night set can mix the two as well,
  but its split was not counted.
- **Ward masks include a border ring of up to 70 m.** A box mask on the 70 m ECOSTRESS grid takes
  1,764 / 1,722 / 1,722 px, with centre offsets of 4 / 14 / 16 m.

**Vegetation cover and albedo use the map's reduction, not Kolkata's.** Bengaluru's `fvc` and `albedo` are
copied verbatim from `public/heat-map/data/surface-meta.json` `fvc_mean` / `albedo_mean`: indiranagar
0.4014 / 0.1671, mg-road 0.3884 / 0.1652, whitefield 0.3698 / 0.1775. These are the per-cell Sentinel-2
composite means already served for the map texture: the per-cell median over 2021–2025, then the spatial
mean. Kolkata's `sentinel.json` reduces per scene, then per year. They are copied because `loadAreaSurface`
reads the DC-URS record **first**, so a recomputed value would put the map texture and the score on
different measurements. A unit test pins the equality. A cross-city difference in `fvc` or `albedo`
therefore carries a method difference as well as a surface difference.

**The scores are not yet comparable across cities.** Scores as rendered by the engine; Bengaluru's at best
case (`socioVuln` = 0) and with `socioVuln` at its maximum (10):

| Ward | Score | Score, `socioVuln` = 10 | THI (hazard) | EVI (exposure) | ACI (adaptive capacity) |
|---|---:|---:|---:|---:|---:|
| Indiranagar | 69.9 | 61.2 | 0.109 | 0.221 | 0.509 |
| MG Road | 68.4 (renders "68") | 59.7 | 0.129 | 0.231 | 0.493 |
| Whitefield | 70.3 | 61.5 | 0.100 | 0.201 | 0.495 |
| Ballygunge (Kolkata) | 49.6 | – | 0.258 | 0.626 | 0.449 |
| Baruipur (Kolkata) | 53.9 | – | 0.258 | 0.586 | 0.523 |
| Barrackpore (Kolkata) | 61.9 | – | 0.258 | 0.271 | 0.445 |

All three Bengaluru wards read "Moderate Resilience". **The cross-city gap is confounded:**

- **`socioVuln` at its best case favours all three Bengaluru wards** (up to 8.75 pts).
- **WorldPop's flatness cuts both ways.** It favours Indiranagar (10,143 (2025 layer) against a census 16,671, about
  +4.1 pts) and MG Road (about +1.0 pt), but penalises Whitefield (8,691 (2025 layer) against a census
  4,010, about −2.9 pts). The box table above is the 2015 layer.
- **Kolkata's envelope over-count can move only Barrackpore** (8,772/km²). Ballygunge (68,810) and
  Baruipur (36,728) sit above the 25,000/km² exposure anchor whether or not the density is corrected.
- **The hazard difference is measured, but from different scene sets.** Kolkata's are bbox-wide 2024–2026
  scenes; Bengaluru's are per-ward shared scenes from 2018–2026. It comes mostly from night LST (20.3–21.5
  °C against Kolkata's 25.4 °C, about 84 % of Indiranagar's THI gap) and partly from day LST (29.5–29.6 °C
  against 30.72 °C). The heat-island term is 0 in both cities.

**"Bengaluru is more resilient than Kolkata" is not a supported claim yet.** Scenario sliders do not
compare either, though not for the reason this section gave until 2026-09-16. A slider is a **share of the
ward**: the same position greens the same fraction of the ward's own corridor cells and roof area, so a
2.8 km Bengaluru ward's trees, cool roofs and facades move its index exactly as far per unit slider as a
1.4 km Kolkata ward's — but they buy about 3.9x as much work and cost (MG Road's 198.9 km of street
corridor against Ballygunge's 51.3 km), which is the real obstacle to comparing two plans. Only **parks**
dilute with ward area: they are at most ten patches of a fixed metre radius, so the parks contribution to
`fvc`, `canopyFrac` and `distCoolM` scales by `(1400 / sizeM)²`, a quarter over a 2.8 km ward. Until
2026-09-16 every slider's index gain carried that quarter, which left the index moving a quarter as far as
the heat layers and the bill beside it (the same plan moved the layers' ward-mean vegetation by +0.118 and
`fvc` by only +0.015); the trees, roof and facade gains are no longer scaled.

**Three qualifications on the parks exception, none of them small.** First, **it is dormant**: no
pocket-parks control is rendered (the console draws `ivTrees`, `ivRoof` and `ivFacades` only, and Compare's
reader pins a legacy `?parks=` to 0), so `iv.parks` is always 0 and the shipped effect of the 2026-09-16
change is simply that **no** slider's index gain scales by area. The exception applies if that control
returns. Second, **`canopyFrac` is collected but inert**: all six served rows are 0 and `placeholder`, and
a unit test pins that the v1 score cannot read it — so of the three inputs parks moves, only `fvc` scales
cleanly. Third, **`distCoolM` saturates**: it is floored at 0 and every served ward sits at 27.3–93.3 m, so
the 1.4 km ward exhausts its refuge distance while the 2.8 km ward is still cutting, and the ratio climbs
from a quarter back toward 1 — measured at MG Road's 49.5 m, 0.250 at `parks = 2`, 0.556 at 5 and 1.000 at
10; at Ballygunge's 77.8 m, 0.250, 0.354 and 0.707. "The parks contribution scales by a quarter" is
therefore true of the vegetation gains at any setting, and of the refuge distance only above the floor. The LST change was never
rescaled: it comes from the heat model's layers, where trees and cool roofs cover a share of the ward's
corridors and roofs (parks are fixed-size patches, so their LST effect does dilute with ward area). Since
2026-09-16 the scenario keeps the measured LST and adds only that modelled change.
Before, the simulated ward mean replaced the measured LST, and 25 trees lowered MG Road's score by 6.6
points. In live "Now" mode the plan's LST change is sized by the current hour's sun, so the same plan reads
about **+0.5 pts at dusk and +0.9 at solar noon** on MG Road, while the measured LST it is added to is a
fixed overpass value. The 13:00 Peak and 22:00 Retained phases are the stable comparisons. (Those two
figures were +0.18 and +0.58 before `3052c7c`. The thermal half did not move — `scenarioLst` never carried
the area scaling — but the index half went +0.12 to +0.48, which is where the restated ≈+0.54 and ≈+0.94
come from. The noon figure is corroborated: `heat-map-bengaluru-resilience.spec.ts` measures "0.9 pts from
this plan" at 13:00 Peak. The dusk figure is carried arithmetically from the recorded split, not
re-measured, because "Now" mode follows the wall clock.)

**Known staleness paths.** `far` in `data/bangalore/dcurs-static.json` comes from
`data/bangalore/*-buildings.json` (footprints × heights ÷ storey 3.33 m). If the buildings are re-fetched
without re-running `fetch-bangalore.py --layer dcurs-static`, `far` goes stale, and **nothing compares the
two**. The gates cover only what comes after that step: `export-bangalore-obos.py --check` re-derives the
inputs file from `dcurs-static.json`, `dcurs-lst-scenes.json` and `surface-meta.json` and fails if it is
stale (in CI via `npm run check:bangalore`); `verify-served-data.mjs` fails a stale served copy; and
`tests/e2e/heat-map-bengaluru-resilience.spec.ts` pins MG Road's rendered score to the engine's value.
`data/bangalore/dcurs-lst-scenes.json` rows carry no orbit id, so the 14-day settle window is the **only**
guard against a very late granule being counted as a second scene. The data is clean today: no two rows are
within 10 minutes of each other.

---

## 16. Ballygunge is KMC Ward 68: a 2018 boundary, a square of context, and figures taken inside the polygon

**Status:** shipped on `feat/ballygunge-ward68` (data 2026-10-02, app 2026-10-03), not yet merged · **See:**
`scripts/_wardmask.py`, `scripts/build-ward-mask.py`, `src/scripts/climate-engine/ward-mask.ts`,
`public/heat-map/data/ballygunge-ward.json`, `docs/evidence/data-sources.md` (DataMeet entry).

**What changed.** Until 2026-10-02 "Ballygunge, Ward 68" was a 1,400 m box at 22.528 N, 88.3659 E. It held only
28.9 % Ward 68, was centred in Ward 69, and every Ballygunge figure was the box's. Ballygunge is now the real KMC
Ward 68: the compute domain is a 1,800 m square centred on the ward (22.522704 N, 88.369173 E), and every figure the
site reports **as the ward's** is taken inside the polygon. Field statistics (mean surface temperature, area above
40 °C, the heat-stress histogram, Compare's means) use the solver cells whose **centre** lies inside it (17,442 of
61,009). Per-building statistics (building counts, rooftop-PV totals, the stratum, the best-roofs list, the CSV's
`in_ward` column, CityJSON's `in_ward`) use the footprints that **touch** it (2,207 of 7,931). The DC-URS inputs are
polygon-masked in the data. Buildings in the square but outside the ward are drawn as context: dimmed, under a
desaturated veil, and counted in nothing.

**What it does not fix, and what to watch.**

- **The boundary is 2018's.** DataMeet's file is the KMC 141-ward scheme (commit `cd52891`, 2018-10-14). KMC now
  has 144 wards (kmcgov.in, read 2026-09-23), so numbering and edges may have shifted. Its alignment with today's
  streets was checked numerically, not assumed: the boundary cuts 21 footprints at zero offset against a mean of 96
  over a ±40 m shift grid, best offset (−5 m E, +5 m N); a north–south mirror would cut 138.
- **Neighbours are shown, not measured as wards.** Wards 65, 66, 67, 69, 85, 86, 90, 91 and 92 cover 71.4 % of the
  square (shares in `kmc-wards-around-ballygunge.geojson`). Their buildings shade the ward's roofs and the ward's
  air, which is why they are in the solve, but no figure is reported for them.
- **Two rules for "in the ward".** A cell is in by its centre; a building is in if any of it is. The two agree to
  within the boundary's width but not exactly, and both are stated wherever a figure is printed.
- **Three areas for one ward.** 0.9263 km² in the ward-local frame (what the scope line prints), 0.9284 km² WGS84
  geodesic, 0.933 km² in Mollweide (the population density's denominator). The spread is about 0.7 %.
- **The air monitor is outside the ward.** The WBPCB "Ballygunge" station stands in Ward 69, 1,657 m from the new
  centre and 53 m beyond the 3 km window. It is kept as the nearest official monitor and labelled so
  (`inside: 'outside_window'`, register AQI-R20); the window was not widened.
- **The DC-URS inputs moved a lot.** `distCoolM` 78 → 363 m, `fvc` 0.33 → 0.22, `popDensity` 68.8k → 53.3k per km²:
  the old box was mostly greener neighbouring wards. The score is withdrawn ("Coming soon"), but the v3 engine will
  read these. Its scenario sizing (`applyScenario`, `REFERENCE_WARD_M`) still scales park gains by the 1,800 m
  square, not by the 0.93 km² polygon the inputs are measured over; that needs deciding before the score returns.
- **Compare now pairs grids of different sizes.** Ballygunge solves 247 cells over 1,800 m, its siblings 192 over
  1,400 m. Compare's shared contract was relaxed from "the same grid version" to "the same physical cell within
  0.1 %" (7.2874 m against 7.2917 m, 0.06 %); without it every Ballygunge pair was refused.
- **`?look=classic` draws the outline but not the veil or the dimming**: the classic shaders are frozen byte for
  byte as the rollback, so the context is not held back there.
- **The landing page's console screenshots** (`public/images/obos/console-*.webp`) predate Ward 68 and show the old
  box; the caption beside them now states Ward 68's figures.

**Calibration re-measured for KMC Ward 68 (2026-10-03).** The ward-scale observations and accuracy figures were
re-measured with Ballygunge's ward means taken over the polygon: 189 of 676 ECOSTRESS 70 m pixels and about 1,050
Landsat 30 m pixels in the 1,800 m square, with surface and built fraction over the polygon's cells (FVC 0.220
against the old box's 0.329). Methods, physics constants and the evidence window are unchanged. Barrackpore's and
Baruipur's rows are byte-identical, and with the old ward table the pipeline reproduces every committed ECOSTRESS
row. Ward 68 reads warmer than the old box: +0.54 K by day, +0.17 K at night, +0.82 K on Landsat; the old box had
been mostly the greener Wards 69 and 65. Night accuracy barely moved (RMSE 2.677 → 2.662 K, leave-one-overpass-out
2.801 → 2.777 K, bias +0.36 → +0.41 K; the band stays ±3.0 K). The daytime peak now measures RMSE 2.233 K and
2.358 K out of sample over n = 23; the published ±4.5 K / n = 29 band is an older evidence set scored on the old
box, is labelled so in `accuracy.ts`, and is kept (wider than measured, the safe direction) until a reviewed
recalibration — adopting the new figures would trip two pre-registered guards. Within-ward skill fell: the shipped
field's r 0.297 → 0.261 over 85 ward-scenes (was 87) against a vegetation null of 0.308, amplitude 1.17 → 1.11×.
That is the ward's own ground, not the pipeline: Ward 68 is uniformly dense, and the part of it inside the old box
already scored built-fraction r +0.05 against +0.14 for the rest of that box; misregistration and the Overture
release were tested and ruled out. Ward 68 is too small for 470 m blocks, so the coarsest scale-sweep row holds the
other two wards only, and the published neighbourhood gap is the ~340 m one (−0.039). **ICESat-2 heights were not
re-measured**: the committed photon subsets end about 420 m short of Ward 68's southern edge, the check refuses to
re-score them against the new footprints, and a fresh multi-GB ATL03 download did not fit on the machine; the
`HEIGHTS` figures are labelled as the old 1,400 m box. Offline, 542 of Ward 68's 2,207 buildings (24.6 %) survive
the 5 m erosion (old box: 995 of 3,527). A re-fit on the new rows would move `STORE_NIGHT` 0.1043 → 0.093 and
`q_day` 0.419 → 0.433; neither was adopted. Still old-box records, not published as Ward 68: the SVF and shadow sign
tests, `canopy-blend-residual`, `mask-fvc`, `term-fit`.

**What would close it.** KMC's current 144-ward boundaries, published as open data; a decision on how the v3
resilience score sizes interventions over a polygon; a reviewed recalibration of the daytime band; a fresh ICESat-2
ATL03 pull over Ward 68's southern extension; a fresh console capture.

---

## 15. Night forcing was read 24 hours early for 20 passes (corrected 2026-09-24)

**Status:** fixed · **See:** `scripts/_power.py`, `scripts/fetch-met.py`, the audit spec
(`docs/superpowers/specs/2026-09-23-audit-fixes-1-5-design.md`).

`fetch-met.py` built each NASA POWER lookup key from the pass's UTC **date** plus its local solar **hour**.
POWER is stamped in local solar time, so every night pass after local midnight but before UTC midnight
read air temperature, humidity, wind and cloud from 24 hours earlier: 20 of the 97 forcing rows, all at
night. The worst case, 12 April 2026, used 22.09 °C where the right reading was 24.68 °C.

The key now comes from the pass's own UTC instant (`_power.power_stamp`), `met-forcing.csv` records each
row's `utc` and `power_stamp`, and `fetch-met.py --check` audits every row offline in CI. The accuracy
measurement was re-run on the corrected forcing, scoring the constants that ship; the model itself was
not re-fitted. Night bias moved from −0.182 K to +0.36 K (model minus measured surface), night RMSE from
2.943 K to 2.677 K, and the leave-one-overpass-out error from 3.102 K to 2.801 K, so the published night
band narrows from ±3.5 K to ±3.0 K. Daytime figures did not move.

**A second defect surfaced during the rebuild.** `measure-accuracy.py` had been scoring the calibration
candidate's free-fit `q_day` (0.5175) rather than the `Q` that ships (0.419), so any re-run since the
2026-08-13 refit described a model that is not on the site; the published figures were unaffected only
because they predated that drift. It now reads `Q` from `types.ts`, records the constants it scored, and a
unit test holds all six to what ships.

**What is still open.** `ward-scale-fit.json` holds candidates fitted on the pre-correction forcing, and
says so in its note, until a re-fit. `canopy-blend-residual.json` is a frozen record of the canopy blend at
strength 0.5, and its script refuses to re-run while the shipped strength is 0 (§1), so its night
coefficients keep the pre-correction wind for these passes; its day figures, which the strength decision
rested on, are unaffected. `fetch-met.py` sizes its POWER request from UTC dates, so one pass late on the
last UTC date (2026-06-26 night) falls outside the fetched span and stays dropped, as it was before the fix.
And `build-ward-observations.py` queries NASA's CMR catalogue live for granule metadata and drops a
ward-scene silently if that query fails; this rebuild lost none.

**Not rebuilt: everything else that reads the forcing through `scripts/_physics.py`.** That is
`measure-spatial-accuracy.py`, `measure-shipped-amplitude.py`, `measure-scale-skill.py`,
`measure-svf-signtest.py`, `measure-shadow-signtest.py`, `measure-term-fit.py`, `fit-physics.py`,
`fit-ward-scale.py` (through `ward-observations.json`, which was rebuilt, but the fit was not re-run) and
`experiment-model-structure.py`. Their committed artefacts reflect the pre-correction night forcing. In
particular the SPATIAL figures on /uncertainty (n 87, r 0.297 against the vegetation-only 0.313, amplitude
ratio 1.17, anomaly RMSE 1.59 K) include 50 night ward-scenes, 32 of which (13 passes) fall on passes this
correction changed; counted by joining `spatial-accuracy.json` and `shipped-amplitude.json` rows on date
and phase against the rows whose tAir, rh, wind or cloud differ from the pre-correction `met-forcing.csv`.
Re-running needs the ECOSTRESS granules and an Earthdata token, so it belongs to the follow-up re-fit. The
size of the shift is unknown: tAir moves every cell of a ward-scene equally (POWER is one point), but rh,
wind and cloud can change within-ward contrast.

**`model-accuracy.json` still carries `phases.night.reported_band_K: 3.5`.** That is the older mask-scale
block: it scores the unshipped `fit-physics.py` point, and nothing reads it. The published night band comes
from `ward_scale.strata.night`.

## 17. Landsat rows were scored at the wrong wind (corrected 2026-10-05)

**Status:** fixed · **See:** `scripts/_physics.py` `model_wind`, `scripts/build-ward-observations.py`
`landsat_rows` and `--check`, `data/calibration/model-accuracy.json`.

The model runs on a wind multiplier, not a wind speed: `wind / 3` of the 10 m reading, clamped to 0.3–2.5
(`currentParams` in `heat-map-model.ts`). The ECOSTRESS rows in `ward-observations.json` carried that value
through `_physics.load()`. The Landsat rows, added by the 2026-08-02 campaign (commit `4ce2585`), were written
straight from `met-forcing.csv` and carried the **raw NASA POWER m/s**: a mean of 2.15 against the page's
0.72 over the 212 rows. Every Landsat ward-scene was therefore scored with about three times the convective
cooling the page applies, which drags the modelled 10:30 surface toward air and reads as the model running
cold. No other field differed: rebuilding the artefact changed exactly the 212 Landsat `wind` values and nothing
else, and the same pipeline on unmodified `main` reproduces the committed artefact byte for byte.

| `morning_landsat` (n = 212, 50 overpasses) | published (raw m/s) | corrected (page wind) |
|---|---|---|
| bias, model − measured | −2.494 K | **+0.362 K** |
| RMSE | 3.253 K | **2.913 K** |
| leave-one-overpass-out RMSE | 2.129 K | **2.945 K** |
| bootstrap 95 % CI (half-width) | 2.718–3.764 K (±0.523) | 2.281–3.504 K (±0.611) |
| data ceiling (LOO-overpass) | 1.597 K | 1.597 K |
| Ward 68 / Barrackpore / Baruipur bias | −2.83 / −2.12 / −2.31 K | +1.16 / +0.60 / −0.80 K |
| `intercomparison.offset_K.landsat` | −2.494 K | +0.362 K |
| `intercomparison.delta_K` (Landsat − ECOSTRESS, 9.5–11.5 h) | −3.431 K | **−0.575 K** |

Night, `morning_ecostress` and `peak_ecostress` do not change (ECOSTRESS rows only), so no published band
moves. `ward-scale-fit.json` is untouched: the shipping fit reads ECOSTRESS alone, and it was not re-run (it is
the pre-Ward-68 fit by decision, §16).

**What the correction says.**
- The 10:30 out-of-sample error got **worse**, not better: 2.13 → 2.95 K. The old LOO looked good because the
  leave-one-overpass-out method removes the mean bias, and most of the old error *was* a wind-induced bias.
  The scatter around the bias is the real 10:30 error, and it is 2.95 K. That is still inside the ±4.5 K
  daytime band and under half the 7.54 K transition figure, so `TRANSITION_HOURS`' 9.5 h upper bound was
  re-derived and **holds**. The model now sits further above the data ceiling at 10:30 (2.91 against 1.60 K)
  than any earlier figure implied.
- The "sensor offset" mostly disappears. `delta_K` was −3.639 K, then −3.431 K, and was already known not to
  be an instrument offset (the 2026-08-09 adjudication spec). About 2.9 K of it was this bug. At −0.575 K it
  is inside the 1.0 K pooling threshold, but pooling stays **blocked** because only 2 ECOSTRESS overpasses fall
  in Landsat's window against a minimum of 5. Do not read −0.575 K as a measured offset either.
- **The 2026-08-09 hybrid-fit analysis used the corrupted rows.** Its finding that a Landsat+ECOSTRESS fit
  rails `q_day` to 0.6 and `l_et` to 0.4 (`docs/superpowers/specs/2026-08-09-sensor-offset-adjudication-design.md`)
  was produced at raw m/s wind and should be re-run before anyone cites it.
- The published daytime CI half-width on the Landsat stratum is ±0.61 K, not ±0.49 K (campaign) or ±0.52 K.

**Guard.** `python3 scripts/build-ward-observations.py --check` (in `npm run test:py`) fails if any of these
diverge: the TypeScript's every `x.wind / n` site against `_physics`' constants; `_physics.load()` against
`model_wind`; a live `landsat_rows()` against `model_wind`; and every committed row, both instruments, against
`model_wind` of its own forcing line. Mutation-proved both ways: reverting `landsat_rows` to `f["wind"]` fails
the live check, and the pre-fix artefact fails the artefact check.

## 18. Displayed vs calibrated: the page draws a damped field the bands were never fitted on

**Status:** factor REMOVED 2026-10-05 (see the end of this section) · **See:** `scripts/measure-displayed-vs-calibrated.py`,
`scripts/displayed-field-means.mjs`, `data/calibration/displayed-vs-calibrated.json`.

Every published accuracy figure scores the calibrated equation, `(gain + kRad·tSky + h·wind·tAir) /
(kRad + h·wind)` at the ward's mean surface (`fit-ward-scale.py` `predict`, `eqMeanFromMeans`). The solver the
page runs, `TsHeatSim` (`sim-ts.ts`) and its GPU twin (`sim-gpu-webgl2.ts`), multiplies the convective term by a
per-cell ventilation factor `max(0.15, 1 − 0.55·built + 0.65·water)` that no fit has ever seen. A built cell
therefore sheds heat to the air more slowly than the calibrated equation assumes, and the ward mean on screen
runs warm of the number the bands describe.

**Method.** For each of the 294 scored rows, the shipped solver was driven through the app's own path
(`rasterWardBase` layers, `currentParams` with the row's forcing and corrected wind, the Ward 68 polygon mask
through `fieldStats`) to convergence (ward mean moving < 1e-4 K per 400 steps), and scored against the same
observation with the statistics `measure-accuracy.py` publishes. The calibrated column is recomputed with the
published scorer and the script refuses to run unless it reproduces `model-accuracy.json` on every stratum
(it does, to 0.002 K). "First frame" is the field after `RESET_BURST` (600) steps, which is also all the
non-animating static host ever shows. No row changed branch (day/night) between the two paths.

| stratum | n | calibrated bias / RMSE / LOO-overpass | displayed bias / RMSE / LOO-overpass | first frame RMSE | published band | holds for displayed? |
|---|---|---|---|---|---|---|
| night | 50 | +0.41 / 2.66 / 2.78 K | +0.59 / 2.83 / **2.92** K | 2.79 K | ±3.0 K | **yes, by 0.08 K** |
| morning_ecostress (7.1–11.1 h) | 9 | −1.62 / 4.34 / 6.29 K | −1.11 / 4.27 / 5.87 K | 4.28 K | 7.54 K (transition) | yes |
| morning_landsat (10:30) | 212 | +0.36 / 2.91 / 2.94 K | +1.12 / 3.36 / 3.23 K | 3.23 K | ±4.5 K (peak; 10:30 is outside the transition window) | yes |
| peak_ecostress (11.8–17.5 h) | 23 | +0.66 / 2.23 / 2.36 K | +1.09 / 2.42 / 2.37 K | 2.41 K | ±4.5 K (n = 29 earlier set) | yes |

Displayed minus calibrated, mean over the stratum: night +0.18 K, morning_ecostress +0.51, morning_landsat
+0.76, peak +0.44 K; on Ward 68 alone +0.37 (night), +1.14 (Landsat, 92 rows over 47 overpasses), +0.73 K
(peak). Ward 68 sits highest because it is the most built (0.36). Almost all of it is the solver's own
departure from its undamped equation (`solver_minus_equation_K`); the app's equation differs from the
published scorer by under 0.1 K (the night-ET taper uses a fixed reference surface in the app).

**The ventilation factor is the whole gap.** Re-running the same harness with the factor set to 1 (a scratch
counterfactual, not committed) puts displayed within 0.1 K of calibrated on every stratum: night +0.31 / 2.68 /
2.81 K, Landsat +0.33 / 2.89 / 2.92 K, peak +0.64 / 2.22 / 2.35 K, Ward 68 Landsat −0.08 K from calibrated.
Diffusion and the polygon mask contribute almost nothing.

**Seasons.** All four pooled bands hold for the displayed field. They do not all hold by season:

| displayed field | winter (Dec–Feb) | pre-monsoon (Mar–Jun) | monsoon (Jul–Sep) | post-monsoon (Oct–Nov) |
|---|---|---|---|---|
| night, all wards | −1.57 / 2.41 K (n 14) | +2.00 / **3.27** K (n 18) | +2.33 / 4.22 K (n 5) | +0.31 / 1.73 K (n 13) |
| Landsat 10:30, all wards | +0.30 / 2.69 K (n 119) | +3.56 / **4.81** K (n 60) | — | −0.36 / 2.13 K (n 33) |
| Landsat 10:30, Ward 68 | +1.70 / 3.17 K (n 49) | +4.17 / **5.65** K (n 29) | — | +0.56 / 1.95 K (n 14) |
| peak, all wards | +0.50 / 2.00 K (n 9) | +2.50 / 3.21 K (n 9) | — | −0.38 / 1.14 K (n 5) |

(bias / RMSE.) The calibrated equation already runs hot before the monsoon (Landsat Mar–Jun +2.57 K bias,
RMSE 3.91 K all wards; Ward 68 +2.80 / 4.45 K) and the damping adds about another 1 K. So **the ±4.5 K daytime
band fails for the displayed field at 10:30 in March–June** (4.81 K all wards, 5.65 K on Ward 68), and the
calibrated field there is at the edge (4.45 K on Ward 68). Leave-one-overpass-out stays inside (3.45 / 4.09 K)
because that statistic removes the bias, and the pre-monsoon error is mostly bias. Night pre-monsoon exceeds
±3.0 K in both fields (calibrated 3.06, displayed 3.27 K; monsoon n = 5 is too small to read). Winter and
post-monsoon sit well inside every band. This matches the 2026-10-05 "41.9 too high?" check, whose
Ward 68 Mar–Jun RMSE was 5.6 K: about right in October, about +4 K hot before the monsoon.

**Per ward, not pooled.** Ward 68 night on the displayed field is RMSE 3.13 K, LOO-overpass 3.16 K (n 16):
over the ±3.0 K band, where its calibrated figure (2.86 / 2.97 K) is just inside. The band is a pooled
three-ward claim and is not published per ward, but Ward 68 is the default view.

**What this does not change.** No constant, no solver line and no displayed band was changed. The verdicts
above are evidence for a decision: remove the factor (the page then draws the calibrated field), carry it into
the calibration and re-fit (a reviewed recalibration), or keep it and score the bands against the displayed
field. Its effect on within-ward spatial skill has not been measured, and should be before choosing.

**Decision, 2026-10-05: removed.** The founder's rule was to remove the factor unless it improved where
the map puts the heat inside a ward, and to recalibrate with it if it did. It was scored both ways with
`measure-shipped-amplitude.py`, which drives the real solver against ECOSTRESS. Both runs used the same
85 ward-scenes, the corrected wind and the Ward 68 polygon. Rows were paired by ward-scene and resampled
10,000 times in a bootstrap.

| | r shipped (95 % CI) | vegetation null | amplitude |
|---|---|---|---|
| with factor | 0.261 [0.205, 0.316] | 0.308 | 1.11x |
| without | 0.267 [0.211, 0.323] | 0.306 | 0.97x |
| difference | **+0.006 [+0.004, +0.009]**, better in 68 of 85 ward-scenes | | |

The change is the same sign in every split:

| split | change in r without the factor |
|---|---|
| Ward 68 | +0.013 |
| Barrackpore | +0.004 |
| Baruipur | +0.002 |
| day | +0.008 |
| night | +0.005 |

The factor made the within-ward pattern slightly worse. It also made the colour range over-drawn
(1.11x → 0.97x). So it was removed from both solvers: the GPU parity transcription moved with them, and a
new test pins a uniform built cell to `equilibriumC`.

The re-run artefact (`displayed-vs-calibrated.json`) shows displayed within 0.1 K of calibrated on every
stratum:

| stratum | displayed bias / RMSE / LOO |
|---|---|
| night | +0.31 / 2.68 / 2.81 K |
| Landsat | +0.33 / 2.89 / 2.92 K |
| peak | +0.64 / 2.22 / 2.35 K |

Pre-monsoon Landsat is +2.54 / 3.88 K, back inside the ±4.5 K band. Pre-monsoon night is 3.06 K, which the
calibrated equation itself also scores, so it is still just over ±3.0 K. That is a fact about the model,
not about the display. Ward 68 alone now draws 0.56 K of within-ward SD against an observed 0.68 K (0.82x),
so its contrasts are slightly understated. The vegetation null still beats the model.
