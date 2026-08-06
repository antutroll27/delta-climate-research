"""Pure geometry and statistics for the ICESat-2 height validation.

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md

WHY THE GROUND LINE USES ONLY OUT-OF-FOOTPRINT PHOTONS. A naive rolling
lower-quantile over ALL photons fails in exactly the place this city is dense:
under a building wider than the window, every photon in the window is roof, the
"ground" line rides the roof, and height-above-ground collapses to zero. We have
the footprints, so ground candidates are photons outside every footprint dilated
by the geolocation error, and the line is interpolated across the gaps.

WHY THE GROUND LINE IS TWO-PASS. A low quantile is robust but BIASED: p10 of a
symmetric ground-photon spread sits ~1.28 sigma BELOW true ground, so every
height-above-ground would be inflated by that much. It does not average out, a
building-level bootstrap cannot see it, and because the sampled quantile depends
on window population it is density-correlated — a systematic gradient between
dense and open stretches. So pass 1's low quantile only has to be robust to
trees, and pass 2 replaces it with the MEDIAN of the candidates near that line,
which is unbiased for a symmetric residual. See `ground_line`.

WHY EROSION, NOT A NEAREST-BUILDING MATCH. ATL03 horizontal geolocation is
~3-5 m against 10-20 m buildings, so a photon near an edge may belong to the
street or the neighbour. Photons only count as roof if they fall INSIDE a
footprint eroded by ERODE_M — buildings too small to survive erosion are
excluded and COUNTED, because a silent drop would read as coverage.

WHY p75 PER BUILDING, AND WHY AT LEAST FIVE PHOTONS. Roof photon sets include
edge scatter downward (walls, overhangs); an upper quantile resists it without
chasing the single highest photon, which may be noise. That claim is only true
above a sample size: numpy's linear-interpolation p75 puts half its weight on
the single highest photon at n=3, so MIN_ROOF_PH is 5, where the p75 index is
exactly 3.0 — the second-highest photon, zero weight on the maximum.

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
#: Lower quantile that defines the PASS-1 ground line inside a window. Robust to
#: trees and residual roof contamination, but biased low — pass 2 removes that.
GROUND_Q = 0.10
#: Half-width of the pass-2 acceptance gate around the pass-1 line, metres.
#: It has to be wide enough to hold the whole ground-photon spread (ATL03 ground
#: ranging noise is decimetre-class; even a 1 m spread sits well inside), and
#: narrow enough to keep out the street-tree returns that motivated the low
#: quantile in the first place — canopy sits 4 m or more above ground.
GROUND_GATE_M = 1.5
#: Pass 2 is re-applied until no window moves more than this, metres. One
#: application is not enough: the gate is centred on a line that is still biased
#: low, so it clips the top of the ground spread and only removes part of the
#: bias. Measured on the self-test's 1.0 m-spread case: median ground error
#: -1.19 m with no pass 2, -0.49 m after ONE application, +0.05 m at
#: convergence. Re-centring is self-limiting — trees are
#: more than a gate-width above ground, so the line cannot walk into the canopy.
GROUND_GATE_TOL_M = 0.01
#: Hard cap on pass-2 re-applications, so a pathological window cannot spin.
GROUND_GATE_MAX_PASSES = 25
#: Minimum candidates inside a window before it gets a ground value at all, and
#: the minimum surviving the pass-2 gate before pass 2 is trusted over pass 1.
GROUND_MIN_PH = 5
#: Height-above-ground band accepted as roof, metres. Below 2 m is street
#: furniture and misclassified ground; above 120 m is taller than anything in
#: these wards and is treated as noise.
ROOF_BAND_M = (2.0, 120.0)
#: Minimum roof photons before a building contributes a height estimate.
#: NOT a round number: at n=5 numpy's linear-interpolation p75 lands on index
#: 3.0 exactly — the second-highest photon, with zero weight on the maximum,
#: which is what the module header claims p75 does. At n=3 the p75 index is 1.5,
#: i.e. half the weight sits on the single highest photon, so the claim is false
#: and the estimate is sample-size-dependent (E[p75] moves 0.23 sigma between
#: n=3 and n=60, biasing sparsely-sampled buildings low against well-sampled
#: ones). 5 is the smallest n at which the statistic means what we say it means.
MIN_ROOF_PH = 5
#: One storey, metres — the same 3.2 m the FAR pipeline assumes.
STOREY_M = 3.2
#: G1a tolerance (spec §5.1): our hardcoded EGM2008 constant against the value
#: the granule carries in its own `geophys_corr/geoid`, metres. Both are EGM2008
#: over the same photons, so they agree to centimetres when the constant is
#: right — measured 2026-08-06, ATL03 -56.947 vs our -56.95 over Ballygunge.
#: 0.5 m is two orders of magnitude above that agreement and two orders below
#: the ~55 m failure it guards, so it is a bound, not a tuned knob.
GEOID_TOL_M = 0.5
#: G1b band (spec §5.1): the plausible orthometric range for a ground line in
#: deltaic Kolkata, metres. Ward DEM medians sit at 10.3-11.6 m and laser ground
#: at 3-6 m, so the band is generous on both sides; what it excludes is the
#: arithmetic going wrong — see `check_geoid`.
GROUND_BAND_M = (-2.0, 25.0)


class RingError(ValueError):
    """A footprint ring is malformed — WARD GEOMETRY is corrupt, not this pass.

    A subclass so callers can tell it apart from the data-sufficiency
    ValueErrors (`ground_line`'s "too few populated windows"). Those are a
    property of one granule and justify skipping that subset; this one is a
    property of the ward's committed footprint file, so every subset of the ward
    is equally affected and recording it as "this pass had too few ground
    windows" would misattribute whole-ward corruption to one overpass."""


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
                win_m: float = GROUND_WIN_M, q: float = GROUND_Q,
                gate_m: float = GROUND_GATE_M) -> F64:
    """Orthometric ground surface evaluated at every photon's s, from
    ground-candidate photons only, in rolling half-overlapping windows.

    TWO PASSES, and pass 2 is not a refinement — it is the bias fix.

    - Pass 1 is the rolling lower quantile `q`. Its only job is to be robust to
      street trees and residual roof contamination, which it is because they sit
      above ground, not below it.
    - Pass 2 replaces each window's value with the MEDIAN of that window's
      candidates lying within ±`gate_m` of the current line, re-applied until the
      line stops moving (GROUND_GATE_TOL_M). Pass 1 alone is systematically
      BELOW true ground by roughly 1.28x the local photon spread — a bias that
      inflates every height-above-ground, does not average out, is invisible to a
      building-level bootstrap, and varies with photon density, so it also puts a
      false gradient between dense and open stretches. The median of a symmetric
      residual has no such offset; the gate keeps trees (metres above ground) out
      of that median. A window with fewer than GROUND_MIN_PH candidates surviving
      the gate keeps its pass-1 value.

    RETURNS NaN OUTSIDE THE MEASURED SPAN. `np.interp` clamps to its end values,
    so a photon beyond the outermost populated window would be measured against a
    flat extrapolation of the last window, and the error would be invisible:
    measured +0.97 m for a photon 250 m ahead of the first candidate on a ward-
    realistic 3.6 m/km ramp — a third of a storey, free. Photons outside
    [first populated centre, last populated centre] get NaN instead. Callers MUST
    handle NaN in the ground line — dropping those photons AND COUNTING them, per
    spec §5.4, which forbids silent exclusions. `building_heights` already
    excludes NaN height-above-ground, since every comparison against NaN is False.

    Raises ValueError if `s_gnd` and `h_gnd` are misaligned, or if fewer than two
    windows are populated.
    """
    if s_gnd.shape != h_gnd.shape:
        raise ValueError(
            f"ground candidates misaligned: s_gnd {s_gnd.shape} vs h_gnd "
            f"{h_gnd.shape} — a shorter array would silently pair the wrong "
            "photons and the ground line would be meaningless")
    order = np.argsort(s_gnd)
    ss, hh = s_gnd[order], h_gnd[order]
    centres = np.arange(float(ss[0]), float(ss[-1]) + 1e-9, win_m / 2.0)
    lo = np.searchsorted(ss, centres - win_m / 2.0)
    hi = np.searchsorted(ss, centres + win_m / 2.0)
    gv = np.full(centres.shape, np.nan)
    for i in range(len(centres)):
        if hi[i] - lo[i] >= GROUND_MIN_PH:  # too few photons → NaN → interpolated
            gv[i] = np.quantile(hh[lo[i]:hi[i]], q)

    for _ in range(GROUND_GATE_MAX_PASSES):     # pass 2 — remove the low bias
        moved = 0.0
        for i in range(len(centres)):
            if not np.isfinite(gv[i]):
                continue
            w = hh[lo[i]:hi[i]]
            near = w[np.abs(w - gv[i]) <= gate_m]
            if near.size >= GROUND_MIN_PH:      # else: keep the pass-1 value
                mid = float(np.median(near))
                moved = max(moved, abs(mid - gv[i]))
                gv[i] = mid
        if moved <= GROUND_GATE_TOL_M:
            break

    ok = np.isfinite(gv)
    if int(ok.sum()) < 2:
        raise ValueError("ground line needs at least two populated windows")
    cs, vs = centres[ok], gv[ok]
    g = np.interp(s_all, cs, vs)
    return np.where((s_all < cs[0]) | (s_all > cs[-1]), np.nan, g)


