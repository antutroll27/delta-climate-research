# Adjudicating the ECOSTRESS ↔ Landsat reference disagreement — design

**Date:** 2026-08-09
**Status:** proposed; implementation not started pending review
**Scope:** `scripts/` ingest and calibration; `data/calibration/`; `accuracy.ts` figures
**Moves published output:** yes, potentially — see §8

---

## 1 · Executive decision

The heat model is calibrated against 85 ECOSTRESS ward-scenes while 213 better-constrained
Landsat ward-scenes sit unused, because the two instruments cannot be pooled. The block is
correct — but the reason it exists has never been measured, and this spec measures it.

**The single most important fact: we do not know whether our two references disagree.**
`model-accuracy.json` reports `delta_K: -3.639`, and that number is not an instrument
comparison (§2.1). Every calibration decision — including the `Q` and `STORE_NIGHT` refit of
2026-08-09 — rests on a reference whose absolute level is unadjudicated.

## 2 · The measurement

### 2.1 The published offset is not an offset

`measure-accuracy.py:247` computes `delta = d_lst - d_eco`, a difference of **model-vs-observation
biases** taken on each sensor's own rows. Those rows are disjoint:

| | rows in the 9.5–11.5 h window | distinct dates |
|---|---|---|
| Landsat | 213 | 50 |
| ECOSTRESS | **4** | **2** — 2025-04-02, 2025-09-28 |

**Zero same-day pairs.** Not one ECOSTRESS in-window observation shares a date with a Landsat
observation. The 3.639 K therefore contains the instrument difference *plus* the weather
difference between two days (one 35 °C pre-monsoon, one 41.9 °C post-monsoon) and fifty
others. The pre-registered guard blocks pooling and says "underpowered"; it is right.

One hypothesis is already dead: it is **not** time-of-day. Mean ECOSTRESS in-window hour is
10.27 against Landsat's 10.40 — 0.13 h, far too small to carry 3.6 K of morning heating.

### 2.2 Why coincidences are structurally rare

Landsat is sun-synchronous and pinned at 10.39–10.41 h on every pass. ECOSTRESS rides the
ISS, whose orbit precesses: our 35 daytime rows span 07:06 → 17:26. That drift is *why* we
carry ECOSTRESS — it is our only night instrument and our only afternoon one — and it is also
why it almost never meets Landsat.

Measured rate: **2 in-window overpasses per 34 ECOSTRESS dates ≈ 6 %.**

Extending the ECOSTRESS archive to its 2018-07 launch gives roughly 112 dates → ~7 in-window
overpasses, which clears the pre-registered minimum of 5. But against Landsat's 8-day revisit
(16-day before Landsat 9 in 2021), the expected number of **same-day** pairs over Kolkata
remains **under one**. Local coincidence is not a viable route, however long we wait.

### 2.3 Where an unmeasured offset lands

Refitting candidate G with the night observations shifted, to simulate an offset:

| offset applied | `STORE_NIGHT` moves | `Q` moves |
|---|---|---|
| ±1 K, night only (**differential**) | **∓28 %** | < 0.5 % |
| ±1 K, day and night (**common**) | ∓12 % | < 0.5 % |

The offset lands almost entirely on `STORE_NIGHT` — the nocturnal heat-release term that the
night sign-error fix rests on, and the physical claim the product leads with.

**This means the obvious fallback is worse than the status quo.** Today both phases come from
ECOSTRESS, so a common bias partly cancels in the day–night contrast (−12 %/K). Fitting day
on Landsat and night on ECOSTRESS puts the cross-instrument difference *directly into* that
contrast (−28 %/K). The instinct — use each instrument where it is strongest — is right, but
done naively it routes an unmeasured quantity into our most load-bearing constant.

### 2.4 The hybrid fit already demonstrates the disagreement is material

Fitting candidate G on Landsat-day + ECOSTRESS-night (n=263) against ECOSTRESS-only (n=85):

