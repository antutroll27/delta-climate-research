# UI INTAKE BRIEF — Flood Simulator (Dubai P1a)
**Status: UNDERSTANDING PHASE — no design, no code until client says go.**
**Source brief: verbatim client message, 23 Aug 2026. Reference images: 8 received WITH pixel content (second delivery, same session day); client direction attached verbatim: "want it to be semi realistic with ray tracing and the option to switch it off".**

---

## 1. Client brief — verbatim pillars

1. **3D + interactive.** The tool that "defines Dubai".
2. **Typography:** same fonts as deltaclimate.earth.
3. **Layers + cards.** Semi-transparent overlays "for understanding the stuff that's going on in real time" + data/info cards for the public.
4. **Layout:** LEFT = main panel (change/modify/see). RIGHT = data insights.
5. **Audience pull:** investible; eyeball-grabbing AND genuinely useful at its core; attracts investors AND researchers.
6. **Ray tracing:** on/off toggle requested.
7. **Aesthetic:** semi-realistic, mixed with Hollywood-inspired HUD — while keeping practicality and UX.
8. **Process:** design/code only on explicit go.

### 1.1 Client addenda (post-reference delivery, same day)

- **A1 — Rendering:** "want it to be semi realistic with ray tracing and the option to switch it off" → mapped to the cinematic-tier toggle, §4.1.
- **A2 — Cards on both sides:** "the left sidebar and the right side should also have card UIs for data" → both panels carry card UIs, not just the right. Working interpretation (intake, not yet designed):
  - **Card anatomy (brand tokens only):** surface `#0b2c2e` / instrument `#10181c` well · hairline border `#6fcad624` (± R3 corner brackets) · label in Noplato Mono caps · value in Geist Mono 600 with unit + delta muted `#8fa3a5` · badge slot for measured/synthetic · optional glass variant when floating over 3D (R2).
  - **LEFT = control cards** (change/modify/see): rainfall scenario (mm/h slider + return-period readout) · event replay (Apr-2024) · layers stack · quality tier (cinematic on/off) · camera.
  - **RIGHT = insight cards** (data): at-pin depth · city totals (inundated km², affected population via HRSL) · validation/truth (hit-rate + mini confusion matrix) · event facts (254.8 mm Khatm Al Shakla) · share/export.
  - Right cards may dock in the panel OR float scene-anchored (R2 glass cards, DOM-overlay per §4.2).
- **A3 — DECISIONS + GO (24 Aug 2026):** client answered all open questions (see §5) and gave **explicit go for design + code**. v0.1 vertical-slice scope: storm-day intro → orbit · synthetic badged terrain · production priority-flood cascade on synthetic DEM · precomputed snapshots + client lerp · depth→colour water shader · cinematic toggle (bloom/rain/specular) · left control cards + right insight cards · truth HUD toggle with live CSI/F1/POD/FAR vs synthetic observation · pin depth. Project: `flood-explorer/`.

## 2. Reference inventory (8 images — reviewed; hashes client-supplied)

