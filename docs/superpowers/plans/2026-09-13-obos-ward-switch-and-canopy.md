# OBOS Ward Switching and Bengaluru Canopy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a switch to an unvisited ward take the revisit path by prefetching the city's other wards, shrink the tree file by ~41 %, stop the loading chip flickering, and give Bengaluru's trees Kolkata's species mix.

**Architecture:** The tree file moves to a compact row format, decoded at both boundaries (Python `scripts/_trees.py`, browser `asTreesFile`) so every in-memory caller keeps its object shape; the reader, both writers and all six regenerated files land in one commit. Bengaluru's species draw is restored in `fetch-bangalore.py` and backfilled offline by recovering each tree's cell. Prefetch and the chip are pure, injectable modules wired into `heat-map-app.ts`; the model URL moves into three-free `scope/paths.ts` so prefetch cannot pull three.js into the main bundle.

**Tech Stack:** TypeScript (Astro, `node:test` via `tsx`), Python 3.12 under strict mypy, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-13-obos-ward-switch-and-canopy-design.md`](../specs/2026-09-13-obos-ward-switch-and-canopy-design.md)

---

## Conventions this plan assumes

- **Branch:** `feat/bangalore-wards`, repo root `/Volumes/VSTSAMPLES/Projects/Angad`. Do not create a worktree. **Do not `git push`.**
- **Gates.** `npm run check` is the TypeScript gate. `npm run typecheck` is **mypy** (`files = scripts`, strict), not TypeScript. `npm run test:unit` runs `node --import tsx --test tests/unit/*.test.mjs`. `npm run test:py` is the Python chain. A single unit file: `npx tsx --test tests/unit/<file>.test.mjs`.
- **e2e** runs against a built preview on `127.0.0.1:4322`: `npm run build`, then `npx playwright test <spec> --project=chromium-tier0 --reporter=line`. Run it in the **foreground**; never background it and wait.
- **Never** bare `git stash` / `git stash pop` (shared stash stack across worktrees). **Never** `git commit --amend` without running `git log -1` first and confirming the commit is yours.
- **exFAT volume.** Copy binaries into `public/` with `cat src > dst`, not `cp` (which writes `._*` AppleDouble sidecars that a test rejects).
- **"A gate that cannot fail is not a gate."** Every new test is proven by breaking what it covers, watching it fail, and restoring.
- Comments say **why** and name the defect prevented. Match the surrounding style.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/_trees.py` | **Create** | Tree row codec: `COLS`, `SPECIES_NAMES`, `encode_trees`, `decode_trees`, self-test |
| `scripts/fetch-bangalore.py` | Modify | `place_canopy` (species restored), `recover_species`, `backfill_species`, `--layer species`, `--self-test` |
| `scripts/_types.py` | Modify | `TreesFileJSON` gains `cols`, `speciesNames`; `trees` becomes rows |
| `scripts/fetch-canopy.py` | Modify | `document()` encodes; `check()` decodes |
| `scripts/export-bangalore-obos.py` | Modify | Encodes trees with species from the canopy file; `TREE_SPECIES` removed |
| `src/scripts/climate-engine/vegetation-layer.ts` | Modify | `asTreesFile` reads only the row format; `TREE_COLS` exported |
| `public/heat-map/data/*-trees.json` (6) | Regenerate | Row format |
| `data/bangalore/*-canopy.json` (3) | Regenerate | Species backfilled |
| `src/scripts/climate-engine/load-chip.ts` | **Create** | Chip timing: 400 ms show delay, 500 ms minimum, immediate failure |
| `src/scripts/climate-engine/scope/paths.ts` | Modify | `MODEL_WARDS`, `modelPath` |
| `src/scripts/climate-engine/explore/building-model.ts` | Modify | Re-exports `MODEL_WARDS`; uses `modelPath` |
| `src/scripts/climate-engine/ward-prefetch.ts` | **Create** | `shouldPrefetch`, `prefetchPlan`, `runPrefetch` |
| `src/scripts/climate-engine/heat-map-app.ts` | Modify | Wires the chip and prefetch |
| `tests/unit/heat-map-vegetation.test.mjs` | Modify | Row-format reader tests |
| `tests/unit/trees-artefacts.test.mjs` | **Create** | The six shipped tree files parse, with pinned counts and mixes |
| `tests/unit/heat-load-chip.test.mjs` | **Create** | Chip timing with a fake clock |
| `tests/unit/scope-model-path.test.mjs` | **Create** | `modelPath` and `hasBuildingModel` agree |
| `tests/unit/heat-ward-prefetch.test.mjs` | **Create** | Planner, back-off, ward-by-ward fetch, abort |
| `tests/unit/heat-explore-module-boundary.test.mjs` | Modify | `paths.ts` and `ward-prefetch.ts` stay three-free |
| `tests/e2e/heat-map-ward-prefetch.spec.ts` | **Create** | Sibling requests happen; none under Save-Data |
| `package.json` | Modify | `test:py` runs the two new Python self-tests |

## Commit order

Tasks 1, 2, 7, 8, 9 and 10 each commit on their own. **Tasks 3, 4, 5 and 6 share one commit, made at the end of Task 6.** `asTreesFile` rejects a whole file on any malformed record and `check()` will refuse the old format, so committing the reader or a writer before the six files are regenerated would leave the branch rendering some wards with no trees and failing `test:py`.

---

### Task 1: The tree row codec

**Files:**
- Create: `scripts/_trees.py`
- Modify: `package.json` (`test:py`)

- [ ] **Step 1: Write the self-test first**

Create `scripts/_trees.py` with the module header, constants and self-test, but **without** `encode_trees` / `decode_trees`:

```python
#!/usr/bin/env python3
"""
The tree file's on-disk row format, in one place.

WHY THIS FILE EXISTS. `{ward}-trees.json` is written by two pipelines --
fetch-canopy.py (Kolkata) and export-bangalore-obos.py (Bengaluru) -- and read
back by fetch-canopy.py --check. The rows are the contract with the browser's
asTreesFile (src/scripts/climate-engine/vegetation-layer.ts), so encoding and
decoding live here once rather than three times.

THE FORMAT. Each tree is [x_m, y_m, h_dm, r_dm, species]: position in whole
metres, height and crown radius in whole decimetres, species an index into
`speciesNames`. Measured against the object form it replaced: 715 -> 424 KB
brotli across the six wards, species kept.

WHY WHOLE METRES ARE SAFE HERE AND NOT FOR BUILDINGS. Tree positions are a
deterministic jitter inside a 10 m cell, drawn for display, never rasterised
into the solver and never picked. Building rings ARE rasterised: rounding them
to 1 m moved 6.34 % of Ballygunge's solver cells by up to 0.75 of a cell's
built fraction. Do not reuse this precision for buildings.

In memory every caller still works with TreeInstanceJSON objects. Only disk
changes.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

#: Column order of every row. Written into each file so the file describes itself.
COLS: tuple[str, ...] = ("x_m", "y_m", "h_dm", "r_dm", "species")

#: Index -> name for the species column. DISTINCT names, not fetch-canopy.py's
#: weighted draw tuple ("neem", "neem", "gulmohar", "palm"). Must match the
#: browser's `Species` union exactly -- asTreesFile rejects any other name.
SPECIES_NAMES: tuple[str, ...] = ("neem", "gulmohar", "palm")

Row = list[int]


def _self_test() -> None:
    trees: list[_types.TreeInstanceJSON] = [
        {"x": -915.72, "y": 1394.82, "h": 4.3, "species": "neem", "r": 1.52},
        {"x": 12.49, "y": -0.51, "h": 30.0, "species": "palm", "r": 11.9},
    ]
    rows = encode_trees(trees)
    assert rows == [[-916, 1395, 43, 15, 0], [12, -1, 300, 119, 2]], rows
    back = decode_trees(list(COLS), list(SPECIES_NAMES), rows)
    assert [t["species"] for t in back] == ["neem", "palm"]
    assert back[0]["h"] == 4.3 and back[0]["x"] == -916.0 and back[1]["r"] == 11.9
    assert encode_trees(back) == rows, "decode then encode must be stable"
    for bad_cols in (["x_m", "y_m", "h_dm", "r_dm"], ["y_m", "x_m", "h_dm", "r_dm", "species"]):
        try:
            decode_trees(bad_cols, list(SPECIES_NAMES), rows)
        except ValueError:
            pass
        else:
            raise AssertionError(f"columns {bad_cols} must be refused")
    for bad in ([[1, 2, 3, 4]], [[1, 2, 3, 4, 3]]):
        try:
            decode_trees(list(COLS), list(SPECIES_NAMES), bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"row {bad} must be refused")
    try:
        encode_trees([{"x": 0.0, "y": 0.0, "h": 5.0, "species": "oak", "r": 1.0}])
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown species must be refused on encode")
    print("  _trees self-test OK")


if __name__ == "__main__":
    _self_test()
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 scripts/_trees.py`
Expected: FAIL with `NameError: name 'encode_trees' is not defined`

- [ ] **Step 3: Add the codec**

Insert directly above `def _self_test`:

```python
def encode_trees(trees: list[_types.TreeInstanceJSON]) -> list[Row]:
    """Objects -> rows. Rounds position to 1 m and height/radius to 0.1 m."""
    index = {name: i for i, name in enumerate(SPECIES_NAMES)}
    rows: list[Row] = []
    for t in trees:
        if t["species"] not in index:
            raise ValueError(f"unknown species {t['species']!r}; expected one of {SPECIES_NAMES}")
        rows.append([round(t["x"]), round(t["y"]), round(t["h"] * 10),
                     round(t["r"] * 10), index[t["species"]]])
    return rows


def decode_trees(cols: list[str], names: list[str],
                 rows: list[Row]) -> list[_types.TreeInstanceJSON]:
    """Rows -> objects. Refuses a file whose header does not match this codec."""
    if tuple(cols) != COLS:
        raise ValueError(f"tree columns {cols} are not {list(COLS)}")
    if tuple(names) != SPECIES_NAMES:
        raise ValueError(f"speciesNames {names} are not {list(SPECIES_NAMES)}")
    out: list[_types.TreeInstanceJSON] = []
    for row in rows:
        if len(row) != len(COLS):
            raise ValueError(f"tree row {row} has {len(row)} fields, expected {len(COLS)}")
        x, y, h_dm, r_dm, s = row
        if not 0 <= s < len(SPECIES_NAMES):
            raise ValueError(f"tree row {row} has species index {s} out of range")
        out.append({"x": float(x), "y": float(y), "h": h_dm / 10,
                    "species": SPECIES_NAMES[s], "r": r_dm / 10})
    return out
```

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 scripts/_trees.py`
Expected: `  _trees self-test OK`

- [ ] **Step 5: Prove the self-test can fail**

Temporarily change `round(t["x"])` to `int(t["x"])` in `encode_trees`. Run `python3 scripts/_trees.py`.
Expected: `AssertionError` (`int(-915.72)` is `-915`, not `-916`). Restore `round(t["x"])` and re-run to confirm it passes.

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: `Success: no issues found`

- [ ] **Step 7: Add it to the Python chain**

In `package.json`, change the start of `test:py` from
`python3 scripts/fetch-canopy.py --self-test && ` to
`python3 scripts/_trees.py && python3 scripts/fetch-canopy.py --self-test && `.

Run: `npm run test:py`
Expected: passes, and the output includes `_trees self-test OK`.

- [ ] **Step 8: Commit**

```bash
git add scripts/_trees.py package.json
git commit -m "feat(trees): one codec for the tree file's row format

Rows of [x_m, y_m, h_dm, r_dm, species], decoded at the boundary so every
in-memory caller keeps its object shape. 715 -> 424 KB brotli across the six
wards with species kept. Whole metres are safe for trees and NOT for buildings:
rounding building rings to 1 m moves 6.34% of Ballygunge's solver cells."
```

---

### Task 2: Bengaluru's species, restored at source and backfilled offline

**Files:**
- Modify: `scripts/fetch-bangalore.py` (placement loop in `build_canopy`, around lines 788–806; `main()`, around line 1113)
- Modify: `package.json` (`test:py`)

- [ ] **Step 1: Write the self-test and CLI flag first**

Add this function to `scripts/fetch-bangalore.py`, directly above `def main()`:

```python
def _self_test() -> None:
    """Offline: the backfill must reproduce the source fix exactly."""
    import numpy as np
    kc = _kolkata_canopy()
    hash01 = cast(Callable[[int, int, int, int], float], kc._hash01)
    species = cast(tuple[str, ...], kc.SPECIES)
    assert (JITTER, DENSITY_MAX, DENSITY_REF_H, MIN_TREE_H) == (
        kc.JITTER, kc.DENSITY_MAX, kc.DENSITY_REF_H, kc.MIN_TREE_H), \
        "Bengaluru's placement constants must equal Kolkata's, or its species draw is not Kolkata's"
    size_m = float(CANOPY_GRID * 10)
    grid = np.zeros((CANOPY_GRID, CANOPY_GRID), dtype=np.float32)
    grid[0, 0] = 30.0
    grid[3, 40] = 25.0
    grid[10, 10] = 15.0
    grid[150, 200] = 8.0
    grid[279, 279] = 22.5
    placed = place_canopy(grid, size_m, hash01, species)
    assert placed, "the probe grid must place trees"
    assert {t["species"] for t in placed} <= set(species)
    assert len({t["species"] for t in placed}) > 1, "the species draw must vary, not always neem"
    for t in placed:
        stripped = {k: v for k, v in t.items() if k != "species"}
        assert recover_species(stripped, size_m, hash01, species) == t["species"], \
            f"backfill disagrees with the source draw at {t}"
    try:
        recover_species({"x": 3.0, "y": 3.0, "h": 5.0, "r": 1.0}, size_m, hash01, species)
    except ValueError:
        pass
    else:
        raise AssertionError("a tree no placement could have produced must be refused, not guessed")
    print("  fetch-bangalore self-test OK")
```

In `main()`, replace

```python
    ap.add_argument("--layer", default="all",
                    choices=("buildings", "heights", "terrain", "context", "canopy",
                             "osm", "all"))
    ap.add_argument("--ward", default=None)
    a = ap.parse_args()
    wards = ward_list(a.ward)
```

with

```python
    ap.add_argument("--layer", default="all",
                    choices=("buildings", "heights", "terrain", "context", "canopy",
                             "species", "osm", "all"))
    ap.add_argument("--ward", default=None)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        _self_test()
        return 0
    wards = ward_list(a.ward)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 scripts/fetch-bangalore.py --self-test`
Expected: FAIL with `NameError: name 'place_canopy' is not defined`

- [ ] **Step 3: Extract the placement, restore the species draw, add recovery and backfill**

Add these three functions directly above `def build_canopy`:

```python
def place_canopy(grid: Any, size_m: float,
                 hash01: Callable[[int, int, int, int], float],
                 species: tuple[str, ...]) -> list[dict[str, Any]]:
    """Kolkata's `_generate` over a CANOPY_GRID x CANOPY_GRID height grid, species INCLUDED.

    WAS INLINE IN build_canopy WITH SPECIES OMITTED ("verbatim in logic, species
    omitted"), which is why every Bengaluru tree rendered as neem. The draw is the
    same `hash01(col, row, kk, 3)` Kolkata uses, keyed on the cell identity that
    exists only here -- once candidates are a flat list it is gone.
    """
    cell_m = size_m / CANOPY_GRID
    half = size_m / 2.0
    cands: list[dict[str, Any]] = []
    for row in range(CANOPY_GRID):
        for col in range(CANOPY_GRID):
            h = float(grid[row, col])
            if h < MIN_TREE_H:
                continue
            count = min(DENSITY_MAX, int(DENSITY_MAX * h / DENSITY_REF_H + 0.5))
            for kk in range(count):
                jx = (hash01(col, row, kk, 0) - 0.5) * JITTER * cell_m
                jy = (hash01(col, row, kk, 1) - 0.5) * JITTER * cell_m
                x = round((col + 0.5) * cell_m - half + jx, 2)
                y = round(half - (row + 0.5) * cell_m + jy, 2)
                r = round(h * 0.35 * (0.9 + 0.2 * hash01(col, row, kk, 2)), 2)
                sp = species[int(hash01(col, row, kk, 3) * len(species))]
                cands.append({"x": x, "y": y, "h": round(h, 1), "r": r, "species": sp})
    return cands


def recover_species(tree: dict[str, Any], size_m: float,
                    hash01: Callable[[int, int, int, int], float],
                    species: tuple[str, ...]) -> str:
    """The species `place_canopy` would have drawn for an already-placed tree.

    For canopy files written before the draw was restored. The canopy height model
    is an untiled S3 monolith read over the network, so re-placing is minutes per
    ward; the placement is deterministic, so the cell is recovered instead:

    - col/row from the position: jitter is bounded at JITTER (0.8) of a cell, so a
      tree never leaves its cell.
    - kk by matching the stored x/y to 1 cm against each candidate draw.
    - ties (two kk landing within 1 cm) broken by the stored radius, which is drawn
      from the same hash.

    Measured on the shipped wards: 59,184 of 59,184 recovered uniquely.
    """
    cell_m = size_m / CANOPY_GRID
    half = size_m / 2.0
    col = int((tree["x"] + half) / cell_m)
    row = int((half - tree["y"]) / cell_m)
    hits: list[int] = []
    for kk in range(DENSITY_MAX):
        jx = (hash01(col, row, kk, 0) - 0.5) * JITTER * cell_m
        jy = (hash01(col, row, kk, 1) - 0.5) * JITTER * cell_m
        if (abs(round((col + 0.5) * cell_m - half + jx, 2) - tree["x"]) < 0.011
                and abs(round(half - (row + 0.5) * cell_m + jy, 2) - tree["y"]) < 0.011):
            hits.append(kk)
    if len(hits) > 1:
        hits = [kk for kk in hits
                if abs(round(tree["h"] * 0.35 * (0.9 + 0.2 * hash01(col, row, kk, 2)), 2)
                       - tree["r"]) < 0.011]
    if len(hits) != 1:
        raise ValueError(f"cannot recover the cell of tree {tree} (candidates {hits})")
    return species[int(hash01(col, row, hits[0], 3) * len(species))]


def backfill_species(w: blr.Ward) -> None:
    """Write the species draw into an existing {ward}-canopy.json, offline."""
    kc = _kolkata_canopy()
    hash01 = cast(Callable[[int, int, int, int], float], kc._hash01)
    species = cast(tuple[str, ...], kc.SPECIES)
    path = os.path.join(blr.DATA, f"{w.id}-canopy.json")
    with open(path, encoding="utf-8") as fh:
        doc = cast(dict[str, Any], json.load(fh))
    mix: dict[str, int] = {}
    for t in doc["trees"]:
        t["species"] = recover_species(t, float(w.size_m), hash01, species)
        mix[t["species"]] = mix.get(t["species"], 0) + 1
    doc["method"] = str(doc["method"]).replace(
        "Species not assigned.",
        "Species drawn as Kolkata's: hash01(col, row, kk, 3) over its SPECIES tuple.")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} species {dict(sorted(mix.items()))}", flush=True)
```

In `build_canopy`, replace the whole block that starts with the comment
`# ── Kolkata's _generate, verbatim in logic, species omitted ──` and ends with
`cands.append({"x": x, "y": y, "h": round(h, 1), "r": r})` (the `cell_m`, `half`,
`cands` assignments and both nested loops) with:

```python
    # ── Kolkata's _generate, with Kolkata's species draw (see place_canopy) ──
    species = cast(tuple[str, ...], kc.SPECIES)
    cands = place_canopy(grid, w.size_m, hash01, species)
```

In the same function's `doc` literal, change the end of the `"method"` string from
`"measurement; canopy HEIGHT is measured. Species not assigned."` to
`"measurement; canopy HEIGHT is measured. Species drawn as Kolkata's: hash01(col, row, kk, 3) over its SPECIES tuple."`

In `main()`, add directly after the `if a.layer in ("canopy", "all"):` block:

```python
    if a.layer == "species":
        print("species (backfill Kolkata's draw into existing canopy files, offline):")
        for w in wards:
            backfill_species(w)
```

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 scripts/fetch-bangalore.py --self-test`
Expected: `  fetch-bangalore self-test OK`

- [ ] **Step 5: Prove the self-test can fail**

Temporarily change `sp = species[int(hash01(col, row, kk, 3) * len(species))]` in `place_canopy` to use axis `2` instead of `3`. Run the self-test.
Expected: `AssertionError: backfill disagrees with the source draw at …`. Restore axis `3` and re-run to confirm it passes.

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: `Success: no issues found`

- [ ] **Step 7: Add it to the Python chain**

In `package.json`, change `python3 scripts/_trees.py && ` at the start of `test:py` to
`python3 scripts/_trees.py && python3 scripts/fetch-bangalore.py --self-test && `.

Run: `npm run test:py`
Expected: passes, output includes `fetch-bangalore self-test OK`.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-bangalore.py package.json
git commit -m "fix(bangalore): restore Kolkata's species draw in the canopy placement

build_canopy reimplemented Kolkata's _generate 'verbatim in logic, species
omitted', so every Bengaluru tree rendered as neem. The draw now runs where the
cell identity (col, row, kk) still exists.

Existing canopy files are backfilled offline by recovering each tree's cell:
jitter is bounded at 0.8 of a cell, x/y match a candidate to 1 cm, and the
radius breaks ties. 59,184 of 59,184 recovered on the shipped wards. The
self-test proves the backfill reproduces the source draw exactly."
```

---

### Task 3: Kolkata's writer and check use the row format *(no commit)*

**Files:**
- Modify: `scripts/_types.py` (`TreesFileJSON`, around line 220)
- Modify: `scripts/fetch-canopy.py` (imports around line 80; `document()` around line 291; `check()` around line 364)

- [ ] **Step 1: Change the on-disk type**

In `scripts/_types.py`, in `class TreesFileJSON`, replace

```python
    source: str
    densityRefM: float
    trees: list[TreeInstanceJSON]
```

with

```python
    source: str
    densityRefM: float
    #: The on-disk row format (scripts/_trees.py): column names, species names,
    #: and one [x_m, y_m, h_dm, r_dm, species] row per tree. In memory, callers
    #: still use TreeInstanceJSON objects -- decode_trees converts.
    cols: list[str]
    speciesNames: list[str]
    trees: list[list[int]]
```

- [ ] **Step 2: Encode on write**

In `scripts/fetch-canopy.py`, after `import _types  # noqa: E402` add:

```python
import _trees  # noqa: E402
```

In `document()`, replace the returned literal with:

```python
    return {
        "ward": ward.id, "grid": GRID, "sizeM": float(ward.footprint_m),
        "retrieved": RETRIEVED, "source": CHM_PREFIX, "densityRefM": DENSITY_REF_H,
        "cols": list(_trees.COLS), "speciesNames": list(_trees.SPECIES_NAMES),
        "trees": _trees.encode_trees(trees),
    }
```

- [ ] **Step 3: Decode on check**

In `check()`, replace

```python
        check_provenance(wid, doc)
        for t in doc["trees"]:
```

with

```python
        check_provenance(wid, doc)
        # A pre-row-format artefact has neither key, and must say "regenerate"
        # rather than die on a KeyError -- same reasoning as check_provenance.
        raw = cast("dict[str, object]", doc)
        assert "cols" in raw and "speciesNames" in raw, (
            f"{wid}: trees file predates the row format -- regenerate it")
        trees = _trees.decode_trees(doc["cols"], doc["speciesNames"], doc["trees"])
        for t in trees:
```

Then, further down in the same function, replace each remaining `doc["trees"]` with `trees` — the count assertion (`len(doc["trees"])`, twice on one line), the lattice loop `for t in doc["trees"]:`, and the final `len(doc["trees"]) / 2`.

- [ ] **Step 4: Run the self-test**

Run: `python3 scripts/fetch-canopy.py --self-test`
Expected: `  fetch-canopy self-test OK`

If the lattice assertion (`trees still sit on the cell-centre lattice`) fails inside `_self_test_check_wiring`, **stop and report it** — whole-metre positions would then be defeating the lattice tripwire, and loosening the assertion is not an acceptable fix.

- [ ] **Step 5: Confirm `--check` now refuses the committed files, as expected**

Run: `python3 scripts/fetch-canopy.py --check`
Expected: FAIL with `trees file predates the row format -- regenerate it`. This is correct until Task 6 regenerates them. **Do not commit.**

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: `Success: no issues found`

---

### Task 4: The browser reads the row format *(no commit)*

**Files:**
- Modify: `src/scripts/climate-engine/vegetation-layer.ts` (`asTreesFile`, around line 24; `assertVegetationLogic`, around line 167)
- Test: `tests/unit/heat-map-vegetation.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/heat-map-vegetation.test.mjs`, change the import line to

```javascript
import { asTreesFile, assertVegetationLogic, createVegetationLayer, TREE_COLS } from '../../src/scripts/climate-engine/vegetation-layer.ts';
```

and replace the whole `test('asTreesFile validates the instance list', …)` block with:

```javascript
const HEADER = { ward: 'x', grid: 140, sizeM: 1400, retrieved: '2026-08-10',
  cols: ['x_m', 'y_m', 'h_dm', 'r_dm', 'species'], speciesNames: ['neem', 'gulmohar', 'palm'] };

test('asTreesFile decodes rows into the objects the layer draws', () => {
  assert.deepEqual([...TREE_COLS], HEADER.cols, 'the column order is the contract with scripts/_trees.py');
  const f = asTreesFile({ ...HEADER, trees: [[1, -2, 63, 21, 2], [-916, 1395, 43, 15, 0]] });
  assert.ok(f, 'valid rows accepted');
  assert.deepEqual(f.trees[0], { x: 1, y: -2, h: 6.3, species: 'palm', r: 2.1 });
  assert.equal(f.trees[1].species, 'neem');
});

test('asTreesFile refuses the old object rows rather than rendering half a migration', () => {
  assert.equal(asTreesFile({ ...HEADER, trees: [{ x: 1, y: 2, h: 6, species: 'neem', r: 2 }] }), null);
  assert.equal(asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, trees: [{ x: 1, y: 2, h: 6, species: 'neem', r: 2 }] }), null);
});

test('asTreesFile refuses a header or row it cannot trust', () => {
  assert.equal(asTreesFile(null), null, 'null rejected');
  assert.equal(asTreesFile({ ...HEADER, trees: 'no' }), null, 'trees must be an array');
  assert.equal(asTreesFile({ ...HEADER, cols: ['y_m', 'x_m', 'h_dm', 'r_dm', 'species'], trees: [] }), null, 'swapped columns');
  assert.equal(asTreesFile({ ...HEADER, speciesNames: ['oak'], trees: [[0, 0, 50, 10, 0]] }), null, 'unknown species name');
  assert.equal(asTreesFile({ ...HEADER, trees: [[0, 0, 50, 10, 3]] }), null, 'species index out of range');
  assert.equal(asTreesFile({ ...HEADER, trees: [[0, 0, 50, 10]] }), null, 'short row');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: FAIL — `TREE_COLS` is not exported and the row-format cases return `null`.

- [ ] **Step 3: Rewrite `asTreesFile`**

In `src/scripts/climate-engine/vegetation-layer.ts`, replace the whole `export function asTreesFile(…) { … }` with:

```typescript
/** The on-disk row format written by scripts/_trees.py. The order is the contract. */
export const TREE_COLS = ['x_m', 'y_m', 'h_dm', 'r_dm', 'species'] as const;
const SPECIES_NAMES: readonly Species[] = ['neem', 'gulmohar', 'palm'];

