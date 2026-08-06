# ICESat-2 Building-Height Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the shipped building heights in distribution (never per building) against ICESat-2 ATL03 photon transects; audit the 2.5 m Google fill cohort; propagate any correction into FAR; publish the verdict in `accuracy.ts` with guards.

**Architecture:** One network script (`fetch-icesat2.py`) downloads granules to a cache outside the repo, subsets them to ~200 KB committed JSONs, and self-checks the geoid conversion. All analysis (`measure-height-accuracy.py`, `compute-far.py --icesat2-correction`) runs offline from those subsets. Pure geometry/statistics live in `scripts/_icesat2.py` with an assert-based self-test, mirroring the `_physics.py`/`_types.py` pattern. Task 3 is a **gate**: if ground and roof photons are not separable on the best track, the workstream stops and publishes `not_separable`.

**Tech Stack:** Python 3 (numpy, scipy, shapely 2.1, matplotlib — all installed; **h5py is the one new install**), requests for CMR/NSIDC, node test runner for the `accuracy.ts` guards.

**Spec:** `docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md` — read it first; the verdict thresholds and honesty rules there are binding.

**Security (binding, from project rules):** the Earthdata token lives at `~/.config/delta-climate/earthdata-token` (0600, gitignored), is read ONLY via `_ecostress.token()`, and is never printed, embedded, or referenced by repo path in committed code. Raw granules (~168 MB) go to `~/.cache/delta-climate/icesat2/`, never into the repo.

**File map:**

| File | Role |
|---|---|
| Create `scripts/_icesat2.py` | Pure helpers: local frame, along-track axis, ground line, footprint assignment, height estimates, bootstrap, geoid check. Self-test in `__main__` |
| Create `scripts/fetch-icesat2.py` | CMR search → cached download → beam subset → geoid known-answer check → `data/calibration/icesat2/<ward>-<yyyymmdd>-<rgt>.json` |
| Create `scripts/diagnose-icesat2-transect.py` | Task-0 gate: diagnostic PNG + PASS/FAIL verdict |
| Create `scripts/measure-height-accuracy.py` | Subsets + footprints + shipped heights → `data/calibration/icesat2-heights.json` |
| Modify `scripts/compute-far.py` | `--icesat2-correction` mode → `data/calibration/far-icesat2-sensitivity.json` |
| Modify `src/scripts/climate-engine/accuracy.ts` | `HEIGHTS` block + guards in `assertAccuracyLogic` |
| Modify `tests/unit/heat-map-accuracy.test.mjs` | HEIGHTS-matches-artefact test |
| Modify `src/scripts/climate-engine/heat-map-app.ts` | one-line tooltip on the card's `bcH` height row |
| Modify `docs/heat-map-feature.md` | method + result section |

**Repo facts the code below leans on (verified 2026-08-06):**
- `data/geometry/<ward>-footprints.json`: `{ward, release, count, source, skipped, b:[{gers, p:[x1,y1,…], lonlat:[[lon,lat],…]}]}` — `p` is ward metres, +y north.
- `public/heat-map/data/<ward>.json`: `b:[[height_m, x1,y1,…]]` — **index-aligned with the footprints file** (verified 200/200 first-vertex match). Height column 0; 2.5 exactly = the Google fill (465/597/629 rows per ward).
- `public/heat-map/data/<ward>-terrain.json`: `medianM` (e.g. 10.6 for Ballygunge) is SRTM-derived orthometric elevation — the geoid check's reference.
- `scripts/_types.py`: `WARDS`, `Ward(id, centre: LatLon, footprint_m)`, `m_per_deg(lat)`, `ward_bounds(w, pad_m)`.
- `scripts/_ecostress.py`: `token()` exits with a message if the token file is missing.
**COVERAGE — measured 2026-08-06, and it corrects this plan's original premise.**

The "closest track, 79 m from Ballygunge centre" written into the first draft was **wrong**.
It came from the granule's CMR bounding polygon, which spans the whole six-beam swath, not
from where the lasers actually landed. That granule's nearest strong beam is **6.27 km**
from Ballygunge and it yields zero photons in the box — running the original Task 3 Step 1
returns `0 confident photons in the box — rejected`, correctly.

Two structural facts settle what coverage really exists, both cheap to check and neither
requiring a download:

1. **118 granules are only 3 distinct ground tracks** (0416, 0744, 0858). ICESat-2 repeats
   its reference ground tracks every 91 days, so extra granules are repeat passes of the
   SAME line, never new geometry. Track number is characters 22–25 of the granule name.
2. **Beam positions per track**, read over HTTP range requests via
   `fsspec` + `h5py` (a few MB of each 168 MB file — the `geolocation/` arrays only).
   **Empty segments must be excluded first**: they carry placeholder
   `reference_photon_lat/lon` on a shared line ~11 km away, which is what made the naive
   distance wrong.

Result — every ward has a strong-beam crossing. Reproduce with
`python3 scripts/icesat2-coverage.py` → `data/calibration/icesat2-coverage.json`:

| ward | track | beam | closest approach to centre | photons in 900 m, one pass |
|---|---|---|---|---|
| ballygunge | **0416** | gt2r | **208 m** | 1,911 |
| ballygunge | 0416 | gt2l | 291 m | 718 |
| barrackpore | **0744** | gt1l | **650 m** | 5,548 |
| barrackpore | 0744 | gt1r | 570 m | 3,607 |
| baruipur | **0744** | gt2l | **658 m** | 3,247 |

Track 0858 reaches no ward (4.2 km at best) and can be ignored entirely.

**Strong/weak is NOT fixed per beam — it flips between passes of the same track.** Which
side of a pair is strong follows spacecraft orientation, which reverses periodically, so
gt2r is strong on some RGT 0416 passes and gt2l on others. This is why
`fetch-icesat2.py` reads `atlas_beam_type` per granule rather than assuming. It is good
news: both members of a crossing pair are 90 m apart and **both cross the ward**, so every
pass contributes a crossing STRONG beam whichever way it flipped, and the two lines sample
slightly different buildings.

**The consequence for the n ≥ 30 bar is favourable and changes the sweep's logic.** Because
each track repeats, ~20 passes cross the SAME buildings. That does not add new buildings —
the crossed set is fixed by three beam lines — but it stacks photons on each one, so
buildings that fail `MIN_ROOF_PH = 5` on a single pass can clear it once passes are pooled.
Task 5's sweep is therefore about **pooling passes on these three tracks**, not about
finding more tracks. There are no more tracks.

**Gate granule (Task 3):** `ATL03_20260110152208_04163007_007_01.h5` — RGT 0416 over
Ballygunge, 2026-01-10, dry season (January avoids the monsoon cloud that starves the
May granule). Auth proven; the download is ~168 MB.

---

### Task 1: `scripts/_icesat2.py` — pure logic + self-test

**Files:**
- Create: `scripts/_icesat2.py`

The self-test IS the failing test: write the module with the self-test calling functions that raise `NotImplementedError`, watch it fail, then implement. Every function here is offline-testable geometry/statistics; nothing touches the network.

- [ ] **Step 1: Write the module skeleton with the full self-test and stub functions**

