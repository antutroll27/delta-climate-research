"""Measure what the flood solver's output is and is not stable under.

WHY THIS EXISTS AS A SCRIPT. The stability numbers quoted in
`flood_unsteady.py` came from an ad-hoc run that was never committed, on the
old 7.68 km inland window, and — as found on 2026-08-26 — over a domain that
was one-third Persian Gulf with no permanent-water mask. Three separate reasons
the figures could not be trusted, and no way to re-derive them without redoing
the work from memory. A claim about accuracy that cannot be re-run is not a
measurement, so this is the harness that produces those numbers.

WHAT IS BEING TESTED. Not "is the model right" — there is no observed depth
field for Dubai to score against (BUILD-SPEC: no gauge network, and the 2024
district list that circulates is Gulf News 2018). What is testable is whether
the answer SURVIVES the terrain's own error bar. DeltaDTM states MAE 0.43 m,
and DEM error is spatially correlated rather than white, so the ensemble
perturbs with a 400 m correlation length and asks which outputs move.

THE EXPECTED RESULT IS A SPLIT, AND THE SPLIT IS THE POINT. Aggregates
(how much floods, how deep) are expected to hold; the spatial pattern (which
cell floods) is expected to move. If that is what comes out, the defensible
product claim is district-scale, and this file is the evidence for saying so.
White noise is run alongside as a contrast: it is NOT how DEMs err, and it
should look worse, which is what makes the correlated figure meaningful.

    python3 scripts/validate-flood-stability.py --realisations 5 --workers 8
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Any

import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flood_unsteady import runoff_field, sea_mask, simulate  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")

# DeltaDTM v1.1 stated vertical accuracy, and the correlation length band that
# §3a used. Perturbing at the DEM's own error is the whole design: a larger
# sigma would manufacture instability, a smaller one would hide it.
SIGMA_M = 0.43
CORR_M = 400.0
WET_M = 0.10          # the access-disruption threshold from types.ts
RAIN_MM = 254.8       # Dubai, 16 April 2024 — the event with a measured runoff ratio


def correlated_noise(shape: tuple[int, int], sigma_m: float, corr_m: float,
                     cell_m: float, seed: int) -> np.ndarray[Any, Any]:
    """Gaussian field with a target point sigma and correlation length.

    Verified on construction: smoothing white noise sets the length scale but
    shrinks the variance, so it is rescaled back to the point sigma afterwards.
    """
    rng = np.random.default_rng(seed)
    if corr_m <= 0.0:
        out: np.ndarray[Any, Any] = rng.normal(0.0, sigma_m, shape)
        return out
    f = gaussian_filter(rng.normal(0.0, 1.0, shape), corr_m / cell_m / 2.0, mode="reflect")
    scaled: np.ndarray[Any, Any] = f * (sigma_m / float(f.std()))
    return scaled


def _run(job: tuple[str, int, float, float]) -> tuple[str, int, np.ndarray[Any, Any]]:
    """One realisation. Module-level and self-loading so it survives spawn()."""
    kind, seed, sigma, corr = job
    d = json.load(open(os.path.join(DATA, "dubai-creek-terrain.json")))
    n = int(d["n"])
    cell = float(d["cellM"])
    z = np.asarray(d["h"], dtype="float64").reshape(n, n)
    bcr = np.asarray(d["bcr"], dtype="float64").reshape(n, n)

    # THE SEA MASK IS BUILT FROM THE UNPERTURBED SURFACE, deliberately. Rebuilding
    # it per realisation would let noise redraw the coastline, so the ensemble
    # would be measuring an unstable mask rather than an unstable flood pattern.
    sink = sea_mask(z)
    if seed >= 0:
        z = z + correlated_noise((n, n), sigma, corr, cell, seed)

    peak, _, _, _ = simulate(z, bcr, runoff_field(RAIN_MM, bcr), cell=cell, sink=sink)
    return kind, seed, peak.astype("float32")


def metrics(base: np.ndarray[Any, Any], other: np.ndarray[Any, Any],
            land: np.ndarray[Any, Any]) -> dict[str, float]:
    """Aggregate and pattern agreement, over LAND cells only."""
    b, o = base[land], other[land]
    wb, wo = b > WET_M, o > WET_M
    inter = float((wb & wo).sum())
    union = float((wb | wo).sum())
    either = wb | wo
    corr = 0.0
    if either.sum() > 2:
        be, oe = b[either], o[either]
        if be.std() > 0 and oe.std() > 0:
            corr = float(np.corrcoef(be, oe)[0, 1])
    return {
        "wetFraction": float(wo.mean()),
        "p95M": float(np.percentile(o, 95)),
        "meanDepthM": float(o.mean()),
        "csi": inter / union if union > 0 else 1.0,
        "depthCorr": corr,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--realisations", type=int, default=5)
    ap.add_argument("--white", type=int, default=3, help="white-noise contrast runs")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--out", default=os.path.join(DATA, "..", "flood-stability.json"))
    a = ap.parse_args()

    d = json.load(open(os.path.join(DATA, "dubai-creek-terrain.json")))
    n = int(d["n"])
    z = np.asarray(d["h"], dtype="float64").reshape(n, n)
    sink = sea_mask(z)
    land = ~sink
    print(f"  grid {n}x{n}  sea {sink.mean()*100:.2f} %  land {land.sum():,} cells")
    print(f"  rain {RAIN_MM} mm, perturbation sigma {SIGMA_M} m @ {CORR_M:.0f} m correlation")

    jobs: list[tuple[str, int, float, float]] = [("base", -1, 0.0, 0.0)]
    jobs += [("correlated", i, SIGMA_M, CORR_M) for i in range(a.realisations)]
    jobs += [("white", 900 + i, SIGMA_M, 0.0) for i in range(a.white)]
    print(f"  {len(jobs)} runs on {a.workers} workers\n")

    t0 = time.time()
    results: dict[str, list[np.ndarray[Any, Any]]] = {"correlated": [], "white": []}
    base: np.ndarray[Any, Any] | None = None
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for kind, seed, peak in ex.map(_run, jobs):
            if kind == "base":
                base = peak
            else:
                results[kind].append(peak)
            print(f"    {kind:11s} seed {seed:>4}  done  ({time.time()-t0:6.0f} s)")
    assert base is not None, "baseline realisation did not return"

    bm = metrics(base, base, land)
    print(f"\n  BASELINE (unperturbed, land only)")
    print(f"    wet fraction {bm['wetFraction']*100:6.2f} %   p95 {bm['p95M']:.3f} m   "
          f"mean {bm['meanDepthM']:.4f} m   max {base[land].max():.2f} m")

    report: dict[str, Any] = {
        "site": d["site"], "rainMm": RAIN_MM, "wetThresholdM": WET_M,
        "sigmaM": SIGMA_M, "correlationM": CORR_M,
        "seaFraction": float(sink.mean()), "landCells": int(land.sum()),
        "baseline": bm, "ensembles": {},
    }

    for kind in ("correlated", "white"):
        if not results[kind]:
            continue
        ms = [metrics(base, p, land) for p in results[kind]]
        agg: dict[str, dict[str, float]] = {}
        for key in ("wetFraction", "p95M", "meanDepthM", "csi", "depthCorr"):
            v = [m[key] for m in ms]
            agg[key] = {"min": float(min(v)), "max": float(max(v)),
                        "median": float(np.median(v))}
        drift = {k: abs(agg[k]["median"] / bm[k] - 1.0) if bm[k] else 0.0
                 for k in ("wetFraction", "p95M", "meanDepthM")}
        agg["driftVsBaseline"] = drift
        report["ensembles"][kind] = agg

        label = "CORRELATED (how DEMs actually err)" if kind == "correlated" else "WHITE NOISE (contrast)"
        print(f"\n  {label}  n={len(ms)}")
        print(f"    CSI          {agg['csi']['min']:.3f}..{agg['csi']['max']:.3f}"
              f"   median {agg['csi']['median']:.3f}")
        print(f"    depth corr   {agg['depthCorr']['min']:.3f}..{agg['depthCorr']['max']:.3f}"
              f"   median {agg['depthCorr']['median']:.3f}")
        print(f"    wet fraction drift {drift['wetFraction']*100:5.2f} %"
              f"    p95 drift {drift['p95M']*100:5.2f} %"
              f"    mean drift {drift['meanDepthM']*100:5.2f} %")

    out = os.path.abspath(a.out)
    json.dump(report, open(out, "w"), indent=2)
    print(f"\n  wrote {out}")
    print(f"  total {time.time()-t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
