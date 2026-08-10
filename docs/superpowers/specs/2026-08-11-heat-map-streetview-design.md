# Heat-map street-view (Mapillary ground-truth) — design spec

*Delta Climate Research · 2026-08-11 · status: **verified**, approved for planning*

Related: [[heat-map-vegetation-build]] · vegetation shipped 2026-08-10. This adds a Mapillary "ground-truth" layer to the same `/heat-map` twin. Spec claims were verified 2026-08-11 against the codebase and Mapillary's current (2026) API — see §12.

---

## 1. Goal

Extend the twin's **"receipts, not renders"** thesis to the eye: let a viewer click a
covered spot and see the **real Kolkata street** (community-captured Mapillary imagery),
so the modelled twin can be checked against reality on sight. Purpose is **credibility +
investor appeal**, not a change to the physics or the vegetation data.

Decided (brainstorm): **both, phased** — ship the street-view credibility layer now
(Phase 1); attempt a canopy-validation stat later (Phase 2, outlined).

## 2. Coverage reality (measured 2026-08-10, governs the design)

Mapillary coverage is uneven and the feature must be **honest about it**:

| Ward | In-ward images | Vintage | Street-view usefulness |
|------|----------------|---------|------------------------|
| **barrackpore** | ~198 | **all 2026 (fresh)** | solid — the demo ward |
| **ballygunge** | ~26 (939 within 2 km) | mostly 2015–2022 | partial / older |
| **baruipur** | 0 | — | none |

Design consequence: the coverage layer **shows** gaps (recency colour ramp) rather than
hiding them; a per-ward chip states the count + freshest year (or "none").

## 3. Scope

**Phase 1 (this spec):**
- **(a)** "Street view" toggle → Mapillary **coverage** on the MapLibre map (lines/points
  coloured by recency) + click a covered feature → interactive **mapillary-js** viewer in a
  panel.
- **(b)** **"Real view of this block" thumbnail** in the existing building data/receipt card
  (`paintCard`) — nearest Mapillary image, tap to open the same viewer.
- Enabled for all three wards (the layer reflects reality); QA/demo Barrackpore-first.

**Phase 2 (outlined, NOT built now):** canopy-validation stat — sample Mapillary
`nature--vegetation` along covered streets, compare to the CHM canopy, surface a
"street-camera agrees ~X%" receipt. Gated on Phase 1 showing coverage is rich enough
(realistically Barrackpore-only).

**Out of scope:** any change to vegetation data / physics / tree placement (CHM remains
sole source); side-by-side split mode; self-capture; the Phase-2 stat.

## 4. Prerequisite (user action)

