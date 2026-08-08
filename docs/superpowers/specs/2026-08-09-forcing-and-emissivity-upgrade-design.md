# Forcing and reference upgrades: ERA5-Land fluxes and a common emissivity — design

**Date:** 2026-08-09
**Status:** proposed; implementation not started pending review
**Scope:** `scripts/fetch-met.py`, `scripts/_physics.py`, `scripts/fetch-landsat-lst.py`, `data/calibration/`
**Moves published output:** yes — every physics constant is refitted. See §8.
**Companion:** `2026-08-09-sensor-offset-adjudication-design.md` (§4.2 of that spec is Phase A here, specified concretely)

---

## 1 · Executive decision

Two structural defects in the model's inputs, both found by reading the code rather than by a
failing test, and both of a kind that a fitted constant will silently absorb:

1. **There is no atmosphere in our shortwave forcing.**
2. **An atmospheric constant is being fitted against surface observations.**

Both are fixable with data we can already reach — one of them with bands we are *already
downloading and discarding*. Neither is a tuning exercise; both close gaps that no amount of
recalibration could.

## 2 · The two findings

### 2.1 The shortwave forcing has no atmosphere

`_physics.solar_factor()` returns `cos(solar zenith)`, clamped at zero, from Spencer (1971)
declination. That is **pure geometry** — no aerosol, no water vapour, not even a clear-sky
transmission. It is then attenuated in `_physics.py:231`:

```python
sun = 0.0 if night else sc.sun * (1 - 0.6 * cloud)
```

`0.6` is hand-set. `cloud` is NASA POWER `CLOUD_AMT` at ~50 km — one cell over greater Kolkata.

**Kolkata sits on the Indo-Gangetic plain, among the most aerosol-loaded airsheds on Earth.**
A forcing with no atmospheric attenuation will systematically overstate surface shortwave, and
worst in the winter haze season. This is a *structural* omission: the model has no term that
could represent it, so the error has nowhere to go except into the fitted constants — most
plausibly `Q_day`, which is the term with the same daytime signature.

### 2.2 An atmospheric constant is fitted against surface temperature

`_physics.sky_temp()` uses Brutsaert clear-sky emissivity with coefficient `c`, greyed toward
0.9 by cloud fraction. **`c` is one of the three constants `fit-physics.py` fits — against
land surface temperature.**

So a property of the *atmosphere* is being estimated from observations of the *surface*. It can
absorb surface-model error, and there is no way to tell from the fit whether it has. It is also
a degree of freedom spent on something we could measure independently.

## 3 · Phase A — put both instruments on a common emissivity

This is §4.2 of the companion spec, made concrete.

**The whole radiative-transfer chain is already in the STAC items we fetch.** Verified against
the Microsoft Planetary Computer catalogue: of 25 assets we use three (`lwir11`, `qa`,
`qa_pixel`). All six of `trad`, `urad`, `drad`, `atran`, `emis`, `emsd` are present and unused.

**No new provider, no new licence, no new dependency.** The requests already happen.

Landsat's `ST_EMIS` is derived from **ASTER GED plus NDVI**; ECOSTRESS L2T_LSTE uses
**Temperature-Emissivity Separation**. Confirmed different retrievals, which is exactly the
mechanism §4.1 of the companion spec names as a leading candidate for the reference offset.

Because every term is provided, Landsat LST can be **inverted to surface radiance and
recomputed on any chosen emissivity** — removing the mechanism by construction rather than
estimating it.

### 3.1 The formula — established empirically, 2026-08-09

LSDS-1619 documents the bands but **not** the equation; it defers to the Cal/Val ADD. That
turns out not to matter, because **the formula does not need to be read — it can be
verified.** USGS ships the answer (`ST_B10`) *and* every input, so a candidate arrangement
either reproduces the shipped temperature from the shipped inputs or it does not.

Tested over 67,600 usable pixels of `LC09_L2SP_138044_20260704_02_T1`, with `K1`/`K2` taken
from the scene's own MTL rather than assumed:

| candidate arrangement | median &#124;ΔT&#124; |
|---|---|
| **`(TRAD − URAD − ATRAN·(1−ε)·DRAD) / (ATRAN·ε)`** | **0.168 K** |
| `(TRAD − URAD − (1−ε)·DRAD) / (ATRAN·ε)` | 1.171 K |
| `(TRAD − (1−ε)·DRAD) / ε` | 16.901 K |

