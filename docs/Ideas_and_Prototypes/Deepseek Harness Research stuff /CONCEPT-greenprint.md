# CONCEPT BRIEF — GREENPRINT
**SHEET GP/00 · Status: approved concept, pre-build · Track: Interactive Tools · Sibling doc: `BUILD-SPEC-flood-explorer.md`**
*"See the best future your city can physically build."*

---

## 1. What it is

A **procedural possibility engine**: type your city → the engine computes your real, measured constraints (climate-zone shifts, heat deltas, flood extents, canopy capacity) → then grows the **best physically-defensible version of your neighbourhood**, rendered as an explorable 3D scene. Utopian in mood, engineering-drawing in method. It does not *predict* 2050 — it computes *a legal move toward it*.

Positioning rule: **NOT under the digital-twin track.** The twin is measurement (serious, accurate, boring ✅). Greenprint is imagination constrained by that measurement. The two products cite each other but never blur.

Solarpunk grounding contract: optimism is earned per-element by physics, never asserted by mood-board.

## 2. IA placement

```
INTERACTIVE TOOLS
├─ Heat Map            ← digital twin (measurement track, untouched)
├─ CBAM Explained
├─ CBAM Calculator
├─ Flood Simulator     ← P1a Dubai · P1b EU demos · P2 Mumbai   [BUILD-SPEC-flood-explorer.md]
└─ GREENPRINT          ← this document                        [concept stage]
```

Nav copy candidate: **"Greenprint — grow your city's possible future"**

## 3. Naming

| Option | Status |
|---|---|
| **Greenprint** ⭐ recommended | green + blueprint = matches drafting-sheet identity ("SHEET GP/01 — SCALE 1:POSSIBLE"); verb-able; investor-legible. Action: trademark sweep before public launch |
| The Arboretum | runner-up; specimens-catalogue framing ("Specimen MUM-2050-A · seed 0x3F2A") — gorgeous share cards, slightly tree-narrow |
| Protopia | Kevin Kelly's grounded-optimism term; researcher-legible lineage |
| Photopia / Second Nature | alternates; collision or ambiguity tradeoffs |

Working title until launch: **Greenprint (GP)**.

## 4. User flow

1. Enter city (v1: cities with twin coverage; v2: any bbox).
2. Pick horizon year + ambition slider.
3. Engine renders **three futures side-by-side** from identical physics:
   `BAU` · `Policy-aligned` · `Greenprint-max`.
4. Orbit/pin/street-walk any of them; every element is inspectable ("this tree: species X, survives zone shift, shade −1.8 °C at noon — from our LST model").
5. Export: square card, 9:16 loop, and — the killer — a **materials-and-moves list** (X trees @ Y m² canopy, Z m² cool-roof albedo, N bioswales @ capacity C) = municipal procurement sketch.

## 5. Constraint–physics mapping (the grounding engine)

| Rendered element | Constrained by | Measured source | Our model piece |
|---|---|---|---|
| Street trees appear/survive | 2050 hardiness-zone shift | CMIP6 ensemble (CC BY via Copernicus), Köppen-Geiger matching | zone-shift lookup |
| Tree geometry & shade | observed canopy-volume stats | Meta/WRI canopy height map | L-system growth + existing shade coefficients |
| Cool-roof / albedo changes | ΔLST response | ECOSTRESS calibration (existing twin) | heat-model albedo coefficients |
| Bioswale / retention placement | where water already goes | Flood Simulator spill fields (`BUILD-SPEC` §1) | shared hydrology tiles |
| Sea-level/water edges | SLR scenarios | IPCC AR6 / JRC coastal maps | flood-sim water shader reuse |
| Block morphologies | real footprints + analog grammar | Overture/Google OB + WFC street tiles | procedural assembly layer |
| Everything synthetic | badge + seed | — | `synthetic detail · seed 0x…` |

Rule: **no element renders without a row in this table.**

