#!/usr/bin/env python3
"""9.3 — alignment dry-run for the Gaussian-splat view. NO CAPTURE REQUIRED.

Plan: docs/superpowers/plans/2026-08-09-gaussian-splat-view-parked.md §6, §9.3

THE QUESTION. A splat reconstruction of a Kolkata street arrives in its own
arbitrary frame. Decision D6 says we do NOT georeference it with GPS (3-5 m,
against 7.4 m sim cells) — we fit its building footprints onto our Overture
footprints, the way the north-south mirror was settled by a pond fit. Before
anyone captures anything: can that fit actually recover a transform?

METHOD. Take real Overture centroids, apply a KNOWN similarity transform,
degrade them the way a real reconstruction would be degraded, throw away the
correspondence, and see whether trimmed ICP gets the known transform back.

THE FAILURE MODE THIS IS BUILT TO CATCH. Median building spacing in these wards
is 10-12 m; a GPS prior is 3-5 m off. That is half a building spacing, so ICP
can lock onto the WRONG neighbour, converge happily, and report a small
residual while sitting one building off. A residual check alone would pass it.

    => We know the true transform, so we score RECOVERY, not residual.
       A small residual with a large recovery error is the dangerous case and
       is reported separately as LATCHED-WRONG.

Run:  python3 scripts/splat-align-dryrun.py
      python3 scripts/splat-align-dryrun.py --diagnose     (isolate H1 vs H2)
      python3 scripts/splat-align-dryrun.py --self-check
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import NamedTuple, cast

import numpy as np
from scipy.spatial import cKDTree

import _types
from _types import F64, Mask, WardId

GEOM = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "data", "geometry")

# Pre-registered acceptance bar (plan §6). Fixed before any number was seen.
BAR_MEDIAN_M = 1.0
BAR_P95_M = 2.5
# Recovery bar: the fit must land the transform itself this close to truth.
# Half the median building spacing (~10-12 m) is where a one-building-off
# solution becomes possible, so we demand far better.
BAR_RECOVERY_M = 1.0

# A capture is a walk, not a survey: the reconstruction covers a slice of the
# ward but is matched against every footprint we hold.
Region = Callable[[F64], Mask]


class Similarity(NamedTuple):
    """2-D similarity: x -> s * x @ R.T + t. A NamedTuple rather than a bare
    3-tuple because four call sites unpack it and a swapped R/t would otherwise
    be a silent broadcast rather than an error."""
    s: float
    R: F64
    t: F64


class Score(NamedTuple):
    median_m: float
    p95_m: float
    recovery_m: float


@dataclass(frozen=True)
class Scenario:
    """A frozen dataclass, not a 7-tuple: the tuple form put `noise`, `drop` and
    `spurious` adjacent and positional, which is exactly where a column-order
    slip hides."""
    name: str
    region: Region | None
    gps_m: float
    heading_deg: float
    noise_m: float
    drop: float
    spurious: float


def centroids(ward: WardId) -> F64:
    """Overture footprint centroids in ward-local metres (+y = north)."""
    with open(os.path.join(GEOM, f"{ward}-footprints.json"), encoding="utf-8") as fh:
        doc = cast(_types.FootprintsFile, json.load(fh))
    # Vertex mean, not area centroid: both sides of this test use the same
    # definition, so the choice cancels. A real reconstruction would polygonalise
    # differently — that discrepancy is modelled by `noise_m`, not by this.
    return np.array([np.array(b["p"], dtype=np.float64).reshape(-1, 2).mean(0)
                     for b in doc["b"]], dtype=np.float64)


def similarity(theta_deg: float, scale: float, tx: float, ty: float) -> Similarity:
    t = math.radians(theta_deg)
    R = np.array([[math.cos(t), -math.sin(t)],
                  [math.sin(t), math.cos(t)]], dtype=np.float64)
    return Similarity(scale, R, np.array([tx, ty], dtype=np.float64))


def apply_sim(P: F64, m: Similarity) -> F64:
    return m.s * P @ m.R.T + m.t


def umeyama_2d(A: F64, B: F64) -> Similarity:
    """Least-squares similarity mapping A onto B."""
    ca, cb = A.mean(0), B.mean(0)
    X, Y = A - ca, B - cb
    U, S, Vt = np.linalg.svd(X.T @ Y / len(A))
    D = np.eye(2, dtype=np.float64)
    if np.linalg.det(U @ Vt) < 0:          # reflection guard — a mirrored fit is
        D[1, 1] = -1.0                      # exactly the bug we shipped once already
    R = cast(F64, (U @ D @ Vt).T)
    var = float((X ** 2).sum() / len(A))
    s = float((S * np.diag(D)).sum() / var) if var > 0 else 1.0
    return Similarity(s, R, cast(F64, cb - s * R @ ca))


def icp(src: F64, dst: F64, init: Similarity,
        trim: float = 0.8, iters: int = 60, tol: float = 1e-6) -> Similarity:
    """Trimmed ICP. `trim` = fraction of best-matching pairs kept per iteration,
    which is what lets it survive missing and spurious buildings."""
    fit = init
    tree = cKDTree(dst)
    prev: float | None = None
    for _ in range(iters):
        # cKDTree.query is overloaded scalar-or-array; we always pass a (n, 2)
        # array, so narrow explicitly rather than let the union propagate.
        raw_dist, raw_idx = tree.query(apply_sim(src, fit))
        dist = np.asarray(raw_dist, dtype=np.float64)
        idx = np.asarray(raw_idx, dtype=np.intp)
        keep = np.argsort(dist)[: max(3, int(trim * len(dist)))]
        fit = umeyama_2d(src[keep], dst[idx[keep]])
        rms = float(np.sqrt((dist[keep] ** 2).mean()))
        if prev is not None and abs(prev - rms) < tol:
            break
        prev = rms
    return fit



def global_align(src: F64, dst: F64, anchor: F64, *, scale: float,
                 span_deg: float = 180.0, coarse_deg: float = 2.0,
                 fine_deg: float = 0.25, inlier_m: float = 6.0,
                 probe: int = 400) -> Similarity:
    """Coarse rotation search, then ICP refine.

    WHY THIS EXISTS. The diagnosis (--diagnose, H1/H3) showed ICP-from-a-compass-
    prior is bimodal and needs heading accurate to 1-2 deg. Phone magnetometers
    are +/-5-15 deg, so the compass cannot be on the critical path. This searches
    rotation instead of trusting it: score each candidate by INLIER COUNT — which
    is robust to the spurious and missing buildings a reconstruction produces, in
    a way least-squares residual is not — then hand the winner to ICP.

    `anchor` is where GPS says the captured buildings are centred, and each
    candidate's translation puts the rotated cloud's MEAN there.

    It must be the mean, NOT the median. The median is not rotation-equivariant —
    measured at 10-30 m of error on a realistically skewed cloud, i.e. one to
    three building spacings — so a median anchor leaves the translation wrong even
    at the CORRECT angle, and the true angle then scores no better than a false
    one. Reaching for the median as "robust to floaters" made this search perform
    worse than the compass prior it was meant to replace. The mean is exact:
    mean(R·x) == R·mean(x).
    """
    step = max(1, len(src) // probe)
    sample = src[::step]          # for SCORING only
    src_centre = src.mean(0, keepdims=True)   # TRANSLATION: full set, never the sample
    tree = cKDTree(dst)

    def best_over(angles: F64) -> tuple[float, Similarity]:
        best_score = -1.0
        best: Similarity = similarity(0.0, scale, 0.0, 0.0)
        for theta in angles:
            rot = similarity(float(theta), scale, 0.0, 0.0)
            # Anchor the FULL cloud's mean, never the sample's. `anchor` describes
            # where all the captured buildings sit; a random subsample's mean
            # differs from the full mean by ~sigma/sqrt(n) — measured at ~19 m
            # here, two building spacings — which silently destroyed the
            # alignment even at the exactly correct angle.
            cand = Similarity(rot.s, rot.R,
                              anchor - apply_sim(src_centre, rot)[0])
            dist, _ = tree.query(apply_sim(sample, cand))
            inliers = float(np.count_nonzero(np.asarray(dist) <= inlier_m))
            if inliers > best_score:
                best_score, best = inliers, cand
        return best_score, best

    _, coarse = best_over(np.arange(-span_deg, span_deg, coarse_deg, dtype=np.float64))
    theta0 = math.degrees(math.atan2(coarse.R[1, 0], coarse.R[0, 0]))
    _, fine = best_over(np.arange(theta0 - coarse_deg, theta0 + coarse_deg,
                                  fine_deg, dtype=np.float64))
    return icp(src, dst, fine)


def simulate(truth: F64, rng: np.random.Generator, *, tf: Similarity,
             noise_m: float, drop: float, spurious: float,
             region: Region | None = None) -> tuple[F64, F64]:
    """Build what a reconstruction would hand us: a subset of buildings, moved by
    an unknown transform, noisy, with holes and floaters, and NO correspondence.

    Returns (observed, source) — `source` being the truth subset the capture came
    from. The caller needs it to build an honest GPS prior: a GPS fix says where
    the SURVEYOR stood, i.e. near the captured buildings, NOT the ward origin.
    Anchoring the prior at the origin instead was a real bug in this file: the
    ward's building centroid is ~92 m off-origin, which is eight building
    spacings, and it made every scenario fail for a reason that had nothing to do
    with the method under test.
    """
    P = truth if region is None else truth[region(truth)]
    P = P[rng.random(len(P)) > drop]                  # trees/occlusion hide some
    obs = apply_sim(P, tf) + rng.normal(0.0, noise_m, (len(P), 2))
    n_spurious = int(spurious * len(obs))
    if n_spurious:                                    # floaters read as buildings
        lo, hi = obs.min(0), obs.max(0)
        obs = np.vstack([obs, rng.uniform(lo, hi, (n_spurious, 2))])
    rng.shuffle(obs)                                  # correspondence destroyed
    return obs, P


# Probe points spanning the ward. Recovery is measured by round-tripping these
# through true-then-fit: zero displacement iff the fit inverts the truth.
PROBE: F64 = np.array([[0.0, 0.0], [600.0, 0.0], [0.0, 600.0], [-600.0, -600.0]],
                      dtype=np.float64)


def score(truth: F64, obs: F64, fit: Similarity, true_tf: Similarity) -> Score:
    dist, _ = cKDTree(truth).query(apply_sim(obs, fit))
    residual = np.asarray(dist, dtype=np.float64)
    round_trip = apply_sim(apply_sim(PROBE, true_tf), fit)
    return Score(float(np.median(residual)),
                 float(np.percentile(residual, 95)),
                 float(np.abs(round_trip - PROBE).max()))


def corridor(width_m: float) -> Region:
    """A capture is a walk down a street, not a survey of a ward — the points land
    in a narrow band, which makes rotation poorly conditioned. This is the
    geometry Phase 2 actually produces."""
    def pick(P: F64) -> Mask:
        return np.abs(P[:, 1]) < width_m / 2
    return pick


def cluster(radius_m: float) -> Region:
    """Phase 1 geometry: one courtyard."""
    def pick(P: F64) -> Mask:
        return cast(Mask, np.linalg.norm(P, axis=1) < radius_m)
    return pick


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("whole ward",              None,          4.0,  3.0, 1.0, 0.10, 0.05),
    Scenario("corridor 200 m",          corridor(200), 4.0,  3.0, 1.0, 0.15, 0.10),
    Scenario("corridor 80 m",           corridor(80),  4.0,  3.0, 1.0, 0.15, 0.10),
    Scenario("courtyard r=60 m",        cluster(60),   4.0,  3.0, 1.0, 0.15, 0.10),
    Scenario("corridor 80 m, bad GPS",  corridor(80), 12.0, 10.0, 1.0, 0.15, 0.10),
    Scenario("corridor 80 m, noisy",    corridor(80),  4.0,  3.0, 3.0, 0.30, 0.25),
)


def trial(truth: F64, sc: Scenario, rng: np.random.Generator,
          method: str = "compass") -> tuple[Score, int] | None:
    """One synthetic capture-and-fit. None if the region left too few buildings.

    `method` — "compass" trusts a heading prior and runs ICP straight from it;
    "global" searches rotation and never reads the compass at all.
    """
    true_tf = similarity(rng.uniform(-180, 180),      # frame is arbitrary
                         rng.uniform(0.94, 1.06),     # monocular SfM scale drift
                         *rng.uniform(-300, 300, 2))
    obs, source = simulate(truth, rng, tf=true_tf, noise_m=sc.noise_m,
                           drop=sc.drop, spurious=sc.spurious, region=sc.region)
    if len(obs) < 8:
        return None
    # The GPS fix anchors on where the surveyor stood — the captured buildings —
    # not the ward origin. See simulate()'s docstring for why that matters.
    anchor = source.mean(0) + rng.normal(0.0, sc.gps_m, 2)
    if method == "global":
        fit = global_align(obs, truth, anchor, scale=1.0 / true_tf.s)
    else:
        guess_rot = similarity(
            -math.degrees(math.atan2(true_tf.R[1, 0], true_tf.R[0, 0]))
            + rng.normal(0.0, sc.heading_deg), 1.0 / true_tf.s, 0.0, 0.0)
        centre = obs.mean(0, keepdims=True)
        guess = Similarity(guess_rot.s, guess_rot.R,
                           cast(F64, anchor - apply_sim(centre, guess_rot)[0]))
        fit = icp(obs, truth, guess)
    return score(truth, obs, fit, true_tf), len(obs)


def run(ward: WardId = "ballygunge", trials: int = 48, seed: int = 20260809) -> int:
    truth = centroids(ward)
    print(f"\n  9.3 ALIGNMENT DRY-RUN — {ward}, {len(truth)} Overture footprints")
    print(f"  recovery bar <= {BAR_RECOVERY_M} m. ICP is bimodal (exact or wrong")
    print(f"  basin), so the statistic is % of {trials} trials that recover.\n")
    print(f"  {'scenario':<26} {'n':>5}   {'compass prior':>14}   {'global search':>14}")
    print("  " + "-" * 72)
    latched: list[str] = []
    for sc in SCENARIOS:
        rates: dict[str, float] = {}
        n = 0
        for method in ("compass", "global"):
            rng = np.random.default_rng(seed)
            got = [t for t in (trial(truth, sc, rng, method) for _ in range(trials))
                   if t is not None]
            if not got:
                rates[method] = float("nan")
                continue
            n = int(np.median([g[1] for g in got]))
            rates[method] = 100.0 * sum(
                1 for g in got if g[0].recovery_m <= BAR_RECOVERY_M) / len(got)
            # The dangerous case: residual looks fine, transform is wrong.
            if method == "global" and any(
                    g[0].median_m <= BAR_MEDIAN_M and g[0].recovery_m > BAR_RECOVERY_M
                    for g in got):
                latched.append(sc.name)
        print(f"  {sc.name:<26} {n:>5}   {rates['compass']:>13.0f}%   "
              f"{rates['global']:>13.0f}%")
    print()
    if latched:
        print("  NOTE — some trials met the residual bar while recovering the WRONG")
        print("  transform. Residual alone would have shipped them:")
        for name in sorted(set(latched)):
            print(f"    - {name}")
        print()
    return 0


def diagnose(ward: WardId = "ballygunge", trials: int = 12, seed: int = 20260809) -> int:
    """Isolate the two hypotheses for why every scenario failed (plan Task 3)."""
    truth = centroids(ward)
    print(f"\n  9.3 DIAGNOSIS — {ward}\n")

    print("  H1: does heading error alone break it? "
          "(whole ward, no drop/spurious/noise)")
    print(f"    {'heading':>9}  {'median':>8} {'recovery':>9}")
    for heading in (0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0):
        sc = Scenario("h1", None, 0.0, heading, 0.0, 0.0, 0.0)
        rng = np.random.default_rng(seed)
        got = [t for t in (trial(truth, sc, rng) for _ in range(trials)) if t is not None]
        med = float(np.median([g[0].median_m for g in got]))
        rec = float(np.median([g[0].recovery_m for g in got]))
        print(f"    {heading:>8.1f}°  {med:>7.2f}m {rec:>8.2f}m")

    print("\n  H2: is corridor failure a slide ALONG the street?")
    print(f"    {'width':>9}  {'along':>8} {'across':>8}   (recovery decomposed)")
    for width in (80.0, 200.0, 400.0, 1400.0):
        sc = Scenario("h2", corridor(width), 0.0, 0.0, 0.0, 0.0, 0.0)
        rng = np.random.default_rng(seed)
        along: list[float] = []
        across: list[float] = []
        for _ in range(trials):
            true_tf = similarity(rng.uniform(-180, 180), 1.0, *rng.uniform(-300, 300, 2))
            obs, source = simulate(truth, rng, tf=true_tf, noise_m=0.0, drop=0.0,
                                   spurious=0.0, region=sc.region)
            if len(obs) < 8:
                continue
            guess_rot = similarity(
                -math.degrees(math.atan2(true_tf.R[1, 0], true_tf.R[0, 0])), 1.0, 0.0, 0.0)
            centre = obs.mean(0, keepdims=True)
            guess = Similarity(guess_rot.s, guess_rot.R,
                               cast(F64, source.mean(0) - apply_sim(centre, guess_rot)[0]))
            fit = icp(obs, truth, guess)
            # The corridor runs along +x, so decompose in the ward frame.
            delta = apply_sim(apply_sim(PROBE, true_tf), fit) - PROBE
            along.append(float(np.abs(delta[:, 0]).max()))
            across.append(float(np.abs(delta[:, 1]).max()))
        if along:
            print(f"    {width:>8.0f}m  {np.median(along):>7.2f}m {np.median(across):>7.2f}m")

    # ICP is BIMODAL — it either recovers the transform exactly (~0.00 m) or
    # falls into a wrong basin (20-80 m), with nothing in between. A median over
    # trials therefore only reports "did more than half converge", which reads as
    # a non-monotonic mess. Success RATE is the honest statistic for this shape.
    print("\n  H3: heading x geometry — % of trials that RECOVER "
          f"(<= {BAR_RECOVERY_M} m), {trials * 4} trials/cell")
    print("  ICP is bimodal: exact recovery or a wrong basin, no middle ground.")
    headings = (0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 7.0)
    print("    " + f"{'geometry':<18}" + "".join(f"{h:>7.0f}°" for h in headings))
    for label, region in (("whole ward", None),
                          ("corridor 400 m", corridor(400)),
                          ("corridor 200 m", corridor(200)),
                          ("corridor 80 m", corridor(80)),
                          ("courtyard r=60 m", cluster(60))):
        cells: list[str] = []
        for heading in headings:
            sc = Scenario("h3", region, 0.0, heading, 0.0, 0.0, 0.0)
            rng = np.random.default_rng(seed)
            got = [t for t in (trial(truth, sc, rng) for _ in range(trials * 4))
                   if t is not None]
            if not got:
                cells.append(f"{'-':>7}")
                continue
            hit = sum(1 for g in got if g[0].recovery_m <= BAR_RECOVERY_M)
            cells.append(f"{100.0 * hit / len(got):>6.0f}%")
        print(f"    {label:<18}" + "".join(cells))

    print("\n  Ablation: which degradation dominates? (whole ward, heading 0)")
    print(f"    {'variant':<22} {'median':>8} {'recovery':>9}")
    for name, noise, drop, spur in (("clean", 0.0, 0.0, 0.0),
                                    ("noise 1 m", 1.0, 0.0, 0.0),
                                    ("noise 3 m", 3.0, 0.0, 0.0),
                                    ("drop 15%", 0.0, 0.15, 0.0),
                                    ("drop 30%", 0.0, 0.30, 0.0),
                                    ("spurious 10%", 0.0, 0.0, 0.10),
                                    ("spurious 25%", 0.0, 0.0, 0.25)):
        sc = Scenario(name, None, 0.0, 0.0, noise, drop, spur)
        rng = np.random.default_rng(seed)
        got = [t for t in (trial(truth, sc, rng) for _ in range(trials)) if t is not None]
        med = float(np.median([g[0].median_m for g in got]))
        rec = float(np.median([g[0].recovery_m for g in got]))
        print(f"    {name:<22} {med:>7.2f}m {rec:>8.2f}m")
    print()
    return 0


def self_check() -> None:
    """One runnable check that fails if the fit logic breaks."""
    rng = np.random.default_rng(7)
    A = rng.uniform(-500, 500, (400, 2))
    tf = similarity(37.0, 1.05, 120.0, -80.0)
    fit = umeyama_2d(A, apply_sim(A, tf))
    assert abs(fit.s - tf.s) < 1e-9, f"umeyama scale {fit.s} != {tf.s}"
    assert np.allclose(fit.R, tf.R, atol=1e-9), "umeyama rotation wrong"
    assert np.allclose(fit.t, tf.t, atol=1e-6), "umeyama translation wrong"
    assert np.linalg.det(fit.R) > 0, "umeyama returned a reflection"

    # ICP must recover a known transform with no correspondence.
    truth = centroids("ballygunge")
    true_tf = similarity(25.0, 1.0, 60.0, 40.0)
    obs = apply_sim(truth, true_tf)
    rng.shuffle(obs)
    inv = similarity(-25.0, 1.0, 0.0, 0.0)
    guess = Similarity(inv.s, inv.R,
                       cast(F64, -apply_sim(obs.mean(0, keepdims=True), inv)[0]
                            + truth.mean(0)))
    assert score(truth, obs, icp(obs, truth, guess), true_tf).recovery_m < 0.5, \
        "ICP failed to recover a clean known transform"

    # A mirrored input must NOT be fitted by a rotation — the mirror bug, as a test.
    mirrored = truth.copy()
    mirrored[:, 1] *= -1
    fit_m = umeyama_2d(mirrored, truth)
    assert np.linalg.det(fit_m.R) > 0, "similarity fit must never return a reflection"
    resid = np.linalg.norm(apply_sim(mirrored, fit_m) - truth, axis=1)
    assert float(np.median(resid)) > 50.0, \
        "a north-south mirror must not fit as a rotation"
    print("  self-check OK (umeyama exact, ICP recovers, mirror refused)")


def main(argv: list[str]) -> int:
    self_check()
    if "--self-check" in argv:
        return 0
    if "--diagnose" in argv:
        return diagnose()
    return run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
