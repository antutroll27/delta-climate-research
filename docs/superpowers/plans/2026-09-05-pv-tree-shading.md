# Trees into the PV shading pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the measured 1 m canopy as a shadow caster to the rooftop-PV shading screen, publishing per building a total loss, a building-only loss and a tree-only loss, with the total replacing what the yield chain reads.

**Architecture:** A new laboratory script rasterises the ward's footprints and the Meta/WRI CHM v2 onto one 1 m grid (with a 200 m canopy pad), then for every sampled sun position runs the published DSM shadow march (shift-and-max) on four surfaces — buildings only, buildings + canopy at stated height, buildings + canopy minus the model's 3 m MAE, buildings + strictly masked canopy — and accumulates GHI-weighted shaded pixel counts per building. Attribution is exact by construction (tree-only = shaded by the combined surface and not by buildings). The buildings-only raster result is cross-checked against the registered polygon run before anything is written; the yield script switches its one read site to the new artefact. The spec and pre-registration is `docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md` (with Amendment A1) — read it first; every constant below is locked there.

**Tech Stack:** Python 3.12, numpy, scipy.ndimage (label, binary_dilation), rasterio.features (rasterize), shapely (footprints), strict mypy (`python3 -m mypy`, config `mypy.ini`, stubs pinned in `scripts/requirements-dev.txt`). No test framework: the repo idiom is a `--self-check` flag on the script, wired into `npm run test:py`.

**Working tree:** `/Volumes/VSTSAMPLES/Projects/angad-built` (branch `feat/twin-preview-harness`, pushes to `origin/main`). On this exFAT volume, rebase and refresh in ONE invocation: `git update-index -q --refresh; git fetch -q origin; git rebase -q origin/main`. Never `reset --hard`.

**Runtime expectations:** a 1 m read of a ward box is ~2 s. The march is ~8,000 shift-and-max passes per surface per ward at 1 m (1800² pixels); expect 5–8 minutes per ward on a laptop, ~20 minutes for three. Network is needed only for the canopy read (`AWS_NO_SIGN_REQUEST=YES`).

---

## File structure

| file | responsibility |
|---|---|
| `scripts/measure-pv-tree-shading.py` (new) | the raster pass: surfaces, march, mask, accumulation, cross-check, sanity checks, predictions, artefact; `--self-check` synthetic scene |
| `data/calibration/pv-shading-trees-<ward>.json` (new, ×3) | the artefact: per-building total / buildings / trees / raised, cross-check, sensitivity table, predictions, gate restated |
| `scripts/build-pv-yield.py` (modify) | read `per_building_loss_total` and `per_building_area_m2` from the new artefact; write `loss_buildings`, `loss_trees`, `loss_raised` into the browser file; provenance strings |
| `public/heat-map/data/pv-<ward>.json` (regenerated, ×3) | browser copy: `loss` is now total; three arrays added; `kwh` recomputed |
| `data/calibration/pv-yield-<ward>.json` (regenerated, ×3) | laboratory yield artefact |
| `package.json` (modify) | `test:py` gains the self-check |
| `docs/evidence/known-limitations.md`, `docs/evidence/data-sources.md`, `docs/evidence/methods-and-papers.md` (modify) | §8 addendum; CHM role; references |

The registered artefact `data/calibration/pv-shading-<ward>.json` is **never rewritten**.

---

### Task 1: Script skeleton with a failing self-check

**Files:**
- Create: `scripts/measure-pv-tree-shading.py`

- [ ] **Step 1: Write the skeleton — loaders, locked constants, typed stubs, and the self-check that exercises them**