```python
"""Pure geometry and statistics for the ICESat-2 height validation.

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md

WHY THE GROUND LINE USES ONLY OUT-OF-FOOTPRINT PHOTONS. A naive rolling
lower-quantile over ALL photons fails in exactly the place this city is dense:
under a building wider than the window, every photon in the window is roof, the
"ground" line rides the roof, and height-above-ground collapses to zero. We have
the footprints, so ground candidates are photons outside every footprint dilated
by the geolocation error, and the line is interpolated across the gaps.

WHY EROSION, NOT A NEAREST-BUILDING MATCH. ATL03 horizontal geolocation is
~3-5 m against 10-20 m buildings, so a photon near an edge may belong to the
street or the neighbour. Photons only count as roof if they fall INSIDE a
footprint eroded by ERODE_M — buildings too small to survive erosion are
excluded and COUNTED, because a silent drop would read as coverage.

WHY p75 PER BUILDING. Roof photon sets include edge scatter downward (walls,
overhangs); an upper quantile resists it without chasing the single highest
photon, which may be noise.

    python3 scripts/_icesat2.py        # self-test, exits non-zero on failure
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _types import F64, Ward, m_per_deg  # noqa: E402

#: Footprint erosion for roof assignment / dilation for ground exclusion, metres.
#: The ATL03 horizontal geolocation error class. Spec §5.2.
ERODE_M = 5.0
#: Rolling window width for the ground line, metres. Spec §5.2.1.
GROUND_WIN_M = 30.0
#: Lower quantile that defines "ground" inside a window.
GROUND_Q = 0.10
#: Height-above-ground band accepted as roof, metres. Below 2 m is street
#: furniture and misclassified ground; above 120 m is taller than anything in
#: these wards and is treated as noise.
ROOF_BAND_M = (2.0, 120.0)
#: Minimum roof photons before a building contributes a height estimate.
MIN_ROOF_PH = 3
#: One storey, metres — the same 3.2 m the FAR pipeline assumes.
STOREY_M = 3.2


def to_local(w: Ward, lon: F64, lat: F64) -> tuple[F64, F64]:
    """Degrees → ward metres, +x east +y north, the footprints' `p` frame."""
    m = m_per_deg(w.centre.lat)
    return (lon - w.centre.lon) * m.east, (lat - w.centre.lat) * m.north


def along_track(x: F64, y: F64) -> F64:
    """Signed metres along the track's principal axis. ATL03's own
    dist_ph_along resets per granule region; a PCA axis needs no field."""
    raise NotImplementedError


def ground_line(s_all: F64, s_gnd: F64, h_gnd: F64,
                win_m: float = GROUND_WIN_M, q: float = GROUND_Q) -> F64:
    """Orthometric ground surface evaluated at every photon's s, from
    ground-candidate photons only, rolling lower-quantile, gaps interpolated."""
    raise NotImplementedError


def assign_footprints(px: F64, py: F64, rings: list[list[float]],
                      buffer_m: float) -> tuple[npt.NDArray[np.int64], list[int]]:
    """Which footprint contains each photon, after buffering every ring by
    buffer_m (negative erodes, positive dilates). Returns (per-photon footprint
    index, -1 = none; list of footprint indices that survived the buffer)."""
    raise NotImplementedError


def building_heights(bldg_idx: npt.NDArray[np.int64], hag: F64,
                     min_ph: int = MIN_ROOF_PH) -> dict[int, float]:
    """Per-building p75 of roof-band height-above-ground. Only buildings with
    >= min_ph photons in ROOF_BAND_M. Used to build the transect distribution,
    NEVER published per building (spec §5.2.4)."""
    raise NotImplementedError


def quantile_bias(ours: F64, theirs: F64, rng: np.random.Generator,
                  boots: int = 10_000) -> dict[str, object]:
    """median/p65/p90 of (ours - theirs) as paired per-building resamples, with
    bootstrap 95% CIs and a two-sample KS p-value. Paired resampling keeps the
    building-level correlation the two distributions share."""
    raise NotImplementedError


def check_geoid(ground_ortho_m: float, dem_median_m: float, geoid_n_m: float) -> None:
    """Two-sided known-answer check (spec §5.1). Raises AssertionError unless
    BOTH hold: converted ground within ±5 m of the DEM, AND the unconverted
    (ellipsoidal) value misses by 40-70 m. A check that also fails on the
    unconverted data cannot pass by accident."""
    raise NotImplementedError


# ── self-test ───────────────────────────────────────────────────────────────
def _self_test() -> None:
    rng = np.random.default_rng(7)
    n = 8000
    s_true = rng.uniform(-700.0, 700.0, n)
    ground_true = 6.0 + 0.002 * s_true          # gentle ramp, Kolkata-like relief
    h = ground_true + rng.normal(0.0, 0.25, n)  # ground photons + ranging noise

    # Two synthetic roofs. Building A: s in [100, 140] at +12 m — WIDER than the
    # 30 m ground window, the exact case a naive rolling quantile gets wrong.
    # Building B: s in [300, 330] at +30 m.
    in_a = (s_true > 100) & (s_true < 140)
    in_b = (s_true > 300) & (s_true < 330)
    h[in_a] = ground_true[in_a] + 12.0 + rng.normal(0.0, 0.3, int(in_a.sum()))
    h[in_b] = ground_true[in_b] + 30.0 + rng.normal(0.0, 0.3, int(in_b.sum()))

    # along_track recovers a rotated axis to within sign
    theta = 0.37
    x = s_true * math.cos(theta) + rng.normal(0.0, 1.0, n)
    y = s_true * math.sin(theta) + rng.normal(0.0, 1.0, n)
    s = along_track(x, y)
    r = abs(float(np.corrcoef(s, s_true)[0, 1]))
    assert r > 0.9999, f"along_track axis wrong: |r|={r:.5f}"

    # ground line from out-of-roof candidates only; must NOT ride the wide roof
    gnd = ~(in_a | in_b)
    g = ground_line(s_true, s_true[gnd], h[gnd])
    err = np.abs(g - ground_true)
    assert float(np.median(err[gnd])) < 0.5, "ground line off in the open"
    assert float(np.median(err[in_a])) < 1.0, \
        "ground line rides the wide roof — the failure the docstring names"

    hag = h - g
    assert 10.5 < float(np.median(hag[in_a])) < 13.5, "roof A height wrong"
    assert 28.0 < float(np.median(hag[in_b])) < 32.0, "roof B height wrong"

    # assignment: square roofs matching the two buildings, plus an 8 m building
    # that MUST be dropped by 5 m erosion (8 - 2*5 < 0)
    ring = lambda x0, x1, y0, y1: [x0, y0, x1, y0, x1, y1, x0, y1]
    rings = [ring(100, 140, -20, 20), ring(300, 330, -20, 20), ring(0, 8, 0, 8)]
    # photons in the rings' frame: s directly as x, 0 as y (the track centreline)
    idx, kept = assign_footprints(s_true, np.zeros(n), rings, -ERODE_M)
    assert 2 not in kept, "8 m building survived 5 m erosion"
    assert set(np.unique(idx[in_a & (idx >= 0)])) <= {0}
    assert set(np.unique(idx[in_b & (idx >= 0)])) <= {1}
    # eroded interior only: photons within 5 m of the roof edge stay unassigned
    edge = (s_true > 100) & (s_true < 104.9)
    assert np.all(idx[edge] == -1), "erosion did not exclude the edge band"

    est = building_heights(idx, hag)
    assert set(est) <= {0, 1}
    assert 11.0 < est[0] < 13.5 and 29.0 < est[1] < 31.5

    # bootstrap: a known +2 m bias is recovered with a CI that excludes zero
    theirs = rng.normal(10.0, 4.0, 60)
    ours = theirs + 2.0 + rng.normal(0.0, 0.5, 60)
    qb = quantile_bias(ours, theirs, np.random.default_rng(11))
    assert 1.5 < qb["median_bias_m"] < 2.5
    lo, hi = qb["ci95_m"]
    assert lo > 0.0, "CI fails to exclude zero on a real bias"

    # geoid: passes only when BOTH sides hold
    check_geoid(10.4, 10.6, -55.0)                     # converted ≈ DEM ✓
    for bad in ((65.4, 10.6, -55.0),                   # forgot to convert
                (10.4, 10.6, -3.0)):                   # constant absurdly small
        try:
            check_geoid(*bad)
        except AssertionError:
            pass
        else:
            raise AssertionError(f"check_geoid accepted {bad}")

    print("  _icesat2 self-test OK")


if __name__ == "__main__":
    _self_test()
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 scripts/_icesat2.py`
Expected: `NotImplementedError` from `along_track`.