export function asTreesFile(raw: unknown): TreesFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  /* ONE FORMAT, AND THE OLD ONE IS REFUSED. A reader that also accepted the old
     object rows would hide a half-migrated artefact set: some wards would render
     and nothing would say the rest were stale. The rows are decoded here, at the
     boundary, so everything that draws a tree still sees TreeInstance objects. */
  if (!Array.isArray(d.cols) || d.cols.length !== TREE_COLS.length
      || d.cols.some((c, i) => c !== TREE_COLS[i])) return null;
  if (!Array.isArray(d.speciesNames)) return null;
  const names = d.speciesNames as unknown[];
  if (names.some((n) => !SPECIES_NAMES.includes(n as Species))) return null;
  if (!Array.isArray(d.trees)) return null;
  const trees: TreeInstance[] = [];
  for (const row of d.trees) {
    if (!Array.isArray(row) || row.length !== TREE_COLS.length) return null;
    const [x, y, hDm, rDm, s] = row as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || typeof hDm !== 'number'
        || typeof rDm !== 'number' || typeof s !== 'number' || !Number.isInteger(s)) return null;
    const species = names[s];
    if (species === undefined) return null;
    trees.push({ x, y, h: hDm / 10, species: species as Species, r: rDm / 10 });
  }
  return {
    ward: typeof d.ward === 'string' ? d.ward : '',
    grid: typeof d.grid === 'number' ? d.grid : 0,
    sizeM: typeof d.sizeM === 'number' ? d.sizeM : 0,
    retrieved: typeof d.retrieved === 'string' ? d.retrieved : '',
    trees,
  };
}
```

In `assertVegetationLogic`, replace its first four checks (the `null rejected`, `bad species rejected` and `valid accepted` lines and the `const f = …` between them) with:

```typescript
  const header = { ward: 'x', grid: 140, sizeM: 1400, retrieved: 'd',
    cols: [...TREE_COLS], speciesNames: ['neem', 'gulmohar', 'palm'] };
  ok(asTreesFile(null) === null, 'null rejected');
  ok(asTreesFile({ ...header, speciesNames: ['oak'], trees: [[0, 0, 50, 10, 0]] }) === null, 'unknown species name rejected');
  ok(asTreesFile({ ...header, trees: [{ x: 1, y: 2, h: 6, species: 'palm', r: 2 }] }) === null, 'old object rows rejected');
  const f = asTreesFile({ ...header, trees: [[1, 2, 60, 20, 2]] });
  ok(f !== null && f.trees[0].species === 'palm' && f.trees[0].h === 6 && f.trees[0].r === 2, 'valid rows accepted');
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: all pass, including `vegetation self-check passes`.

