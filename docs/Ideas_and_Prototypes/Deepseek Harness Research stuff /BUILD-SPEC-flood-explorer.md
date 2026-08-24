# BUILD SPEC — Flood Explorer & Simulator
**Draft 1.0 · Aug 2026 · Owner: Tech Lead · Status: approved direction**
Cities: **P1a Dubai · P1b European compound-flood demos · P2 Mumbai (second wave)**

---

## 0. Sequencing (locked)

| Wave | City/Region | Why | Launch window |
|---|---|---|---|
| **P1a** | **Dubai (UAE)** | Simplest physics (pure pluvial flash flood); investor/PwC showcase audience; un-owned trauma narrative (Apr-2024, no official mapping ever produced) | Ahead of UAE convective season |
| **P1b** | **European coastal demos** (Amsterdam / Venice / Bucharest) | Compound flooding: EGMS subsidence × sea-level-rise × JRC coastal flood maps; prestige/institutional audience | COP-week or EEA release window |
| **P2** | **Mumbai** | Home-turf story; monsoon calendar guarantees annual spikes; better building data than Dubai (Google OB + 2.5D heights cover India). Harder physics (flat terrain, tides, drainage opacity) | **Pre-monsoon May 2027**, spike season Jun–Sep |

---

## 1. Shared architecture (all cities)

