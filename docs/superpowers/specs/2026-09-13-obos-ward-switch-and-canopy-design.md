# OBOS ward switching and Bengaluru canopy — design

**Date:** 2026-09-13 · **Branch:** `feat/bangalore-wards` · **Status:** agreed in brainstorm, awaiting written review

## The ask

Two items from the Project Bangalore list, in this order:

1. *"Shifting to a new city takes a while"* and *"Optimise it more if you can."*
2. Bengaluru's canopy renders as one species (neem) where Kolkata's renders three.

## What was measured, and what it overturned

The first diagnosis of item 1 was wrong four times in a row, each time because a
file listing was read as a cause. Every number below was measured unless marked
**arithmetic**.

| Measurement | Result | Conditions |
|---|---|---|
| Parse one ward's `-trees.json` | 3–6 ms | Node, all six wards |
| Cold ward load, production | **12,636 ms** | deltaclimate.earth, Ballygunge, Slow 4G (1.6 Mbps, 150 ms) |
| Switch to a ward **not yet visited** | **2,238 / 2,176 ms** | production, Kolkata, Slow 4G |
| Switch **back** to a visited ward | **393 ms** | production, Kolkata, Slow 4G |
| In-place area switch vs full-reload city switch | 17,747 vs 17,137 ms | localhost, Slow 4G, uncompressed |
| In-place area switch | 248–299 ms | localhost, unthrottled, 2 runs |
| Full-reload city switch | 654–658 ms | localhost, unthrottled, 2 runs |
| Largest single file on a cold load | 640 KB sky HDR, 37 % of page | production, desktop 3-D path |
| Compressed ward payload, Kolkata | 229–253 KB | brotli q11 |
| Compressed ward payload, Bengaluru | 748–948 KB | brotli q11 |
| First-visit Bengaluru switch | **~6–8 s** | **arithmetic**: measured 2.2 s × payload ratio |

What that established:

- **JSON parsing is not the wait.** 6 ms.
- **Development is not production.** The dev server compresses nothing; production serves brotli. Absolute dev timings are not comparable.
- **A full page reload costs almost nothing on a real connection.** In-place and reload switches take the same time on Slow 4G; the wait is bytes.
- **The switch delay is the first visit to each ward.** Revisits are already fast because the files are cached. Bengaluru's wards are ~3.5× heavier than Kolkata's, so its first visits are the slowest.
- `loadWard` already fetches in parallel (`Promise.all`), so request ordering is not a lever.

## Decisions

| # | Decision | Status | Basis |
|---|---|---|---|
| 1 | Prefetch the city's other wards after the first loads | **In** | Makes every switch take the measured 393 ms revisit path |
| 2 | Re-encode the tree file | **In** | 715 → 424 KB across six wards, species kept |
| 3 | Keep the loading chip; delay it 400 ms | **In** | Founder chose the chip; the 0.25 s fade flickers on fast switches |
| 4 | Fix Bengaluru's species at source | **In** | Founder's call; reproduces Kolkata's draw exactly |
| 5 | Switch cities in place instead of reloading | **Out** | No measured speed gain on Slow 4G |
| 6 | Shrink the 640 KB sky HDR | **Out of this spec** | Largest cold-load item; unrelated to Bangalore; separate follow-up |
| 7 | Binary tree encoding | **Rejected** | 10 KB better than compact JSON for a bespoke format and decoder |
| 8 | Round building coordinates to 1 m | **Rejected** | Moves the solver input: 6.34 % of Ballygunge's cells change, by up to 0.75 of a cell's built fraction |
| 9 | Draw species in the browser from position | **Rejected** | The draw is keyed on cell identity, which the browser does not have |

## Design

### 1. Sibling-ward prefetch

**When.** Once, after the first ward of a page load commits (`wardSession.commit`),
on `requestIdleCallback` (with a `setTimeout` fallback).

**Which wards.** `areaKeysInCity(key)` minus the open ward, keeping only keys for
which `paths(key)` is non-null. Bengaluru prefetches two wards; Kolkata two.

**What.** Every URL a switch to that ward fetches: the `paths()` entries `loadWard`
requests, plus `/heat-map/models/{id}.glb` when `hasBuildingModel(id)`. Each is a
plain `fetch(url, { priority: 'low', signal })` with the body read
(`await response.arrayBuffer()`) so the cache entry completes.

