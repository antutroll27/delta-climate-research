# Vegetation Placement v2 — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-tree-per-cell lattice in `scripts/fetch-canopy.py` with a deterministic redistributive jitter+density scatter (jitter 0.80 × cell, 0–4 trees/cell by canopy height), regenerating byte-stable `ballygunge-trees.json`.

**Architecture:** All logic lives in `scripts/fetch-canopy.py` (the Python "laboratory" — the TS renderer consumes `trees.json` unchanged). `derive_trees()` becomes a `_generate() → FILTERS → finalize` pipeline where `FILTERS = ()` is the Phase-B seam (exclusion mask / parks prior / ETH gate slot in later as filters; crown-detection swaps `_generate`). Placement randomness comes from a splitmix64-style integer hash keyed on `(col, row, k, axis)` — no `random`, no dates — so rebuilds are byte-identical.

**Tech Stack:** Python 3 + numpy (already in pipeline), strict mypy (`python3 -m mypy`, config in `mypy.ini`, `files = scripts`). No new dependencies. No TS changes.

**Spec:** `docs/superpowers/specs/2026-08-11-vegetation-placement-v2-design.md` (approved: model **b redistributive**, jitter **0.80**, density max **4**). Phase B is parked there — do NOT build any of it here.

**Branch / worktree:** work on `feat/heat-map-vegetation` in the main checkout (`/Volumes/VSTSAMPLES/Projects/Angad`). ⚠️ The working tree carries **unrelated uncommitted edits** to `docs/heat-map-feature.md`, `src/components/ClimateEngine/HeatMapStage.astro`, `src/scripts/climate-engine/explore/relief-renderer.ts`, `src/scripts/climate-engine/heat-map-app.ts` (another workstream). **Never `git add -A` / `git add .`** — every commit in this plan stages explicit paths only, and none of those four files.

**Facts the executor must not rediscover:**
- Grid: 140×140, cell = 10 m, ward 1400 m. Old code's `step = round(12/10) = 1`, so it was literally one tree per canopy cell at every cell — that lattice is the bug.
- Only **ballygunge** has canopy artifacts (`ballygunge-canopy.png`, `ballygunge-trees.json`). Barrackpore/Baruipur were never built; `check()` skips absent wards. Do not try to build them.
- Network fetch needs `AWS_NO_SIGN_REQUEST=YES` (anonymous S3 read of the Meta/WRI CHM COG).
- `trees.json` is minified JSON + trailing newline (`serialise()`), floats rounded (x,y→2dp, h→1dp, r→2dp).
- Python's `round()` is banker's rounding; the tuned preview used JS `Math.round` (half-up). Use `int(v + 0.5)` for the count so the shipped look matches the tuning.
- Repo self-test idiom: `_self_test()` + a CLI flag, pure logic, offline (see `scripts/_icesat2.py:611`). Artifact invariants live in `check()` (`--check`).
- Headless browsers render the map black in this sandbox — final visual sign-off is the user's, in a real browser.

---

### Task 1: Deterministic hash + new constants (self-test first)

**Files:**
- Modify: `scripts/fetch-canopy.py` (constants block at lines 53–64; add `_hash01`; add `_self_test` + `--self-test` CLI)

- [ ] **Step 1: Write the failing self-test**

In `scripts/fetch-canopy.py`, add immediately above `def main()`:

```python
def _self_test() -> None:
    """Pure-logic invariants, offline (no artifacts, no network).

    Run: python3 scripts/fetch-canopy.py --self-test
    """
    # hash01: deterministic, in [0,1), sensitive to every key component
    a = _hash01(3, 7, 0, 0)
    assert a == _hash01(3, 7, 0, 0), "hash must be deterministic"
    assert 0.0 <= a < 1.0, "hash must be in [0,1)"
    keys = {(3, 7, 0, 0), (4, 7, 0, 0), (3, 8, 0, 0), (3, 7, 1, 0), (3, 7, 0, 1)}
    vals = {_hash01(*k) for k in keys}
    assert len(vals) == len(keys), "hash must differ across col/row/k/axis"
    # spread sanity: 1000 draws roughly uniform (no catastrophic clustering)
    draws = [_hash01(i, i * 31 + 1, 0, 0) for i in range(1000)]
    mean = sum(draws) / len(draws)
    assert 0.45 < mean < 0.55, f"hash draws should average ~0.5, got {mean:.3f}"
    print("  fetch-canopy self-test OK")
```