- **Hosting/runtime:** static Astro on Vercel; client-side TypeScript + three.js (WebGL2); MapLibre + OpenFreeMap underlay. **No serverless compute, ever** (Cara/$96k-Vercel-month lesson) — all traffic lands on CDN-cached statics.
- **Hydrology is build-time** (`scripts/*.py` pattern): priority-flood depression filling on the city DEM → per-cell spill elevations + drainage graph → compressed typed-array tiles (Draco/brotli'd). **Engine choice (per `procedural-gen-github-audit.md`): `jblindsay/whitebox-tools` (Rust CLI, MIT ✓, active 2026) primary; `Deltares/pyflwdir` (MIT, Deltares-backed) complement.** ⚠️ pysheds/richdem are GPL-3.0 — internal black-box build-time use only; whitebox keeps the toolchain licence-clean end-to-end.
- **Client interpolates** between precomputed states as users drag sliders (rainfall mm/h, tide stage where applicable). Deterministic, instant, honest.
- **Water rendering:** custom `ShaderMaterial` plane; depth→colour through the legend ramp; **depth sampling grid MUST equal simulation grid** (render may lie about smoothness, never about depth).
- **Share exports are features:** pin-drop depth number → `canvas.toDataURL()` square card; 9:16 animated rise loops via `MediaRecorder` on `canvas.captureStream()`; state-in-URL deep links.
- **Validation tab is first-class UI**, not a footnote: observed-extent overlays toggleable against simulated extents; hit-rate/confusion matrix rendered in-page.
- **Lineage:** every artifact carries `seed + generator_version + input hashes` in the `+delta_lineage` block (extends existing CityJSON extension).

---

## 2. City data matrices

### 2a. Dubai — P1a
| Layer | Source | Licence | Notes |
|---|---|---|---|
| Terrain | Copernicus DEM GLO-30 | Free-full-open. **CDSE registration NOT required — CORRECTED 2026-08-24.** The AWS Open Data mirror (`copernicus-dem-30m.s3.amazonaws.com`) serves the same COGs anonymously and honours HTTP range requests, so a windowed read costs a few hundred kB instead of a 100 MB tile. CDSE is still needed for Sentinel-1. | Backbone. **But see §3a — at 30 m this DSM cannot support fill-spill in flat Dubai.** |
| Buildings (geometry) | Microsoft GlobalML (CDLA-P2.0) ± Overture (ODbL — share-alike caution) | ✓ verified. **Index host CORRECTED: `minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv`; the `bfppub.blob.core.windows.net` path in preflight §9 flag 9 returns 404.** | Google OB v3 excludes ALL GCC states. **Measured: 13,577 GlobalML footprints in the Dubai Creek window at 22.0 % built coverage. OSM has 23,005 in the same box — better coverage, worse licence. Al Ain, where the heaviest rain fell, has NO GlobalML coverage: quadkey 123023311 is absent from the UAE tile list.** |
| Heights prior | DLR WSF3D 90 m raster | CC BY 4.0 ✓ | Only open Gulf height source — coarse; ship honest uncertainty band. **MEASURED 2026-08-24: GlobalML ships a `height` property and for the UAE it is −1.0 on ALL 241,667 footprints in the source tile, so there is no per-building height anywhere in the permissive stack.** OSM carries height/levels on 4.8 % of 23,005 Dubai buildings (1,099 buildings) but is ODbL. |
| Rainfall forcing | ERA5 via CDS | CC BY 4.0 (since 2 Jul 2025) | Build-time only |
| Population | Meta HRSL UAE (HDX) | cc-by ✓ | 30 m per Meta docs |
| Validation ground truth | Self-derived Sentinel-1 extents (CDSE) × Hong 2026 (~23.8 km², PlanetScope/U-Net) × Bersi et al. 2025 (~215 km² Al Ain area, Sentinel-2) | free/open | **Launch narrative: nobody official ever mapped Apr-2024** |
| NEVER depend on | NCM radar · Dubai Pulse · DM geoportal | geo-blocked/closed | Verified externally unreachable |

### 2b. European compound-flood demos — P1b
| Layer | Source | Licence |
|---|---|---|
| Coastal flood prior | JRC river/coastal flood hazard maps (Europe/Med AND global v2.1) | CC BY 4.0, anonymous access ✓ |
| Subsidence | EGMS Ortho/L2a velocities | Free-full-open per Commission Delegated Reg. (EU) 1159/2013; EU Login + token for archive/API (build-time OK) |
| Terrain | GLO-30 | as above |
| SLR scenarios | IPCC AR6 projections (NASA tool data) | open-with-attribution (re-verify at build) |

### 2c. Mumbai — P2 ⚠️ read deltas before starting
| Layer | Source | Licence | Notes |
|---|---|---|---|
| Terrain | Copernicus GLO-30 | Free-full-open | **Flat-city caution:** urban Mumbai sits 0–15 m ASL; GLO-30 vertical RMSE is proportionally catastrophic → propagate DEM vertical uncertainty at build time (Monte Carlo), show depth *ranges* where local slope < threshold |
| ~~DEM alternative~~ | ~~FathomDEM v1-0~~ | **CC BY-NC-SA 4.0 — NON-COMMERCIAL + share-alike. RULED OUT** (verified via Zenodo API 14511570, 23 Aug 2026). Corrects virality report's open-DE-M suggestion | Cross-reference in papers only |
| Terrain cross-check | CartoDEM (ISRO/Bhuvan, ~30 m) | **VERIFY LICENCE before any use** (govt portal, registration) | Optional sanity check only |
| Building footprints | **Google Open Buildings V3 covers India** (already in production for Kolkata twin) + Microsoft GlobalML + Overture (ODbL caution) | CC-BY-4.0-or-ODbL / CDLA-P2.0 | Richer than Dubai's options |
| **Building heights** | **Google Open Buildings 2.5D heights — covers India**, already used for Kolkata | CC-BY-4.0 ✓ | **Better height data than Dubai gets** (real per-building vs 90 m raster) |
| Rainfall forcing | ERA5 (CC BY) ; IMD gridded obs as secondary (**verify IMD licence**) | ERA5 clean | Build-time |
| **Tides (Mumbai-critical)** | Open tide harmonic predictions / UHSLC gauge records | verify station licences | Compound rain×tide forcing is the core Mumbai physics — see §3 |
| Population | Meta HRSL India (cc-by) + GHSL cross-check | cc-by ✓ | Ward denominators |
| Validation | **Jul-2005 event (944 mm/24 h)** via academic SAR mappings (pre-Sentinel era) + recent monsoons (2021, 2023 events) self-derived from Sentinel-1 via CDSE; check for Copernicus EMS activations (likely none for Mumbai → same "nobody mapped it" angle as Dubai) | various-academic | Publish hit-rate per event separately — do NOT pool 2005 with modern events |

---

## 3a. ⚠ DUBAI AT 30 m: FILL-SPILL IS NOISE-DOMINATED — MEASURED 2026-08-24

The architecture in §1 ("priority-flood depression filling → per-cell spill
elevations → drainage graph") was specified before anyone ran it on real Dubai
terrain. Run on the actual GLO-30 window it does not produce a reproducible
answer, and the reason is not the solver.

**The measurement.** Depression structure derived from the bare-earth 256² @ 30 m
grid, then re-derived after adding Gaussian noise *smaller than the sensor's own
stated error* (GLO-30 is ~2–4 m LE90; this window's entire p5–p95 relief is
10.06 m):

| noise σ | depressions | storage | as depth over domain | wet-cell overlap with unperturbed |
|---|---|---|---|---|
| 0.00 m | 1,788 | 19.1 Mm³ | 324 mm | — |
| 0.25 m | 2,569 | 21.1 Mm³ | 358 mm | 0.618 |
| 0.50 m | 3,108 | 25.1 Mm³ | 425 mm | 0.541 |
| 1.00 m | 3,716 | 35.0 Mm³ | 593 mm | 0.453 |
| 2.00 m | 4,058 | 59.4 Mm³ | 1006 mm | 0.374 |

**Two independent reasons this kills the current architecture.**

1. *Irreproducibility.* Half a metre of perturbation — a quarter of the sensor's
   error — changes half the wet cells. At 2 m, still in spec, storage triples.
   The 1,788 "basins" are substantially an artefact of sampling noise, not
   landform. Only 25 hold more than 1 % of storage.
2. *Storage exceeds the design event.* 324 mm of depression storage against
   ~130–230 mm of runoff from the 254.8 mm April-2024 event means the entire
   event disappears into DEM pits and the map renders disconnected puddles. And
   that 324 mm is itself unstable to a factor of three.

**This is the §4 framing tension in the preflight research, now quantified.** That
document already warned that "flat coastal pluvial water largely sheets seaward
rather than ponding in DEM depressions". It does, and 30 m elevation data cannot
resolve the difference.

**What it is NOT.** Not a filtering problem. Buildings are correctly masked out of
the terrain using independent footprints (see `scripts/fetch-dubai-terrain.py`),
and doing so barely moves these numbers. Not a solver problem either — the
Fill-Spill-Merge implementation closes its water budget to single precision.

### 3a.1 RESOLVED 2026-08-25: better data does NOT fix it. The method must change.

Three research lanes plus a direct test settled this.

**Better bare-earth data was obtained and it did not help.** DeltaDTM v1.1 (Pronk
et al. 2024, *Scientific Data*, doi:10.1038/s41597-024-03091-9) is a genuine 30 m
DTM, **CC BY 4.0 — commercially clean**, MAE 0.43 m, tile N25E055 confirmed over
Dubai. Pulled and tested. It reports the real bare-earth relief of this window as
**2.83 m p5–p95**, against GLO-30's 11.52 m — i.e. almost all the DSM's "relief"
was buildings, and our footprint mask had recovered only part of it. And yet:

| σ | GLO-30 masked: overlap | DeltaDTM: overlap |
|---|---|---|
| 0.25 m | 0.618 | 0.542 |
| 0.50 m | 0.541 | **0.459** |
| 1.00 m | 0.453 | 0.400 |

**The real DTM is WORSE**, because relief fell to 2.83 m while the vertical error
did not, so the signal-to-noise ratio dropped. Storage improves (324 → 173 mm)
but remains the same order as the design event's runoff.

This was predicted. Guth et al. 2024 (*Remote Sensing* 16:3273,
doi:10.3390/rs16173273): ML-edited bare-earth DTMs "improve on elevation values,
but … they do not improve overall on the source Copernicus DSM" for **derived**
grids — slope, curvature, stream networks. **A depression hierarchy consumes
morphology, not elevations.** Confirmed here on our own data.

**The ceiling is physical, not statistical.** Fewtrell et al. 2008 (*Hydrol.
Process.* 22:5107, doi:10.1002/hyp.7148): building dimensions and separation
distances "determine maximum possible grid resolutions". Jiang et al. 2022
(doi:10.1016/j.ejrh.2022.101122): error is "magnified considerably when the DEM
resolution was greater than the building width and gaps" — our median building is
19 m and our cell is 30 m. Guo et al. 2021 (*HESS* 25:2843): 30 m "hardly meets
accuracy requirements for urban flood models". And Safaei-Moghadam et al. 2023
(*NHESS* 23:1) — the closest published architecture to ours, a hierarchical
fill-spill depression analysis on roads — required a **1 m bare-earth DEM** and
excluded depressions shallower than 15 cm. At 30 m that threshold is an order of
magnitude below the noise floor.

**Nothing open exists finer than 30 m over Dubai.** OpenTopography holds zero
Arabian-Peninsula point clouds. FABDEM and FathomDEM are both CC BY-NC-SA
(verified at source — the FathomDEM ruling in §2c extends to FABDEM). TanDEM-X
12/30/90 m are all non-commercial; commercial rights sit with Airbus. The only
finer route is paid: Airbus WorldDEM Neo DTM at 5 m, minimum AOI 100 km².

### 3a.2 The decided path

**Terrain:** adopt **DeltaDTM (CC BY 4.0)** as the elevation surface anyway — it
is honest bare earth and its elevations are right, which matters for absolute
water level, coastal interaction and rendering, even though it does not rescue
routing. Keep GLO-30 as the DSM for building-blockage geometry. Fill DeltaDTM's
~17 % above-10 m-MSL mask from GEDTM30 (CC BY 4.0).

**Solver: stop routing on depression topology.** The precedent that works at this
resolution is rain-on-grid 2D routing, not fill-spill: *Urban flood hazard mapping
in Dubai's Hyper-Arid environment* (2025, doi:10.1016/j.teadva.2025.200141) ran
2D HEC-RAS rain-on-grid on ALOS PALSAR (upsampled from 30 m — effectively our
resolution) for this very event and validated at **IoU 0.86** against Landsat-9
NDWI. Note honestly that a 30 m satellite benchmark cannot test street-level
skill, so 0.86 measures agreement on large ponds — which is exactly the skill
class the resolution analysis says is available. Preflight §4 ranked cellular
automata (#3, CADDIES) and RFSM (#2) below fill-spill on build cost; that ranking
was made without testing whether the data could support #1.

**Two mass-balance corrections, both cheap and both cited.** Neither touches
momentum, so both drop into a solver that has none:
- **Storage porosity φ = 1 − BCR** per cell from the footprint raster. For
  un-submerged prismatic obstacles φ collapses to the plan-area void fraction
  (Dewals et al. 2021, *Water* 13:960) — parameter-free, no calibration, no mesh
  sensitivity. Water cannot occupy the building plan area, so the same rainfall
  gives deeper water. Yu & Lane 2006 (doi:10.1002/hyp.5936) show mass blockage
  dominates momentum roughness; Bruwier et al. 2020 show building coverage
  dominates flood severity across 2,000 synthetic urban forms.
- **BCR-weighted roof runoff** — roofs do not infiltrate. Li et al. 2026 (*JFRM*
  19, doi:10.1111/jfr3.70178) is the only found method doing building treatment
  **at 30 m from open data**, reporting 33 % → 85 % accuracy.

**Infiltration is the biggest single lever and ours is badly wrong.** Hussein et
al. 2025 measured a **~7 % runoff ratio** for this event in this hyper-arid
catchment. The shipped prototype produces 51–90 %. In a desert catchment
infiltration dominates the water budget far more than building geometry does.

**Do NOT** burn buildings into the DEM (sub-pixel: the burn amount is undefined,
and GLO-30 was acquired 2011–2015 so post-2015 Dubai is absent while demolished
stock remains — the double-count is spatially heterogeneous and correlated with
construction date). **Do NOT** use Building Resistance — there is no momentum
equation for roughness to act on. **Do NOT** implement integral or dual porosity;
its own 2021 review says "none of the current models is complete".

**Re-scope the claim.** At 30 m this tool can defensibly identify district-scale
ponding hotspots — which areas flood, roughly how deep. It cannot resolve
street-level extent, and that is a physical limit rather than an engineering one.
Validate as the Dubai paper did, against Sentinel-1/Landsat-derived extent for
April 2024, and publish the IoU with an explicit note that a satellite benchmark
cannot test street-level skill.

---

## 3. Mumbai physics deltas (vs Dubai pure-pluvial)

1. **Compound forcing:** inundation = f(rain volume, tide stage, spill topology). Tide slider: neap/spring + storm-surge proxy. Chronic Mumbai flooding is tide-gated — modelling rain alone would be dishonest about annual events.
2. **Drainage opacity (mandatory on-tool disclaimer):** municipal stormwater capacity is invisible to open data; tool shows *pluvial + coastal inundation potential* over natural/spill topology, NOT drain-backup dynamics. Use `/uncertainty` page vocabulary verbatim.
3. **Flat-city error propagation:** DEM vertical uncertainty Monte Carlo at build time → depth-range outputs (p10/p50/p90) wherever slope < threshold; single-depth display only above confidence floor.
4. **Event stratification:** 2005 (extreme outlier) validated separately from chronic monsoon tides regime.

## 4. Political & framing guardrails (Mumbai-specific)

- Lead with the methods/uncertainty page in every public post — First Street × Zillow (Nov 2025, ~73k NC listings removed after accuracy disputes) is the canonical failure we publicly design against.
- Scenario-exploration framing throughout ("planning-grade estimates… not certified engineering"), matching site-wide language.
- No address-level blame narratives; ward-scale aggregates with visible bands.
- Pre-launch legal glance: defamation/valuation-impact risk of named-locality flood scores in Indian media context.

## 5. Procedural layer (cross-city, shared engine)

- **Height-inference priors:** learn footprint→height typology models from validated districts; Kolkata-trained priors transfer to Mumbai morphology directly; separate prior families for GCC (where WSF3D is the training signal).
- **Vegetation palettes:** Konkan coastal ecology set (Mumbai) vs desert-adapted (Dubai/Gulf); L-system growth conditioned on real canopy-volume stats (Meta/WRI canopy map).
- **Streetscape grammar:** WFC-tiled block grammars per city; analog-environment assembly reserved for the Climate-Analog product track.
- **Badge everything synthetic** (`synthetic detail · seed 0x…`) — measured vs generated must be visually distinguishable at all times. Brand rule, not guideline.

## 6. Definition of done (per city)
- [ ] Validation hit-rate published in-page (per event)
- [ ] Vertical-error bands live (flat-city cities: depth ranges)
- [ ] Share card + 9:16 loop exports working offline-first
- [ ] Attribution page regenerated from provenance files (build fails on missing licence entries — existing gate)
- [ ] `/uncertainty` page updated with this city's RMSE/ceiling table
- [ ] Journalist kit: embeddable iframe + caption pack + dataset download
