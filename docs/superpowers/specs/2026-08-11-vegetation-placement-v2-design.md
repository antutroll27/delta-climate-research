# Vegetation placement v2 — design

**Date:** 2026-08-11 · **Status:** approved for Phase A; Phase B parked/stored · **Ward:** Ballygunge first

## Context

The shipped vegetation layer places **one tree per 10 m canopy cell** — `derive_trees()` in
`scripts/fetch-canopy.py` iterates the 140×140 CHM grid and drops a tree at each cell **centre** where
height ≥ `MIN_TREE_H` (2 m). Two artefacts of that lattice make it read like "a school kid's graph-paper
project": **regular spacing** (every tree on a 10 m grid) and **uniform 1-per-cell** (no clumps, no gaps).
This is render-only; the heat physics never sees tree positions (the governed `veg[]` scalar and its
mean-neutral canopy blend are untouched).

Phase A fixes the look. Phase B (an *accuracy* layer — where trees belong, cross-checked against a second
sensor) is fully designed here but **deliberately not built** — parked for a future trigger.

## Decisions (from brainstorm, 2026-08-11)

- **Density model: (b) redistributive** — tree count per cell scales with canopy height and may drop to
  **0** in thin cells, giving natural gaps. Chosen over (a) additive (which forces ≥1/cell) because the
  gaps are both better-looking and *honest* ("we don't invent canopy"), and it keeps the payload flat.
- **Jitter strength: 0.80** (× cell size). **Density max: 4** trees per tallest cell. Both tuned live
  against the real Ballygunge canopy in an interactive 2D preview.
- **Phase B is stored, not built** — via a full deferred section below **plus a code seam** (a
  candidate→filter pipeline) so each Phase-B layer drops in with zero churn to the Phase-A generator. No
  dead stub code now.

---

## Phase A — implement now

### Algorithm (redistributive jitter + density)

Rewrite `derive_trees()` as a **candidate generator** feeding a (currently empty) **filter list**:

```
candidates = generate(grid, JITTER, DENSITY_MAX)   # Phase A
for f in FILTERS:                                    # Phase A: FILTERS = ()  -> no-op seam
    candidates = f(candidates)
trees = finalize(candidates)
```

`generate()` per canopy cell `(row, col)` with height `h`:

1. **Count (redistributive):** `n = min(DENSITY_MAX, int(DENSITY_MAX * h / DENSITY_REF_H + 0.5))` where
   **`DENSITY_REF_H = 22.0 m` is a FIXED constant**, not the ward's own max. Cells with
   `h < MIN_TREE_H` are skipped as today; `n == 0` cells contribute nothing (the gaps).

   > **Amended 2026-08-11 (multi-ward).** This started as ward-relative (`H_MAX = grid.max()`), matching
   > the tuned preview. Extending to Barrackpore and Baruipur exposed the flaw: measured h_max is
   > **22 m / 25 m / 20 m**, so each ward normalised against its own tallest pixel and density stopped
   > meaning the same thing across wards. Barrackpore rendered at **0.50 trees per canopy cell vs
   > Ballygunge's 0.93** — not because it has less canopy (it has 64% as many canopy cells) but because
   > **two** of its 6,069 cells exceed 22 m and dragged the whole ward's scale down. For an instrument
   > whose product IS cross-ward comparison, the normaliser was driving the comparison. Pinning
   > `DENSITY_REF_H = 22.0` (Ballygunge's own measured max) fixes it and leaves the approved Ballygunge
   > artifact **byte-identical** — 8,896 trees either way — so the tuned look needed no re-approval.
   > Measured after the change: **0.93 / 0.73 / 0.85** trees per canopy cell.
   > The `min(DENSITY_MAX, …)` cap is required because a ward may exceed the reference (Barrackpore's
   > 25 m does); it affects 2 cells there, a 1-tree difference.
   >
   > Consequence worth knowing: with a fixed reference, `count > 0` requires `h >= 2.75 m`, which is
   > strictly above `MIN_TREE_H = 2.0`. **`MIN_TREE_H` is therefore no longer observable in the output**
   > — it is kept as a semantic guard ("below this a cell is not canopy"), not a behavioural one, and no
   > test can distinguish its removal.
2. **Per-instance placement** for `k in range(n)`:
   - **Jitter:** offset the cell centre by `(hash01(col,row,k,0) − 0.5) * JITTER * cell_m` in x and
     `(hash01(col,row,k,1) − 0.5) * JITTER * cell_m` in y. `JITTER = 0.80`.
   - **Species:** `species_cycle[hash_int(col,row,k) % len]` — per **instance**, not per cell, so clumps
     aren't monoculture. Keep the current neem-dominant mix `("neem","neem","gulmohar","palm")`.
   - **Radius:** `r = h * 0.35 * (0.9 + 0.2*hash01(col,row,k,2))` — ±10% so crowns aren't identical discs.
   - Round `x,y` to 2 dp, `h` to 1 dp, `r` to 2 dp (as today).

### Determinism (repo rule — byte-stable artifacts)

The generator is **Python**, so the hash lives in `fetch-canopy.py`, not the browser. Use an explicit
integer hash — a small `splitmix64`-style mix over packed `(col, row, k, axis)` returning `[0,1)`. **No
`random` module, no `Date`/time.** Result: `trees.json` is byte-identical across rebuilds. (The preview's
JS hash was for live tuning only; the shipped hash is Python and pinned.)

Add constants near the existing ones:
```python
JITTER = 0.80          # fraction of cell size for deterministic position jitter
DENSITY_MAX = 4        # trees at a DENSITY_REF_H cell; scales down to 0 (gaps)
DENSITY_REF_H = 22.0   # metres; FIXED cross-ward density reference (see amendment above)
```

### Output contract — unchanged

`trees.json` keeps its exact schema: `{ward, grid, sizeM, retrieved, trees:[{x,y,h,species,r}]}`. No new
fields (Phase B may add a `confidence`/`src` field later; not now — YAGNI). The renderer
(`vegetation-layer.ts`, `ReliefWardBundle.veg/vegSpecies`) consumes it unchanged.

### N→S flip

Placement stays in the existing convention: `row 0 = north`, so `y = half − (row + 0.5)*cell_m`; jitter is
symmetric so it doesn't disturb the flip. The canopy PNG write path is untouched.

### Count / performance

Redistributive keeps the total near today's ~9.5k (thin cells lose their tree, dense cells gain up to 4 —
roughly balancing). `InstancedMesh` per species handles this trivially. Guard the count with a **loud
assert** (fail the build past ~30k), not a silent truncation — "no silent caps" is the repo rule; a count
blow-up is a formula bug to investigate, not something to quietly clip. The existing
mobile/coarse-pointer tier (cull to viewport, capped instances) stays as-is per the mobile-GLB memory.
`trees.json` stays byte-small.