| # | Dim | Hash | Content | What to steal for the flood sim |
|---|---|---|---|---|
| R1 | 1199×729 | `6d71279d…` | "Future Forest" hero: photoreal 3D forest diorama floating on pure black, fog-softened edges; hairline leader lines run from glowing nodes to tiny white label chips ("NODE CONNECTED", "TREE NETWORK · TREES CONNECTED: 12,368"); bottom-left LOCATION panel (dark globe thumb, × close, mono GPS readout); centre logotype with arrow glyph + ® | The scene-as-specimen hero: Dubai floating on `--color-base`; leader lines + label chips for pins/stations; corner data panels with mono GPS/coordinate readouts; single-accent restraint (their green ≈ our cyan) |
| R2 | 1179×1168 | `0cf2b4a1…` | "kopter" drone flight-planner: dense dark instrument chrome over a dimmed satellite map — top nav, left telemetry stack (VOLT/°C/MAH, cm/px, status pill), right parameter table with paired sliders+readouts (resolution, overlap %), numbered waypoint chips 1–18 with vertical altitude tethers, floating glass cards (AMSL, GNSS 0.15 m/s), mini viewfinder panel with crosshair + bearing | The LEFT main-panel blueprint: control density + hierarchy, slider-with-readout pairing, segmented status pills; waypoint chips + vertical tethers → depth-probe pins with drop-lines to terrain; floating glass readout cards anchored to 3D; dim-the-scene contrast strategy so light chrome pops |
| R3 | 808×632 | `198400cf…` | Military tactical map ("TLE data", TASK FORCE 141): full-bleed dark-green satellite terrain, corner-bracket viewport frame, top dropdown mode rail (MAP · ROUTE · TRAIN · VIEW · LAYER), left rail process list ("cur.process: Tracking…"), lettered station markers A–F with north-lines + leader lines, bottom status bar with IR [T] toggle + timeline ticks | The strongest Hollywood-HUD anchor: corner brackets; top mode rail → LAYERS / VIEW / TRUTH MODE menus; lettered station markers → gauge/coastal stations; bottom status bar → event clock + replay scrubber; IR toggle → truth-mode hotkey |
| R4 | 1200×1311 | `e3ccd0c3…` | Exploded terrain slab: one 3D landscape decomposed into stacked parallel layers labelled ALL / HEIGHT / NORMAL / AO on black | The signature "layers" moment: pull Dubai's own stack apart (terrain / drainage graph / water-depth field / footprints / observed extent) as intro or layer-picker; the NORMAL layer's blue-violet ramp reads exactly like a depth map — validates depth-as-colour; honesty bonus: shows data is layered, not magic |
| R5 | 1200×859 | `a2eaa152…` | Macro moss render emerging from black: "NEW FLORA DETECTED" species list with one row highlighted as inverted chip, SECTOR ID + GPS readout, SPECIMEN panel with thumbnail + ×, tiny corner-bracket targets on individual mounds, white particle specks | The inspection pattern: click any feature → catalogue panel with highlighted selection; specimen card → building/pin card (footprint thumb, height prior, depth at pin, measured/synthetic badge); corner-bracket targeting; "detected" event language; particle specks as rain/flow motes |
| R6 | 918×810 | `2a736605…` | Raw photogrammetry scan of a stone building on white: unlit mesh/point-cloud with thin measurement callout (4.1992 m) and axis lines | The MEASURED visual language: truth-mode / observed-extent views render in this raw-scan style so measured data never looks like the cinematic sim layer (honesty rule #2 made visual); thin-arrow measurement callouts → depth annotations |
| R7 | 403×403 | `6c2cfb75…` | Monochrome LiDAR point-cloud city block on black, sparse red accents | Second measured-render tier: Sentinel-derived extents + GlobalML footprints as a point-cloud "scan" layer; red reserved for alert / max-depth states |
| R8 | 379×673 | `5425041d…` | 9:16 vertical photo of backlit leaves on near-black; thin white boxes + hairline leader lines connecting small text fragments | It is literally 9:16 — the share-loop canvas; annotation language for rise-loop exports: sparse chips + hairlines over imagery, editorial voice (public card) vs instrument voice (R2/R3) |

### 2.1 Synthesis — the borrowed language (four voices, one system)

1. **Instrument chrome** (R2, R3) → LEFT panel + HUD frame. Dense, dark-surface, mono type, paired slider+readout, corner brackets. Extends `--color-well` / `--color-instrument` + hairline.
2. **Specimen on black** (R1, R5, R7) → how the 3D scene is presented. City floats on `--color-base` with fog-softened edges; hairline leader lines + label chips; coordinates as decoration (already brand).
3. **Raw scan = measured** (R6, R7) → the truth-mode render tier. Unlit/point-cloud style + measurement callouts. The measured-vs-synthetic badge becomes a whole visual mode, not a sticker.
4. **Editorial 9:16** (R8) → the share layer. Sparse, calm, hairline boxes; the public-facing voice.
5. **R4 bridges 2+3**: the exploded-layer stack is the teachable "what am I looking at" moment.

Client note attached to delivery: **semi-realistic + ray-tracing toggle (on/off)** → see §4.1.

## 3. Brand tokens (extracted from live deltaclimate.earth CSS, 23 Aug 2026)

### Typography
| Family | Weights | Role on site |
|---|---|---|
| **Mona Sans** (variable) | 200–900 + italic | primary sans |
| **Noplato Mono** (condensed) | 400 + symbol-patch (Δ ° ± · arrows) | instrument/drafting labels |
| **Geist Mono** | 400 / 600 | secondary mono |

### Colour system
| Token | Value |
|---|---|
| `--color-base` | `#050606` |
| `--color-paper` / `--color-paper-bright` | `#ecedf0` / `#f4f6f8` |
| `--color-cyan` / `--color-cyan-muted` | `#6fcad6` / `#92c2cb` |
| `--color-bronze` | `#b08d57` |
| `--color-ink-muted` | `#8fa3a5` |
| `--color-surface` / `--color-well` / `--color-instrument` | `#0b2c2e` / `#1a262c` / `#10181c` |
| `--color-hairline` | `#6fcad624` ← cyan @14% alpha — the existing semi-transparent hairline system |

**Note:** the requested "semi-transparent stuff" has a native token already (`hairline`); the HUD language should extend this system rather than invent a new one.

## 4. Technical reality notes (to discuss at design phase — NOT decided)

1. **"Ray tracing" toggle:** true ray tracing in a browser = WebGPU path tracing (experimental, high-end-GPU-only, long load). Realistic interpretation: a **quality-tier toggle** — OFF = fast WebGL2 pipeline; ON = "cinematic tier" (screen-space reflections on water, soft shadows, SSAO/GTAO, bloom, volumetric-ish rain) that *reads* as ray-traced. WebGPU path-traced preview could be a later R&D flag. **Client direction received with refs: "semi realistic with ray tracing and the option to switch it off" — mapped onto this cinematic-tier interpretation; literal path tracing stays a later WebGPU R&D flag. Explicit client OK on the mapping still pending.**
2. **HUD cards over 3D:** DOM-overlay anchored to scene positions (CSS2DRenderer-style) keeps text crisp + accessible; canvas-drawn HUD only for effects. A11y + SEO of data cards matters to the researcher audience.
3. **"Real-time" honesty:** the sim is precomputed-state interpolation (build spec §1); the UI must convey liveness (tide clock, rainfall nowcast, event replay) without claiming live hydraulics. Wording on cards matters to the brand.
4. **Rendering + validation SOTA (researched 24 Aug 2026):** cinematic-tier and scan-tier recipes with verified licences and perf caveats → `research/floodsim-preflight-research.md` §7; validation-metrics canon for the truth tab (CSI/F1/POD/FAR + mandatory caveats) → same file §2.

## 5. Open questions (answered by references/description or client)
1. ~~What are the 8 references and what does each contribute?~~ — **ANSWERED**: pixel content received and reviewed; §2 + §2.1 updated.
2. Camera default — **ANSWERED (go round, 24 Aug 2026): cinematic storm-day intro** — guided rain fly-in handing over to free orbit.
3. Water style — **ANSWERED by client**: "semi realistic" → hybrid (readable depth-colour ramp carried by realistic shading/reflection cues).
4. Truth mode — **ANSWERED: visible HUD toggle** (R3-style IR toggle) in v1.
5. Mobile scope — **ANSWERED: desktop-only v1** (mobile visitors get a notice).
6. Compare-cities — **ANSWERED: later, post-P2**.

## 6. Standing instruction
NO design artefacts, NO code, until client says go. This document may be updated as references arrive.
