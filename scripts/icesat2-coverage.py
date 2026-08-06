"""Which ICESat-2 beams actually reach the wards? → data/calibration/icesat2-coverage.json

    python3 scripts/icesat2-coverage.py

THE MISTAKE THIS EXISTS TO PREVENT. The first draft of this workstream picked its
gate granule by "closest track: 79 m from Ballygunge centre". That number came
from the granule's CMR bounding POLYGON, which spans the whole six-beam swath
~6.6 km wide. The beams are somewhere inside it, not on its edge. That granule's
nearest strong beam is 6.27 km away and returns zero photons in the ward — the
pipeline correctly rejected it, after a 168 MB download, for a reason that looked
like bad luck rather than a bad premise.

WHY THE ANSWER IS SMALL AND FIXED. ICESat-2 flies 1,387 reference ground tracks
on a 91-day repeat, so the 118 granules over these three wards are only THREE
distinct lines (0416, 0744, 0858). Repeat passes re-fly the same geometry: they
stack photons on the buildings already crossed, and can never add a building the
beam lines miss. The crossed set is capped by this table, which is why an
underpowered verdict downstream cannot be fixed by fetching more data.

WHY RANGED READS. Answering this by download is 118 x 168 MB. h5py over an fsspec
HTTP file reads only the `geolocation/` arrays actually touched — a few MB per
granule — so the whole survey costs one granule's worth of transfer.

EMPTY SEGMENTS CARRY PLACEHOLDER COORDINATES. Segments with segment_ph_cnt == 0
still have a reference_photon_lat/lon, and it is NOT that beam's position: all
six beams share a placeholder line ~11 km off. Including them makes the
per-segment latitude sequence non-monotonic and puts the "closest approach"
anywhere. They are dropped first, and that single filter is the difference
between this file and the wrong answer above.

STRONG vs WEAK is read from each beam's own `atlas_beam_type`, never inferred
from sc_orient. Weak beams are reported too: Ballygunge's weak gt2r passes
CLOSER than its strong gt2l, and is the documented fallback if the strong beam
is photon-starved on a given pass.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

import fsspec
import h5py
import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from _ecostress import token  # noqa: E402
from _types import WARDS, Ward, m_per_deg, ward_bounds  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "calibration", "icesat2-coverage.json")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

BEAMS = ("gt1l", "gt1r", "gt2l", "gt2r", "gt3l", "gt3r")
#: A beam is "inside" a ward when it passes within half the ward footprint of the
#: centre — i.e. it genuinely crosses the box the buildings live in.
INSIDE_M = 700.0
#: Ward-box pad for the photon tally, matching fetch-icesat2.PAD_M + the box half-width.
TALLY_M = 900.0
#: Latitude half-band to search around a ward, degrees. ~10 km, so a track that
#: clips the ward at an angle is still found.
BAND_DEG = 0.09


def granules(w: Ward) -> list[tuple[str, str, str]]:
    """(granule name, RGT, download url) for every ATL03 granule over the ward."""
    r = requests.get(CMR, params={
        "short_name": "ATL03", "version": "007",
        "bounding_box": ",".join(f"{v:.6f}" for v in ward_bounds(w, 200.0)),
        "page_size": "2000"}, timeout=90)
    r.raise_for_status()
    body = r.json()["feed"]["entry"]
    hits = int(r.headers.get("CMR-Hits", len(body)))
    if hits > len(body):
        sys.exit(f"  CMR reports {hits} granules but returned {len(body)} — paginate before trusting this")
    out = []
    for e in body:
        name = e.get("producer_granule_id") or e["title"]
        m = re.match(r"ATL03_\d{14}_(\d{4})", name)
        url = next((l["href"] for l in e.get("links", [])
                    if l["href"].endswith(".h5") and "data" in l.get("rel", "")), None)
        if m and url:
            out.append((name, m.group(1), url))
    return out


def beam_rows(url: str, tok: str) -> list[dict[str, Any]]:
    """Closest approach of every beam to every ward, from one granule, ranged."""
    fs = fsspec.filesystem("http", client_kwargs={
        "headers": {"Authorization": f"Bearer {tok}"}})
    rows: list[dict[str, Any]] = []
    with fs.open(url, "rb", block_size=4 << 20) as fh, h5py.File(fh, "r") as f:
        for beam in BEAMS:
            if beam not in f or "geolocation" not in f[beam]:
                continue
            cnt = f[beam]["geolocation/segment_ph_cnt"][:]
            lat = f[beam]["geolocation/reference_photon_lat"][:]
            lon = f[beam]["geolocation/reference_photon_lon"][:]
            ok = cnt > 0                      # THE filter — see the module docstring
            if not ok.any():
                continue
            lat, lon, cnt = lat[ok], lon[ok], cnt[ok]
            raw = f[beam].attrs.get("atlas_beam_type", b"?")
            kind = raw.decode() if isinstance(raw, bytes) else str(raw)
            for wid, w in WARDS.items():
                band = (lat > w.centre.lat - BAND_DEG) & (lat < w.centre.lat + BAND_DEG)
                if not band.any():
                    continue
                mpd = m_per_deg(w.centre.lat)
                d = np.hypot((lon[band] - w.centre.lon) * mpd.east,
                             (lat[band] - w.centre.lat) * mpd.north)
                rows.append({
                    "ward": wid, "beam": beam, "type": kind,
                    "closest_m": round(float(d.min()), 1),
                    "photons_in_900m": int(cnt[band][d < TALLY_M].sum()),
                })
    return rows


def main() -> None:
    tok = token()
    per_ward: dict[str, list[tuple[str, str, str]]] = {
        wid: granules(w) for wid, w in WARDS.items()}

    tracks: dict[str, str] = {}          # RGT -> one representative url
    dates: dict[str, list[str]] = {}
    for gl in per_ward.values():
        for name, rgt, url in gl:
            tracks.setdefault(rgt, url)
            m = re.match(r"ATL03_(\d{4})(\d{2})(\d{2})", name)
            if m:
                dates.setdefault(rgt, []).append("-".join(m.groups()))

    print(f"  {sum(len(v) for v in per_ward.values())} granules over {len(WARDS)} wards"
          f"  ->  {len(tracks)} distinct ground tracks: {', '.join(sorted(tracks))}\n")

    rows: list[dict[str, Any]] = []
    for rgt, url in sorted(tracks.items()):
        print(f"  RGT {rgt} ({len(set(dates.get(rgt, [])))} passes) …")
        for r in beam_rows(url, tok):
            r["rgt"] = rgt
            rows.append(r)

    crossings = sorted((r for r in rows if r["closest_m"] < INSIDE_M),
                       key=lambda r: r["closest_m"])
    best: dict[str, dict[str, Any]] = {}
    for r in crossings:
        cur = best.get(r["ward"])
        # prefer a STRONG beam even if a weak one passes closer — the subset
        # writer keeps strong beams only.
        better = cur is None or (r["type"] == "strong" and cur["type"] != "strong") or (
            r["type"] == cur["type"] and r["closest_m"] < cur["closest_m"])
        if better:
            best[r["ward"]] = r

    print(f"\n  {len(crossings)} (track, beam, ward) crossings inside {INSIDE_M:.0f} m:")
    for r in crossings:
        print(f"    RGT {r['rgt']} {r['beam']:<5} {r['type']:<6} {r['ward']:<12}"
              f" {r['closest_m']:>7.0f} m   {r['photons_in_900m']:>7} photons/pass")
    print("\n  best strong-beam crossing per ward:")
    for wid in WARDS:
        b = best.get(wid)
        print(f"    {wid:<12} " + (f"RGT {b['rgt']} {b['beam']} ({b['type']}) at "
              f"{b['closest_m']:.0f} m" if b else "NO CROSSING — unreachable"))

    out = {
        "retrieved": "2026-08-06",
        "insideM": INSIDE_M,
        "n_granules": {k: len(v) for k, v in per_ward.items()},
        "tracks": {k: sorted(set(v)) for k, v in dates.items()},
        "beams": rows,
        "best_per_ward": best,
        "note": ("ICESat-2 repeats its reference ground tracks on a 91-day cycle, so "
                 "these granules are a handful of fixed lines re-flown. Repeat passes "
                 "stack photons on the SAME crossed buildings and cannot add new ones; "
                 "the crossed-building set is capped by this table. Distances are from "
                 "per-segment reference photon positions with empty segments dropped — "
                 "NOT from CMR bounding polygons, which span the ~6.6 km six-beam swath "
                 "and gave a 79 m answer for a beam that is really 6.27 km away."),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
