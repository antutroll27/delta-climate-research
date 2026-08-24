# PREFLIGHT RESEARCH — Flood Simulator P1a (Dubai)
**Date: 24 Aug 2026 · Method: 4 delegated research lanes (Firecrawl CLI) · Purpose: harden the fact base before design work — event science, validation methodology, build-time simulation methods, rendering SOTA, market/data currency.**
**Relationship to `FINAL-refined-audit.md`: that file remains authoritative for all previously verified claims. This file records only NEW findings. Tiers: [P] primary-verified · [S] single-reputable-secondary · [N] not verified / absent. Access dates 23–24 Aug 2026.**

---

## 1. Event science — April 2024 UAE floods (new findings)

1. **World Weather Attribution ran a formal probabilistic attribution of the event** (21 researchers, DOI 10.25561/110910): observations say the rain was **10–40% more intense** than the same event in a 1.2 °C-cooler climate; climate models showed **no consistent trend** — WWA explicitly declined to attribute intensity to climate change with certainty; **cloud seeding had no significant influence** (no seeding reported; moisture availability was the anomaly). https://www.worldweatherattribution.org/heavy-precipitation-hitting-vulnerable-communities-in-the-uae-and-oman-becoming-an-increasing-threat-as-the-climate-warms/ · [P] → uncertainty bands can honestly say "observations suggest intensification, models inconclusive."
2. **Peer-reviewed detection-attribution follow-up** (npj Climate & Atmospheric Science, DOI 10.1038/s41612-025-01073-1, "From cause to consequence"): IMERG reference **189 mm/day**; return period **~333 yr present vs ~9,981 yr counterfactual**; **probability ratio 30 (95% CI 3–10,716)** — frequency increase attributable, intensity change (+56 mm, CI −156 to +94 mm) not distinguishable; mechanism = PV streamer + 500-hPa cut-off low + Red Sea Trough + tropical Indian Ocean moisture (IVT top 0.1% of climatology); extreme spring rain more likely in El Niño years. https://www.nature.com/articles/s41612-025-01073-1 · [P] → canonical citation for "more likely, not provably more intense."
3. **Dynamics decomposition** (Environ. Res. Lett., DOI 10.1088/1748-9326/ae3096): a single MCS on 16 April delivered **>70% of total event rainfall**; Somali LLJ × Arabian Cold Vortex convergence ≈ **0.006% of days 1940–2024**; cites UAE economic damages > USD 544 M and 4 fatalities (see §10). https://iopscience.iop.org/article/10.1088/1748-9326/ae3096/pdf · [P] → rainfall scenarios should be convective-cell-scale (MCS), not synoptic-uniform.
4. **BAMS paper frames the event as a record atmospheric river**: 15–17 Apr rainfall >100 mm in hardest-hit areas, **>170% of typical annual rainfall in 72 h**. https://journals.ametsoc.org/view/journals/bams/107/8/BAMS-D-26-0052.1.xml · [S]
5. **Fourth independent event analysis** (Sci. Rep., s41598-026-53055-9): deep mid-tropospheric trough/cut-off low with strong upper-level divergence. https://www.nature.com/articles/s41598-026-53055-9 · [S] → cut-off-low driver corroborated across independent teams.
6. **Hussein et al. 2025 (Natural Hazards, DOI 10.1007/s11069-025-07156-9) is THE hydrologic simulation of the event** — GSSHA physically-based model, 2,216 km² Al Ain watershed, NCM 15-min gauges + IMERG: Dubai **>142 mm/24 h vs 94.7 mm annual average (DXB)**; Khatm al-Shakla 254.8 mm = **60–75% of PMP** (Sherif et al. 2013); station return periods: Rowdah 750 yr / Al Qattara 1,200 yr / Raknah 1,250 yr / Khatm al-Shakla ~20,000 yr; **runoff only ~6.4% of rainfall volume**; three rain pulses 6–8 h apart reduced peak flow vs single downpour; satellite-driven runs amplified rainfall error into flood severity. https://link.springer.com/article/10.1007/s11069-025-07156-9 · [P] → best build-time calibration target: infiltration losses, storm temporal structure, error propagation.
7. **Insured-loss triangulation (four primary/broker sources)**: Munich Re — UAE total losses **US$ 8.3 bn, US$ 2.8 bn insured** (Jan 2025) https://www.munichre.com/en/company/media-relations/media-information-and-corporate-news/media-information/2025/natural-disaster-figures-2024.html [P]; Guy Carpenter — insured **> USD 2.9 bn, up to 3.4 bn**, motor ~10% (Sep 2024) https://www.guycarp.com/insights/2024/09/post-event-report-gulf-floods-update-september-2024.html [P]; Gallagher Re — **USD 1.8–2.3 bn** property-market insured loss https://www.artemis.bm/news/uae-flooding-property-insurance-loss-seen-up-to-us-2-3bn-by-gallagher-re/ [S]; Swiss Re — **~USD 8 bn economic losses, "most expensive insurance loss event ever" for the UAE** https://www.swissre.com/reinsurance/events/emea-flood-webinar-2025.html [P]. Early trade estimates (~USD 850 M, 30–50k vehicles) were far lower. → the 0.85 → 1.8–3.4 bn revision history is a ready-made in-tool exhibit of estimate convergence (error-bar culture).
8. **Cloud-seeding causation formally dismissed twice**: NCM (no seeding ops during event) + WWA (mechanism: moisture availability, not condensation nuclei). https://www.nbcnews.com/science/environment/dubai-united-arab-emirates-cloud-seeding-rain-floods-rcna148263 [S] + WWA [P] → provenance card kills the viral narrative with two independent sources.
9. **More independent mappings for the validation tab** (beyond Hong 2026, Bersi 2025): Almansoori et al. (Zayed Univ., ISPRS XLVIII-4-W18-2025 — PlanetScope/NDVI, South Dubai vegetation impact) https://isprs-archives.copernicus.org/articles/XLVIII-4-W18-2025/43/2026/isprs-archives-XLVIII-4-W18-2025-43-2026.html; HEC-HMS remote-sensing-driven Dubai flood modelling https://pmc.ncbi.nlm.nih.gov/articles/PMC11500338/; Alhosani et al. "From Sandstorms to Deluges" (GNHR — source of the return-period ladder); J. Arid Environ. summer-2022 wadi flash floods as regional analogue https://www.sciencedirect.com/science/article/abs/pii/S0140196323000848 · [P/S]
   - **Notable absence: no peer-reviewed Sentinel-1-derived flood-extent mapping of the Dubai Apr-2024 event surfaced** — our self-derived S1 extent fills a real gap. Strengthens the launch narrative.

