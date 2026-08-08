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

**Two things to get right, and neither should be written from memory:**

- **The inversion formula must be read from the USGS Landsat 8-9 C2 L2 Science Product Guide
  (LSDS-1619)**, not reconstructed. The single-channel algorithm's exact arrangement of
  transmittance, upwelled and downwelled terms is the whole point of the exercise.
- **Scale factors and fill values must come from the Data Format Control Book (LSDS-1328)**,
  not assumed. Each band carries its own scaling; a wrong factor produces a plausible number.

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