**The first is the structure**, by a factor of seven over its nearest rival and a hundred over
the naive form. Surface temperature then follows from the Planck inversion
`T = K2 / ln(K1/B + 1)`.

**Scale factors, from LSDS-1619 Table 6-1** — read, not recalled, and one of them is the kind
of number memory gets wrong:

| band | type | scale | offset | fill |
|---|---|---|---|---|
| `ST_B10` | UINT16 | **0.00341802** | **+149** | 0 |
| `ST_TRAD`, `ST_URAD`, `ST_DRAD` | INT16 | 0.001 | — | −9999 |
| `ST_ATRAN`, `ST_EMIS`, `ST_EMSD` | INT16 | 0.0001 | — | −9999 |
| `ST_QA` | INT16 | 0.01 | — | −9999 |

**An unexplained residual, recorded rather than smoothed over.** The winning structure sits
**+0.168 K** from the shipped product, with a p5–p95 spread of only **0.048 K** — a tight
systematic, not noise, and far above the 0.0034 K quantisation of `ST_B10`. Most likely a
band-effective Planck inversion rather than the `K1`/`K2` approximation, or a post-processing
step in `st_1.3.0`. **It is not yet explained, and this spec does not pretend otherwise.**

**It also does not matter for what we need.** We never require USGS's absolute temperature —
we require the *change* under a substituted emissivity, and a constant offset cancels in a
difference. Verified, not assumed: bias-correcting before differencing changes the result by
**0.0 × 10⁰ K** at every emissivity perturbation tested. Absolute recomputation would need the
residual explained first; differential recomputation does not.

### 3.2 The sensitivity, measured

**0.585 K per 0.01 of emissivity** (≈ 58 K per unit).

That reframes the whole offset question. Emissivity differences between TES and ASTER-GED
retrievals over urban surfaces are of order 0.01–0.02 — so **emissivity alone could plausibly
account for 0.6–1.2 K** of the apparent ECOSTRESS↔Landsat disagreement. And within this single
urban window emissivity spans 0.9346 to 0.9915, which at this sensitivity is **3.3 K of LST
spread from emissivity alone** — the same magnitude as the disagreement we are chasing.

**Repeated across the archive, 2026-08-09** — 47 ward-scenes over the three real ward
footprints, not an arbitrary window:

| | median | p5 | p95 | range |
|---|---|---|---|---|
| sensitivity, K per 0.01 emissivity | **0.598** | 0.277 | 0.650 | 0.247–0.654 |

The one-window figure of 0.585 holds at the median. **But the caveat was right**: sensitivity
correlates with atmospheric transmittance at **r = +0.754**, and transmittance over these wards
runs 0.248–0.649 — low, consistent with a humid, hazy airshed. In the haziest conditions the
sensitivity halves. Quote the median; never quote it as a constant.

The unexplained residual also holds across the archive: **+0.126 K, sd 0.022 K** over 47
ward-scenes. Tight enough to confirm it is a fixed artefact of the Planck step, which is why it
cancels in differences.

### 3.3 The finding that changes the design

**ECOSTRESS's emissivity varies 10–124× more between overpasses than Landsat's.**

| ward | Landsat sd | ECOSTRESS sd | ratio |
|---|---|---|---|
| Ballygunge | 0.00062 | 0.02433 | **39×** |
| Baruipur | 0.00263 | 0.02564 | 10× |
| Barrackpore | 0.00021 | 0.02656 | **124×** |

*(Landsat: 47 ward-scenes. ECOSTRESS: 26 ward-scenes over 14 dates — and only 4 for Baruipur,
so that row is the weakest.)*

This is the structural difference the two retrievals imply, now measured. Landsat's `ST_EMIS`
is the ASTER GED **climatology** adjusted by NDVI — Barrackpore's ward mean moves by 0.0005
across ten overpasses, which is a fixed map. ECOSTRESS runs **Temperature-Emissivity Separation
per scene**, and its ward mean moves by ~0.025.

**At 0.598 K per 0.01, an emissivity spread of sd ≈ 0.025 is sd ≈ 1.5 K of LST, scene to
scene.** That is the same magnitude as the disagreement we set out to explain.