## 2. Validation metrics canon (truth-mode tab vocabulary)

10. **CSI canon**: Schaefer 1990, *Weather and Forecasting* 5(4):570–575, DOI 10.1175/1520-0434(1990)005<0570:TCSIAA>2.0.CO;2 · [P]
11. **POD/FAR canon**: Wilks, *Statistical Methods in the Atmospheric Sciences*; terminology guardrail — Barnes et al. 2009 corrigendum *"False Alarm Rate or False Alarm Ratio?"* (WF 24): **FAR (ratio) = false alarms ÷ all warnings**, distinct from POFD. https://journals.ametsoc.org/view/journals/wefo/24/5/2009waf2222300_1.xml · [P] → label the column "false-alarm ratio", never "false alarm rate."
12. **Benchmark context**: modern national-scale inundation models reach **CSI 0.65–0.82** (Bates et al. 2023 NHESS 0.65–0.76; Bates et al. 2021 WRR 0.69–0.82); lineage Bates & De Roo 2000; Horritt & Bates 2002; Aronica et al. 2002. https://nhess.copernicus.org/articles/23/891/2023/ · [S/P] → show users what "good" looks like before they judge our map.
13. **Mandatory caveat citation**: Stephens et al. 2014, *"Problems with binary pattern measures for flood model evaluation"*, Hydrol. Process. 28, DOI 10.1002/hyp.9979 — binary metrics are inconsistent across flood sizes; **CSI biased toward overprediction and toward flat terrain**; complement with elevation/water-level checks. Successors: Landwehr et al. 2024 (RSE); Cohen et al. 2025 (WRR 10.1029/2024WR039574). https://onlinelibrary.wiley.com/doi/10.1002/hyp.9979 · [P/S] → display CSI/F1/POD/FAR **plus** an explicit binary-metric-caveat footnote citing Stephens 2014. That footnote IS the brand. **Optimal Index dropped** (canonical source never verified).