| | ECOSTRESS-only (shipped) | Landsat day + ECOSTRESS night |
|---|---|---|
| RMSE vs 213 Landsat day scenes | 3.069 K | **2.633 K** |
| leave-one-ward-out — Ballygunge | 3.245 | **2.678** |
| — Barrackpore | 2.626 | **2.267** |
| — Baruipur | 3.151 | **2.790** |
| RMSE vs 35 ECOSTRESS day scenes | 4.190 | **4.772** ← worse |
| `q_day` | 0.3936 | **0.6000** ← railed to upper bound |
| `l_et` | 0.4600 | **0.4000** ← railed to lower bound |

A genuine 14 % improvement on the better-constrained reference, on every ward out of sample —
**bought by railing two constants to their limits and fitting the other instrument worse.**
That fails acceptance criterion 2 (*"no parameter resting on a bound"*). The model cannot
satisfy both instruments, and when forced it goes to the edges.

**Do not adopt this fit.** It is the most tempting wrong move available: it would bury an
unmeasured instrument disagreement inside two physical constants — the `L` failure mode with
more data behind it.

## 3 · Design

### 3.1 Regional coincidence harvest — the unblocker

The offset is a property of the **instruments**, not of Ballygunge. Estimating it over three
wards is needlessly starved; estimating it over ~40 sites across the Gangetic plain turns
~0 same-day pairs into an expected ~30.

Architecturally cheap, because the ingest is already parameterised:

- `_ecostress.py` threads an optional `bbox` through `cmr_search`, `target_grid` and `align`
- `fetch-landsat-lst.py:77` derives its bbox from `_types.WARDS`; it needs to accept a site
  list instead. Landsat is served from Microsoft Planetary Computer STAC — no account, no new
  dependency.

Pairing rule, fixed before running: **same calendar date, both observations inside 9.5–11.5 h,
aggregated to a common grid**, with the residual time difference recorded per pair and
regressed out rather than assumed negligible.

### 3.2 The falsification test — the railing is the statistic

This is what turns the harvest into a decision rather than a number, and it is pre-registered:

> Re-run the hybrid fit with the measured offset applied.
> **If `q_day` and `l_et` come off their bounds**, the disagreement was the references —
> adopt the hybrid and take the 14 %, with day calibration resting on 213 scenes not 35.
> **If they still rail**, the disagreement is our model *structure* — which routes us to
> advection, not to more data.

Both outcomes are informative. That is what makes it an experiment rather than a hope.

### 3.3 Fallback if the offset proves unmeasurable

If the harvest's 95 % interval exceeds ±1.5 K, we do **not** ship a number. Instead:

- daytime physics from **Landsat** — 213 ward-scenes at ±0.49 K
- **`STORE_NIGHT` identified from the ECOSTRESS day↔night contrast only**, keeping it inside
  a single instrument so it never sees the cross-instrument difference (§2.3)
- the 28 %/K sensitivity published as a first-class figure, not a footnote

## 4 · Three accuracy upgrades this exposed

These are independent of the offset question and improve the archive whatever it finds.

### 4.1 Record view zenith angle on every calibration row

ECOSTRESS views off-nadir; Landsat is near-nadir. Over a city — walls, canopy, street
canyons — thermal anisotropy between those geometries is worth several K, and it is a leading
candidate explanation for any offset we measure.

`_view_zenith.tif` is **already plumbed**: `_suhii.py:144` and `ecostress-suhii.py:117` read
it. `build-ward-observations.py` does not carry it onto the calibration rows. Without it we
cannot even ask whether the offset is a view-angle artefact.

Cost: one band per granule, already downloaded for the SUHII work.

### 4.2 Put both instruments on a common emissivity

The two products retrieve emissivity differently — ECOSTRESS by Temperature-Emissivity
Separation, Landsat from ASTER GED with an NDVI adjustment — and LST is directly sensitive to
that choice. This is the other leading offset mechanism.

The probe shows Landsat ships **25 assets**, including the complete radiative-transfer chain:
`trad`, `urad`, `drad`, `atran`, `emis`, `emsd`. We use three (`lwir11`, `qa`, `qa_pixel`).
ECOSTRESS ships `_EmisWB.tif`, which we do not read anywhere.