- [ ] **Step 5: TypeScript gate**

Run: `npm run check`
Expected: `0 errors`. **Do not commit.**

---

### Task 5: Bengaluru's writer encodes rows with real species *(no commit)*

**Files:**
- Modify: `scripts/export-bangalore-obos.py` (the `TREE_SPECIES` block around line 70; `export_trees` around line 200)

- [ ] **Step 1: Import the codec**

Directly after the line `import _bangalore as blr`, add:

```python
import _trees  # noqa: E402
```

- [ ] **Step 2: Remove the constant**

Delete the `TREE_SPECIES = "neem"` assignment and the five-line `#:` comment directly above it that begins `#: Kolkata's trees carry a deterministic species mix and Bengaluru's carry one`.

- [ ] **Step 3: Encode with the canopy file's species**

In `export_trees`, replace

```python
    doc: dict[str, Any] = {
        "ward": w.id,
        "grid": cn["grid"],
        "sizeM": ward_size_m(w),
        "retrieved": "2026-09-11",
        "source": cn["source"],
        "densityRefM": cn["densityRefM"],
        "trees": [{"x": t["x"], "y": t["y"], "h": t["h"], "r": t["r"],
                   "species": TREE_SPECIES} for t in cn["trees"]],
    }
```

with

```python
    if any("species" not in t for t in cn["trees"]):
        raise SystemExit(f"{w.id}: canopy file has trees with no species -- run "
                         "python3 scripts/fetch-bangalore.py --layer species first")
    doc: dict[str, Any] = {
        "ward": w.id,
        "grid": cn["grid"],
        "sizeM": ward_size_m(w),
        "retrieved": "2026-09-11",
        "source": cn["source"],
        "densityRefM": cn["densityRefM"],
        "cols": list(_trees.COLS),
        "speciesNames": list(_trees.SPECIES_NAMES),
        "trees": _trees.encode_trees(cn["trees"]),
    }
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: `Success: no issues found`. **Do not commit.**

---

### Task 6: Regenerate the six tree files, pin them, and commit Tasks 3–6

**Files:**
- Regenerate: `data/bangalore/{indiranagar,mg-road,whitefield}-canopy.json`
- Regenerate: `public/heat-map/data/{ballygunge,baruipur,barrackpore,indiranagar,mg-road,whitefield}-trees.json`
- Create: `tests/unit/trees-artefacts.test.mjs`

- [ ] **Step 1: Write the artefact test**

Create `tests/unit/trees-artefacts.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { asTreesFile } from '../../src/scripts/climate-engine/vegetation-layer.ts';