## 3. UAE pluvial dynamics (simulation honesty inputs)

14. **Runoff coefficient is tiny — ≤6.4% of the 254.8-mm-class event became outlet runoff** (infiltration-dominated desert watershed; multi-pulse structure lowered peaks further) [P, §1.6] → default infiltration parameterization must be deep-loss (Green-Ampt-style), never saturation-excess.
15. **Wadi geometry organizes risk** — low-infiltration wadi courses concentrate runoff; settlements historically cluster around them; 2022 mountain-wadi floods hit urban coastal plains [P/S] → depth layer must follow the wadi/drainage skeleton, not uniform ponding.
16. **Urban drainage context (official)**: **Tasreef — AED 30 bn (~US$8 bn), approved by Sheikh Mohammed bin Rashid** https://www.wam.ae/en/article/b3ts1zx-mohammed-bin-rashid-approves-aed30-billion-tasreef [P]; capacity raised to **>20 M m³/day (+700%)**; Dubai Municipality awarded **AED 1.439 bn** contracts across four phases, Phase 2 serves ~3 M residents across 30 areas; emirate-wide coverage targeted **by 2033** https://www.dm.gov.ae/aed-1-439-billion-contracts-awarded-for-four-tasreef-project-phases/ [P] → a "pre-Tasreef drainage" toggle with stated capacity assumptions keeps the counterfactual honest; the government is spending ~8× the insured loss on mitigation — a tool showing where water goes is directly decision-relevant to that spend.
17. **Storm climatology**: MAM organized convection is the flood season, modulated by ENSO (El Niño springs wetter), Red Sea Trough, subtropical jet; observed spring precip trend 1976–2014 significant, CMIP6 trend insignificant [P, §1.2] → stochastic event selector conditioned on MAM + ENSO state.
18. **Desert soils**: sandy with biological crusts; arid water-repellency develops in dry spells, diminishes after rain — plausible first-flush intensifier, **no UAE-event quantification exists** [S/N] → if a hydrophobic-first-flush parameter ships, label it exploratory.

## 4. Simulation method ranking (build-time pipeline)

| Rank | Method | Defensibility | Build cost | Client cost | Key citation |
|---|---|---|---|---|---|
| 1 | Priority-flood fill-spill + per-depression stage-volume curves, FSM depression hierarchy (= decided architecture) | High — published lineage | Low-med (MIT code exists) | Trivial (lerp K snapshots) | Barnes, Callaghan & Wickert 2021, *ESurf* 9:105–131, DOI 10.5194/esurf-9-105-2021, https://esurf.copernicus.org/articles/9/105/2021/ [P]; Wu et al. 2021 GWDW, *JAMES*, DOI 10.1029/2020MS002362 [P] |
| 2 | RFSM/VAAP volume spreading over impact zones | High — national-risk-industry standard; **also wets freely-draining terrain** | Med | Trivial | Krupka/Sayers 2007 IAHR; Lhomme et al. 2020 HR Wallingford HRPP361, https://eprints.hrwallingford.com/695/1/HRPP361-Recent_development_and_application_of_a_rapid_flood_spreading_method.pdf [P] |
| 3 | Cellular automata (CADDIES `caflood`) | Med-high — pluvial-specific, SWE-validated | Med | Low-med | Guidolin et al. 2016, *EMS*, DOI 10.1016/j.envsoft.2016.07.008 [P] |
| 4 | Subgrid/simple-inertial SWE (LISFLOOD-FP style) | Highest physics credibility | High + licence friction | Trivial | Bates, Horritt & Fewtrell 2010, DOI 10.1016/j.jhydrol.2010.03.027; Neal et al. 2012, DOI 10.1029/2012WR012514 [P] |
| 5 | HAND/TWI static indices | Medium (proxy, not depth) | Very low (in pyflwdir) | Trivial | Nobre et al. 2016 via pyflwdir [P] |

