#!/usr/bin/env python3
"""
Fit the heat-map's free physical constants against measured ECOSTRESS scenes.

    python3 scripts/fit-physics.py [--all-angles]

Three constants were never derived from anything — they were chosen to make the
picture look right. This fits them to observation instead:

    Q_day        anthropogenic heat flux, daytime
    kRad : h     radiative vs convective coupling ratio
    Brutsaert c  sky-emissivity coefficient

RESIDUALS ARE ON ABSOLUTES, NOT SUHII. Matching a difference while both sides
are wrong is not a fit — a model can nail SUHII with the urban and rural cells
each 5 K out. Urban and rural means enter the residual vector separately.

NEAR-NADIR ONLY by default. The view-angle control failed on the full set:
urban-rural view_zenith delta correlates with SUHII at r = -0.322, p = 0.024,
so ~10 % of the signal is sensor geometry. Restricting to <= 0.75 deg drops
that to -0.120 (not significant) and retains 36 scenes. --all-angles disables
the cut for comparison.

Land cover is DATA, from landcover-fractions.json — measured with WorldCover
inside the same SMOD masks the temperatures came from. Letting the solver tune
land cover would let it hide land-cover error inside the physics constants.

Output: data/calibration/fitted-constants.json
"""
import argparse, csv, datetime, json, math, os, sys

import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
MET = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
LC = os.path.join(ROOT, "data", "calibration", "landcover-fractions.json")
OUT = os.path.join(ROOT, "data", "calibration", "fitted-constants.json")

# Fixed model constants, mirrored from src/scripts/climate-engine/types.ts.
S_SOLAR = 0.6
L_ET = 0.43
K_SUM = 0.02 + 0.04          # kRad + h at wind = 1; the RATIO is fitted, the sum is held
NIGHT_ET_FRACTION = 0.10
Q_NIGHT_RATIO = 0.5
DEWPOINT_TAPER_K = 1.0
VIEW_CUT = 0.75


def svp(t):                                        # hPa
    return 6.112 * np.exp(17.67 * t / (t + 243.5))


def dewpoint(t, rh):
    g = np.log(np.maximum(1e-6, rh / 100)) + 17.67 * t / (t + 243.5)
    return 243.5 * g / (17.67 - g)


def sky_temp(t, rh, cloud, c):
    tK = t + 273.15
    clear = c * (svp(t) * rh / 100 / tK) ** (1 / 7)
    eps = np.minimum(1, clear + 0.9 * (1 - clear) * cloud)
    return eps ** 0.25 * tK - 273.15


def solar_factor(hour, doy, lat=22.55):
    g = 2 * math.pi / 365 * (doy - 1)
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g)
            - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
            - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    ha = np.radians((hour - 12) * 15)
    cz = (np.sin(np.radians(lat)) * np.sin(decl)
          + np.cos(np.radians(lat)) * np.cos(decl) * np.cos(ha))
    return np.maximum(0, cz)


def predict(sc, lc, q_day, ratio, c):
    """Equilibrium surface temperature for urban and rural masks. Mirrors eqCell."""
    kRad = K_SUM * ratio / (1 + ratio)
    h = K_SUM - kRad
    night = sc["phase"] == "night"

    tAir, rh, wind, cloud = sc["tAir"], sc["rh"], sc["wind"], sc["cloud"]
    tSky = sky_temp(tAir, rh, cloud, c)
    sun = 0.0 if night else sc["sun"] * (1 - 0.6 * cloud)
    Q = q_day * (Q_NIGHT_RATIO if night else 1.0)

    k = kRad + h * wind
    pull = kRad * tSky + h * wind * tAir

    L = L_ET * (0.6 + 0.6 * (1 - rh / 100))
    if night:
        # taper ET to zero as the surface approaches the dewpoint, matching
        # nightLatent() in heat-map-model.ts
        dry_veg = (Q * lc["rural"]["built"] + pull) / k
        headroom = (dry_veg - dewpoint(tAir, rh)) / DEWPOINT_TAPER_K
        L = L * NIGHT_ET_FRACTION * min(1.0, max(0.0, headroom))

    out = {}
    for cls in ("urban", "rural"):
        a, v, b = lc[cls]["albedo"], lc[cls]["veg"], lc[cls]["built"]
        out[cls] = (S_SOLAR * (1 - a) * sun + Q * b - L * v + pull) / k
    return out


