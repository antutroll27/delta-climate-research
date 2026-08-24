# HANDOFF — Flood Explorer & Simulator ("the tool that defines Dubai")
**Prepared 23 Aug 2026 · For: fresh DeepSeek-harness session / new engineer · Read this file first, then the four docs in §9. You will be ~90% oriented.**

---

## 1. Who & why (30 seconds)

Delta Climate Research (deltaclimate.earth) — 5-person climate studio, Kolkata; serving India + UAE. Existing products: a ward-scale 3D urban-heat digital twin for Kolkata (ECOSTRESS thermal + real building footprints, CityJSON/OGC 3D Tiles, three.js) that Dubai investors and PwC partners loved, and a client-side EU CBAM calculator. Brand promise: **decision-grade, standards-aligned measurement; publishes error bars and null results.**

This project: an interactive 3D **flood scenario explorer + simulator**. Spectacle-grade enough to headline pitch meetings; scientifically honest enough for researchers. It must *define Dubai* for the studio.

## 2. Product & city sequencing (locked)

| Wave | Scope | Launch window |
|---|---|---|
| **P1a** | **Dubai** flash-flood explorer/simulator (pure pluvial physics) | Ahead of UAE convective season |
| **P1b** | European compound-flood demos (Amsterdam/Venice/Bucharest: EGMS subsidence × SLR × JRC coastal maps) | COP-week / EEA window |
| **P2** | **Mumbai** (compound rain×tide, flat-city error bands, drainage disclaimer) | Pre-monsoon May 2027 |

**Dubai launch narrative:** the Apr-2024 floods (Al Ain ~256 mm/24 h) were never officially mapped — no Copernicus EMS activation exists (verified). Delta derives observed extents itself (Sentinel-1 via CDSE), cross-validates against published academic mappings (Hong 2026, ~23.8 km², PlanetScope/U-Net, Taylor & Francis; Bersi et al. 2025, ~215 km² Sentinel-2, Al Ain area), and **publishes the hit-rate in-tool**. Being first to publish observed extents = becoming the source of record.

## 3. Stack (locked)

