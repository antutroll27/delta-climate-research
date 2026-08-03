# OpenCity dataset integration — specification

**Status:** approved for design 2026-08-03 · **water geometry + animation SHIPPED same day**
(branch `water-3d`); the rest not started
**Evidence:** every claim verified against downloaded data on 2026-08-03 (CKAN API,
45 datasets reviewed; probe results inline)
**Predecessors:** `heat-map-calibration-spec.md`,
`2026-08-02-landsat-thermal-validation-design.md`

---

## 1 · Why

The CEO surfaced data.opencity.in's Kolkata catalogue. Of 45 datasets, five are usable.
Separately, a probe proved the OSM basemap carries real water polygon geometry over all
three wards — while the water census KML is points-only (3,051 points, **0 polygons**;
nearest record to Baruipur 11.4 km, to Barrackpore 14.5 km). So geometry comes from OSM
and the census contributes attributes later, where it exists (KMC only).

The binding constraint is codebase growth. Every feature here follows the tier rule the
repo already practises:

```
1 ACQUISITION  scripts/*.py offline · never at runtime
      ↓ committed artefact + provenance (source, retrieved, licence)
2 PURE MODULE  climate-engine/*.ts · node-testable · one unit test
      ↓ plain data in, plain data out
3 WIRING       heat-map-app.ts · imports + binds, nothing else
```

Discipline, explicit: a feature may add wiring lines to `heat-map-app.ts`; the moment it
wants more than ~40, it becomes a module. The browser ships derived artefacts, never raw
archives.

## 2 · Water — geometry + animation (SHIPPED); physics gated

### What shipped (render only, no physics)

- **`scripts/fetch-water.py`** — Overpass → `{ward}-water.json` in the roads-family
  contract `{ward, count, source, polys:[{k, p:[x,y,…]}]}`: ward-centred metres,
  1-decimal, rings clipped Sutherland–Hodgman to ±760 m (roads carry vertices to ~755,
  so the clip sits past the window, not at it), multipolygon outers stitched by endpoint
  matching, ≥60 m² after clip. Classes: `water | river | pool`. `--check` self-asserts.
  Measured yield: **Ballygunge 7 polys / 1.41 ha · Baruipur 12 / 3.63 · Barrackpore
  67 / 12.01 ha** — the river ward is water-rich, as it should be.
  This is also the repo's **first committed OSM fetcher**: the three `*-roads.json`
  artefacts never had their generator committed (noted in
  `docs/heat-map-implementation.md`); regenerating roads through this shape is now
  possible, not done here.
- **`src/scripts/climate-engine/water-layer.ts`** (tier-2 module) — rings →
  `ShapeGeometry`, merged to **one mesh, one draw call**; `ShaderMaterial` with a
  two-band ripple + sparse glints in the stage's own palette (deep teal base, #6fcad6
  glints); rivers drift directionally via a per-vertex `aFlow` flag, ponds shimmer in
  place. `uGrow` is the **shared** facade uniform, so water fades in with the same
  reconstruction the buildings play. y = 0.9 (above the heat overlay at 0.6, below every
  roof), `depthWrite:false`.
- **Wiring** (~20 lines in `heat-map-app.ts`): cached fetch with the swallow-to-empty
  loader idiom, dispose-and-recreate on ward switch, dispose on unmount, and one line in
  the render callback advancing `uTime`.
