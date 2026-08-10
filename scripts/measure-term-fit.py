"""Are the model's WEIGHTS wrong, or its INGREDIENTS? -> data/calibration/term-fit.json

THE QUESTION THIS ANSWERS. Our modelled field scores r = 0.216 against ECOSTRESS
while vegetation fraction alone scores 0.238, and the scale sweep
(measure-scale-skill.py) showed coarsening does not close that gap at any scale.
So the physics adds no spatial skill over one of its own inputs. Two very
different diagnoses remain, and they lead to opposite decisions:

  WEIGHTS   the terms carry the right information, combined in the wrong
            proportions. Our built term has the LARGEST spatial amplitude
            (1.21 K) and the WORST correlation (0.179), so it dominates what the
            map shows while predicting worse than the term it drowns out. If a
            free recombination of the same terms scores well above 0.216, the
            model is mis-weighted -- a calibration problem, and fixable.

  INGREDIENTS  no combination of these terms tracks the observation. Then the
            physics is missing a driver (shadowing, thermal admittance, moisture,
            3-D geometry) and reweighting is rearranging deckchairs.

THE SPLIT IS THE WHOLE EXPERIMENT. An in-sample fit ALWAYS beats the shipped
model -- it has free parameters and the shipped model does not -- so an in-sample
number would prove nothing except that regression works. This fits leave-one-
OVERPASS-out: every cell of a given ECOSTRESS overpass is held out together.

Ward and scene splits LEAK here. Cells within one ward-scene share a sky, a wind
and an air temperature, so a model fitted on some of them predicts the rest by
memorising that scene's conditions rather than by knowing anything about surfaces.
This project settled on leave-one-overpass-out for exactly that reason during the
Landsat work; the same rule applies.

ALSO REPORTED: the partial correlation of the physics field with the observation
AFTER vegetation has been regressed out. That is the direct form of "does the
physics add anything beyond veg", which a race between two r values cannot answer.

Reuses measure-spatial-accuracy.py for scene selection, terms and the observation,
so only the statistics differ. A reimplementation would drift and the drift would
look like a result.

    python3 scripts/measure-term-fit.py

The terms fitted here are the EQUILIBRIUM ones (see measure-spatial-accuracy.py's
header). Diffusion is a linear smoothing applied to the assembled field, so a free
recombination of smoothed terms spans the same space as smoothing a free
recombination -- the INGREDIENTS verdict should carry over. Not re-run on the
shipped field; stated rather than assumed.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
import _physics  # noqa: E402
from _ecostress import target_grid, token  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "term-fit.json")

#: Term order, fixed so the reported coefficients are readable.
TERMS = ("solar_albedo", "built", "veg")


def _load_sibling() -> Any:
    path = os.path.join(HERE, "measure-spatial-accuracy.py")
    spec = importlib.util.spec_from_file_location("_msa", path)
    if spec is None or spec.loader is None:
        sys.exit("  cannot import scripts/measure-spatial-accuracy.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_msa"] = mod
    spec.loader.exec_module(mod)
    return mod


def centred(a: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Remove the mean. Every comparison here is about PATTERN; ward-mean bias is
    measure-accuracy.py's job and is already reported there."""
    return np.asarray(a - a.mean(), dtype=np.float64)