/**
 * THE SIX SHIPPED TREE FILES PARSE IN THE FORMAT THE BROWSER READS.
 *
 * asTreesFile returns null for a whole file on any malformed record, and a null
 * here is a ward drawn with no trees at all -- silently. So every shipped file is
 * read through the real reader, with its tree count and, for Bengaluru, its
 * species mix pinned. The mixes are the recovered draw (59,184 of 59,184 trees);
 * a regression to one species, or to the old object rows, fails here.
 */
const read = (ward) => asTreesFile(JSON.parse(readFileSync(
  new URL(`../../public/heat-map/data/${ward}-trees.json`, import.meta.url), 'utf8')));

const mixOf = (file) => file.trees.reduce((m, t) => ({ ...m, [t.species]: (m[t.species] ?? 0) + 1 }), {});

const EXPECTED = {
  ballygunge: { count: 12159 },
  baruipur: { count: 8415 },
  barrackpore: { count: 6811 },
  indiranagar: { count: 23565, mix: { neem: 11779, palm: 5930, gulmohar: 5856 } },
  'mg-road': { count: 24819, mix: { neem: 12316, palm: 6262, gulmohar: 6241 } },
  whitefield: { count: 10800, mix: { neem: 5308, palm: 2754, gulmohar: 2738 } },
};

