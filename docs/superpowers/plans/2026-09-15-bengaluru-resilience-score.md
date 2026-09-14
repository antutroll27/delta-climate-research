# Bengaluru Resilience Score (DC-URS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three Bengaluru wards show a DC-URS score built from per-ward measured inputs. The score's formula is unchanged, and Kolkata does not move.

**Architecture:** A pure, offline-tested Python module (`scripts/_dcurs_blr.py`) holds every rule the spec fixed in advance:
- shared-scene medians;
- the heat island as the median of per-scene differences;
- the 10 % / 8-scene / 2.5 °C gates;
- the anchor clamp report;
- the record shape.

Two new `fetch-bangalore.py` layers measure the inputs (`dcurs-static`, `dcurs-lst`). `export-bangalore-obos.py` writes `data/bangalore/dc-urs-inputs.json` and a byte-identical served copy, `public/heat-map/data/bengaluru-dc-urs-inputs.json`. Bengaluru's registry entry then points at that copy.

In the browser, the only change is that slider gains scale by ward area.

**Tech Stack:**
- Python 3.12 under strict mypy, using rasterio, numpy and scipy (already in `scripts/requirements.txt`).
- NASA CMR / LP DAAC for ECOSTRESS, accessed through `scripts/_ecostress.py`.
- JRC GHSL, ESA WorldCover, and Sentinel-2 via earth-search.
- TypeScript (Astro), with `node:test` via tsx, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md` (approved 2026-09-15).

---

## Facts this plan rests on (measured 2026-09-15)

**Data sources and access**
- **Tiles.** Tiles are confirmed to exist:
  - GHSL tile `R8_C26`. The GHS-SMOD version contains all three ward centres, each class 30. GHS-POP zip: 47 MB.
  - WorldCover `N12E075`: 128 MB. `R8_C25` does not exist.
- **Earthdata token.** It is at `~/.config/delta-climate/earthdata-token`, dated 2026-07-25. Tokens last about 60 days, so it expires around 2026-09-23. Task 4 stops with a clear message if it has lapsed.

**What the browser already reads**
- **Surface data.** `loadAreaSurface` (`src/scripts/climate-engine/surface-raster.ts:342-346`) reads `cityPaths(key).dcUrs` FIRST.
  - `tests/unit/heat-map-surface-measured.test.mjs:124-126` pins the served texture's means.
  - So **Bengaluru's `fvc` and `albedo` MUST equal `surface-meta.json`'s `fvc_mean` and `albedo_mean` exactly.** They are copied, not recomputed.
  - The reduction differs from Kolkata's `sentinel.json`, and Task 8 records this.
- **Scenario.** `applyScenario` (`dc-urs-scenario.ts:318`) has no size input. `heat-map-app.ts` already holds `currentWardSizeM` (set at `:2095`) in the same closure as the call at `:2674`.
- **Self-checks.** `assertDcUrsLogic()` and `assertScenarioLogic(base)` are exported but called from nowhere.

**Constraints on where Bengaluru's inputs can go**
- **Kolkata's inputs file.** Bengaluru must NOT be added to `dc-urs-inputs.json`. That would break:
  - `verify-served-data.mjs`, which requires a `{ward}-layers.json` per ward;
  - the "no scalar AND measured level" test.
- **Place-name test.** `tests/unit/obos-scope.test.mjs:419-434` pins the place names in `dc-urs.ts`. Add NO Bengaluru fixture there.

**Reusable code and caches**
- **Kolkata code.** It is loaded by importlib and not copied:
  - `compute-far.py`: `ward_buildings(path)`, `far_of(wb, heights, storey_m)`. It reads `public/heat-map/data/{ward}.json` rows `[h, x1, y1, …]`, the same format for both cities.
  - `compute-tra.py`: `ward_tra(src, ward: _types.Ward)`.
  - `fetch-sentinel-composites.py`: `ward(name, lat, lon, footprint_m, years)`.
- **Bengaluru's fitted storey height.** `storeyMetres` = 3.33 in every `data/bangalore/{ward}-buildings.json`.
- **ECOSTRESS cache.** Kolkata's granules average about 0.7 MB per band. Each Bengaluru acquisition's files are deleted after measurement, so the disk stays bounded. At plan time 15 GB is free, and Kolkata's 1.9 GB cache is kept.

## AMENDMENT A (2026-09-15): the population source changes. This OVERRIDES Tasks 1, 3 and 8 where they differ.

**Why (measured).** Task 3's first run gave Whitefield 625 people per km² from GHS-POP. A Census 2011 check across all 198 BBMP wards then showed:
- GHS-POP is systematically wrong for Bengaluru, and already so in E2010. Its log(pop) correlation is −0.03, worse than uniform density. It gives Whitefield about 0.1× the census and MG Road about 3×.
- Constrained WorldPop R2025A is the only grid that beats uniform density: log(pop) correlation 0.595, mean absolute log error 0.64 against 0.88.

The founder chose constrained WorldPop 2025, labelled `modelled`. The spec carries the same amendment.

**A1. Task 1 (`scripts/_dcurs_blr.py`, `ward_record`).** Replace the `popDensity` line with:

```python
        "popDensity": sourced(s["popDensity"], "modelled", "2025",
                              "WorldPop R2025A constrained 100 m (CC BY 4.0), people in exactly the "
                              "2.8 km box / 7.84 km2; biased flat (understates central wards)"),
```

**A2. Task 3 (`scripts/fetch-bangalore.py`).**

(a) Replace the `GHS_POP_URL` constant with:

```python
#: Constrained WorldPop, CHOSEN OVER GHS-POP after a Census 2011 check of all 198 BBMP
#: wards (spec amendment 2026-09-15): GHS-POP misplaced ~2.7 M people in the south-east.
WORLDPOP_URL = ("https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/IND/v1/"
                "100m/constrained/ind_pop_2025_CN_100m_R2025A_v1.tif")
```

Keep `GHS_TILE` and `GHS_SMOD_URL`, because Task 4's rural reference still uses GHS-SMOD.

(b) Replace `ghs_pop_density` with these two functions:

```python
def edge_weights(lo: float, hi: float, start: int, n: int) -> Any:
    """Fraction of each of n unit pixels, starting at index `start`, that lies inside [lo, hi)."""
    import numpy as np
    edges = start + np.arange(n + 1, dtype=np.float64)
    return np.clip(np.minimum(edges[1:], hi) - np.maximum(edges[:-1], lo), 0.0, 1.0)


def worldpop_box_density(w: blr.Ward, tif: str) -> tuple[float, int]:
    """People per km2 over EXACTLY the ward box.

    WorldPop is on a geographic grid, so the box edges run along pixel rows and
    columns and each edge pixel is weighted by the fraction of it inside the box.
    Kolkata's fetch-worldpop.py summed a whole projected ENVELOPE but divided by the
    box area, which inflates density (Indiranagar 20,028 vs 16,026 on GHS-POP).
    """
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    west, south, east, north = blr.bounds(w)
    with rasterio.open(tif) as src:
        t = src.transform
        c0f, c1f = (west - t.c) / t.a, (east - t.c) / t.a
        r0f, r1f = (north - t.f) / t.e, (south - t.f) / t.e
        c0, c1 = int(np.floor(c0f)), int(np.ceil(c1f))
        r0, r1 = int(np.floor(r0f)), int(np.ceil(r1f))
        arr = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0),
                       boundless=True, fill_value=0).astype("float64")
        nodata = src.nodata
    if nodata is not None:
        arr = np.where(arr == nodata, 0.0, arr)
    arr = np.where(np.isfinite(arr) & (arr > 0), arr, 0.0)
    weight = np.outer(edge_weights(r0f, r1f, r0, r1 - r0), edge_weights(c0f, c1f, c0, c1 - c0))
    total = float((arr * weight).sum())
    return round(total / (w.size_m / 1000.0) ** 2, 1), round(total)
```

(c) In `build_dcurs_static`:
- Replace the `pop_tif = tif_from_zip(cached_download(GHS_POP_URL, …))` statement with `pop_tif = cached_download(WORLDPOP_URL, os.path.join(GEO_CACHE, "worldpop", os.path.basename(WORLDPOP_URL)))`.
- Replace `ghs_pop_density(w, pop_tif)` with `worldpop_box_density(w, pop_tif)`.
- Replace `"ghsPop": GHS_POP_URL,` with `"ghsPop": WORLDPOP_URL,`. The `StaticFile` key name stays, to avoid a type change; its value now names WorldPop.

(d) Add these assertions to `_self_test()`, before its final `print`:

```python
    ew = edge_weights(0.5, 2.25, 0, 3)
    assert [round(float(x), 6) for x in ew] == [0.5, 1.0, 0.25], \
        f"edge pixels are weighted by the fraction inside the box, got {list(ew)}"
    assert float(edge_weights(0.0, 3.0, 0, 3).sum()) == 3.0, "a box on pixel edges counts whole pixels"