def assign_footprints(px: F64, py: F64, rings: list[list[float]],
                      buffer_m: float) -> tuple[npt.NDArray[np.int64], list[int]]:
    """Which footprint contains each photon, after buffering every ring by
    buffer_m (negative erodes, positive dilates). Returns (per-photon footprint
    index, -1 = none; list of footprint indices that survived the buffer).

    Every ring is repaired with `.buffer(0)` first. Invalid rings really are in
    this data (`compute-far.py` counts them as `degenerate_polygons`), and an
    unrepaired one balloons under the buffer: a ring with a zero-width spike was
    measured covering 2.0x its true area after the +5 m dilation, reaching 170 m
    beyond the building and silently deleting real ground candidates that far
    away. `.buffer(0)` resolves the self-intersection to a valid interior first.

    Raises RingError (a ValueError subclass, so callers that only distinguish
    the whole-ward case need not) on an odd-length ring: `zip` would drop the
    trailing coordinate and hand back a quietly different polygon."""
    from shapely import points as sh_points
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    polys, kept = [], []
    for i, p in enumerate(rings):
        if len(p) % 2:
            raise RingError(
                f"ring {i} has {len(p)} coordinates, an odd count — flat "
                "[x, y, x, y, ...] expected; zip would drop the trailing value")
        g = Polygon(list(zip(p[0::2], p[1::2]))).buffer(0).buffer(buffer_m)
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
                     min_ph: int = MIN_ROOF_PH,
                     band: tuple[float, float] = ROOF_BAND_M) -> dict[int, float]:
    """Per-building p75 of roof-band height-above-ground. Only buildings with
    >= min_ph photons in `band`. Used to build the transect distribution,
    NEVER published per building (spec §5.2.4). NaN height-above-ground (the
    ground line's out-of-span marker) drops out of the band mask by itself.

    `band` DEFAULTS TO THE SHIPPED ROOF_BAND_M AND THE SHIPPED PATH MUST NOT
    PASS ANYTHING ELSE. It is a parameter for one purpose: measuring how much
    the 2.0 m floor moves the published bias, offline, so the artefact can carry
    that sensitivity as evidence. Choosing a floor by which answer it produces
    is the exact move this workstream exists to avoid."""
    lo, hi = band
    m = (bldg_idx >= 0) & (hag >= lo) & (hag <= hi)
    out: dict[int, float] = {}
    for b in np.unique(bldg_idx[m]):
        v = hag[m & (bldg_idx == b)]
        if v.size >= min_ph:
            out[int(b)] = float(np.quantile(v, 0.75))
    return out