- [ ] **Step 3: Implement the five stubs**

Replace the `raise NotImplementedError` bodies:

```python
def along_track(x: F64, y: F64) -> F64:
    xc, yc = x - x.mean(), y - y.mean()
    cov = np.cov(np.vstack([xc, yc]))
    _evals, evecs = np.linalg.eigh(cov)
    u = evecs[:, -1]                       # principal axis
    return xc * u[0] + yc * u[1]


def ground_line(s_all: F64, s_gnd: F64, h_gnd: F64,
                win_m: float = GROUND_WIN_M, q: float = GROUND_Q) -> F64:
    order = np.argsort(s_gnd)
    ss, hh = s_gnd[order], h_gnd[order]
    centres = np.arange(float(ss[0]), float(ss[-1]) + 1e-9, win_m / 2.0)
    lo = np.searchsorted(ss, centres - win_m / 2.0)
    hi = np.searchsorted(ss, centres + win_m / 2.0)
    gv = np.full(centres.shape, np.nan)
    for i in range(len(centres)):
        if hi[i] - lo[i] >= 5:             # too few photons → NaN → interpolated
            gv[i] = np.quantile(hh[lo[i]:hi[i]], q)
    ok = np.isfinite(gv)
    if int(ok.sum()) < 2:
        raise ValueError("ground line needs at least two populated windows")
    return np.interp(s_all, centres[ok], gv[ok])


def assign_footprints(px: F64, py: F64, rings: list[list[float]],
                      buffer_m: float) -> tuple[npt.NDArray[np.int64], list[int]]:
    from shapely import points as sh_points
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    polys, kept = [], []
    for i, p in enumerate(rings):
        g = Polygon(list(zip(p[0::2], p[1::2]))).buffer(buffer_m)
        if not g.is_empty and g.area > 1.0:
            polys.append(g)
            kept.append(i)
    idx = np.full(px.shape[0], -1, dtype=np.int64)
    if polys:
        tree = STRtree(polys)
        pts = sh_points(np.column_stack([px, py]))
        pi, ti = tree.query(pts, predicate="within")
        idx[pi] = np.asarray(kept, dtype=np.int64)[ti]
    return idx, kept


def building_heights(bldg_idx: npt.NDArray[np.int64], hag: F64,
                     min_ph: int = MIN_ROOF_PH) -> dict[int, float]:
    lo, hi = ROOF_BAND_M
    m = (bldg_idx >= 0) & (hag >= lo) & (hag <= hi)
    out: dict[int, float] = {}
    for b in np.unique(bldg_idx[m]):
        v = hag[m & (bldg_idx == b)]
        if v.size >= min_ph:
            out[int(b)] = float(np.quantile(v, 0.75))
    return out


def quantile_bias(ours: F64, theirs: F64, rng: np.random.Generator,
                  boots: int = 10_000) -> dict[str, object]:
    from scipy.stats import ks_2samp
    n = ours.size
    d = {"n": int(n)}
    for name, qq in (("median", 0.50), ("p65", 0.65), ("p90", 0.90)):
        d[f"{name}_bias_m"] = round(float(np.quantile(ours, qq) - np.quantile(theirs, qq)), 2)
    bs = np.empty(boots)
    for k in range(boots):
        i = rng.integers(0, n, n)          # paired resample — same buildings both sides
        bs[k] = np.quantile(ours[i], 0.50) - np.quantile(theirs[i], 0.50)
    d["ci95_m"] = [round(float(np.quantile(bs, 0.025)), 2),
                   round(float(np.quantile(bs, 0.975)), 2)]
    d["ks_p"] = round(float(ks_2samp(ours, theirs).pvalue), 4)
    return d


def check_geoid(ground_ortho_m: float, dem_median_m: float, geoid_n_m: float) -> None:
    assert abs(ground_ortho_m - dem_median_m) <= 5.0, (
        f"converted ground {ground_ortho_m:.1f} m vs DEM {dem_median_m:.1f} m — "
        "geoid conversion or ground extraction is wrong")
    ellip = ground_ortho_m + geoid_n_m     # h_ellip = h_ortho + N
    miss = abs(ellip - dem_median_m)
    assert 40.0 <= miss <= 70.0, (
        f"unconverted height misses DEM by {miss:.1f} m, not the ~55 m geoid — "
        "either N is wrong or heights were already orthometric")
```

- [ ] **Step 4: Run the self-test to verify it passes**

Run: `python3 scripts/_icesat2.py`
Expected: `_icesat2 self-test OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/_icesat2.py
git commit -m "feat(icesat2): pure transect geometry + stats, self-tested

The ground line uses only out-of-footprint photons — the self-test includes a
roof wider than the window, the case a naive rolling quantile gets wrong."
```

---

### Task 2: `scripts/fetch-icesat2.py` — CMR search, download, subset, geoid gate

**Files:**
- Create: `scripts/fetch-icesat2.py`

- [ ] **Step 1: Install the one new dependency**

Run: `python3 -m pip install h5py`
Expected: `Successfully installed h5py-3.x`.

- [ ] **Step 2: Obtain the EGM2008 constants — record, don't trust memory**

Run, for each ward centre (values from `_types.WARDS`):

```bash
curl -s "https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=22.528+88.3659"  | grep -A1 EGM2008
curl -s "https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=22.7621+88.3713" | grep -A1 EGM2008
curl -s "https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=22.3654+88.4319" | grep -A1 EGM2008
```

Expected: an EGM2008 undulation near **−50 to −60 m** for each (the three should agree within ~0.5 m). Record the three values in the `GEOID_N_M` dict in Step 3 with the retrieval date and URL in the comment. If the service is down, GeoidEval's offline peer `https://www.unavco.org/software/geodetic-utilities/geoid-height-calculator/geoid-height-calculator.html` is the fallback; record whichever was used.

- [ ] **Step 3: Write the fetch script**