```

Mutation proof: make `edge_weights` return all ones. The first assertion must fail.

(e) **New sanity range** for population density: 3,000 to 40,000 people per km². The census box estimates are 4,010 to 16,671, and WorldPop's 2015 box values are 8,083 to 9,399.

(f) The WorldPop raster is about 740 MB, downloads slowly, and the server ignores range requests. The **controller** pre-downloads it to `~/.cache/delta-climate/worldpop/ind_pop_2025_CN_100m_R2025A_v1.tif`. The implementer must confirm that file exists, and that no `.part` file is present, before re-running the layer.

**A3. Task 8 (docs).**
- In `known-limitations.md` §14, add a paragraph "Population density is modelled, and the obvious grid was wrong". It carries the Census 2011 comparison figures above, WorldPop's flattening bias, and the Kolkata envelope-inflation note (recorded, not fixed).
- In `data-sources.md`, replace the GHS-POP row with WorldPop R2025A constrained 2025 (CC BY 4.0), and list GHS-POP under *ruled out*, with the Census evidence.

## Working rules for every task

- **Git.**
  - Never run `git stash`, `git push` or `git commit --amend`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gates.**
  - `npm run typecheck` is mypy; `npm run check` is TypeScript.
  - Every `.py` passes strict mypy.
- **Mutation proof.** Every new test or gate needs one: break the thing it guards, show FAIL, revert, show PASS. "A gate that cannot fail is not a gate."
- **zsh.**
  - Never assign a variable named `path`.
  - There is no `timeout` binary.
  - A command stored in a variable does not word-split, so write commands inline.
- **Playwright.** No Playwright browsers are bundled here. For e2e, create an untracked `.pw-chrome.config.ts`:
  ```ts
  import base from './playwright.config';
  import { defineConfig } from '@playwright/test';
  export default defineConfig({ ...base, use: { ...base.use, channel: 'chrome' } });
  ```
  Run it in the FOREGROUND with the Bash tool's timeout (never background and wait), then delete it.
- **Writing into `public/`.** Python writes are fine. Never `cp` into `public/`, because of exFAT sidecar files.

---

## File structure

| File | Responsibility |
|---|---|
| Create `scripts/_dcurs_blr.py` | Pure rules, with no network and no files: granule masking, the scene row, shared-scene thermal fields, gates, the clamp report, record and file assembly, and a self-test. |
| Modify `scripts/fetch-bangalore.py` | `--layer dcurs-static` (GHS-POP, FAR, WorldCover refuge, Sentinel-2 NDVI) writes `data/bangalore/dcurs-static.json`. `--layer dcurs-lst` (ECOSTRESS scenes) writes `data/bangalore/dcurs-lst-scenes.json`. |
| Modify `scripts/export-bangalore-obos.py` | `export_dcurs()` writes both inputs files and prints the clamp report. |
| Modify `package.json` | Add `_dcurs_blr.py` to `test:py`. |
| Modify `src/scripts/climate-engine/dc-urs-scenario.ts` | Add `REFERENCE_WARD_M`, `areaScale`, and the `sizeM` parameter. |
| Modify `src/scripts/climate-engine/heat-map-app.ts` | Pass `currentWardSizeM` to `applyScenario`. |
| Modify `src/scripts/climate-engine/scope/registry.ts` | Set Bengaluru `dcUrs: 'bengaluru-dc-urs-inputs'`. |
| Modify `scripts/verify-served-data.mjs` | Check that the Bengaluru source and served copies are byte-identical. |
| Create `tests/unit/dc-urs-logic.test.mjs` | Run the engine and scenario self-checks; pin the area scaling. |
| Create `tests/unit/bangalore-dc-urs.test.mjs` | Artefact shape, unmeasured socio, the anchor mirror, and Kolkata untouched. |
| Modify `tests/unit/obos-scope.test.mjs` | Assert the Bengaluru `dcUrs` URL. |
| Modify `tests/unit/heat-map-surface-measured.test.mjs` | Assert Bengaluru's `fvc`/`albedo` equal its surface means. |
| Create `tests/e2e/heat-map-bengaluru-resilience.spec.ts` | A Bengaluru ward shows a score and the confidence chip. |
| Modify `docs/evidence/known-limitations.md`, `docs/evidence/data-sources.md`, `docs/dc-urs-spec.md` | Evidence, the clamp report, and a Bengaluru section. |

---

### Task 1: The pure rules module, test-first

**Files:**
- Create: `scripts/_dcurs_blr.py`
- Modify: `package.json` (the `test:py` script)

- [ ] **Step 1: Write the module with its self-test, and stub the functions**

Create `scripts/_dcurs_blr.py` with the full contents below. Keep every function body as `raise NotImplementedError` for now; Step 3 fills them in. The self-test must exist first, so that Step 2 proves it fails.

```python
"""Bengaluru DC-URS inputs: the pure half.

Everything here runs without the network or a raster on disk, so the rules the
design fixed in advance can be tested offline. Two layers in fetch-bangalore.py
measure (`dcurs-static`, `dcurs-lst`); export-bangalore-obos.py assembles the
served file. The engine (src/scripts/climate-engine/dc-urs.ts) does not change.

Spec: docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md
"""
from __future__ import annotations

import os
import statistics
import sys
from typing import Literal, TypedDict

import numpy as np
import numpy.typing as npt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr  # noqa: E402  (path set above)
from _types import DcUrsInputsFile, DcUrsWard, Provenance, Sourced  # noqa: E402

STATIC_PATH = os.path.join(blr.DATA, "dcurs-static.json")
LST_PATH = os.path.join(blr.DATA, "dcurs-lst-scenes.json")
SOURCE_PATH = os.path.join(blr.DATA, "dc-urs-inputs.json")
SERVED_NAME = "bengaluru-dc-urs-inputs.json"

# PRE-REGISTERED GATES (spec §2), fixed before any Bengaluru scene was fetched.
MIN_CLEAR_FRAC = 0.10       # Kolkata's per-ward rule: 40 usable of ~400 pixels
MIN_SHARED_SCENES = 8       # per phase, scenes clear in ALL three wards
MAX_NIGHT_SUHII_C = 2.5     # above this a night heat island is a processing error
VIEW_CUT = 0.75             # near-nadir, as build-dcurs-inputs.py and _physics.py
MIN_RURAL_PX = 50           # as _suhii.measure_scene
RURAL_CLASSES = (11, 12, 13)

#: Mirror of ANCHORS in src/scripts/climate-engine/dc-urs.ts, used only for the
#: clamp report. tests/unit/bangalore-dc-urs.test.mjs pins the two equal.
ANCHORS: dict[str, float] = {
    "lstDayBase": 25.0, "lstDaySpan": 20.0,
    "lstNightBase": 20.0, "lstNightSpan": 15.0,
    "uhiSpan": 10.0,
    "popDensityMax": 25_000.0,
    "farMax": 5.0,
    "albedoRef": 0.60,
}

F32 = npt.NDArray[np.float32]
U16 = npt.NDArray[np.uint16]
Mask = npt.NDArray[np.bool_]
Phase = Literal["day", "night"]


class WardStat(TypedDict):
    mean_c: float | None
    clear: float


class SceneRow(TypedDict):
    utc: str
    phase: Phase
    view_delta: float | None
    rural_c: float | None
    rural_px: int
    wards: dict[str, WardStat]


class ScenesFile(TypedDict):
    source: str
    rural_bbox: list[float]
    start: str
    rows: list[SceneRow]
    skipped: list[str]


class StaticWard(TypedDict):
    popDensity: float
    population: int
    far: float
    storeyM: float
    distCoolM: float
    ndviMean: float
    ndviStd: float
    ndviYears: int


class StaticFile(TypedDict):
    generated: str
    ghsPop: str
    worldCover: str
    sentinel: str
    wards: dict[str, StaticWard]


class Thermal(TypedDict):
    lstDayC: float | None
    lstNightC: float | None
    ruralBaseC: float | None
    suhiiDayC: float | None
    suhiiNightC: float | None
    dayScenes: int
    nightScenes: int
    vintage: str


def granule_celsius(lst_k: F32, qc: U16 | None, cloud: U16 | None, water: U16 | None) -> F32:
    raise NotImplementedError


def first_finite(acc: F32 | None, nxt: F32) -> F32:
    raise NotImplementedError


def scene_row(utc: str, phase: Phase, cel: F32, view: F32 | None,
              smod: npt.NDArray[np.int16], masks: dict[str, Mask]) -> SceneRow:
    raise NotImplementedError


def shared(row: SceneRow, ward_ids: list[str]) -> bool:
    raise NotImplementedError


def thermal(rows: list[SceneRow], ward_ids: list[str]) -> dict[str, Thermal]:
    raise NotImplementedError


def night_suhii_refusal(th: dict[str, Thermal]) -> str | None:
    raise NotImplementedError


def sourced(value: float, source: Provenance, vintage: str | None = None,
            cite: str | None = None) -> Sourced[float]:
    raise NotImplementedError


def ward_record(t: Thermal, s: StaticWard, fvc: float, albedo: float) -> DcUrsWard:
    raise NotImplementedError


def assemble(th: dict[str, Thermal], static: dict[str, StaticWard],
             surface: dict[str, tuple[float, float]]) -> DcUrsInputsFile:
    raise NotImplementedError


def clamps(rec: DcUrsWard) -> list[str]:
    raise NotImplementedError


# ── self-test ────────────────────────────────────────────────────────────────

def _row(utc: str, phase: Phase, wards: dict[str, float | None],
         rural: float | None = 30.0, view: float | None = 0.2, clear: float = 0.5) -> SceneRow:
    return {"utc": utc, "phase": phase, "view_delta": view, "rural_c": rural,
            "rural_px": 999 if rural is not None else 0,
            "wards": {w: {"mean_c": v, "clear": clear if v is not None else 0.0}
                      for w, v in wards.items()}}


def _unpaired_median(rows: list[SceneRow], w: str, phase: Phase) -> float:
    """The aggregation the spec REJECTS, kept only to prove the ranking flip."""
    vals: list[float] = []
    for r in rows:
        st = r["wards"][w]
        if r["phase"] == phase and st["mean_c"] is not None and st["clear"] >= MIN_CLEAR_FRAC:
            vals.append(st["mean_c"])
    return statistics.median(vals)