```python
#!/usr/bin/env python3
"""Rooftop-PV shading with TREES -- raster shadow-casting on a 1 m surface model.

PRE-REGISTERED: docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md (+ Amendment A1),
committed before this script produced a number. Read it before changing any constant here;
every one of them is locked there and other values appear only in the sensitivity table.

WHAT IT DECIDES. measure-pv-shading.py casts shadows from BUILDINGS only. This pass adds the
measured Meta/WRI 1 m canopy (v2) as a caster, on the same sun samples with the same GHI
weights, and publishes per building: total loss, building-only, tree-only. The building-only
figure is cross-checked against the registered polygon run BEFORE a single tree is counted;
if they disagree by more than 1 pp of mean loss the run refuses to write.

THE MARCH (Ratti & Richens 2004; Lindberg & Grimmond 2011 -- the published algorithm, written
from the description; no GPL code). A pixel x at roof height h_i is shaded when, for some
k >= 1,
    DSM(x + k*s*step) - k*step*tan(alt) > h_i + EPS_M
with s the unit vector TOWARD the sun. Implemented as K vectorised shift-and-max passes.

WHY THE TREES FILE IS NOT USED. <ward>-trees.json is a render derivative: positions jittered
inside 10 m cells by a hash, radii from a formula. The measured object is the raster.

Run:
    AWS_NO_SIGN_REQUEST=YES python3 scripts/measure-pv-tree-shading.py --ward ballygunge
    python3 scripts/measure-pv-tree-shading.py --self-check      # synthetic scene, offline
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
import time
from typing import Any

import numpy as np
import numpy.typing as npt
from rasterio import features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
import _types  # noqa: E402

F32 = npt.NDArray[np.float32]
F64 = npt.NDArray[np.float64]
I32 = npt.NDArray[np.int32]
BoolA = npt.NDArray[np.bool_]


def _load(name: str, fname: str) -> Any:
    """Load a sibling script by path -- the pattern build-pv-yield.py already uses."""
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fname))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_shading = _load("_pvshading", "measure-pv-shading.py")
_canopy = _load("_fetchcanopy", "fetch-canopy.py")
_yield = _load("_pvyield", "build-pv-yield.py")

#: LOCKED BY THE PRE-REGISTRATION (spec section 3 and Amendment A1).
GRID_M = 1.0            # a 1 m read costs ~2 s, and a 50 m2 roof is 50 pixels instead of 12
PAD_M = 200.0           # canopy read beyond the ward box: a 34 m crown at 10 deg throws 193 m
TAU = 0.30              # beam transmittance through an in-leaf crown, central
TAU_BAND = (0.20, 0.50)  # Wu, Lu & Lin 2025; Konarska et al. 2014
CHM_MAE_M = 3.0         # Brandt et al. v2 -- the "minus MAE" height scenario
CANOPY_MIN_M = 2.0      # what counts as a tree for the connectedness rule
EPS_M = 0.05            # strictly ABOVE the roof: equal heights do not shade
RAISE_M = 2.0           # elevated mounting structure scenario (A1)
CROSS_CHECK_MEAN_PP = 1.0    # raster buildings-only vs registered polygon: mean loss
CROSS_CHECK_SHARE_PP = 3.0   # ...and the share losing >= 5 %
PREREG = "docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md"


def out_path(ward: str) -> str:
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-trees-{ward}.json")


def polygon_path(ward: str) -> str:
    """The REGISTERED building-only artefact. Read for the cross-check; never written."""
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-{ward}.json")


def shadow_height(dsm: F32, alt_deg: float, az_deg: float, step_m: float) -> F32:
    """For every pixel, the tallest sightline any obstacle TOWARD the sun projects onto it.
    A receiver at height h is shaded iff shadow_height > h + EPS_M. -inf where nothing does."""
    raise NotImplementedError


def mask_canopy(chm: F32, foot: BoolA) -> tuple[F32, float, float]:
    """Amendment A1 connectedness rule. Returns (masked canopy, share of on-roof canopy kept
    as overhang, share dropped as enclosed)."""
    raise NotImplementedError


def classify(sh_b: F32, sh_t: F32, roof_h: F32, raise_m: float) -> tuple[BoolA, BoolA]:
    """(shaded by a building, shaded by canopy only) for receivers at roof_h + raise_m."""
    b = sh_b > roof_h + raise_m + EPS_M
    t = (sh_t > roof_h + raise_m + EPS_M) & ~b
    return b, t


def _self_check() -> None:
    """A synthetic scene the spec (section 7) fixes in advance. Offline; no loaders."""
    n = 120
    step = 1.0
    ids = np.zeros((n, n), dtype=np.int32)
    ids[50:70, 50:70] = 1                      # a 20 x 20 m roof at 5 m; row 0 = north
    roof = ids > 0
    dsm_b = np.where(roof, 5.0, 0.0).astype(np.float32)
    roof_h = np.full((n, n), 5.0, dtype=np.float32)

    def tree(h: float, rows: slice) -> F32:
        chm = np.zeros((n, n), dtype=np.float32)
        chm[rows, 59:62] = h                   # a 3 m wide tree, 3 rows deep
        return chm

    alt, az = 30.0, 180.0                      # sun due SOUTH: shadows run NORTH, toward row 0

    # 1. a 20 m tree 10 m SOUTH of the roof shades (20-5)/tan30 = 26 m of it: the roof begins
    #    10 m north of the tree, so ~15-16 rows x 3 columns of roof are shaded
    sh = shadow_height(np.maximum(dsm_b, tree(20.0, slice(80, 83))), alt, az, step)
    shaded = (sh > roof_h + EPS_M) & roof
    assert 39 <= int(shaded.sum()) <= 54, f"20 m tree south of roof: {int(shaded.sum())} px, expected ~45"
    assert int(shaded[:, 59:62].sum()) == int(shaded.sum()), "shadow left the tree's columns"
    # 2. the same tree NORTH of the roof throws its shadow AWAY from it: nothing
    sh = shadow_height(np.maximum(dsm_b, tree(20.0, slice(37, 40))), alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "shadow pointed toward the sun"
    # 3. a 4 m tree south of a 5 m roof shades nothing: nothing lower than the roof shades it
    sh = shadow_height(np.maximum(dsm_b, tree(4.0, slice(80, 83))), alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "a caster below the roof shaded it"
    # 4. the roof alone: exactly zero (isolation)
    sh = shadow_height(dsm_b, alt, az, step)
    assert int(((sh > roof_h + EPS_M) & roof).sum()) == 0, "an isolated roof shaded itself"
    # 5. loss rises as the sun falls: the same tree at 15 deg reaches further than at 30 deg
    lo = shadow_height(np.maximum(dsm_b, tree(20.0, slice(80, 83))), 15.0, az, step)
    assert int(((lo > roof_h + EPS_M) & roof).sum()) > int(shaded.sum()), "loss did not rise as the sun fell"
    # 6. attribution and the loss formula: a 12 m BUILDING block due south of the roof's west
    #    columns scores 1.0 on the pixels it shades ((12-5)/tan30 = 12 m -> 2 roof rows x 6
    #    columns = 12 px), the tree's pixels score 1 - TAU, a pixel under both is building-shaded
    dsm_b2 = dsm_b.copy()
    dsm_b2[80:86, 50:56] = 12.0
    sh_b = shadow_height(dsm_b2, alt, az, step)
    sh_t = shadow_height(np.maximum(dsm_b2, tree(20.0, slice(80, 83))), alt, az, step)
    b, t = classify(sh_b, sh_t, roof_h, 0.0)
    nb, nt = int((b & roof).sum()), int((t & roof).sum())
    assert 6 <= nb <= 18, f"building block shaded {nb} px, expected ~12"
    assert 39 <= nt <= 54, f"tree-only shaded {nt} px, expected ~45"
    assert not bool((b & t).any()), "a pixel was both building- and tree-shaded"
    loss = (nb + (1.0 - TAU) * nt) / float(roof.sum())
    assert abs(loss - (12 + 0.7 * 45) / 400.0) < 0.02, f"composed loss {loss:.4f}"
    # 7. raising the array 2 m clears part of the building's shadow and none of the tree's reach
    b_r, t_r = classify(sh_b, sh_t, roof_h, RAISE_M)
    assert int((b_r & roof).sum()) < nb, "raising the array did not reduce building shading"
    assert int((t_r & roof).sum()) <= nt, "raising the array increased tree shading"

    # 8. the A1 connectedness rule: a blob enclosed in the footprint is dropped, a crown that
    #    straddles the edge is kept whole, and the two published fractions are exact
    chm = np.zeros((n, n), dtype=np.float32)
    chm[55:58, 55:58] = 9.0                    # 9 px, fully inside the roof: a misread building
    chm[66:74, 60:64] = 12.0                   # 8 x 4 = 32 px straddling the south edge: rows 66-69
    #                                            are on the roof (16 px), rows 70-73 are not
    masked, kept, dropped = mask_canopy(chm, roof)
    assert float(masked[55:58, 55:58].max()) == 0.0, "enclosed blob survived"
    assert float(masked[66:74, 60:64].min()) == 12.0, "a rooted crown was cut"
    assert abs(kept - 16 / 25) < 1e-9 and abs(dropped - 9 / 25) < 1e-9, f"fractions {kept:.3f} {dropped:.3f}"
    # 9. day grouping: two synthetic days, the second starting with a morning azimuth
    groups = day_groups([(20.0, 100.0, 1.0), (50.0, 170.0, 1.0), (20.0, 250.0, 1.0),
                         (25.0, 95.0, 1.0), (55.0, 180.0, 1.0)])
    assert groups == [[0, 1, 2], [3, 4]], f"day groups {groups}"
    print("  self-check: ok")


def day_groups(suns: list[tuple[float, float, float]]) -> list[list[int]]:
    """Indices grouped per sample day. sun_positions emits month by month, hour by hour, so a
    day ends when the azimuth swings back to morning (drops by more than 90 deg). Kolkata's
    summer sun passes north of zenith and its azimuth wraps UPWARD through 360 at noon, which
    this rule does not mistake for a new day."""
    raise NotImplementedError


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    raise SystemExit("ward run not implemented yet")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the self-check to verify it fails**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 scripts/measure-pv-tree-shading.py --self-check`
Expected: `NotImplementedError` raised from `shadow_height`.