```python
"""ICESat-2 ATL03 → ward photon subsets, the only network step in the pipeline.

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §3, §5.1.

    python3 scripts/fetch-icesat2.py --ward ballygunge --granule ATL03_20220510191458_07441501_007_01.h5
    python3 scripts/fetch-icesat2.py --ward ballygunge            # every ATL03 granule over the ward
    python3 scripts/fetch-icesat2.py --purge                      # delete cached granules

Granules (~168 MB) cache at ~/.cache/delta-climate/icesat2/ and NEVER enter the
repo. The committed artefact is the ~200 KB subset per (ward, granule):

    data/calibration/icesat2/<ward>-<yyyymmdd>-<rgt>.json
      ward, granule, rgt, date, sc_orient, geoidNM, geoidSource, demMedianM,
      counts: {photons_read, conf_land, in_box, ground_candidates},
      trackMinDistM,                    # closest approach to the ward centre
      beams: ["gt1r", ...],
      ph: [[lon, lat, h_ellip, h_ortho, conf, beam_i], ...]

GEOID. ATL03 h_ph is ellipsoidal (WGS84). Everything downstream is orthometric.
h_ortho = h_ellip - N with N below. The two-sided check_geoid() gate REFUSES to
write a subset whose ground disagrees with the ward DEM — so a wrong constant, a
skipped conversion, or broken ground extraction all fail loudly here, not
quietly in the statistics.

STRONG BEAMS ONLY. ATLAS fires 3 strong/weak pairs; which side is strong flips
with spacecraft orientation (sc_orient 0=backward→gt*l strong, 1=forward→gt*r).
That mapping is VERIFIED per granule, not trusted: the chosen beam must carry
>= 2x the photons of its pair partner in our latitude band, else the granule is
rejected with a message naming the count ratio.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _ecostress import token  # noqa: E402
from _types import WARDS, ward_bounds  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "data", "calibration", "icesat2")
CACHE = os.path.expanduser("~/.cache/delta-climate/icesat2")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

#: EGM2008 undulation N at each ward centre, metres.
#: Source: GeographicLib GeoidEval (EGM2008-1'), retrieved 2026-08-06 —
#: https://geographiclib.sourceforge.io/cgi-bin/GeoidEval
#: h_ortho = h_ellip - N. The check_geoid gate makes a wrong value fatal.
GEOID_N_M: dict[str, float] = {
    # FILLED IN STEP 2 — three values near -55; the assert below rejects typos.
    "ballygunge": 0.0, "barrackpore": 0.0, "baruipur": 0.0,
}
for _w, _n in GEOID_N_M.items():
    assert -70.0 < _n < -40.0, f"GEOID_N_M[{_w}]={_n} is not a Kolkata-region EGM2008 value"

#: Ward box padding: catches tracks that clip the corner, spec §3.
PAD_M = 200.0
#: A subset with fewer confident photons than this is monsoon noise, spec §5.2.
MIN_CONF_PH = 100

STRONG = {0: ("gt1l", "gt2l", "gt3l"), 1: ("gt1r", "gt2r", "gt3r")}
PARTNER = {"gt1l": "gt1r", "gt1r": "gt1l", "gt2l": "gt2r",
           "gt2r": "gt2l", "gt3l": "gt3r", "gt3r": "gt3l"}


def cmr_atl03(ward: str) -> list[dict[str, object]]:
    """Every ATL03 v007 granule whose bbox touches the padded ward box."""
    bbox = ward_bounds(WARDS[ward], PAD_M)
    r = requests.get(CMR, params={
        "short_name": "ATL03", "version": "007",
        "bounding_box": ",".join(f"{v:.6f}" for v in bbox),
        "page_size": "2000", "sort_key": "-start_date"}, timeout=60)
    r.raise_for_status()
    out = []
    for e in r.json()["feed"]["entry"]:
        name = e.get("producer_granule_id") or e["title"]
        url = next((l["href"] for l in e.get("links", [])
                    if l["href"].endswith(".h5") and "data" in l.get("rel", "")), None)
        if url:
            out.append({"name": name, "url": url})
    return out


def download(url: str, name: str, tok: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    dest = os.path.join(CACHE, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        return dest
    print(f"  downloading {name} …")
    with requests.get(url, headers={"Authorization": f"Bearer {tok}"},
                      stream=True, timeout=900) as r:
        r.raise_for_status()
        tmp = dest + ".part"
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
        os.replace(tmp, dest)
    return dest


def beam_slice(f, beam: str, south: float, north: float) -> tuple[int, int]:
    """Photon index range for a latitude band, via the 20 m segment index —
    reads two small per-segment arrays instead of tens of millions of photons."""
    seg_lat = f[beam]["geolocation/reference_photon_lat"][:]
    cnt = f[beam]["geolocation/segment_ph_cnt"][:].astype(np.int64)
    sel = np.where((seg_lat >= south) & (seg_lat <= north))[0]
    if sel.size == 0:
        return 0, 0
    starts = np.concatenate([[0], np.cumsum(cnt)])
    return int(starts[sel[0]]), int(starts[sel[-1] + 1])


def subset(path: str, ward: str) -> dict[str, object] | None:
    import h5py
    w = WARDS[ward]
    west, south, east, north = ward_bounds(w, PAD_M)
    fp = json.load(open(os.path.join(ROOT, "data", "geometry", f"{ward}-footprints.json")))
    rings = [r["p"] for r in fp["b"]]
    dem_median = json.load(open(os.path.join(
        ROOT, "public", "heat-map", "data", f"{ward}-terrain.json")))["medianM"]
    gname = os.path.basename(path)
    m = re.match(r"ATL03_(\d{8})\d{6}_(\d{4})\d{4}_", gname)
    if not m:
        sys.exit(f"  cannot parse granule name {gname}")
    date, rgt = m.group(1), m.group(2)

    rows: list[list[float]] = []
    beams: list[str] = []
    n_read = n_conf = 0
    with h5py.File(path, "r") as f:
        ori = int(f["orbit_info/sc_orient"][0])
        if ori not in STRONG:
            print(f"  {gname}: sc_orient={ori} (transition) — rejected")
            return None
        for beam in STRONG[ori]:
            if beam not in f or "heights" not in f[beam]:
                continue
            i0, i1 = beam_slice(f, beam, south, north)
            if i1 <= i0:
                continue
            g = f[beam]["heights"]
            lat = g["lat_ph"][i0:i1]
            lon = g["lon_ph"][i0:i1]
            h_e = g["h_ph"][i0:i1]
            conf = g["signal_conf_ph"][i0:i1, 0]      # column 0 = land
            n_read += int(lat.size)
            # verify the strong-beam mapping instead of trusting it
            p0, p1 = beam_slice(f, PARTNER[beam], south, north)
            if (i1 - i0) < 2 * max(1, p1 - p0):
                print(f"  {gname} {beam}: only {(i1-i0)}/{max(1,p1-p0)} photons vs "
                      "its pair partner — strong-beam mapping suspect, rejected")
                return None
            keep = (conf >= 3) & (lon >= west) & (lon <= east) \
                 & (lat >= south) & (lat <= north)
            n_conf += int(keep.sum())
            if not keep.any():
                continue
            bi = len(beams)
            beams.append(beam)
            h_o = h_e[keep] - GEOID_N_M[ward]
            for a, b_, c, d, e in zip(lon[keep], lat[keep], h_e[keep], h_o, conf[keep]):
                rows.append([round(float(a), 6), round(float(b_), 6),
                             round(float(c), 2), round(float(d), 2), int(e), bi])

    if n_conf < MIN_CONF_PH:
        print(f"  {gname}: {n_conf} confident photons in the box (<{MIN_CONF_PH}) — rejected")
        return None

    ph = np.asarray(rows)
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)
    # ground candidates: outside every footprint dilated by the geolocation error
    dil_idx, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil_idx == -1
    if int(gnd.sum()) < 50:
        print(f"  {gname}: only {int(gnd.sum())} ground candidates — rejected")
        return None
    gline = _icesat2.ground_line(s, s[gnd], ph[gnd, 3])
    # THE GATE: two-sided geoid known-answer check. Raises on failure.
    _icesat2.check_geoid(float(np.median(gline)), float(dem_median), GEOID_N_M[ward])

    return {
        "ward": ward, "granule": gname, "rgt": rgt, "date": date, "sc_orient": ori,
        "geoidNM": GEOID_N_M[ward],
        "geoidSource": "EGM2008 via GeographicLib GeoidEval, retrieved 2026-08-06",
        "demMedianM": dem_median,
        "trackMinDistM": round(float(np.min(np.hypot(x, y))), 1),
        "counts": {"photons_read": n_read, "conf_land": n_conf,
                   "in_box": int(ph.shape[0]), "ground_candidates": int(gnd.sum())},
        "beams": beams,
        "ph": rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", choices=sorted(WARDS), default="ballygunge")
    ap.add_argument("--granule", help="process exactly this granule name")
    ap.add_argument("--limit", type=int, default=0, help="stop after N granules")
    ap.add_argument("--purge", action="store_true", help="delete cached .h5 and exit")
    args = ap.parse_args()

    if args.purge:
        for p in glob.glob(os.path.join(CACHE, "*.h5")):
            os.remove(p)
            print(f"  purged {os.path.basename(p)}")
        return

    tok = token()
    grans = cmr_atl03(args.ward)
    print(f"  {len(grans)} ATL03 granules over {args.ward}")
    if args.granule:
        grans = [g for g in grans if g["name"] == args.granule]
        if not grans:
            sys.exit(f"  {args.granule} not in the CMR result for this ward")
    if args.limit:
        grans = grans[: args.limit]

    os.makedirs(OUT_DIR, exist_ok=True)
    written = 0
    for g in grans:
        sub = subset(download(str(g["url"]), str(g["name"]), tok), args.ward)
        if sub is None:
            continue
        out = os.path.join(OUT_DIR, f"{args.ward}-{sub['date']}-{sub['rgt']}.json")
        with open(out, "w") as fh:
            json.dump(sub, fh)
            fh.write("\n")
        kb = os.path.getsize(out) / 1024
        print(f"  wrote {os.path.relpath(out, ROOT)}  ({kb:.0f} KB, "
              f"{sub['counts']['in_box']} photons, closest {sub['trackMinDistM']} m)")
        written += 1
    print(f"\n  {written} subsets written")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Fill `GEOID_N_M` with the Step-2 values** (the placeholder zeros make the module-level assert fail, so the script cannot run un-filled — verify that first: `python3 scripts/fetch-icesat2.py --purge` must die with the assert message before filling, run without error after).

- [ ] **Step 5: Commit** (the script only — no subsets yet)

```bash
git add scripts/fetch-icesat2.py
git commit -m "feat(icesat2): fetch — CMR search, cached download, beam subset, geoid gate