def load(all_angles):
    with open(LC) as fh:
        lc = json.load(fh)["classes"]
    with open(MET, newline="") as fh:
        rows = list(csv.DictReader(fh))
    scenes, dropped = [], 0
    for r in rows:
        if not all_angles and float(r["view_delta"]) > VIEW_CUT:
            dropped += 1
            continue
        if not r["rural_strict"]:
            dropped += 1
            continue
        d = datetime.date.fromisoformat(r["date"])
        hour = float(r["local_solar_hour"])
        scenes.append({
            "date": r["date"], "phase": r["phase"], "hour": hour,
            "sun": float(solar_factor(hour, d.timetuple().tm_yday)),
            "tAir": float(r["tAir"]), "rh": float(r["rh"]),
            "wind": max(0.3, min(2.5, float(r["wind"]) / 3)), "cloud": float(r["cloud"]),
            "w": math.sqrt(float(r["usable_frac"])),
            "urban": float(r["urban_mean"]), "rural": float(r["rural_strict"]),
        })
    return scenes, lc, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all-angles", action="store_true",
                    help="skip the near-nadir cut (for comparison only)")
    args = ap.parse_args()

    scenes, lc, dropped = load(args.all_angles)
    if len(scenes) < 12:
        sys.exit(f"only {len(scenes)} scenes after filtering — too few to fit")

    def resid(p):
        q_day, ratio, c = p
        out = []
        for sc in scenes:
            pr = predict(sc, lc, q_day, ratio, c)
            out.append(sc["w"] * (pr["urban"] - sc["urban"]))
            out.append(sc["w"] * (pr["rural"] - sc["rural"]))
        return np.array(out)

    x0 = [0.55, 0.5, 1.24]
    lo = [0.02, 0.15, 1.20]
    hi = [0.60, 1.50, 1.40]
    print(f"  fitting {len(scenes)} scenes ({dropped} excluded)"
          f"{'' if args.all_angles else f' — near-nadir <= {VIEW_CUT}°'}")
    r0 = resid(x0)
    fit = least_squares(resid, x0, bounds=(lo, hi), method="trf")
    q_day, ratio, c = fit.x

    def report(p, label):
        du, dr = [], []
        for sc in scenes:
            pr = predict(sc, lc, *p)
            du.append(pr["urban"] - sc["urban"])
            dr.append(pr["rural"] - sc["rural"])
        du, dr = np.array(du), np.array(dr)
        rmse = math.sqrt(float(np.mean(np.concatenate([du, dr]) ** 2)))
        print(f"  {label:<10} urban bias {du.mean():+6.2f}  rural bias {dr.mean():+6.2f}  "
              f"RMSE {rmse:5.2f} K  max|res| {max(abs(du).max(), abs(dr).max()):5.2f} K")
        return rmse, du, dr

    print()
    rmse0, _, _ = report(x0, "start")
    rmse1, du, dr = report(fit.x, "fitted")
    print()
    print(f"  Q_day        {x0[0]:.3f} -> {q_day:.4f}   (bounds {lo[0]}–{hi[0]})")
    print(f"  kRad:h       {x0[1]:.3f} -> {ratio:.4f}   (bounds {lo[1]}–{hi[1]})")
    print(f"  Brutsaert c  {x0[2]:.3f} -> {c:.4f}   (bounds {lo[2]}–{hi[2]})")
    for name, v, l, h_ in (("Q_day", q_day, lo[0], hi[0]), ("kRad:h", ratio, lo[1], hi[1]),
                           ("Brutsaert c", c, lo[2], hi[2])):
        if abs(v - l) < 1e-4 or abs(v - h_) < 1e-4:
            print(f"    WARNING: {name} pinned to its bound — the structure, not the value, is wrong")

    # SUHII implied by the fit vs measured
    ps = [predict(sc, lc, *fit.x) for sc in scenes]
    mod_s = np.array([p["urban"] - p["rural"] for p in ps])
    mea_s = np.array([sc["urban"] - sc["rural"] for sc in scenes])
    print()
    print(f"  SUHII  modelled median {np.median(mod_s):+.2f}   measured median {np.median(mea_s):+.2f}")
    for ph in ("day", "night"):
        idx = [i for i, sc in enumerate(scenes) if sc["phase"] == ph]
        if idx:
            print(f"    {ph:<6} n={len(idx):<3} modelled {np.median(mod_s[idx]):+.2f}   "
                  f"measured {np.median(mea_s[idx]):+.2f}")

    result = {
        "fitted": {"Q_day": round(float(q_day), 4), "kRad_h_ratio": round(float(ratio), 4),
                   "brutsaert_c": round(float(c), 4)},
        "bounds": {"Q_day": lo[0:1] + hi[0:1], "kRad_h_ratio": [lo[1], hi[1]],
                   "brutsaert_c": [lo[2], hi[2]]},
        "scenes": len(scenes), "excluded": dropped,
        "near_nadir_only": not args.all_angles, "view_cut_deg": None if args.all_angles else VIEW_CUT,
        "residuals_K": {
            "rmse": round(rmse1, 4), "rmse_before_fit": round(rmse0, 4),
            "urban_bias": round(float(du.mean()), 4), "rural_bias": round(float(dr.mean()), 4),
            "max_abs": round(float(max(abs(du).max(), abs(dr).max())), 4),
        },
        "suhii_K": {
            "modelled_median": round(float(np.median(mod_s)), 4),
            "measured_median": round(float(np.median(mea_s)), 4),
        },
        "method": "scipy least_squares TRF, bounded; residuals on urban AND rural absolutes, "
                  "weighted by sqrt(usable pixel fraction)",
        "land_cover": "data/calibration/landcover-fractions.json (fixed, not fitted)",
        "pinned_to_bounds": [n for n, v, l, h_ in
                             (("Q_day", q_day, lo[0], hi[0]), ("kRad_h_ratio", ratio, lo[1], hi[1]),
                              ("brutsaert_c", c, lo[2], hi[2]))
                             if abs(v - l) < 1e-4 or abs(v - h_) < 1e-4],
        "ship": bool(rmse1 <= 2.0),
        "verdict": ("within the +/-2 K spec bar" if rmse1 <= 2.0 else
                    "STOP CONDITION MET: RMSE exceeds the +/-2 K spec bar and parameters are "
                    "pinned to their bounds. These values must NOT be written into "
                    "DEFAULT_PARAMS -- the model structure is wrong, not its constants."),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")
    if rmse1 > 2.0:
        print(f"\n  STOP CONDITION: RMSE {rmse1:.2f} K exceeds the spec's ±2 K. The structure is\n"
              f"  wrong, not the constants. Do not ship these values.")


if __name__ == "__main__":
    main()
