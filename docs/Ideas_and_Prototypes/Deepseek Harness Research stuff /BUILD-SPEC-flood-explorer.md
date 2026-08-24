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
| Terrain | Copernicus DEM GLO-30 | Free-full-open (CDSE registration) | Backbone |
| Buildings (geometry) | Microsoft GlobalML (CDLA-P2.0, refreshed 2026-08-13) ± Overture buildings (ODbL — share-alike caution on closed derivatives) | ✓ verified | Google OB v3 excludes ALL GCC states |
| Heights prior | DLR WSF3D 90 m raster | CC BY 4.0 ✓ | Only open Gulf height source — coarse; ship honest uncertainty band |
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