def _self_test() -> None:
    nan = np.float32(np.nan)
    # 1. Kolkata's granule mask: range, QC mandatory bits, cloud, water.
    lst = np.array([[300.0, 150.0], [310.0, nan]], dtype=np.float32)
    qc = np.array([[0, 0], [1, 0]], dtype=np.uint16)
    zero = np.zeros((2, 2), dtype=np.uint16)
    cel = granule_celsius(lst, qc, zero, zero)
    assert abs(float(cel[0, 0]) - 26.85) < 1e-4, "300 K is 26.85 C"
    assert np.isnan(cel[0, 1]) and np.isnan(cel[1, 0]) and np.isnan(cel[1, 1]), \
        "out-of-range, QC-flagged and missing pixels are unusable"
    wet = np.array([[1, 0], [0, 0]], dtype=np.uint16)
    assert np.isnan(granule_celsius(lst, None, None, wet)[0, 0]), "water is masked"

    # 2. first finite wins across overlapping granules.
    a = np.array([[1.0, nan]], dtype=np.float32)
    b = np.array([[9.0, 2.0]], dtype=np.float32)
    assert first_finite(a, b).tolist() == [[1.0, 2.0]], "the earlier granule keeps its pixels"
    assert first_finite(None, b).tolist() == [[9.0, 2.0]]

    # 3. scene row: ward means and clear fractions, rural reference, view delta.
    grid = np.full((10, 10), 30.0, dtype=np.float32)
    ma = np.zeros((10, 10), dtype=bool)
    ma[0:2, 0:2] = True
    mb = np.zeros((10, 10), dtype=bool)
    mb[0:2, 8:10] = True
    grid[ma] = 35.0
    grid[1, 1] = nan                                   # one of ward a's 4 pixels is cloud
    smod = np.full((10, 10), 11, dtype=np.int16)
    view = np.full((10, 10), -5.0, dtype=np.float32)
    row = scene_row("2024-03-01T05:00:00", "day", grid, view, smod, {"a": ma, "b": mb})
    assert row["wards"]["a"] == {"mean_c": 35.0, "clear": 0.75}, row["wards"]["a"]
    assert row["wards"]["b"] == {"mean_c": 30.0, "clear": 1.0}, row["wards"]["b"]
    assert row["rural_px"] == 92 and row["rural_c"] == 30.0, "ward pixels are excluded from rural"
    assert row["view_delta"] == 0.0

    # 4. THE RANKING FLIP (dc-urs-diagnosis.md): unpaired medians rank b hottest,
    #    the shared-scene method ranks a hottest, on the same rows.
    ids = ["a", "b", "c"]
    rows = [_row(f"2024-01-{d:02d}T05:00:00", "day", {"a": 31.0, "b": 30.0, "c": 29.0}, rural=25.0)
            for d in range(1, 9)]
    rows += [_row(f"2024-02-{d:02d}T05:00:00", "day", {"a": None, "b": 40.0, "c": None}, rural=25.0)
             for d in range(1, 11)]
    assert _unpaired_median(rows, "b", "day") > _unpaired_median(rows, "a", "day"), \
        "fixture must reproduce the flip, or it proves nothing"
    th = thermal(rows, ids)
    assert th["a"]["lstDayC"] == 31.0 and th["b"]["lstDayC"] == 30.0, th
    assert th["a"]["dayScenes"] == 8, "only scenes clear in all three wards count"

    # 5. MEDIAN OF DIFFERENCES, not difference of medians (the Kolkata sign bug).
    wa = [30.0, 31.0, 32.0, 33.0, 34.0, 35.0, 36.0, 37.0, 38.0]
    ru = [29.0, 30.0, 31.0, 32.0, 33.0, 20.0, 21.0, 22.0, 23.0]
    rows2 = [_row(f"2025-01-{i + 1:02d}T05:00:00", "day", {"a": v, "b": v, "c": v}, rural=r)
             for i, (v, r) in enumerate(zip(wa, ru))]
    t2 = thermal(rows2, ids)["a"]
    assert statistics.median(wa) - statistics.median(ru) == 5.0, "fixture: difference of medians is 5"
    assert t2["suhiiDayC"] == 1.0, f"median of per-scene differences is 1, got {t2['suhiiDayC']}"
    assert t2["lstDayC"] == 34.0 and t2["ruralBaseC"] == 33.0, \
        "effective baseline = lstDayC - median difference, so the engine reproduces 1.0"
    assert t2["vintage"] == "2025-2025"

    # 6. the 8-scene gate.
    t3 = thermal(rows2[:7], ids)["a"]
    assert t3["lstDayC"] is None and t3["ruralBaseC"] is None, "7 shared scenes must not ship"

    # 7. the night sanity gate.
    night_rows = [_row(f"2025-02-{i + 1:02d}T18:00:00", "night", {"a": 23.0, "b": 23.0, "c": 23.0},
                       rural=20.0) for i in range(8)]
    assert night_suhii_refusal(thermal(night_rows, ids)) is not None, "3.0 C at night must refuse"
    ok_rows = [_row(r["utc"], "night", {"a": 22.0, "b": 22.0, "c": 22.0}, rural=20.0) for r in night_rows]
    assert night_suhii_refusal(thermal(ok_rows, ids)) is None, "2.0 C at night is plausible"

    # 8. view angle and clear-fraction filters.
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, view=0.9), ids), "off-nadir"
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, clear=0.09), ids), "under 10 %"
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, rural=None), ids), "no rural"

    # 9. records: a gated field is a placeholder at 0; socio is always a placeholder.
    static: StaticWard = {"popDensity": 30_000.0, "population": 235_200, "far": 1.2, "storeyM": 3.33,
                          "distCoolM": 150.0, "ndviMean": 0.3, "ndviStd": 0.02, "ndviYears": 5}
    rec = ward_record(t3, static, 0.4, 0.17)
    assert rec["lstDayC"]["source"] == "placeholder" and rec["lstDayC"]["value"] == 0.0
    assert rec["socioVuln"]["source"] == "placeholder" and rec["socioVuln"]["value"] == 0.0
    assert rec["fvc"]["value"] == 0.4 and rec["albedo"]["value"] == 0.17
    measured = ward_record(t2, static, 0.4, 0.17)
    assert measured["lstDayC"]["source"] == "measured" and measured["lstDayC"]["vintage"] == "2025-2025"
    assert "EFFECTIVE" in str(measured["ruralBaseC"].get("cite", "")), "the baseline construction is disclosed"

    # 10. clamp report.
    cold_night = t2.copy()
    cold_night["lstNightC"] = 18.0
    cold_night["nightScenes"] = 8
    report = clamps(ward_record(cold_night, static, 0.4, 0.17))
    assert any("lstNightC" in s for s in report), report
    assert any("popDensity" in s for s in report), "30,000/km2 is over the 25,000 ceiling"
    assert sourced(1.0, "measured") == {"value": 1.0, "source": "measured"}, "None keys are omitted"
    print("  _dcurs_blr self-test OK")


if __name__ == "__main__":
    _self_test()
```

- [ ] **Step 2: Run the self-test and see it fail**

Run: `python3 scripts/_dcurs_blr.py; echo exit=$?`

Expected: a `NotImplementedError` traceback from `granule_celsius`, then `exit=1`.

- [ ] **Step 3: Replace the ten stubs with the implementations**

Replace each `raise NotImplementedError` body with the code below. Change nothing else.

```python
def granule_celsius(lst_k: F32, qc: U16 | None, cloud: U16 | None, water: U16 | None) -> F32:
    """Kolkata's per-granule mask (build-ward-observations.ward_lst): Kelvin in, C out, NaN unusable."""
    good = np.isfinite(lst_k) & (lst_k > 200) & (lst_k < 400)
    if qc is not None:
        good &= (qc != 0xFFFF) & ((qc & 0b11) == 0)
    if cloud is not None:
        good &= cloud != 1
    if water is not None:
        good &= water != 1
    return np.where(good, lst_k - np.float32(273.15), np.float32(np.nan)).astype(np.float32)


def first_finite(acc: F32 | None, nxt: F32) -> F32:
    """Overlapping granules: the first finite pixel wins, as in _suhii and ward_lst."""
    if acc is None:
        return nxt
    return np.where(np.isfinite(acc), acc, nxt).astype(np.float32)


def scene_row(utc: str, phase: Phase, cel: F32, view: F32 | None,
              smod: npt.NDArray[np.int16], masks: dict[str, Mask]) -> SceneRow:
    """One acquisition, every ward and the rural reference, on ONE aligned grid."""
    ok = np.isfinite(cel)
    union = np.zeros(cel.shape, dtype=bool)
    wards: dict[str, WardStat] = {}
    for wid, m in masks.items():
        union |= m
        n, k = int(m.sum()), int((ok & m).sum())
        wards[wid] = {"mean_c": round(float(np.mean(cel[ok & m])), 3) if k else None,
                      "clear": round(k / n, 4) if n else 0.0}
    rural = ok & np.isin(smod, RURAL_CLASSES) & ~union
    rural_px = int(rural.sum())
    rural_c = round(float(np.mean(cel[rural])), 3) if rural_px >= MIN_RURAL_PX else None
    view_delta: float | None = None
    if view is not None and rural_c is not None and bool((ok & union).any()):
        vu = float(np.nanmean(np.abs(view[ok & union])))
        vr = float(np.nanmean(np.abs(view[rural])))
        view_delta = round(abs(vu - vr), 2)
    return {"utc": utc, "phase": phase, "view_delta": view_delta, "rural_c": rural_c,
            "rural_px": rural_px, "wards": wards}


def shared(row: SceneRow, ward_ids: list[str]) -> bool:
    """A scene counts only if it is near-nadir, has a rural reference, and every ward is clear."""
    if row["rural_c"] is None or row["view_delta"] is None or row["view_delta"] > VIEW_CUT:
        return False
    for w in ward_ids:
        st = row["wards"].get(w)
        if st is None or st["mean_c"] is None or st["clear"] < MIN_CLEAR_FRAC:
            return False
    return True


def _c(row: SceneRow, w: str) -> float:
    v = row["wards"][w]["mean_c"]
    assert v is not None
    return v


def _rural(row: SceneRow) -> float:
    v = row["rural_c"]
    assert v is not None
    return v


def thermal(rows: list[SceneRow], ward_ids: list[str]) -> dict[str, Thermal]:
    """Day/night medians over SHARED scenes, and the heat island as a median of differences."""
    use = [r for r in rows if shared(r, ward_ids)]
    day = [r for r in use if r["phase"] == "day"]
    night = [r for r in use if r["phase"] == "night"]
    years = sorted({r["utc"][:4] for r in use})
    vintage = f"{years[0]}-{years[-1]}" if years else ""
    day_ok, night_ok = len(day) >= MIN_SHARED_SCENES, len(night) >= MIN_SHARED_SCENES
    out: dict[str, Thermal] = {}
    for w in ward_ids:
        lst_day = round(statistics.median(_c(r, w) for r in day), 2) if day_ok else None
        suhii_day = round(statistics.median(_c(r, w) - _rural(r) for r in day), 2) if day_ok else None
        out[w] = {
            "lstDayC": lst_day,
            "lstNightC": round(statistics.median(_c(r, w) for r in night), 2) if night_ok else None,
            "ruralBaseC": (round(lst_day - suhii_day, 2)
                           if lst_day is not None and suhii_day is not None else None),
            "suhiiDayC": suhii_day,
            "suhiiNightC": (round(statistics.median(_c(r, w) - _rural(r) for r in night), 2)
                            if night_ok else None),
            "dayScenes": len(day),
            "nightScenes": len(night),
            "vintage": vintage,
        }
    return out


def night_suhii_refusal(th: dict[str, Thermal]) -> str | None:
    """A reason to refuse the export, or None."""
    bad = {w: t["suhiiNightC"] for w, t in th.items()
           if t["suhiiNightC"] is not None and t["suhiiNightC"] > MAX_NIGHT_SUHII_C}
    if not bad:
        return None
    return (f"night heat island above {MAX_NIGHT_SUHII_C} C in {bad}: published Indian values sit "
            "near 1-1.5 C, so this is treated as a processing error and nothing is exported")


def sourced(value: float, source: Provenance, vintage: str | None = None,
            cite: str | None = None) -> Sourced[float]:
    d: Sourced[float] = {"value": value, "source": source}
    if vintage is not None:
        d["vintage"] = vintage
    if cite is not None:
        d["cite"] = cite
    return d


ECO = "NASA ECOSTRESS L2T LSTE v002, scenes clear in all three wards"


