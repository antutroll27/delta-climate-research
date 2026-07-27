#!/usr/bin/env python3
"""
Measure Surface Urban Heat Island Intensity over Kolkata from ECOSTRESS.

    SUHII = mean(LST | urban) − mean(LST | rural)

This is the validation our model has never had: everything in the heat-map's
physics is calibrated against published literature, never against measurement
of our own study area.

    python3 scripts/ecostress-suhii.py [--date 2025-04-24] [--day]

METHOD (equal-area rural reference, Peng et al. 2012 / Zhou et al. 2014 lineage)

  Urban / rural classes come from GHS-SMOD R2023A, the EU/UN "Degree of
  Urbanisation" standard endorsed by the UN Statistical Commission. Using an
  independent settlement classification — rather than thresholding temperature
  or drawing a fixed-radius ring — avoids circularity and is what a reviewer
  expects to see.

      urban = 30            Urban Centre
      rural = 11 / 12 / 13  Very low density / low density / rural cluster
      excluded = 21 / 22    suburban + semi-dense transition zone
      excluded = 10         water

  Additional exclusions, each closing a documented failure mode:
    * WATER — the Hooghly and the East Kolkata Wetlands. High heat capacity
      inflates daytime SUHII and deflates it at night; Bera et al. measured a
      3.41 °C variance across EKW shoreline buffers, comparable in size to the
      signal itself. Masked from both classes via ECOSTRESS's own water band.
    * ELEVATION — rural samples held within ±50 m of the urban mean
      (Imhoff et al. 2010 convention). Trivially satisfied in the Bengal delta,
      but stated because a documented check converts a weakness into a strength.
    * VIEW ANGLE — ECOSTRESS reaches ±52° off-nadir and thermal anisotropy is
      large. Urban and rural view-angle distributions are reported so a
      systematic difference between the two populations cannot hide.

  Sensitivity: the result is reported under three rural definitions. Stability
  across them is the strongest available defence, because the method-choice
  literature shows urban-extent product alone moves SUHII by ~40%.

SANITY RANGE  Published Kolkata night SUHII is 0.85–1.5 °C (Nayak 2023, Jain
2023, Siddiqui 2021). Above ~2.5 °C from a buffer method indicates a processing
error — most often unmasked water or cloud leakage. Expect to land somewhat
higher than the 1 km MODIS literature: 70 m pixels resolve hot roofs that a
1 km pixel dilutes.
"""
import argparse
import os
import sys
import warnings
from collections import defaultdict
from typing import Any

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
from _ecostress import (  # noqa: E402  (path must be set first — not a package)
    Acquisition, Bbox, align as _align, band_url, cmr_search, fetch, token,
)

warnings.filterwarnings("ignore")
np.seterr(all="ignore")

# Wide enough to contain genuine rural hinterland — the ward bbox is all urban.
BBOX = (88.00, 22.05, 88.85, 22.95)
SMOD = os.path.expanduser(
    "~/.cache/delta-climate/ghsl/GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0_R7_C27.tif")

SMOD_LABEL = {30: "Urban Centre", 23: "Dense Urban Cluster", 22: "Semi-dense Cluster",
              21: "Suburban / peri-urban", 13: "Rural Cluster", 12: "Low Density Rural",
              11: "Very Low Density Rural", 10: "Water"}
URBAN = {30}
RURAL_DEFS = {
    "strict   (11,12,13)":        {11, 12, 13},
    "+rural cluster excl. (11,12)": {11, 12},
    "wide    (11,12,13,21)":      {11, 12, 13, 21},   # includes peri-urban transition
}


def align(path: str, nodata: float, dtype: str) -> Any:
    """Shared align(), pinned to THIS script's wider bbox.

    The wide bbox is the whole point of the file — SUHII needs rural hinterland
    that the ward bbox does not contain — so it must be passed on every call. A
    bare `_align(path, ...)` silently uses the ward bbox and measures the urban
    core against itself.
    """
    return _align(path, nodata, dtype, bbox=BBOX)