- [ ] **Step 3: Type-check the skeleton**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 -m mypy scripts/measure-pv-tree-shading.py`
Expected: `Success: no issues found in 1 source file`. (`_shading`, `_canopy`, `_yield` are `Any` on purpose — the same dynamic loading the yield script uses.)

- [ ] **Step 4: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add scripts/measure-pv-tree-shading.py
git commit -m "lab(pv): tree-shading pass — skeleton, locked constants and a failing self-check

The synthetic scene from the spec (section 7), asserted before the march exists.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The shadow march

**Files:**
- Modify: `scripts/measure-pv-tree-shading.py` — replace the `shadow_height` stub

- [ ] **Step 1: Implement `shadow_height`**

Replace the stub body with:

```python
def shadow_height(dsm: F32, alt_deg: float, az_deg: float, step_m: float) -> F32:
    """For every pixel, the tallest sightline any obstacle TOWARD the sun projects onto it.
    A receiver at height h is shaded iff shadow_height > h + EPS_M. -inf where nothing does.

    K shift-and-max passes: pass k reads the surface k pixels toward the sun and lowers it by
    k*step*tan(alt), the height a sightline at that slope has dropped by the time it arrives.
    Sub-pixel direction is handled by rounding k*s to integer offsets, as the papers do."""
    t = math.tan(math.radians(alt_deg))
    if t <= 0.0:
        return np.full(dsm.shape, -np.inf, dtype=np.float32)
    # Unit vector TOWARD the sun in (east, north): azimuth is clockwise from north.
    sx, sy = math.sin(math.radians(az_deg)), math.cos(math.radians(az_deg))
    n = dsm.shape[0]
    k_max = int(math.ceil(float(dsm.max()) / (step_m * t)))
    sh = np.full(dsm.shape, -np.inf, dtype=np.float32)
    for k in range(1, k_max + 1):
        dc = int(round(k * sx))            # east is +column
        dr = -int(round(k * sy))           # north is -row (row 0 = north)
        if abs(dc) >= n or abs(dr) >= n:
            break
        drop = np.float32(k * step_m * t)
        # value at (r, c) reads dsm[r + dr, c + dc]: the two slices below are that, clipped
        src = dsm[max(0, dr):n + min(0, dr), max(0, dc):n + min(0, dc)] - drop
        dst = sh[max(0, -dr):n + min(0, -dr), max(0, -dc):n + min(0, -dc)]
        np.maximum(dst, src, out=dst)
    return sh
```

- [ ] **Step 2: Run the self-check**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 scripts/measure-pv-tree-shading.py --self-check`
Expected: checks 1–7 pass; fails at check 8 with `NotImplementedError` from `mask_canopy`. If check 1 fails with a pixel count outside 39–54, the direction convention is wrong: confirm `dr = -int(round(k * sy))` (north is up the array) before touching anything else.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add scripts/measure-pv-tree-shading.py
git commit -m "lab(pv): the shadow march — K shift-and-max passes toward the sun

Ratti & Richens 2004 / Lindberg & Grimmond 2011, written from the description.
Direction, reach, isolation, the below-roof caster and the attribution formula all
pass the synthetic scene.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The canopy mask and the day grouping

**Files:**
- Modify: `scripts/measure-pv-tree-shading.py` — replace the `mask_canopy` and `day_groups` stubs

- [ ] **Step 1: Implement `mask_canopy` (Amendment A1) and `day_groups`**

```python
def mask_canopy(chm: F32, foot: BoolA) -> tuple[F32, float, float]:
    """Amendment A1 connectedness rule. Returns (masked canopy, share of on-roof canopy kept
    as overhang, share dropped as enclosed).

    Label the connected components of canopy > CANOPY_MIN_M. A component with ANY pixel
    outside every footprint (dilated by one pixel) is a tree rooted outside: kept whole,
    overhang included. A component enclosed entirely within footprints has no tree to belong
    to: a building the model misread as canopy, zeroed. Canopy at or below a roof's own height
    is harmless either way (DSM = max(building, canopy)), so the rule only bites where canopy
    over a roof stands above that roof."""
    tree = chm > CANOPY_MIN_M
    foot_d = ndimage.binary_dilation(foot, iterations=1)
    lab, nlab = ndimage.label(tree, structure=np.ones((3, 3), dtype=bool))
    rooted = np.zeros(int(nlab) + 1, dtype=bool)
    rooted[np.unique(lab[tree & ~foot_d])] = True
    rooted[0] = False
    enclosed = tree & ~rooted[lab]
    on_roof = tree & foot
    out = chm.copy()
    out[enclosed] = 0.0
    denom = max(1, int(on_roof.sum()))
    kept = float((on_roof & rooted[lab]).sum()) / denom
    dropped = float((on_roof & enclosed).sum()) / denom
    return out, kept, dropped


def day_groups(suns: list[tuple[float, float, float]]) -> list[list[int]]:
    """Indices grouped per sample day. sun_positions emits month by month, hour by hour, so a
    day ends when the azimuth swings back to morning (drops by more than 90 deg). Kolkata's
    summer sun passes north of zenith and its azimuth wraps UPWARD through 360 at noon, which
    this rule does not mistake for a new day."""
    groups: list[list[int]] = [[]]
    for i, (_alt, az, _w) in enumerate(suns):
        if groups[-1] and az < suns[groups[-1][-1]][1] - 90.0:
            groups.append([])
        groups[-1].append(i)
    return groups
```