def ward_record(t: Thermal, s: StaticWard, fvc: float, albedo: float) -> DcUrsWard:
    """One ward's twelve indicators, in the TypeScript DcUrsInputs shape."""
    def lst(v: float | None, cite: str) -> Sourced[float]:
        if v is None:
            return sourced(0.0, "placeholder", None,
                           f"{cite} -- fewer than {MIN_SHARED_SCENES} shared clear scenes")
        return sourced(v, "measured", t["vintage"], cite)
    return {
        "lstDayC": lst(t["lstDayC"], f"{ECO}, median of {t['dayScenes']} day scenes"),
        "lstNightC": lst(t["lstNightC"], f"{ECO}, median of {t['nightScenes']} night scenes"),
        "ruralBaseC": lst(t["ruralBaseC"],
                          "EFFECTIVE rural baseline: lstDayC minus the median per-scene difference "
                          "(ward - GHS-SMOD rural 11/12/13), so lstDayC - ruralBaseC is that median"),
        "popDensity": sourced(s["popDensity"], "measured", "2020",
                              "JRC GHS-POP R2023A 100 m, tile R8_C26, people in the 2.8 km box / 7.84 km2"),
        "far": sourced(s["far"], "measured", "2023-2026",
                       f"Overture footprints + Google Open Buildings 2.5D / OSM heights, storey {s['storeyM']} m"),
        "socioVuln": sourced(0.0, "placeholder", None,
                             "not measured: no commercially clear ward-level source "
                             "(docs/evidence/known-limitations.md)"),
        "fvc": sourced(fvc, "measured", "2021-2025",
                       "Sentinel-2 L2A per-cell composite, surface-meta.json fvc_mean"),
        "canopyFrac": sourced(0.0, "placeholder", None, "v2 only -- inert in the v1 greenness formula"),
        "ndviMean": sourced(s["ndviMean"], "measured", f"{s['ndviYears']} yr", "Sentinel-2 L2A"),
        "ndviStd": sourced(s["ndviStd"], "measured", f"{s['ndviYears']} yr",
                           "Sentinel-2 L2A, across-year std of annual medians"),
        "albedo": sourced(albedo, "measured", "2021-2025",
                          "Sentinel-2 per-cell composite, surface-meta.json albedo_mean"),
        "distCoolM": sourced(s["distCoolM"], "measured", "2021",
                             "ESA WorldCover 10 m, tile N12E075, patches >= 0.77 ha"),
    }


def assemble(th: dict[str, Thermal], static: dict[str, StaticWard],
             surface: dict[str, tuple[float, float]]) -> DcUrsInputsFile:
    return {
        "generated": "export-bangalore-obos.py",
        "engine": ("v1 -- see docs/dc-urs-source-of-truth.md; Bengaluru inputs per "
                   "docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md"),
        "note": ("Every field carries source and vintage. A 'placeholder' sits at its optimistic "
                 "endpoint and is disclosed by the score's confidence chip."),
        "known_limitations": [
            "socioVuln is unmeasured: district data is identical across the three wards, WorldPop "
            "age shares are state-uniform for India, and the Census 2011 ward tables are not cleared "
            "for commercial use.",
            "fvc and albedo are the map's per-cell Sentinel-2 composite means (surface-meta.json), a "
            "different reduction from Kolkata's sentinel.json, kept identical to the served texture "
            "so the map and the score cannot disagree.",
            "ruralBaseC is an effective baseline (lstDayC minus the median per-scene heat island), so "
            "the engine reproduces a median of differences, not a difference of medians.",
            "Anchors are Kolkata's; the clamp report is in docs/evidence/known-limitations.md.",
        ],
        "wards": {w: ward_record(th[w], static[w], surface[w][0], surface[w][1]) for w in th},
    }


def clamps(rec: DcUrsWard) -> list[str]:
    """Every term that sits on a Kolkata anchor's floor or ceiling, in words."""
    a = ANCHORS
    out: list[str] = []
    if rec["lstDayC"]["source"] != "placeholder":
        d = rec["lstDayC"]["value"]
        t = (d - a["lstDayBase"]) / a["lstDaySpan"]
        if t <= 0:
            out.append(f"lstDayC {d} C at or below the {a['lstDayBase']} C floor: day hazard reads 0")
        elif t >= 1:
            out.append(f"lstDayC {d} C at or above the {a['lstDayBase'] + a['lstDaySpan']} C ceiling")
        u = max(0.0, d - rec["ruralBaseC"]["value"]) / a["uhiSpan"]
        if u <= 0:
            out.append("heat island at or below 0: the UHI term reads 0")
        elif u >= 1:
            out.append(f"heat island at or above the {a['uhiSpan']} C ceiling")
    if rec["lstNightC"]["source"] != "placeholder":
        n = rec["lstNightC"]["value"]
        t = (n - a["lstNightBase"]) / a["lstNightSpan"]
        if t <= 0:
            out.append(f"lstNightC {n} C at or below the {a['lstNightBase']} C floor: night hazard reads 0")
        elif t >= 1:
            out.append(f"lstNightC {n} C at or above the {a['lstNightBase'] + a['lstNightSpan']} C ceiling")
    if rec["popDensity"]["value"] >= a["popDensityMax"]:
        out.append(f"popDensity {rec['popDensity']['value']:,.0f}/km2 at or above the "
                   f"{a['popDensityMax']:,.0f} ceiling: exposure saturates")
    if rec["far"]["value"] >= a["farMax"]:
        out.append(f"far {rec['far']['value']} at or above the {a['farMax']} ceiling")
    if rec["albedo"]["value"] >= a["albedoRef"]:
        out.append(f"albedo {rec['albedo']['value']} at or above the {a['albedoRef']} reference")
    return out
```

- [ ] **Step 4: Run the self-test and mypy until both pass**

Run: `python3 scripts/_dcurs_blr.py; echo exit=$?`
Expected: `  _dcurs_blr self-test OK` and `exit=0`.

Run: `npm run typecheck`
Expected: `Success: no issues found`.

- [ ] **Step 5: Mutation proofs (paste each FAIL and the restored PASS)**

1. In `thermal`, replace both `for r in day)` medians of differences with a difference of medians: `round(statistics.median(_c(r, w) for r in day) - statistics.median(_rural(r) for r in day), 2)`. Expected: `AssertionError: median of per-scene differences is 1, got 5.0`.
2. In `thermal`, change `use = [r for r in rows if shared(r, ward_ids)]` to `use = rows`. Expected: the ranking-flip or `dayScenes` assertion fails, or a `TypeError` from a `None` mean. Paste whichever appears.
3. Change `MIN_SHARED_SCENES = 8` to `7`. Expected: `7 shared scenes must not ship`.

Revert each change and re-run: `_dcurs_blr self-test OK`.

- [ ] **Step 6: Wire the self-test into `test:py`**

In `package.json`, change the start of `test:py` from:
`"test:py": "python3 scripts/_trees.py && python3 scripts/fetch-bangalore.py --self-test && `
to:
`"test:py": "python3 scripts/_trees.py && python3 scripts/fetch-bangalore.py --self-test && python3 scripts/_dcurs_blr.py && `

Run: `npm run test:py; echo exit=$?`
Expected: `exit=0`, and the output includes `_dcurs_blr self-test OK`.

- [ ] **Step 7: Commit**

```bash
git add scripts/_dcurs_blr.py package.json
git commit -m "feat(bangalore): DC-URS rules as a pure, self-tested module

Shared-scene medians (the ranking flip), the heat island as a median of
per-scene differences (the Kolkata sign bug), the pre-registered 10 % clear /
8 shared scenes / 2.5 C night gates, the anchor clamp report and the record
shape, all offline. Mutation-proven.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scenario gains scale by ward area; the self-checks finally run

**Files:**
- Create: `tests/unit/dc-urs-logic.test.mjs`
- Modify: `src/scripts/climate-engine/dc-urs-scenario.ts` (the `SCENARIO` doc comment and `applyScenario`, lines ~274-360)
- Modify: `src/scripts/climate-engine/heat-map-app.ts:2674` (the `applyScenario` call inside the stats refresh)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dc-urs-logic.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDcUrsLogic, GOLDEN } from '../../src/scripts/climate-engine/dc-urs.ts';
import {
  applyScenario, areaScale, assertScenarioLogic, REFERENCE_WARD_M,
} from '../../src/scripts/climate-engine/dc-urs-scenario.ts';

/* THE ENGINE'S OWN SELF-CHECKS, WHICH NOTHING CALLED. assertDcUrsLogic and
   assertScenarioLogic were written, exported and never run by any test: a gate
   that cannot fail because it never executes. */
test('the DC-URS engine self-check holds', () => { assertDcUrsLogic(); });
test('the scenario self-check holds on every golden ward', () => {
  for (const g of GOLDEN) assertScenarioLogic(g.inputs);
});

const IV = { trees: 30, roof: 40, parks: 4, facades: 5 };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

/* A 1400 m ward is the reference the gains were sized for, so it must be scored
   exactly as before the area scaling existed. Values are pinned by hand from
   SCENARIO, not recomputed by the code under test. */
test('a 1400 m ward moves exactly as before', () => {
  const base = GOLDEN[0].inputs;
  assert.deepEqual(applyScenario(base, IV, undefined, REFERENCE_WARD_M), applyScenario(base, IV));
  const r = applyScenario(base, IV);
  close(r.inputs.fvc.value, 0.12 + 0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01, 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.4 * 220, 'distCoolM');
});

/* Bengaluru's wards are 2800 m, four times the area: the same package of trees,
   parks and roofs moves a ward mean a quarter as far. */
test('a 2800 m ward moves a quarter as far', () => {
  const base = GOLDEN[0].inputs;
  assert.equal(areaScale(2800), 0.25);
  const r = applyScenario(base, IV, undefined, 2800);
  close(r.inputs.fvc.value, 0.12 + 0.25 * (0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01), 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.25 * 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.25 * 0.4 * 220, 'distCoolM');
  assert.equal(r.active, true, 'a scaled plan is still an active plan');
});

test('a ward size that is not positive is refused, not scored', () => {
  assert.throws(() => areaScale(0), RangeError);
  assert.throws(() => areaScale(Number.NaN), RangeError);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/dc-urs-logic.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'REFERENCE_WARD_M'`.

- [ ] **Step 3: Implement the scaling**

In `src/scripts/climate-engine/dc-urs-scenario.ts`:

(a) Directly after the closing `} as const;` of `export const SCENARIO = { ... }`, add:

```ts
/** The ward the SCENARIO gains were sized for. Kolkata's wards are exactly this. */
export const REFERENCE_WARD_M = 1400;

/**
 * How far a slider's gain carries over a ward of side `sizeM`.
 *
 * The gains are a fixed PACKAGE — 50 street trees, 10 pocket parks — so over a
 * ward four times the area (Bengaluru's 2800 m) the same package moves the ward
 * mean a quarter as far. Kolkata's 1400 m wards scale by exactly 1.
 */
export function areaScale(sizeM: number): number {
  if (!(sizeM > 0)) throw new RangeError(`dc-urs-scenario: ward size must be positive, got ${sizeM}`);
  return (REFERENCE_WARD_M / sizeM) ** 2;
}
```

(b) Replace the signature and first three lines of `applyScenario`. Currently:

