# `/heat-map` — Page Specification

**What this doc is:** the product contract for the production Heatmap page — what it does,
for whom, and the non-negotiables. The *how* lives in
[`heat-map-implementation.md`](heat-map-implementation.md); the physics/formulas in
[`heat-map-intervention-model.md`](heat-map-intervention-model.md); history/decisions in
[`heat-map-feature.md`](heat-map-feature.md).
**Reference build:** `previews/heat-map/index.html` — feature-complete prototype; the page
is a port of it, not a redesign.

---

## 1 · Purpose & audience

An interactive **Urban Heat Scenario Explorer** for three Kolkata wards — Ballygunge
(urban core), Baruipur (peri-urban fringe), Barrackpore (industrial river corridor) —
demonstrating Delta's street-scale heat capability. Primary audiences:
1. **Municipal officers / programme staff** (the pitch target): compare wards, test green
   interventions, see costs in ₹ and results in °C.
2. **Prospective clients & press**: the interactive proof that Delta's rigour is real.
3. **Search** — a genuinely indexable flagship page (once the data story is real).

It is a **screening tool**, sold as such — never a forecast (see §7).

## 2 · The stage

- **Live MapLibre basemap** (OpenFreeMap tiles, keyless) with the ward's **real buildings**
  (Microsoft footprints × Google 2.5D-Temporal heights) as a georegistered three.js custom
  layer, and the **live GPU heat field** draped over the streets, edge-feathered.
- **Camera language:** LEFT-drag = orbit (rotate + tilt) · RIGHT-drag = pan · scroll = zoom
  · pinch on touch. Frame-coalesced with inertia glide (the "buttery" contract: ≥ 55 fps
  mid-drag on a desktop tier-2 device). Idle **auto-orbit** (clockwise, ~1.4°/s) that pauses
  on ANY interaction (map or controls) and resumes after ~2.5 s; never for reduced-motion.
- **Entrance:** buildings grow in as a staggered radial wave (easeOutBack) choreographed
  with the ward fly-to; heat field fades in beneath. Instant for reduced-motion.

## 3 · Modes (all user-facing toggles, bottom chip row)

| Toggle | Options | Default |
|---|---|---|
| View | **3D Relief** (pitch 60°) / **2D Isotherm** (top-down, orbit off) | 3D Relief |
| Environment | **Dark map** / **Clay studio** (positron light basemap, ink type) | Dark map *(open decision — CEO may flip)* |
| Building tint | **Gradient** (continuous ramp) / **5-Class** (legend classes) | Gradient |

## 4 · The instrument (chrome contract)

- **Left panel — Green Infrastructure Toolbox:** 4 sliders (Tree canopy corridors 0-50,
  Cool-roof albedo 0-100 %, Pocket parks/wetlands 0-10, Vertical green facades 0-15),
  Diurnal phase (13:00 Peak / 22:00 Retained), Projection pathway (2025 / Δ-Target '30 /
  BAU '40), **Green Score** radial (0-100) with sub-readout `−X.XX °C · N % green ·
  ₹<cost> capital cost`.
- **Right panel:** Live ambient (Met Norway: air/feels/RH/wind + green live-dot) ·
  Mean Surface Temp (modelled, colour-coded) · UHI Δ vs rural · Area > 40 °C ·
  heat-stress histogram (12 bins, 26–48 °C) · "Generate ward report" CTA (phase 2).
- **Top bar:** brand · ward tabs · coordinates + building count + GPU-SIM tag.
- **Bottom strip:** 3-ward comparison cards (live mean °C for visited wards).
- **Legend (bottom-right):** plain-language colour index (Comfortable→Extreme, red-top) +
  °C ramp + attribution block.
- **Every slider/seg is functional** — it re-rasterises intervention layers and resets the
  sim per the model spec. No decorative controls (the CEO-prototype budget bug must not
  recur: budget is computed and displayed, never static).

## 5 · Data contracts

| Data | Source → asset | Freshness |
|---|---|---|
| Footprints + heights | MS footprints × Google 2.5D → `data/{ward}.json` (~190-270 KB) | build-time, versioned |
| Road centerlines | OSM Overpass → `data/{ward}-roads.json` (~36-45 KB) | build-time, versioned |
| Live ambient | Met Norway locationforecast via **our proxy** (identifying UA, 1 h cache) | runtime, per-ward |
| Heat field | GPU sim (offscreen) → 2-channel DataTexture (R blur / G raw) | live |
| Model constants | `heat-map-intervention-model.md` (all cited) | versioned with the doc |
| Phase 2 | CPCB station AQI (proxy) · Landsat LST comparison raster · FIRMS | per roadmap |

## 6 · Performance & tiering budgets

- Tier-gated via `caps.ts` + `render-quality.ts`: grid N (192 tier-2 / 128 / 64), bevels
  off + reduced instance detail on coarse-pointer tiers, `pixelRatio ≤ 1.75`, sim backend
  per `caps.ts` (`gpu` tier-2, `ts` fallback — **sim-ts.ts must exist before launch**).
- Readbacks ≤ ~1.5 Hz, paused during drag; map repaints only while animating.
- Payload budget: ≤ ~600 KB gzip JS (maplibre ≈ 230 KB gz is the big rock) + ward data
  lazy per ward; measure and record in the perf log before launch.
- Reduced-motion: static frame, no orbit/grow/sim stepping (one converged solve).

## 7 · Honesty & labelling (non-negotiable, verbatim rules)

1. Banner always visible: **"Live basemap + real footprints & Google heights · heat field
   modelled"** (or current wording) — a stamp, not a footnote.
2. Measured vs modelled is explicit in the UI: live ambient = *measured*; surface temp =
   *modelled relative estimate (2D energy-balance screening)*.
3. The model claims **relative** comparisons, hotspots, prioritisation — never absolute
   forecasts, comfort indices, or a bare "we will cool your ward by X °C".
4. Pathway deltas are labelled *illustrative* until anchored to cited projections.
5. Cited display anchors (cool roof −30 °C surface etc.) are shown as **literature**, never
   as this model's output.
6. Wetland costs = flagged placeholder; park ₹ = fully-appointed-garden figures.
7. On-page attribution: © OpenStreetMap · OpenFreeMap · Microsoft footprints (ODbL) ·
   Google Open Buildings 2.5D (CC BY 4.0) · "Data from MET Norway".
8. `noindex` until a measured raster (Landsat LST) is wired; then flip + sitemap.

## 8 · Accessibility

Keyboard-reachable controls (native inputs already), focus states, `aria-label`s on chip
toggles, `prefers-reduced-motion` honoured everywhere, WCAG 2.2 AA contrast for all chrome
(heat ramp is data, exempt but paired with the plain-language index), axe-clean e2e.

## 9 · Out of scope (this page, v1)

Pathways tab · AlphaEarth similarity layer · CPCB/FIRMS overlays · report-PDF generation ·
drone-splat showcase · WASM backend. All tracked in `heat-map-feature.md` phases.
