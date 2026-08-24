# Solarpunk Simulation Stack — Delta Climate Research (August 2026)

**Question:** does the audited procedural toolkit power solarpunk simulations?
**Answer: YES — roughly 70% transfers directly.** Terrain, vegetation, hydrology, tile assembly, determinism and delivery all carry over unchanged. The missing 30% (rooftop PV, urban wind, green roofs/walls, urban farms, walkability/transit, biodiversity, energy autonomy) was closed by a dedicated deepsearch pass: **26 paced Firecrawl searches**, **15 research papers (DOIs resolved via Crossref)** and **22+ libraries** (verified via api.github.com while quota lasted, then github.com page metadata cross-checked against shields.io badges).

---

## (1) Direct reuse of the existing procedural toolkit

| Existing piece | Solarpunk role |
|---|---|
| ez-tree + lindenmayer + lowpoly-tree-generator (+ Runions space-colonization, paper A12) | Street trees, pocket forests, planter-constrained canopies → shade & comfort layers |
| pyflwdir / whitebox-tools hydrology | Blue-green infrastructure siting: bioswales, rain gardens, retention parks |
| WFC (kchapelier / ndwfc) | Green-block fabric grammars: mixed-use mid-rise + courtyard gardens as tiles |
| In-house Vanegas OBB parcel splitter | Community-garden plot allocation; lot-scale green-space accounting |
| FastNoiseLite / simplex-noise | Canopy density fields, "green attractiveness" surfaces |
| pure-rand + hash-wasm/noble-hashes | Deterministic scenario seeds — "your district in 2040" replays bit-for-bit |
| 3DTilesRendererJS + maplibre-three-plugin | Delivery unchanged |
| Existing ECOSTRESS thermal overlay product | Before/after greening heat maps — flagship feedback loop |

## (2) Verified libraries for the solarpunk subsystems

### Tier A — adopt (permissive licences, build-time unless noted)
| Library | Lang | Licence | ★ | Pushed | Solarpunk feature | Integration |
|---|---|---|---|---|---|---|
| pvlib/pvlib-python | Python | BSD-3-Clause ✅ | ~1.6k | 2026-08 | Rooftop PV physics → kWp/kWh per roof | `pip install pvlib`; bake into glTF attrs |
| gboeing/osmnx | Python | MIT ✅ | ~5.8k | 2026-07 | Walkability graph, 15-min-city isochrones | Build-time GeoJSON; mind OSM ODbL attribution |
| PyPSA/PyPSA | Python | MIT ✅ | ~2.1k | 2026-08 | Microgrid sizing → self-sufficiency curves | Build-time LP; export Pareto/dispatch JSON |
| oemof/oemof-solph · calliope-project/calliope | Python | MIT ✅ · Apache-2.0 ✅ | ~420/~370 | 2026-07/08 | Alternative energy-system engines (pick one) | Build-time |
| architecture-building-systems/CityEnergyAnalyst | Python | MIT ✅ (per PyPI 3.11.0) | ~270 | active 2026-08 | District UBEM: demand + PV potential + supply optimisation | Batch CLI/docker; heavy deps |
| RWTH-EBC/TEASER | Python | ⚠ disputed: PyPI declares MIT (1.3.1) but repo licence text reads non-standard — confirm before vendoring | ~150 | 2025-12 | Archetype building energy baselines (pre/post-retrofit) | Build-time params JSON |
| NREL/floris | Python | BSD-3-Clause ✅ | ~300 | 2026-06 | Small urban wind siting/yield incl. wakes | Build-time; adapt utility-farm assumptions |
| oemof/windpowerlib · pvlib-family solposx | Python | MIT ✅ · BSD-3-Clause ✅ | — | active | Urban turbine yield; extended solar-position algorithms | Build-time |
| BlinkTagInc/node-gtfs + gtfs-to-geojson (npm `gtfs`, MIT ✅) | Node | MIT ✅ | ~500/~160 | 2026-08 | Trams/light rail: GTFS → route GeoJSON + timetables | Build-time Node script → MapLibre layers |
| ni1o1/pybdshadow | Python | BSD-3-Clause ✅ | ~82 | 2025-03 | Building shadow casting → PV feasibility masks, garden sun-access | Build-time rasters; pin version |
| natcap/invest | Python | Apache-2.0 ✅ | ~250 | 2026-08 | Ecosystem services: urban cooling, carbon, habitat quality, pollination, stormwater | Build-time; GIS-data-hungry |
| mourner/SunCalc (npm suncalc@2.0.1) | JS | BSD-2-Clause ✅ (LICENSE text verified) | ~3.7k | stable | Client-side sun azimuth/elevation → three.js shadows, PV sanity, comfort context | Client-side, tiny, deterministic |
| Kenney.nl assets · Quaternius models (non-GitHub vendors) | 3D packs | CC0 ✅ | — | — | Instant low-poly trees/turbines/city props placeholders | Verify each pack page states CC0 |