```ts
export function applyScenario(
  base: DcUrsInputs,
  iv: Interventions,
  lst?: { dayC?: number; nightC?: number },
): ScenarioResult {
  const trees = iv.trees / 50, roof = iv.roof / 100;
  const parks = Math.min(1, iv.parks / 10), facades = iv.facades / 15;
```

Replace with:

```ts
export function applyScenario(
  base: DcUrsInputs,
  iv: Interventions,
  lst?: { dayC?: number; nightC?: number },
  sizeM: number = REFERENCE_WARD_M,
): ScenarioResult {
  const k = areaScale(sizeM);
  const trees = (iv.trees / 50) * k, roof = (iv.roof / 100) * k;
  const parks = Math.min(1, iv.parks / 10) * k, facades = (iv.facades / 15) * k;
```

(c) In `heat-map-app.ts`, change the call:

```ts
      const scen = applyScenario(base, iv, anyIv ? phaseLst : undefined);
```

to:

```ts
      const scen = applyScenario(base, iv, anyIv ? phaseLst : undefined, currentWardSizeM);
```

- [ ] **Step 4: Run the tests until they pass**

Run: `node --import tsx --test tests/unit/dc-urs-logic.test.mjs`
Expected: `pass 5`, `fail 0`.

Run: `npm run check`
Expected: `0 errors`.

- [ ] **Step 5: Mutation proofs (paste each FAIL and the restored PASS)**

1. In `areaScale`, return `1` instead. Expected: `a 2800 m ward moves a quarter as far` fails.
2. In `assertDcUrsLogic` (`dc-urs.ts`), change a GOLDEN tolerance check so it cannot pass, e.g. `expected: 20.01` becomes `expected: 99`. Expected: `the DC-URS engine self-check holds` fails with `dc-urs: ...`.

Revert both, and re-run for 5 passes.

- [ ] **Step 6: Full unit suite**

Run: `npm run test:unit`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/dc-urs-scenario.ts src/scripts/climate-engine/heat-map-app.ts tests/unit/dc-urs-logic.test.mjs
git commit -m "feat(dc-urs): slider gains scale by ward area; the engine self-checks now run

The gains were sized for a 1400 m ward; a 2800 m Bengaluru ward is four times
the area, so the same package moves it a quarter as far. Kolkata scales by
exactly 1 and is pinned unchanged. assertDcUrsLogic and assertScenarioLogic
were exported and never executed by any test; they now run in test:unit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `--layer dcurs-static`: population, FAR, refuge distance, NDVI

**Files:**
- Modify: `scripts/fetch-bangalore.py` (imports, new constants and helpers, the layer function, `main()` choices and dispatch)
- Create (generated): `data/bangalore/dcurs-static.json`

- [ ] **Step 1: Add imports and constants**

In `scripts/fetch-bangalore.py`, extend the stdlib import block (lines 32-42) so it also imports `shutil`, `subprocess` and `zipfile`. Keep alphabetical order among the plain `import` lines.

After `OVERTURE_PARQUET = os.path.join(RAW, "overture-buildings.parquet")`, add:

```python
# ── DC-URS inputs (spec 2026-09-14-bengaluru-resilience-score-design.md) ────────
GEO_CACHE = os.path.expanduser("~/.cache/delta-climate")
#: GHSL tile covering all three wards, CONFIRMED 2026-09-15: the SMOD tile's
#: bounds contain every ward centre (class 30, Urban Centre). R8_C25 does not exist.
GHS_TILE = "R8_C26"
GHS_POP_URL = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/"
               "GHS_POP_E2020_GLOBE_R2023A_54009_100/V1-0/tiles/"
               f"GHS_POP_E2020_GLOBE_R2023A_54009_100_V1_0_{GHS_TILE}.zip")
GHS_SMOD_URL = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_SMOD_GLOBE_R2023A/"
                "GHS_SMOD_E2020_GLOBE_R2023A_54009_1000/V2-0/tiles/"
                f"GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0_{GHS_TILE}.zip")
#: WorldCover tiles are 3 deg squares named by their south-west corner; HTTP 200 confirmed.
WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_N12E075_Map.tif")
SENTINEL_YEARS = [2021, 2022, 2023, 2024, 2025]
```

- [ ] **Step 2: Add the download and module helpers**

Directly after `_kolkata_canopy()` (which ends at `return mod` near line 744), add:

```python
def _kolkata_module(file_name: str, module_name: str) -> Any:
    """Load one of Kolkata's hyphenated scripts so its measurement is REUSED, not copied."""
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(os.path.dirname(os.path.abspath(__file__)), file_name))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cached_download(url: str, dst: str) -> str:
    """Download once into the shared cache; an atomic rename means a partial file never counts."""
    if os.path.exists(dst):
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".part"
    rc = subprocess.run(["curl", "-s", "--fail", "-L", "--max-time", "1800", "-o", tmp, url]).returncode
    if rc != 0 or not os.path.exists(tmp):
        raise SystemExit(f"download failed (curl {rc}): {url}")
    os.replace(tmp, dst)
    return dst


def tif_from_zip(zip_path: str) -> str:
    out = zip_path[:-4] + ".tif"
    if os.path.exists(out):
        return out
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        with z.open(name) as src, open(out + ".part", "wb") as dst:
            shutil.copyfileobj(src, dst)
    os.replace(out + ".part", out)
    return out


def ghs_pop_density(w: blr.Ward, tif: str) -> tuple[float, int]:
    """People per km2 over the ward box, Kolkata's method (fetch-worldpop.py main()).

    ponytail: the arithmetic is repeated here because Kolkata's lives inline in a
    main() over a private ward table; extract it only if a third city needs it.
    """
    import numpy as np
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.open(tif) as src:
        l, b, r, t = transform_bounds("EPSG:4326", src.crs, *blr.bounds(w))
        arr = src.read(1, window=from_bounds(l, b, r, t, src.transform),
                       boundless=True, fill_value=0).astype("float64")
    arr = np.where(arr < 0, 0, arr)          # GHS-POP nodata is negative
    total = float(arr.sum())
    return round(total / (w.size_m / 1000.0) ** 2, 1), round(total)
```

- [ ] **Step 3: Add the layer**

Directly before `def _self_test() -> None:`, add:

```python
def build_dcurs_static(wards: list[blr.Ward]) -> None:
    """--layer dcurs-static: the four non-thermal DC-URS inputs, per ward, into one file."""
    import rasterio
    import _dcurs_blr as dc
    import _types
    pop_tif = tif_from_zip(cached_download(
        GHS_POP_URL, os.path.join(GEO_CACHE, "worldpop", os.path.basename(GHS_POP_URL))))
    wc_tif = cached_download(WORLDCOVER_URL, os.path.join(GEO_CACHE, "worldcover", "N12E075.tif"))
    cf = _kolkata_module("compute-far.py", "compute_far")
    ct = _kolkata_module("compute-tra.py", "compute_tra")
    fsc = _kolkata_module("fetch-sentinel-composites.py", "fetch_sentinel_composites")
    out: dc.StaticFile = {
        "generated": "fetch-bangalore.py --layer dcurs-static",
        "ghsPop": GHS_POP_URL,
        "worldCover": WORLDCOVER_URL,
        "sentinel": f"earth-search sentinel-2-l2a via _sentinel.py, years {SENTINEL_YEARS}",
        "wards": {},
    }
    for w in wards:
        density, population = ghs_pop_density(w, pop_tif)
        with open(os.path.join(blr.DATA, f"{w.id}-buildings.json"), encoding="utf-8") as fh:
            storey = float(json.load(fh)["storeyMetres"])
        wb = cf.ward_buildings(os.path.join(blr.ROOT, "public", "heat-map", "data", f"{w.id}.json"))
        far = round(float(cf.far_of(wb, wb.heights, storey)), 4)
        tw = _types.Ward(w.id, _types.LatLon(w.centre.lat, w.centre.lon), int(w.size_m))
        with rasterio.open(wc_tif) as src:
            dist = round(float(ct.ward_tra(src, tw)["median_dist_m"]), 1)
        sw = fsc.ward(f"blr-{w.id}", w.centre.lat, w.centre.lon, int(w.size_m), SENTINEL_YEARS)
        out["wards"][w.id] = {
            "popDensity": density, "population": population, "far": far, "storeyM": storey,
            "distCoolM": dist, "ndviMean": float(sw["ndvi_mean"]), "ndviStd": float(sw["ndvi_std"]),
            "ndviYears": int(sw["years"]),
        }
        print(f"  {w.id:<12} pop {density:,.0f}/km2 · FAR {far} (storey {storey} m) · "
              f"refuge {dist:.0f} m · NDVI {sw['ndvi_mean']} ± {sw['ndvi_std']} ({sw['years']} yr)")
    with open(dc.STATIC_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
```

- [ ] **Step 4: Wire the layer into `main()`**

(a) In the `choices=(...)` tuple, add `"dcurs-static", "dcurs-lst"` after `"osm",` and before `"all"`.

(b) Directly after `wards = ward_list(a.ward)`, add:

```python
    if a.layer in ("dcurs-static", "dcurs-lst") and a.ward:
        raise SystemExit("the dcurs layers measure all three wards together; drop --ward")
```

(c) Directly before `if a.layer in ("heights", "all"):`, add:

```python
    if a.layer == "dcurs-static":
        print("DC-URS static inputs (GHS-POP, FAR, WorldCover refuge, Sentinel-2 NDVI):")
        build_dcurs_static(wards)
```

- [ ] **Step 5: Gates before the network run**

Run: `npm run typecheck` and `python3 scripts/fetch-bangalore.py --self-test; echo exit=$?`
Expected: mypy `Success`, then `fetch-bangalore self-test OK` and `exit=0`.

- [ ] **Step 6: Run the layer**

Run: `python3 scripts/fetch-bangalore.py --layer dcurs-static; echo exit=$?`

This downloads 47 MB (GHS-POP) and 128 MB (WorldCover), and runs about 30 Sentinel-2 scene reads per ward. Allow up to about 30 minutes, using the Bash tool's timeout of 600000. If it exceeds that, re-run: every download and per-year Sentinel read is cached.

Expected: one line per ward, then `exit=0`.

**Record the three printed lines verbatim** for Task 8.

**Sanity checks.** If any of these fails, STOP and report:
- `popDensity` is between 5,000 and 80,000 per km².
- `far` is between 0.3 and 5.
- refuge distance is between 0 and 2000 m.
- NDVI is between 0.1 and 0.6, with 5 years.

- [ ] **Step 7: Confirm nothing else moved**

Run: `git status --porcelain | grep -v '^??'`
Expected: only `scripts/fetch-bangalore.py` is modified. `data/bangalore/dcurs-static.json` shows as untracked; stage it next.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-bangalore.py data/bangalore/dcurs-static.json
git commit -m "feat(bangalore): --layer dcurs-static measures population, FAR, refuge distance and NDVI