- **No new animation loop.** The shimmer advances **only inside the custom layer's
  render callback**, riding repaints the map already performs (idle orbit, drags, the
  sim bridge's cadence). Under `prefers-reduced-motion` the clock never advances:
  still water. Measured: mean pixel delta 3.94/0.9 s animating, page clean under a
  reduced-motion context.

### The gate that stayed shut (4B — physics)

The simulation **already reads** `layers.water` — `sim-ts.ts:67` (ventilation
`+0.65·water`) and `:77` (relaxation toward `tAir−1.5`), mirrored in `sim-gpu.ts` —
and the terms collapse to identity because the layer ships zeros. Filling it changes
the displayed ward mean (`sim.stats().meanC`), most for Barrackpore. That makes it a
**calibration-gated model activation, not a data drop**:

- Gate: per-ward meanC delta with/without water recorded in the PR; any |delta| > 0.1 K
  requires the measure-accuracy re-run and the documented-drift protocol before merge.
- Tripwire shipped now: `tests/unit/heat-map-water.test.mjs` fails if any renderer-side
  file assigns into a water array, and if `ward-raster.ts`'s explicit zero-fill
  disappears. The test names the protocol so the failure teaches.
- 4B also updates the cooling-surfaces copy ("water refuges not shown" becomes partly
  false) — that copy change goes through the honesty checklist with it.

**Attribution** (user call): extend the legend's single credits string — it already
carries OSM/Microsoft/Google; water adds `· Water © OSM (ODbL)` to the same sentence,
plus `pond data Jal Dharohar 2018-19 (KMC)` if/when census attributes join. The
artefact itself carries `source` in-band, asserted by test.

## 3 · Heatwave phase (IMD 74-year record) — next up

**Evidence:** 26,747/26,806 usable daily rows (99.8 %); Temp Max p50 31.7 · p95 36.3 ·
**p99 38.4** · max 43.0 °C. Artefact: `public/heat-map/data/heatwave-percentiles.json`
(~1 KB derived table; the 26,806-row CSV stays pipeline-side).

**Design — follow the Now precedent, never widen the phase union.** The repo already
refused the widening (`heat-map-app.ts` ~1228: *"'Now' is not a third value of
`state.phase`"*). Heatwave is a **forcing override**: a fourth `#segPhase` button sets
`state.phase = 'peak'` plus a scenario flag; the Ambient assembly substitutes
`tAir = p99 tmax` while keeping today's live rh/wind/cloud. Honestly framed: **"today's
weather at 1-in-100 heat"** — we hold a 74-year air-temperature record, not a record of
heatwave-day humidity. The seg handler's blind `p as 'peak'|'night'` cast is removed in
the same change. Accuracy chip keeps showing the peak band (peak physics, scenario
forcing) with the scenario named beside it. `.seg` CSS is elastic (verified); the label
is `Heatwave`, no number, to hold the row's width. Compare is untouched — its
reference-forcing contract is pinned.

## 4 · AQI, all 7 stations — acquisition + evidence, no UI

Raw hourly CSVs (2017–2023) into `data/opencity/aqi/` (pipeline-side; too heavy to
serve). One derivation → `data/opencity/aqi-daily.json`: per-station daily mean/max.
Purpose now is **validation evidence** — one station IS Ballygunge, a calibration-grade
record beside a modelled ward. Deliverable beyond the artefact: a findings note in
`docs/heat-map-feature.md`. Any map layer is a future spec.

## 5 · Parks — downgraded by evidence

KMC-ward-keyed: Ballygunge only; Baruipur and Barrackpore are separate municipalities.
An indicator measurable for one ward of three cannot score a three-ward comparison, so
the DC-URS route is **dead — recorded so nobody retries it**. Also: area on 34/93 rows,
units unstated; licence unspecified. Ships as acquisition + manifest row only; surfacing
is blocked on two facts someone must obtain (licence, area unit), both recorded as
blockers in the manifest entry.

## 6 · Microwatersheds — acquisition only, firmly not heat-map

All three wards verified inside containing polygons (point-in-polygon: MWS 2A1A5k3 /
2A1A5h3 / 2A1C1a5, basin 2A) — but the median polygon is ~5–8× the ward window.
City-scale drainage context = a **second instrument**, own route, own spec, later.
Here: one fetcher row, one manifest entry, zero runtime code.

## 7 · Acquisition manifest (remaining datasets)

`scripts/fetch-opencity.py`, table-driven — one row per resource; `data/opencity/
manifest.json` records `{source_url, retrieved, licence, sha256, notes}` per artefact.
Licence facts, including the uncomfortable ones:

| dataset | licence | consequence |
|---|---|---|
| IMD daily temp 1951–2024 | Public domain | free to publish |
| Water census KML | Public domain | attributes join, later |
| Microwatersheds GeoJSON | Public domain | free to publish |
| Hourly AQI (7 stations) | Public domain | free to publish |
| KMC Parks | **not stated** | acquire + record; NOT displayed until confirmed |

## 8 · Out of scope

Compare-page heatwave forcing · any AQI or microwatershed UI · roads regeneration ·
schools/parks geocoding · any change to `accuracy.ts`, `DEFAULT_PARAMS`, or fitted
constants · sim water activation (gated above).

## 9 · Acceptance

- **Water (done):** three `{ward}-water.json` in the roads-family contract; one mesh,
  one draw call; animation rides existing repaints only; reduced-motion = still; sim
  water channel zero, asserted by test; `npm run verify` green (70 unit · 23 e2e at
  ship time).
- **Heatwave:** phase union unchanged outside the seg handler; blind cast gone;
  percentile artefact regenerates byte-identically; honesty note visible.
- **Acquisition:** every artefact in the manifest with licence recorded; parks entry
  carries its two blockers.
- Throughout: artefacts regenerable by one command; `npm run verify` green.