for (const [ward, expected] of Object.entries(EXPECTED)) {
  test(`${ward}: the shipped tree file parses, every tree kept, more than one species`, () => {
    const file = read(ward);
    assert.ok(file, `${ward}: asTreesFile rejected the shipped file -- the ward would render with no trees`);
    assert.equal(file.trees.length, expected.count);
    const mix = mixOf(file);
    assert.ok(Object.keys(mix).length > 1, `${ward}: every tree is one species`);
    if (expected.mix) assert.deepEqual(mix, expected.mix);
  });
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test tests/unit/trees-artefacts.test.mjs`
Expected: FAIL on all six — the committed files are still the old object rows, which `asTreesFile` now refuses.

- [ ] **Step 3: Backfill Bengaluru's species**

Run: `python3 scripts/fetch-bangalore.py --layer species`
Expected:
```
species (backfill Kolkata's draw into existing canopy files, offline):
  indiranagar  species {'gulmohar': 5856, 'neem': 11779, 'palm': 5930}
  mg-road      species {'gulmohar': 6241, 'neem': 12316, 'palm': 6262}
  whitefield   species {'gulmohar': 2738, 'neem': 5308, 'palm': 2754}
```
If any `ValueError: cannot recover the cell` is raised, **stop and report** the tree it names.

- [ ] **Step 4: Re-export Bengaluru**

Run: `python3 scripts/export-bangalore-obos.py`
Then run: `git status --porcelain public/heat-map/data data/bangalore`
Expected: modified files are **only** the three `*-canopy.json` under `data/bangalore/` and the three Bengaluru `*-trees.json`. If any ward, roads or water file changed, **stop and report** — the exporter rewrote more than trees.

- [ ] **Step 5: Re-encode Kolkata's three files through the real writer**

Run:
```bash
python3 - <<'EOF'
import importlib.util, json, sys
sys.path.insert(0, "scripts")
spec = importlib.util.spec_from_file_location("fc", "scripts/fetch-canopy.py")
assert spec is not None and spec.loader is not None
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)
for wid in ("ballygunge", "baruipur", "barrackpore"):
    path = f"public/heat-map/data/{wid}-trees.json"
    with open(path, encoding="utf-8") as fh:
        old = json.load(fh)
    assert isinstance(old["trees"][0], dict), f"{wid} is already in the row format"
    new = fc.document(fc.WARDS[wid], old["trees"])
    for key in ("ward", "grid", "sizeM", "retrieved", "source", "densityRefM"):
        assert new[key] == old[key], f"{wid}: header {key} would change {old[key]!r} -> {new[key]!r}"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(fc.serialise(new))
    print(f"  {wid:<12} {len(new['trees']):>6} trees re-encoded")
EOF
```
Expected:
```
  ballygunge    12159 trees re-encoded
  baruipur       8415 trees re-encoded
  barrackpore    6811 trees re-encoded
```

- [ ] **Step 6: Run the artefact test and watch it pass**

Run: `npx tsx --test tests/unit/trees-artefacts.test.mjs`
Expected: 6 pass.

- [ ] **Step 7: Prove the artefact test can fail**

Temporarily swap `'x_m'` and `'y_m'` in `TREE_COLS` in `vegetation-layer.ts`. Run the artefact test.
Expected: all six FAIL with `asTreesFile rejected the shipped file`. Restore and re-run to confirm 6 pass.

- [ ] **Step 8: Measure the size change**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
let total = 0;
for (const w of ['ballygunge','baruipur','barrackpore','indiranagar','mg-road','whitefield']) {
  const b = brotliCompressSync(readFileSync('public/heat-map/data/' + w + '-trees.json'), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  total += b; console.log('  ' + w.padEnd(12) + String(Math.round(b / 1024)).padStart(5) + ' KB');
}
console.log('  all six     ' + String(Math.round(total / 1024)).padStart(5) + ' KB');"
```
Expected: all six about **424 KB** (spec table: 55 / 38 / 31 / 119 / 123 / 57). Report the actual numbers.

- [ ] **Step 9: Run every gate**

Run each and confirm:
- `python3 scripts/fetch-canopy.py --check` → `canopy artefacts OK`
- `npm run test:py` → passes
- `npm run typecheck` → `Success: no issues found`
- `npm run check` → `0 errors`
- `npm run test:unit` → `fail 0` (includes `kolkata-unchanged.test.mjs`, which must not move — buildings are untouched)
- `python3 scripts/check-bangalore-artefacts.py; echo $?` → `0`
- `python3 scripts/check-bangalore-frame.py; echo $?` → `0`

- [ ] **Step 10: Commit Tasks 3–6 together**

```bash
git add scripts/_types.py scripts/fetch-canopy.py scripts/export-bangalore-obos.py \
  src/scripts/climate-engine/vegetation-layer.ts \
  tests/unit/heat-map-vegetation.test.mjs tests/unit/trees-artefacts.test.mjs \
  data/bangalore/indiranagar-canopy.json data/bangalore/mg-road-canopy.json data/bangalore/whitefield-canopy.json \
  public/heat-map/data/ballygunge-trees.json public/heat-map/data/baruipur-trees.json \
  public/heat-map/data/barrackpore-trees.json public/heat-map/data/indiranagar-trees.json \
  public/heat-map/data/mg-road-trees.json public/heat-map/data/whitefield-trees.json
git commit -m "feat(trees): row-format tree files, and Bengaluru's species, in one commit

The reader, both writers and all six files land together because asTreesFile
refuses a whole file on any bad record: committing the reader first would
render wards with no trees.

Rows of [x_m, y_m, h_dm, r_dm, species], decoded at both boundaries. Brotli
across the six wards: 715 -> ~424 KB. Bengaluru's canopy files carry the
recovered species draw, so its trees render Kolkata's half-neem mix instead of
all neem. Buildings are untouched and kolkata-unchanged stays green."
```

---

### Task 7: A loading chip that neither flashes nor hides a failure

**Files:**
- Create: `src/scripts/climate-engine/load-chip.ts`
- Test: `tests/unit/heat-load-chip.test.mjs`
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (imports; after `const el = …` around line 214; `loadWard` around lines 1968, 1981, 2138, 2157)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-load-chip.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoadChip, MIN_VISIBLE_MS, SHOW_AFTER_MS } from '../../src/scripts/climate-engine/load-chip.ts';

function rig() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const classes = new Set();
  const el = { textContent: '', classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  return { chip: createLoadChip(el, clock), el, visible: () => classes.has('on'), advance };
}

test('a switch that finishes before the threshold never shows the chip', () => {
  const r = rig();
  r.chip.start('Loading MG Road…');
  r.advance(299);
  /* Checked HERE, not only at the end: a chip shown at 0 ms is hidden again by
     2,299 ms, so an end-only assertion passes with SHOW_AFTER_MS = 0. */
  assert.equal(r.visible(), false, 'shown before the threshold');
  r.chip.done();
  r.advance(2000);
  assert.equal(r.visible(), false);
});

test('a slow load shows the chip once the threshold passes', () => {
  const r = rig();
  r.chip.start('Loading MG Road…');
  r.advance(SHOW_AFTER_MS - 1);
  assert.equal(r.visible(), false);
  r.advance(1);
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'Loading MG Road…');
});

test('a load finishing just after the threshold keeps the chip up for the minimum', () => {
  const r = rig();
  r.chip.start('Loading');
  r.advance(SHOW_AFTER_MS + 10);
  r.chip.done();
  assert.equal(r.visible(), true, 'must not vanish the instant it appeared');
  r.advance(MIN_VISIBLE_MS - 11);
  assert.equal(r.visible(), true);
  r.advance(1);
  assert.equal(r.visible(), false);
});

test('a failure shows at once, with no threshold', () => {
  const r = rig();
  r.chip.fail('MG Road could not load.');
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'MG Road could not load.');
});