**Why the HTTP cache, not the app's in-memory cache.** Every ward file is loaded
with a plain `fetch` — ward JSON (`heat-map-app.ts:1999`), the GLB
(`building-model.ts:228`) and the surface PNG (`surface-raster.ts:93`) — so a
background fetch of the same URL warms exactly what a switch reads. The in-memory
`cache[name]` covers only ward, terrain, water and roads (line 2037); prefilling it
would couple prefetch to `loadWard`'s internals for no measured gain.

**Backing off.**
- Skip when `navigator.connection?.saveData` is set (existing precedent: `river-scene.ts:580`).
- Skip when `navigator.connection?.effectiveType` is `slow-2g` or `2g`.
- Fetch sibling wards one after another; within a ward, fetch its files in parallel as `loadWard` does. Serialising wards keeps prefetch from competing with the basemap or solver.
- Abort in-flight prefetches the moment a real ward load begins.

**Effect.** A first-visit switch takes the revisit path. On production Kolkata that
is **2,238 ms → 393 ms (measured endpoints)**. For Bengaluru, ~6–8 s → ~0.4 s is
**arithmetic** until measured in production.

**Cost.** Data the user may not use: about **1.5–1.9 MB extra per Bengaluru visit**
(two wards × 748–948 KB, brotli q11; production's live compression is lighter, so
this is a floor). Save-Data users pay nothing.

**Cache headers.** Production serves `cache-control: public, max-age=0,
must-revalidate`, so a prefetched file is revalidated with a conditional request
on the switch — the path that measured 393 ms.

### 2. Tree file encoding

```json
{
  "ward": "mg-road", "grid": 280, "sizeM": 2800, "retrieved": "2026-09-11",
  "source": "Meta/WRI global canopy height model v1 …", "densityRefM": 30.0,
  "cols": ["x_m", "y_m", "h_dm", "r_dm", "species"],
  "speciesNames": ["neem", "gulmohar", "palm"],
  "trees": [[-916, 1395, 43, 15, 0], …]
}
```

- `x`, `y` in whole metres; `h`, `r` in whole decimetres; `species` an index into `speciesNames`. The list gets its own key so it cannot be mistaken for the old per-tree `species` field.
- Header fields are unchanged.
- **Buildings are not touched.** Their coordinates feed `rasterizeWardBuilt` and the solver (decision 8).

**Measured size, brotli q11, with a real species column:**

| Ward | Now | New | Change |
|---|---|---|---|
| Ballygunge | 99 KB | 55 KB | −44 % |
| Baruipur | 69 KB | 38 KB | −44 % |
| Barrackpore | 56 KB | 31 KB | −44 % |
| Indiranagar | 196 KB | 119 KB | −39 % |
| MG Road | 204 KB | 123 KB | −40 % |
| Whitefield | 92 KB | 57 KB | −38 % |
| **All six** | **715 KB** | **424 KB** | **−41 %** |

**Everything that reads or writes the file:**

| Role | File |
|---|---|
| Writer, Kolkata | `scripts/fetch-canopy.py` |
| Writer, Bengaluru | `scripts/export-bangalore-obos.py` |
| Reader, browser | `src/scripts/climate-engine/vegetation-layer.ts` → `asTreesFile` |
| Reader, check | `scripts/fetch-canopy.py --check` (line 364) |
| Reader, gate | `scripts/check-bangalore-artefacts.py` |
| Reader, test | `tests/unit/heat-map-vegetation.test.mjs` |

**Confirmed not affected.** `measure-pv-tree-shading.py` and `build-pv-yield.py`
read the canopy height model, not the tree file (`measure-pv-tree-shading.py:20`
states the tree file is a render derivative and unused), so no solar figure moves.
No freshness fingerprint includes a tree file (`build-city-indicators.py` hashes
`surface-meta.json`; `build-3d-tiles.py` hashes footprints, heights and the licence),
so `check:fresh` is unaffected.

**One format, one commit.** `asTreesFile` rejects a whole file on any malformed
record, so a reader accepting one format while some files carry the other would
silently blank a ward's trees. The reader accepts only the new format, and all six
tree files are regenerated in the same commit by converting the existing JSON — no
canopy height model re-read.

### 3. Loading chip