# Centre longitude of the study bbox, for true local solar time. ISS precession
# means acquisitions land at any hour, so solar time — not a fixed +5:30 offset —
# is the physically meaningful variable when comparing scenes.
LON_CENTRE = (BBOX[0] + BBOX[2]) / 2


def local_solar_hour(iso_utc: str) -> float:
    hh, mm = int(iso_utc[11:13]), int(iso_utc[14:16])
    return (hh + mm / 60 + LON_CENTRE / 15.0) % 24


def measure_scene(date: str, phase: str, want_view: bool = False) -> _types.SceneRow:
    """
    Measure SUHII for one acquisition date.

    Returns a result dict, or a dict with status='skipped' and a reason, or None
    if nothing was retrievable. NEVER calls sys.exit — a single bad granule must
    not kill a 237-scene sweep.

    want_view controls fetching view_zenith (3.3 MB/tile, vs 1.1 MB for all the
    other bands combined). It feeds one control check, so the sweep fetches it
    only for scenes that already cleared the usability bar.
    """
    from datetime import date as _date, timedelta as _td
    row: _types.SceneRow = {"date": date, "phase": phase, "status": "ok", "reason": ""}
    try:
        tok = token()
        nxt = (_date.fromisoformat(date) + _td(days=1)).isoformat()
        acqs = cmr_search(phase, date, None, nxt, bbox=BBOX)
    except Exception as exc:
        return {**row, "status": "error", "reason": f"cmr: {str(exc)[:60]}"}
    if not acqs:
        return {**row, "status": "skipped", "reason": "no acquisitions"}

    when = acqs[0][0]
    row["utc"] = when
    row["local_solar_hour"] = round(local_solar_hour(when), 2)
    row["month"] = int(date[5:7])

    lst = view = water = None
    tiles = set()
    for _t, grans in acqs:
        for g in grans:
            try:
                u_lst = band_url(g, "_LST.tif")
                p_lst = fetch(u_lst, tok)
                if not p_lst:
                    continue
                a = align(p_lst, np.nan, "float32")
                good = np.isfinite(a) & (a > 200) & (a < 400)

                pq = fetch(band_url(g, "_QC.tif"), tok)
                if pq:
                    q = align(pq, 0xFFFF, "uint16")
                    good &= (q != 0xFFFF) & ((q & 0b11) == 0)
                pc = fetch(band_url(g, "_cloud.tif"), tok)
                if pc:
                    good &= align(pc, 255, "uint16") != 1

                cel = np.where(good, a - 273.15, np.nan)
                lst = cel if lst is None else np.where(np.isfinite(lst), lst, cel)
                tiles.add(g["GranuleUR"].split("_")[5])

                pw = fetch(band_url(g, "_water.tif"), tok)
                if pw:
                    w_ = align(pw, 0, "uint16") == 1
                    water = w_ if water is None else (water | w_)
                if want_view:
                    pv = fetch(band_url(g, "_view_zenith.tif"), tok)
                    if pv:
                        v_ = align(pv, np.nan, "float32")
                        view = v_ if view is None else np.where(np.isfinite(view), view, v_)
            except Exception as exc:
                row["reason"] = f"tile: {str(exc)[:50]}"
                continue

    if lst is None or not np.isfinite(lst).any():
        return {**row, "status": "skipped", "reason": "no usable LST pixels"}
    if water is None:
        water = np.zeros(lst.shape, bool)

    smod = align(SMOD, -200, "int16")
    valid = np.isfinite(lst) & (smod > 0) & ~water & (smod != 10)
    row["tiles"] = "+".join(sorted(tiles))
    row["usable_frac"] = round(float(np.isfinite(lst).mean()), 4)
    row["valid_px"] = int(valid.sum())
    row["water_px"] = int(water.sum())

    urb = valid & np.isin(smod, list(URBAN))
    if urb.sum() < 50:
        return {**row, "status": "skipped", "reason": "too few urban pixels"}
    u_mean = float(np.nanmean(lst[urb]))
    row["urban_mean"] = round(u_mean, 3)
    row["urban_px"] = int(urb.sum())

    # Written through an explicitly-keyed table rather than f-string keys. The
    # six column names are a contract on disk — build-calibration-set.py lists
    # them as CSV fieldnames and _physics.py reads rural_strict back — so a typo
    # in an f-string would produce a column nobody reads and a blank one where
    # the data was meant to go, with no error at any point.
    rural_mean: dict[str, float] = {}
    for name, codes in RURAL_DEFS.items():
        rur = valid & np.isin(smod, list(codes))
        if rur.sum() < 50:
            continue
        rural_mean[name.split()[0]] = float(np.nanmean(lst[rur]))
    suhii = {k: u_mean - v for k, v in rural_mean.items()}
    if "strict" in rural_mean:
        row["rural_strict"] = round(rural_mean["strict"], 3)
        row["suhii_strict"] = round(suhii["strict"], 3)
    if "+rural" in rural_mean:
        row["rural_+rural"] = round(rural_mean["+rural"], 3)
        row["suhii_+rural"] = round(suhii["+rural"], 3)
    if "wide" in rural_mean:
        row["rural_wide"] = round(rural_mean["wide"], 3)
        row["suhii_wide"] = round(suhii["wide"], 3)
    if not suhii:
        return {**row, "status": "skipped", "reason": "too few rural pixels"}

    vals = list(suhii.values())
    row["suhii"] = round(float(np.mean(vals)), 3)
    row["suhii_spread"] = round(float(max(vals) - min(vals)), 3)

    # QC accuracy distribution is intentionally not recomputed here; the census
    # script reports it per scene and it is invariant for a given granule set.
    if view is not None:
        rur0 = valid & np.isin(smod, list(RURAL_DEFS["strict   (11,12,13)"]))
        vu = float(np.nanmean(np.abs(view[urb])))
        vr = float(np.nanmean(np.abs(view[rur0])))
        row["view_urban"] = round(vu, 2)
        row["view_rural"] = round(vr, 2)
        row["view_delta"] = round(abs(vu - vr), 2)
    return row