That means we can **invert both products to surface radiance and recompute LST on a single
chosen emissivity** — removing the mechanism *by construction* rather than estimating it.
This is stronger than regressing the offset against emissivity, and it is the most valuable
single item in this spec.

### 4.3 Recover the Landsat scenes the QA filter is discarding

`fetch-landsat-lst.py --probe` reports **90 dates covering all three wards**. The committed
archive holds **50**. The `ST_QA_MAX_K = 3.0` ceiling is discarding 40 dates.

That threshold was chosen deliberately, with a tabulated trade at `fetch-landsat-lst.py:174`.
It should be revisited now that coincidence count is the binding constraint — or at minimum,
what it costs should be recorded alongside what it buys.

## 5 · Runs in parallel, depends on nothing here

- **Ward expansion** (New Town, Salt Lake Sector V, KMC Ward 22 — approved with coordinates).
  Three wards cannot support a South Asia claim, and Baruipur's out-of-sample penalty says the
  model does not yet generalise. **Collect observations; adopt no constants** until §3.2
  resolves. Adding evidence is safe; adopting a calibration is not.
- **Extend ECOSTRESS to 2018-07 — for coverage, not for the offset.** §2.2 shows it buys under
  one same-day pair. Its real value is that ECOSTRESS is our only night and afternoon
  instrument, and 2018 roughly triples that coverage.

## 6 · Pre-registration

Fixed in writing before any fitting, the discipline that worked on ICESat-2 and that the `L`
derivation lacked:

1. **Expected offset sign and magnitude** from published ECOSTRESS↔Landsat ST comparisons —
   cited, not assumed. Recorded before we look at our own pairs.
2. **The measurability bar:** if the 95 % interval exceeds ±1.5 K, the offset is not measurable
   and we take §3.3 rather than shipping a number.
3. **The railing test** of §3.2, with `q_day` and `l_et` bound-proximity as the stated statistic.
4. **Leave-one-overpass-out**, as the existing ward-scale work already does; and
   leave-one-site-out for the regional harvest, to test transferability to our wards.
5. **The `STORE_NIGHT` sensitivity (§2.3) must be published whatever the outcome** — it tells a
   reader how much of our headline night claim rests on an unadjudicated reference.
6. **No threshold may be moved after seeing results.** If a bar is wrong, it is re-registered
   with the reason recorded, and the run is repeated.

## 7 · Verification

1. `npm run verify` green throughout — currently 295 unit tests, 45 e2e, publication contract.
2. Every published figure in the resulting document reproducible from a clean re-run, as was
   done for §4.2.1/§4.2.2 of the methodology.
3. Mutation-test the offset machinery: an offset silently reverting to zero, the pairing window
   widening, the measurability bar loosening — each must fail a test.
4. A test pinning that the coincidence count and the offset interval are reported together. An
   offset without its n is the `delta_K: -3.639` mistake repeated.
5. `data/calibration/` artefacts carry `ship:false` until a human reads the out-of-sample
   result, as `fit-ward-scale.py` already requires.

## 8 · Risks, stated plainly

**This can move published constants.** If §3.2 passes, `Q`, `L` and `STORE_NIGHT` all move,
and the published ±3.0 / ±4.5 bands move with them. That is the point — but it must be a
deliberate adoption with the out-of-sample result read, not a side effect of an ingest change.

**`l_et` now has three sources pulling three ways** — 0.8 from the unconstrained ward fit,
0.46 shipped, 0.40 from the Landsat-trained fit. Do not pick a fourth number before the offset
is settled; §4.2.1 of the methodology already records that `L` is a chosen constant inside a
one-sided region, and this adds a second reason not to touch it yet.

**A regional offset may not transfer to Kolkata.** Surface type and atmospheric water vapour
both plausibly modulate it. The leave-one-site-out test in §6.4 is what would detect that, and
if it fails, the harvest gives us an instrument characterisation we cannot apply — an honest
null result, not a usable number.