And in `main()`, add the flag before the `--check` branch:

```python
    if args and args[0] == "--self-test":
        _self_test()
        return
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Volumes/VSTSAMPLES/Projects/Angad && python3 scripts/fetch-canopy.py --self-test`
Expected: `NameError: name '_hash01' is not defined`

- [ ] **Step 3: Implement the constants and the hash**

Replace line 57 (`TARGET_SPACING_M = 12.0 ...`) with:

```python
JITTER = 0.80                     # fraction of cell size for deterministic position jitter
DENSITY_MAX = 4                   # trees at a ward-max-height cell; scales down to 0 (gaps)
```

(Delete `TARGET_SPACING_M` entirely — it is referenced nowhere else; verified by grep.)

Add below `chm_href()` (before `read_chm_grid`):

```python
def _hash01(col: int, row: int, k: int, axis: int) -> float:
    """Deterministic [0,1) from instance identity — splitmix64-style finalizer.

    NOT `random`/`Date` (repo rule: byte-stable artifacts). Keyed on the cell
    (col,row), the instance index within the cell (k), and which quantity is
    being drawn (axis: 0=x-jitter, 1=y-jitter, 2=radius, 3=species).
    """
    z = (col * 0x9E3779B97F4A7C15 + row * 0xBF58476D1CE4E5B9
         + k * 0x94D049BB133111EB + axis * 0xD6E8FEB86659FD93) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    z ^= z >> 31
    return z / 2**64
```

Also fix the module docstring's run examples (line ~30) to mention the new flag:

```
    AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge
    python3 scripts/fetch-canopy.py --check       # local artefacts only, no network
    python3 scripts/fetch-canopy.py --self-test   # pure placement logic, offline
```

- [ ] **Step 4: Run the self-test to verify it passes**

Run: `python3 scripts/fetch-canopy.py --self-test`
Expected: `  fetch-canopy self-test OK`

- [ ] **Step 5: Strict mypy**