- Set `.loadchip.on` only if the load is still pending **400 ms** after it starts. The chip fades over 0.25 s (`transition: opacity .25s`) and in-place switches take 248–299 ms, so today it fades in and is removed as it reaches full opacity.
- Once shown, keep it visible for at least **500 ms**. A delay alone does not stop the flicker: a prefetched switch measured 393 ms on Slow 4G, so a slightly slower connection finishes just after 400 ms and would remove the chip the instant it appears.
- Remove the dead text at `heat-map-app.ts:2138`, which sets `"Building ward…"` and removes `on` in the same statement, so it is never seen.
- A load **failure** (line 2157) still shows immediately. A refusal or error must not wait out a threshold.

With prefetch in place, most switches finish near 400 ms, so the chip will rarely appear — which is the intent.

### 4. Bengaluru canopy species, at source

**The source fix.** `scripts/fetch-bangalore.py` `build_canopy` reimplements Kolkata's
placement and its own comment reads *"Kolkata's `_generate`, verbatim in logic, species
omitted."* Add the draw inside that loop, where `(col, row, kk)` is in scope:

```python
sp = SPECIES[int(hash01(col, row, kk, 3) * len(SPECIES))]
```

using Kolkata's `_hash01` and `SPECIES` (already imported via `_kolkata_canopy()`).
`export-bangalore-obos.py` then reads species from the canopy file instead of the
`TREE_SPECIES` constant (line 218).

**Updating the existing data without re-reading the height model.** The shipped
`data/bangalore/*-canopy.json` keep only `x, y, h, r`, and the canopy height model is
an untiled S3 monolith read over the network. So species is backfilled by recovering
each tree's cell identity:

- `col`, `row` from the position: jitter is bounded at `0.8` of a 10 m cell, so the cell is always recoverable.
- `kk` by matching the stored `x, y` to 1 cm against each candidate.
- Ties broken by the stored radius, which is drawn from the same hash.

**Measured:** **59,184 of 59,184** trees recovered uniquely across the three wards.
Two ties, both in Indiranagar cell (240, 154), were separated by radius and resolve
to `neem` either way.

**Resulting mix (measured):**

| Ward | neem | palm | gulmohar |
|---|---|---|---|
| Indiranagar | 11,777 | 5,930 | 5,856 |
| MG Road | 12,316 | 6,262 | 6,241 |
| Whitefield | 5,308 | 2,754 | 2,738 |

**Equivalence.** The backfill must be proven identical to the source fix, not assumed
to be: on a synthetic grid, `backfill(generated without species)` must equal
`generated with species`.

## Testing

| Area | Test | Why this shape |
|---|---|---|
| Prefetch rules | Unit test of a pure planner: which URLs, and each back-off condition | Keeps the rules testable without a browser |
| Prefetch behaviour | e2e: after the first ward settles, sibling URLs are requested; none are with Save-Data emulated | The preview server sends no cache headers, so assert requests, not timings |
| Tree format | `asTreesFile` accepts the new format and **rejects** the old one; tree counts pinned (Kolkata 12,159 / 8,415 / 6,811; Bengaluru 23,565 / 24,819 / 10,800) | A reader that quietly accepts both would hide a half-migration |
| Species | Backfill ≡ source fix on a synthetic grid; per-ward mix pinned | The recompute is only acceptable if proven equal |
| Chip | Hidden for a sub-400 ms switch; shown for a throttled one; errors shown immediately | Covers the flicker and the refusal path |

Each new check must be shown to fail against a deliberate break before it is
trusted. Existing gates must stay green: `npm run check`, `npm run test:unit`,
`npm run typecheck`, `npm run test:py`, `check:bangalore`, `check:bangalore-frame`,
and `kolkata-unchanged.test.mjs` (buildings are untouched, so it must not move).

## Out of scope

- Switching cities in place (decision 5).
- The 640 KB sky HDR — the biggest remaining cold-load item, worth its own spec.
- JavaScript bundle size (`heat-map-app` is 238 KB transferred).
- Bengaluru's catalogue artefacts and resilience score.
- MG Road's dropped water centrelines.

## Open risks

- **Prefetch spends mobile data** for users who have not set Save-Data. The back-off covers explicit opt-out and 2G only.
- **Absolute sizes in production will be larger** than the brotli q11 figures above, because Vercel compresses live at a lighter setting. The percentages are what to rely on.
- **Bengaluru's switch timings are arithmetic** until Bengaluru is deployed and measured the same way Kolkata was.