test('a failure after a pending start cancels the delayed show and stays up', () => {
  const r = rig();
  r.chip.start('Loading');
  r.advance(100);
  r.chip.fail('could not load');
  r.advance(5000);
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'could not load');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test tests/unit/heat-load-chip.test.mjs`
Expected: FAIL — cannot find module `load-chip.ts`.

- [ ] **Step 3: Write the module**

Create `src/scripts/climate-engine/load-chip.ts`:

```typescript
/**
 * THE LOADING CHIP, TIMED SO IT NEITHER FLASHES NOR HIDES A FAILURE.
 *
 * Measured: the chip fades over 0.25 s and an in-place switch takes 248–299 ms,
 * so it used to fade in and be removed as it reached full opacity. A delay alone
 * does not fix that — a prefetched switch took 393 ms on Slow 4G, so a slightly
 * slower connection finishes just after the delay and would remove the chip the
 * instant it appears. So: show only after SHOW_AFTER_MS, and once shown stay up
 * at least MIN_VISIBLE_MS. A refusal or failure shows at once and is never delayed.
 */
export const SHOW_AFTER_MS = 400;
export const MIN_VISIBLE_MS = 500;

export interface ChipElement {
  textContent: string | null;
  classList: { add(token: string): void; remove(token: string): void };
}

export interface ChipClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface LoadChip {
  /** A load began. Shows `text` only if it is still loading after SHOW_AFTER_MS. */
  start(text: string): void;
  /** The load finished. Hides now, or once it has been visible MIN_VISIBLE_MS. */
  done(): void;
  /** Show `text` immediately and leave it up — a refusal or a failure. */
  fail(text: string): void;
}

export function createLoadChip(el: ChipElement | null, clock: ChipClock): LoadChip {
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let shownAt: number | null = null;

  const clear = (): void => {
    if (showTimer !== null) { clock.clearTimeout(showTimer); showTimer = null; }
    if (hideTimer !== null) { clock.clearTimeout(hideTimer); hideTimer = null; }
  };
  const show = (text: string): void => {
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    shownAt = clock.now();
  };
  const hide = (): void => {
    el?.classList.remove('on');
    shownAt = null;
  };

  return {
    start(text) {
      clear();
      /* Already visible from a load this one superseded: retitle and keep it up,
         rather than blinking it off and on again. */
      if (shownAt !== null) { show(text); return; }
      showTimer = clock.setTimeout(() => { showTimer = null; show(text); }, SHOW_AFTER_MS);
    },
    done() {
      clear();
      if (shownAt === null) return;
      const remaining = MIN_VISIBLE_MS - (clock.now() - shownAt);
      if (remaining <= 0) hide();
      else hideTimer = clock.setTimeout(() => { hideTimer = null; hide(); }, remaining);
    },
    fail(text) {
      clear();
      show(text);
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx --test tests/unit/heat-load-chip.test.mjs`
Expected: 5 pass.

- [ ] **Step 5: Prove the test can fail**

Temporarily set `SHOW_AFTER_MS = 0`. Run the test.
Expected: `a switch that finishes before the threshold never shows the chip` FAILS. Restore `400` and re-run.

- [ ] **Step 6: Wire it into the instrument**

In `src/scripts/climate-engine/heat-map-app.ts`:

Add beside the other local imports:
```typescript
import { createLoadChip } from './load-chip';
```

Directly after `const el = (id: string) => document.getElementById(id);`, add:
```typescript
  const loadChip = createLoadChip(el('loadchip'), {
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  });
```

In `loadWard`, replace
```typescript
    if (refusal !== null) {
      const chip = el('loadchip');
      if (chip) { chip.textContent = refusal; chip.classList.add('on'); }
      return;
    }
```
with
```typescript
    if (refusal !== null) {
      loadChip.fail(refusal);
      return;
    }
```

Replace
```typescript
    const load = el('loadchip');
    if (load) { load.textContent = `Loading ${w.name}…`; load.classList.add('on'); }
```
with
```typescript
    loadChip.start(`Loading ${w.name}…`);
```

Replace (this also deletes the never-visible "Building ward…" text)
```typescript
    if (load) { load.textContent = 'Building ward…'; load.classList.remove('on'); }
```
with
```typescript
    loadChip.done();
```

Replace
```typescript
      if (load) load.textContent = `${w.name} could not load.`;
```
with
```typescript
      loadChip.fail(`${w.name} could not load.`);
```

Then run: `grep -n "loadchip\|\bload\b\." src/scripts/climate-engine/heat-map-app.ts`
Expected: only the `el('loadchip')` inside `createLoadChip(...)` remains.

- [ ] **Step 7: Gates**

Run: `npm run check` → `0 errors`; `npm run test:unit` → `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/climate-engine/load-chip.ts tests/unit/heat-load-chip.test.mjs src/scripts/climate-engine/heat-map-app.ts
git commit -m "fix(heat-map): the loading chip waits 400 ms and stays at least 500 ms

It faded over 0.25 s on switches that took 248-299 ms, so it flickered. A
delay alone would still flicker on a load finishing just after it, so a shown
chip now stays up for a minimum. Refusals and failures show immediately. The
'Building ward...' text, set and hidden in one statement, is gone."
```

---

### Task 8: The model URL moves into three-free `scope/paths.ts`

**Why this task exists.** Prefetch needs to know which wards have a GLB and where it lives. That knowledge is in `explore/building-model.ts`, which does `import * as THREE from 'three'` at module scope (line 52). Importing it from `heat-map-app.ts`, or from anything that file imports, would pull three.js into the main bundle. `heat-explore-module-boundary.test.mjs` only greps `heat-map-app.ts`'s own source for `from 'three'`, so it would **not** catch that transitive import. `building-model.ts:228` also builds the URL by hand, where `paths.ts` is meant to be the only module that spells a data URL.

**Files:**
- Modify: `src/scripts/climate-engine/scope/paths.ts` (after `const DATA = …`)
- Modify: `src/scripts/climate-engine/explore/building-model.ts` (imports around line 52; lines 67–71; the fetch around line 228)
- Test: `tests/unit/scope-model-path.test.mjs`
- Modify: `tests/unit/heat-explore-module-boundary.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/scope-model-path.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_WARDS, modelPath } from '../../src/scripts/climate-engine/scope/paths.ts';
import { hasBuildingModel } from '../../src/scripts/climate-engine/explore/building-model.ts';

test('modelPath names the GLB for a ward with an authored city, and nothing for one without', () => {
  assert.equal(modelPath('mg-road'), '/heat-map/models/mg-road.glb');
  assert.equal(modelPath('ballygunge'), null);
});

test('hasBuildingModel and modelPath answer from one list', () => {
  for (const ward of [...MODEL_WARDS, 'ballygunge', 'baruipur', 'barrackpore']) {
    assert.equal(hasBuildingModel(ward), modelPath(ward) !== null, ward);
  }
});
```

Append to `tests/unit/heat-explore-module-boundary.test.mjs`:

```javascript
test('scope/paths.ts stays free of three.js, directly and via building-model', async () => {
  const source = await read('../../src/scripts/climate-engine/scope/paths.ts');
  assert.doesNotMatch(source, /from\s+['"]three(?:\/|['"])/, 'paths.ts imports three');
  assert.doesNotMatch(source, /from\s+['"][^'"]*building-model(?:\.ts)?['"]/,
    'paths.ts imports building-model, which imports three at module scope');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx tsx --test tests/unit/scope-model-path.test.mjs`
Expected: FAIL — `MODEL_WARDS` / `modelPath` are not exported from `paths.ts`.

- [ ] **Step 3: Add the model URL to `paths.ts`**

In `src/scripts/climate-engine/scope/paths.ts`, directly after `const DATA = \`${ROOT}data/\`;`, add:

```typescript
/**
 * Wards with an authored glTF city, and where it is served.
 *
 * MOVED HERE FROM explore/building-model.ts, which imports three at module scope.
 * Anything outside the lazy relief chunk that needed to know whether a ward has a
 * model — ward prefetch first — would otherwise pull three.js into the main bundle
 * through that import. heat-explore-module-boundary.test.mjs greps heat-map-app.ts's
 * own source for `from 'three'`, so it would not see a TRANSITIVE import; this
 * module is three-free by construction instead. It is also the one module allowed
 * to spell a data URL, and building-model.ts used to spell this one by hand.
 */
export const MODEL_WARDS: readonly string[] = ['indiranagar', 'mg-road', 'whitefield'];

export function modelPath(areaId: string): string | null {
  return MODEL_WARDS.includes(areaId) ? `${ROOT}models/${areaId}.glb` : null;
}
```

- [ ] **Step 4: Make `building-model.ts` use it**

Directly after `import * as THREE from 'three';`, add:
```typescript
import { MODEL_WARDS, modelPath } from '../scope/paths.ts';
```

Replace
```typescript
export const MODEL_WARDS: readonly string[] = ['indiranagar', 'mg-road', 'whitefield'];

export function hasBuildingModel(ward: string): boolean {
  return MODEL_WARDS.includes(ward);
}
```
with
```typescript
/* Re-exported so existing importers keep working; the list itself lives in
   scope/paths.ts, which is three-free. See the note there. */
export { MODEL_WARDS };

export function hasBuildingModel(ward: string): boolean {
  return modelPath(ward) !== null;
}
```

Replace
```typescript
    const response = await fetch(`/heat-map/models/${ward}.glb`, { signal });
```
with
```typescript
    const url = modelPath(ward);
    if (url === null) return null;
    const response = await fetch(url, { signal });
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx tsx --test tests/unit/scope-model-path.test.mjs tests/unit/heat-explore-module-boundary.test.mjs tests/unit/bangalore-building-model.test.mjs`
Expected: all pass.

- [ ] **Step 6: Prove the boundary test can fail**

Temporarily add `import { hasBuildingModel } from '../explore/building-model.ts';` to the top of `paths.ts`. Run the boundary test.
Expected: `scope/paths.ts stays free of three.js` FAILS. Remove the import and re-run.

- [ ] **Step 7: Gates**

Run: `npm run check` → `0 errors`; `npm run test:unit` → `fail 0`; `npm run build` → completes.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/climate-engine/scope/paths.ts src/scripts/climate-engine/explore/building-model.ts \
  tests/unit/scope-model-path.test.mjs tests/unit/heat-explore-module-boundary.test.mjs
git commit -m "refactor(scope): the model URL lives in three-free paths.ts

building-model.ts imports three at module scope, so anything outside the lazy
relief chunk that asked 'does this ward have a model' would pull three.js into
the main bundle. The boundary test only greps heat-map-app.ts's own source, so
it would not have seen that. paths.ts now owns MODEL_WARDS and modelPath,
building-model re-exports them, and the hand-built GLB URL is gone."
```

---

### Task 9: The sibling-ward prefetch module

**Files:**
- Create: `src/scripts/climate-engine/ward-prefetch.ts`
- Test: `tests/unit/heat-ward-prefetch.test.mjs`
- Modify: `tests/unit/heat-explore-module-boundary.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/heat-ward-prefetch.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { prefetchPlan, runPrefetch, shouldPrefetch } from '../../src/scripts/climate-engine/ward-prefetch.ts';

test('prefetch backs off for Save-Data and 2G, and runs otherwise', () => {
  assert.equal(shouldPrefetch(undefined), true);
  assert.equal(shouldPrefetch({ effectiveType: '4g' }), true);
  assert.equal(shouldPrefetch({ saveData: true, effectiveType: '4g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: '2g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: 'slow-2g' }), false);
});

test('the plan is the two other Bengaluru wards, each with its model', () => {
  const plan = prefetchPlan('in/bengaluru/indiranagar');
  assert.equal(plan.length, 2);
  const flat = plan.flat();
  assert.ok(flat.includes('/heat-map/data/mg-road.json'));
  assert.ok(flat.includes('/heat-map/data/whitefield-trees.json'));
  assert.ok(flat.includes('/heat-map/models/mg-road.glb'));
  assert.ok(flat.includes('/heat-map/data/whitefield-layers.json'), 'renderSources re-reads the manifest on every switch');
  assert.ok(flat.includes('/heat-map/data/mg-road-surface.png'), 'surface-raster fetches the PNG on every switch');
  assert.ok(!flat.some((url) => url.includes('indiranagar')), 'never the ward already open');
});

test('a Kolkata plan asks for no GLB, because Kolkata has none', () => {
  const flat = prefetchPlan('in/kolkata/ballygunge').flat();
  assert.ok(flat.includes('/heat-map/data/baruipur.json'));
  assert.ok(!flat.some((url) => url.endsWith('.glb')));
});

test('runPrefetch goes ward by ward, reads every body, and stops when aborted', async () => {
  const calls = [];
  let bodies = 0;
  const controller = new AbortController();
  const fakeFetch = async (url) => {
    calls.push(url);
    return { arrayBuffer: async () => { bodies += 1; if (url === 'b1') controller.abort(); return new ArrayBuffer(0); } };
  };
  const fetched = await runPrefetch([['a1', 'a2'], ['b1'], ['c1']], fakeFetch, controller.signal);
  assert.deepEqual(calls, ['a1', 'a2', 'b1'], 'the ward after the abort is never started');
  assert.equal(bodies, 3);
  assert.equal(fetched, 3);
});
```

In `tests/unit/heat-explore-module-boundary.test.mjs`, change the test added in Task 8 so it loops over both files:

```javascript
test('scope/paths.ts and ward-prefetch.ts stay free of three.js, directly and via building-model', async () => {
  for (const path of ['../../src/scripts/climate-engine/scope/paths.ts',
    '../../src/scripts/climate-engine/ward-prefetch.ts']) {
    const source = await read(path);
    assert.doesNotMatch(source, /from\s+['"]three(?:\/|['"])/, `${path} imports three`);
    assert.doesNotMatch(source, /from\s+['"][^'"]*building-model(?:\.ts)?['"]/,
      `${path} imports building-model, which imports three at module scope`);
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx tsx --test tests/unit/heat-ward-prefetch.test.mjs`
Expected: FAIL — cannot find module `ward-prefetch.ts`.

- [ ] **Step 3: Write the module**

Create `src/scripts/climate-engine/ward-prefetch.ts`:

```typescript
/**
 * PREFETCH THE CITY'S OTHER WARDS ONCE THE FIRST HAS LOADED.
 *
 * Measured on production under Slow 4G: switching back to a ward already visited
 * took 393 ms; to one not yet visited, 2,238 and 2,176 ms. The difference is the
 * first download. Every ward file loads through a plain `fetch` — the ward JSON,
 * the GLB and the surface PNG alike — so fetching the same URLs in the background
 * warms exactly the cache a switch reads, and the switch takes the revisit path.
 *
 * The cost is data the reader may never use (about 1.5–1.9 MB per Bengaluru
 * visit), so this backs off for Save-Data and 2G, fetches one ward at a time, and
 * is aborted the moment a real ward load begins.
 *
 * Three-free on purpose, and pinned by heat-explore-module-boundary.test.mjs: the
 * model URL comes from scope/paths.ts, never from explore/building-model.ts.
 */
import { areaKeysInCity, splitKey, type AreaKey } from './scope/registry.ts';
import { modelPath, paths } from './scope/paths.ts';

export interface PrefetchConnection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** False on Save-Data, or on a connection too slow to spend data on a guess. */
export function shouldPrefetch(connection: PrefetchConnection | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

/** One URL list per other ward in the city: the files a switch to that ward fetches. */
export function prefetchPlan(key: AreaKey): string[][] {
  return areaKeysInCity(key)
    .filter((sibling) => sibling !== key)
    .flatMap((sibling) => {
      const p = paths(sibling);
      if (p === null) return [];
      /* The same files a switch fetches for a ward, so every one of them is warm:
         loadWard's JSON, surface-raster's two PNGs, and the layers manifest that
         renderSources (heat-map-app.ts) re-reads on every switch. */
      const urls = [p.ward, p.terrain, p.water, p.roads, p.labels, p.provenance,
        p.trees, p.surface, p.canopy, p.layers, p.pv];
      const model = modelPath(splitKey(sibling).area);
      return [model === null ? urls : [...urls, model]];
    });
}

/** Fetch ward by ward, each ward's files together. Resolves with how many completed. */
export async function runPrefetch(plan: readonly (readonly string[])[], fetchImpl: typeof fetch,
  signal: AbortSignal): Promise<number> {
  let fetched = 0;
  for (const urls of plan) {
    if (signal.aborted) break;
    const results = await Promise.allSettled(urls.map(async (url) => {
      const response = await fetchImpl(url, { signal, priority: 'low' } as RequestInit);
      /* READ THE BODY. An unread response can leave the cache entry incomplete, and a
         half-warmed cache is the one outcome worse than not prefetching at all. */
      await response.arrayBuffer();
    }));
    fetched += results.filter((result) => result.status === 'fulfilled').length;
  }
  return fetched;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx tsx --test tests/unit/heat-ward-prefetch.test.mjs tests/unit/heat-explore-module-boundary.test.mjs`
Expected: all pass.

- [ ] **Step 5: Prove the planner test can fail**

Temporarily remove `.filter((sibling) => sibling !== key)` in `prefetchPlan`. Run the prefetch test.
Expected: `the plan is the two other Bengaluru wards` FAILS (3 wards, and the open ward is included). Restore and re-run.

- [ ] **Step 6: Gates**

Run: `npm run check` → `0 errors`; `npm run test:unit` → `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/ward-prefetch.ts tests/unit/heat-ward-prefetch.test.mjs \
  tests/unit/heat-explore-module-boundary.test.mjs
git commit -m "feat(heat-map): a prefetch planner for the city's other wards

Production, Slow 4G: 393 ms back to a visited ward, 2.2 s to an unvisited one.
Fetching the same URLs in the background warms the cache a switch reads. Backs
off for Save-Data and 2G, fetches ward by ward, reads every body, stops when
aborted, and stays three-free."
```

---

### Task 10: Wire prefetch into the instrument, with an e2e gate

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (imports; app scope after `const loadChip = …`; `loadWard`; `dispose`)
- Create: `tests/e2e/heat-map-ward-prefetch.spec.ts`

- [ ] **Step 1: Write the failing e2e spec**

Create `tests/e2e/heat-map-ward-prefetch.spec.ts`:

```typescript
import { expect, test, type Page } from '@playwright/test';

/**
 * THE CITY'S OTHER WARDS ARE FETCHED IN THE BACKGROUND — AND NOT UNDER SAVE-DATA.
 *
 * Asserts REQUESTS, not timings. The preview server sends no cache headers, so a
 * switch-time assertion here would measure the test harness, not the feature.
 */
const OPEN = '/heat-map/in/bengaluru/indiranagar/';
const SIBLINGS = [
  '/heat-map/data/mg-road.json',
  '/heat-map/data/whitefield.json',
  '/heat-map/models/mg-road.glb',
];

function recordRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(new URL(request.url()).pathname));
  return seen;
}

async function waitForWard(page: Page): Promise<void> {
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });
}

test("after the first ward loads, the city's other wards are fetched in the background", async ({ page }) => {
  const seen = recordRequests(page);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await waitForWard(page);
  await expect.poll(() => SIBLINGS.filter((url) => seen.includes(url)), { timeout: 20_000 }).toEqual(SIBLINGS);
});

test('with Save-Data set, no other ward is fetched', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true, value: { saveData: true, effectiveType: '4g' },
    });
  });
  const seen = recordRequests(page);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await waitForWard(page);
  /* requestIdleCallback's timeout is 4 s, so a prefetch that was going to run has
     started by 8 s. A bounded wait is the only way to assert that something did NOT
     happen. If this fails, find what else is requesting a sibling — do not loosen it. */
  await page.waitForTimeout(8_000);
  expect(SIBLINGS.filter((url) => seen.includes(url))).toEqual([]);
});
```

- [ ] **Step 2: Build and watch it fail**

Run: `npm run build`, then `npx playwright test tests/e2e/heat-map-ward-prefetch.spec.ts --project=chromium-tier0 --reporter=line`
Expected: the first test FAILS (siblings never requested); the Save-Data test passes.

- [ ] **Step 3: Wire it in**

In `src/scripts/climate-engine/heat-map-app.ts`:

Add beside the other local imports:
```typescript
import { prefetchPlan, runPrefetch, shouldPrefetch } from './ward-prefetch';
```

Directly after the `const loadChip = createLoadChip(…);` statement from Task 7, add:
```typescript
  /* One background warm-up per page load — see ward-prefetch.ts for the measurement
     that justifies it and the data it costs. */
  let prefetchStarted = false;
  let prefetchAbort: AbortController | null = null;
  function schedulePrefetch(key: AreaKey): void {
    if (prefetchStarted) return;
    prefetchStarted = true;
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!shouldPrefetch(connection)) return;
    const plan = prefetchPlan(key);
    if (plan.length === 0) return;
    const controller = new AbortController();
    prefetchAbort = controller;
    const go = (): void => {
      if (appDisposed || controller.signal.aborted) return;
      void runPrefetch(plan, fetch.bind(window), controller.signal).catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 4000 });
    else window.setTimeout(go, 2000);
  }
```

In `loadWard`, replace
```typescript
    const token = wardSession.begin(name);
    if (!token) return;
```
with
```typescript
    const token = wardSession.begin(name);
    if (!token) return;
    /* A real load owns the network: any background warm-up stops the moment it starts. */
    prefetchAbort?.abort();
```

In `loadWard`, replace
```typescript
      wardSession.commit(token);
      fetchLive(name);
```
with
```typescript
      wardSession.commit(token);
      fetchLive(name);
      schedulePrefetch(name);
```

In the returned `dispose` function, replace
```typescript
    appDisposed = true;
    wardSession.dispose();
```
with
```typescript
    appDisposed = true;
    wardSession.dispose();
    prefetchAbort?.abort();
```

- [ ] **Step 4: Build and watch the e2e pass**

Run: `npm run build`, then `npx playwright test tests/e2e/heat-map-ward-prefetch.spec.ts --project=chromium-tier0 --reporter=line`
Expected: `2 passed`.

- [ ] **Step 5: Prove the e2e can fail**

Temporarily delete the `schedulePrefetch(name);` line. Rebuild and run the spec.
Expected: the first test FAILS. Restore the line, rebuild, re-run to confirm `2 passed`.

- [ ] **Step 6: The second-city spec still passes**

Run: `npx playwright test tests/e2e/heat-map-second-city.spec.ts --project=chromium-tier0 --reporter=line`
Expected: `4 passed`.

- [ ] **Step 7: Gates**

Run: `npm run check` → `0 errors`; `npm run test:unit` → `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts tests/e2e/heat-map-ward-prefetch.spec.ts
git commit -m "feat(heat-map): prefetch the city's other wards after the first loads

Scheduled once, on idle, after the first ward commits. Aborted when a real load
starts and on dispose. The e2e asserts requests rather than timings because the
preview server sends no cache headers: siblings are fetched, and none are under
Save-Data."
```

---

### Task 11: Final verification and a real before/after measurement

**Files:** none changed

- [ ] **Step 1: Every gate**

Run and confirm each:
- `npm run check` → `0 errors`
- `npm run typecheck` → `Success: no issues found`
- `npm run test:unit` → `fail 0`
- `npm run test:py` → passes
- `python3 scripts/check-bangalore-artefacts.py; echo $?` → `0`
- `python3 scripts/check-bangalore-frame.py; echo $?` → `0`
- `npm run build` → completes
- `npx playwright test tests/e2e/heat-map-ward-prefetch.spec.ts tests/e2e/heat-map-second-city.spec.ts --project=chromium-tier0 --reporter=line` → `6 passed`

- [ ] **Step 2: Measure a first-visit switch, with prefetch, under Slow 4G**

Start the dev server (`npm run dev`), then run:

```bash
cat > .prefetch-measure.mjs <<'EOF'
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto('http://localhost:4321/heat-map/in/bengaluru/indiranagar/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => /\d/.test(document.querySelector('#bcount')?.textContent ?? ''), { timeout: 120000 });
await page.waitForTimeout(20000);   // let the idle prefetch finish, unthrottled
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
const before = await page.$eval('#bcount', (e) => e.textContent ?? '');
const started = Date.now();
await page.click('#strip .ward[data-w="mg-road"]');   // the ward tile; heat-map-app.ts wires its click to loadWard
await page.waitForFunction((b) => { const t = document.querySelector('#bcount')?.textContent ?? ''; return t !== b && /\d/.test(t); }, before, { timeout: 180000 });
console.log(`first visit to MG Road, prefetched, Slow 4G: ${Date.now() - started} ms`);
await browser.close();
EOF
node .prefetch-measure.mjs; rm -f .prefetch-measure.mjs
```

Expected: far below the **17,747 ms** measured for the same first-visit switch before this work. Report the real number. Note that the dev server does not compress, so the absolute figure is not a production figure.

- [ ] **Step 3: Report**

Report every gate result, the measured switch time against 17,747 ms, the Task 6 size table against ~424 KB, and anything that deviated from this plan.

---

## Self-review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| Prefetch once after the first ward commits, on idle | 10 |
| Siblings = `areaKeysInCity` minus the open ward, `paths()` non-null | 9 |
| Every file a switch fetches, plus the GLB where one exists | 8, 9 |
| Plain `fetch`, low priority, body read | 9 |
| Back off for Save-Data and 2G | 9 |
| Wards one after another, a ward's files together | 9 |
| Abort when a real load begins (and on dispose) | 10 |
| e2e asserts requests, not timings | 10 |
| Row format with `cols` and `speciesNames` | 1, 3, 4, 5 |
| Buildings untouched | 6 (`kolkata-unchanged` stays green) |
| Both writers, every reader, one commit, no height-model re-read | 3, 4, 5, 6 |
| Reader refuses the old format; counts pinned | 4, 6 |
| Chip: 400 ms delay, 500 ms minimum, dead text removed, failures immediate | 7 |
| Species draw restored at source; exporter reads species | 2, 5 |
| Backfill by cell recovery with radius tie-break; equivalence proven; mix pinned | 2, 6 |
| Gates stay green | 6, 11 |

`check-bangalore-artefacts.py` checks only that each tree file exists (line 23), so the format change needs no edit there; Task 6 still runs it.

**Placeholders.** None: every code step carries its code, every run step its command and expected output.

**Type consistency.** `_trees.COLS`, `_trees.SPECIES_NAMES`, `encode_trees(trees)` and `decode_trees(cols, names, rows)` are defined in Task 1 and used with those signatures in Tasks 3, 5 and 6. `TREE_COLS` is exported in Task 4 and used in Tasks 4 and 6. `place_canopy`, `recover_species` and `backfill_species` are defined and used within Task 2 and invoked via `--layer species` in Task 6. `MODEL_WARDS` and `modelPath` are defined in Task 8 and used in Task 9. `createLoadChip`, `SHOW_AFTER_MS` and `MIN_VISIBLE_MS` come from Task 7; `prefetchPlan`, `runPrefetch` and `shouldPrefetch` from Task 9, wired in Task 10.