- [ ] **Step 2: Run the self-check and mypy**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 scripts/measure-pv-tree-shading.py --self-check && python3 -m mypy scripts/measure-pv-tree-shading.py`
Expected: `  self-check: ok` then `Success: no issues found in 1 source file`.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add scripts/measure-pv-tree-shading.py
git commit -m "lab(pv): A1 canopy mask by connectedness, and per-day sun grouping

Enclosed blobs dropped, rooted crowns kept whole; both fractions returned for the
artefact. The synthetic scene now passes end to end.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The ward run — surfaces, accumulation, cross-check, sanity checks, predictions, artefact

**Files:**
- Modify: `scripts/measure-pv-tree-shading.py` — add `rasterise`, `run_ward`, and replace the `main` stub

- [ ] **Step 1: Add `rasterise` and `run_ward` above `main`, and replace `main`**

```python
def rasterise(polys: list[Polygon], heights: F64, n: int, frame_m: float,
              step_m: float) -> tuple[I32, F32]:
    """Pixel ownership (1-based building id, 0 = ground) and the building surface.

    Drawn ASCENDING by height so the tallest record owns a shared pixel: the raster form of
    the polygon pass's duplicate-footprint guard. A shorter twin under a full duplicate keeps no
    pixels and is reported by count; a partial overlap (an annexe) keeps its uncovered part."""
    tr = from_origin(-frame_m / 2.0, frame_m / 2.0, step_m, step_m)
    order = np.argsort(heights, kind="stable")
    shapes = ((polys[int(i)], int(i) + 1) for i in order)
    raw = features.rasterize(shapes, out_shape=(n, n), transform=tr, fill=0, dtype="int32")
    ids: I32 = np.asarray(raw, dtype=np.int32)
    dsm = np.zeros((n, n), dtype=np.float32)
    own = ids > 0
    dsm[own] = heights[ids[own] - 1].astype(np.float32)
    return ids, dsm


