# Δ Delta — Flood Explorer · Dubai P1A · demo build (v0.1)

Vertical slice: **synthetic badged terrain + production algorithm + brand HUD**, per
`BRIEF-floodsim-ui.md` §1.1 A3 (client go: design + code, 24 Aug 2026).

## Run

```
npm install
npm run dev        # http://127.0.0.1:5173
npm run check      # solver self-check — water budget, response, monotonicity
npm run typecheck
npm run build
```

Desktop-only v1 (client decision). Chrome/Edge/Firefox/Safari current, WebGL2.

## What is real vs synthetic (brand rule)

- REAL (production path): the hydrology — priority-flood depression filling,
  a depression HIERARCHY with Fill-Spill-Merge routing (Barnes, Callaghan &
  Wickert 2021, ESurf 9:105-131), rate-limited rainfall losses, per-node
  stage-volume curves, precomputed snapshots, client interpolation,
  depth grid === render grid. `npm run check` closes the water budget.
- SYNTHETIC (badged in UI): terrain (seed 0x0DE1A01), building blocks
  (seed 0x00C17A5), rainfall forcing, population counts.
- NO OBSERVED DATA AT ALL. The truth toggle holds a HAND cross-check (Nobre et
  al. 2016) — an INDEPENDENT extent method over the same terrain, per
  preflight §4's "#1 core + #5 free QA overlay". It replaced a 5%-flipped copy
  of the solver's own output, which made CSI unable to fall below ~0.9 whatever
  the solver did. HAND is a proxy, not an observation; real validation is
  Sentinel-1 derived extent and is not in this demo. Real data (GLO-30, GlobalML, HRSL, Sentinel-1) lands with
  the build pipeline — spec flags in `research/floodsim-preflight-research.md` §9.
- MEASURED facts in the EVENT FACTS card: NCM 254.8 mm Khatm Al Shakla,
  Hussein et al. 2025 (Dubai >142 mm/24 h vs 94.7 mm annual), insured-loss range
  Gallagher Re / Guy Carpenter.

## Controls

- Drag = orbit · wheel = zoom · click terrain = pin depth
- Rain slider + presets (APR-2024 = 220 mm composite)
- `C` cinematic tier on/off · `T` truth mode · buttons in HUD

## Solver history (read before touching sim.ts)

v0.1 shipped a solver that could not respond to rainfall: all eight snapshots
were bit-identical, so the slider, the APR-2024 preset and the truth metrics
were wired to a constant field while the HUD reported which snapshots it was
interpolating. Four defects, all silent:

1. Stage-volume curves in metre-cells compared against inflow in m3 — storage
   understated by CELL^2 = 576, so every basin sat pinned at its rim.
2. `downstream` was -1 for all 20 depressions, so the spill cascade never ran.
   The walk started at the depression's own low point on the FILLED surface,
   where `next` is -1 by construction — it never took a step.
3. The level solve counted one cell too many (the one above the waterline).
4. No infiltration: 100 % of rainfall became runoff.

`npm run check` fails on any of these. Keep it in front of solver changes.

## Known limits (honest, not bugs)

- Below ~29 mm of rain there is no runoff at all (initial abstraction 5 mm +
  4 mm/h over 6 h). The 15 mm scenario stop is therefore dry by design.
- Above ~100 mm the domain is SPILL-LIMITED: the synthetic terrain holds only
  ~287,000 m3 below its rims (~30 mm averaged over 9.4 km2), so marginal rain
  leaves rather than deepening. The `toSea` term makes this visible instead of
  hiding it. This is the fill-spill framing tension recorded in
  `research/floodsim-preflight-research.md` §4 — flat coastal pluvial water
  sheets seaward rather than ponding in DEM depressions.

## Known gaps (next)

1. SSR on water (half-res, masked) — cinematic tier currently bloom + rain + specular.
2. PCSS soft shadows, GTAO pass.
3. Share exports (pin card PNG, 9:16 MediaRecorder loop), state-in-URL.
3b. Real observed extents (Sentinel-1 via CDSE) to replace the HAND proxy in
   the truth tab — the only thing that turns it into actual validation.
4. Real DEM ingest (GLO-30 2024_1, pinned) + GlobalML footprints (new blob host).
5. RFSM-style spreading mode for sheet flow on the flat coastal strip.
