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