### Files touched (Phase A)

- `scripts/fetch-canopy.py` — rewrite `derive_trees()` into `generate()` + no-op filter seam; add
  `JITTER`, `DENSITY_MAX`, the `hash01`/`hash_int` helpers; extend `check()` self-check.
- No TS changes required (contract unchanged). No physics changes (no parity-oracle exposure).

### Tests / verification (Phase A)

- **Determinism:** build twice → `trees.json` byte-identical.
- **Redistributive correctness:** a cell at `h = CANOPY_HI` yields `DENSITY_MAX` trees; a cell just above
  `MIN_TREE_H` yields 0–1; `h < MIN_TREE_H` yields 0.
- **Jitter bounds:** every instance lies within `±JITTER*cell_m/2` of its cell centre (never crosses into a
  non-adjacent cell).
- **Height/species ranges:** existing `check()` assertions still pass (height in `[MIN_TREE_H, CANOPY_HI+5]`,
  species in the allowed set).
- **Strict mypy** clean on `fetch-canopy.py`; `npm run build` green (canopy build gate).

---

## Phase B — parked / stored (DO NOT build until triggered)

The *accuracy* layer: where trees belong, and a second-opinion cross-check. Each item is a **filter** in
the Phase-A pipeline (`FILTERS = (ExclusionFilter, ParksPrior, EthGate)` in order) or a swap of the
candidate generator (crown-detection). All render-only; none touch physics.

### B1 · Exclusion mask (the "panel 3" option — explicitly parked at the user's request)

**What:** reject/relocate candidates that land on a **building footprint**, **buffered road**, or **water**
— no trees on rooftops or mid-road.

**Data (all already shipped, in ward-local metre frame, centred at 0):**
- Buildings: `ballygunge.json` → `b` = list of `[height, x0,y0, x1,y1, …]`.
- Roads: `ballygunge-roads.json` → `ways` = list of `{"w": class, "p": [x0,y0,…]}`; buffer by class
  (`buf ≈ 3 + 1.5*class` metres).
- Water: `ballygunge-water.json` → `polys` = list of `{"k": "water", "p": [x0,y0,…]}`.

**Rasterization:** stamp a boolean exclusion mask at 2× grid resolution (280×280, ~5 m cells) — ray-cast
point-in-polygon for buildings/water within each polygon's bbox; line-stamp buffered roads. (Reference
implementation stored at `docs/superpowers/specs/assets/2026-08-11-veg-placement-preview.py` — it already
rasterizes this exact mask and renders the grid/jitter/exclusion comparison; measured **45.6 %** of
Ballygunge area excluded — 3,527 buildings + 500 roads + 7 water. Run `python3` on it to regenerate the
interactive preview.)