def main() -> None:
    msa = _load_sibling()
    q_day, ratio, c, store = msa.live_constants()
    print(f"  shipping constants: Q={q_day:.4f}  kRad/h={ratio}  brutsaert_c={c}  store={store}\n")

    scenes, _lc, _dropped = _physics.load(all_angles=False)
    tok = token()

    layers: dict[str, dict[str, npt.NDArray[np.float32]]] = {}
    for wid, w in _types.WARDS.items():
        _tf, W, H = target_grid(_types.ward_bounds(w))
        veg, alb = msa.surface_layers(wid)
        layers[wid] = {
            "veg": msa.area_downsample(veg, H, W),
            "alb": msa.area_downsample(alb, H, W),
            "built": msa.area_downsample(msa.built_layer(wid), H, W),
        }

    # One record per ward-scene: the design matrix, the shipped field, the truth.
    recs: list[dict[str, Any]] = []
    for n, sc in enumerate(scenes, 1):
        for wid, w in _types.WARDS.items():
            obs = msa.measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            lay = layers[wid]
            if obs.shape != lay["veg"].shape:
                continue
            m = np.isfinite(obs)
            if int(m.sum()) < msa.MIN_CELLS:
                continue
            terms = msa.model_terms(sc, lay["veg"], lay["alb"], lay["built"], q_day, ratio)
            mod = msa.modelled_field(sc, lay["veg"], lay["alb"], lay["built"],
                                     q_day, ratio, c, store)
            recs.append({
                "overpass": f"{sc.date}|{sc.phase}",   # the held-out unit
                "phase": sc.phase, "ward": wid,
                "X": np.column_stack([centred(terms[t][m].astype(np.float64)) for t in TERMS]),
                "y": centred(obs[m].astype(np.float64)),
                "shipped": centred(mod[m].astype(np.float64)),
                "veg": centred(-lay["veg"][m].astype(np.float64)),
            })
        if n % 5 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(recs)} ward-scenes")

    if not recs:
        sys.exit("  no ward-scenes scored")

    overpasses = sorted({r["overpass"] for r in recs})
    print(f"\n  {len(recs)} ward-scenes across {len(overpasses)} overpasses\n")

    def fit(rows: list[dict[str, Any]]) -> npt.NDArray[np.float64]:
        X = np.vstack([r["X"] for r in rows])
        y = np.concatenate([r["y"] for r in rows])
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        return np.asarray(beta, dtype=np.float64)

    # LEAVE-ONE-OVERPASS-OUT: fit without an overpass, predict its cells.
    pred_free: list[npt.NDArray[np.float64]] = []
    truth: list[npt.NDArray[np.float64]] = []
    shipped: list[npt.NDArray[np.float64]] = []
    vegonly: list[npt.NDArray[np.float64]] = []
    for held in overpasses:
        train = [r for r in recs if r["overpass"] != held]
        test = [r for r in recs if r["overpass"] == held]
        if not train or not test:
            continue
        beta = fit(train)
        for r in test:
            pred_free.append(r["X"] @ beta)
            truth.append(r["y"])
            shipped.append(r["shipped"])
            vegonly.append(r["veg"])

    yf = np.concatenate(truth)
    r_free = msa.pearson(np.concatenate(pred_free), yf)
    r_ship = msa.pearson(np.concatenate(shipped), yf)
    r_veg = msa.pearson(np.concatenate(vegonly), yf)

    # PARTIAL: does the shipped field explain anything AFTER veg is removed?
    v = np.concatenate(vegonly)
    s = np.concatenate(shipped)
    def resid(a: npt.NDArray[np.float64], on: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        k = float(np.dot(a, on) / np.dot(on, on))
        return a - k * on
    r_partial = msa.pearson(resid(s, v), resid(yf, v))

    beta_all = fit(recs)
    print("  pooled over every cell, ward mean removed per ward-scene:\n")
    print(f"    shipped physics (fixed weights)          r = {r_ship:.3f}")
    print(f"    free recombination of the SAME terms     r = {r_free:.3f}   <- leave-one-overpass-out")
    print(f"    vegetation alone (the null)              r = {r_veg:.3f}")
    print(f"    physics AFTER removing vegetation        r = {r_partial:+.3f}   <- partial")
    print()
    print("  fitted coefficients (all data, for reading only — the r above is out-of-sample).")
    print("  READ THE SIGNS WITH CARE: the solar/albedo and vegetation terms are")
    print("  correlated (r = +0.02 ballygunge, +0.32 barrackpore, +0.09 baruipur), so a")
    print("  fit can trade one against the other. A surprising sign is a LEAD to")
    print("  investigate, not a finding to act on.")
    for t, b in zip(TERMS, beta_all):
        print(f"    {t:<14} {b:+.3f}")

    gain = r_free - max(r_ship, r_veg)
    verdict = (
        "WEIGHTS: a free recombination of the same terms beats both the shipped model and "
        "the vegetation null out-of-sample, so the ingredients carry information the "
        "shipped weights are wasting. Recalibration is worth doing."
        if gain > 0.05 else
        "INGREDIENTS: no recombination of these terms beats the vegetation null "
        "out-of-sample, so the shortfall is not a weighting problem. The physics is "
        "missing a driver, and reweighting would only refit vegetation under another name."
    )
    print(f"\n  best free fit beats the better of (shipped, veg) by {gain:+.3f}")
    print(f"  VERDICT: {verdict}")

    out = {
        "n_ward_scenes": len(recs), "n_overpasses": len(overpasses),
        "split": "leave-one-overpass-out",
        "r_shipped": round(r_ship, 4),
        "r_free_recombination": round(r_free, 4),
        "r_veg_only": round(r_veg, 4),
        "r_partial_physics_given_veg": round(r_partial, 4),
        "gain_over_best_null": round(gain, 4),
        "coefficients_all_data": {t: round(float(b), 4) for t, b in zip(TERMS, beta_all)},
        "coefficient_caveat": (
            "solar_albedo and veg terms correlate at +0.02/+0.32/+0.09 across the three "
            "wards, so individual coefficients can trade off and a surprising sign is a "
            "lead, not a finding. The out-of-sample r values are the result."),
        "verdict": verdict,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