**The consequence for the companion spec: the disagreement may not be a constant offset at
all.** A design built to measure and apply a single sensor offset cannot reconcile a difference
that varies by ~1.5 K between overpasses. This does not invalidate the regional harvest — it
sharpens what the harvest must report: **an offset *and* its scene-to-scene dispersion**, with
the dispersion probably mattering more. And it strengthens Phase A considerably, because
harmonising emissivity per-pixel per-scene addresses a varying difference in a way no scalar
offset can.

**Two caveats that must travel with these numbers.**

*The absolute levels are not comparable.* ECOSTRESS ships **wideband** emissivity; Landsat ships
**band-10** (~10.9 µm). The measured level difference (−0.025 to −0.031, ECOSTRESS lower) is
substantially what the spectral definitions predict and **is not evidence of error**. Only the
variability is comparable, because each product is compared to itself over time.

*The variability has two sources we cannot separate here* — genuine surface change (vegetation
phenology) and retrieval noise. A 124× ratio is far too large to be phenology, but the split is
not established and should not be asserted.

### 3.4 The harmonisation was tested, and it does not work — a negative result

§3.3 argued that ECOSTRESS's emissivity variability (sd ≈ 0.025) should inject ≈ 1.5 K of
scene-to-scene LST error. **That was a propagation argument, not a measurement.** It has now
been tested, and it is not supported.

17 ECOSTRESS day ward-scenes over 10 dates, matched between the extracted `EmisWB` and the
calibration archive, scored against the shipped candidate-G constants:

**Mechanism test** — a scene whose emissivity is anomalous should carry a larger residual, with
the sign the physics demands (negative: a lower assumed emissivity inflates retrieved
temperature). This test needs no sensitivity value at all.

| | measured | required |
|---|---|---|
| correlation(emissivity, residual) | **+0.126** | negative |
| slope | **+25.0 K/unit** | ≈ −58.5 K/unit |
| permutation *p*, 20k, two-sided | **0.624** | — |

**Correction test** — removing the emissivity term should shrink the scatter. It does the
opposite:

| sensitivity applied | RMSE |
|---|---|
| Landsat band-10, −58.5 K/unit | 4.141 → **4.626 K** (+11.7 %) |
| half that, −29 K/unit | 4.141 → 4.340 K (+4.8 %) |

Bootstrap over 4000 resamples: the correction **improves the RMSE in only 22 % of them**, 95 %
CI [−0.587, +1.354] K.

**Robust to subsetting, and that is what makes it informative.** Dropping the low-emissivity
tail, or the large residuals, or both, leaves harmonisation making things worse every time —
while the correlation *flips sign* between subsets (+0.325, −0.162, +0.325). Sign instability
under subsetting at n = 13–17 is the signature of noise, not of a weak signal.

**Two honest readings, and I cannot separate them at this n.** Either emissivity is not a
material driver of ECOSTRESS's LST error, or the effect exists and 17 ward-scenes cannot see
it. This is a *null*, not a *disproof*.

### 3.5 The reading of §3.3 that this forces

I framed the 10–124× variability ratio as ECOSTRESS being noisy. **That framing was an
assumption, and this result undercuts it.**

ECOSTRESS's TES retrieves emissivity and temperature **jointly**. If the surface genuinely
changes — wet after rain, vegetation greening, a different mix within the pixel — then a
varying emissivity is *correct*, and the temperature derived with it is *better*, not worse.
Under that reading the 124× ratio says **Landsat's static ASTER-GED climatology is blind to
real surface change**, not that ECOSTRESS is unstable. It is at least as plausible as my
original reading, and the harmonisation result is what one would expect if it were true.

**Consequence for the plan.** Emissivity harmonisation is no longer the promising short cut it
looked like at the end of §3.2. It stays worth doing for Landsat — the recomputation is exact
and nearly free — but it should not be expected to collapse the ECOSTRESS↔Landsat difference,
and the regional harvest is back to being the load-bearing piece of work rather than something
this might have made unnecessary.

**An honest asymmetry.** Landsat can be recomputed exactly. ECOSTRESS's tiled L2T product ships
`EmisWB` but not the radiance terms, so it can only be **first-order corrected** using the
standard LST sensitivity to emissivity. That difference must be stated wherever a
common-emissivity comparison is published; it is not a symmetric treatment and should not be
presented as one.

