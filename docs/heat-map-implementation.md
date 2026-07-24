# `/heat-map` — Implementation Plan

**What this doc is:** the engineering port plan from the feature-complete prototype
(`previews/heat-map/index.html`, single-file, CDN deps) into the production Astro repo.
Contract: [`heat-map-page-spec.md`](heat-map-page-spec.md) · formulas:
[`heat-map-intervention-model.md`](heat-map-intervention-model.md).
The prototype is the reference implementation — port faithfully, do not redesign.

---

## 1 · Target file tree

```
src/pages/heat-map.astro                     ← route (RENAME HeatMapVisualizer.astro; noindex prop until data real)
src/components/ClimateEngine/
  HeatMapStage.astro                         ← markup shell: map container, panels, chips, legend, strip
src/scripts/climate-engine/                  (existing: caps.ts · types.ts · sim-gpu.ts)
  heat-map-page.ts                           ← entry: boots stage, owns lifecycle (the ONLY side-effectful module)
  map-stage.ts                               ← MapLibre init, custom three layer, camera/orbit/drag, env & mode toggles
  massing.ts                                 ← ward JSON → merged ExtrudeGeometry + aDelay/aH/aCtr attrs + facade material
  intervention-engine.ts                     ← rasterBase · buildSpatial · applyInterventions · computeGreenG · computeCost
  live-ambient.ts                            ← Met Norway fetch (via proxy), heatIndexC, per-ward cache
  instrument.ts                              ← DOM wiring: sliders/segs/tabs/readouts/histogram/score
  model-constants.ts                         ← every cited constant from the model doc (single source; JSDoc the citations)
  sim-ts.ts                                  ← ★ REQUIRED BEFORE LAUNCH: CPU HeatSim for caps backend 'ts' (tier 0/1)
api/ambient.ts                               ← Vercel fn: met.no proxy (identifying UA, 1 h s-maxage, ward-allowlisted)
public/heat-map/data/
  {ward}.json · {ward}-roads.json            ← moved from previews/heat-map-3d/data/ (versioned static assets)
scripts/heat-map-data/                       ← build-time pipeline (run manually, commit outputs)
  extract-wards.mjs                          ← MS footprints → ward JSONs   (exists in scratchpad; commit it)
  fetch-heights.py                           ← Google 2.5D zonal means      (from session transcript; commit it)
  fetch-roads.py                             ← Overpass centerlines         (from session transcript; commit it)
```

Monolith → module mapping is 1:1 with the prototype's section comments (`/* ══ … ══ */`);
keep the section names as module docstrings so diffing against the prototype stays easy.

## 2 · Dependencies & bundling

- `npm i maplibre-gl@^4.7` (+ its CSS import in the Astro page). ~230 KB gz — the big rock;
  load the whole stage `client:visible`-style via dynamic `import()` behind an IO gate.
- three: use the existing tree-shaken facade `src/scripts/three-runtime.ts`. **Facade gap**
  for the map stage (add + verify tree-shake): `PlaneGeometry, HemisphereLight,
  DirectionalLight, Matrix4, Vector3, Camera, LinearFilter, ExtrudeGeometry, Shape,
  BufferAttribute, MeshStandardMaterial` and `mergeGeometries`
  (`three/examples/jsm/utils/BufferGeometryUtils`). The 7 sim symbols are already in.
- `sim-gpu` imports the facade already — the preview's esbuild `--external:three` bundle
  step disappears in-repo (Astro/Vite resolves it).
- No React island needed: this is the vanilla-TS core + thin Astro shell per the standing
  decision. `Base.astro`: opt OUT of Lenis smooth-scroll for this full-viewport tool.

## 3 · Port checklist (each = prototype section → module, with the gotchas we already solved)

1. **Map + custom layer** (`map-stage.ts`): MapLibre `pixelRatio ≤ 1.75`; custom layer
   `renderingMode:'3d'`; projection matrix = `fromArray(matrix) · translate(mc) ·
   scale(s,−s,s) · rotateX(π/2)`; `renderer.autoClear=false` + `resetState()` per frame;
   **onAdd idempotent** (style swaps re-add the layer; scene must survive).
   `triggerRepaint` ONLY while `grow<1 || fieldDirty` — idle map goes quiet.
2. **Controls** (`map-stage.ts`): custom LEFT-orbit/RIGHT-pan pointer handlers,
   **frame-coalesced into one `jumpTo`/frame + inertia** (do NOT revert to per-event
   `setBearing`). `dragRotate/dragPan.disable()`, `maxPitch 78`, contextmenu suppressed.
   TODO carried over: one-finger touch pan (currently pinch-only on mobile).
