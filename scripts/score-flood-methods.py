"""Score every flood method against Landsat's observed extent, on one footing.

WHY A SCOREBOARD AND NOT A SCORE. On 2026-08-26 the unsteady solver was scored
against observation and lost to inverted elevation (r +0.008 vs +0.460 at ~2 km
districts). The lesson is not "elevation is good" — it is that a method's score
means nothing without the trivial baseline beside it. So every method here is
scored identically, including the one-liners, and any claim of improvement has
to survive the comparison.

TWO SCORES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.

  MATCHED-PREVALENCE CSI. Continuous indices have no natural threshold, and
  sweeping one invites tuning until the answer flatters. Instead each method's
  top-N cells are taken, where N is exactly the observed wet count — so every
  method predicts the same amount of flooding and only the PLACEMENT is scored.
  Random placement scores the observed prevalence; anything at or below that is
  noise wearing a number.

  BLOCK CORRELATION. Aggregate wet fraction per block, across scales from 60 m
  to ~2 km. This is the district-scale claim the product actually makes, and it
  is where the resolution argument says terrain should win.

WHAT IS BEING COMPARED
  elevation / depthBelow / twi / hand   terrain only, no rainfall, no solver
  solver-peak                           the unsteady model's headline output
  solver-72h                            same, given three days to route

    python3 scripts/score-flood-methods.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flood_terrain_index import INDICES  # noqa: E402
from flood_unsteady import sea_mask  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
# Durable run outputs. Reads BOTH locations because a sweep launched before the
# move is still writing to the old one; the session scratchpad is checked second
# so the durable copy always wins.
RUNS = os.path.join(HERE, "..", "data", ".cache", "flood-runs")
SCRATCH = ("/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/"
           "133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad")


def find_run(name: str) -> str | None:
    """First existing path for a run array, durable location preferred."""
    for base in (RUNS, SCRATCH):
        p = os.path.join(base, name)
        if os.path.exists(p):
            return p
    return None
BLOCKS = (2, 4, 8, 16, 32, 64)


def blocks(a: np.ndarray[Any, Any], k: int) -> np.ndarray[Any, Any]:
    m = (a.shape[0] // k) * k
    out: np.ndarray[Any, Any] = a[:m, :m].reshape(m // k, k, m // k, k).mean(axis=(1, 3))
    return out


def score(field: np.ndarray[Any, Any], obs: np.ndarray[Any, Any],
          land: np.ndarray[Any, Any], cell: float) -> dict[str, Any]:
    """Matched-prevalence CSI plus block correlation at every scale."""
    n_wet = int((obs & land).sum())
    v = np.where(land, field, -np.inf)
    # top-N by value, so every method predicts the same flooded AREA
    cut = np.partition(v[land], -n_wet)[-n_wet] if n_wet < land.sum() else -np.inf
    pred = land & (field >= cut)

    o = obs & land
    hit = float((pred & o).sum())
    miss = float((~pred & o).sum())
    fa = float((pred & ~o).sum())
    out: dict[str, Any] = {
        "csi": hit / (hit + miss + fa) if (hit + miss + fa) else 0.0,
        "pod": hit / (hit + miss) if (hit + miss) else 0.0,
        "predictedCells": int(pred.sum()),
        "blockR": {},
    }
    # BLOCK CORRELATION USES THE CONTINUOUS FIELD, NOT THE BINARISED PREDICTION.
    # Thresholding to top-N is right for CSI (it forces every method to predict
    # the same area, so only placement is scored) but wrong here: it discards the
    # magnitude information that is the whole point of a continuous index. The
    # first version of this file binarised both and reported elevation at +0.293
    # where the continuous field gives +0.46 — the method was penalising itself.
    finite = land & np.isfinite(field)
    for k in BLOCKS:
        keep = blocks(finite.astype("float64"), k) > 0.5
        if keep.sum() < 5:
            continue
        fb = blocks(np.where(finite, field, 0.0), k)
        ob = blocks(o.astype("float64"), k)
        if fb[keep].std() < 1e-12 or ob[keep].std() < 1e-12:
            out["blockR"][k * int(cell)] = 0.0
            continue
        out["blockR"][k * int(cell)] = float(np.corrcoef(fb[keep], ob[keep])[0, 1])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.join(DATA, "..", "flood-method-scores.json"))
    a = ap.parse_args()

    terr = json.load(open(os.path.join(DATA, "dubai-creek-terrain.json")))
    obsd = json.load(open(os.path.join(DATA, "dubai-creek-flood-observed.json")))
    n, cell = int(terr["n"]), float(terr["cellM"])
    z = np.asarray(terr["h"], dtype="float64").reshape(n, n)
    sea = sea_mask(z)
    obs = np.asarray(obsd["wet"], dtype=bool).reshape(n, n)
    delta = np.asarray([np.nan if v is None else v for v in obsd["deltaMndwi"]],
                       dtype="float64").reshape(n, n)
    land = (~sea) & np.isfinite(delta)
    prevalence = float((obs & land).sum()) / float(land.sum())

    print(f"  grid {n}x{n} @ {cell:.0f} m   scorable land {land.sum():,} cells")
    print(f"  observed wet {int((obs & land).sum()):,} cells "
          f"({obsd['floodedKm2']} km2, prevalence {prevalence:.4f})")
    print(f"  RANDOM PLACEMENT SCORES CSI = {prevalence:.4f}. That is the bar.\n")

    fields: dict[str, np.ndarray[Any, Any]] = {}
    for name, fn in INDICES.items():
        fields[name] = fn(z, cell=cell, drainage=sea)
    missing: list[str] = []
    for h in (6, 12, 24, 48, 72):
        for kind in ("peak", "resid"):
            path = find_run(f"{kind}_{h}h.npy")
            if path:
                fields[f"solver-{h}h-{kind}"] = np.load(path)
            else:
                missing.append(f"{kind}_{h}h")
    # SAY WHAT IS ABSENT, LOUDLY. The 6 h baseline vanished from a temp directory
    # and this table simply stopped showing it — a missing comparison row reads
    # as "not applicable" rather than "lost", which is how a scoreboard quietly
    # becomes wrong.
    if missing:
        print(f"  NOT SCORED (files absent): {', '.join(missing)}\n")

    results: dict[str, Any] = {"prevalence": prevalence, "methods": {}}
    hdr = "  ".join(f"{k*int(cell):>6}m" for k in BLOCKS)
    print(f"  {'method':18} {'CSI':>7} {'vs rand':>8}   {hdr}")
    for name, f in fields.items():
        s = score(f, obs, land, cell)
        results["methods"][name] = s
        rs = "  ".join(f"{s['blockR'].get(k*int(cell), 0.0):+7.3f}" for k in BLOCKS)
        lift = s["csi"] / prevalence if prevalence else 0.0
        print(f"  {name:18} {s['csi']:7.4f} {lift:7.2f}x   {rs}")

    print(f"\n  'vs rand' is CSI divided by prevalence: 1.00x means indistinguishable")
    print(f"  from scattering the same number of wet cells at random.")

    json.dump(results, open(os.path.abspath(a.out), "w"), indent=2)
    print(f"\n  wrote {os.path.abspath(a.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