def run_ward(ward_id: str) -> None:
    t0 = time.time()
    ward = _types.WARDS[ward_id]
    polys, heights = _shading.load_ward(ward_id)
    heights = np.asarray(heights, dtype=np.float64)
    nb = len(polys)
    areas = np.asarray([p.area for p in polys], dtype=np.float64)
    with open(polygon_path(ward_id)) as fh:
        poly_art = json.load(fh)
    poly_loss = np.asarray(poly_art["per_building_loss"], dtype=np.float64)
    if len(poly_loss) != nb:
        raise SystemExit(f"{ward_id}: registered artefact has {len(poly_loss)} buildings, ward file {nb}")

    frame_m = float(ward.footprint_m) + 2.0 * PAD_M
    n = int(round(frame_m / GRID_M))
    chm = _canopy.read_chm_grid(ward._replace(footprint_m=int(frame_m)), n)
    if chm is None:
        raise SystemExit(f"{ward_id}: CHM read failed (is AWS_NO_SIGN_REQUEST=YES set?)")
    chm = np.asarray(chm, dtype=np.float32)
    ids, dsm_b = rasterise(polys, heights, n, frame_m, GRID_M)
    foot = ids > 0
    chm_a1, kept_frac, dropped_frac = mask_canopy(chm, foot)
    chm_strict = chm.copy()
    chm_strict[ndimage.binary_dilation(foot, iterations=1)] = 0.0
    dsm_t = np.maximum(dsm_b, chm_a1)                                     # central
    dsm_m = np.maximum(dsm_b, np.clip(chm_a1 - CHM_MAE_M, 0.0, None))     # canopy minus MAE
    dsm_s = np.maximum(dsm_b, chm_strict)                                 # strict mask

    roof_idx = np.flatnonzero(ids)
    roof_bid = ids.ravel()[roof_idx] - 1
    roof_h = heights[roof_bid].astype(np.float32)
    npix = np.bincount(roof_bid, minlength=nb).astype(np.float64)
    no_pixels = np.flatnonzero(npix == 0)
    print(f"  {ward_id}: {nb} buildings · grid {n}x{n} at {GRID_M} m (pad {PAD_M:.0f} m) "
          f"· {len(roof_idx):,} roof pixels · {len(no_pixels)} buildings without pixels", flush=True)
    print(f"  canopy on roofs: {kept_frac*100:.1f}% kept as overhang, {dropped_frac*100:.1f}% dropped as enclosed",
          flush=True)

    suns = _shading.sun_positions(ward.centre.lat)
    total_w = float(sum(s[2] for s in suns))
    keys = ("b", "b_r", "t", "t_r", "m", "s")
    acc: dict[str, F64] = {k: np.zeros(nb, dtype=np.float64) for k in keys}
    frac_by_sun: list[float] = []          # shaded roof fraction, central surface, per sun
    for si, (alt, az, ghi) in enumerate(suns, 1):
        sh_b = shadow_height(dsm_b, alt, az, GRID_M).ravel()[roof_idx]
        sh_t = shadow_height(dsm_t, alt, az, GRID_M).ravel()[roof_idx]
        sh_m = shadow_height(dsm_m, alt, az, GRID_M).ravel()[roof_idx]
        sh_s = shadow_height(dsm_s, alt, az, GRID_M).ravel()[roof_idx]
        b, t = classify(sh_b, sh_t, roof_h, 0.0)
        b_r, t_r = classify(sh_b, sh_t, roof_h, RAISE_M)
        _, m = classify(sh_b, sh_m, roof_h, 0.0)
        _, s = classify(sh_b, sh_s, roof_h, 0.0)
        for key, mask in (("b", b), ("b_r", b_r), ("t", t), ("t_r", t_r), ("m", m), ("s", s)):
            acc[key] += ghi * np.bincount(roof_bid[mask], minlength=nb)
        frac_by_sun.append(float((b | t).mean()))
        print(f"    [{si}/{len(suns)}] alt {alt:4.1f} deg · shaded {frac_by_sun[-1]*100:5.1f}%", flush=True)

    denom = np.where(npix > 0, npix * total_w, 1.0)

    def loss(key: str) -> F64:
        return np.asarray(acc[key] / denom, dtype=np.float64)

    l_b, l_b_r = loss("b"), loss("b_r")
    l_t, l_t_r, l_m, l_s = loss("t"), loss("t_r"), loss("m"), loss("s")
    # Buildings without pixels (full-duplicate twins): the registered building-only figure,
    # no tree term, flagged. Arrays stay full length so the index join holds.
    l_b[no_pixels] = poly_loss[no_pixels]

    def total(lb: F64, lt: F64, tau: float) -> F64:
        return np.asarray(lb + (1.0 - tau) * lt, dtype=np.float64)

    central = total(l_b, l_t, TAU)
    raised = total(l_b_r, l_t_r, TAU)
    trees = central - l_b

    # SANITY 1 -- cross-check the raster buildings-only run against the registered polygon run,
    # on the buildings that have pixels. Fails closed: nothing is written.
    has = npix > 0
    mean_r, mean_p = float(l_b[has].mean()), float(poly_loss[has].mean())
    share_r, share_p = float((l_b[has] >= 0.05).mean()), float((poly_loss[has] >= 0.05).mean())
    cross_ok = (abs(mean_r - mean_p) * 100 <= CROSS_CHECK_MEAN_PP
                and abs(share_r - share_p) * 100 <= CROSS_CHECK_SHARE_PP)
    print(f"\n  cross-check buildings-only: raster {mean_r*100:.2f}% vs polygon {mean_p*100:.2f}% mean; "
          f"share>=5% {share_r*100:.1f}% vs {share_p*100:.1f}% -> {'PASS' if cross_ok else 'FAIL'}")
    # SANITY 3 -- loss rises as the sun falls, within each sample day
    mono_ok = True
    for grp in day_groups(suns):
        if len(grp) < 3:
            continue
        alts = np.asarray([suns[i][0] for i in grp]); fr = np.asarray([frac_by_sun[i] for i in grp])
        if not (fr[int(alts.argmin())] > fr[int(alts.argmax())] and float(np.corrcoef(alts, fr)[0, 1]) < 0.0):
            mono_ok = False
    print(f"  loss rises as the sun falls (every sample day): {'PASS' if mono_ok else 'FAIL'}")
    # SANITY 2 and 4 are guaranteed by construction and asserted on the synthetic scene
    # (--self-check): isolation, and nothing at or below the roof shades it.

    # PREDICTIONS (spec section 5), evaluated and written, never adjusted.
    kwp = areas * float(_yield.PACKING_FACTOR) / float(_yield.M2_PER_KWP)
    big = kwp >= 3.0
    p1 = float(trees[big].mean()) > float(l_b[big].mean())
    p2 = bool(np.all(central >= l_b - 1e-9)) and float(central.mean()) > float(l_b.mean())
    print(f"  P1 trees > buildings on >=3 kWp roofs: trees {trees[big].mean()*100:.2f}% vs "
          f"buildings {l_b[big].mean()*100:.2f}% -> {p1}")
    print(f"  P2 total never falls below buildings-only: {p2}")

    def stats(x: F64) -> dict[str, float]:
        return {"mean_pct": round(float(x.mean()) * 100, 3),
                "share_5pct": round(float((x >= 0.05).mean()), 4)}

    sens: list[dict[str, Any]] = []
    for tau in (TAU_BAND[0], TAU, TAU_BAND[1]):
        for name, lt in (("stated", l_t), ("minus_mae", l_m)):
            x = total(l_b, lt, tau)
            sens.append({"tau": tau, "canopy_height": name, "mask": "a1",
                         "receiver": "roof", "mean_total_pct": stats(x)["mean_pct"],
                         "share_5pct_total": stats(x)["share_5pct"],
                         "mean_trees_pct": round(float((x - l_b).mean()) * 100, 3)})
    x = total(l_b, l_s, TAU)
    sens.append({"tau": TAU, "canopy_height": "stated", "mask": "strict", "receiver": "roof",
                 "mean_total_pct": stats(x)["mean_pct"], "share_5pct_total": stats(x)["share_5pct"],
                 "mean_trees_pct": round(float((x - l_b).mean()) * 100, 3)})
    sens.append({"tau": TAU, "canopy_height": "stated", "mask": "a1", "receiver": "raised_2m",
                 "mean_total_pct": stats(raised)["mean_pct"], "share_5pct_total": stats(raised)["share_5pct"],
                 "mean_trees_pct": round(float((raised - l_b_r).mean()) * 100, 3)})

    print(f"\n  CENTRAL: total {central.mean()*100:.2f}% (buildings {l_b.mean()*100:.2f}%, trees "
          f"{trees.mean()*100:.2f}%) · share>=5% {(central>=0.05).mean()*100:.1f}%")
    print(f"  >=3 kWp: total {central[big].mean()*100:.2f}% · share>=5% {(central[big]>=0.05).mean()*100:.1f}%")
    print(f"  raised 2 m: total {raised.mean()*100:.2f}%")
    if not (cross_ok and mono_ok):
        raise SystemExit("  a sanity check FAILED -- the result is void by pre-registration; nothing written")

    r4 = [round(float(v), 4) for v in central]
    out = out_path(ward_id)
    with open(out, "w") as fh:
        json.dump({
            "prereg": PREREG,
            "ward": ward_id, "buildings": nb, "grid_m": GRID_M, "pad_m": PAD_M, "frame_px": n,
            "sun_hours_sampled": len(suns), "runtime_s": round(time.time() - t0, 1),
            "canopy": {"source": _canopy.CHM_PREFIX, "version": "v2", "mae_m": CHM_MAE_M,
                       "canopy_min_m": CANOPY_MIN_M,
                       "overhang_kept_frac": round(kept_frac, 4),
                       "enclosed_dropped_frac": round(dropped_frac, 4),
                       "transmittance": TAU, "transmittance_band": list(TAU_BAND)},
            "buildings_without_pixels": int(len(no_pixels)),
            "buildings_without_pixels_idx": [int(i) for i in no_pixels],
            "per_building_loss_total": r4,
            "per_building_loss_buildings": [round(float(v), 4) for v in l_b],
            "per_building_loss_trees": [round(float(v), 4) for v in trees],
            "per_building_loss_total_raised": [round(float(v), 4) for v in raised],
            "per_building_area_m2": [round(float(a), 1) for a in areas],
            "per_building_height_m": [round(float(h), 1) for h in heights],
            "cross_check": {"polygon_mean_pct": round(mean_p * 100, 3), "raster_mean_pct": round(mean_r * 100, 3),
                            "abs_diff_pp": round(abs(mean_r - mean_p) * 100, 3),
                            "polygon_share_5pct": round(share_p, 4), "raster_share_5pct": round(share_r, 4),
                            "abs_diff_share_pp": round(abs(share_r - share_p) * 100, 3), "pass": cross_ok},
            "sanity": {"cross_check": cross_ok, "loss_rises_as_sun_falls": mono_ok,
                       "isolation_and_below_roof": "asserted on the synthetic scene (--self-check)"},
            "sensitivity": sens,
            "predictions": {
                "P1_trees_exceed_buildings_ge_3kwp": {"trees_mean_pct": round(float(trees[big].mean()) * 100, 3),
                                                      "buildings_mean_pct": round(float(l_b[big].mean()) * 100, 3),
                                                      "holds": p1},
                "P2_total_never_falls": {"holds": p2}},
            "gate_restated": {"all_roofs": stats(central), "ge_3kwp": stats(central[big]),
                              "registered_verdict_2026_08_21": poly_art["verdict"],
                              "note": "reported ALONGSIDE the registered building-only verdict, never as a re-registration"},
            "notes": {
                "height_bias": poly_art["height_bias_note"],
                "canopy": "A1 connectedness rule: rooted crowns kept whole, enclosed misreads dropped; a misread "
                          "touching a real crown survives, so the strict-mask sensitivity row bounds it. "
                          "Canopy heights carry the model's 3.0 m MAE; only the minus-MAE scenario is run, "
                          "so the shipped figure is not the upper bound.",
                "edge": "buildings have no pad (no geometry outside the ward), canopy has 200 m; "
                        "shading is understated at the ward edge.",
            },
        }, fh, indent=2)
    print(f"\n  written to {os.path.relpath(out, ROOT)}  ({time.time() - t0:.0f} s)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", default="ballygunge")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        _self_check()
        return
    run_ward(args.ward)
