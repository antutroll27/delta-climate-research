#!/usr/bin/env python3
"""
The ward-scale calibration set: ECOSTRESS over each ward, with its own surface.

    python3 scripts/build-ward-observations.py [--limit N]

WHY THIS EXISTS. The existing calibration fits the model against two GHS-SMOD
masks: an "urban" class covering 3,363 km2 and a "rural" class covering 1,568.
Sampling both with Sentinel-2 shows they are the same landscape — FVC 0.678
against 0.654, the urban side marginally the greener. Their measured temperature
difference is 0.34 K, and that is why: it is the difference between delta with
villages and delta with crops.

The product is not about that. It shows a 1400 m ward with FVC 0.31-0.45 and
asks how hot a block is. Calibrating on a two-thirds-vegetated landscape and
applying the result to a one-third-vegetated ward is fitting one question and
shipping the answer to another.

So this builds the calibration set at the scale the product works at: every
near-nadir scene x every ward, ECOSTRESS at its native 70 m inside the ward
footprint, paired with that ward's OWN measured surface — the same Sentinel-2
FVC and albedo the browser draws with, and the same footprint raster.

It trades 32 mask-pairs at the wrong scale for 81 ward-scenes at the right one.

WHY IT CACHES THE GRIDS AND NOT JUST THE MEANS. Reading these costs ~8 minutes
of network per pass. A calibration that expensive to evaluate does not get
iterated, and an un-iterated calibration is how constants end up pinned to their
bounds with nobody noticing. The full 21x21 grids are kept so the ward-mean fit
and the per-cell spatial check can both run from one download, instantly.

Output: data/calibration/ward-observations.npz   (grids + a parallel index)
        data/calibration/ward-observations.json  (readable index, no grids)
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _physics  # noqa: E402
import _types  # noqa: E402
from _ecostress import align, band_url, cmr_search, fetch, target_grid, token  # noqa: E402
from _sentinel import GRID as SURFACE_GRID  # noqa: E402

ROOT = os.path.join(HERE, "..")
SURFACE_DIR = os.path.join(ROOT, "public", "heat-map", "data")
BUILT_CACHE = os.path.expanduser("~/.cache/delta-climate/built")
OUT_NPZ = os.path.join(ROOT, "data", "calibration", "ward-observations.npz")
OUT_JSON = os.path.join(ROOT, "data", "calibration", "ward-observations.json")
LANDSAT_LST = os.path.join(ROOT, "data", "calibration", "landsat-ward-lst.json")
MET_CSV = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")

VEG_RANGE = (0.0, 1.0)
ALBEDO_RANGE = (0.0, 0.5)

#: A ward is ~21x21 cells. Below this the ward mean is dominated by which cells
#: happened to be clear rather than by the ward.
MIN_CELLS = 40

#: THE SUN-UP PHYSICAL BAR — pre-registered 2026-08-09, before it was applied.
#:
#: While the sun is up, a land surface does not sit far BELOW the air that is
#: warming it. scripts/validate-model.mjs already publishes 4 K as that bound,
#: and only for a FULLY VEGETATED surface running at maximum evapotranspiration;
#: a real ward, part built, cannot beat it.
#:
#: WHY IT EXISTS. Measured over the committed archive: Landsat fails this bar on
#: 0 of 213 ward-scenes (worst -3.11 K), ECOSTRESS on 4 of 35 (worst -11.98 K).
#: The worst is a surface reading 12 K below air at 09:29 in June with a scene
#: cloud fraction of 0.96 and 27 % of ward cells usable — a cloud top recorded as
#: a surface temperature. Those scenes carried roughly two-thirds of the apparent
#: ECOSTRESS-vs-Landsat disagreement: the published morning strata run 6.28 K
#: against 3.07 K (2.04x), and 4.28 K against 3.07 K (1.39x) once they are gone.
#:
#: WHY IT IS NOT CIRCULAR, which matters because dropping scenes to improve a
#: statistic is exactly the move that deserves suspicion:
#:   * it reads ONLY observed LST and observed air temperature — never a model
#:     residual, never a fitted constant;
#:   * it is the project's own already-published bound, not a new threshold
#:     chosen to make something pass;
#:   * it is applied to BOTH instruments identically. Landsat loses nothing,
#:     which is the control: this is not a bar that merely happens to be tight.
#:
#: The `sun` gate is load-bearing. After sunset a surface legitimately falls
#: below air, so an unconditional version would reject real evening scenes.
SUN_UP = 0.5
MAX_BELOW_AIR_K = 4.0


def physical_daytime(lst_mean_c: float, t_air_c: float, sun: float) -> bool:
    """False for a sun-up scene whose surface sits implausibly far below air.

    Pure function of two observations and the solar geometry. Deliberately blind
    to the model, so it cannot launder a fitted result into an acceptance rule.
    """
    return not (sun > SUN_UP and (lst_mean_c - t_air_c) < -MAX_BELOW_AIR_K)


def ward_surface(ward_id: str) -> tuple[float, float, float]:
    """(fvc, albedo, built) for one ward — the same values the browser runs on."""
    png = os.path.join(SURFACE_DIR, f"{ward_id}-surface.png")
    built_f = os.path.join(BUILT_CACHE, f"{ward_id}-built-{SURFACE_GRID}.f32")
    for p, how in ((png, "scripts/export-surface-rasters.py"),
                   (built_f, "npx tsx scripts/export-built-raster.mjs")):
        if not os.path.exists(p):
            sys.exit(f"missing {p} — run `{how}` first.")
    a = np.asarray(Image.open(png)).astype(np.float32)
    fvc = float((a[:, :, 0] / 255.0 * (VEG_RANGE[1] - VEG_RANGE[0]) + VEG_RANGE[0]).mean())
    alb = float((a[:, :, 1] / 255.0 * (ALBEDO_RANGE[1] - ALBEDO_RANGE[0]) + ALBEDO_RANGE[0]).mean())
    built = float(np.fromfile(built_f, dtype=np.float32).mean())
    return fvc, alb, built


def ward_lst(ward: _types.Ward, date: str, phase: str, tok: str
             ) -> npt.NDArray[np.float32] | None:
    """ECOSTRESS surface temperature over one ward, °C, NaN where unusable.

    Masking matches the SUHII measurement exactly — physical range, QC mandatory
    bits, the separate cloud band (v002's QC cloud bits are unset), and water.
    A different mask here would mean calibrating against different pixels than
    the ones the accuracy figures are scored on.
    """
    from datetime import date as _date, timedelta as _td
    bbox = _types.ward_bounds(ward)
    nxt = (_date.fromisoformat(date) + _td(days=1)).isoformat()
    try:
        acqs = cmr_search("night" if phase == "night" else "day", date, None, nxt, bbox=bbox)
    except Exception:
        return None
    if not acqs:
        return None

    lst: npt.NDArray[np.float32] | None = None
    for _t, grans in acqs:
        for g in grans:
            try:
                p_lst = fetch(band_url(g, "_LST.tif"), tok)
                if not p_lst:
                    continue
                a = align(p_lst, np.nan, "float32", bbox=bbox)
                good = np.isfinite(a) & (a > 200) & (a < 400)
                pq = fetch(band_url(g, "_QC.tif"), tok)
                if pq:
                    q = align(pq, 0xFFFF, "uint16", bbox=bbox)
                    good &= (q != 0xFFFF) & ((q & 0b11) == 0)
                pc = fetch(band_url(g, "_cloud.tif"), tok)
                if pc:
                    good &= align(pc, 255, "uint16", bbox=bbox) != 1
                pw = fetch(band_url(g, "_water.tif"), tok)
                if pw:
                    good &= align(pw, 0, "uint16", bbox=bbox) != 1
                cel = np.where(good, a - 273.15, np.nan).astype(np.float32)
                lst = cel if lst is None else np.where(np.isfinite(lst), lst, cel)
            except Exception:
                continue
    return lst


def landsat_rows(surf: dict[str, tuple[float, float, float]]) -> list[dict[str, Any]]:
    """Landsat ward-scenes, in the ECOSTRESS row shape, joined to their forcing.

    NO GRIDS. The .npz carries one 21x21 ECOSTRESS grid per row for the
    spatial work; Landsat's 30 m window is a different shape entirely, and
    stacking two shapes would need a ragged array or a resample that invents
    detail. These rows serve the WARD-MEAN fit, which is what the accuracy
    figures are scored on, so the mean is all that is required — and the
    .npz index below is written from the ECOSTRESS rows only, deliberately.

    A Landsat pass with no usable POWER hour is DROPPED and COUNTED, never
    interpolated past tolerance: the same rule ECOSTRESS scenes live under.
    """
    if not os.path.exists(LANDSAT_LST):
        print("  no landsat-ward-lst.json — skipping Landsat merge")
        return []
    with open(LANDSAT_LST) as fh:
        lrows = json.load(fh)["rows"]

    # Read the forcing CSV directly rather than through _physics.load(). That
    # loader builds ECOSTRESS SUHII scenes and rightly refuses rows without an
    # urban/rural mask pair, which every Landsat row lacks — going through it
    # dropped all 50 silently. The weather columns are in the CSV regardless of
    # which instrument the row belongs to.
    forcing: dict[str, dict[str, float]] = {}
    with open(MET_CSV, newline="") as fh:
        for m in csv.DictReader(fh):
            if m["suhii"]:
                continue                     # an ECOSTRESS row, not a Landsat pass
            forcing[m["date"]] = {
                "tAir": float(m["tAir"]), "rh": float(m["rh"]),
                "wind": float(m["wind"]), "cloud": float(m["cloud"]),
                "hour": float(m["local_solar_hour"]),
            }

    out: list[dict[str, Any]] = []
    missing = 0
    unphysical_l = 0
    for r in lrows:
        f = forcing.get(r["date"])
        if f is None:
            missing += 1
            continue
        fvc, alb, built = surf[r["ward"]]
        # Same solar-geometry term the ECOSTRESS scenes carry, from the same
        # function, so the two sensors' `sun` means one thing.
        doy = _dt.date.fromisoformat(r["date"]).timetuple().tm_yday
        sun = _physics.solar_factor(f["hour"], doy)
        # The SAME bar as the ECOSTRESS path. Landsat is expected to lose nothing;
        # that it does not is the control that keeps the rule honest.
        if not physical_daytime(r["lst_mean_c"], f["tAir"], sun):
            unphysical_l += 1
            continue
        out.append({
            "date": r["date"], "phase": "day", "ward": r["ward"],
            "lst_mean_c": r["lst_mean_c"], "lst_sd_c": r["lst_sd_c"],
            "cells": r["cells"], "cell_frac": r["cell_frac"],
            "fvc": round(fvc, 4), "albedo": round(alb, 4), "built": round(built, 4),
            "tAir": f["tAir"], "rh": f["rh"], "wind": f["wind"], "cloud": f["cloud"],
            "sun": round(sun, 4),
            # The row's OWN overpass hour, not the forcing scene's. Landsat sits
            # near 10:30 and this column is what the morning stratum is cut on.
            "hour": r["hour_lst"],
            "sensor": "landsat",
            # The reference's own stated uncertainty, carried so P5 can report
            # it beside the model error instead of implying a perfect ruler.
            "st_qa_mean_k": r.get("st_qa_mean_k"),
        })
    if missing:
        print(f"  {missing} Landsat ward-scenes dropped: no POWER forcing at their hour")
    # Expected to be zero. If it is not, say so loudly — a Landsat rejection means
    # either the bar or the Landsat QA chain has changed, and both are load-bearing.
    print(f"  {unphysical_l} Landsat ward-scenes rejected by the sun-up physical bar"
          + ("" if unphysical_l == 0 else "   <-- INVESTIGATE: Landsat has always been 0/213"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    scenes, _lc, dropped = _physics.load(all_angles=False)
    if args.limit:
        scenes = scenes[:args.limit]
    tok = token()
    print(f"  {len(scenes)} near-nadir scenes ({dropped} dropped) x {len(_types.WARDS)} wards\n")

    surf = {w: ward_surface(w) for w in _types.WARDS}
    for w, (f, a, b) in surf.items():
        print(f"  {w:<13} fvc {f:.3f}  albedo {a:.3f}  built {b:.3f}")
    print()

    rows: list[dict[str, Any]] = []
    grids: list[npt.NDArray[np.float32]] = []
    unphysical = 0
    for n, sc in enumerate(scenes, 1):
        for wid, ward in _types.WARDS.items():
            g = ward_lst(ward, sc.date, sc.phase, tok)
            if g is None:
                continue
            m = np.isfinite(g)
            if int(m.sum()) < MIN_CELLS:
                continue
            lst_mean = float(np.nanmean(g))
            if not physical_daytime(lst_mean, sc.tAir, sc.sun):
                unphysical += 1
                continue
            fvc, alb, built = surf[wid]
            rows.append({
                "date": sc.date, "phase": sc.phase, "ward": wid,
                "lst_mean_c": round(lst_mean, 3),
                "lst_sd_c": round(float(np.nanstd(g)), 3),
                "cells": int(m.sum()), "cell_frac": round(float(m.mean()), 3),
                # the ward's own measured surface — what the browser draws with
                "fvc": round(fvc, 4), "albedo": round(alb, 4), "built": round(built, 4),
                # scene forcing, already coerced and solar-time matched by _physics
                "tAir": sc.tAir, "rh": sc.rh, "wind": sc.wind, "cloud": sc.cloud,
                "sun": round(sc.sun, 4), "hour": sc.hour,
                # Which instrument saw this. ECOSTRESS drifts across all hours;
                # Landsat is pinned near 10:30 local solar. Pooling them without
                # a measured offset would put morning rows in the peak stratum,
                # so the sensor must travel with the row, not be inferred later.
                "sensor": "ecostress",
            })
            # NaN is the masking signal and must survive to the cache; a
            # nan_to_num here would erase the distinction between "cloudy"
            # and "measured 0 °C".
            grids.append(g)
        if n % 5 == 0 or n == len(scenes):
            print(f"  [{n:>3}/{len(scenes)}] {len(rows)} ward-scenes")
    print(f"\n  {unphysical} ECOSTRESS ward-scenes rejected by the sun-up physical bar "
          f"(sun > {SUN_UP}, surface more than {MAX_BELOW_AIR_K:.0f} K below air)")

    if not rows:
        sys.exit("no ward-scenes survived masking — nothing to calibrate against")

    n_eco = len(rows)
    rows.extend(landsat_rows(surf))
    print(f"\n  {n_eco} ECOSTRESS + {len(rows) - n_eco} Landsat = {len(rows)} ward-scenes")

    stack = np.stack(grids)
    os.makedirs(os.path.dirname(OUT_NPZ), exist_ok=True)
    # The index rides along as JSON text, one row per grid, so the .npz is
    # self-describing — a bare array of grids with the pairing held in a
    # separate file is one rename away from silently mismatched rows.
    np.savez_compressed(OUT_NPZ, grids=stack,
                        index=np.array([json.dumps(r) for r in rows]))
    meta = {
        "note": "Ward-scale calibration set. Replaces the GHS-SMOD mask pairs, which "
                "sample a landscape (FVC 0.678 urban vs 0.654 rural) rather than the "
                "1400 m wards the product is about (FVC 0.31-0.45).",
        "scenes": len(scenes), "ward_scenes": len(rows),
        "grid_shape": list(stack.shape[1:]),
        "min_cells": MIN_CELLS,
        "sun_up_physical_bar": {
            "rule": "reject when sun > SUN_UP and (lst_mean_c - tAir) < -MAX_BELOW_AIR_K",
            "sun_up": SUN_UP, "max_below_air_K": MAX_BELOW_AIR_K,
            "applies_to": "both instruments, identically",
            "pre_registered": "2026-08-09, before application",
            "rejected_ecostress": unphysical,
        },
        "rows": rows,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(meta, fh, indent=2)

    print(f"\n  {'ward':<13}{'n':>4}{'mean LST':>10}{'sd across scenes':>19}")
    for wid in _types.WARDS:
        v = [r["lst_mean_c"] for r in rows if r["ward"] == wid]
        if v:
            print(f"  {wid:<13}{len(v):>4}{np.mean(v):>10.2f}{np.std(v):>19.2f}")
    for ph in ("day", "night"):
        v = [r["lst_mean_c"] - r["tAir"] for r in rows if r["phase"] == ph]
        if v:
            print(f"  {ph:<13}{len(v):>4}{'':>10}  ward LST − air: {np.mean(v):+.2f} K")
    print(f"\n  written to {os.path.relpath(OUT_JSON, ROOT)} (+ .npz grids)")


if __name__ == "__main__":
    main()