**Over-cull remedy — RELOCATE, don't delete.** A pure delete removed too much (the 45.6 % figure is the
pessimistic bound). Instead: if a candidate lands in an excluded cell, **relocate it to the nearest free
cell within ~1 cell radius** (deterministic search order); delete **only** if no free cell is found. This
preserves canopy density while never planting on a roof.

**Trigger to build:** when the render's rooftop/road false-positives become a credibility complaint, or a
demo audience is close enough to notice. Ballygunge first.

### B2 · OSM parks positive prior

**What:** a small `scripts/fetch-landuse.py` (Overpass, mirrors `fetch-water.py`) pulling `leisure=park`,
`landuse=grass|forest|recreation_ground`, `natural=wood|scrub` → `{ward}-landuse.json`. Used to **boost
density inside real green space** — but **only where the CHM already sees canopy**, so we never invent
trees (honesty guard).

⚠️ **B2 cannot be a `FILTERS` entry** (found during the Phase-A code review, 2026-08-11). The filter list
receives already-generated candidates; *adding* an instance requires the cell identity `(col, row, k)` to
key `_hash01`, which is gone by then. So B2 must hook **inside `_generate`** — as a per-cell density
multiplier applied to `count` before the instance loop. B1 (relocate) and B3 (reduce) are true filters and
fit the list; B2 is not. Budget for a small `_generate` signature change when B2 lands.

**Trigger:** after B1, when parks look under-planted relative to reality.

### B3 · ETH canopy soft-gate + receipt

**What:** `scripts/fetch-eth-canopy.py` fetches the **ETH Zurich Global Canopy Height** COG (Lang et al.,
CC BY 4.0) for the ward bbox. Compute an **agreement statistic vs the Meta/WRI CHM** (% canopy/no-canopy
agreement + mean abs height diff) → emit as a **provenance receipt** (the honest "two independent sensors,
here's how much they agree" artifact). Then **softly downweight density where the two disagree** (reduce
`n`, don't hard-zero).

**Independence nuance (on record):** cross-check ETH **against Meta/WRI**, *not* ESA WorldCover — ETH
shares its Sentinel-2 input with WorldCover, so that comparison would be partly circular. ETH *is*
genuinely independent of Meta/WRI. See `docs/evidence/data-sources.md`.

**Trigger:** when a credibility/investor moment needs a published second-opinion agreement number.

### B4 · Crown-detection (accuracy-max placement upgrade)

**What:** replace the cell-based generator with **local-maxima crown detection** on a finer CHM read —
`read_chm_grid(ward, n)` already accepts any `n`, so read at ~1–2 m (`n ≈ 560–1400`), find local maxima =
individual real crowns, place one tree per detected crown. Non-gridded *by construction*; the most
defensible placement. Heavier compute; slots in as an alternative `generate()`.

**Trigger:** when placement realism must be defensible at ground level (e.g. street-view overlay
alignment).

### The seam that makes B1–B4 cheap

Phase A ships the pipeline shape (`generate → FILTERS → finalize`) with `FILTERS = ()`. **B1 and B3** are
new filter callables appended in order, typed
`Callable[[Ward, NDArray[float32], list[TreeInstanceJSON]], list[TreeInstanceJSON]]` — the ward geometry
and CHM grid are threaded through so a filter can relocate or re-weight; **B2 hooks inside `_generate`**
(see above); **B4** swaps `_generate` entirely. A comment in `derive_trees` marks the seam. `trees.json`
may gain an optional `confidence` field when B3 lands — additive, back-compatible.

---

## Non-goals / guards

- **Physics unchanged.** No change to `heat-map-model.ts`, `veg[]` governance, or the mean-neutral canopy
  blend. No parity-oracle exposure — the accuracy numbers must not move.
- **No new runtime dependency** for Phase A (pure numpy/Python already in the pipeline).
- **Deterministic, byte-stable** artifacts throughout.
- Ballygunge first, then Barrackpore/Baruipur (same code path).

## Verification (definition of done, Phase A)

- `python3 -m mypy scripts/fetch-canopy.py` clean; `check()` extended and passing.
- Build twice → `ballygunge-trees.json` byte-identical.
- `npm run build` green; the `/heat-map` Trees layer renders with the grid gone (no lattice, natural gaps
  and clumps), console clean.
- **All three wards ship in Phase A** (user extended scope 2026-08-11). Measured CHM coverage confirmed
  for each: ballygunge `123133323`, barrackpore `123133321`, baruipur `123133323`. Expected counts —
  **8,896 / 4,413 / 6,797**.