### Tier B — build-time black box ONLY (copyleft: incompatible-cautious for closed derivatives)
| Repo | Lang | Licence | ★ | Pushed | Notes |
|---|---|---|---|---|---|
| UMEP-dev/solweig (standalone SOLWEIG) | Rust+Python | GPL-3.0 ⚠ | ~11 | 2026-07 | Tmrt comfort incl. tree shadow. A WASM port would have to ship as a separable open module |
| UMEP-dev/UMEP | Python+C++ | GPL-3.0 ⚠ | ~97 | 2026-06 | Full urban microclimate factory (SOLWEIG, SUEWS, shadows); heavy QGIS dep — offline asset factory only |
| ladybug-tools/uwg (PyPI uwg 5.8.13) · rafatahmed/urbanWeatherGen (dead 2018) | Python | GPL-3.0 ⚠ | ~84/~1 | 2024-10 / 2018 | UHI morphing of EPW weather files → "district X °C cooler after greening" numbers |
| ladybug-tools/ladybug-comfort | Python | AGPL-3.0 ⚠ | ~17 | 2026-08 | UTCI/adaptive comfort classification of baked Tmrt fields |
| USEPA/Stormwater-Management-Model (SWMM) | C | UNKNOWN (US-gov authored; read licence file) ⚠ | ~350 | 2025-02 | LID controls (green roofs, bioswales) → stormwater-retention numbers; check terms before bundling binaries |
| UDST/pandana | Python/C++ | AGPL-3.0 ⚠ | ~420 | 2026-08 | Fast accessibility engine; osmnx covers this permissively — skip |
| farmOS/farmOS | PHP | GPL-2.0 ⚠ | ~1.3k | 2026-08 | Urban-farm data semantics — borrow schema into TS types only |

### Tier C — reference only
- **ualsg/Roofpedia** — NO-LICENSE, stale Nov 2022 (API-verified): green+solar roof ML detection + published dataset. Read method/paper; don't ship code.
- **kristianfoerster/greenroof** — GPL-3.0, tiny (API-verified): physically-based green-roof flow model; port concepts, not code.
- **YiboLi1986/RooftopSolarPanelLayout, ycdrn/segment4pvlayout, hjaiejmeriem/projetIA, bryanbisetti/solar_panels** — student-grade CV panel-placement demos; algorithm references for the in-house layout generator.
- **AKASH2907/project_sunroof_india** — Apache-2.0 ✅ but dormant 2023; Sunroof-style segmentation reference (pairs DeepSolar paper A6).
- **srichs/wind-turbine, MarkShulhin/Wind-turbine-simulator3D** — three.js turbine visuals; style reference only.
- **jasonwebb/morphogenesis-resources** — NO-LICENSE directory (~2.3k★): discovery index for growth algorithms (space colonization, reaction-diffusion); licences live in linked repos.

## (3) Research literature (15 items, DOIs resolved via Crossref)