The subset writer refuses to emit a file whose ground photons disagree with the
ward DEM after conversion, or agree with it BEFORE conversion. Strong-beam
mapping is verified per granule against the pair partner's photon count."
```

---

### Task 3: THE GATE — prove the 79 m track, or stop

**Files:**
- Create: `scripts/diagnose-icesat2-transect.py`
- Create (by running, then committing): `data/calibration/icesat2/ballygunge-20220510-0744.json`

- [ ] **Step 1: Fetch the crossing track** (see the corrected COVERAGE table above — the
first draft named a granule whose beams miss Ballygunge by 6.27 km)

Run: `python3 scripts/fetch-icesat2.py --ward ballygunge --granule ATL03_20260110152208_04163007_007_01.h5`
Expected: one download (~168 MB, cached thereafter), then
`wrote data/calibration/icesat2/ballygunge-20260110-0416.json (… KB, … photons, closest ~291 m)` — or a rejection whose message names the reason. **If the geoid gate throws here, debug the constant/ground extraction before anything else; do not loosen the gate.**

Note the subset writer keeps **strong beams only**. Ballygunge's crossing strong beam is
gt2l at 291 m; its weak gt2r passes closer (208 m) and is the documented fallback if the
strong beam turns out to be photon-starved on this pass.

- [ ] **Step 2: Write the diagnostic script**

```python
"""Task-0 gate (spec §6): is roof separable from ground on a real transect?

    python3 scripts/diagnose-icesat2-transect.py data/calibration/icesat2/ballygunge-20220510-0744.json

Writes previews/_icesat2-transect.png (untracked, like the other _*.png scratch
renders) and prints PASS/FAIL against the two gate criteria:
  G1  median of the ground line within ±5 m of the ward DEM median  (already
      enforced by fetch — repeated here so the verdict is self-contained)
  G2  roof photons over eroded footprints exist and their per-building p50 > 4 m
"""
from __future__ import annotations

import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _types import WARDS  # noqa: E402