## 4 · Phase B — ERA5-Land, as a better parameterisation rather than a bypass

### 4.1 What it provides

Verified against ECMWF documentation: `surface_solar_radiation_downwards` (paramId 169) and
`surface_thermal_radiation_downwards` (paramId 175), plus 2 m temperature, 2 m dewpoint, 10 m
wind components and skin temperature. Grid **0.1° × 0.1°, native ~9 km**, **hourly**.

**No total cloud cover** — and that is fine. Cloud exists in our model only to attenuate the sun
and grey the sky. Both fluxes already contain it.

### 4.2 The constraint that shapes the whole design

**Calibration is forced by POWER; the runtime is forced by met.no.** ERA5-Land is a reanalysis
with days of latency and **cannot** be a runtime source.

Today the two paths differ in their *variable source* but share the same *parameterisation*, so
train and run agree. Feeding fluxes directly into the calibration would break that: the
constants would become fluxes-shaped while the shipped product still runs on geometry. **That
is precisely the defect we fixed on 2026-08-09 in the evapotranspiration ramp** — a model
trained on one shape and executed with another — and it would be reintroduced here at larger
scale.

**Therefore: ERA5-Land improves the parameterisation; it does not replace it.**

### 4.3 Shortwave — fit the missing atmosphere

Fit a transmission term so that

```
sun_modelled = cos(z) · τ(air mass, humidity, aerosol)
```

reproduces ERA5-Land SSRD across our scene archive. The runtime then evaluates **the same τ**
from geometry plus live humidity and a Kolkata aerosol climatology. Train and run stay
identical, and the structural gap of §2.1 closes in both.

The existing `(1 − 0.6·cloud)` attenuation is re-derived rather than retained — `0.6` was never
measured, and ERA5-Land SSRD is the data that can measure it.

### 4.4 Longwave — move `c` to the data it belongs to

Refit Brutsaert's `c`, and the 0.9 cloud-greying, **against ERA5-Land STRD directly** instead
of against LST residuals. `T_sky` follows from the downward longwave flux.

This is the cleanest win in the spec: it converts `c` from a confounded surface parameter into
an atmospheric constant measured against atmospheric data, and **removes a degree of freedom
from the surface fit**. Fewer parameters fitted against LST means less capacity to absorb
structural error — which is exactly what our out-of-sample generalisation problem needs
(Baruipur carries a ~1.1 K penalty against Ballygunge).

### 4.5 The deliverable worth most: decomposing the daytime error

**Run the calibration under both forcings and publish the spread.**

Today's ±4.5 K daytime band bundles model error and forcing error with no way to separate them.
The methodology *asserts* the daytime limit is forcing resolution; running POWER and ERA5-Land
through the same fit **measures** it. That converts a claim we have been making into a number,
and tells us whether the remaining daytime error is ours to fix or the weather data's.

POWER is retained as a cross-check, not discarded.

## 5 · Traps to design against explicitly

**The accumulation trap.** ERA5-Land radiation is **J m⁻², accumulated from 00 UTC to the
forecast step, resetting daily** — *not* instantaneous W m⁻². Instantaneous flux requires
differencing consecutive hourly accumulations and dividing by 3600, with the midnight reset
handled. Getting this wrong yields plausible-looking numbers that are silently wrong by a
factor that varies with time of day. **A test must fail loudly on it**, including at the
00–01 UTC boundary.

**The time-base trap.** `met-forcing.csv` is stamped in **Local Solar Time**; ERA5-Land is
**UTC**. At 88.36 °E that is a 5.89 h offset. Silently mixing them corrupts every scene, and
would look like a diurnal-phase error in the physics. Explicit conversion, with its own test.

**Credentials.** CDS requires an API key. It follows the established pattern:
`~/.config/delta-climate/`, mode 0600, never printed, never logged, never committed — the same
handling as the Earthdata token and the Earth Engine service account.

**9 km is still coarser than a 1.4 km ward.** This improves the *level*, not the within-ward
pattern. Same honesty as everywhere else: nothing here touches `rModel` 0.303 vs `rVegOnly`
0.314.

## 6 · Pre-registration and the acceptance bar

Fixed in writing before any refit:

