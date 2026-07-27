"""
SUHII measurement for one ECOSTRESS acquisition: masks, urban/rural definitions,
and the per-scene measurement itself.

WHY THIS FILE EXISTS — the same reason as _physics.py and _ecostress.py.
`build-calibration-set.py` needs `measure_scene`, and `ecostress-suhii` is not an
importable module name, so it reached it through
`importlib.util.spec_from_file_location`. That makes the module `Any`: the call
had to be re-declared behind a `cast` to recover its return type, `suhii.BBOX`
had to be cast to a tuple, and a renamed argument would have surfaced as a wrong
number rather than an error. A leading underscore keeps this out of the CLI
namespace while making it a normal, checkable import.

`ecostress-suhii.py` remains the documented entrypoint and keeps the reporting.
This file is the measurement.

SANITY RANGE. Published Kolkata night SUHII is 0.85-1.5 C (Nayak 2023, Jain
2023, Siddiqui 2021). Above ~2.5 C from a buffer method indicates a processing
error — most often unmasked water or cloud leakage. Expect to land somewhat
higher than the 1 km MODIS literature: 70 m pixels resolve hot roofs that a 1 km
pixel dilutes.
"""
from __future__ import annotations

import os
import sys
from datetime import date as _date, timedelta as _td
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402
from _ecostress import (  # noqa: E402  (path must be set first — not a package)
    Bbox, align as _align, band_url, cmr_search, fetch, token,
)

np.seterr(all="ignore")

# Wide enough to contain genuine rural hinterland — the ward bbox is all urban.
#
# _types.STUDY_BBOX, not a local literal. landcover-fractions.py measures its
# class fractions on the grid these temperatures come from, so the two windows
# must be the same; when both held their own copy, the only thing keeping them
# equal was a runtime reconciliation check in the other file. One binding means
# there is nothing left to reconcile.
BBOX: Bbox = _types.STUDY_BBOX
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


def _self_check() -> None:
    """ponytail: one runnable check — the parts that are pure arithmetic."""
    # Local solar hour must track the study meridian, not UTC. Getting this
    # wrong is invisible in the output (every scene just shifts) and it is what
    # the season x phase coverage matrix is binned on.
    assert abs(LON_CENTRE - 88.425) < 1e-9, f"study meridian moved: {LON_CENTRE}"
    h = local_solar_hour("2026-06-26T17:46:00Z")
    assert abs(h - (17 + 46 / 60 + 88.425 / 15.0)) < 1e-9, h
    assert 0 <= local_solar_hour("2026-01-01T23:59:00Z") < 24, "must wrap into [0,24)"

    # The rural definitions are nested: strict contains +rural, wide contains
    # strict. If that ever inverts, suhii_spread stops being an uncertainty.
    strict = RURAL_DEFS["strict   (11,12,13)"]
    excl   = RURAL_DEFS["+rural cluster excl. (11,12)"]
    wide   = RURAL_DEFS["wide    (11,12,13,21)"]
    assert excl < strict < wide, "rural definitions must nest, narrowest first"
    assert not (URBAN & wide), "a class cannot be both urban and rural"
    assert 10 not in (strict | wide), "water (10) must never count as rural land"

    # The six CSV columns measure_scene writes are keyed off these names.
    assert {n.split()[0] for n in RURAL_DEFS} == {"strict", "+rural", "wide"}
    assert BBOX is _types.STUDY_BBOX, "the study window must not be a local copy"
    print("  _suhii self-check OK")


if __name__ == "__main__":
    _self_check()