GHS-POP R2023A tile R8_C26 (confirmed to contain all three wards), FAR from
the shipped buildings at the fitted 3.33 m storey, WorldCover N12E075 refuge
distance and Sentinel-2 NDVI through Kolkata's own functions loaded by
importlib, not copied. <paste the three printed ward lines>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `--layer dcurs-lst`: ECOSTRESS scenes clear in all three wards

**Files:**
- Modify: `scripts/fetch-bangalore.py` (a constant, the layer function, `main()` dispatch)
- Create (generated): `data/bangalore/dcurs-lst-scenes.json`

**Split of work.** Steps 1–4 are code, done by the implementer. Step 5 is a multi-hour network run, done by the **controller** in the background, because an implementer that backgrounds a long job and waits has stalled for hours before. The implementer stops after Step 4 and reports.

- [ ] **Step 1: Add the constants**

Directly after `SENTINEL_YEARS = [...]` (Task 3), add:

```python
#: The rural reference box: 0.8 x 0.8 deg around the three wards, inside GHSL
#: tile R8_C26 and under _ecostress.MAX_STUDY_WIDTH_DEG (12), so one UTM zone (43N).
RURAL_BBOX = (77.22, 12.57, 78.02, 13.37)
ECOSTRESS_START = "2018-07-01"
```

- [ ] **Step 2: Add the layer**

Directly after `build_dcurs_static`, add:

```python
def run_dcurs_lst(wards: list[blr.Ward]) -> None:
    """--layer dcurs-lst: one row per ECOSTRESS acquisition, all wards and the rural reference.

    RESUMABLE: rows are saved every 10 acquisitions and on exit, and a re-run skips
    what is recorded. DISK-BOUNDED: each acquisition's newly downloaded bands are
    deleted once measured, so the cache never holds more than one scene.
    """
    import datetime as dt
    import numpy as np
    from rasterio.transform import rowcol
    from rasterio.warp import transform_bounds
    import _dcurs_blr as dc
    import _ecostress as eco

    smod_tif = tif_from_zip(cached_download(
        GHS_SMOD_URL, os.path.join(GEO_CACHE, "ghsl", os.path.basename(GHS_SMOD_URL))))
    tok = eco.token()
    if os.path.exists(dc.LST_PATH):
        with open(dc.LST_PATH, encoding="utf-8") as fh:
            doc = cast(dc.ScenesFile, json.load(fh))
    else:
        doc = {"source": ("NASA ECOSTRESS ECO_L2T_LSTE v002 via CMR/LP DAAC; rural reference = "
                          "GHS-SMOD R2023A tile R8_C26 classes 11/12/13"),
               "rural_bbox": list(RURAL_BBOX), "start": ECOSTRESS_START, "rows": [], "skipped": []}
    done = {f"{r['phase']} {r['utc']}" for r in doc["rows"]} | set(doc["skipped"])

    crs = eco.target_crs(RURAL_BBOX)
    tf, width, height = eco.target_grid(RURAL_BBOX)
    smod = eco.align(smod_tif, -200, "int16", bbox=RURAL_BBOX)
    masks: dict[str, Any] = {}
    for w in wards:
        west, south, east, north = transform_bounds("EPSG:4326", crs, *blr.bounds(w), densify_pts=21)
        r0, c0 = rowcol(tf, west, north)
        r1, c1 = rowcol(tf, east, south)
        m = np.zeros((height, width), dtype=bool)
        m[max(int(r0), 0):int(r1) + 1, max(int(c0), 0):int(c1) + 1] = True
        masks[w.id] = m

    def band(g: dict[str, Any], suffix: str, nodata: float, dtype: str) -> Any:
        p = eco.fetch(eco.band_url(g, suffix), tok)
        return eco.align(p, nodata, dtype, bbox=RURAL_BBOX) if p else None

    def save() -> None:
        with open(dc.LST_PATH, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))

    no_lst_in_a_row = 0
    end = dt.date.today().isoformat()
    for phase in ("day", "night"):
        acqs = eco.cmr_search(phase, ECOSTRESS_START, None, end, bbox=RURAL_BBOX)
        print(f"  {phase}: {len(acqs)} acquisitions since {ECOSTRESS_START}", flush=True)
        for n, (utc, grans) in enumerate(acqs, 1):
            key = f"{phase} {utc}"
            if key in done:
                continue
            before: set[str] = set(os.listdir(eco.CACHE)) if os.path.isdir(eco.CACHE) else set()
            cel: Any = None
            view: Any = None
            got_lst = False
            for g in grans:
                lst_k = band(g, "_LST.tif", np.nan, "float32")
                if lst_k is None:
                    continue
                got_lst = True
                c = dc.granule_celsius(lst_k, band(g, "_QC.tif", 0xFFFF, "uint16"),
                                       band(g, "_cloud.tif", 255, "uint16"),
                                       band(g, "_water.tif", 0, "uint16"))
                cel = dc.first_finite(cel, c)
                v = band(g, "_view_zenith.tif", np.nan, "float32")
                if v is not None:
                    view = dc.first_finite(view, v)
            if os.path.isdir(eco.CACHE):       # measured, then dropped: the disk never holds more than one scene
                for f in set(os.listdir(eco.CACHE)) - before:
                    os.remove(os.path.join(eco.CACHE, f))
            if not got_lst:
                no_lst_in_a_row += 1
                if no_lst_in_a_row >= 5:
                    save()
                    raise SystemExit(
                        "5 acquisitions in a row downloaded no LST band -- the Earthdata token at "
                        f"{eco.TOKEN_PATH} has probably expired; renew it at urs.earthdata.nasa.gov "
                        "and re-run (progress is saved)")
                continue
            no_lst_in_a_row = 0
            if not bool(np.isfinite(cel).any()):
                doc["skipped"].append(key)
            else:
                doc["rows"].append(dc.scene_row(utc, cast(dc.Phase, phase), cel, view, smod, masks))
            done.add(key)
            if n % 10 == 0:
                save()
                print(f"    {phase} {n}/{len(acqs)} · {len(doc['rows'])} rows", flush=True)
    save()
    th = dc.thermal(doc["rows"], [w.id for w in wards])
    first = next(iter(th.values()))
    print(f"  shared clear scenes: {first['dayScenes']} day, {first['nightScenes']} night "
          f"(gate {dc.MIN_SHARED_SCENES} per phase)")
```

- [ ] **Step 3: Wire the layer into `main()`**

Directly after the `dcurs-static` dispatch block (Task 3), add:

```python
    if a.layer == "dcurs-lst":
        print("DC-URS surface temperature (ECOSTRESS, scenes shared by all three wards):")
        run_dcurs_lst(wards)
```

- [ ] **Step 4: Gates, then stop and report (implementer)**

Run: `npm run typecheck`, `python3 scripts/fetch-bangalore.py --self-test` and `python3 scripts/_dcurs_blr.py`
Expected: all pass.

Commit the code ONLY:

```bash
git add scripts/fetch-bangalore.py
git commit -m "feat(bangalore): --layer dcurs-lst measures ECOSTRESS scenes per ward and rural reference

One aligned 70 m grid over a 0.8 deg box: each acquisition yields every ward's
clear fraction and mean plus the GHS-SMOD rural mean and view-angle delta.
Resumable, disk-bounded (bands deleted once measured), and it stops with a
token message after five acquisitions with no LST instead of recording skips.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Report `DONE` and do NOT run Step 5.

- [ ] **Step 5 (controller): Run the layer in the background**

Before running, check:
- `df -h /` shows at least 5 GB free;
- the token file is younger than 60 days (`stat -f '%Sm' ~/.config/delta-climate/earthdata-token`).

Run in the background (`run_in_background: true`):

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad && python3 scripts/fetch-bangalore.py --layer dcurs-lst > /private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad/dcurs-lst.log 2>&1; echo "exit=$?" >> /private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad/dcurs-lst.log
```

On completion, read the log's last lines. Expected: `shared clear scenes: <D> day, <N> night (gate 8 per phase)`.

If the log shows the token message, renew the token (ask the user) and re-run: progress is kept.

**Do not change any gate if a phase is under 8.** That phase ships as a placeholder, by design.

- [ ] **Step 6 (controller): Commit the scenes**

```bash
git add data/bangalore/dcurs-lst-scenes.json
git commit -m "data(bangalore): ECOSTRESS scenes for the resilience score

<D> day and <N> night acquisitions clear in all three wards, near-nadir, with
a rural reference (gate: 8 per phase). <paste the shared-scenes line>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Export the inputs file and the clamp report

**Files:**
- Modify: `scripts/export-bangalore-obos.py` (a new `export_dcurs`, called from `main()`)
- Create (generated): `data/bangalore/dc-urs-inputs.json`, `public/heat-map/data/bengaluru-dc-urs-inputs.json`

- [ ] **Step 1: Add `export_dcurs`**

Directly before `def main() -> int:`, add:

```python
def export_dcurs() -> str:
    """Bengaluru's DC-URS inputs: the committed source and the byte-identical served copy.

    fvc and albedo are copied from surface-meta.json, not recomputed: loadAreaSurface
    reads a DC-URS record FIRST, and the served texture is pinned to those means
    (tests/unit/heat-map-surface-measured.test.mjs), so any other value would put
    the map and the score on two different measurements.
    """
    import _dcurs_blr as dc
    if not (os.path.exists(dc.STATIC_PATH) and os.path.exists(dc.LST_PATH)):
        return ("  dc-urs       not built -- run fetch-bangalore.py --layer dcurs-static "
                "and --layer dcurs-lst first")
    with open(dc.STATIC_PATH, encoding="utf-8") as fh:
        static = cast(dc.StaticFile, json.load(fh))
    with open(dc.LST_PATH, encoding="utf-8") as fh:
        scenes = cast(dc.ScenesFile, json.load(fh))
    with open(os.path.join(OUT, "surface-meta.json"), encoding="utf-8") as fh:
        meta = cast(dict[str, Any], json.load(fh))["wards"]
    ids = list(blr.WARDS)
    th = dc.thermal(scenes["rows"], ids)
    refusal = dc.night_suhii_refusal(th)
    if refusal:
        raise SystemExit(refusal)
    surface = {w: (float(meta[w]["fvc_mean"]), float(meta[w]["albedo_mean"])) for w in ids}
    doc = dc.assemble(th, static["wards"], surface)
    blob = json.dumps(doc, indent=2)
    for dst in (dc.SOURCE_PATH, os.path.join(OUT, dc.SERVED_NAME)):
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(blob)
    lines = [f"  dc-urs       {th[ids[0]]['dayScenes']} day / {th[ids[0]]['nightScenes']} night shared scenes"]
    for w in ids:
        t = th[w]
        lines.append(f"    {w:<12} day {t['lstDayC']} C · night {t['lstNightC']} C · "
                     f"heat island day {t['suhiiDayC']} / night {t['suhiiNightC']} C")
        for s in dc.clamps(doc["wards"][w]):
            lines.append(f"      CLAMP {s}")
    return "\n".join(lines)