ROOT = os.path.join(HERE, "..")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sub = json.load(open(sys.argv[1]))
    w = WARDS[sub["ward"]]
    fp = json.load(open(os.path.join(ROOT, "data", "geometry",
                                     f"{sub['ward']}-footprints.json")))
    rings = [r["p"] for r in fp["b"]]

    ph = np.asarray(sub["ph"], dtype=np.float64)
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)
    dil, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil == -1
    g = _icesat2.ground_line(s, s[gnd], ph[gnd, 3])
    hag = ph[:, 3] - g
    ero, _ = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    est = _icesat2.building_heights(ero, hag)

    g1 = abs(float(np.median(g)) - sub["demMedianM"]) <= 5.0
    heights = np.asarray(list(est.values()))
    g2 = heights.size > 0 and float(np.median(heights)) > 4.0

    fig, ax = plt.subplots(figsize=(14, 5), dpi=150)
    ax.scatter(s[gnd], hag[gnd], s=1, c="#8a8a8a", label=f"ground candidates ({int(gnd.sum())})")
    roof = ero >= 0
    ax.scatter(s[roof], hag[roof], s=2, c="#d94f2b", label=f"in eroded footprints ({int(roof.sum())})")
    ax.axhline(0, lw=0.5, c="k")
    ax.set(xlabel="along-track m", ylabel="height above ground line m",
           title=f"{sub['granule']}  ·  {len(est)} buildings with ≥{_icesat2.MIN_ROOF_PH} roof photons")
    ax.set_ylim(-6, max(40, float(hag[roof].max()) + 5) if roof.any() else 40)
    ax.legend(loc="upper right", markerscale=6)
    out = os.path.join(ROOT, "previews", "_icesat2-transect.png")
    fig.savefig(out, bbox_inches="tight")
    print(f"  plot: {os.path.relpath(out, ROOT)}")
    print(f"  G1 ground vs DEM: {'PASS' if g1 else 'FAIL'} "
          f"(ground {float(np.median(g)):.1f} m, DEM {sub['demMedianM']:.1f} m)")
    print(f"  G2 roof separability: {'PASS' if g2 else 'FAIL'} "
          f"({len(est)} buildings, median est "
          f"{float(np.median(heights)) if heights.size else float('nan'):.1f} m)")
    print(f"\n  GATE {'PASS' if g1 and g2 else 'FAIL'}")
    sys.exit(0 if g1 and g2 else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the gate**

Run: `python3 scripts/diagnose-icesat2-transect.py data/calibration/icesat2/ballygunge-20260110-0416.json`
Expected: `GATE PASS` with both criteria, and a plot at `previews/_icesat2-transect.png` showing a grey ground band near 0 and red roof photons standing above it. **Open the plot and look at it** — the gate numbers cannot see a ground line that is subtly wrong everywhere.

- [ ] **Step 4 — IF THE GATE FAILS:** do not proceed to Task 4. Escalate in this order,
all on the SAME three tracks (there are no others): another dry-season pass of RGT 0416
over Ballygunge; then Barrackpore's RGT 0744 gt1l, which carries 7.7× the photons of
Ballygunge's crossing beam and is the strongest crossing we have; then Baruipur's RGT 0744
gt2l; then Ballygunge's weak gt2r at 208 m. If none passes, write
`data/calibration/icesat2-heights.json` by hand:

```json
{
  "summary": {"verdict": "not_separable", "n_buildings": 0, "n_tracks": 0},
  "note": "ICESat-2 ATL03 transects over the wards could not separate roof from ground returns (criteria and per-track numbers in data/calibration/icesat2/). The building-height distribution therefore remains validated only against n=6 OSM storey counts (underpowered, see score-heights.py). Negative result recorded 2026-08-06."
}
```

commit it with the subsets (`measure(heights): ICESat-2 transects not separable — negative result`), skip Tasks 4–6, and in Task 7 the `HEIGHTS` block publishes this verdict honestly. Report to the user either way.

- [ ] **Step 5: Commit the gate passing**

```bash
git add scripts/diagnose-icesat2-transect.py data/calibration/icesat2/ballygunge-20220510-0744.json
git commit -m "measure(heights): Task-0 gate — the 79 m track separates roof from ground

Subset committed (~200 KB); the 168 MB granule stays in ~/.cache and out of git."
```

---

### Task 4: `scripts/measure-height-accuracy.py` — the verdict

**Files:**
- Create: `scripts/measure-height-accuracy.py`

- [ ] **Step 1: Write the measure script**

```python
"""Do the shipped building heights survive ICESat-2, in distribution?
→ data/calibration/icesat2-heights.json

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §5.3.
Verdicts and thresholds are PRE-REGISTERED there; this script implements them
and must not grow new ones because the data looked tempting.

    python3 scripts/measure-height-accuracy.py            # all committed subsets

FULLY OFFLINE. Reads only committed artefacts: data/calibration/icesat2/*.json,
data/geometry/*-footprints.json, public/heat-map/data/*.json. Reruns need no
credentials — that is why the subsets are committed.

WHAT IS COMPARED. For every building crossed by a transect (>= MIN_ROOF_PH
photons inside its 5 m-eroded footprint), two numbers exist: the ICESat-2 p75
height-above-ground and the shipped artefact height (public/<ward>.json column
0, index-aligned with the footprints — verified in the plan). The comparison is
between the two DISTRIBUTIONS over crossed buildings; nothing per-building is
published (spec §1: geolocation error forbids it).

SELECTION EFFECT, DISCLOSED. Erosion drops small buildings, so the crossed set
over-represents large ones. The artefact records how many buildings each track
crossed vs dropped; the published wording must say "along satellite transects".
"""
from __future__ import annotations

import glob
import json
import os
import sys
from typing import Any

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _types import WARDS  # noqa: E402

ROOT = os.path.join(HERE, "..")
SUB_DIR = os.path.join(ROOT, "data", "calibration", "icesat2")
OUT = os.path.join(ROOT, "data", "calibration", "icesat2-heights.json")

MIN_BUILDINGS = 30        # spec §5.3: below this, verdict = underpowered
MIN_FILL = 10             # spec §5.3: fill cohort's own bar
VALID_BIAS_M = _icesat2.STOREY_M          # 3.2 — one storey
WIDE_CI_M = 2 * _icesat2.STOREY_M         # 6.4 — CI must exclude ±2 storeys


def crossed(sub: dict[str, Any], rings: list[list[float]]) -> dict[int, float]:
    w = WARDS[sub["ward"]]
    ph = np.asarray(sub["ph"], dtype=np.float64)
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)
    dil, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil == -1
    g = _icesat2.ground_line(s, s[gnd], ph[gnd, 3])
    ero, _ = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    return _icesat2.building_heights(ero, ph[:, 3] - g)


def main() -> None:
    subs = sorted(glob.glob(os.path.join(SUB_DIR, "*.json")))
    if not subs:
        sys.exit("  no subsets in data/calibration/icesat2/ — run fetch-icesat2.py first")

    ours: list[float] = []      # ICESat-2 estimates
    theirs: list[float] = []    # shipped artefact heights, same buildings
    fill_ours: list[float] = []
    per_track: list[dict[str, Any]] = []
    geom: dict[str, tuple[list[list[float]], list[float]]] = {}

    for p in subs:
        sub = json.load(open(p))
        ward = sub["ward"]
        if ward not in geom:
            fp = json.load(open(os.path.join(ROOT, "data", "geometry",
                                             f"{ward}-footprints.json")))
            pub = json.load(open(os.path.join(ROOT, "public", "heat-map",
                                              "data", f"{ward}.json")))
            assert len(fp["b"]) == len(pub["b"]), \
                f"{ward}: footprints/heights row counts differ — index alignment broken"
            geom[ward] = ([r["p"] for r in fp["b"]], [r[0] for r in pub["b"]])
        rings, heights = geom[ward]
        est = crossed(sub, rings)
        for b, h in est.items():
            ours.append(h)
            theirs.append(heights[b])
            if heights[b] == 2.5:
                fill_ours.append(h)
        per_track.append({"file": os.path.basename(p), "ward": ward,
                          "date": sub["date"], "rgt": sub["rgt"],
                          "closest_m": sub["trackMinDistM"],
                          "n_crossed": len(est)})
        print(f"  {os.path.basename(p)}: {len(est)} crossed buildings")

    n = len(ours)
    o, t = np.asarray(ours), np.asarray(theirs)
    summary: dict[str, Any] = {"n_buildings": n, "n_tracks": len(per_track)}

    if n < MIN_BUILDINGS:
        summary["verdict"] = "underpowered"
    else:
        # KEYS COME FROM THE SHIPPED _icesat2.quantile_bias (commit 95a8c7d), not
        # from this plan's first draft: n, median/p65/p90_bias_m,
        # median/p65/p90_ci95_m, ks_d, perm_p. There is deliberately NO bare
        # `ci95_m` — an unlabelled CI sitting beside three biases invited quoting
        # a median CI against a p65 number. And the significance value is
        # `perm_p`, a PAIRED permutation test: scipy's two-sample KS assumes
        # independence, and on these correlated pairs it rejected 0 times in
        # 2,000 draws under H0 — it would have published "no significant
        # difference" as a free pass no matter what the data said.
        qb = _icesat2.quantile_bias(o, t, np.random.default_rng(7))
        summary.update(qb)
        lo, hi = qb["median_ci95_m"]
        bias = qb["median_bias_m"]
        if abs(bias) < VALID_BIAS_M and -WIDE_CI_M < lo and hi < WIDE_CI_M:
            summary["verdict"] = "validated"
        elif (lo > 0 or hi < 0) and abs(bias) >= VALID_BIAS_M:
            summary["verdict"] = "biased"
        else:
            summary["verdict"] = "inconclusive"

    fill: dict[str, Any] = {"n": len(fill_ours)}
    if len(fill_ours) >= MIN_FILL:
        fo = np.asarray(fill_ours)
        boots = np.asarray([np.median(np.random.default_rng(11 + k)
                            .choice(fo, fo.size)) for k in range(10_000)])
        fill.update({
            "median_icesat2_m": round(float(np.median(fo)), 2),
            "understatement_m": round(float(np.median(fo)) - 2.5, 2),
            "ci95_m": [round(float(np.quantile(boots, 0.025)), 2),
                       round(float(np.quantile(boots, 0.975)), 2)],
            "heights_m": [round(float(v), 2) for v in sorted(fo)],
            "verdict": "measured"})
    else:
        fill["verdict"] = "underpowered"

    excluded = {"note": "buildings whose eroded footprint the beam missed, or with "
                        f"<{_icesat2.MIN_ROOF_PH} roof photons, do not enter — the "
                        "crossed set over-represents LARGE buildings; wording must "
                        "say 'along satellite transects'."}

    out = {"summary": summary, "fill": fill, "per_track": per_track,
           "excluded": excluded,
           "note": ("Distributional comparison only — ATL03 geolocation (~3-5 m) "
                    "forbids per-building attribution. Thresholds pre-registered "
                    "in the 2026-08-06 spec.")}
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"\n  n={n} crossed buildings over {len(per_track)} tracks")
    if "median_bias_m" in summary:
        print(f"  median bias {summary['median_bias_m']:+.2f} m "
              f"(95% CI {summary['median_ci95_m']}), "
              f"p65 {summary['p65_bias_m']:+.2f} (CI {summary['p65_ci95_m']}), "
              f"p90 {summary['p90_bias_m']:+.2f} (CI {summary['p90_ci95_m']})")
        print(f"  paired permutation p={summary['perm_p']}  (KS D={summary['ks_d']})")
    print(f"  fill cohort: n={fill['n']}"
          + (f", median {fill['median_icesat2_m']} m "
             f"(understates by {fill['understatement_m']} m)" if fill["verdict"] == "measured" else " — underpowered"))
    print(f"\n  VERDICT: {summary['verdict']}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run against the Task-3 subset**

Run: `python3 scripts/measure-height-accuracy.py`
Expected: per-track crossed counts, a verdict (with one track almost certainly `underpowered` — that is correct behaviour, not a bug), artefact written.

- [ ] **Step 3: Commit**

```bash
git add scripts/measure-height-accuracy.py data/calibration/icesat2-heights.json
git commit -m "measure(heights): distributional ICESat-2 comparison, pre-registered verdicts

One track in, so the first artefact says what it should say: underpowered."
```

---

### Task 5: The sweep — pool tracks until powered or exhausted

**Files:**
- Modify (by running): `data/calibration/icesat2/`, `data/calibration/icesat2-heights.json`

**The sweep pools repeat passes of three fixed tracks.** It is not a search for more
coverage — the COVERAGE table above is exhaustive, and no additional granule can add a
building that those three beam lines do not cross. What repeat passes buy is photons per
building, which is what lets a building clear `MIN_ROOF_PH = 5`.

- [ ] **Step 1: Fetch every pass on each ward's crossing track**

Run: `python3 scripts/fetch-icesat2.py --ward barrackpore` (start here — its gt1l carries
5,548 photons per pass against Ballygunge's 718, so it is the most likely to reach the bar
on its own), then `--ward baruipur`, then `--ward ballygunge`.

Expected: ~21 granules attempted per ward; the monsoon ones rejected with a printed reason;
subsets written for the rest. This moves tens of GB **transiently** through the cache — run
`--purge` between wards if disk is tight.

- [ ] **Step 2: Re-run the measure after each ward; stop when the bar is met**

Run `python3 scripts/measure-height-accuracy.py` after each ward. Stop as soon as
n ≥ 30 AND the fill cohort n ≥ 10, or when all three wards are exhausted — whichever comes
first. The verdict is whatever the pre-registered rules say at that point.

**If n stalls below 30 with all three wards swept, that is the answer, not a failure.**
(This plan originally said "the crossed set is capped by geometry". **That was wrong** —
repeat passes of one track land up to 726 m apart across a 1,400 m ward, so they sample
substantially different buildings, and that is precisely why the sweep reached n = 30. See
the spec's 2026-08-07 correction.) `underpowered` is still a pre-registered outcome. Do NOT
respond by relaxing `MIN_ROOF_PH`, the erosion, or the roof band to manufacture buildings —
every one of those knobs was set by a measurement in Task 1, and turning it to reach a
target n is exactly the move this project exists to avoid. Report and stop.

- [ ] **Step 3: Purge the cache, commit the final state**

```bash
python3 scripts/fetch-icesat2.py --purge
git add data/calibration/icesat2/ data/calibration/icesat2-heights.json
git commit -m "measure(heights): full transect sweep — <verdict>, n=<n> buildings over <k> tracks"
```

(Fill in the real verdict/counts — the commit message states the result, per repo convention.)

---

### Task 6: `compute-far.py --icesat2-correction`

**Files:**
- Modify: `scripts/compute-far.py`
- Create (by running): `data/calibration/far-icesat2-sensitivity.json`

- [ ] **Step 1: Add the mode**

In `main()`, add the argument and branch (adapting to the existing `argparse` block; `ward_far(path)` already computes baseline FAR per ward file):

```python
ap.add_argument("--icesat2-correction", action="store_true",
                help="recompute FAR with the 2.5 m fill cohort resampled from "
                     "the measured ICESat-2 distribution; writes "
                     "data/calibration/far-icesat2-sensitivity.json")
```

and the implementation (module level):

```python
def icesat2_sensitivity() -> None:
    """ΔFAR if the 2.5 m fill cohort is resampled from ICESat-2 (spec §5.3 win 3).

    COHORT-LEVEL, NOT PER-BUILDING: each fill building draws a height from the
    measured empirical distribution (seeded, so the artefact is reproducible).
    The measured cohort comes from whichever wards the transects crossed; using
    it for all three wards' fill assumes the fill population is exchangeable
    across wards — stated in the artefact note, not hidden.
    """
    meas = json.load(open(os.path.join(ROOT, "data", "calibration",
                                       "icesat2-heights.json")))
    if meas["fill"].get("verdict") != "measured":
        out = {"note": "fill cohort underpowered in icesat2-heights.json — "
                       "no correction computable", "wards": {}}
    else:
        pool = np.asarray(meas["fill"]["heights_m"])
        rng = np.random.default_rng(7)
        wards: dict[str, Any] = {}
        for path in sorted(glob.glob(os.path.join(ROOT, "public", "heat-map",
                                                  "data", "*.json"))):
            name = os.path.basename(path)[:-5]
            if "-" in name:                      # skip -terrain, -roads, …
                continue
            d = json.load(open(path))
            base_floors = corr_floors = 0.0
            land = float(d["sizeM"]) ** 2
            area_sum = 0.0
            for row in d["b"]:
                h, ring = row[0], row[1:]
                a = polygon_area(ring[0::2], ring[1::2])
                area_sum += a
                hc = float(rng.choice(pool)) if h == 2.5 else h
                base_floors += a * max(1, round(h / 3.2))
                corr_floors += a * max(1, round(hc / 3.2))
            wards[name] = {
                "far_baseline": round(base_floors / land, 4),
                "far_corrected": round(corr_floors / land, 4),
                "delta_pct": round(100 * (corr_floors - base_floors)
                                   / max(base_floors, 1e-9), 2)}
        out = {"wards": wards,
               "fill_median_m": meas["fill"]["median_icesat2_m"],
               "note": ("Fill cohort resampled from the ICESat-2 empirical "
                        "distribution (seeded rng(7)); assumes the fill "
                        "population is exchangeable across wards. Storey "
                        "height 3.2 m as in ward_far.")}
    dest = os.path.join(ROOT, "data", "calibration", "far-icesat2-sensitivity.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    for wname, v in out.get("wards", {}).items():
        print(f"  {wname:<12} FAR {v['far_baseline']} → {v['far_corrected']}  ({v['delta_pct']:+.2f} %)")
    print(f"  written to {os.path.relpath(dest, ROOT)}")
```

Wire it in `main()` before the normal flow: `if args.icesat2_correction: icesat2_sensitivity(); return`. Reuse the existing `polygon_area`; add the missing imports (`glob`, `numpy as np`, `Any`) to match the file's existing import block. **Match `ward_far`'s actual floor formula when writing the baseline** — read `ward_far` first and mirror its area/floor arithmetic exactly, so `far_baseline` here reproduces the shipped `far.json` values (that equality is the self-check: print a warning if any ward's `far_baseline` differs from the committed FAR artefact by > 0.001).

- [ ] **Step 2: Run**

Run: `python3 scripts/compute-far.py --icesat2-correction`
Expected: three wards' baseline FAR matching the shipped artefact, corrected FAR, Δ%. "No correction computable" if the fill stayed underpowered — also a valid, publishable outcome.

- [ ] **Step 3: Commit**

```bash
git add scripts/compute-far.py data/calibration/far-icesat2-sensitivity.json
git commit -m "measure(far): FAR sensitivity to the 2.5 m fill under the ICESat-2 correction"
```

---

### Task 7: `accuracy.ts` HEIGHTS block, guards, card tooltip

**Files:**
- Modify: `src/scripts/climate-engine/accuracy.ts`
- Modify: `tests/unit/heat-map-accuracy.test.mjs`
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (one line + import)

- [ ] **Step 1: Write the failing guard test first**

Append to `tests/unit/heat-map-accuracy.test.mjs`:

```js
test('HEIGHTS mirrors the ICESat-2 artefact it claims to summarise', async () => {
  const j = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/icesat2-heights.json'), 'utf8'));
  assert.equal(HEIGHTS.verdict, j.summary.verdict);
  assert.equal(HEIGHTS.nBuildings, j.summary.n_buildings);
  assert.equal(HEIGHTS.nTracks, j.summary.n_tracks);
  if (j.summary.median_bias_m !== undefined) {
    assert.equal(HEIGHTS.medianBiasM, j.summary.median_bias_m);
    assert.deepEqual([...HEIGHTS.ci95M], j.summary.median_ci95_m);
  }
});
```

and add `HEIGHTS` to the existing `accuracy.ts` import line.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `HEIGHTS` is not exported.

- [ ] **Step 3: Add the block to `accuracy.ts`** (below `SPATIAL`, same style; **numbers copied from the final `icesat2-heights.json` — the Step-1 test is what makes a wrong copy fail**):

```ts
/**
 * Building-height validation against ICESat-2 ATL03 photon transects
 * (data/calibration/icesat2-heights.json; method and pre-registered thresholds
 * in docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md).
 *
 * DISTRIBUTIONAL, NEVER PER BUILDING. ATL03 horizontal geolocation (~3–5 m)
 * against 10–20 m buildings means any single photon may sit on the neighbour —
 * so the claim is about the height DISTRIBUTION along the transects, and the
 * crossed set over-represents large buildings (5 m erosion drops small ones).
 */
export const HEIGHTS = {
  verdict: '<from artefact>' as const,
  nBuildings: 0,          // ← artefact summary.n_buildings
  nTracks: 0,             // ← artefact summary.n_tracks
  medianBiasM: 0,         // ← artefact summary.median_bias_m (omit if underpowered)
  ci95M: [0, 0] as const, // ← artefact summary.median_ci95_m
  note: 'Building heights validated in distribution along ICESat-2 satellite '
    + 'transects — not individual buildings: laser geolocation (~3–5 m) makes '
    + 'per-building attribution unreliable, and transects over-sample larger '
    + 'buildings.',
} as const;
```

(If the verdict is `underpowered`/`not_separable`/`biased`/`inconclusive`, the note's first clause changes to state that outcome plainly — e.g. "could not be validated against ICESat-2 transects (underpowered: n=…)"; the guards below force the wording to stay honest.)

Add to `assertAccuracyLogic()`:

```ts
a(HEIGHTS.note.includes('in distribution') || !HEIGHTS.note.includes('validated'),
  'a validated-heights claim must be scoped to the distribution');
a(HEIGHTS.note.includes('transect'),
  'the heights note must name the transect sampling frame');
a(HEIGHTS.note.includes('not individual buildings') || !HEIGHTS.note.includes('validated'),
  'a validated-heights claim must disclaim per-building accuracy');
a(HEIGHTS.verdict !== 'validated' || Math.abs(HEIGHTS.medianBiasM) < 3.2,
  'verdict says validated but the recorded bias exceeds one storey');
```

- [ ] **Step 4: Surface it on the card** — in `heat-map-app.ts`, add `HEIGHTS` to the existing `accuracy.ts` import, and in the boot section that wires the card (near the other one-time element lookups), one line:

```ts
document.getElementById('bcH')?.setAttribute('title', HEIGHTS.note);
```

The card's Height row (`HeatMapStage.astro` `id="bcH"`) already shows the value; this puts the provenance on hover, matching how SPATIAL.note rides existing tooltips at `heat-map-app.ts:1321-1332`.

- [ ] **Step 5: Run the tests, then full verify**

Run: `npm run test:unit` — expected PASS, including the new artefact-mirror test.
Run: `npm run verify` — expected green (check, unit, build, report, publication check).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/climate-engine/accuracy.ts src/scripts/climate-engine/heat-map-app.ts tests/unit/heat-map-accuracy.test.mjs
git commit -m "feat(accuracy): HEIGHTS — the ICESat-2 verdict, guarded to stay honest

Guards pin the distributional scoping, the transect framing, and the
per-building disclaimer; the unit test pins every number to the artefact."
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/heat-map-feature.md`

- [ ] **Step 1: Add a "Building heights — ICESat-2 validation" section** after the existing heights/geometry material, containing: the three wins and what each measured (real numbers from the artefacts); the method in one paragraph (ATL03 photons → footprint-eroded roof assignment → out-of-footprint ground line → distributional comparison, thresholds pre-registered); the selection effect sentence; the geoid trap and its two-sided check; what this deliberately does NOT claim (per-building heights, any heat-field accuracy change — `heat-map-model.ts` has no height term); pointers to the spec, the scripts, and the artefacts.

- [ ] **Step 2: Commit**

```bash
git add docs/heat-map-feature.md
git commit -m "docs(heat-map): ICESat-2 height validation — method, verdicts, what it does not claim"
```

---

## Verification (whole-plan)

1. `python3 scripts/_icesat2.py` — self-test green.
2. `python3 scripts/measure-height-accuracy.py` re-run from committed subsets on a clean checkout with **no network and no token** — identical artefact (offline reproducibility is the point of committing subsets).
3. `npm run verify` — green, including the HEIGHTS artefact-mirror test.
4. `git status` — no `.h5` anywhere; `du -sh data/calibration/icesat2/` well under a few MB.
5. The Task-3 plot opened and eyeballed by a human (the user) before the verdict ships.
6. Deploy is the user's call, per project convention ("push, merge and deploy" on their word) — verify on **deltaclimate.earth**, not just the .vercel.app URL.

## Must NOT change

- `heat-map-model.ts` — no height term exists and none is being added.
- `public/heat-map/data/*.json` heights — this plan validates them; it edits none of them.
- `score-heights.py` and its n=6 OSM verdict — superseded in power, kept as the independent second line of evidence.
- The honesty banner and the climate-stripes rules (standing project constraints).