```

- [ ] **Step 2: Confirm the constants the script imports exist under those names**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && grep -n "^PACKING_FACTOR\|^M2_PER_KWP" scripts/build-pv-yield.py && grep -n "^CHM_PREFIX" scripts/fetch-canopy.py`
Expected: one line each. If `CHM_PREFIX` is named differently, use the name shown for the `"source"` field.

- [ ] **Step 3: Type-check and self-check**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 -m mypy scripts/measure-pv-tree-shading.py && python3 scripts/measure-pv-tree-shading.py --self-check`
Expected: `Success` and `  self-check: ok`.

- [ ] **Step 4: Run Ballygunge**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && AWS_NO_SIGN_REQUEST=YES python3 scripts/measure-pv-tree-shading.py --ward ballygunge 2>&1 | tail -20`
Expected: per-sun progress lines, then `cross-check ... PASS`, `loss rises ... PASS`, the two predictions with their values, the CENTRAL lines, and `written to data/calibration/pv-shading-trees-ballygunge.json`. Budget 5–8 minutes.

If the cross-check FAILS: do not loosen `CROSS_CHECK_MEAN_PP`. The likely causes, in order: the direction convention (re-run `--self-check`), the frame origin (`from_origin(-frame_m/2, frame_m/2, ...)` with polygons in ward metres), or the receiver height (must be the building's own `roof_h`, not the DSM). Report the disagreement as the result if none of those is it.

- [ ] **Step 5: Commit the script and the artefact**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add scripts/measure-pv-tree-shading.py data/calibration/pv-shading-trees-ballygunge.json
git commit -m "lab(pv): trees into the shading pass — Ballygunge, cross-checked against the registered run

Raster surfaces at 1 m with a 200 m canopy pad; buildings-only agrees with the
polygon run within the pre-registered tolerance before any tree is counted.
Predictions evaluated as written in the spec, never adjusted.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The other two wards

**Files:**
- Create: `data/calibration/pv-shading-trees-barrackpore.json`, `data/calibration/pv-shading-trees-baruipur.json`

- [ ] **Step 1: Run both wards**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && for w in barrackpore baruipur; do AWS_NO_SIGN_REQUEST=YES python3 scripts/measure-pv-tree-shading.py --ward $w 2>&1 | grep -E "cross-check|rises|P1|P2|CENTRAL|>=3 kWp|raised|written|FAIL"; done`
Expected: for each ward, `PASS`, `PASS`, the predictions, the central numbers and `written to ...`.

- [ ] **Step 2: Tabulate the three wards for the commit message and the docs**

Run:
```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 - <<'PY'
import json
for w in ("ballygunge","barrackpore","baruipur"):
    d=json.load(open(f"data/calibration/pv-shading-trees-{w}.json"))
    c=d["cross_check"]; p=d["predictions"]; g=d["gate_restated"]; k=d["canopy"]
    print(f"{w:12s} cross {c['abs_diff_pp']:.2f}pp  all {g['all_roofs']['mean_pct']:.2f}%/{g['all_roofs']['share_5pct']*100:.1f}%  "
          f">=3kWp {g['ge_3kwp']['mean_pct']:.2f}%/{g['ge_3kwp']['share_5pct']*100:.1f}%  "
          f"P1 {p['P1_trees_exceed_buildings_ge_3kwp']['holds']} (t {p['P1_trees_exceed_buildings_ge_3kwp']['trees_mean_pct']:.2f} vs b {p['P1_trees_exceed_buildings_ge_3kwp']['buildings_mean_pct']:.2f})  "
          f"P2 {p['P2_total_never_falls']['holds']}  overhang kept {k['overhang_kept_frac']*100:.0f}% dropped {k['enclosed_dropped_frac']*100:.0f}%")
PY
```
Expected: three lines. Keep this output; Task 8 quotes it.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add data/calibration/pv-shading-trees-barrackpore.json data/calibration/pv-shading-trees-baruipur.json
git commit -m "lab(pv): tree shading for Barrackpore and Baruipur

<paste the three tabulated lines here>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Switch the yield chain to the new artefact and widen the browser file

**Files:**
- Modify: `scripts/build-pv-yield.py` — `shading_path()` (~line 57), the guards and reads in `main()` (~lines 199–222), the `measured`/`assumed` provenance (~lines 237–244), the `installable_ge_3kwp` block (~line 262), the browser write (~lines 285–297)

- [ ] **Step 1: Point the read site at the new artefact**

Replace:
```python
def shading_path(ward: str) -> str:
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-{ward}.json")
```
with:
```python
def shading_path(ward: str) -> str:
    """The TREE-INCLUSIVE artefact (2026-09-05). The registered building-only artefact
    pv-shading-<ward>.json is kept as the record of that test and is no longer read here."""
    return os.path.join(ROOT, "data", "calibration", f"pv-shading-trees-{ward}.json")
```

Replace the two guards and the loss read:
```python
    if "per_building_loss" not in sh:
        sys.exit("  shading artefact has no per-building array — rerun measure-pv-shading.py")
```
with:
```python
    for key in ("per_building_loss_total", "per_building_loss_buildings",
                "per_building_loss_trees", "per_building_loss_total_raised", "per_building_area_m2"):
        if key not in sh:
            sys.exit(f"  shading artefact has no {key} — rerun measure-pv-tree-shading.py")
    if not (sh["cross_check"]["pass"] and sh["sanity"]["loss_rises_as_sun_falls"]):
        sys.exit("  shading artefact failed its own sanity checks — refusing to build yield on it")
```
and:
```python
    loss = np.asarray(sh["per_building_loss"], dtype=float)
```
with:
```python
    loss = np.asarray(sh["per_building_loss_total"], dtype=float)
    loss_b = np.asarray(sh["per_building_loss_buildings"], dtype=float)
    loss_t = np.asarray(sh["per_building_loss_trees"], dtype=float)
    loss_raised = np.asarray(sh["per_building_loss_total_raised"], dtype=float)
```
Also change the error text `"rerun measure-pv-shading.py"` in the ward-mismatch guard to `"rerun measure-pv-tree-shading.py"`.

- [ ] **Step 2: Provenance in the laboratory artefact**

Replace:
```python
            "measured": {"shading": sh["prereg"], "ghi": "NASA POWER, 5 y hourly, LST"},
```
with:
```python
            "measured": {"shading": sh["prereg"],
                         "shading_buildings_registered": "docs/superpowers/specs/2026-08-21-pv-shading-signtest-PREREG.md",
                         "canopy": "Meta/WRI CHM v2, 1 m, MAE 3.0 m, CC BY 4.0 — A1 connectedness mask",
                         "ghi": "NASA POWER, 5 y hourly, LST"},
```
and inside `"assumed": {...}` add, after `"m2_per_kwp_source": "MNRE / PM Surya Ghar"`:
```python
                        "canopy_transmittance": sh["canopy"]["transmittance"],
                        "canopy_transmittance_band": sh["canopy"]["transmittance_band"],
```
Inside `"installable_ge_3kwp": {...}` add after `"share_losing_5pct"`:
```python
                "mean_shading_loss_trees": round(float(loss_t[kwp >= 3.0].mean()), 4),
                "mean_shading_loss_buildings": round(float(loss_b[kwp >= 3.0].mean()), 4),
```

- [ ] **Step 3: The browser file**

Replace the browser `json.dump({...})` with:
```python
        json.dump({
            "ward": args.ward,
            "kwp": [round(float(v), 2) for v in kwp],
            "kwh": [int(round(float(v))) for v in kwh],
            "loss": [round(float(v), 3) for v in loss],
            "loss_buildings": [round(float(v), 3) for v in loss_b],
            "loss_trees": [round(float(v), 3) for v in loss_t],
            "loss_raised": [round(float(v), 3) for v in loss_raised],
            "specific_yield": round(y, 1),
            "packing_factor": PACKING_FACTOR,
            "basis": "screening estimate - NASA POWER irradiance, Mumbai packing factor, canopy "
                     "shading from Meta/WRI CHM v2 (A1 mask, crowns 70% opaque, heights +/-3 m), "
                     "no site uncertainty model, not bankable",
        }, fh, separators=(",", ":"))
```

- [ ] **Step 4: Type-check, then rebuild yield for all three wards**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 -m mypy && for w in ballygunge barrackpore baruipur; do python3 scripts/build-pv-yield.py --ward $w | grep -E "specific yield|installable|annual|lost to|browser copy"; done`
Expected: `Success: no issues found in N source files` (whole `scripts/` tree), then per ward the specific yield (unchanged, ~1314 kWh/kWp), capacity (unchanged), generation (LOWER than before), the shading loss line (higher), and the browser copy size.

- [ ] **Step 5: Confirm the browser file shape and the index join**

Run:
```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built && python3 - <<'PY'
import json
for w in ("ballygunge","barrackpore","baruipur"):
    p=json.load(open(f"public/heat-map/data/pv-{w}.json")); g=json.load(open(f"public/heat-map/data/{w}.json"))
    n=len(g["b"]); assert all(len(p[k])==n for k in ("kwp","kwh","loss","loss_buildings","loss_trees","loss_raised")), w
    assert all(abs(p["loss"][i]-(p["loss_buildings"][i]+p["loss_trees"][i]))<=0.0015 for i in range(n)), w
    print(f"  {w}: {n} rows · loss mean {sum(p['loss'])/n*100:.2f}% · trees {sum(p['loss_trees'])/n*100:.2f}% · raised {sum(p['loss_raised'])/n*100:.2f}%")
PY
```
Expected: three lines, no assertion error.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add scripts/build-pv-yield.py data/calibration/pv-yield-*.json public/heat-map/data/pv-*.json
git commit -m "lab(pv): yield chain reads the tree-inclusive loss; browser file carries the split

loss is now buildings + trees; loss_buildings, loss_trees and loss_raised ride
beside it for the card. Refuses to build on an artefact that failed its own
sanity checks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Wire the self-check into the Python test chain

**Files:**
- Modify: `package.json:15` (`test:py`)

- [ ] **Step 1: Append the self-check to `test:py`**

In `package.json`, the `test:py` value ends with `&& python3 scripts/check-water-oracle.py"`. Append ` && python3 scripts/measure-pv-tree-shading.py --self-check` before the closing quote, so it ends:
```
&& python3 scripts/check-water-oracle.py && python3 scripts/measure-pv-tree-shading.py --self-check"
```

- [ ] **Step 2: Run the chain**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s test:py 2>&1 | tail -3`
Expected: the existing checks' final lines, then `  self-check: ok`. It runs offline: the self-check calls no loader and reads no cache.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add package.json
git commit -m "test(py): the tree-shading synthetic scene runs in test:py

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Documentation — limitations, sources, methods

**Files:**
- Modify: `docs/evidence/known-limitations.md` (append to §8, after the "What would close it." paragraph that ends `over a 25–50 m shadow run).`, before `## 9`)
- Modify: `docs/evidence/data-sources.md:25-26` (the CHM `role:` sentence)
- Modify: `docs/evidence/methods-and-papers.md` (after the PV blockquote's `**Receipts:**` paragraph, before the `---` that precedes `## 3D Gaussian splatting`)

- [ ] **Step 1: known-limitations §8 addendum**

Insert after the paragraph ending `over a 25–50 m shadow run).`:

```markdown

> **ADDENDUM 2026-09-05 — trees are now in the shading pass, and the shipped loss is buildings + trees.**
> Pre-registered (`docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md`, Amendment A1) and run as
> written: raster shadow-casting on a 1 m surface of footprints plus the Meta/WRI CHM v2, cross-checked
> against the registered polygon run on buildings alone (within ≤ 1 pp in every ward) before a tree was
> counted. Results, central cell (τ 0.30, stated canopy heights, A1 mask, receiver at the roof plane):
>
> <paste the three tabulated lines from Task 5 Step 2 as a table: ward · cross-check · all-roofs mean/share · ≥3 kWp mean/share · P1 · P2 · overhang kept/dropped>
>
> **What changed in the honest sentence.** "Shading is robust" still holds for the building term. The tree
> term is larger and less certain: canopy heights carry a 3.0 m MAE and only the minus-MAE scenario is run,
> so the shipped figure is **not** the upper bound; crowns are treated as 70 % opaque (band 50–80 %); a
> misread building that touches a real crown survives the A1 rule (the strict-mask sensitivity row bounds
> it). No species, no seasonal leaf drop. The per-building `loss_raised` array reports what a 2 m elevated
> mounting structure recovers — a what-if for the card, not a claim.
> **Artefacts:** `data/calibration/pv-shading-trees-<ward>.json` (sensitivity table, predictions, cross-check);
> the registered `pv-shading-<ward>.json` is untouched.
```

- [ ] **Step 2: data-sources CHM role**

Replace, in the CHM entry:
```
**RENDER-ONLY.** Drives tree placement/height for the render layer and **does not enter the temperature
```
with:
```
**render + PV screening (2026-09-05), never the temperature solve.** Drives tree placement/height for the render layer, and since 2026-09-05 casts shadows in the rooftop-PV shading pass (`scripts/measure-pv-tree-shading.py`, v2 at 1 m, A1 connectedness mask — spec `2026-09-05-pv-tree-shading-design.md`). It still **does not enter the temperature
```
(Keep the rest of the sentence as it stands.)

- [ ] **Step 3: methods-and-papers references**

Insert after the line ending `commits \`95f3f38\`, \`4e27f4a\`, \`4c8cf0d\`.` and its closing `>`:

```markdown
> **Trees into the shading pass — pre-registered and run as written (2026-09-05).** Raster shadow-casting
> on a 1 m surface model, the published DSM march (shift-and-max toward the sun): Ratti & Richens 2004,
> *Environment and Planning B* 31(2); Lindberg & Grimmond 2011, *Theor. Appl. Climatol.* 105 — algorithm
> reference only, SOLWEIG's code is GPL and is not used. Canopy beam transmittance τ = 0.30 (band 0.20–0.50):
> Konarska et al. 2014, *Theor. Appl. Climatol.* 117 (single urban trees, in leaf); Wu, Lu & Lin 2025,
> *Sustainable Cities and Society* (SRT 0.18–0.60, mean ≈ 0.3, R² 0.95 against LAI). Canopy source Meta/WRI
> CHM v2 (Brandt et al. 2026, *Scientific Data*, arXiv:2603.06382; MAE 3.0 m; CC BY 4.0). Spec and
> amendment A1 (overhang kept by connectedness; a 2 m elevated-array scenario):
> `docs/superpowers/specs/2026-09-05-pv-tree-shading-design.md`.
> **Receipts:** `scripts/measure-pv-tree-shading.py [--self-check]`, `data/calibration/pv-shading-trees-<ward>.json`.
```

- [ ] **Step 4: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add docs/evidence/known-limitations.md docs/evidence/data-sources.md docs/evidence/methods-and-papers.md
git commit -m "docs(evidence): trees in the PV shading pass — limitations addendum, CHM role, references

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Full verification, push, CI

- [ ] **Step 1: The whole gate, from a clean build**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run verify 2>&1 | tail -15`
Expected: every stage green, ending with the built e2e suite passing. Budget ~15 minutes. If `check:fresh` or `check:publication` complains about the PV files, read its message: those checks were written for the ward artefacts and should not touch `pv-*.json`; report rather than patch a validator.

- [ ] **Step 2: Push with the exFAT recipe and watch CI**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git update-index -q --refresh; git fetch -q origin; git rebase -q origin/main
git push -q origin HEAD:main
sleep 25; gh run list --branch main --limit 1 --json databaseId,status,headSha -q '.[]|"\(.databaseId) \(.status) \(.headSha[0:7])"'
```
Then: `gh run watch <id> --exit-status --interval 30` (in the background if the session has a tool timeout under 15 minutes).
Expected: `conclusion=success`.

- [ ] **Step 3: Report**

State per ward: cross-check margin, central total / buildings / trees, the ≥3 kWp stratum, whether P1 and P2 held, the overhang kept/dropped fractions, and the raised-array recovery. If P1 did NOT hold in two wards, say so first: it is a published result either way.

---

## Self-review against the spec

- **§3 grid, surfaces, tallest-wins, pad, sun, march, attribution** → Task 4 (`rasterise`, `run_ward`), Task 2 (`shadow_height`), `classify` in Task 1. ✓
- **§3 rule 1 as amended (A1 connectedness), rule 2 τ, rule 3 minus-MAE** → Task 3 (`mask_canopy`), Task 4 (`dsm_m`, τ loop). ✓
- **A1 strict-mask and raised-array cells; `overhang_kept_frac`, `enclosed_dropped_frac`, `per_building_loss_total_raised`** → Task 4 (`dsm_s`, `b_r`/`t_r`, artefact fields). ✓
- **§4 files: new script, new artefact, yield switch, browser arrays, docs** → Tasks 1–4, 6, 8. ✓
- **§5 P1, P2, gate restated alongside, four sanity checks** → Task 4 (`p1`, `p2`, `gate_restated`, cross-check, monotonicity; isolation and below-roof asserted in `_self_check` checks 3–4 and guaranteed by `EPS_M`). ✓
- **§7 synthetic scene, strict mypy, three wards, cross-check fails closed, yield rerun, verify green, docs in the same change** → Tasks 1, 3, 5, 4 (`SystemExit` on failure), 6, 9, 8. ✓
- **Registered artefact never rewritten** → Task 4 reads `polygon_path` only; Task 6 stops reading it. ✓
- **Type consistency:** `shadow_height(dsm, alt_deg, az_deg, step_m) -> F32`; `mask_canopy(chm, foot) -> (F32, float, float)`; `classify(sh_b, sh_t, roof_h, raise_m) -> (BoolA, BoolA)`; `day_groups(list[tuple[float,float,float]]) -> list[list[int]]`; `rasterise(polys, heights, n, frame_m, step_m) -> (I32, F32)` — used with those names and orders throughout. ✓
- **Placeholders:** the only deliberate blanks are the two "paste the tabulated lines" spots in Task 5 Step 3 and Task 8 Step 1, which take the measured output of Task 5 Step 2 — they cannot be written before the runs, by design of the pre-registration.