3. **Massing** (`massing.ts`): ExtrudeGeometry with bevel (thickness .7/size .55/seg 1,
   depth −1.4 compensation, plain fallback on degenerate shapes) — **bevel OFF below
   tier 2**. Attributes aDelay (radial-wave stagger) / aH / aCtr (centroid). Facade
   material: onBeforeCompile grow + clay/heat tint + line-art + parapet + damped speckle;
   uniforms growU/studioU/sizeU/tintU shared as module singletons.
4. **Sim host** (`heat-map-page.ts`): offscreen `WebGLRenderer` for `GpuHeatSim` when
   `caps.backend==='gpu'`; worker-hosted `sim-ts` otherwise (grid from `caps.grid` —
   **parameterise SIM_N**, it is a const 192 in the prototype). Bridge: 2-channel
   R=3×3-blur / G=raw texture, ≤1.5 Hz, paused during drag; RESET_BURST=600 after reset.
   ⚠️ **Solver stability (bit us — the prototype's reds were partly this):** `cflDt` must be
   `0.2/D`, not the textbook `0.25/D`. At the pure-diffusion edge the source/sink term (−k·T)
   tips the checkerboard mode to |g|>1, so the field diverges to a spurious hot mean (~38°C)
   that **ignores the live forcing** — looks like "the API isn't wired". Margin fixes it; keep
   `assertSimLogic` guarding the bound. `sim-ts.ts` must use the same `stableDt`.
5. **Intervention engine** (`intervention-engine.ts`): port verbatim from the prototype +
   `model-constants.ts`; add the model doc §7 asserts as a dev-mode self-check
   (`assertInterventionLogic()`, node-runnable like `assertCapsLogic`).
6. **Live ambient** (`live-ambient.ts`): swap direct met.no URL → `/api/ambient?ward=`;
   keep browser-direct as dev fallback. Proxy sets `User-Agent:
   DeltaClimateResearch/1.0 (deltaclimate.earth; contact <env>)`, `s-maxage=3600`.
7. **Instrument** (`instrument.ts`): DOM wiring exactly as prototype (sliders fire sim on
   `change`, labels on `input`; nudgeOrbit on interaction). Score/₹ formulas from
   `model-constants.ts` only — no magic numbers in this file.
8. **Lifecycle** (`heat-map-page.ts`, HeroRiver.tsx as the template): IO gate → boot on
   visible; `visibilitychange` → pause sim loop + orbit; `webglcontextlost` on BOTH
   contexts → teardown + soft retry; navigate-away dispose = `map.remove()`, dispose
   geometries/materials/RTs, cancel rAFs, abort in-flight fetches. **Leak-check this** —
   two GL contexts is the risk spot.

## 4 · Phases & effort (each lands green before the next)

| Phase | Scope | Est. |
|---|---|---|
| P1 ✅ | Modules + route port, GPU path, data under `public/`, maplibre dep, page boots + instrument works in the production build (2026-07-24) | DONE |
| P2 | `sim-ts.ts` (+worker host) + SIM_N parameterisation + tier gates (bevel/orbit/grid/DPR) | 1 day |
| P3 | `/api/ambient` proxy + lifecycle/dispose hardening + a11y pass (labels, focus, axe) | 0.5-1 day |
| P4 | Verification suite (below) + payload/fps logging + `noindex` ship 🚀 | 0.5 day |
| P5+ | Heatwave scenario · cited tooltips · CPCB overlay · Landsat LST layer · report CTA | roadmap |

## 5 · Verification (definition of done for P4)

- `npm run check` 0 errors · `npm run build` green · `assertSimLogic` + `assertCapsLogic`
  + new `assertInterventionLogic` all pass (CI-runnable via `node --experimental-strip-types`).
- e2e (`tests/e2e/`): `/heat-map` loads, both canvases present, **zero console errors**,
  every control keyboard-operable, axe WCAG 2.2 AA clean, reduced-motion renders static.
- CDP fps probe: ≥55 fps during scripted drag on tier-2; no long tasks > 120 ms after boot.
- Leak check: SPA-navigate away/back ×3 → stable GL context count, no orphaned rAF/fetch.
- Mobile 390×844 DPR3: tier drop applies (no bevels, smaller grid), pinch works, panels usable.
- Payload recorded: JS gz total, per-ward data, first-interaction time (throttled 4G).
- Honesty checklist from the spec §7 walked item-by-item on the built page.

## 6 · Known deliberate gaps (do not "fix" silently)

- `sim-ts.ts` absent (prototype is GPU-only) — required before launch, P2.
- One-finger touch pan missing — P2/P3.
- Wetland variant of the parks slider not exposed (cost placeholder) — phase 5.
- Pathway deltas illustrative — labelled, awaiting cited projections.
- Standalone `previews/heat-map-3d/` keeps the old red look + `D=0.15` (it's a massing
  look-study now; only the instrument carries the model).