### 5b. Solarpunk expansion pack (`solarpunk-stack.md` — 15 Crossref-verified papers, ~22 vetted libs)

New renderable elements unlocked beyond the base table:

| Element | Mechanic / constraint | Source |
|---|---|---|
| Rooftop PV arrays (per-roof kWp/kWh) | PV physics baked to glTF attrs at build time | **pvlib-python** (BSD-3, active) |
| Community gardens / urban-ag plots | suitability screening + OBB parcel splitter allocation | Lovell 2010 criteria |
| Microgrid autonomy % | self-sufficiency / self-consumption curves | **PyPSA** (MIT) or Calliope (Apache-2.0); Koirala 2016 KPIs |
| Walkability / 15-min-city deltas | street-graph isochrones | **osmnx** (MIT, ~5.8k★); Moreno 2021 metrics |
| Tram / light-rail layers | real GTFS feeds → geojson | node-gtfs / gtfs-to-geojson (MIT) |
| Small urban wind turbines | honest yield estimates (mostly-negative results are on-brand) | NREL **FLORIS** (BSD-3) + windpowerlib; Micallef 2018 caveats |
| Comfort-under-canopy | Tmrt rasters from SVF + shadows | UMEP/SOLWEIG + ladybug-comfort — **GPL/AGPL ⚠ build-time black box only** |
| Green roofs / living walls | energy balance + typology catalogue | Sailor 2008 mechanics; Pérez 2017; TEASER archetypes (**licence discrepancy flagged — legal read before vendoring**) |
| Stormwater gardens | SWMM-style retention routing | EPA SWMM — **verify licence terms first** |
| Ecosystem counters (PM, CO₂, pollination, habitat) | InVEST models as score cards | natcap/invest (Apache-2.0); Baró 2014 |
| Slider response curves | canopy ≥40% threshold knee — non-linear greening payoff | **Ziter 2019 PNAS** (the single most important curve for the ambition slider) |
| Ambient cooling fields | ΔT ≈ −0.9 °C canonical effect size | Bowler 2010 |
| Client-side sun/shadows driving three.js | live shadow math | mourner/SunCalc (BSD-2, licence text verified) |

Art-direction bible: solarpunk canon — Lodi-Ribeiro anthology (2012/2018), Reina-Rozo 2021, Flynn's manifesto; visual target Art-Nouveau × sustainable-tech, delivered via CC0 prop packs (Kenney.nl, Quaternius) until procedural assets mature.

Adoption order: (1) osmnx + gtfs + pvlib + pybdshadow + FLORIS quick wins → (2) SOLWEIG comfort loop + SunCalc live shadows → (3) greenery economics cards (Sailor/Pérez/SWMM) → (4) PyPSA autonomy loop → (5) InVEST biodiversity counters → (6) space-colonization trees replacing CC0 placeholders.
Copyleft rule repeats from toolkit audit: UMEP/ladybug/SWMM outputs may ship; their code never forks into product.

## 6. The three-futures system

Same physics engine, different input policies. Hope becomes quantitative: the *delta* between BAU and Greenprint-max IS the pitch ("your street: −4.1 °C peak, −38 cm design-flood depth — here's the shopping list").

## 7. Non-negotiables (brand guards)

1. Computed-not-imagined: every element traces to §5 rows.
2. Three futures, never a single prophecy.
3. Seeds published (`seed + generator_version ⇒ bit-identical world`) — NMS determinism as reproducibility flex; lives in `+delta_lineage`.
4. Measured vs generated visually distinct, always.
5. Never co-mingled with twin outputs in the same nav hierarchy or claim-set.

## 8. Technical sketch

Stack identical to flood sim (TS + three.js/WebGL2, static Vercel, zero serverless):
- **Stage A (measure):** assemble constraint rasters/tables per city (reuses flood/heat pipelines verbatim).
- **Stage B (solve):** policy inputs → per-cell intervention map (greedy/WFC allocation under budget sliders) — build-time precompute per scenario preset; client interpolates.
- **Stage C (grow):** procedural rendering pass — L-system vegetation, WFC streetscape tiles, material swaps — seeded from `hash(city_id, scenario, year, gen_version)`.
- **Stage D (prove):** inspection overlays + exports + lineage stamp.