**Recommended shape:** #1 core (exactly the decided architecture, now with published lineage) + #5 free QA overlay + #2/#3 as documented upgrade path if reviewers object that fill-spill misses sheet-flow ponding; #4 as offline validation oracle only. 2026 review defending breach/fill-spill over naive sink filling: https://link.springer.com/article/10.1007/s12665-026-12971-9 [S].

**⚠ Framing tension (surfaced, not hidden):** pure fill-spill floods only closed/spill-connected depressions; the RFSM/CA literature shows flat coastal pluvial water largely **sheets seaward** rather than ponding in DEM depressions. Keep the "inundation POTENTIAL over natural/spill topology — NOT drain dynamics" disclaimer tight, and consider an RFSM-style spreading mode for the flat coastal strip.

## 5. Toolkit (licences verified from repos, 24 Aug 2026)

| Library | Repo | Licence | Version/activity | Role |
|---|---|---|---|---|
| whitebox-tools | github.com/jblindsay/whitebox-tools | MIT (LICENSE.txt, © J. Lindsay) | v2.4.0 (2024-05-22) tag; commits → 2026-05; 1,192★ | Breach-least-cost, D8/D∞ accumulation, TWI, `DepthInSink`, `DepthToWater` (DTW). **No tool named "depth-in-to-depression"** — use real names |
| pyflwdir | github.com/Deltares/pyflwdir | MIT (© Deltares) | v0.5.12 (2026-07-01); pushed 2026-08-21 | Priority-flood fill (Wang & Liu 2006), D8 graph, HAND, floodplains in one dependency-light lib |
| FillSpillMerge | github.com/r-barnes/Barnes2020-FillSpillMerge | MIT | v1.0.0 (2020); pushed 2024-05 | Depression-hierarchy reference impl (§4 #1) |
| CADDIES `caflood` | github.com/FluiditLtd/caddies-caflood (fork: WaterDesk/caflood) | MIT (© Exeter CWS) — **caflood component only** | pushed 2024-05 / 2025-02 | CA pluvial reference / upgrade path |
| PMTiles | github.com/protomaps/pmtiles | BSD-3 impls, CC0 spec | active | Single-file CDN tile archive, HTTP range requests |
| three.js post stack | SSRPass / GTAOPass / UnrealBloomPass built in; PCSS via gkjohnson/threejs-sandbox (MIT); god-rays via Ameobea/three-good-godrays (custom free, commercial OK) | MIT unless noted | current 2026 | Cinematic tier — see §7 |
| 3D Tiles / point clouds | NASA-AMMOS/3DTilesRendererJS (Apache-2.0, v0.5.1 Aug 2026); Potree (BSD-2, 1.8.2 Dec 2023, master active) | verified | active | Measured/scan tier container |
| LISFLOOD-FP | (official) | **NOT OSI-verifiable (mirrors: NOASSERTION)** | — | Cite, never embed |
| TopoToolbox family | github.com/TopoToolbox/topotoolbox3 | GPL-3.0 (MATLAB variant: no licence file — treat as copyleft) | active 2026-07 | Internal black-box build-time only |

## 6. Data delivery & client interpolation

- **Draco is the wrong tool for depth grids**: it targets meshes/point clouds; no published evidence it beats quantized typed arrays on gridded floats; decode is slow in-browser. https://github.com/google/draco, https://cesium.com/blog/2019/02/26/draco-point-clouds/ [S] → **ship uint16/delta-quantized typed arrays + brotli** (native CDN Content-Encoding, zero JS decoder, direct DataTexture upload). Draco only if water-surface *meshes* ship later.
- **CDN raster patterns**: PMTiles single-file range-request archives (BSD-3/CC0) work for raster/terrain and load in three.js; terrarium-style quantized-image encoding (tilezen joerd lineage) is precedent. COG/zarr possible but need geotiff.js/zarr.js range plumbing.
- **Snapshot interpolation prior art is generic**: dual DataTextures + shader `mix()` lerp (mapbox/webgl-wind MIT, cambecc/earth MIT) — no flood-specific prior art exists. Enforce **physical monotonicity** against per-depression stage-volume curves (depth can only rise with rainfall within a depression cascade).

## 7. Rendering — cinematic tier + measured/scan tier (three.js, 2025–26)

**Cinematic tier recipe (all effects independently toggleable = the ON/OFF tier):**

| Effect | Technique | Source | Licence | Caveat |
|---|---|---|---|---|
| SSR on water | three.js `SSRPass`, half-res buffer, water-plane mask | threejs.org/docs/pages/PostProcessing.html | MIT | Full-res SSR blows the budget |
| Water shading | Custom ShaderMaterial: scene-depth texture → depth→colour ramp + multi-level refraction | discourse.threejs.org/t/better-water-with-refraction/86523; Water.js reference-only | MIT | Analytic wave normals, not FFT |
| Soft shadows | PCSS variable-penumbra + contact hardening; CSM at city scale | gkjohnson.github.io/threejs-sandbox/pcss/ | MIT | Penumbra ↑ = taps ↑; clamp at low sun |
| AO | `GTAOPass` + denoise (prefer over SSAOPass) | threejs.org/examples/webgl_postprocessing_gtao.html | MIT | Normal prepass + denoise; drop in OFF tier |
| Bloom | `UnrealBloomPass` at half-res | threejs.org official example | MIT | ~1–2 ms @1080p; don't stack with full-res SSR |
| Rain | Instanced point-sprite streaks + `three-good-godrays` shafts (r182-ready) | github.com/Ameobea/three-good-godrays | Custom free (commercial OK) | Screen-space radial blur; no true volumetrics in WebGL2 |

- Budget guidance: SSR+GTAO+PCSS+bloom together ≈ the realistic 60 fps ceiling at 1080–1440p on M-series/mid Windows with dynamic-res headroom. **No published cross-GPU benchmarks exist — validate in a perf harness before promising anything.**
- **WebGPU path tracing stays an R&D flag** (honest client line): three-gpu-pathtracer is pre-1.0 (v0.0.24, 2026-02), progressive accumulation on static scenes — *"a research preview, not shippable interactivity."* https://github.com/gkjohnson/three-gpu-pathtracer [P]
- **Measured/scan tier**: style it, don't buy it — `THREE.Points`/glTF POINTS with a custom unlit shader (fixed-size round sprites, monochrome ramp, no lights, no AA) = deliberately raw vs cinematic layer; container = OGC 3D Tiles via 3DTilesRendererJS if tiled; Potree only for massive raw LiDAR. MapLibre↔three.js via official custom-layer pattern or dvt3d/maplibre-three-plugin (Apache-2.0, v1.5.0 Feb 2026). **Avoid threebox (archived 2021, Mapbox-coupled).**
- **HUD cards**: CSS2DRenderer or own `Vector3.project(camera)` anchoring (what CSS2DRenderer does internally); occlusion must be hand-rolled (raycast/depth readback). DOM cards stay crisp + selectable = researcher-friendly.
- **Version pinning caution**: r183-era `RenderPipeline` composer migration chatter [S, single third-party guide] — pin a three.js version now; verify before adopting.

## 8. Market & data currency (investor lane, 24 Aug 2026)

**Funding landscape (why-now / whitespace inputs):**
1. **ICEYE raised ~€1 B (Jun 2026, General Atlantic-led) at >€10 B valuation** — SAR flood intelligence sold to insurers; also $158 M during 2024. https://www.iceye.com/newsroom/press-releases/iceye-leads-a-new-era-of-sovereign-intelligence-from-space-with-1b-funding-round · [P/S] → investors pay unicorn prices for exactly the sensing modality our free tool democratizes.
2. **MSCI acquired First Street (announced + completed Jun 2026)** — property-level physical climate risk embedded into institutional workflows. https://www.msci.com/discover-msci/media-room/msci-acquires-first-street-to-enhance-physical-climate-risk-capabilities-for-financial-decision-making · [P/S] → the marquee exit; incumbents buy rather than build; sharpens open-data counter-positioning.
3. **Jupiter Intelligence $54 M Series C, ~$100 M total** — premium "investment-grade" analytics end. [P]
4. **Floodbase ~$17 M lifetime ($12 M A + $5 M extension Feb 2025)** — closest mission-alignment comp; tiny war-chest vs ICEYE = whitespace. [P/S]
5. **ClimateAI $22 M Series B / $38 M total; One Concern ~$120 M (last round 2021) + Swiss Re partnership (2023)** — adjacent segments; late-stage consolidation, not early-stage crowding. [P/N]
6. **Global insured nat-cat losses > USD 100 B in 2024 — 5th consecutive year** (Swiss Re Institute). [P]

**UAE economics & policy:**
7. **Apr-2024 = costliest insurance event in UAE history** — Gallagher Re $1.8–2.3 B / Guy Carpenter $2.9–3.4 B insured / Swiss Re ~$8 B economic. The spread itself argues for independent open reconstruction.
8. **Tasreef**: AED 30 bn approved; >20 M m³/day (+700%); AED 1.439 bn contracts in four phases; emirate-wide by 2033 (see §3.16).
9. **ALTÉRRA — $30 B UAE climate-investment fund (COP28 legacy), targeting $250 B mobilized by 2030** — the natural first door for a UAE investor pitch. https://www.alterra.ae/ · [P/S]

**Whitespace paragraph (pitch-grade, every claim traceable to findings above):**

> Capital is flooding into physical climate risk, but almost all of it buys closed, expensive platforms: ICEYE just raised ~€1 B at a >€10 B valuation selling SAR flood intelligence to insurers [1], MSCI paid to embed First Street's property-level risk into institutional workflows [2], and Jupiter holds ~$100 M selling "investment-grade" analytics [3] — yet the flood-specialist closest to our mission, Floodbase, operates on ~$17 M lifetime funding [4]. Meanwhile the April 2024 Gulf floods became the UAE's costliest insured event ever — $1.8–3.4 B insured, ~$8 B economic [7] — and nobody has published an independent, reproducible map of what actually flooded; Dubai is responding with AED 30 B (~US$8 B) of Tasreef drainage investment through 2033 [8] based on exactly the kind of hazard understanding our tool makes inspectable. We occupy the gap between billion-dollar black boxes and zero public accountability: a static-site, zero-serverless 3D explorer built entirely on open data (Sentinel-1, Copernicus GLO-30, Microsoft GlobalML footprints, Meta HRSL) that publishes its own hit-rate. And the first check we write to should be local — ALTÉRRA, the UAE's $30 B COP28-legacy fund, is chartered to deploy into precisely this kind of climate technology [9].

**Data currency table:**

| Source | Status today | Action needed |
|---|---|---|
| Sentinel-1 via CDSE | Operational; S1C live since Jan 2025, S1D launched 4 Nov 2025 and operational; S1A anomaly 16–17 Nov 2025 lost acquisitions permanently; S1A retirement ~Jun 2026 | Use S1C/S1D for ongoing monitoring; **document that April 2024 scenes are S1A-only (no redundancy then)**; check CDSE news feed before batch downloads. No firm Sentinel-1NG launch date exists — don't quote one |
| Copernicus GLO-30 | Free worldwide; newest mirrored edition **2024_1** (no 2025 edition found; OpenTopography still serves 2023_1) | Pin edition (recommend 2024_1) in pipeline config + methodology page for reproducibility |
| Microsoft GlobalML footprints | 2026-08-13 refresh **confirmed verbatim** in official README (1,945/30,340 tiles updated); **hosting migrated 2026-07-24 to `bfppub.blob.core.windows.net`** — old mined-buildings URLs deprecated | Update download URLs; re-pull UAE tiles; cite CDLA-Permissive-2.0 |
| Meta HRSL UAE (HDX) | Live, CC BY, 15 resources — but **2020-vintage population raster**; dataset slug is the long form `united-arab-emirates-high-resolution-population-density-maps-demographic-estimates` | Use for exposure context, not precise counts; consider WorldPop (also HDX) as newer alternative |
| Overture buildings | Theme releasing monthly; **no explicit UAE coverage statement found** | Run a UAE bbox query against latest release before relying on it; fallback = GlobalML + OSM |

## 9. Spec flags (touch BUILD-SPEC — logged for client/tech-lead decision, nothing changed unilaterally)

1. **§1 "Draco/brotli'd typed-array tiles"** → refine to "uint16/delta-quantized typed arrays + brotli (CDN Content-Encoding); Draco reserved for future water-surface meshes." (§6)
2. **§1 engine note** → no whitebox tool named "depth-in-to-depression"; real names `DepthInSink` / `DepthToWater`. Don't claim recent WBT releases (last tag v2.4.0, May 2024; commits continue). (§5)
3. **Fill-spill vs sheet-flow** → keep the POTENTIAL-not-drains disclaimer tight; evaluate an RFSM-style spreading mode for the flat coastal strip; LISFLOOD-FP as offline oracle only (licence NOASSERTION). (§4)
4. **Truth-mode tab** → metrics = CSI/F1/POD/FAR with Barnes 2009 terminology guardrail, benchmark context (national models 0.65–0.82), mandatory Stephens 2014 caveat footnote; drop Optimal Index. (§2)
5. **Infiltration default** → deep-loss/Green-Ampt; calibration anchor: runoff ≈ 6.4% of event rainfall (Hussein 2025). (§3.14)
6. **Rainfall scenarios** → convective-cell-scale (single-MCS >70% of event rain), MAM+ENSO conditioning, atmospheric-river framing available. (§1.3/§3.17)
7. **Drainage counterfactual** → optional "pre-Tasreef drainage" toggle with stated capacity assumptions (AED 30 bn programme, official). (§3.16)
8. **Error-bar exhibit** → insured-loss revision history (0.85 → 1.8–3.4 bn USD across four sources) as an in-tool provenance card. (§1.7)
9. **GlobalML hosting migration** → ~~pipeline download URLs must move to `bfppub.blob.core.windows.net`~~ **WRONG — CORRECTED 2026-08-24 by probe. That host returns 404 for the dataset index. The live index is `https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv`, taken from the project README. Release in use: 2026-02-03. The CSV column is `Location`, not `RegionName`.** (§8)
10. **GLO-30 edition pinning** → pin 2024_1 (or newest at build) in lineage/methodology for reproducibility. (§8)
11. **Exposure layer vintage** → HRSL UAE is 2020-vintage; state the caveat on population cards; consider WorldPop cross-check. (§8)
12. **Validation scenes** → April 2024 imagery is S1A-only (document as single-scene caveat); ongoing monitoring benefits from S1C/S1D denser revisit. (§8)
13. **Overture UAE** → empirical bbox test before any reliance; GlobalML + OSM is the safe fallback. (§8) **Test run 2026-08-24 — see §12.**

## 12. Measured findings that supersede the flags above (2026-08-24)

Everything here came from probing the actual endpoints, not from reading
documentation. Each of the corrections below was a claim the spec asserted with
confidence and got wrong, which is the pattern worth noticing more than any one
error: **the failure mode is a search result that looks like a citation.**

- **GLO-30 needs no CDSE account.** BUILD-SPEC §2a said "CDSE registration". The
  AWS Open Data mirror serves identical COGs anonymously with working HTTP range
  requests. A windowed read is a few hundred kB against a 100 MB tile.
- **GlobalML ships NO heights for the UAE.** The `height` property is −1.0 on all
  241,667 footprints in the source tile. Nobody had checked; the spec's "heights
  approximated from WSF3D" was right by accident, not by verification.
- **Al Ain has no GlobalML coverage at all** (quadkey 123023311 absent). That is
  the location of the 254.8 mm peak and the whole launch narrative.
- **OSM has better footprint coverage than GlobalML here** — 23,005 buildings vs
  13,577 in the same window — but only 4.8 % carry height or levels (1,099
  buildings, median 35 m), and it is ODbL.
- **Overture bbox test RUN (flag 13 discharged).** 24,109 buildings in the Dubai
  Creek window — 78 % more than GlobalML's 13,577 — but the contributing datasets
  are exactly `['Microsoft ML Buildings', 'OpenStreetMap']`, so the extra ~10,500
  buildings ARE the OSM ones and carry ODbL share-alike. Heights are equally
  sparse: 476 with `height` (2.0 %), 862 with `num_floors` (3.6 %), median 35 m,
  max 317 m. Since Microsoft ships no heights for the UAE at all, **every height
  in Overture's Dubai coverage is OSM-derived and therefore ODbL.** The trade is
  explicit: +78 % footprints and the only per-building heights available, against
  share-alike on a closed commercial derivative. Filtering Overture to its
  Microsoft-sourced subset is licence-clean but returns us to the GlobalML set
  with no heights, i.e. no gain.
- **Fill-spill is noise-dominated on 30 m Dubai terrain.** See BUILD-SPEC §3a for
  the sensitivity table. This supersedes the §4 method ranking for Dubai: rank 1
  (fill-spill) was chosen on defensibility and build cost, without testing
  whether the input data could support it.

## 10. Discrepancies to surface as error bars (never hide)

- **Fatalities**: 4 (ERL) vs 5 confirmed (Hussein et al./Gulf News).
- **Damage magnitude**: USD 544 M "economic damages" (ERL) vs US$ 8.3 bn total / 1.8–3.4 bn insured (Munich Re/Guy Carpenter/Gallagher Re) — different scopes/timing; tag the 544 M figure with provenance or drop it.
- **Attribution strength**: WWA's own headline is "10–40% more intense, models inconclusive"; the npj re-analysis reports PR=30 (CI 3–10,716) and summarizes WWA differently — quote each from its own primary page, never second-hand.
- **Rainfall figure**: 254 vs 256 mm drift in secondary coverage — 254.8 mm (Khatm Al Shakla) is the precise value.

## 11. Absent-evidence register (do not cite as fact)

- No peer-reviewed **Sentinel-1-derived** flood-extent mapping of the Apr-2024 Dubai event (our self-derived S1 extent fills a real gap).
- No cross-GPU benchmark for SSRPass/GTAOPass/UnrealBloomPass frame times (perf numbers are engineering estimates pending a perf harness).
- No Draco-vs-brotli benchmark on gridded float fields.
- No browser-side flood-snapshot-morphing prior art (generic texture-lerp only).
- No maintained standalone GWDW implementation repo.
- No peer-reviewed validation of fill-spill pluvial potential for arid coastal cities (GWDW validated on an Indiana watershed).
- No UAE-specific quantified soil-hydrophobicity effect on pluvial runoff.
- No Lloyd's-specific loss figure for the event (Gallagher Re/Guy Carpenter/Munich Re/Swiss Re cover the spread).
- **Fathom**: no funding/M&A news 2024–2026 surfaced (commercial business opaque). **Cervest/Regrow**: nothing retrieved. **One Concern/ClimateAI**: no rounds after 2021/2023 — absence of news, not confirmation of dormancy.
- **ICEYE Series E (~$175 M, Dec 2025) and $283 M 2025 revenue**: aggregator-only — [N], do not pitch without primary confirmation.
- **Sentinel-1NG launch date**: no firm primary-source date — avoid quoting an NG timeline.
- **Tasreef phase-level schedule** beyond "emirate-wide by 2033": detail pages geo-blocked from research environment; needs manual check.
- **GLO-30 primary ESA changelog** for editions after 2024_1: not readable in indexed text.
- Optimal Index canonical source unverified (metric dropped).
- `yamato/three-water` repo 404 (dead pointer); r183 RenderPipeline claim rests on one third-party guide.