- **TypeScript + three.js (WebGL2)**, Astro static site, Vercel. MapLibre + OpenFreeMap basemaps.
- **NO serverless compute, ever** (viral-spike cost lesson: Cara's $96k Vercel month). All traffic = CDN statics.
- **Hydrology = build-time**: priority-flood depression filling on Copernicus GLO-30 → per-cell spill elevations + drainage graph → Draco/brotli'd typed-array tiles. Engine: **whitebox-tools (MIT, Rust CLI) primary; Deltares/pyflwdir (MIT) complement.** pysheds/richdem are GPL-3.0 — internal black-box only, never forked into product code.
- **Client interpolates** slider states between precomputed snapshots (rainfall mm/h, tide stage for Mumbai). Deterministic, instant, honest.
- **Water rendering:** custom `ShaderMaterial` plane; depth→colour via legend ramp. HARD RULE: depth-sampling grid === simulation grid (render may simplify smoothness, never depth).
- **FathomDEM ruled out** (CC BY-NC-SA — non-commercial). GLO-30 is the only clean open DEM backbone.

## 4. UI brief (from client, verbatim pillars)

- 3D, interactive; **left panel = main controls** (change/modify/see); **right panel = data insights**.
- **Layers + cards:** semi-transparent overlays making real-time state legible + public-facing data cards.
- **Aesthetic:** semi-realistic + Hollywood-inspired HUD — while keeping practicality and UX. Investible-grade polish; attracts investors AND researchers.
- **Ray-tracing toggle (on/off):** honest interpretation = **cinematic quality tier** (screen-space reflections on water, soft shadows, SSAO/GTAO, bloom, volumetric rain). True browser path tracing = WebGPU experiment for later R&D. Set expectations accordingly.
- Share exports are first-class features: pin-drop depth number → PNG square card; **9:16 animated rise loops via MediaRecorder on canvas.captureStream()**; state-in-URL deep links.
- Validation/"truth mode" tab is first-class UI: observed-extent overlays + hit-rate/confusion matrix in-page.

## 5. Brand system (extracted from live site CSS — use these tokens, invent nothing)

**Fonts:** Mona Sans (variable 200–900 + italic, primary) · Noplato Mono condensed 400 + symbol-patch (Δ ° ± · arrows — instrument labels) · Geist Mono 400/600 (data readouts).

**Colours:** base `#050606` · paper `#ecedf0`/`#f4f6f8` · cyan `#6fcad6` + muted `#92c2cb` · bronze `#b08d57` · ink-muted `#8fa3a5` · surface/well/instrument `#0b2c2e`/`#1a262c`/`#10181c` · **hairline `#6fcad624`** (cyan @14% alpha — the existing semi-transparent overlay language; extend it, don't invent a parallel system).

Visual identity: drafting-sheet motif (SHEET CS/01 · REV 0.4 · SCALE 1:DECISION), Δ mark, coordinates as decoration, typographic italics for emphasis.

## 6. Honesty framework (brand-critical, non-negotiable)

1. Error bars visible on every number; uncertainty page per city (see existing `/uncertainty` page as the gold standard).
2. Measured vs generated/synthetic visually badged, always.
3. Mumbai disclaimers: tool shows pluvial + coastal inundation *potential* over natural/spill topology — NOT stormwater-drain dynamics (no open data exists). "Planning-grade estimates… not certified engineering."
4. Designed-against failure: First Street × Zillow (Nov 2025, ~73k NC listings removed after accuracy disputes). Methodology transparency is the moat.
5. Flat-city rule (Mumbai): DEM vertical-uncertainty Monte Carlo at build time → depth *ranges* where slope < threshold.
6. Never depend on: NCM radar, Dubai Pulse, Dubai Municipality geoportal (all geo-blocked/closed — verified).

## 7. Dubai data quick-reference (P1a)

| Layer | Source | Licence |
|---|---|---|
| Terrain | Copernicus DEM GLO-30 | free-full-open (CDSE registration) |
| Building footprints | Microsoft GlobalML (CDLA-P2.0, refreshed 2026-08-13) ± Overture (ODbL — share-alike caution) | Google OB v3 excludes ALL GCC |
| Heights prior | DLR WSF3D 90 m raster | CC BY 4.0 (coarse — ship uncertainty band) |
| Rainfall forcing | ERA5 via CDS | CC BY 4.0 (since 2 Jul 2025) |
| Population | Meta HRSL UAE (HDX) | cc-by |
| Validation | Self-derived Sentinel-1 (CDSE) × Hong 2026 × Bersi 2025 | free/open |

Full per-city matrices incl. Mumbai deltas: `BUILD-SPEC-flood-explorer.md`.

## 8. Current status & next steps

- **Phase: BUILD — explicit go for design + code given 24 Aug 2026.** Decisions locked: cinematic storm-day intro · truth = visible HUD toggle · desktop-only v1 · compare-cities post-P2. v0.1 demo slice lives in `flood-explorer/` (Vite + TS + three.js; synthetic badged terrain; production priority-flood cascade on synthetic DEM; precomputed snapshots + client interpolation; brand-token HUD). Spec flags in preflight §9 still open for tech-lead sign-off; real-data work (CDSE/GLO-30) not started by design. Preflight research COMPLETE (4 delegated lanes, 24 Aug 2026): `research/floodsim-preflight-research.md` — 13 spec flags in its §9 await client/tech-lead decision before build.
- **Client instruction standing: NO design, NO code until explicit go.**
- Open questions listed in `BRIEF-floodsim-ui.md` §5 (camera default, water style, truth-mode visibility, mobile scope, compare-cities, ray-tracing expectations).

## 9. Read next (in order)

1. `BUILD-SPEC-flood-explorer.md` — full engineering spec, per-city data matrices, physics deltas, definition-of-done
2. `BRIEF-floodsim-ui.md` — UI intake: pillars, reference inventory, brand tokens, open questions
3. `FINAL-refined-audit.md` — the audited fact base (every claim verified; corrections log; absent-evidence register)
4. `CONCEPT-greenprint.md` — the follow-on procedural product (context for shared tile formats + brand rules)

Deeper reference (read on demand): `research/floodsim-preflight-research.md` (preflight research, 24 Aug 2026 — event science, validation canon, methods ranking, rendering SOTA, market/data currency; spec flags in its §9) · `gcc-audit/GCC-open-data-audit.md`, `eu-open-data-audit-2026.md`, `procedural-gen-github-audit.md`, `solarpunk-stack.md`, `research/virality-report.md`.

## 10. First-session bootstrap (new workspace)

```
1. Read HANDOFF-floodsim.md (this file)
2. Read the four docs in §9
3. Confirm orientation back to client in ≤10 bullets
4. Collect reference descriptions (§8) → then, and only then, design work on client's go
```

**Tone note from client:** direct, no fluff, honesty above comfort — if something can't be done, say so plainly.
