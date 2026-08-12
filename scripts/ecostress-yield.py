#!/usr/bin/env python3
"""Can a city support a tier-1 calibration? Measure the ECOSTRESS yield.

TRACK A's feasibility test. `ecostress-census.py` reports per-ward temperatures
for the three Kolkata wards and is hardcoded to them. This asks the one question
that has to be answered BEFORE any city is adopted, for ANY bbox:

    of the acquisitions that exist, how many are honestly usable?

Existence is free to count from CMR metadata. Usability is not -- it needs the
LST, cloud and QC bands pulled and masked, which is why this samples rather than
sweeps. The masking mirrors ecostress-census.py exactly: raw pixels in a physical
range, cloud from the separate cloud.tif (the QC cloud bits are UNSET in v002),
and mandatory-QA == 00.

SAMPLE ACROSS THE ARCHIVE, NOT THE NEWEST END. `cmr_search` sorts newest-first,
so the first N acquisitions are all one season. Measured 2026-08-12: the newest
14 Dubai day scenes are all May-Aug and report 0 % cloud, which is true and
useless -- Gulf cloud is a winter phenomenon. `--stride` takes every Nth
acquisition across the whole archive instead, which is what makes the cloud
number mean anything.

COVERAGE IS REPORTED SEPARATELY FROM QUALITY, and that distinction is the whole
point of the output. An acquisition whose tile clips the study box has no cloud
problem and no quality problem; it simply is not there. Folding the two together
produces a "usable %" that looks like weather and is really geometry.

    python3 scripts/ecostress-yield.py --bbox 55.20,25.13,55.35,25.28
    python3 scripts/ecostress-yield.py --stride 13 --phase night
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import warnings
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _ecostress import (  # noqa: E402  (path must be set first — not a package)
    BBOX, Bbox, band_url, cmr_search, fetch, read_window, target_crs, target_grid, token,
)

warnings.filterwarnings("ignore")
np.seterr(all="ignore")

#: Below this fraction of the study box, an acquisition is a tile clip rather
#: than an observation, and its cloud/quality numbers describe a sliver.
MIN_COVERAGE = 0.50

#: (celsius, raw-LST, cloudy, cloud-band-has-data).
#:
#: `cloudy` is the cloud band ON ITS OWN, deliberately NOT intersected with `raw`.
#: Intersecting is the obvious thing and it destroys the diagnosis: when the LST
#: retrieval fails entirely, `raw` is empty, so `cloud & raw` is empty too and
#: every cloud-killed scene reports 0 % cloudy — indistinguishable from a clear
#: sky. That mislabelled all of Kolkata's cloud losses as "no retrieval" until a
#: direct probe of the bands contradicted the tool.
Masks = tuple[npt.NDArray[Any], npt.NDArray[Any], npt.NDArray[Any], npt.NDArray[Any]]


def scene_masks(grans: list[dict[str, Any]], bbox: Bbox, tok: str) -> Masks | None:
    """(celsius, raw, cloudy, cloud_seen) for one acquisition, merged across tiles.

    Tiles are masked INDEPENDENTLY and merged after. Masking the merged raw bands
    is wrong: where a tile has no coverage its QC reads as fill, and OR-ing "bad"
    across tiles condemns the whole scene. First valid pixel wins on overlap.
    """
    merged: Masks | None = None
    for g in grans:
        u_lst, u_cld, u_qc = (band_url(g, s) for s in ("_LST.tif", "_cloud.tif", "_QC.tif"))
        if not u_lst:
            continue
        p_lst = fetch(u_lst, tok)
        if not p_lst:
            continue
        a, _tf, _crs = read_window(p_lst, bbox=bbox)
        raw = np.isfinite(a) & (a > 200) & (a < 400)

        cloud = np.zeros_like(raw)
        seen = np.zeros_like(raw)
        p = fetch(u_cld, tok) if u_cld else None
        if p is not None:
            cb = read_window(p, nodata=255, dtype="uint16", bbox=bbox)[0]
            cloud, seen = cb == 1, cb != 255

        qc_ok = np.ones_like(raw)
        p = fetch(u_qc, tok) if u_qc else None
        if p is not None:
            q = read_window(p, nodata=0xFFFF, dtype="uint16", bbox=bbox)[0]
            qc_ok = (q != 0xFFFF) & ((q & 0b11) == 0)

        c = np.where(raw & ~cloud & qc_ok, a - 273.15, np.nan)
        merged = ((c, raw, cloud, seen) if merged is None else
                  (np.where(np.isfinite(merged[0]), merged[0], c),
                   merged[1] | raw, merged[2] | cloud, merged[3] | seen))
    return merged


def verdict(raw: npt.NDArray[Any], cloudy: npt.NDArray[Any],
            seen: npt.NDArray[Any]) -> str:
    """Why an acquisition yielded nothing. Three causes, and they are NOT the same.

    Getting this wrong nearly produced a false headline. An earlier version called
    every empty scene a "tile clip", which reads as geometry and would have had us
    conclude Dubai simply sits badly against the MGRS grid. Measured 2026-08-12,
    the two cities fail for different reasons entirely:

      Kolkata  cloud band present and 100 % / 99.9 % CLOUDY, LST all NaN
               -> the retrieval failed under cloud. Weather.
      Dubai    cloud band present and 0 % cloudy on every failure, LST all NaN
               -> not weather. Something else removes the retrieval, most likely
                  swath geometry, and this tool does not establish which.

    Reporting those as one number would have credited Dubai's advantage to clear
    skies when its losses have nothing to do with sky at all.
    """
    if not seen.any():
        return "no data — tile does not reach this box"
    frac = float(cloudy.sum()) / max(int(seen.sum()), 1)
    if frac > 0.5:
        return f"cloud — retrieval failed, {frac:.0%} cloudy"
    return "no retrieval — cloud band says clear (cause NOT established)"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bbox", default="", help="w,s,e,n in degrees; default Kolkata")
    ap.add_argument("--from", dest="start", default="2024-01-01")
    ap.add_argument("--stride", type=int, default=13,
                    help="sample every Nth acquisition across the archive")
    ap.add_argument("--phase", choices=["day", "night", "both"], default="both")
    args = ap.parse_args()

    bbox: Bbox = BBOX
    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        if len(parts) != 4:
            raise SystemExit("--bbox needs exactly w,s,e,n")
        bbox = (parts[0], parts[1], parts[2], parts[3])

    tok = token()
    _tf, w, h = target_grid(bbox)
    print(f"  bbox {bbox} · {target_crs(bbox)} · grid {w}x{h} @ 70 m")
    print(f"  from {args.start} · every {args.stride}th acquisition\n")

    phases = ["day", "night"] if args.phase == "both" else [args.phase]
    for phase in phases:
        allacq = cmr_search(phase, args.start, None, "", bbox)
        sample = allacq[::args.stride]
        print(f"  === {phase.upper()} · {len(sample)} sampled of {len(allacq)} "
              f"acquisitions ===")
        print(f"  {'acquired (UTC)':<22}{'cover':>7}{'cloud':>8}{'usable':>8}{'meanC':>8}")
        print("  " + "-" * 53)

        by_month: dict[str, list[tuple[float, float]]] = collections.defaultdict(list)
        why: collections.Counter[str] = collections.Counter()
        for when, grans in sample:
            m = scene_masks(list(grans), bbox, tok)
            if m is None:
                continue
            c, raw, cloud, seen = m
            cover = float(raw.sum()) / raw.size
            if cover < MIN_COVERAGE:
                v = verdict(raw, cloud, seen)
                why[v.split("—")[0].strip()] += 1
                print(f"  {when:<22}{cover:>6.0%}   {v}")
                continue
            # Among OBSERVED pixels only — `cloud` is the unmasked band, see Masks.
            cld = float((cloud & raw).sum()) / float(raw.sum())
            use = float(np.isfinite(c).sum()) / float(raw.sum())
            by_month[when[5:7]].append((cld, use))
            print(f"  {when:<22}{cover:>6.0%}{cld:>8.1%}{use:>8.0%}"
                  f"{float(np.nanmean(c)):>8.1f}")

        kept = sum(len(v) for v in by_month.values())
        n = len(sample)
        if why:
            print(f"\n  lost scenes by cause: "
                  + " · ".join(f"{k} {v}" for k, v in why.most_common()))
        if kept:
            cl = [x[0] for v in by_month.values() for x in v]
            us = [x[1] for v in by_month.values() for x in v]
            print(f"\n  {kept}/{n} acquisitions cleared {MIN_COVERAGE:.0%} coverage "
                  f"({n - kept} lost)")
            print(f"  cloud  mean {sum(cl)/len(cl):.1%}  max {max(cl):.1%}")
            print(f"  usable mean {sum(us)/len(us):.0%}  min {min(us):.0%}")
            print(f"  months sampled with coverage: {', '.join(sorted(by_month))}")
            print(f"  → projected usable acquisitions in archive: "
                  f"{round(len(allacq) * kept / n * (sum(us)/len(us))):,}")
        else:
            print(f"\n  0/{n} acquisitions cleared {MIN_COVERAGE:.0%} coverage — "
                  f"this box may straddle an MGRS tile edge")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
