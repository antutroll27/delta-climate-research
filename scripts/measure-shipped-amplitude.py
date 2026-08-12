"""Does the SHIPPED map have the amplitude we measured? -> data/calibration/shipped-amplitude.json

THE GAP THIS CLOSES. Every within-ward number we publish comes from
`measure-spatial-accuracy.py`, which evaluates the per-cell EQUILIBRIUM: the
closed-form steady state of the energy balance, one cell at a time. The browser
does not run that. It runs `TsHeatSim`, which adds a lateral diffusion term and
relaxes for RESET_BURST = 600 steps. Its steady state is a screened Poisson
equation -- the same per-cell equilibrium, SMOOTHED at a length of about
sqrt(D/k) cells. With the shipped D = 2.5, kRad = 0.01 and h = 0.05 that is
roughly 6.5 cells, near 47 m.

So the field we validate is rougher and higher-amplitude than the field a reader
sees, and a caveat written from the offline numbers could be simply wrong about
the product. Two consequences worth separating:

  AMPLITUDE  diffusion removes variance, most of it at the fine scales. The
             "model draws 2x the observed spatial SD" finding was measured on the
             equilibrium field and may not describe the map at all.
  SKILL      smoothing pushes the field toward the scale where we DO have skill
             (measure-scale-skill.py found r rising to ~0.5 by 300-470 m), so the
             shipped field could plausibly score BETTER than the one we publish.

The shipped solver is driven directly through `scripts/sim-field-dump.mjs` rather
than reimplemented here. A second copy of a 20-line loop would drift, and the
drift would look like a result.

    python3 scripts/measure-shipped-amplitude.py
    python3 scripts/measure-shipped-amplitude.py --limit 12
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
import _physics  # noqa: E402
import _water  # noqa: E402
from _ecostress import target_grid, token  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "shipped-amplitude.json")

#: Must match SIM_N in heat-map-model.ts. Asserted against the dump, not trusted.
SIM_N = 192


def _load_sibling() -> Any:
    path = os.path.join(HERE, "measure-spatial-accuracy.py")
    spec = importlib.util.spec_from_file_location("_msa", path)
    if spec is None or spec.loader is None:
        sys.exit("  cannot import scripts/measure-spatial-accuracy.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_msa"] = mod
    spec.loader.exec_module(mod)
    return mod


def upsample(a: npt.NDArray[np.float32], n: int) -> npt.NDArray[np.float32]:
    """Nearest-neighbour to the sim grid. The surface rasters are coarser than
    SIM_N; the app does the same thing through rasterWardBase."""
    if a.shape == (n, n):
        return a
    yi = (np.arange(n) * a.shape[0] // n).clip(0, a.shape[0] - 1)
    xi = (np.arange(n) * a.shape[1] // n).clip(0, a.shape[1] - 1)
    return a[np.ix_(yi, xi)]


def run_shipped(layers: dict[str, npt.NDArray[np.float32]], params: dict[str, float],
                steps: int) -> npt.NDArray[np.float64]:
    """Drive the real TsHeatSim and read its field back."""
    with tempfile.TemporaryDirectory() as td:
        ip, op = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        with open(ip, "w") as fh:
            json.dump({"n": SIM_N, "steps": steps, "params": params,
                       "layers": {k: v.astype(float).ravel().tolist()
                                  for k, v in layers.items()}}, fh)
        r = subprocess.run(
            ["node", "--experimental-strip-types", os.path.join(HERE, "sim-field-dump.mjs"), ip, op],
            capture_output=True, text=True, cwd=ROOT)
        if r.returncode != 0:
            sys.exit(f"  sim-field-dump failed:\n{r.stderr[-1500:]}")
        d = json.load(open(op))
    if d["n"] != SIM_N:
        sys.exit(f"  the shipped SIM_N is {d['n']}, not {SIM_N} — fix the constant here")
    return np.asarray(d["field"], dtype=np.float64).reshape(SIM_N, SIM_N)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0, help="score only the first N scenes")
    args = ap.parse_args()

    msa = _load_sibling()
    q_day, ratio, c, store = msa.live_constants()
    scenes, _lc, _dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[: args.limit]
    tok = token()

    full: dict[str, dict[str, npt.NDArray[np.float32]]] = {}
    coarse: dict[str, dict[str, npt.NDArray[np.float32]]] = {}
    grid_wh: tuple[int, int] | None = None
    for wid, w in _types.WARDS.items():
        veg, alb = msa.surface_layers(wid)
        built = msa.built_layer(wid)
        # WATER COMES THROUGH `msa.water_layer`, WHICH APPLIES THE SHIPPED GATE. This
        # was a hardcoded `np.zeros` until 2026-08-13 — the same zeros the browser had,
        # but for no reason and with no way to change them, so this script could not have
        # scored the water terms even in principle. It is still zeros today, because
        # WATER_LAYER_ENABLED is false; the difference is that flipping one constant in
        # types.ts now moves BOTH the map and this measurement, and the parity oracle
        # fails if the two ever disagree about which arm is live.
        #
        # When it IS on, water is rasterised at SIM_N rather than upsampled from 140 like
        # the other three. They have no choice — a 140-grid PNG and a 140-grid cache.
        # Polygons have no native resolution, so asking for the solver's grid gives the
        # browser's answer exactly instead of a nearest-neighbour approximation to it.
        full[wid] = {"veg": upsample(veg, SIM_N), "albedo": upsample(alb, SIM_N),
                     "built": upsample(built, SIM_N),
                     "water": msa.water_layer(wid, SIM_N)}
        _tf, W, H = target_grid(_types.ward_bounds(w))
        grid_wh = (W, H)
        coarse[wid] = {"veg": msa.area_downsample(veg, H, W),
                       "alb": msa.area_downsample(alb, H, W),
                       "built": msa.area_downsample(built, H, W)}
    # W/H were read out of the loop variable, which is only defined if WARDS is
    # non-empty. It always is, so this was never a live failure — but the empty
    # case is now stated rather than left to a NameError.
    assert grid_wh is not None, "no wards configured"
    print(f"  layers at {SIM_N}x{SIM_N} for the sim, "
          f"{grid_wh[0]}x{grid_wh[1]} for the comparison\n")

    rows: list[dict[str, Any]] = []
    for i, sc in enumerate(scenes, 1):
        night = sc.phase == "night"
        kRad = _physics.K_SUM * ratio / (1 + ratio)
        h = _physics.K_SUM - kRad
        L = _physics.L_ET * _physics.evap_scale(sc.rh)
        if night:
            L *= _physics.NIGHT_ET_FRACTION
        params = {
            "D": 2.5, "S": _physics.S_SOLAR, "sun": 0.0 if night else sc.sun * (1 - 0.6 * sc.cloud),
            # tSky is DERIVED, exactly as _physics.predict derives it -- reading a
            # scene attribute that does not exist would have silently shipped 17 C.
            "kRad": kRad, "tSky": float(_physics.sky_temp(sc.tAir, sc.rh, sc.cloud, c)),
            "L": L, "h": h, "wind": float(sc.wind), "tAir": float(sc.tAir),
            "Q": q_day * (_physics.Q_NIGHT_RATIO if night else 1.0),
            "store": store if night else 0.0,
        }
        for wid, w in _types.WARDS.items():
            obs = msa.measured_field(w, sc.date, sc.phase, tok)
            if obs is None:
                continue
            m = np.isfinite(obs)
            if int(m.sum()) < msa.MIN_CELLS:
                continue

            shipped = run_shipped(full[wid], params, 600)
            # LIKE-FOR-LIKE NULL. Diffusion raises r against a coarse, noisy
            # target for ANY field, so scoring a diffused model against an
            # UN-diffused vegetation map would hand the model a free win. This
            # runs the identical solver with albedo and built held flat at the
            # ward mean, so vegetation is the only thing that varies.
            # Water is flattened for the same reason albedo and built are. It was
            # `full[wid]["water"]` when that layer was all zeros, where flat and varying
            # are the same array; now that it is populated, passing it through would let
            # the null vary in TWO covers and quietly stop being a vegetation null.
            flat = {
                "veg": full[wid]["veg"],
                "albedo": np.full_like(full[wid]["albedo"], float(full[wid]["albedo"].mean())),
                "built": np.full_like(full[wid]["built"], float(full[wid]["built"].mean())),
                "water": np.full_like(full[wid]["water"], float(full[wid]["water"].mean())),
            }
            veg_shipped = run_shipped(flat, params, 600)
            vegs_c = msa.area_downsample(veg_shipped.astype(np.float32), obs.shape[0], obs.shape[1])
            # to the ECOSTRESS grid, the same area-mean the offline path uses
            ship_c = msa.area_downsample(shipped.astype(np.float32), obs.shape[0], obs.shape[1])
            lay = coarse[wid]
            equil = msa.modelled_field(sc, lay["veg"], lay["alb"], lay["built"],
                                       q_day, ratio, c, store)
            o = obs[m].astype(np.float64)
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid,
                "sd_shipped_native_k": float(shipped.std()),
                "sd_shipped_at_obs_k": float(ship_c[m].std()),
                "sd_equilibrium_k": float(equil[m].std()),
                "sd_observed_k": float(o.std()),
                "r_shipped": msa.pearson(ship_c[m].astype(np.float64), o),
                "r_equilibrium": msa.pearson(equil[m].astype(np.float64), o),
                "r_veg_raw": msa.pearson(-lay["veg"][m].astype(np.float64), o),
                "r_veg_diffused": msa.pearson(vegs_c[m].astype(np.float64), o),
                "sd_veg_diffused_k": float(vegs_c[m].std()),
            })
        print(f"  [{i:>3}/{len(scenes)}] {len(rows)} ward-scenes")

    if not rows:
        sys.exit("  nothing scored")

    def mean(k: str, sub: list[dict[str, Any]]) -> float:
        return float(np.mean([r[k] for r in sub]))

    print(f"\n  {len(rows)} ward-scenes\n")
    print("  phase   n   SD ship  SD equil  SD obs |  r ship  r equil  r veg(raw)  r veg(diffused)")
    summary = {}
    for phase in ("day", "night", "all"):
        s = rows if phase == "all" else [r for r in rows if r["phase"] == phase]
        if not s:
            continue
        e = {
            "n": len(s),
            "sd_shipped_at_obs_k": round(mean("sd_shipped_at_obs_k", s), 3),
            "sd_shipped_native_k": round(mean("sd_shipped_native_k", s), 3),
            "sd_equilibrium_k": round(mean("sd_equilibrium_k", s), 3),
            "sd_observed_k": round(mean("sd_observed_k", s), 3),
            "r_shipped": round(mean("r_shipped", s), 4),
            "r_equilibrium": round(mean("r_equilibrium", s), 4),
            "r_veg_raw": round(mean("r_veg_raw", s), 4),
            "r_veg_diffused": round(mean("r_veg_diffused", s), 4),
        }
        e["amplitude_ratio_shipped"] = round(e["sd_shipped_at_obs_k"] / e["sd_observed_k"], 3)
        e["amplitude_ratio_equilibrium"] = round(e["sd_equilibrium_k"] / e["sd_observed_k"], 3)
        summary[phase] = e
        print(f"  {phase:<6} {e['n']:>3}  {e['sd_shipped_at_obs_k']:>7.2f}K {e['sd_equilibrium_k']:>8.2f}K"
              f" {e['sd_observed_k']:>6.2f}K | {e['r_shipped']:>7.3f} {e['r_equilibrium']:>8.3f}"
              f" {e['r_veg_raw']:>11.3f} {e['r_veg_diffused']:>15.3f}")

    # PER WARD, because the aggregate cannot tell a mechanism from a coincidence. The
    # three wards carry 0.7 %, 1.3 % and 4.9 % open water, so a water change that is
    # real must move them in that order; one that moves them alike is moving something
    # else. Same argument for any future cover layer, which is why this is not
    # water-specific: the split is the diagnostic, `open_water_fraction` is the label.
    by_ward = {}
    print(f"\n  ward          n   SD ship  SD obs |  r ship  r equil  r veg(diffused)   water")
    for wid in sorted({str(r["ward"]) for r in rows}):
        s = [r for r in rows if r["ward"] == wid]
        e = {
            "n": len(s),
            # The ward's REAL open water, not the layer the solver was handed — those
            # differ whenever WATER_LAYER_ENABLED is off, and the label has to say what
            # the ward contains for the split to mean anything.
            "open_water_fraction": round(float(msa.water_coverage(wid, SIM_N).mean()), 5),
            "water_in_solve": bool(_water.LAYER_ENABLED),
            "sd_shipped_at_obs_k": round(mean("sd_shipped_at_obs_k", s), 3),
            "sd_observed_k": round(mean("sd_observed_k", s), 3),
            "r_shipped": round(mean("r_shipped", s), 4),
            "r_equilibrium": round(mean("r_equilibrium", s), 4),
            "r_veg_diffused": round(mean("r_veg_diffused", s), 4),
        }
        by_ward[wid] = e
        print(f"  {wid:<13}{e['n']:>3}  {e['sd_shipped_at_obs_k']:>7.2f}K {e['sd_observed_k']:>6.2f}K"
              f" | {e['r_shipped']:>7.3f} {e['r_equilibrium']:>8.3f} {e['r_veg_diffused']:>15.3f}"
              f"  {100 * e['open_water_fraction']:>6.2f}%")

    a = summary.get("all", {})
    print(f"\n  amplitude vs the observation:  shipped {a.get('amplitude_ratio_shipped')}x"
          f"   equilibrium {a.get('amplitude_ratio_equilibrium')}x")
    print(f"  skill:                         shipped {a.get('r_shipped')}"
          f"   equilibrium {a.get('r_equilibrium')}")
    print(f"  the LIKE-FOR-LIKE null:        vegetation through the same solver "
          f"{a.get('r_veg_diffused')}   (raw vegetation map {a.get('r_veg_raw')})")
    beat = (a.get('r_shipped') or 0) - (a.get('r_veg_diffused') or 0)
    print(f"\n  shipped model minus like-for-like null: {beat:+.3f}")
    print("  -> " + ("the model BEATS a vegetation map given the same smoothing"
                     if beat > 0.02 else
                     "smoothing explains the gain; the model still does not beat vegetation"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "by_ward": by_ward, "rows": rows,
                   "note": ("The shipped map runs TsHeatSim (diffusion, RESET_BURST steps); "
                            "the published within-ward figures score the per-cell equilibrium. "
                            "This measures both against the same observation."),
                   "water_note": ("This file is the ONLY place the sim's water terms can be "
                                  "scored: the equilibrium in spatial-accuracy.json mirrors "
                                  "equilibriumC, which has no water term, so those figures "
                                  "are blind to it by construction. The layer is currently "
                                  "GATED OFF (WATER_LAYER_ENABLED false in types.ts, mirrored "
                                  "by _water.LAYER_ENABLED and pinned by the water parity "
                                  "oracle), so `water_in_solve` below is false and these "
                                  "figures are the dry arm. Turning it on cost 0.0487 r "
                                  "(0.3031 -> 0.2544) and raised spatial SD 1.345 -> 1.514 K "
                                  "against an observed 0.925 K, in proportion to each ward's "
                                  "open water. See docs/heat-map-water-layer.md and "
                                  "docs/evidence/known-limitations.md sec.6."),
                   "water_in_solve": bool(_water.LAYER_ENABLED)},
                  fh, indent=2)
        fh.write("\n")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