```

- [ ] **Step 2: Call it from `main()`**

In `main()`, directly before `print(f"  written to {os.path.relpath(OUT, blr.ROOT)}/")`, add:

```python
    print(export_dcurs())
```

- [ ] **Step 3: Gates**

Run: `npm run typecheck`
Expected: `Success`.

- [ ] **Step 4: Run the exporter**

Run: `python3 scripts/export-bangalore-obos.py; echo exit=$?`

Expected:
- the usual ward lines;
- a `dc-urs` line;
- one line per ward;
- any `CLAMP` lines;
- `exit=0`.

**Record this output verbatim** for Task 8. If it exits with the night heat-island refusal, STOP and report: that is the pre-registered gate working, not something to loosen.

- [ ] **Step 5: Confirm exactly what changed, and that Kolkata did not**

Run:

```bash
git status --porcelain | grep -v '^??'
git status --porcelain --untracked-files=all | grep -E "dc-urs-inputs|bengaluru-dc-urs"
git diff --quiet -- data/dc-urs public/heat-map/data/dc-urs-inputs.json && echo "Kolkata inputs untouched"
cmp data/bangalore/dc-urs-inputs.json public/heat-map/data/bengaluru-dc-urs-inputs.json && echo "source == served"
```

Expected:
- the only modified tracked file is `scripts/export-bangalore-obos.py`, since every other served Bengaluru file is byte-identical;
- the two new inputs files are listed as untracked;
- `Kolkata inputs untouched`;
- `source == served`.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-bangalore-obos.py data/bangalore/dc-urs-inputs.json public/heat-map/data/bengaluru-dc-urs-inputs.json
git commit -m "feat(bangalore): export the DC-URS inputs file and its clamp report

Twelve indicators per ward; socioVuln and canopyFrac placeholders; fvc/albedo
copied from surface-meta.json so the map and the score share one measurement.
Kolkata's inputs untouched. <paste the dc-urs block, including CLAMP lines>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Point the registry at it, check it at build, test it

**Files:**
- Modify: `src/scripts/climate-engine/scope/registry.ts:193` (Bengaluru's `data`)
- Modify: `scripts/verify-served-data.mjs` (append a Bengaluru check)
- Create: `tests/unit/bangalore-dc-urs.test.mjs`
- Modify: `tests/unit/obos-scope.test.mjs:164-174`
- Modify: `tests/unit/heat-map-surface-measured.test.mjs` (add one test after the line-160 test)

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/unit/bangalore-dc-urs.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ANCHORS, SCORE_WEIGHT, unmeasured } from '../../src/scripts/climate-engine/dc-urs.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BENGALURU = ['indiranagar', 'mg-road', 'whitefield'];
const SERVED = 'public/heat-map/data/bengaluru-dc-urs-inputs.json';
const text = (p) => readFile(join(ROOT, p), 'utf8');
const json = async (p) => JSON.parse(await text(p));

test('the served Bengaluru inputs are the committed source, byte for byte', async () => {
  assert.equal(await text(SERVED), await text('data/bangalore/dc-urs-inputs.json'));
});

test('every Bengaluru ward carries all twelve indicators, with provenance and in-range values', async () => {
  const { wards } = await json(SERVED);
  assert.deepEqual(Object.keys(wards).sort(), [...BENGALURU].sort());
  const range = {
    lstDayC: [0, 70], lstNightC: [0, 50], ruralBaseC: [0, 70], popDensity: [0, 200_000],
    far: [0, 10], socioVuln: [0, 10], fvc: [0, 1], canopyFrac: [0, 1], ndviMean: [-1, 1],
    ndviStd: [0, 1], albedo: [0, 1], distCoolM: [0, 5000],
  };
  for (const w of BENGALURU) {
    assert.deepEqual(Object.keys(wards[w]).sort(), Object.keys(SCORE_WEIGHT).sort(), `${w}: field set`);
    for (const [k, f] of Object.entries(wards[w])) {
      assert.ok(['measured', 'modelled', 'estimated', 'placeholder'].includes(f.source), `${w}.${k}: ${f.source}`);
      assert.ok(Number.isFinite(f.value) && f.value >= range[k][0] && f.value <= range[k][1],
        `${w}.${k}: ${f.value} out of range`);
      if (f.source === 'placeholder') assert.equal(f.value, 0, `${w}.${k}: a placeholder sits at 0`);
      else assert.ok(f.vintage && f.cite, `${w}.${k}: a measured value needs a vintage and a cite`);
    }
  }
});

test('heat vulnerability ships unmeasured, and the chip counts its full weight', async () => {
  const { wards } = await json(SERVED);
  for (const w of BENGALURU) {
    assert.equal(wards[w].socioVuln.source, 'placeholder', `${w}: socioVuln`);
    const gap = unmeasured(wards[w]);
    assert.ok(gap.fields.includes('socioVuln'), `${w}: chip must name socioVuln`);
    assert.ok(gap.points >= 8.75 - 1e-9, `${w}: ${gap.points} pts`);
  }
});

test('a measured heat island discloses its effective baseline', async () => {
  const { wards } = await json(SERVED);
  for (const w of BENGALURU) {
    const rb = wards[w].ruralBaseC;
    if (rb.source !== 'placeholder') assert.match(rb.cite, /EFFECTIVE/, `${w}: baseline construction`);
  }
});

test('the Python clamp report reads the same anchors as the engine', async () => {
  const py = await text('scripts/_dcurs_blr.py');
  const start = py.indexOf('ANCHORS: dict[str, float] = {');
  const block = py.slice(start, py.indexOf('}', start));
  const pairs = [...block.matchAll(/"(\w+)":\s*([\d_.]+)/g)];
  assert.ok(pairs.length >= 8, 'no anchors parsed from _dcurs_blr.py');
  for (const [, k, v] of pairs) assert.equal(Number(v.replaceAll('_', '')), ANCHORS[k], k);
});

test("Kolkata's inputs file gains no Bengaluru ward", async () => {
  const { wards } = await json('public/heat-map/data/dc-urs-inputs.json');
  assert.deepEqual(Object.keys(wards).sort(), ['ballygunge', 'barrackpore', 'baruipur']);
});
```

(b) In `tests/unit/obos-scope.test.mjs`, inside `test('city-level files are city-scoped, not global', ...)`, add directly before `assert.equal(cityPaths('ae/dubai/al-quoz').heatwave, null);`:

```js
  assert.equal(cityPaths('in/bengaluru/mg-road').dcUrs,
    '/heat-map/data/bengaluru-dc-urs-inputs.json');
  assert.equal(cityPaths('in/bengaluru/mg-road').heatwave, null);
```

(c) In `tests/unit/heat-map-surface-measured.test.mjs`, directly after the closing `});` of `test('no ward carries both a DC-URS scalar and a measured level', ...)`, add:

```js
/* BENGALURU HAS BOTH, DELIBERATELY. loadAreaSurface takes a DC-URS record first,
   so Bengaluru's record carries its measured surface means VERBATIM: the map and
   the score then read one measurement, and the texture's pinned means still hold. */
test("Bengaluru's DC-URS vegetation and albedo are its measured surface means, exactly", async () => {
  const blr = JSON.parse(await readFile(join(DATA, 'bengaluru-dc-urs-inputs.json'), 'utf8')).wards;
  for (const ward of ['indiranagar', 'mg-road', 'whitefield']) {
    assert.equal(blr[ward].fvc.value, meta[ward].fvc_mean, `${ward}: fvc`);
    assert.equal(blr[ward].albedo.value, meta[ward].albedo_mean, `${ward}: albedo`);
  }
});
```

- [ ] **Step 2: Run them and see the registry assertion fail**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs tests/unit/bangalore-dc-urs.test.mjs tests/unit/heat-map-surface-measured.test.mjs`
Expected: `city-level files are city-scoped, not global` FAILS (actual `null`). The other new tests pass, because the file exists from Task 5.

- [ ] **Step 3: Point the registry at the file**

In `src/scripts/climate-engine/scope/registry.ts`, in Bengaluru's entry, change:

```ts
        data: { heatwave: null, dcUrs: null },
```

to:

```ts
        /* DC-URS inputs are Bengaluru's own file, never rows in Kolkata's:
           verify-served-data.mjs requires a layers manifest for every ward in
           dc-urs-inputs.json, and Bengaluru ships none yet. Heatwave percentiles
           stay null — none are measured for this city. */
        data: { heatwave: null, dcUrs: 'bengaluru-dc-urs-inputs' },
```

- [ ] **Step 4: Check the pair at build time**

Append to the end of `scripts/verify-served-data.mjs`:

```js

// Bengaluru's inputs: its own file pair, written together by export-bangalore-obos.py.
// No layer manifests are required here — the registry keeps Bengaluru shipsData: false.
const BLR_SOURCE = 'data/bangalore/dc-urs-inputs.json';
const BLR_SERVED = 'public/heat-map/data/bengaluru-dc-urs-inputs.json';
for (const p of [BLR_SOURCE, BLR_SERVED]) if (!existsSync(p)) die(`${p} is missing.`);
if (readFileSync(BLR_SOURCE, 'utf8') !== readFileSync(BLR_SERVED, 'utf8'))
  die(`${BLR_SERVED} is STALE against ${BLR_SOURCE}.\n`
    + `    Fix: python3 scripts/export-bangalore-obos.py   (it writes both)`);
console.log(`  ✓ served Bengaluru DC-URS inputs match ${BLR_SOURCE}`);
```

- [ ] **Step 5: Run the tests and gates until they pass**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs tests/unit/bangalore-dc-urs.test.mjs tests/unit/heat-map-surface-measured.test.mjs`
Expected: `fail 0`.

Run: `node scripts/verify-served-data.mjs; echo exit=$?`
Expected: `✓ served Bengaluru DC-URS inputs match data/bangalore/dc-urs-inputs.json` and `exit=0`.

Run: `npm run check` and `npm run test:unit`
Expected: `0 errors`, `fail 0`.

- [ ] **Step 6: Mutation proofs (paste each FAIL and the restored PASS)**

1. Append a space to the end of `public/heat-map/data/bengaluru-dc-urs-inputs.json`. Expected:
   - `verify-served-data.mjs` exits 1 with `STALE`;
   - the byte-for-byte unit test fails.

   Restore it with `python3 scripts/export-bangalore-obos.py`.