### Toolkit (from `procedural-gen-github-audit.md` — 51 repos API-verified Aug 2026)

| Stage | Use | Repo | Licence |
|---|---|---|---|
| B | Scenario allocation noise fields | **Auburn/FastNoiseLite** (~3.5k★, active 2026) | MIT · `npm i fastnoise-lite` |
| B/C | Streetscape + palette assembly | **kchapelier/wavefunctioncollapse** (MIT port — *prefer over mxgmn original*: its licence is a non-standard MIT-with-attribution variant) | MIT |
| C | Trees from species presets (analog = preset swap) | **dgreenheck/ez-tree** (~1.6k★, very active) | MIT · bake to glTF build-time |
| C | L-system fallback/growth engine | nylki/lindenmayer | MIT |
| C | Roof geometry from real footprints | **StrandedKitty/straight-skeleton** (TS, 2026-fresh) | MIT |
| A/C | Real-terrain shells | IceCreamYou/THREE.Terrain (revived 2026) + anvaka/city-roads pattern (MIT, viz-only — extraction work required) | MIT |
| Delivery | Precomputed assets streaming | **NASA-AMMOS/3DTilesRendererJS** (near-daily commits) + dvt3d/maplibre-three-plugin | Apache-2.0 |
| Determinism | Seeded streams + content hashes | pure-rand / alea + hash-wasm/noble-hashes/xxhash-wasm | MIT |

**In-house gaps (no maintained OSS exists — budgeted, not blockers):**
1. OBB parcel subdivision → implement Vanegas-2012 (~300 LOC over flatten-js/Turf).
2. Tensor-field road synthesis → none maintained; reuse real OSM networks via city-roads extraction instead.
3. JS/WASM hydraulic erosion → port SebLague (Unity, MIT → legal) if ever needed client-side.

**Licence red flags already dodged:** weigert/SimpleHydrology (NO licence — reimplement, don't copy) · aiira-co/three-terrain-lod (active but unlicensed) · davidbau/seedrandom (npm says MIT, repo lacks LICENSE file) · procedural-gl-js (MPL-2.0 AND dormant since May 2021) · mxgmn WFC non-standard clause.

## 9. Build order & dependencies

```
Flood Simulator (P1) ──spill-fields──► GREENPRINT hydrology layer
Heat twin coefficients ──albedo/shade──► GREENPRINT micro-climate layer
Deepsearch repo audit ──toolkit──► Stage B/C implementations
```
Start only after flood-sim P1a ships; GP shares its tile format so the marginal cost collapses.

## 10. Audience lines

- Public: "See the best future your city can physically build."
- Researchers: "Constraint-satisfied procedural scenario generation; every render traceable to measured inputs, every seed reproducible."
- Investors: "Everyone sells doom dashboards. We're building the interface cities will use to decide — running on our measurement stack."

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Read as greenwash/fantasy | §7 badges + published seeds + materials-list export |
| Pseudo-precision accusations | frame as possibility-space (legal moves), never forecast; uncertainty bands inherited from source layers |
| Scope creep vs twin team focus | hard gate: starts after flood P1a ships |
| Trademark collision ("greenprint" used loosely by consultancies) | sweep before launch; Arboretum fallback |
| Solarpunk aesthetic alienates institutional buyers | drafting-sheet UI skin keeps it engineering-drawing, not mood-board |

## 12. Open questions
- Which launch city? (Mumbai post-P2 monsoon data richest; Dubai for audience symmetry; EU city for COP timing)
- Budget-slider semantics (₹/AED/EUR per-capita? policy-verb presets?)
- Real-time growth animation vs instant states on mobile GPUs?