A **free Mapillary "Client Token"** (`MLY|APP_ID|SECRET`) from mapillary.com → dashboard →
developers → create app. It is intended for **client-side/browser** use (tiles accept it as
the `?access_token=` query param; mapillary-js takes it as `accessToken`). Stored as
`PUBLIC_MAPILLARY_TOKEN`, read client-side via `import.meta.env.PUBLIC_MAPILLARY_TOKEN`
(Astro's client-exposed-env convention).

- **This is the repo's FIRST `import.meta.env.PUBLIC_*` var** (verified: none exist today).
  Add a `.env.example` (none exists yet) documenting it, and note the convention in
  `docs/heat-map-feature.md`.
- **Not domain-restrictable.** Mapillary offers no referrer/origin scoping for client tokens
  (unlike Mapbox/Google) — protection is rate-limits + ToU only. It's a read-only public
  token; acceptable, but documented as unscoped. Without it the feature **no-ops gracefully**
  (null-safe: no token → toggle disabled/hidden, no thumbnail fetch).

## 5. Architecture / data flow

```
Coverage tiles: https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=MLY|…
   source-layers:  overview (z0–5, points) · sequence (z6–14, lines) · image (z14+, points)
   per-feature props include:  captured_at (int, epoch-ms) · id · is_pano · quality_score
        │  MapLibre VectorTileSource + line/circle layers
        │  paint coloured by recency:  ['step',['get','captured_at'], grey, T2018, amber, T2023, green]
        ▼
   user clicks a covered feature (image layer) → String(feature.properties.id)   ← cast! (MVT double → id)
        ▼
   lazy-import mapillary-js@4.1.2 → new Viewer({accessToken, container, imageId}) → dispose on close

building data card (paintCard, heat-map-app.ts:255-347)
        │  centroid lon/lat already computed:  wardLatLon(WARDS[state.ward], b.cx, b.cz)  (heat-map-app.ts:266)
        ▼
   Graph API radius search:  graph.mapillary.com/images?access_token=…&lat=&lng=&radius=50&limit=1
                             &fields=id,thumb_1024_url,captured_at,geometry     (radius max 50 m)
        │  (bbox fallback for sparse areas; null → "no nearby street photo")
        ▼
   thumbnail (thumb_1024_url) in the card → tap → same viewer panel
```

- Use the **`mly1_computed_public`** tileset (map-matched geometries sit cleanly on roads).
- The `image`-layer `id` arrives as an MVT double → **`String(feature.properties.id)` immediately**
  (Graph/mapillary-js treat image ids as strings to dodge the 2⁵³ ceiling; spot-check a few
  Kolkata ids at build time).
- mapillary-js (~290 KB gz) + its CSS load **only on first open** (browser-only, WebGL) —
  same lazy boundary as the three.js renderer (`ensureRelief()`), never in the static bundle.

## 6. Components (small, isolated, well-bounded)

- **`src/scripts/climate-engine/streetview/coverage-layer.ts`** — `addCoverage(map, token)` /
  `removeCoverage(map)`: registers the `mly1_computed_public` vector source + `sequence`
  line layer + `image` circle layer, with the recency `['step', ['get','captured_at'], …]`
  colour ramp; a `queryImageIdAt(point)` helper using `map.queryRenderedFeatures` on the
  `image` layer → `String(props.id)`. Null-safe (no token → no-op). `assertCoverageLogic()`
  self-check on the ramp thresholds (epoch-ms boundaries for 2018/2023).
- **`src/scripts/climate-engine/streetview/street-view-panel.ts`** — `openViewer(imageId)` /
  `closeViewer()`: promise-memoized lazy `import('mapillary-js')` (mirrors `ensureRelief()`),
  mounts `new Viewer(...)` in a top-level panel element, **`viewer.remove()` on close**
  (dispose written fresh — no existing per-open/close dispose to mirror), keeps mapillary-js's
  built-in Mapillary/CC-BY-SA attribution visible. Reuses the receipts-modal DOM mechanics:
  top-level markup (outside backdrop-filtered panels), Esc-close, backdrop-click, and the
  **non-passive wheel handler** so MapLibre scroll-zoom doesn't swallow the wheel.
- **`src/scripts/climate-engine/streetview/nearest-image.ts`** — `nearestImage(lon, lat, token)`:
  Graph API radius search (`radius=50, limit=1`) → `{ id, thumbUrl, capturedAt } | null`;
  bbox fallback; promise-cached per rounded coord (ward-loader cache idiom). Unit-tested with a
  mocked fetch.
- **UI:** a "Street view" chip in `HeatMapStage.astro` (`.modechip` idiom, beside `#modechip`
  /`#envchip`/`#tintchip`) + the viewer panel markup (top-level) + a `.sv-thumb` slot in the
  building card + CSS.
- **Wiring** in `heat-map-app.ts`: module-scoped `let streetOn = false` (beside `mode`/`env`);
  chip handler via `onEl` (vegetation/tint-toggle idiom) → `addCoverage`/`removeCoverage`;
  in `paintCard()`, when a building is selected, `nearestImage(ll.lon, ll.lat, token)` fills the
  `.sv-thumb` (or "no nearby street photo"). All listeners cleanup-registered.

## 7. Honesty & licence

- Coverage layer exposes gaps via the recency ramp; a per-ward chip reads e.g. "Street imagery ·
  Mapillary · 198 img · 2026" or "· none". No implication of full coverage.
- Attribution: keep mapillary-js's built-in Mapillary logo + link-back (ToU requirement) and the
  image's CC-BY-SA credit; add a receipt line: "Street imagery — Mapillary, community-captured
  (CC BY-SA); coverage varies by ward." Commercial embedding permitted (ToU §12).
- We **display** via Mapillary's hosted viewer + `thumb_*_url` — no rehosting → avoids the
  CC-BY-SA share-alike + per-image self-hosting attribution burden.

## 8. Performance / tiers

- Coverage tiles light (cap 50k/day, far above our traffic); Graph radius search rate-limit
  ample.
- Viewer: lazy-loaded on click, `viewer.remove()` on close; on coarse-pointer/mobile it opens
  only on explicit tap. Separate DOM panel — **zero** impact on the WebGL render budget.
- Respect `reducedMotion` for viewer transitions.

## 9. Testing / verification

- `assertCoverageLogic()` (recency epoch-ms thresholds) + a `nearest-image` unit test with a
  mocked Graph response (node:test + tsx).
- **Extend `tests/unit/heat-explore-module-boundary.test.mjs`** to also forbid a *static*
  `from 'mapillary-js'` import in `heat-map-app.ts` (the current test is `three`-only and would
  NOT catch it) — makes the dynamic-import discipline a real gate, not a convention.
- `npm run check` 0 errors; full unit suite green.
- Screenshot `/heat-map` (barrackpore): toggle on → coverage lines visible & colour-ramped;
  click → viewer opens; building card shows a real thumbnail. Console clean; token from env.
- `npm run build` green; token is public config (no secret committed); `.env.example` added.

## 10. Files

**New:** `src/scripts/climate-engine/streetview/{coverage-layer,street-view-panel,nearest-image}.ts`;
`tests/unit/heat-map-streetview.test.mjs`; `.env.example`.
**Edit:** `src/components/ClimateEngine/HeatMapStage.astro` (chip + viewer panel markup +
`.sv-thumb` + CSS), `src/scripts/climate-engine/heat-map-app.ts` (`streetOn` wiring + card
thumbnail), `tests/unit/heat-explore-module-boundary.test.mjs` (+ mapillary-js gate),
`docs/heat-map-feature.md` (env var note).
**Dep:** `mapillary-js@4.1.2` (runtime, **dynamically imported**; pin — avoid the 5.x beta).

## 11. Risks

- **Token missing/rotated / unscoped** → null-safe no-op; documented as public+unscoped.
- **Sparse coverage** (Ballygunge old, Baruipur none; radius max 50 m) → honest per-ward chip;
  "no nearby street photo" fallback; demo Barrackpore.
- **Image-id precision** (MVT double) → `String()` cast + build-time spot-check.
- **mapillary-js weight/SSR** → lazy dynamic import, client-only, `viewer.remove()` dispose;
  pin 4.1.2 (5.x is beta).
- **`captured_at` schema drift** → low; verified present on all 3 tile layers 2026-08-11.
- **Phase-2 validity** → deferred; may prove too coverage-limited to ship.

## 12. Verification log (2026-08-11)

Codebase (branch `feat/heat-map-vegetation`): MapLibre `map` is a real instance with native
`addSource`/`addLayer` precedent (`heat-map-app.ts:105`, `:1506-1509`); building card + centroid
lon/lat confirmed (`paintCard` `:255-347`, `wardLatLon` `:266`); `.modechip` toggle idiom +
`onEl` cleanup confirmed (`:158-160`, `:1421-1428`); `ensureRelief()` lazy-import precedent
(`:713-735`); module-boundary test is **three-only** (must be extended for mapillary-js); **no**
existing `PUBLIC_*`/`.env.example` (new precedent). Mapillary API: `captured_at` epoch-ms present
on `overview`/`sequence`/`image` tile layers → recency ramp from tiles confirmed; tiles
`mly1_public`/`mly1_computed_public`; image id via `feature.properties.id` (cast to String);
mapillary-js 4.1.2 ESM ~290 KB gz, `Viewer({accessToken,container,imageId})`, CSS
`mapillary-js/dist/mapillary.css`; nearest image via radius search (`lat/lng/radius≤50/limit`);
client token public, unscoped, tiles 50k/day. (Two items to confirm live during build: exact
radius-search param names — new ~May 2026; mapillary-js default attribution chrome.)
