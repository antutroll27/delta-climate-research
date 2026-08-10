"""Task-3 gate (spec §6): is roof separable from ground on a real transect?

    python3 scripts/diagnose-icesat2-transect.py data/calibration/icesat2/ballygunge-20181025-0416.json

Writes previews/_icesat2-transect.png (untracked, like the other _*.png scratch
renders) and prints PASS/FAIL against the pre-registered gate criteria (spec
§5.1, §6):

  G1a our hardcoded EGM2008 constant matches the granule's OWN
      `geophys_corr/geoid` over the ward to ≤0.5 m
  G1b the ground-line median lands inside the plausible [-2, +25] m orthometric
      band for this delta
  G2  roof photons over 5 m-eroded footprints exist, and the per-building
      estimates have a median above 4 m

G1a/G1b are already enforced by fetch-icesat2.py; they are re-run here from the
subset's own recorded numbers so the verdict is self-contained and a hand-edited
subset cannot dodge them. Their thresholds are imported from `_icesat2`, not
re-typed, so there is one place to change them and it is the gate itself.

THE DEM OFFSET IS REPORTED, NOT GATED. G1 used to demand the ground line within
±5 m of `<ward>-terrain.json`'s median and failed on 15 of 15 usable passes:
that artefact is a smoothed SURFACE model ("NOT surveyed ground", its own note),
so over this delta it sits metres above true ground. The offset is printed and
drawn as a measurement — spec §5.1's terrain-validation win — and gates nothing.

FULLY OFFLINE. It reads one committed subset plus the ward's footprints; no
credentials, no network, no granule.

EVERY PHOTON IS ACCOUNTED FOR. Spec §5.4 forbids silent exclusions, so the
printed ladder names the count at each stage — in the subset, ground candidate,
dropped for a NaN ground line, inside an eroded footprint, inside the roof band
— and the building ladder separates "the beam crossed it" from "it cleared
MIN_ROOF_PH". A building crossed but under the photon minimum is coverage we
have and cannot use; hiding it would read as coverage we do not have.

THE NaN IS NOT DECORATION, AND IT HAS TWO CAUSES. `_icesat2.ground_line` returns
NaN outside its populated span rather than extrapolating flat, and over any
window its pointwise relief gate refused (spec §5.1, CORRECTION 2026-08-07 — an
unmapped building can fill a ground window with roof returns and pin the line
tens of metres up). The ladder prints the two apart, because a short track and an
unmapped building are different findings. An unmasked `np.median` over
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
#: G2's bar, from the spec: "taller than street furniture, shorter than one
#: storey" — a bar a noise field cannot clear. Not a knob. G1a's and G1b's
#: thresholds live in `_icesat2` (GEOID_TOL_M, GROUND_BAND_M) beside the gate
#: that enforces them.
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
    gstats: _icesat2.GroundLineStats = {}
    g = _icesat2.ground_line(s, s[gnd], h_ortho[gnd], stats=gstats)
    fin = np.isfinite(g)
    hag = h_ortho - g

    ero, kept = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    roof = ero >= 0
    lo, hi = _icesat2.ROOF_BAND_M
    in_band = roof & (hag >= lo) & (hag <= hi)
    est = _icesat2.building_heights(ero, hag)
    crossed = set(np.unique(ero[roof]).tolist())

    ground_med = float(np.median(g[fin]))
    if "granuleGeoidNM" not in sub:
        sys.exit("  this subset predates the spec's §5.1 rewrite and carries no "
                 "granuleGeoidNM — re-run fetch-icesat2.py for it; G1a cannot be "
                 "faked from what is here")
    d_geoid = abs(float(sub["geoidNM"]) - float(sub["granuleGeoidNM"]))
    g1a = d_geoid <= _icesat2.GEOID_TOL_M
    band_lo, band_hi = _icesat2.GROUND_BAND_M
    g1b = bool(band_lo <= ground_med <= band_hi)
    # a measurement, not a criterion: the DSM's height above laser ground
    dem_offset = float(sub["demMedianM"]) - ground_med
    heights = np.asarray(sorted(est.values()))
    med_est = float(np.median(heights)) if heights.size else float("nan")
    g2 = bool(heights.size) and med_est > G2_MIN_MEDIAN_M
    gate = g1a and g1b and g2

    fig, (ax0, ax1) = plt.subplots(2, 1, figsize=(14, 9), dpi=150, sharex=True)
    order = np.argsort(s)
    ax0.scatter(s[~roof], h_ortho[~roof], s=2, c="#8a8a8a", label="outside footprints")
    ax0.scatter(s[roof], h_ortho[roof], s=4, c="#d94f2b",
                label="inside 5 m-eroded footprints")
    ax0.plot(s[order], g[order], lw=1.6, c="#1b6ca8", label="ground line (two-pass)")
    ax0.axhline(sub["demMedianM"], lw=1.2, ls="--", c="#111",
                label=f"ward DEM (DSM) median {sub['demMedianM']:.1f} m "
                      f"— {dem_offset:+.1f} m vs laser ground, measured not gated")
    ax0.set(ylabel="orthometric height  m (EGM2008)")
    ax0.legend(loc="upper right", markerscale=5, fontsize=8, framealpha=0.9)
    ax0.set_title(
        f"{sub['granule']}   ·   {sub['ward']} RGT {sub['rgt']} {sub['date']}   ·   "
        f"beams {','.join(sub['beams'])}   ·   closest {sub['trackMinDistM']:.0f} m\n"
        f"{len(est)} buildings with ≥{_icesat2.MIN_ROOF_PH} roof photons "
        f"(of {len(crossed)} crossed)   ·   "
        f"G1a {'PASS' if g1a else 'FAIL'}   G1b {'PASS' if g1b else 'FAIL'}   "
        f"G2 {'PASS' if g2 else 'FAIL'}",
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
          f"{int(gstats['photons_outside_span'])} outside the ground line's span "
          f"and {int(gstats['photons_over_gated_windows'])} over the "
          f"{int(gstats['n_windows_gated'])} window(s) the relief gate refused "
          "(both dropped), "
          f"{int(roof.sum())} inside eroded footprints, "
          f"{int(in_band.sum())} of those in the roof band")
    print(f"  buildings: {len(kept)} survived 5 m erosion, {len(crossed)} crossed by "
          f"the beam, {len(est)} cleared MIN_ROOF_PH={_icesat2.MIN_ROOF_PH}")
    print(f"  plot: {os.path.relpath(out, ROOT)}")
    print(f"  G1a geoid constant:   {'PASS' if g1a else 'FAIL'}  "
          f"(ours {float(sub['geoidNM']):.3f} m, granule "
          f"{float(sub['granuleGeoidNM']):.3f} m, |Δ| {d_geoid:.3f} m, "
          f"tolerance {_icesat2.GEOID_TOL_M} m)")
    print(f"  G1b ground plausible: {'PASS' if g1b else 'FAIL'}  "
          f"(ground-line median {ground_med:.2f} m, band "
          f"[{band_lo:.0f}, {band_hi:.0f}] m)")
    print(f"  G2  roof separability: {'PASS' if g2 else 'FAIL'}  "
          f"({len(est)} buildings, median estimate {med_est:.1f} m, "
          f"bar {G2_MIN_MEDIAN_M:.0f} m)")
    print(f"  measured (not gated): ward DEM median {sub['demMedianM']:.1f} m sits "
          f"{dem_offset:+.2f} m above the laser ground line — the shipped relief "
          "surface is a DSM")
    print(f"\n  GATE {'PASS' if gate else 'FAIL'}")
    sys.exit(0 if gate else 1)


if __name__ == "__main__":
    main()