def _ks_stat(a: F64, b: F64) -> F64:
    """Two-sample Kolmogorov-Smirnov statistic D for each row of two equal-shape
    (draws, n) arrays, vectorised so a permutation test is affordable.

    Pool both samples, walk them in sorted order adding +1 for an `a` value and
    -1 for a `b` value, and take the largest absolute running total over n. The
    running total is only READ at the last member of each tied group, so the
    statistic stays exact when values coincide (a naive running max overstates D
    under ties). The self-test pins this against scipy's `ks_2samp`."""
    n = a.shape[1]
    pooled = np.concatenate([a, b], axis=1)
    lab = np.concatenate([np.ones(a.shape), -np.ones(b.shape)], axis=1)
    order = np.argsort(pooled, axis=1, kind="stable")
    sv = np.take_along_axis(pooled, order, axis=1)
    cum = np.cumsum(np.take_along_axis(lab, order, axis=1), axis=1)
    last = np.ones(cum.shape, dtype=bool)
    last[:, :-1] = sv[:, 1:] != sv[:, :-1]
    return np.max(np.abs(np.where(last, cum, 0.0)), axis=1) / n


def quantile_bias(ours: F64, theirs: F64, rng: np.random.Generator,
                  boots: int = 10_000, perms: int = 10_000) -> dict[str, object]:
    """Distributional comparison of two paired height samples (spec §5.3).

    WHAT `*_bias_m` IS: the difference between the two distributions' MARGINAL
    quantiles, `quantile(ours, q) - quantile(theirs, q)`. It is NEVER the
    quantile of per-building differences — a different statistic that can even
    disagree in sign, and one we are not allowed to compute: spec §1 forbids
    per-building attribution, because ATL03's 3-5 m geolocation error against a
    10-20 m building means any single photon may have hit the neighbour. The
    claim shape is "our height DISTRIBUTION matches theirs", so the statistic
    must be a property of the two distributions, not of matched pairs.

    CIs: each of the three quantiles gets its OWN bootstrap 95 % CI
    (`median_ci95_m`, `p65_ci95_m`, `p90_ci95_m`) from the same paired resamples
    — the same buildings on both sides, which preserves the building-level
    correlation the two samples share. One CI reported next to three statistics
    would be read as covering all three, and p65 is the statistic
    `compute-heights.py` actually ships.

    OMNIBUS TEST: a PAIRED PERMUTATION test, not `ks_2samp`. The two samples are
    the same buildings measured twice, so they are positively correlated and the
    two-sample KS null — independent samples — is simply false here. Measured on
    correlated pairs drawn under H0, `ks_2samp` rejected at p < 0.05 with
    probability 0.0000 against a nominal 0.05: it cannot reject, so its large
    p-value would be published as "no significant difference" — a free pass, the
    worst possible failure for a validation. Instead we randomise the thing that
    is actually exchangeable under H0: which member of each PAIR is labelled
    "ours". `perms` draws independently swap a random subset of pairs, recompute
    D, and `perm_p` is the fraction reaching the observed D. `ks_d` keeps the
    observed D so the artefact records the effect size, not just a verdict.
    `perm_p` is resolved to 1/perms — a reported 0.0000 means "below 1e-4", not
    "zero".

    EVERY VALUE IS RETURNED UNROUNDED, and the caller rounds for display. This
    function used to round to 2 dp in place, which meant the pre-registered
    verdict table in `measure-height-accuracy.py` was evaluated on rounded
    input: a true bias of 3.195 m reads as 3.20 and trips the `|bias| >= 3.2 m`
    arm of `biased`, publishing a verdict the spec does not support at that
    value. A threshold has to be tested against the measurement, not against its
    presentation.

    Raises ValueError if the samples are misaligned, or shorter than 5 pairs
    (at n=1 the bootstrap CI is zero-width and "excludes zero", which would
    publish a `biased` verdict off a single building)."""
    if ours.shape != theirs.shape:
        raise ValueError(
            f"paired samples misaligned: ours {ours.shape} vs theirs "
            f"{theirs.shape} — the shorter array would be silently recycled and "
            "the 'paired' bootstrap would pair the wrong buildings")
    n = int(ours.size)
    if n < 5:
        raise ValueError(
            f"quantile_bias needs at least 5 paired buildings, got {n} — below "
            "that the bootstrap CI is degenerate (zero-width at n=1) and would "
            "read as a significant bias")

    d: dict[str, object] = {"n": n}
    names = ("median", "p65", "p90")
    qv = np.array([0.50, 0.65, 0.90])
    obs = np.quantile(ours, qv) - np.quantile(theirs, qv)
    for j, name in enumerate(names):
        d[f"{name}_bias_m"] = float(obs[j])

    bs = np.empty((boots, qv.size))
    for k in range(boots):
        i = rng.integers(0, n, n)          # paired resample — same buildings both sides
        bs[k] = np.quantile(ours[i], qv) - np.quantile(theirs[i], qv)
    for j, name in enumerate(names):
        d[f"{name}_ci95_m"] = [float(np.quantile(bs[:, j], 0.025)),
                               float(np.quantile(bs[:, j], 0.975))]

    d_obs = float(_ks_stat(ours[None, :], theirs[None, :])[0])
    hits, done = 0, 0
    block = max(1, 1_000_000 // n)         # cap the permutation buffer, not n
    while done < perms:
        m = min(block, perms - done)
        flip = rng.random((m, n)) < 0.5    # randomise each PAIR's assignment
        ge = _ks_stat(np.where(flip, theirs, ours), np.where(flip, ours, theirs))
        hits += int(np.count_nonzero(ge >= d_obs - 1e-12))
        done += m
    d["ks_d"] = d_obs
    d["perm_p"] = hits / perms
    return d


def check_geoid(ground_ortho_m: float, geoid_n_m: float,
                granule_geoid_n_m: float) -> None:
    """Known-answer check on the geoid conversion (spec §5.1) — two DIRECT
    tests, no elevation model anywhere in them. Raises ValueError unless BOTH
    hold.

    G1a — THE CONSTANT IS RIGHT. `geoid_n_m`, our hardcoded EGM2008 undulation
    for the ward, must match `granule_geoid_n_m`, the value ATL03 carries in its
    own `geophys_corr/geoid` over the same photons, to within GEOID_TOL_M. Both
    are EGM2008, so this is an exact, model-free comparison of the constant
    against the instrument's own answer. It catches a wrong-MAGNITUDE constant
    by construction: a typo, one ward's value pasted into another, an
    EGM96/EGM2008 mix-up beyond 0.5 m, a decimal slip.

    G1b — THE CONVERSION WAS ACTUALLY APPLIED. The ground-line median must land
    inside GROUND_BAND_M, the plausible orthometric band for deltaic Kolkata.
    Every way the arithmetic can go wrong lands far outside it:
      - conversion skipped   → the height stays ellipsoidal, ~-52 m: 50 m below
        the lower bound
      - sign flipped         → `h_ellip + |N|`, ~+61 m: 36 m above the upper
        bound
      - ground line on roofs → these wards' roofs stand 11-36 m above ground, so
        a line that has climbed onto them clears +25 m, which no Kolkata ward's
        true ground approaches
    G1a and G1b are complementary, not redundant: G1a checks the number we use,
    G1b checks that we used it, in the right direction, on a ground line that is
    still ground.

    WHY THE WARD DEM IS NOT THE REFERENCE, though this check used it until
    2026-08-06. It required photon GROUND within ±5 m of `<ward>-terrain.json`'s
    median, and that artefact's own `note` field calls it a "smoothed surface
    model ... NOT surveyed ground" — a DSM. Over the dense Ganges delta an
    SRTM-derived surface sits metres above true ground, and the comparison failed
    on 15 of 15 usable passes, always the same direction: photon ground
    2.96-6.33 m against DEM medians 10.3-11.6 m, repeatable to <=1.5 m across six
    years of independent overpasses and all three wards. That is the DEM's
    provenance, not our conversion. The offset is kept as a MEASUREMENT
    (`demOffsetM` in every subset — spec §5.1 publishes it as the terrain-
    validation win), and the gate is replaced rather than widened. The
    replacement is STRICTER: G1a pins the constant to a centimetre-class
    reference instead of inferring it through a proxy carrying 1.5-2.1 m RMSE of
    its own.

    NaN FAILS CLOSED. Both tests are written as `if not (in range)`, so a NaN
    ground line or a NaN granule geoid RAISES rather than sailing through —
    every comparison against NaN being False is exactly how an unbypassable gate
    becomes a silent no-op.

    `raise`, never `assert`: spec §5.1 calls this gate unbypassable, and
    `python3 -O` deletes assert statements outright."""
    if not abs(geoid_n_m - granule_geoid_n_m) <= GEOID_TOL_M:
        raise ValueError(
            f"G1a: our geoid constant N={geoid_n_m:.3f} m disagrees with the "
            f"granule's own geophys_corr/geoid N={granule_geoid_n_m:.3f} m by "
            f"{abs(geoid_n_m - granule_geoid_n_m):.3f} m (tolerance "
            f"{GEOID_TOL_M} m) — the hardcoded constant is wrong for this ward")
    lo, hi = GROUND_BAND_M
    if not lo <= ground_ortho_m <= hi:
        raise ValueError(
            f"G1b: ground-line median {ground_ortho_m:.1f} m falls outside the "
            f"plausible [{lo:.0f}, {hi:.0f}] m orthometric band for this delta — "
            "the conversion was skipped (~-52 m), sign-flipped (~+61 m), or the "
            "ground line has climbed onto rooftops (>+25 m)")


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
    fin = np.isfinite(g)
    err = np.abs(g - ground_true)
    assert float(np.median(err[gnd & fin])) < 0.5, "ground line off in the open"
    assert float(np.median(err[in_a & fin])) < 1.0, \
        "ground line rides the wide roof — the failure the docstring names"
    # tighter than the bare "off in the open" bar: the two-pass line is unbiased,
    # so the SIGNED error has to sit on zero, not merely be small in magnitude
    assert abs(float(np.median((g - ground_true)[gnd & fin]))) < 0.10, \
        "two-pass ground line is biased even at 0.25 m spread"

    # ground line returns NaN outside the populated span rather than np.interp's
    # flat extrapolation, and building_heights tolerates that NaN
    assert int((~fin).sum()) > 0, "no photon fell outside the populated span"
    assert float((~fin).mean()) < 0.02, "far too many photons ruled out of span"
    g_edge = ground_line(np.array([-5.0e3, 0.0, 5.0e3]), s_true[gnd], h[gnd])
    assert np.isnan(g_edge[0]) and np.isnan(g_edge[2]) and np.isfinite(g_edge[1]), \
        "ground line extrapolated flat instead of returning NaN"

    hag = h - g
    assert np.isnan(hag).any(), "self-test never exercises the NaN path"
    assert 10.5 < float(np.median(hag[in_a])) < 13.5, "roof A height wrong"
    assert 28.0 < float(np.median(hag[in_b])) < 32.0, "roof B height wrong"
    # unbiased ground → the roof medians land on truth, not 1.28 sigma above it
    assert abs(float(np.median(hag[in_a])) - 12.0) < 0.3, "roof A inflated"
    assert abs(float(np.median(hag[in_b])) - 30.0) < 0.3, "roof B inflated"

    # THE BIAS CASE. 1.0 m ground spread — the p10 line sits ~1.28x the spread
    # below truth, which a 0.25 m spread hides — plus street trees 4-8 m up,
    # outside every footprint, the contamination the low quantile exists for.
    r2 = np.random.default_rng(21)
    m = 12000
    s2 = r2.uniform(-700.0, 700.0, m)
    t2 = 6.0 + 0.002 * s2
    h2 = t2 + r2.normal(0.0, 1.0, m)
    tree = r2.random(m) < 0.12
    h2[tree] = t2[tree] + r2.uniform(4.0, 8.0, int(tree.sum()))
    g2 = ground_line(s2, s2, h2)
    f2 = np.isfinite(g2)
    bias = float(np.median((g2 - t2)[f2]))
    assert abs(bias) < 0.25, \
        f"ground line biased by {bias:+.2f} m at a 1.0 m spread — pass 2 is not working"
    assert float(np.max(np.abs((g2 - t2)[f2]))) < 1.0, "a window ran away"

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

    # a degenerate ring is repaired, not ballooned, by the dilation: this one is
    # a 30 m square with a zero-width spike out to x=200, and the photon at
    # (100, 2) is 70 m clear of the real building
    spike = [0.0, 0.0, 30.0, 0.0, 30.0, 30.0, 0.0, 30.0, 0.0, 0.0, 200.0, 0.0]
    s_idx, s_kept = assign_footprints(np.array([100.0, 15.0]), np.array([2.0, 15.0]),
                                      [spike], ERODE_M)
    assert s_kept == [0], "repaired ring vanished"
    assert s_idx[1] == 0, "repaired ring lost its real interior"
    assert s_idx[0] == -1, "unrepaired ring swallowed a photon 70 m outside it"
    # an odd-length ring is refused, not silently truncated by zip — and it is
    # refused as a RingError, so a caller can tell whole-ward geometry corruption
    # apart from ground_line's per-pass "too few populated windows" ValueError
    # instead of filing the first under the second
    try:
        assign_footprints(np.array([0.0]), np.array([0.0]),
                          [[0.0, 0.0, 10.0, 0.0, 10.0]], -1.0)
    except RingError:
        pass
    except ValueError:
        raise AssertionError("odd ring raised a bare ValueError, "
                             "indistinguishable from a per-pass data shortfall")
    else:
        raise AssertionError("assign_footprints accepted an odd-length ring")
    assert issubclass(RingError, ValueError), "RingError must stay a ValueError"
    try:                                    # ... and ground_line's is NOT one
        ground_line(np.array([0.0]), np.array([0.0]), np.array([0.0]))
    except RingError:
        raise AssertionError("ground_line's data shortfall raised RingError")
    except ValueError:
        pass
    else:
        raise AssertionError("ground_line accepted a single candidate")

    est = building_heights(idx, hag)
    assert set(est) <= {0, 1}
    assert 11.0 < est[0] < 13.5 and 29.0 < est[1] < 31.5
    # MIN_ROOF_PH is 5 so that p75 never weights the single highest photon
    assert MIN_ROOF_PH == 5
    assert float(np.quantile(np.arange(5.0), 0.75)) == 3.0, \
        "p75 at n=5 no longer lands on the second-highest photon"
    assert building_heights(np.zeros(4, dtype=np.int64), np.full(4, 10.0)) == {}, \
        "a 4-photon building contributed a height"
    assert building_heights(np.zeros(5, dtype=np.int64), np.full(5, 10.0)) == {0: 10.0}
    # `band` overrides the roof band without touching the shipped constant, so
    # the floor-sensitivity measurement is possible and ROOF_BAND_M stays put
    low = np.array([0.5, 0.7, 0.9, 1.1, 1.3])
    assert building_heights(np.zeros(5, dtype=np.int64), low) == {}, \
        "photons below the 2.0 m floor contributed at the default band"
    assert building_heights(np.zeros(5, dtype=np.int64), low,
                            band=(0.0, 120.0)).keys() == {0}, \
        "band override did not admit the sub-floor photons"
    assert ROOF_BAND_M == (2.0, 120.0), "the shipped roof band moved"

    # ground_line refuses misaligned candidate arrays
    try:
        ground_line(s_true, s_true[gnd], h[gnd][:-1])
    except ValueError:
        pass
    else:
        raise AssertionError("ground_line accepted misaligned s_gnd/h_gnd")

    # bootstrap: a known +2 m bias is recovered with a CI that excludes zero
    theirs = rng.normal(10.0, 4.0, 60)
    ours = theirs + 2.0 + rng.normal(0.0, 0.5, 60)
    qb = quantile_bias(ours, theirs, np.random.default_rng(11))
    assert 1.5 < qb["median_bias_m"] < 2.5
    lo, hi = qb["median_ci95_m"]
    assert lo > 0.0, "CI fails to exclude zero on a real bias"
    # every published statistic carries its own labelled CI; no bare ci95_m
    assert "ci95_m" not in qb and "ks_p" not in qb, "unlabelled/invalid key survived"
    # values come back UNROUNDED, so the caller's pre-registered thresholds are
    # tested against the measurement rather than against its 2 dp presentation.
    # Rounding here would put a true bias of 3.195 m on the wrong side of the
    # spec's 3.2 m `biased` boundary.
    exact = float(np.quantile(ours, 0.5) - np.quantile(theirs, 0.5))
    assert qb["median_bias_m"] == exact, "median_bias_m was rounded in place"
    assert abs(exact - round(exact, 2)) > 1e-9, \
        "median_bias_m happens to be a 2 dp value here, so the test above " \
        "cannot tell rounding from exactness — pick different fixture data"
    for name in ("median", "p65", "p90"):
        c_lo, c_hi = qb[f"{name}_ci95_m"]
        assert c_lo < qb[f"{name}_bias_m"] < c_hi, f"{name} CI does not bracket it"
        assert c_lo > 0.0, f"{name} CI fails to exclude zero on a real bias"

    # the vectorised D matches scipy's, so the permutation null is the real KS null
    from scipy.stats import ks_2samp
    ref = float(ks_2samp(ours, theirs).statistic)
    assert abs(qb["ks_d"] - ref) < 1e-12, f"ks_d {qb['ks_d']} vs scipy {ref}"
    tied_a, tied_b = np.array([1.0, 2.0, 2.0, 3.0, 5.0]), np.array([2.0, 2.0, 4.0, 5.0, 6.0])
    assert abs(float(_ks_stat(tied_a[None, :], tied_b[None, :])[0])
               - float(ks_2samp(tied_a, tied_b).statistic)) < 1e-12, "_ks_stat wrong under ties"

    # the paired permutation test rejects a real shift ...
    assert qb["perm_p"] < 0.01, f"permutation test missed a +2 m shift: {qb['perm_p']}"
    # ... and does NOT reject correlated pairs that differ only by noise — the
    # case where ks_2samp's independence assumption made it unable to reject at all
    base = rng.normal(10.0, 4.0, 60)
    null_ours = base + rng.normal(0.0, 0.5, 60)
    null_theirs = base + rng.normal(0.0, 0.5, 60)
    qn = quantile_bias(null_ours, null_theirs, np.random.default_rng(13))
    assert qn["perm_p"] > 0.05, f"permutation test rejects H0 pairs: {qn['perm_p']}"

    # misaligned or too-small samples are refused, never silently "paired"
    for bad in ((ours, theirs[:40]), (ours[:1], theirs[:1]), (ours[:4], theirs[:4])):
        try:
            quantile_bias(bad[0], bad[1], np.random.default_rng(3), boots=50, perms=50)
        except ValueError:
            pass
        else:
            raise AssertionError(f"quantile_bias accepted n={bad[0].size}/{bad[1].size}")

    # geoid: two direct tests, and each raises ValueError — not AssertionError,
    # which `python3 -O` would delete along with the whole gate. The numbers are
    # the real ones: ATL03 reads -56.947 over Ballygunge, our constant is -56.95,
    # and the measured laser ground line sits near 4.8 m.
    check_geoid(4.8, -56.95, -56.947)                  # constant right, ground plausible
    for bad_g, tag, mode in (
            ((-52.1, -56.95, -56.947), "G1b", "conversion skipped — still ellipsoidal"),
            ((61.6, -56.95, -56.947), "G1b", "sign flipped — h_ellip + |N|"),
            ((4.8, -3.00, -56.947), "G1a", "wrong-magnitude constant"),
            ((31.0, -56.95, -56.947), "G1b", "ground line climbed onto the roofs")):
        try:
            check_geoid(*bad_g)
        except ValueError as e:
            # pins the docstring's division of labour: G1a fires only on the
            # constant, G1b only on the height
            assert str(e).startswith(tag), f"{mode}: caught by the wrong test — {e}"
        else:
            raise AssertionError(f"check_geoid accepted {bad_g} ({mode})")
    # NaN fails CLOSED on both tests — the way an unbypassable gate quietly dies
    for nan_g in ((float("nan"), -56.95, -56.947), (4.8, -56.95, float("nan"))):
        try:
            check_geoid(*nan_g)
        except ValueError:
            pass
        else:
            raise AssertionError(f"check_geoid accepted a NaN: {nan_g}")
    # G1a's tolerance is a real bound: 0.40 m through, 0.60 m stopped
    check_geoid(4.8, -56.55, -56.947)
    for bound_g in ((4.8, -56.35, -56.947),            # constant 0.60 m off
                    (-2.5, -56.95, -56.947),           # ground just under the band
                    (25.5, -56.95, -56.947)):          # ground just over the band
        try:
            check_geoid(*bound_g)
        except ValueError:
            pass
        else:
            raise AssertionError(f"check_geoid accepted {bound_g} at the boundary")

    print("  _icesat2 self-test OK")


if __name__ == "__main__":
    _self_test()