Run: `python3 -m mypy`
Expected: `Success: no issues found` (repo-wide; config picks up `scripts/` automatically)

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-canopy.py
git commit -m "feat(heat-map): deterministic splitmix64 hash + jitter/density constants for tree placement"
```

---

### Task 2: Redistributive jitter+density generator with the Phase-B filter seam

**Files:**
- Modify: `scripts/fetch-canopy.py` (`derive_trees` at lines ~147–165; extend `_self_test`; extend `check()`)

- [ ] **Step 1: Extend the self-test with placement invariants (failing first)**

Append inside `_self_test()`:

```python
    # placement invariants on a synthetic ward-sized grid
    ward = WARDS["ballygunge"]
    n = GRID
    cell_m = ward.footprint_m / n
    grid = np.zeros((n, n), dtype=np.float32)
    grid[0, 0] = 30.0          # ward-max cell -> DENSITY_MAX trees
    grid[0, 1] = 2.0           # barely canopy -> 0 trees (the honest gap)
    grid[10, 10] = 15.0        # mid canopy -> ~DENSITY_MAX/2
    grid[20, 20] = 1.0         # below MIN_TREE_H -> skipped entirely
    trees = derive_trees(ward, grid)
    assert trees == derive_trees(ward, grid), "derive_trees must be deterministic"
    def cell_of(t: _types.TreeInstanceJSON) -> tuple[int, int]:
        col = int((t["x"] + ward.footprint_m / 2) / cell_m)
        row = int((ward.footprint_m / 2 - t["y"]) / cell_m)
        return (min(col, n - 1), min(row, n - 1))
    by_cell: dict[tuple[int, int], int] = {}
    for t in trees:
        by_cell[cell_of(t)] = by_cell.get(cell_of(t), 0) + 1
    assert by_cell.get((0, 0)) == DENSITY_MAX, f"max-height cell must hold {DENSITY_MAX}, got {by_cell.get((0, 0))}"
    assert (1, 0) not in by_cell, "h=2.0 cell must be a gap (redistributive count 0)"
    assert (20, 20) not in by_cell, "below MIN_TREE_H must stay empty"
    assert by_cell.get((10, 10)) == 2, "15 m of 30 m at DENSITY_MAX=4 -> 2 trees"
    # jitter bounds: every instance stays within +-JITTER/2 of its cell centre
    half = ward.footprint_m / 2.0
    for t in trees:
        col, row = cell_of(t)
        cx = (col + 0.5) * cell_m - half
        cy = half - (row + 0.5) * cell_m
        assert abs(t["x"] - cx) <= JITTER * cell_m / 2 + 0.011, f"x jitter out of bounds at {t}"
        assert abs(t["y"] - cy) <= JITTER * cell_m / 2 + 0.011, f"y jitter out of bounds at {t}"
    # the lattice is dead: with >1 instance somewhere, positions inside one cell differ
    xs = sorted(t["x"] for t in trees if cell_of(t) == (0, 0))
    assert len(set(xs)) > 1, "instances within a cell must not stack on one point"
    # species valid + per-instance (a 4-tree cell should not be monoculture-by-position rule)
    assert all(t["species"] in ("neem", "gulmohar", "palm") for t in trees)
    # radius jitter stays within +-10% of h*0.35
    for t in trees:
        assert 0.9 * t["h"] * 0.35 - 0.01 <= t["r"] <= 1.1 * t["h"] * 0.35 + 0.01, f"radius out of band at {t}"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 scripts/fetch-canopy.py --self-test`
Expected: FAIL — the max-height cell holds 1 tree (old one-per-cell code), so the `== DENSITY_MAX` assert trips.

- [ ] **Step 3: Rewrite `derive_trees` as generate → FILTERS → finalize**

⚠️ **Also delete `TARGET_SPACING_M` from the constants block in this same step.** (Task 1's plan text
wrongly claimed it was unreferenced — it is read at `derive_trees`'s `step = ...` line and named in its
docstring, so Task 1 correctly left it in place. Its last reference disappears in *this* diff, so the
deletion belongs here. `python3 -m mypy` will catch it if you forget the other direction.)

Replace the whole `derive_trees` function (lines ~147–165) with:

```python
#: Phase-B seam (docs/superpowers/specs/2026-08-11-vegetation-placement-v2-design.md).
#: Exclusion mask (B1), parks prior (B2) and ETH gate (B3) slot in here as filter
#: callables, in that order; crown-detection (B4) swaps _generate(). Empty in Phase A.
FILTERS: tuple[Callable[[list[_types.TreeInstanceJSON]], list[_types.TreeInstanceJSON]], ...] = ()

SPECIES = ("neem", "neem", "gulmohar", "palm")   # deterministic broadleaf-dominant mix


