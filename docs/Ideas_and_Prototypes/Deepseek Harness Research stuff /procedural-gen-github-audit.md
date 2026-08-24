# Procedural-Generation Repository Audit — Delta Climate Research (August 2026)

**Scope:** open-source GitHub repositories usable (not merely inspirational) in Delta Climate Research's static Astro/Vercel + client-side TS + three.js(WebGL2) + MapLibre stack, for Concepts **A** (Climate Analogs Explorer), **B** (Any-City onboarding engine), **C** (urban-growth sandbox).

**Method:** Firecrawl web searches (site:github.com, 47 queries across 10 categories) → candidate triage → hard verification via api.github.com/repos/<owner>/<repo> (language, license.spdx_id, stars, pushed_at) for 51 repos, plus npm (registry.npmjs.org) and PyPI metadata for package-level licence/version truth. GitHub API was unauthenticated (60 req/hr cap), which bounded the verification set; every licence claim below traces to the API license field or npm/PyPI package metadata.

---

## (a) Top 10 recommended repositories

Ranked by usefulness × maintenance × licence-safety. All fields verified Aug 2026.

### 1. Auburn/FastNoiseLite — cross-cutting (A+B+C)
- Language / Licence: Multi-language (C#, C++, Java, **JavaScript**, GLSL/HLSL, Go, Rust…) · **MIT**
- Stars / Status: ~3,485 ★ · pushed **2026-06** — actively maintained
- What it does: Portable noise library: OpenSimplex2, Perlin, value/cellular (Worley), fractal FBM/ridged/domain-warp — all seeded & deterministic across languages.
- Integration: `npm i fastnoise-lite` (v1.1.1, MIT) — pure JS port shipped inside the canonical repo, zero deps, runs client-side. Same seeds reproduce identical noise across language ports → ideal for reproducible priors.
- Red flags: None material. JS flavour is a hand-port; benchmark vs simplex-noise for hot loops.

### 2. NASA-AMMOS/3DTilesRendererJS — delivery backbone (A+B+C)
- Language / Licence: JavaScript/TypeScript · **Apache-2.0**
- Stars / Status: ~2,433 ★ · pushed **2026-08** (near-daily activity)
- What it does: Renders OGC 3D Tiles (b3dm/glb, quantized meshes) in three.js/Babylon/r3f — standard way to stream big precomputed city assets into three.js.
- Integration: `npm i 3d-tiles-renderer` (v0.5.1, Apache-2.0). Static tiles on Vercel/CDN fit the no-backend constraint perfectly. Pairs with `xuzhusheng/gltf-to-3d-tiles` (Python, MIT) to tile offline-generated district glTFs.
- Red flags: None.

### 3. dgreenheck/ez-tree — vegetation (A+B+C)
- Language / Licence: JavaScript/TypeScript, three.js-native · **MIT**
- Stars / Status: ~1,578 ★ · pushed **2026-07** — very active
- What it does: Parameter-driven procedural tree generator (trunk/branch/canopy, presets, wind-ready animation) built for three.js.
- Integration: `npm i @dgreenheck/ez-tree` (v1.1.0, MIT). Generate trees at build time and bake to glTF/glB for the static pipeline. Climate-analog palettes (palm vs conifer) are just preset swaps.
- Red flags: Verify the exact GLB-export path in the version you pin (library split recent); canopy polys need LOD control for dense street-tree scenes.

### 4. IceCreamYou/THREE.Terrain — terrain (A+C)
- Language / Licence: JavaScript (three.js plugin) · **MIT**
- Stars / Status: ~887 ★ · pushed **2026-08** — maintained again after dormancy
- What it does: Heightmap→mesh terrain engine for three.js: noise/fBM generators, erosion-flavoured filters, scatter-mesh foliage, heightmap import/export (canvas).
- Integration: Drop-in THREE.Terrain(...) producing BufferGeometry; feed Copernicus DEM tiles as heightmaps for real-elevation analog environments.
- Red flags: API predates ES modules (UMD-style; wrap it); scatter helpers are naive for production density.

### 5. jblindsay/whitebox-tools — raster hydrology, build-time (B+C)
- Language / Licence: Rust CLI + plugin architecture · **MIT** (confirmed via API license field)
- Stars / Status: ~1,192 ★ · pushed **2026-05** — active
- What it does: Full geospatial raster suite: breach/priority-flood depression filling, D8/D∞ flow direction & accumulation, watershed extraction, stream ordering — exactly the DEM hydrology chain.
- Integration: Build-time CLI in CI/prebuild emitting static JSON overlays (flow accumulation, flood-prone cells, subcatchments). MIT makes it embeddable even in distributed tooling.
- Red flags: Binary must run in your build env; not browser-side (fine — build-time only by design).

### 6. Deltares/pyflwdir — raster hydrology, build-time (B+C)
- Language / Licence: Python · **MIT**
- Stars / Status: ~116 ★ · pushed **2026-08** — active, Deltares-backed
- What it does: Fast pure-Python flow-direction topology: DEM→D8 conditioning (from_dem), basins/subbasins, stream-network upscaling, basin partitioning — clean NumPy API.
- Integration: pip install pyflwdir; build-time JSON/glTF overlay generation. Excellent programmatic complement (or alternative) to whitebox-tools when you want in-process Python rather than CLI.
- Red flags: Small team bus factor; Python-only (fine for build-time).

### 7. jwagner/simplex-noise.js — noise (A+B+C)
- Language / Licence: TypeScript · **MIT**
- Stars / Status: ~1,846 ★ · pushed **2024-07** — stable/complete (feature-frozen, not abandoned)
- What it does: Fast seeded 2D/3D/4D simplex noise with injectable `random` for determinism; typed, tree-shakeable.
- Integration: `npm i simplex-noise` (v4.0.3, MIT) — pass a seeded PRNG (pure-rand/alea) for reproducible client renders.
- Red flags: Simplex only (no cellular/domain-warp — use FastNoiseLite for those).

### 8. kchapelier/wavefunctioncollapse — WFC (A+C)
- Language / Licence: JavaScript · **MIT**
- Stars / Status: ~523 ★ · pushed **2023-08** — stable port of the canonical algorithm
- What it does: Faithful JS port of mxgmn/WaveFunctionCollapse: overlapping + tiled models, seedable, headless-capable.
- Integration: `npm i wavefunctioncollapse` (v2.1.0, MIT). Run at build time to assemble street-tile sets / vegetation-palette textures, or client-side for interactive re-collapsing under policy sliders.
- Red flags: No TS types (write a .d.ts); original mxgmn repo carries a **non-standard MIT-with-attribution-clause** licence (API returns NOASSERTION) — prefer this MIT port in commercial derivatives.

### 9. StrandedKitty/straight-skeleton — roof geometry (B)
- Language / Licence: TypeScript · **MIT**
- Stars / Status: ~87 ★ · pushed **2026-03**; npm straight-skeleton v3.0.0 published 2026-03 — freshly maintained
- What it does: Straight-skeleton computation in TS — core algorithm behind hip/gable roof generation and inward offsetting from 2D footprints.
- Integration: `npm i straight-skeleton` — feed OSM/Overture footprint rings (with holes), extrude skeleton edges to roof faces at build time, emit glTF. Companion straight-skeleton-geojson (MIT, Jul 2026) wraps GeoJSON input.
- Red flags: Young/small community (87★); validate degenerate polygons upstream with flatten-js/Turf.

### 10. anvaka/city-roads — road networks, real-data (A)
- Language / Licence: JavaScript (WebGL) · **MIT**
- Stars / Status: ~9,561 ★ · pushed **2026-03** — lightly but currently maintained (deps bumped Jan–Mar 2026)
- What it does: Renders *all* roads of any city from OSM/Overpass as WebGL lines — proven at metro scale.
- Integration: Fork/adapt its Overpass fetch + WebGL line rendering for Concept A's twin-city ground layer; static-export road geometry per bbox. MIT allows closed derivative use.
- Red flags: It's an app more than a library (Vue internals) — expect extraction work, not npm install. Visualization ≠ synthesis: draws real roads, doesn't invent them.

---

## Honourable mentions (verified, worth pinning)

| Repo | Lang | Licence | ★ | Pushed | One line | Concept | Integration / Flags |
|---|---|---|---|---|---|---|---|
| dubzzz/pure-rand | TS | MIT | 115 | 2026-08 | Pure, interruptible, seedable PRNGs (xorshift, Mersenne, LCG) | A+B+C | npm pure-rand@8.4.2; per-slider/per-district deterministic streams |
| davidbau/seedrandom | JS | MIT (per npm; **repo lacks LICENSE file**) | 2,132 | 2024-04 | Seeded PRNG incl. alea; string-seed hashing | A+B+C | npm seedrandom@3.0.5; alea = de-facto reproducibility standard |
| Daninet/hash-wasm | TS+WASM | MIT (npm) | 1,152 | 2024-11 | WASM hashes (MD5→SHA3, xxHash…), very fast | B | npm hash-wasm@4.12.0; content-address precomputed JSON/glTF assets |
| paulmillr/noble-hashes | TS | MIT | 903 | 2026-08 | Audited SHA2/SHA3/BLAKE3 etc. | B | npm @noble/hashes@2.3.0; audited dataset fingerprinting |
| jungomi/xxhash-wasm | WASM/TS | MIT | 184 | 2024-11 | xxHash32/64/128 in WASM | B | npm xxhash-wasm@1.1.0; cheap non-crypto addressing |
| connor4312/blake3 | TS | MIT | 199 | 2023-02 | BLAKE3 via WASM + native Node bindings | B | npm blake3@3.0.0; dormant-but-stable; noble-hashes also covers BLAKE3 |
| dvt3d/maplibre-three-plugin | TS | Apache-2.0 | 88 | 2026-07 | MapLibre GL JS ↔ three.js camera/scene sync bridge | A+B | New (Dec 2024), actively developed; direct fit for existing stack |
| nylki/lindenmayer | JS | MIT | 199 | 2025-06 | Feature-complete L-system engine (parametric, context-sensitive) | B | npm lindenmayer@1.5.4; drive hedgerow/street-tree grammars |
| pajama-studio/lowpoly-tree-generator | JS | MIT | 13 | 2026-07 (new) | Parametric low-poly trees + rigging/animation for three.js | C | Brand-new; stylized contrast to ez-tree for sandboxes |
| LingDong-/ndwfc | JS | MIT | 336 | 2020-05 | N-dimensional WFC with infinite canvas, browser+node | C | Install from GitHub (no live npm dist-tag verified); unmaintained but stable |
| Arkyris/blazinwfc | JS | MIT | small | npm 2024-03 | Speed-focused WFC for complex tilesets | C | npm blazinwfc@1.0.13 |
| xuzhusheng/gltf-to-3d-tiles | Python | MIT | 193 | 2024-04 | Convert glTF→GLB/b3dm/3D Tiles offline | B | Pipelines generated districts into streamable static tiles |
| cityjson/cityjson-threejs-loader | JS | Apache-2.0 | 29 | 2025-07 | Load CityJSON into three.js | B | Fits existing CityJSON digital-twin assets |
| ozekik/cityview | TS | MIT | 14 | 2025-09 | CityJSON/CityJSONSeq renderer for three.js + r3f + Jupyter | B | Handy QA viewer during onboarding-engine dev |
| IBM/IBMWeatherGen | Python | MIT | 45 | 2025-09 | Gridded multisite multivariate daily stochastic weather generator (resampling) | Bonus | Build-time synthetic forcing with fixed seeds |
| openamundsen/openamundsen-climategenerator | Python | MIT | 1 | 2026-04 | Block-bootstrap stochastic weather generator from observations | Bonus | Tiny but maintained; simple bootstrap logic to adapt |
| bgroenks96/wxsbi | Python | MIT | 0 | 2026-03 | Stochastic weather generators via numpyro + simulation-based inference | Bonus | Research-grade; exploratory only |
| TheJanusStream/symbios-tensor | Rust | MIT | 2 | 2026-08 (created 2026-03) | Tensor-field-driven urban layout generator (terrain-aware roads + lots) | A+C | Watchlist — right idea, far too immature today; re-audit in 6 months |
| aiira-co/three-terrain-lod | TS | **none yet** | 3 | 2026-08 (created 2025-12) | Quadtree chunked LOD terrain for three.js (@interverse/three-terrain-lod v2.1.1) | A | Active but **unlicensed** → cannot legally use until licence lands |

---

## Licence-cautious / red-flag list

| Repo | Problem | Disposition |
|---|---|---|
| weigert/SimpleHydrology (C++, 738★, stale 2023) | **No licence file** → all-rights-reserved default | Study algorithm/blog; write your own port; do not copy code |
| SebLague/Hydraulic-Erosion (C#/Unity, MIT, 1,040★) | Not web | Great MIT source to port particle-drop erosion to TS/WebGPU |
| tessapower/hydraulic-erosion & GuilBlack/Erosion | **No licences**; 2★/0★ | Demos proving real-time WebGL/compute erosion feasibility; reference only |
| mxgmn/WaveFunctionCollapse (25k★) | Non-standard MIT variant with extra attribution condition (API: NOASSERTION) | Legal grey zone for compliance teams → use kchapelier MIT port |
| math-fehr/fast-wfc (C++, 438★) | Licence undetectable (NOASSERTION) | Inspect LICENSE before any use |
| pysheds/pysheds (GPL-3.0, 895★) · r-barnes/richdem (GPL-3.0, 323★) | GPL | Internal build-time use workable; keep out of anything distributed/embedded; prefer whitebox-tools/pyflwdir (both MIT) |
| tudelft3d/3dfier (GPL-3.0, 630★, active 2026) | GPL footprint→LOD1/2 lifter | Acceptable as internal black-box batch producing assets; never fork into product code |
| stefalie/shapeml (GPL-3.0) · nortikin/prokitektura-blender (Blender-GPL) | CGA-like façade grammar options are copyleft/desktop | References only; façade grammar must be in-house |
| NBloemendaal/STORM (GPL-3.0, stale 2022) · MESMER-group/mesmer (GPL-3.0, active) | Synthetic TC model / climate emulator under GPL | Use published STORM datasets rather than code; mesmer only as internal experiment |
| felixpalmer/procedural-gl-js (**MPL-2.0**, 1,342★) | File-level copyleft + **last push 2021-05 → dormant ~5 yrs** | Verified status: NOT actively maintained. Usable unmodified in closed products (upstream patches), but plan an exit. Does accept custom raster/elevation tile sources via callbacks |
| nytimes/three-loader-3dtiles (536★, 2024-10) | Semi-dormant; API couldn't classify licence (docs say Apache-2.0) | Prefer NASA-AMMOS renderer; verify LICENSE if used |
| OSMBuildings/OSMBuildings (1,007★, dead since ~2021) | Legacy viewer; licence file not auto-classified (historically BSD-3) | Superseded by MapLibre fill-extrusion + own glTF path |
| kiselev-dv/osm-cesium-3d-tiles (85★, no licence, dead 2017) | Pattern reference for OSM→3D Tiles | Do not copy code |
| CodingTrain/Wave-Function-Collapse (216★, no licence) | Educational p5.js port | Learning resource only |
| joshforisha/open-simplex-noise-js | **GitHub repo deleted** (404); npm open-simplex-noise@2.5.0 (Unlicense) orphaned | Avoid new adoption; FastNoiseLite ships OpenSimplex2 |
| davidbau/seedrandom | Repo has **no LICENSE file** despite MIT in README/npm | Pin npm tarball (MIT declared) and record provenance, or use pure-rand |

---

## (b) Category coverage matrix

| # | Category | Best verified picks | Status | Gap assessment |
|---|---|---|---|---|
| 1 | Noise & randomness | FastNoiseLite, simplex-noise.js, open-simplex-noise (orphan), pure-rand, seedrandom | ✅ Strong | Fully covered; deterministic seeded-hash→PRNG chains solved by pure-rand/alea + xxhash/blake3 |
| 2 | Terrain (heightmap→mesh, LOD, erosion) | THREE.Terrain; three-terrain-lod (unlicensed); refs SebLague/SimpleHydrology/tessapower | ⚠️ Partial | Heightmap→mesh ✅; quadtree LOD thin (one active but unlicensed project); **production hydraulic/fluvial erosion in JS/TS-WASM does not exist OSS** — port MIT sources or reimplement (WebGPU compute) |
| 3 | Hydrology on raster DEMs | whitebox-tools (MIT), pyflwdir (MIT); pysheds/richdem (GPL); Barnes2013 (no licence) | ✅ Strong build-time / ❌ in-browser | Priority-flood, flow accumulation, watersheds covered for build-time JSON. No mature JS/TS/WASM runtime implementation — acceptable given no-backend architecture |
| 4 | WFC & constraint solvers | mxgmn (lic. quirk), kchapelier (MIT), ndwfc, blazinwfc, fast-wfc (C++) | ✅ Adequate | Tiled/overlapping assembly covered. Arcadia-style higher-level solvers: nothing maintained surfaced; not blocking |
| 5 | Procedural buildings & blocks | straight-skeleton (roofs); 3dfier (GPL); cityjson loaders; refs threex.proceduralcity, ShapeML (GPL) | ❌ Biggest gap | **Parcel subdivision (OBB recursive splitting): no maintained OSS surfaced in any language** (only Vanegas et al. 2012 paper + toys) — implement in-house (~300 LOC over flatten-js/Turf). **Façade grammar (CGA-like): only GPL/desktop options** — in-house rule engine needed. Roofs now covered |
| 6 | Road/street network synthesis | anvaka/city-roads (real-data viz); symbios-tensor (too new) | ❌ Gap | No maintained JS/TS tensor-field or growth-based road library. Port classic tensor-field streamline tracing (~500 LOC) or monitor symbios-tensor |
| 7 | Vegetation/tree generation | ez-tree, lindenmayer, lowpoly-tree-generator | ✅ Strong | Low-poly glTF-able trees, grammar engine, canopy variation covered |
| 8 | Real-data 3D map engines w/ procedural detail | 3DTilesRendererJS, maplibre-three-plugin, procedural-gl-js (MPL, dormant) | ✅ Good | Verified: procedural-gl-js NOT actively maintained (May 2021) though custom tile sources supported; NASA-AMMOS is the safe modern bet |
| 9 | Deterministic/reproducible pipelines | hash-wasm, noble-hashes, xxhash-wasm, blake3, pure-rand, seedrandom | ✅ Strong | Content-addressed assets + seeded streams fully coverable in permissive MIT stack |
| 10 | Climate/weather stochastic generators | IBMWeatherGen (MIT), openamundsen-climategenerator (MIT), wxsbi (MIT); STORM/mesmer (GPL) | ⚠️ Partial | Resampling/bootstrap generators exist under MIT. **No maintained permissive Richardson-type WGEN in JS/TS**; synthetic storm samplers GPL/research-grade — use published datasets or wrap MIT bootstrap approaches in-house |

---

## (c) Minimal 'procedural toolkit' bundles

### Concept A — Climate Analogs Explorer
Goal: procedurally assemble a 3D environment of city X rendered "as" its climate-twin city.
- Runtime: simplex-noise/FastNoiseLite for micro-variation · IceCreamYou/THREE.Terrain fed Copernicus-DEM-derived heightmaps of the real city · anvaka/city-roads-derived OSM road layer · kchapelier/wavefunctioncollapse for surface/vegetation tile assembly · ez-tree with twin-city species presets (the analog "reskin" is literally a parameter-set swap).
- Determinism: dubzzz/pure-rand streams keyed by (cityId, twinCityId, slider-state hash); hash-wasm xxHash asset cache keys.
- Delivery: NASA-AMMOS/3DTilesRendererJS + dvt3d/maplibre-three-plugin.
- Everything heavy (DEM tiling, WFC textures, tree baking) precomputed to JSON/glTF at build time.

### Concept B — Any-City onboarding engine
Goal: assemble a digital twin from OSM/Overture footprints + Copernicus DEM with badged synthetic priors.
- Build-time hydro/terrain: whitebox-tools (breach depressions → flow accumulation → flood-prone mask) and/or pyflwdir (basin partitioning, upscaling) — both MIT.
- Footprint→3D: in-house extruder (gap) + straight-skeleton (hip/gable roofs) → glTF → xuzhusheng/gltf-to-3d-tiles → static 3D Tiles; QA via ozekik/cityview / cityjson-threejs-loader. Optional internal-only helper: tudelft3d/3dfier (GPL — run as black-box batch, ship only output assets).
- Synthetic priors (heights, vegetation, street trees): ez-tree + lindenmayer; every prior tagged provenance {model, seed} where seed comes from pure-rand keyed by blake3/noble-hashes fingerprint of input bbox+dataset version → fully reproducible, clearly badged.
- Runtime: MapLibre + maplibre-three-plugin + 3DTilesRendererJS.

### Concept C — Urban-growth sandbox
Goal: districts grow procedurally under policy sliders with heat/flood feedback.
- Growth kernel: in-house cellular/OBB growth loop (Vanegas-style recursive splitting — the one true gap; budget 1–2 eng-weeks) driven by FastNoiseLite attractiveness fields and pure-rand per-policy-seed streams so every slider state replays deterministically.
- Texture/detail: wavefunctioncollapse (block fabric) + lowpoly-tree-generator or ez-tree (stylized canopy).
- Feedback layers: heat/flood rasters precomputed with the Concept-B hydrology chain (pyflwdir/whitebox-tools) indexed per district; client lerps rasters as districts densify.
- Terrain shell: THREE.Terrain. Watchlist: symbios-tensor (could replace in-house road/lot kernel if it matures), aiira-co/three-terrain-lod once licensed.

---

## (d) All URLs

Top-10:
- https://github.com/Auburn/FastNoiseLite · https://www.npmjs.com/package/fastnoise-lite
- https://github.com/NASA-AMMOS/3DTilesRendererJS · https://www.npmjs.com/package/3d-tiles-renderer
- https://github.com/dgreenheck/ez-tree · https://www.npmjs.com/package/@dgreenheck/ez-tree
- https://github.com/IceCreamYou/THREE.Terrain
- https://github.com/jblindsay/whitebox-tools
- https://github.com/Deltares/pyflwdir
- https://github.com/jwagner/simplex-noise.js · https://www.npmjs.com/package/simplex-noise
- https://github.com/kchapelier/wavefunctioncollapse · https://www.npmjs.com/package/wavefunctioncollapse
- https://github.com/StrandedKitty/straight-skeleton · https://www.npmjs.com/package/straight-skeleton
- https://github.com/anvaka/city-roads

Honourable / supporting:
- https://github.com/dubzzz/pure-rand · https://github.com/davidbau/seedrandom · https://github.com/Daninet/hash-wasm · https://github.com/paulmillr/noble-hashes · https://github.com/jungomi/xxhash-wasm · https://github.com/connor4312/blake3
- https://github.com/dvt3d/maplibre-three-plugin · https://github.com/nytimes/three-loader-3dtiles · https://github.com/felixpalmer/procedural-gl-js · https://github.com/maplibre/maplibre-gl-js
- https://github.com/xuzhusheng/gltf-to-3d-tiles · https://github.com/cityjson/cityjson-threejs-loader · https://github.com/ozekik/cityview
- https://github.com/nylki/lindenmayer · https://github.com/pajama-studio/lowpoly-tree-generator
- https://github.com/LingDong-/ndwfc · https://github.com/Arkyris/blazinwfc · https://github.com/math-fehr/fast-wfc · https://github.com/mxgmn/WaveFunctionCollapse · https://github.com/CodingTrain/Wave-Function-Collapse
- https://github.com/TheJanusStream/symbios-tensor · https://github.com/aiira-co/three-terrain-lod · https://www.npmjs.com/package/@interverse/three-terrain-lod · https://github.com/danielesteban/terrain
- https://github.com/alexbol99/flatten-js (polygon primitives for the in-house parcel splitter)

References / caution list:
- https://github.com/weigert/SimpleHydrology · https://github.com/weigert/SimpleErosion · https://github.com/SebLague/Hydraulic-Erosion · https://github.com/tessapower/hydraulic-erosion · https://github.com/GuilBlack/Erosion
- https://github.com/pysheds/pysheds · https://github.com/r-barnes/richdem · https://github.com/r-barnes/Barnes2013-Depressions · https://github.com/Vehxx/PriorityFlood · https://github.com/wschwanghart/topotoolbox (MATLAB reference)
- https://github.com/tudelft3d/3dfier · https://github.com/stefalie/shapeml · https://github.com/nortikin/prokitektura-blender · https://github.com/OSMBuildings/OSMBuildings · https://github.com/jeromeetienne/threex.proceduralcity · https://github.com/photonlines/Procedural-City-Generator · https://github.com/kiselev-dv/osm-cesium-3d-tiles · https://github.com/Briganti-Games/Straight-Skeleton-Generator (Unity ref)
- https://github.com/NBloemendaal/STORM · https://github.com/MESMER-group/mesmer · https://github.com/IBM/IBMWeatherGen · https://github.com/openamundsen/openamundsen-climategenerator · https://github.com/bgroenks96/wxsbi · https://pypi.org/project/gwgen/
- Parcel-subdivision gap algorithm paper: Vanegas et al., Procedural Generation of Parcels in Urban Modeling (Eurographics 2012): https://www.cs.purdue.edu/cgvlab/www/resources/papers/Vanegas-Eurographics-2012-Procedural_Generation_of_Parcels_in_Urban_Modeling.pdf

Audit limitations: GitHub API was unauthenticated (60 req/hr) — 51 repos verified directly; secondary candidates characterized from search metadata and npm/PyPI records only. Star counts and push dates are point-in-time snapshots at audit time.