**None of this improves the within-ward pattern.** `rModel 0.303` against `rVegOnly 0.314`:
the model does not beat a vegetation map at placing hot spots inside a ward, because it has no
advection — lever additivity is 0.99 and `validate-model.mjs` says so in as many words. That
is the real digital-twin gap, it is structural, and no reference data touches it. This spec
makes the ward-mean numbers defensible; only advection makes the map mean something block by
block.

## 9 · Non-goals

- **MODIS/VIIRS arbitration.** Rejected, but the original reason was partly wrong and the
  correction is recorded in §10.4: for a *differencing* design the scale mismatch largely
  cancels. MODIS is set aside for temporal density, not resolution — INSAT-3D does the same job
  with sub-hourly sampling.
- **Widening the pairing window past 9.5–11.5 h.** At three hours' separation that measures the
  diurnal cycle, which `measure-accuracy.py:264` already warns about.
- **Advection.** The right next major piece of work, and deserving of its own pre-registered
  spec rather than being smuggled in here.
- **Ground truth.** Even a perfect adjudication tells us which instrument to believe, not what
  the surface temperature *is*. That needs in-situ sensors we do not have.

---

## 10 · Additional data sources — verified specs and licence status

Three sources would move the specific numbers in this spec. **Specifications below were
checked against the providers on 2026-08-09**, not recalled — the class of error this whole
document exists to clean up. Where a provider does not state something, it is marked
unresolved rather than assumed.

### 10.1 Licence is the first task, not the last

Standing project rule, learned the hard way: **Open-Meteo and WAQI were both rejected on
licence grounds** after evaluation, for non-commercial clauses. No ingest code is written for
any source below until its terms are read and recorded here.

| source | commercial use | status |
|---|---|---|
| ERA5-Land (Copernicus CDS) | **permitted** | ✅ resolved, terms below |
| Sentinel-3 SLSTR (Copernicus Sentinel) | free, full and open; reproduction/distribution/adaptation granted | ⚠️ **verified but commercial use not stated explicitly** — see §10.3 |
| INSAT-3D/3DR (ISRO MOSDAC) | **not stated in the public policy page** | ❌ **UNRESOLVED — blocking** |

### 10.2 ERA5-Land — attacks the daytime ceiling

**Verified:** `0.1° × 0.1°, native resolution 9 km`, **hourly**, via the Copernicus Climate
Data Store. DOI `10.24381/cds.e2161bac`.

**Licence — resolved.** *Licence to use Copernicus Products*: "free of charge, worldwide,
non-exclusive, royalty free and perpetual", access "for any purpose in so far as it is
lawful", explicitly including reproduction, distribution, adaptation, modification and
combination with other data. Attribution is mandatory and specific — *"Generated using
Copernicus Climate Change Service information [Year]"*, or *"Contains modified Copernicus
Climate Change Service information [Year]"* where adapted — together with a statement that
neither the European Commission nor ECMWF is responsible for any use made of the data. Both
must appear wherever we publish derived figures.

**Why it matters here.** Our own methodology states the daytime limit is *"the resolution of
the weather data driving the model, not the physics inside it"*. We drive on 50 km NASA POWER;
this is 9 km hourly. That is the 1.08 K of headroom between our 4.42 K daytime error and the
3.338 K forcing-imposed ceiling — the single largest addressable component of our weakest
published figure.

### 10.3 Sentinel-3 SLSTR — measures the view-angle hypothesis directly

**Verified:** dual-view by design — "two conical scans, at nadir and oblique, performed by two
independent scan mirrors rotating in opposite directions". Thermal channels (S7–S9, F1, F2) at
**1 km at nadir**; VIS/SWIR at 0.5 km. Revisit **0.9 days mean with two satellites** (1.9 days
with one) in dual-view mode.

**Not verified:** the exact oblique view angle in degrees. Must be read from the product
documentation before any anisotropy correction is derived from it.

