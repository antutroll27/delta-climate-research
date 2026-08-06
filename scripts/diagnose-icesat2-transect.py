"""Task-3 gate (spec §6): is roof separable from ground on a real transect?

    python3 scripts/diagnose-icesat2-transect.py data/calibration/icesat2/ballygunge-20181025-0416.json

Writes previews/_icesat2-transect.png (untracked, like the other _*.png scratch
renders) and prints PASS/FAIL against the two pre-registered gate criteria:

  G1  median of the ground line within ±5 m of the ward DEM median (already
      enforced by fetch-icesat2.py, repeated here so the verdict is
      self-contained and so a hand-edited subset cannot dodge it)
  G2  roof photons over 5 m-eroded footprints exist, and the per-building
      estimates have a median above 4 m

FULLY OFFLINE. It reads one committed subset plus the ward's footprints; no
credentials, no network, no granule.

EVERY PHOTON IS ACCOUNTED FOR. Spec §5.4 forbids silent exclusions, so the
printed ladder names the count at each stage — in the subset, ground candidate,
dropped for a NaN ground line, inside an eroded footprint, inside the roof band
— and the building ladder separates "the beam crossed it" from "it cleared
MIN_ROOF_PH". A building crossed but under the photon minimum is coverage we
have and cannot use; hiding it would read as coverage we do not have.

THE NaN IS NOT DECORATION. `_icesat2.ground_line` returns NaN outside its
populated span rather than extrapolating flat, and an unmasked `np.median` over
a line holding one NaN is NaN — which sails through `abs(nan - dem) <= 5.0` as
False, i.e. a silent FAIL, or through the inverted form as a silent PASS. Both
medians here are taken over finite values only, and the NaN count is printed.
"""
from __future__ import annotations

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _types import WARDS  # noqa: E402

ROOT = os.path.join(HERE, "..")
#: Gate criteria, from the spec. Not knobs: G1's ±5 m is the DEM's own measured
#: error budget (§5.1) and G2's 4 m is "taller than street furniture, shorter
#: than one storey" — a bar a noise field cannot clear.
G1_TOL_M = 5.0
G2_MIN_MEDIAN_M = 4.0


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as fh:
        sub = json.load(fh)
    w = WARDS[sub["ward"]]
    with open(os.path.join(ROOT, "data", "geometry",
                           f"{sub['ward']}-footprints.json"), encoding="utf-8") as fh:
        rings = [r["p"] for r in json.load(fh)["b"]]

    ph = np.asarray(sub["ph"], dtype=np.float64)
    h_ortho = ph[:, 3]
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)

    dil, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil == -1
    g = _icesat2.ground_line(s, s[gnd], h_ortho[gnd])
    fin = np.isfinite(g)
    hag = h_ortho - g

    ero, kept = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    roof = ero >= 0
    lo, hi = _icesat2.ROOF_BAND_M
    in_band = roof & (hag >= lo) & (hag <= hi)
    est = _icesat2.building_heights(ero, hag)
    crossed = set(np.unique(ero[roof]).tolist())

    ground_med = float(np.median(g[fin]))
    g1 = abs(ground_med - sub["demMedianM"]) <= G1_TOL_M
    heights = np.asarray(sorted(est.values()))
    med_est = float(np.median(heights)) if heights.size else float("nan")
    g2 = bool(heights.size) and med_est > G2_MIN_MEDIAN_M

    fig, (ax0, ax1) = plt.subplots(2, 1, figsize=(14, 9), dpi=150, sharex=True)
    order = np.argsort(s)
    ax0.scatter(s[~roof], h_ortho[~roof], s=2, c="#8a8a8a", label="outside footprints")
    ax0.scatter(s[roof], h_ortho[roof], s=4, c="#d94f2b",
                label="inside 5 m-eroded footprints")
    ax0.plot(s[order], g[order], lw=1.6, c="#1b6ca8", label="ground line (two-pass)")
    ax0.axhline(sub["demMedianM"], lw=1.2, ls="--", c="#111",
                label=f"ward DEM median {sub['demMedianM']:.1f} m")
    ax0.set(ylabel="orthometric height  m (EGM2008)")
    ax0.legend(loc="upper right", markerscale=5, fontsize=8, framealpha=0.9)
    ax0.set_title(
        f"{sub['granule']}   ·   {sub['ward']} RGT {sub['rgt']} {sub['date']}   ·   "
        f"beams {','.join(sub['beams'])}   ·   closest {sub['trackMinDistM']:.0f} m\n"
        f"{len(est)} buildings with ≥{_icesat2.MIN_ROOF_PH} roof photons "
        f"(of {len(crossed)} crossed)   ·   "
        f"G1 {'PASS' if g1 else 'FAIL'}   G2 {'PASS' if g2 else 'FAIL'}",
        fontsize=10)

    ax1.scatter(s[gnd], hag[gnd], s=2, c="#8a8a8a",
                label=f"ground candidates ({int(gnd.sum())})")
    ax1.scatter(s[roof], hag[roof], s=6, c="#d94f2b",
                label=f"in eroded footprints ({int(roof.sum())})")
    ax1.axhline(0.0, lw=0.8, c="#111")
    ax1.axhline(lo, lw=0.8, ls=":", c="#444", label=f"roof band {lo:.0f}–{hi:.0f} m")
    if heights.size:
        ax1.axhline(med_est, lw=1.2, ls="--", c="#d94f2b",
                    label=f"median per-building estimate {med_est:.1f} m")
    top = float(np.nanmax(hag[roof])) + 5.0 if roof.any() else 40.0
    ax1.set(xlabel="along-track distance  m", ylabel="height above ground line  m")
    ax1.set_ylim(-8.0, max(40.0, min(top, 80.0)))
    ax1.legend(loc="upper right", markerscale=4, fontsize=8, framealpha=0.9)

    out = os.path.join(ROOT, "previews", "_icesat2-transect.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.tight_layout()
    fig.savefig(out, bbox_inches="tight")

    c = sub["counts"]
    print(f"  {sub['granule']}  ({sub['ward']}, RGT {sub['rgt']}, {sub['date']})")
    print("  photons: "
          f"{c['photons_read']} read → {c['conf_land']} conf≥3 land → "
          f"{c['in_box']} in the subset")
    print(f"           {int(gnd.sum())} ground candidates, "
          f"{int((~fin).sum())} outside the ground line's span (dropped), "
          f"{int(roof.sum())} inside eroded footprints, "
          f"{int(in_band.sum())} of those in the roof band")
    print(f"  buildings: {len(kept)} survived 5 m erosion, {len(crossed)} crossed by "
          f"the beam, {len(est)} cleared MIN_ROOF_PH={_icesat2.MIN_ROOF_PH}")
    print(f"  plot: {os.path.relpath(out, ROOT)}")
    print(f"  G1 ground vs DEM:    {'PASS' if g1 else 'FAIL'}  "
          f"(ground {ground_med:.1f} m, DEM {sub['demMedianM']:.1f} m, "
          f"|Δ| {abs(ground_med - sub['demMedianM']):.1f} m, tolerance {G1_TOL_M:.0f} m)")
    print(f"  G2 roof separability: {'PASS' if g2 else 'FAIL'}  "
          f"({len(est)} buildings, median estimate {med_est:.1f} m, "
          f"bar {G2_MIN_MEDIAN_M:.0f} m)")
    print(f"\n  GATE {'PASS' if g1 and g2 else 'FAIL'}")
    sys.exit(0 if g1 and g2 else 1)


if __name__ == "__main__":
    main()