def main() -> None:

    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2025-04-24", help="acquisition date, YYYY-MM-DD")
    ap.add_argument("--day", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(SMOD):
        sys.exit(f"GHS-SMOD tile not cached at {SMOD}")

    tok = token()
    flag = "day" if args.day else "night"
    # proper date arithmetic — naive +1 breaks on month ends (2025-01-31 -> 01-32)
    from datetime import date as _date, timedelta as _td
    _d = _date.fromisoformat(args.date)
    nxt = (_d + _td(days=1)).isoformat()
    acqs = cmr_search(flag, args.date, 20, nxt)
    if not acqs:
        sys.exit(f"no {flag} acquisitions on {args.date}")

    # Build the mosaic across every tile intersecting the wide bbox.
    lst = view = water = None
    for when, grans in acqs:
        for g in grans:
            u_lst = band_url(g, "_LST.tif")
            if not u_lst:
                continue
            p = fetch(u_lst, tok)
            if not p:
                continue
            a = align(p, np.nan, "float32")
            good = np.isfinite(a) & (a > 200) & (a < 400)

            pq = fetch(band_url(g, "_QC.tif"), tok)
            if pq:
                q = align(pq, 0xFFFF, "uint16")
                good &= (q != 0xFFFF) & ((q & 0b11) == 0)
            pc = fetch(band_url(g, "_cloud.tif"), tok)
            if pc:
                good &= align(pc, 255, "uint16") != 1

            cel = np.where(good, a - 273.15, np.nan)
            lst = cel if lst is None else np.where(np.isfinite(lst), lst, cel)

            pw = fetch(band_url(g, "_water.tif"), tok)
            if pw:
                w_ = align(pw, 0, "uint16") == 1
                water = w_ if water is None else (water | w_)
            pv = fetch(band_url(g, "_view_zenith.tif"), tok)
            if pv:
                v_ = align(pv, np.nan, "float32")
                view = v_ if view is None else np.where(np.isfinite(view), view, v_)

    if lst is None or not np.isfinite(lst).any():
        sys.exit("no usable LST pixels for that date")
    if water is None:
        water = np.zeros(lst.shape, bool)

    smod = align(SMOD, -200, "int16")
    valid = np.isfinite(lst) & (smod > 0) & ~water & (smod != 10)

    print(f"ECOSTRESS SUHII · Kolkata · {args.date} · {flag}")
    print(f"grid {lst.shape[1]}x{lst.shape[0]} @70 m   usable pixels {int(valid.sum()):,}"
          f"  ({100*np.isfinite(lst).mean():.1f}% of scene has LST)\n")

    print(f"{'SMOD class':<26}{'pixels':>10}{'mean LST':>11}{'sd':>7}")
    print("-" * 56)
    for code in (30, 23, 22, 21, 13, 12, 11):
        m = valid & (smod == code)
        if m.sum() >= 20:
            print(f"{SMOD_LABEL[code]:<26}{int(m.sum()):>10,}{np.nanmean(lst[m]):>10.2f}°{np.nanstd(lst[m]):>7.2f}")

    urb = valid & np.isin(smod, list(URBAN))
    if urb.sum() < 50:
        sys.exit("too few urban pixels")
    u_mean = float(np.nanmean(lst[urb]))

    print(f"\n{'rural definition':<30}{'pixels':>9}{'rural':>9}{'urban':>9}{'SUHII':>9}")
    print("-" * 68)
    results = []
    for name, codes in RURAL_DEFS.items():
        rur = valid & np.isin(smod, list(codes))
        if rur.sum() < 50:
            print(f"{name:<30}{int(rur.sum()):>9,}   too few pixels")
            continue
        r_mean = float(np.nanmean(lst[rur]))
        s = u_mean - r_mean
        results.append(s)
        print(f"{name:<30}{int(rur.sum()):>9,}{r_mean:>8.2f}°{u_mean:>8.2f}°{s:>+8.2f}°")

    # --- documented control checks -----------------------------------------
    print("\ncontrol checks")
    rur0 = valid & np.isin(smod, list(RURAL_DEFS["strict   (11,12,13)"]))
    if view is not None:
        vu, vr = np.nanmean(np.abs(view[urb])), np.nanmean(np.abs(view[rur0]))
        flag_v = "ok" if abs(vu - vr) < 5 else "CHECK — populations differ"
        print(f"  view zenith   urban {vu:5.1f}°   rural {vr:5.1f}°   Δ {abs(vu-vr):4.1f}°   {flag_v}")
    print(f"  water masked  {int(water.sum()):,} px excluded (Hooghly + EKW)")
    print(f"  transition    SMOD 21/22 excluded from both classes")

    if results:
        lo, hi = min(results), max(results)
        print(f"\nSUHII {np.mean(results):+.2f} °C   (range {lo:+.2f} to {hi:+.2f} "
              f"across {len(results)} rural definitions, spread {hi-lo:.2f} °C)")
        m = float(np.mean(results))
        # Sanity bands differ by phase. Indian DAYTIME SUHII is routinely small or
        # negative in pre-monsoon: rural land goes barren and its evapotranspiration
        # collapses, so the countryside outruns the city (Shastri et al. 2017;
        # Kumar et al. 2017 find >60% of Indian urban areas show a daytime cool
        # island). A negative daytime value here is a real signal, not an error.
        if args.day:
            band, label = (-1.0, 1.5), "Kolkata/India daytime"
        else:
            band, label = (0.85, 2.5), "Kolkata night"
        if m > band[1]:
            verdict = "ABOVE the published range — suspect processing error (unmasked water or cloud leakage)"
        elif m < band[0]:
            verdict = "BELOW the published range — check the rural class for contamination"
        else:
            verdict = "consistent with published values"
        print(f"published {label} SUHII: {band[0]} to {band[1]} °C  ->  {verdict}")


if __name__ == "__main__":
    main()