**Licence — verified, with one gap I am not going to paper over.** This is the *Copernicus
Sentinel data licence*, a DIFFERENT document from the CDS licence covering ERA5-Land, and I
checked it separately rather than assuming the family matched. It grants "free, full and open
access", and expressly permits "reproduction; distribution; communication to the public;
adaptation, modification and combination with other data", with attribution *"Copernicus
Sentinel data [Year]"* or *"Contains modified Copernicus Sentinel data [Year]"*, and requires
acknowledging the data comes without warranty. **It does not state the word "commercial"
either way** — it permits use "in so far as it is lawful". That is almost certainly permissive
enough, and near-universal industry practice treats it so, but "almost certainly" is not the
standard this project holds itself to on licences. Confirm in writing before shipping anything
derived from it.

**Why it matters here.** §4.1 names view geometry as a leading candidate for the offset —
ECOSTRESS views off-nadir, Landsat near-nadir, and thermal anisotropy over a city of walls,
canopy and street canyons is worth several K. SLSTR observes the *same target at two angles
near-simultaneously*, so it **measures** the angular effect rather than requiring us to infer
it. Nothing else available does that.

### 10.4 INSAT-3D/3DR — structurally solves the coincidence problem

**Verified:** imager thermal channels TIR1 10.3–11.3 µm and TIR2 11.5–12.5 µm at **4 km × 4 km
at the sub-satellite point**, full-disk imaging every **30 minutes**. A published split-window
LST retrieval exists — Singh et al. 2016, *J. Geophys. Res. Atmospheres*,
`10.1002/2016JD024752`.

**Licence — UNRESOLVED and blocking.** The MOSDAC Data Access Policy page defines three tiers
(Anonymous: metadata/imagery/Open Data at near-real-time; Registered General: limited data at
3-day latency; Registered Privileged: all data, near-real-time) but **says nothing about
commercial use or redistribution**. Those terms live in a separate *Data Access Guidelines*
PDF. **Task one is to read that document and record its terms here.** If it carries a
non-commercial clause, this source is out on the same grounds as Open-Meteo, whatever its
scientific merit.

**Why it matters here — and it corrects an argument made earlier.** §2.2 shows ECOSTRESS and
Landsat essentially never coincide over Kolkata. A geostationary sensor sees the same place at
**both** polar orbiters' overpass times **on the same day**, which dissolves the problem rather
than working around it: compare each instrument to INSAT at its own hour, and INSAT's own bias
largely cancels in the difference.

That differencing argument also **weakens the objection I originally raised against MODIS**.
I rejected it on scale mismatch — but when both instruments are compared to the *same* coarse
footprint, the scale error is common to both and cancels; what survives is only the
spatial-heterogeneity × time interaction. INSAT remains the better choice, and the reason is
**temporal density, not resolution**: 30-minute sampling also lets us correct the residual
time offset between passes, which a twice-daily sensor cannot. The correction is recorded here
rather than quietly dropped.

Second benefit, independent of the offset: 30-minute LST **constrains the diurnal shape**,
which is precisely the confounder the §3.2 A-vs-B test exists to detect.

**Caveat to carry.** 4 km pixels are coarser than our 1.4 km wards. That is tolerable for a
*differencing* transfer standard, per the argument above, but INSAT must never be used as a
direct validation reference for ward-mean LST — a different job with a different error budget.

### 10.5 Also worth having, lower priority

**CPCB / IMD station air temperature.** Already vetted as free and usable in prior work. It
gives no LST, but it is ground truth for the *forcing* — the thing §10.2 identifies as our
daytime limiter. Worth ingesting alongside ERA5-Land so the reanalysis can be checked against
stations rather than trusted.

### 10.6 Sequencing

1. **Read the MOSDAC Data Access Guidelines.** Binary gate on §10.4. Record the outcome here.
2. **ERA5-Land.** Highest certain value, licence already clear, attacks the named limiter.
3. **SLSTR**, if §3.2 or the harvest implicates view geometry — it is the instrument that
   settles that question, and pointless before there is a question to settle.
4. **INSAT**, if and only if step 1 clears it.
