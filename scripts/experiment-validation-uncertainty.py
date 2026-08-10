"""How well do we know our own error bars — and which corrections are real?

EXPERIMENT, in the sense of experiment-model-structure.py: this script decides
nothing by itself. It produced the evidence behind the 2026-08-02 Landsat
validation spec, and it reruns from committed artefacts so every number in that
spec is regenerable.

Three questions, answered against data/calibration/ward-observations.json and
the shipping constants (candidate A of ward-scale-fit.json):

1. VALIDATION LEAKAGE HIERARCHY. The same statistical correction scored three
   ways: leave-one-SCENE-out, leave-one-WARD-out, leave-one-OVERPASS-out. Each
   satellite pass covers all three wards, so the first two let the fit see the
   held-out row's weather through its siblings. Result (2026-08-02 run): the
   daytime weather-regression scored 3.12 K under LOO-scene and 4.67 K — no
   gain at all — under LOO-overpass. LOO-OVERPASS IS THE ONLY HONEST PROTOCOL
   for this data, and any future correction must be judged by it.

2. WHICH CORRECTIONS SURVIVE. Out-of-sample at overpass level:
     night constant offset      2.81 → 2.79 K   (nothing)
     night weather regression   2.81 → 2.14 K   (real — beats the 2.233 ceiling)
     day   constant offset      4.67 → 4.50 K   (marginal)
     day   weather regression   4.67 → 4.67 K   (nothing — the LOO-scene gain
                                                 was leakage, do not retry)

3. UNCERTAINTY OF THE PUBLISHED FIGURES. Bootstrap over overpasses (not
   ward-scenes — three wards on one pass are not three independent facts):
     night  2.93 K published, 95% CI 1.90–3.64 K  (n=20 overpasses)
     day    4.42 K published, 95% CI 2.91–6.65 K  (n=12 overpasses)
   The day figure is uncertain by ±1.87 K, which is the load-bearing argument
   for acquiring more daytime scenes: tripling overpasses ≈ halves the CI.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys

import numpy as np
import numpy.typing as npt
from collections.abc import Sequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBS = os.path.join(ROOT, "data", "calibration", "ward-observations.json")
FIT = os.path.join(ROOT, "data", "calibration", "ward-scale-fit.json")

# fit-ward-scale.py has a hyphen in its name; load it by path.
_spec = importlib.util.spec_from_file_location(
    "fws", os.path.join(ROOT, "scripts", "fit-ward-scale.py"))
assert _spec and _spec.loader
fws = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fws)


def rmse(errs: Sequence[float] | npt.NDArray[np.float64]) -> float:
    a = np.asarray(list(errs), dtype=float)
    return math.sqrt(float(np.mean(a * a)))


def main() -> None:
    rows = fws.load_rows()
    with open(OBS) as fh:
        dates = np.array([r["date"] for r in json.load(fh)["rows"]])
    with open(FIT) as fh:
        fitted = json.load(fh)["candidates"][0]["fitted"]  # A: shipping structure
    params = dict(fws.SHIP)
    params.update(fitted)

    print(f"params (candidate A): { {k: round(v, 4) for k, v in fitted.items()} }")
    print("published (accuracy.ts): night 2.93 K over n=50 · peak 4.42 K over n=29\n")

    rng = np.random.default_rng(7)
    for phase in ("night", "day"):
        mask = np.array([r.phase == phase for r in rows])
        sub = [r for r, keep in zip(rows, mask) if keep]
        d = dates[mask]
        err = np.array([fws.predict(params, r, night_release=False) - r.lst for r in sub])
        X = np.array([[1.0, r.tAir, r.rh, r.wind, r.cloud, r.sun] for r in sub])
        overpasses = sorted(set(d))
        print(f"── {phase}: {len(sub)} ward-scenes over {len(overpasses)} overpasses · "
              f"baseline {rmse(err):.2f} K "
              f"(bias {err.mean():+.2f} · spread {err.std():.2f})")

        # 1+2 · the corrections, judged at every leakage level
        for label, folds in (
            ("LOO-scene   ", [(np.arange(len(err)) != i) for i in range(len(err))]),
            ("LOO-ward    ", [np.array([r.ward != w for r in sub])
                              for w in sorted({r.ward for r in sub})]),
            ("LOO-overpass", [(d != dd) for dd in overpasses]),
        ):
            off, reg = [], []
            for tr in folds:
                te = ~tr
                if tr.sum() < 8 or te.sum() == 0:
                    continue
                off.extend(err[te] - err[tr].mean())
                beta, *_ = np.linalg.lstsq(X[tr], err[tr], rcond=None)
                reg.extend(err[te] - X[te] @ beta)
            print(f"     {label}  constant offset {rmse(off):5.2f} K · "
                  f"weather regression {rmse(reg):5.2f} K")

        # 3 · bootstrap CI on the baseline figure, resampling whole overpasses
        boots = []
        uniq = np.array(overpasses)
        for _ in range(4000):
            pick = rng.choice(uniq, size=len(uniq), replace=True)
            boots.append(rmse(np.concatenate([err[d == p] for p in pick])))
        lo, hi = np.percentile(boots, [2.5, 97.5])
        half = (hi - lo) / 2
        print(f"     bootstrap 95% CI on the RMSE figure: {lo:.2f}–{hi:.2f} K "
              f"(±{half:.2f}; ±{half / math.sqrt(3):.2f} at 3x the overpasses)\n")

    print("Protocol conclusion: judge every correction at LOO-OVERPASS level or "
          "not at all; grow daytime overpasses before growing model complexity.")


if __name__ == "__main__":
    main()