def _generate(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """Redistributive jitter+density scatter (spec: model b, jitter 0.80, max 4).

    Per canopy cell: 0..DENSITY_MAX instances scaling with height relative to the
    ward's max cell (thin canopy -> honest gaps), each jittered off the cell
    centre by a deterministic hash. int(v+0.5) not round(): half-up matches the
    JS Math.round the parameters were visually tuned against.
    """
    n = grid_north_up.shape[0]
    cell_m = ward.footprint_m / n
    half = ward.footprint_m / 2.0
    h_max = float(grid_north_up.max())
    trees: list[_types.TreeInstanceJSON] = []
    if h_max < MIN_TREE_H:
        return trees
    for row in range(n):
        for col in range(n):
            h = float(grid_north_up[row, col])
            if h < MIN_TREE_H:
                continue
            count = int(DENSITY_MAX * h / h_max + 0.5)
            for k in range(count):
                jx = (_hash01(col, row, k, 0) - 0.5) * JITTER * cell_m
                jy = (_hash01(col, row, k, 1) - 0.5) * JITTER * cell_m
                # cell centre -> ward-local metres; row 0 = north so +y decreases with row
                x = round((col + 0.5) * cell_m - half + jx, 2)
                y = round(half - (row + 0.5) * cell_m + jy, 2)
                r = round(h * 0.35 * (0.9 + 0.2 * _hash01(col, row, k, 2)), 2)
                sp = SPECIES[int(_hash01(col, row, k, 3) * len(SPECIES))]
                trees.append({"x": x, "y": y, "h": round(h, 1), "species": sp, "r": r})
    return trees


def derive_trees(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """Tree instances for the render layer: candidates -> Phase-B filters (none yet)."""
    candidates = _generate(ward, grid_north_up)
    for f in FILTERS:
        candidates = f(candidates)
    return candidates
```

Add the import at the top of the file with the other imports (`from typing import Any, cast` line):

```python
from collections.abc import Callable
```

- [ ] **Step 4: Run the self-test to verify it passes**

Run: `python3 scripts/fetch-canopy.py --self-test`
Expected: `  fetch-canopy self-test OK`

- [ ] **Step 5: Extend `check()` with two artifact tripwires**

Inside `check()`'s per-ward block, after the per-tree loop, add:

```python
        # v2 tripwires: the 10 m lattice must be dead, and counts must stay sane
        cell_m = doc["sizeM"] / doc["grid"]
        off_lattice = sum(
            1 for t in doc["trees"]
            if abs((t["x"] + doc["sizeM"] / 2 - cell_m / 2) % cell_m) > 0.05
        )
        assert off_lattice > len(doc["trees"]) / 2, f"{wid}: trees still sit on the cell-centre lattice"
        assert 0 < len(doc["trees"]) <= 30_000, f"{wid}: implausible tree count {len(doc['trees'])}"
```

Note: this will FAIL against the committed (old, lattice) `ballygunge-trees.json` until Task 3 regenerates it. That is intended — do not run `--check` as a gate until Task 3, Step 2.

- [ ] **Step 6: Strict mypy**

Run: `python3 -m mypy`
Expected: `Success: no issues found`

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-canopy.py
git commit -m "feat(heat-map): redistributive jitter+density tree scatter (spec model b) + Phase-B filter seam"
```

---

### Task 3: Regenerate ballygunge artifacts, prove byte-stability

**Files:**
- Regenerate: `public/heat-map/data/ballygunge-trees.json`, `public/heat-map/data/ballygunge-canopy.png`

- [ ] **Step 1: Build twice, compare byte-for-byte**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge
cp public/heat-map/data/ballygunge-trees.json /tmp/trees-build1.json
cp public/heat-map/data/ballygunge-canopy.png /tmp/canopy-build1.png
AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge
cmp public/heat-map/data/ballygunge-trees.json /tmp/trees-build1.json && echo TREES-BYTE-STABLE
cmp public/heat-map/data/ballygunge-canopy.png /tmp/canopy-build1.png && echo PNG-BYTE-STABLE
```

Expected: both `*-BYTE-STABLE` lines print. The build also prints the new tree count — expect **roughly 5–15k** (redistributive: thin cells lose their tree, dense cells gain up to 4). If it prints >25k or <2k, STOP and investigate before committing (systematic-debugging: that's a count-formula bug, not a tuning knob).

If the S3 fetch fails (no network): STOP this task, report to the user — artifacts cannot regenerate offline, and the old lattice file must NOT be left in place with the new `check()` tripwires committed alone.

- [ ] **Step 2: Artifact invariants**

Run: `python3 scripts/fetch-canopy.py --check`
Expected: `canopy artefacts OK` (the Task-2 tripwires now pass against the regenerated file)

- [ ] **Step 3: TS-side gates**

```bash
npm run test:unit          # 315+ tests incl. heat-map-vegetation.test.mjs (asTreesFile contract)
npm run check              # astro check, expect 0 errors
npm run build              # verify-served-data gate + astro build
```

Expected: all green. The trees.json schema is unchanged, so no TS edits should be needed — if a test fails here, the schema was broken; fix the generator, not the test.

- [ ] **Step 4: Commit artifacts**

```bash
git add public/heat-map/data/ballygunge-trees.json public/heat-map/data/ballygunge-canopy.png
git commit -m "data(heat-map): regenerate ballygunge trees with v2 scatter (jitter 0.80, density 0-4, natural gaps)"
```

---

### Task 4: Truthful receipt — update the canopy lineage line

**Files:**
- Modify: `scripts/build-provenance-manifest.py:144`
- Regenerate: `public/heat-map/data/{ward}-layers.json` (all wards — the generator loops WARDS)

- [ ] **Step 1: Update the lineage sentence**

At `scripts/build-provenance-manifest.py:144`, replace:

```python
             "tree instances derived from the canopy field; heights measured, positions/species modelled"],
```

with:

```python
             "tree instances scattered from the canopy field (density-weighted by height, "
             "deterministic jitter; thin canopy left empty); heights measured, positions/species modelled"],