1. **Adoption bar — both conditions, neither sufficient alone:**
   - leave-one-**overpass**-out RMSE improves (the only honest split on this archive), **and**
   - **no constant rails to a bound** — criterion 2 of the four, and the test that caught the
     hybrid-fit trap in the companion spec.
2. **If the bar is not met, the forcing is not adopted**, however physically superior it is.
   A change that closes a structural gap but measurably worsens prediction is telling us
   something about the rest of the model, and that finding is the result.
3. **The forcing-error decomposition of §4.5 is published either way** — it is a measurement,
   not a proposal, and it stands independent of whether we adopt.
4. **No threshold moves after seeing results.** If a bar is wrong it is re-registered with the
   reason recorded and the run repeated.
5. Artefacts carry `ship:false` until a human reads the out-of-sample result, as
   `fit-ward-scale.py` already requires.

## 7 · Verification

1. `npm run verify` green throughout — 295 unit tests, 45 e2e, publication contract.
2. Tests that fail on each trap in §5: the accumulation differencing (including the midnight
   reset), the LST↔UTC conversion, and the Landsat band scale factors.
3. Mutation-test the new machinery: an accumulation used raw instead of differenced, a time
   base left unconverted, an emissivity substitution silently skipped — each must fail a test.
4. Every published figure reproducible from a clean re-run, as was done for §4.2.1/§4.2.2 of
   the methodology.
5. The parity oracle between the Python and TypeScript implementations must still hold — any
   parameterisation change lands in **both** `_physics.py` and `heat-map-model.ts`, and
   `scripts/dump-parity-oracle.py` exists to catch a divergence.

## 8 · Risks, stated plainly

**Every physics constant is refitted.** `Q`, `L`, `kRad:h`, `STORE_NIGHT` and the published
±3.0/±4.5 bands all move. That is the point, and it must be a deliberate adoption against §6,
not a side effect of an ingest change.

**A better forcing may make the fit look worse.** If the constants were absorbing the missing
atmosphere, removing it will expose error that was previously hidden. RMSE could rise. Under §6
that means we do not adopt — but the honest reading is that we would have *learned where the
error actually lives*, which is worth more than the RMSE.

**`c` moving changes the night.** The sky term drives the nocturnal balance, and `STORE_NIGHT`
is already the most absorptive constant in the model (−28 %/K to a reference offset, per the
companion spec §2.3). Refitting `c` against STRD and `STORE_NIGHT` against LST in the same pass
risks trading one confound for another. **Refit `c` first, pin it, then refit the surface** —
and report `STORE_NIGHT`'s sensitivity to the new `c` explicitly.

**ERA5-Land is a reanalysis, not an observation.** Its fluxes are modelled, and over a dense
Indian city its aerosol treatment is exactly the thing most likely to be imperfect. We are
replacing a forcing with *no* atmosphere with one whose atmosphere is modelled — a real
improvement, but not ground truth. §9 is how we would have checked it, and it is deferred.

## 9 · Deferred: CPCB ground validation, and what deferring costs

CPCB CAAQM stations carry met sensors on a 10 m tower including **NIST-traceable solar
radiation** — ground truth for the exact quantity ERA5-Land SSRD provides. That would let us
validate the reanalysis flux locally instead of trusting it.

**Deferred by decision, 2026-08-09**, because there is no documented public API: data comes
through the CCR portal at `airquality.cpcb.gov.in/ccr/`, and access route and terms are
unestablished. No scraping before we know what is sanctioned — the same discipline applied to
the MOSDAC and Open-Meteo licence questions.

**What deferring costs, stated so it is not forgotten:** we adopt ERA5-Land's shortwave without
local verification. If its aerosol treatment is biased over Kolkata, that bias enters our
constants exactly as the missing atmosphere does today — smaller, but unmeasured. This is the
one place in the chain where the loop is left open, and it should be closed when access is
resolved. IMD is the alternative route worth checking at the same time.

## 10 · Non-goals

- **Replacing POWER.** It is retained as the cross-check that makes §4.5 possible.
- **Feeding ERA5-Land to the runtime.** Impossible — reanalysis latency — and §4.2 is the whole
  reason the design is shaped as it is.
- **Advection.** Still the real within-ward gap, still deserving its own spec.
- **Recomputing ECOSTRESS LST from radiance.** The tiled product does not ship the terms;
  first-order correction only, stated as such.