2. In `data/bangalore/dc-urs-inputs.json` and the served copy, change one ward's `fvc.value` by `+0.001` (both files, so the pair stays equal). Expected: `...are its measured surface means, exactly` fails. Restore by re-exporting.
3. In `_dcurs_blr.py`, change `"uhiSpan": 10.0` to `11.0`. Expected: `the Python clamp report reads the same anchors as the engine` fails. Revert.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/scope/registry.ts scripts/verify-served-data.mjs tests/unit/bangalore-dc-urs.test.mjs tests/unit/obos-scope.test.mjs tests/unit/heat-map-surface-measured.test.mjs
git commit -m "feat(bangalore): the resilience score reads Bengaluru's own inputs file

Registry dcUrs -> bengaluru-dc-urs-inputs; the build refuses a stale served
copy; tests pin the twelve indicators, the unmeasured socio weight (8.75 pts),
the effective-baseline disclosure, the Python/engine anchor mirror, Kolkata's
file unchanged, and fvc/albedo equal to the pinned surface means. Each proven.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: A Bengaluru ward shows its score in the browser

**Files:**
- Create: `tests/e2e/heat-map-bengaluru-resilience.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

/**
 * A BENGALURU WARD SHOWS A RESILIENCE SCORE, AND SAYS WHAT IT DOES NOT KNOW.
 *
 * Before this plan every Bengaluru ward read "resilience inputs unavailable":
 * the registry declared no inputs file. The unit tests prove the file and the
 * URL; only a browser proves the pane actually renders a number from them.
 * socioVuln ships unmeasured, so the confidence chip must be showing.
 */
test('MG Road shows a resilience score and its confidence chip', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));

  await page.goto('/heat-map/in/bengaluru/mg-road/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });

  await expect(page.locator('#scoreNum')).toHaveText(/^\d{1,3}$/, { timeout: 60_000 });
  await expect(page.locator('#scoreTxt')).not.toContainText('resilience inputs unavailable');
  const chip = page.locator('#scoreConf');
  await expect(chip).not.toHaveAttribute('hidden');
  await expect(chip).toContainText('pts lower');

  expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 2: Build, then run it (foreground, temporary chrome config)**

Run: `npm run build`
Then: `npx playwright test -c .pw-chrome.config.ts tests/e2e/heat-map-bengaluru-resilience.spec.ts --project=chromium-tier0 --retries=0 --reporter=line`

Use the Bash tool's timeout (600000), and allow two attempts at most. Expected: `1 passed`.

- [ ] **Step 3: Mutation proof**

Temporarily set Bengaluru back to `dcUrs: null` in `registry.ts`, rebuild, and re-run. Expected: FAIL on `#scoreNum` (it stays `—`). Revert, rebuild, and re-run for a PASS.

Delete `.pw-chrome.config.ts`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/heat-map-bengaluru-resilience.spec.ts
git commit -m "test(e2e): a Bengaluru ward renders its resilience score and confidence chip

Proven by reverting the registry to dcUrs: null (the score stays a dash).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Evidence and limitations, with the measured numbers

**Files:**
- Modify: `docs/evidence/known-limitations.md` (append §14)
- Modify: `docs/evidence/data-sources.md` (append a Bengaluru DC-URS block)
- Modify: `docs/dc-urs-spec.md` (append a Bengaluru section)

- [ ] **Step 1: Append §14 to `docs/evidence/known-limitations.md`**

Append after the last section, using the file's existing `---` separator convention. Fill every `<…>` from the output recorded in Tasks 3, 4 and 5; nothing may be estimated.

```markdown
---

## 14. Bengaluru's resilience score: what is measured, what is borrowed, what is missing

Bengaluru's DC-URS inputs are per ward (spec `docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md`), but three things limit what the score can say.

**Heat vulnerability is unmeasured (up to 8.75 points).** No commercially clear ward-level source exists:
- **District and parliamentary-constituency data.** These are identical for all three wards (Bengaluru Urban, Bangalore Central).
- **WorldPop R2025A age/sex (CC BY 4.0).** It spreads India's age structure from state-level inputs, so every Karnataka pixel reads 65+ = 8.024 % and under-5 = 6.673 %, measured 2026-09-14.
- **Census 2011 BBMP ward tables.** These would discriminate, but the catalogue is marked "All Rights Reserved" and the houselisting copies carry uploader-set labels.

The score is therefore shown at its best case and the chip says so. A written request to ORGI for commercial use is the open route.

**The anchors are Kolkata's, and these Bengaluru terms clamp against them:**

<paste every CLAMP line from Task 5 Step 4, one bullet each; or "No term clamps." if there were none>

**The thermal inputs come from scenes clear in all three wards at once:**
- <D> day and <N> night scenes, near-nadir, with a GHS-SMOD rural reference.
- The heat island is the median of per-scene differences.
- `ruralBaseC` is an *effective* baseline (`lstDayC` minus that median), so the unchanged engine reproduces it.
- <If a phase had fewer than 8 scenes: "The <phase> fields ship as placeholders under the pre-registered 8-scene gate.">

**Vegetation cover and albedo use the map's reduction, not Kolkata's.**
- Bengaluru's `fvc` and `albedo` are the per-cell Sentinel-2 composite means already served in `surface-meta.json`: the per-cell median over 2021–2025, then the spatial mean.
- Kolkata's `sentinel.json` reduces per scene, then per year.
- They are copied verbatim because the map reads the DC-URS record first. A recomputed value would put the texture and the score on different measurements.
```

- [ ] **Step 2: Append to `docs/evidence/data-sources.md`**

```markdown
**Bengaluru DC-URS inputs (2026-09-15)** — `data/bangalore/dcurs-static.json`, `dcurs-lst-scenes.json`, `dc-urs-inputs.json`:

| Source | Licence | Detail |
|---|---|---|
| JRC GHS-POP R2023A (E2020, 100 m) | CC BY 4.0 | Tile `R8_C26` |
| JRC GHS-SMOD R2023A (1 km) | CC BY 4.0 | Tile `R8_C26`; contains all three ward centres, each class 30 |
| ESA WorldCover 2021 (10 m) | CC BY 4.0 | Tile `N12E075` |
| Sentinel-2 L2A | Copernicus | via earth-search, NDVI 2021–2025 |
| NASA ECOSTRESS L2T LSTE v002 | US public domain | via CMR / LP DAAC, <D> day / <N> night shared scenes since 2018-07-01 |

Per-ward results: <paste the three Task 3 lines>.
```

- [ ] **Step 3: Append to `docs/dc-urs-spec.md`**

```markdown
## Bengaluru (2026-09)

- **Engine.** Bengaluru is scored by the same engine and anchors from its own inputs file, `public/heat-map/data/bengaluru-dc-urs-inputs.json`. It is built by `fetch-bangalore.py --layer dcurs-static|dcurs-lst` and `export-bangalore-obos.py`, with the rules in `scripts/_dcurs_blr.py`.
- **What differs from Kolkata's inputs:**
  - per-ward thermal values from shared scenes;
  - the heat island as a median of differences;
  - unmeasured heat vulnerability;
  - vegetation and albedo from the served surface raster.
- **Sliders.** Slider gains scale by `(1400 / sizeM)²`.
- **Limitations.** See `docs/evidence/known-limitations.md` §14.
```

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/known-limitations.md docs/evidence/data-sources.md docs/dc-urs-spec.md
git commit -m "docs(evidence): Bengaluru resilience score — sources, clamp report, limitations

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final verification

**Files:** none are changed.

- [ ] **Step 1: Every gate**

| Command | Expected |
|---|---|
| `npm run check` | `0 errors` |
| `npm run typecheck` | `Success` |
| `npm run test:unit` | `fail 0` |
| `npm run test:py` | exit 0; includes `_dcurs_blr self-test OK` |
| `python3 scripts/check-bangalore-artefacts.py; echo $?` | `0` |
| `python3 scripts/check-bangalore-frame.py; echo $?` | `0` |
| `npm run build` | completes; prints both "served … match" lines |
| e2e (temporary chrome config): `heat-map-bengaluru-resilience`, `heat-map-second-city`, `solar-pane` | all pass |

- [ ] **Step 2: Kolkata is byte-identical**

Run: `git diff --quiet origin/main -- data/dc-urs public/heat-map/data/dc-urs-inputs.json && echo "Kolkata DC-URS inputs identical to main"`
Expected: that line prints.

- [ ] **Step 3: Report**

Report:
- every gate result;
- the three `dcurs-static` lines;
- the shared-scene counts;
- the per-ward thermal lines and every `CLAMP` line;
- MG Road's rendered score, read from the e2e page or a screenshot;
- anything that deviated from this plan.

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Bengaluru only; engine and Kolkata unchanged | 5 (Kolkata diff), 6 (separate file), 9 |
| ECOSTRESS day and night, near-nadir, cloud/QC/water masks, 10 % clear | 1 (`granule_celsius`, `shared`), 4 |
| Scenes shared by all three wards; absolute °C medians | 1 (flip test), 4 |
| Heat island = median of per-scene differences; effective baseline disclosed | 1, 5, 6 |
| Gates: ≥ 8 scenes (else placeholder); night heat island > 2.5 °C refuses | 1, 5 |
| Anchor clamp report, recorded | 1 (`clamps`), 5, 8 |
| popDensity GHS-POP; FAR at 3.33 m; distCoolM WorldCover; NDVI Sentinel-2 | 3 |
| fvc/albedo from `surface-meta.json` (method check resolved: copied, difference recorded) | 5, 6, 8 |
| socioVuln placeholder; chip up to 8.75 pts; reasons documented | 1, 6, 8 |
| Served file byte-identical to source, checked at build | 5, 6 |
| Sliders scale by `(1400/sizeM)²`; Kolkata ×1 | 2 |
| `assertDcUrsLogic`/`assertScenarioLogic` wired into tests | 2 |
| Registry `dcUrs` non-null for Bengaluru | 6 |
| Browser shows score and chip | 7 |
| Docs: data-sources, known-limitations, DC-URS doc | 8 |

**Resolved against measured code (not in the spec text):**
- The spec said to check the Sentinel-2 method and "otherwise recompute". The code shows the map reads the DC-URS record first, with the texture pinned. So the values are **copied**, and the method difference is documented.
- A separate city file, not rows in Kolkata's, is required by `verify-served-data.mjs`.

**Placeholder scan.** The only fill-ins are measured outputs, each naming the step that produces it:
- Task 3 Step 6: the ward lines;
- Task 4 Step 5: the scene counts;
- Task 5 Step 4: the thermal and CLAMP lines.

**Type consistency.** These names match across Tasks 1, 3, 4 and 5:
- `StaticWard` keys: `popDensity`, `population`, `far`, `storeyM`, `distCoolM`, `ndviMean`, `ndviStd`, `ndviYears`.
- `SceneRow` / `ScenesFile`.
- `STATIC_PATH`, `LST_PATH`, `SOURCE_PATH`, `SERVED_NAME`.