```

- [ ] **Step 2: Regenerate the manifests and gate**

```bash
python3 scripts/build-provenance-manifest.py
python3 scripts/build-provenance-manifest.py --check
node scripts/verify-served-data.mjs
python3 -m mypy
```

Expected: manifests print per-ward; `--check` passes; verify-served-data prints its ✓ lines (canopy receipt still has source+licence+lineage); mypy clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-provenance-manifest.py public/heat-map/data/*-layers.json
git commit -m "docs(heat-map): canopy receipt names the v2 density-weighted scatter honestly"
```

---

### Task 5: Final gate + visual handoff

- [ ] **Step 1: Full local gate**

```bash
python3 scripts/fetch-canopy.py --self-test
python3 scripts/fetch-canopy.py --check
python3 -m mypy
npm run test:unit
npm run build
```

Expected: everything green.

- [ ] **Step 1b: Close the CI gap — make the self-tests actually run**

Raised by the Task-1 code-quality review: `npm run verify` is check → typecheck → test:unit → build →
report:build → check:publication → e2e, where `typecheck` is `python3 -m mypy` **alone**. Neither
`--self-test` nor `--check` appears in `package.json` or `.github/workflows/verify.yml`, so these guards
fire only when a human remembers — a regression test no pipeline runs will not catch the regression it
was written for. (Same pre-existing gap affects `fetch-icesat2.py`'s self-test.)

Add to `package.json` scripts, after `"typecheck"`:

```json
    "test:py": "python3 scripts/fetch-canopy.py --self-test && python3 scripts/fetch-canopy.py --check",
```

and insert it into the `verify` chain immediately after `npm run typecheck`:

```json
    "verify": "npm run check && npm run typecheck && npm run test:py && npm run test:unit && npm run build && npm run report:build && npm run check:publication && npm run test:e2e:built",
```

Verify: `npm run test:py` prints both OK lines and exits 0.

Commit:
```bash
git add package.json
git commit -m "build(ci): run the canopy self-test + artefact check in verify"
```

- [ ] **Step 2: Visual smoke — hand to the user**

Headless rendering is black in this sandbox (known), so do NOT claim visual verification. Start the dev server and hand off:

```bash
npm run dev
```

Ask the user to open `/heat-map`, toggle **Trees** on Ballygunge, and confirm: no lattice, natural clumps and gaps, no perf regression. The lattice tripwire in `--check` already proves the grid is dead numerically; the user confirms it *looks* right.

- [ ] **Step 3: Push (only after the user approves the look)**

```bash
git push origin feat/heat-map-vegetation
```

The branch auto-deploys a Vercel preview. Production ships when the branch merges to main — the user's call.

---

## Explicit non-goals (enforced)

- **No Phase B**: no exclusion mask, no `fetch-landuse.py`, no ETH fetch, no crown detection. The `FILTERS` seam is the only trace.
- **No physics**: `heat-map-model.ts`, `veg[]` governance, `blendCanopyIntoVeg` untouched. Accuracy numbers must not move (nothing in this plan touches them).
- **No TS changes**: `vegetation-layer.ts`, `asTreesFile`, `ReliefWardBundle` all consume the unchanged schema.
- **No new deps**, no `requirements.txt` (that broke a Vercel build once — see memory).
- **Do not stage** the four unrelated dirty files (`docs/heat-map-feature.md`, `HeatMapStage.astro`, `relief-renderer.ts`, `heat-map-app.ts`) or the root scratch PNGs (`_align-top.png`, `_vis-flat.png`, `shot.png`) or `attic/heat-fx/`.
- **Do not build barrackpore/baruipur** — they have no canopy artifacts today; that's a separate, user-triggered step.
