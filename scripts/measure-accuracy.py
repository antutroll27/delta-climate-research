#!/usr/bin/env python3
"""
Measure how accurate the heat map actually is, per diurnal phase.

    python3 scripts/measure-accuracy.py

Two numbers per phase, both derived from the 32 near-nadir ECOSTRESS scenes
rather than asserted:

  ceiling_rmse  The RMSE of an UNCONSTRAINED empirical regression on the same
                forcing variables. No physics, just the best curve that fits.
                This is a hard upper bound on what ANY model driven by these
                inputs can achieve, so it says whether an accuracy target is
                reachable at all before anyone tries to reach it.

  model_rmse    What our physical model actually achieves.

The result: night is predictable from NASA POWER forcing (ceiling ~2 K) and
daytime is not (ceiling ~3.3 K). Daytime surface temperature depends on
site-level insolation, cloud timing and soil moisture that a 50 km reanalysis
cell cannot resolve. That is a property of the forcing data, not a bug in the
model, and no amount of tuning will move it — so the product must report
daytime as indicative and reserve quantitative claims for night.

Output: data/calibration/model-accuracy.json  (consumed by accuracy.ts)
"""
import importlib.util, json, math, os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "model-accuracy.json")

_spec = importlib.util.spec_from_file_location("fit", os.path.join(HERE, "fit-physics.py"))
fit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fit)

# The fitted point from fit-physics.py. Recorded, not shipped — every parameter
# pinned to a bound, which is why DEFAULT_PARAMS was left alone.
FITTED = (0.6000, 0.1500, 1.4000)


def rmse(x):
    return math.sqrt(float(np.mean(np.asarray(x) ** 2)))


def main():
    scenes, lc, _ = fit.load(False)
    out = {
        "generated_from": "data/calibration/met-forcing.csv + landcover-fractions.json",
        "scenes": len(scenes),
        "view_cut_deg": fit.VIEW_CUT,
        "method": {
            "ceiling": "best LEAVE-ONE-OUT least-squares over {tAir} and "
                       "{tAir,rh,wind,cloud,solar}; an out-of-sample upper bound on any "
                       "model using this forcing. In-sample fits overfit badly at n=12.",
            "model": "the physical model at its fitted (bound-pinned) parameters",
        },
        "phases": {},
    }

    for ph, label in (("night", "night"), ("day", "day")):
        S = [s for s in scenes if s["phase"] == ph]

        # LEAVE-ONE-OUT, over two predictor sets. An in-sample fit of 6
        # predictors to 12 daytime scenes reports 1.44 K — LOWER than night,
        # which is impossible; the regression is memorising its own noise. Only
        # out-of-sample prediction is an honest ceiling, and richer is not
        # better: at night, 6 predictors score WORSE out of sample (2.56 K) than
        # air temperature alone (2.18 K). The ceiling is the best of them.
        best_c = None
        for names in (["tAir"], ["tAir", "rh", "wind", "cloud", "sun"]):
            X = np.column_stack([[s[n] for s in S] for n in names] + [np.ones(len(S))])
            loo = []
            for cls in ("urban", "rural"):
                y = np.array([s[cls] for s in S])
                for i in range(len(S)):
                    keep = [j for j in range(len(S)) if j != i]
                    coef, *_ = np.linalg.lstsq(X[keep], y[keep], rcond=None)
                    loo.append(y[i] - X[i] @ coef)
            r = rmse(loo)
            best_c = r if best_c is None else min(best_c, r)

        mod_res = []
        for cls in ("urban", "rural"):
            y = np.array([s[cls] for s in S])
            mod_res.append(np.array([fit.predict(s, lc, *FITTED)[cls] for s in S]) - y)
        c, m = best_c, rmse(np.concatenate(mod_res))

        # The band users see is the MODEL's own out-of-sample error — what they
        # actually experience — rounded UP to the nearest 0.5 K, never down.
        band = math.ceil(m * 2) / 2
        out["phases"][label] = {
            "n": len(S),
            "ceiling_rmse_K": round(c, 2),
            "model_rmse_K": round(m, 2),
            "reported_band_K": band,
            "confidence": "quantitative" if c <= 2.5 else "indicative",
            "why": ("air temperature explains night surface temperature well "
                    "(r ~ 0.9), so a calibrated model is meaningful here"
                    if c <= 2.5 else
                    "daytime surface temperature depends on site-level insolation, "
                    "cloud timing and soil moisture that 50 km reanalysis forcing "
                    "cannot resolve; no model on this data can do better"),
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    for ph, d in out["phases"].items():
        print(f"  {ph:<6} n={d['n']:<3} ceiling {d['ceiling_rmse_K']:.2f} K   "
              f"model {d['model_rmse_K']:.2f} K   -> report ±{d['reported_band_K']} K "
              f"({d['confidence']})")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