1. **Bowler et al. 2010**, *Landsc. Urban Plan.* 97(3) — https://doi.org/10.1016/j.landurbplan.2010.05.006 — parks/trees ≈0.9°C mean air-temp cooling vs streets; trees > grass. → ΔT lookup fields around canopy patches.
2. **Ziter et al. 2019**, *PNAS* 116(15) — https://doi.org/10.1073/pnas.1817561116 — cooling jumps nonlinearly at ≥~40% block canopy. → threshold knee in greening-slider response curves.
3. **Lindberg, Holmer & Thorsson 2008**, *Int J Biometeorol* 52 — https://doi.org/10.1007/s00484-008-0162-7 — SOLWEIG: Tmrt from SVF + wall/tree shadows. → bake SVF/shadow rasters from three.js geometry → UTCI comfort layer.
4. **Sailor 2008**, *Energy & Buildings* 40(8) — https://doi.org/10.1016/j.enbuild.2008.02.001 — tractable green-roof energy balance (the EnergyPlus EcoRoof basis). → per-roof surface-temp reduction, cooling savings, retention stats.
5. **Pérez et al. 2017**, *Build. Environ.* 124 — https://doi.org/10.1016/j.buildenv.2017.08.054 — green façade vs living-wall performance ranges. → parametric green-wall module with typology selector.
6. **Wang, Rajagopal et al. 2018 (DeepSolar)**, *Joule* 2(12) — https://doi.org/10.1016/j.joule.2018.11.021 — CNN finds installed PV at scale. → offline "existing PV" mask; remainder × irradiance = untapped potential.
7. **Micallef & van Bussel 2018**, *Energies* 11(9):2204 — https://doi.org/10.3390/en11092204 — honest review of turbulent urban wind. → rooftop siting score with modest capacity factors.
8. **Lovell 2010**, *Sustainability* 2(8):2493–2522 — https://doi.org/10.3390/su2082493 — multifunctional urban-ag suitability framework. → garden/farm multi-criteria placement score.
9. **Moreno et al. 2021 (15-Minute City)**, *Smart Cities* 4(1) — https://doi.org/10.3390/smartcities4010006 — proximity metrics standard. → network isochrones → per-parcel score choropleth.
10. **Baró et al. 2014**, *AMBIO* 43 — https://doi.org/10.1007/s13280-014-0507-x — i-Tree-style PM removal + CO₂ accounting. → per-tree-cohort ES counters.
11. **Koirala et al. 2016**, *Renew. Sustain. Energy Rev.* 59 — https://doi.org/10.1016/j.rser.2015.11.080 — community-energy KPIs: self-consumption & self-sufficiency ratios. → the energy-autonomy loop metric pair.
12. **Runions, Lane & Prusinkiewicz 2007** — https://algorithmicbotany.org/papers/colonization.egwnp2007.html — space-colonization tree modelling. → constrained low-poly tree generation beside your L-system trees.
13. **Lodi-Ribeiro (ed.) 2012 / English ed. 2018 — Solarpunk anthology** (no DOI) — WorldCat: https://www.worldcat.org/search?q=solarpunk+historias+ecologicas — founding fiction; tone bible/art direction.
14. **Reina-Rozo 2021**, *IJESJP* 8(1):55–68 — https://ojs.library.queensu.ca/index.php/IJESJP/article/view/14292 — first academic framing of solarpunk as art/energy/tech praxis; citable anchor.
15. **Flynn 2014 — Solarpunk: Notes toward a manifesto** — https://hieroglyph.asu.edu/2014/09/solarpunk-notes-toward-a-manifesto/ — design-values checklist mapped to mechanics (visible energy flows, retrofit optimism, commons).

## (4) Adoption order
1. **Quick wins (permissive, pure build-time):** osmnx + node-gtfs/gtfs-to-geojson (walkability + tram layers) → pvlib + pybdshadow (PV potential/shade masks) → FLORIS + windpowerlib (small-wind scoring).
2. **Comfort & heat loop:** UMEP/SOLWEIG + ladybug-comfort baked rasters (GPL/AGPL as offline factories) + Bowler/Ziter response curves + suncalc-driven live shadows client-side.
3. **Greenery economics:** Sailor green-roof balance + Pérez typologies + SWMM retention → per-feature stat cards.
4. **Autonomy loop:** PyPSA (or Calliope YAML scenarios) computing Koirala self-sufficiency/self-consumption ratios per district.
5. **Ecosystems/biodiversity:** InVEST urban-cooling/carbon/habitat passes feeding Baró-style counters.
6. **Look & feel:** space-colonization trees replacing Kenney/Quaternius CC0 placeholders toward the Art-Nouveau×sustainable-tech art direction (anthology A13/A14/A15 for tone).

## Method & caveats
- Two independent channels: parent-agent api.github.com verifications (51 repos prior audit + 5 solarpunk repos) and deepsearch-agent github.com-page/shields.io checks (22 repos) after the shared unauthenticated API pool hit zero mid-run.
- Star counts are point-in-time approximations (2026-08-23); where channels disagreed (TEASER licence), the discrepancy is stated explicitly rather than averaged.
- Papers: DOIs resolved through api.crossref.org this session; two URLs (MDPI open-access, Runions) confirmed directly. Solarpunk canon items are books/essays without DOI by nature.
