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
    xc, yc = x - x.mean(), y - y.mean()
    cov = np.cov(np.vstack([xc, yc]))
    _evals, evecs = np.linalg.eigh(cov)
    u = evecs[:, -1]                       # principal axis
    return xc * u[0] + yc * u[1]


def ground_line(s_all: F64, s_gnd: F64, h_gnd: F64,
                win_m: float = GROUND_WIN_M, q: float = GROUND_Q) -> F64:
    """Orthometric ground surface evaluated at every photon's s, from
    ground-candidate photons only, rolling lower-quantile, gaps interpolated."""
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
    """Which footprint contains each photon, after buffering every ring by
    buffer_m (negative erodes, positive dilates). Returns (per-photon footprint
    index, -1 = none; list of footprint indices that survived the buffer)."""
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
    """Per-building p75 of roof-band height-above-ground. Only buildings with
    >= min_ph photons in ROOF_BAND_M. Used to build the transect distribution,
    NEVER published per building (spec §5.2.4)."""
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
    """median/p65/p90 of (ours - theirs) as paired per-building resamples, with
    bootstrap 95% CIs and a two-sample KS p-value. Paired resampling keeps the
    building-level correlation the two distributions share."""
    from scipy.stats import ks_2samp
    n = ours.size
    d: dict[str, object] = {"n": int(n)}
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
    """Two-sided known-answer check (spec §5.1). Raises AssertionError unless
    BOTH hold: converted ground within ±5 m of the DEM, AND the unconverted
    (ellipsoidal) value misses by 40-70 m. A check that also fails on the
    unconverted data cannot pass by accident."""
    assert abs(ground_ortho_m - dem_median_m) <= 5.0, (
        f"converted ground {ground_ortho_m:.1f} m vs DEM {dem_median_m:.1f} m — "
        "geoid conversion or ground extraction is wrong")
    ellip = ground_ortho_m + geoid_n_m     # h_ellip = h_ortho + N
    miss = abs(ellip - dem_median_m)
    assert 40.0 <= miss <= 70.0, (
        f"unconverted height misses DEM by {miss:.1f} m, not the ~55 m geoid — "
        "either N is wrong or heights were already orthometric")


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
