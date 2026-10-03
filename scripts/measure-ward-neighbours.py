"""
Re-measure the KMC wards around Ballygunge against the CURRENT compute square.

data/geometry/kmc-wards-around-ballygunge.geojson carries, per ward, its share of
the OBOS square ("share_of_obos_box") and whether it holds the square's centre,
plus the square's own area. Those were measured on 2026-09-23 against the old
1,400 m box. Ballygunge became KMC Ward 68 on 2026-10-02 and its square became
1,800 m centred on the ward, so every one of those numbers described a box that
no longer exists. This recomputes them from the geometries, by the method the file
already states (WGS84 geodesic areas), against `_types.ward_bounds` for Ballygunge.

IT ALSO COMPLETES THE NEIGHBOURHOOD. The new square touches wards the old box did
not; a ward that covers part of the square must be in the file, or the shares do
not sum to the square and "every share is measured" stops being true. Missing
wards are copied UNCHANGED from the cached DataMeet file, whose sha256 must equal
the one the file records — a different file is a different dataset.

Geometries are never edited: Ward 68's polygon (which _wardmask.py reads) and every
neighbour's stay byte-for-byte as DataMeet published them.

    python3 scripts/measure-ward-neighbours.py           # rewrite the properties
    python3 scripts/measure-ward-neighbours.py --check   # exit 1 if they are stale
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Any

import pyproj
import shapely
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry

import _types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
FILE = os.path.join(ROOT, "data", "geometry", "kmc-wards-around-ballygunge.geojson")
CACHE = os.path.expanduser("~/.cache/delta-climate/datameet/kolkata.geojson")
GEOD = pyproj.Geod(ellps="WGS84")
#: An intersection smaller than this is a digitising sliver along a shared edge, not a share.
MIN_SHARE_M2 = 1.0


def geodesic_m2(g: BaseGeometry) -> float:
    area, _ = GEOD.geometry_area_perimeter(g)
    return abs(float(area))


def measure(doc: dict[str, Any], datameet: dict[str, Any] | None) -> tuple[dict[str, Any], list[int]]:
    """The file with its shares re-measured; and the ward numbers added from DataMeet."""
    ward = _types.WARDS["ballygunge"]
    west, south, east, north = _types.ward_bounds(ward)
    square = box(west, south, east, north)
    square_m2 = geodesic_m2(square)
    centre = shapely.Point(ward.centre.lon, ward.centre.lat)

    features: list[dict[str, Any]] = list(doc["features"])
    have = {int(f["properties"]["ward"]) for f in features}
    added: list[int] = []
    if datameet is not None:
        for f in datameet["features"]:
            number = int(f["properties"]["WARD"])
            if number in have or not shape(f["geometry"]).intersects(square):
                continue
            if geodesic_m2(shape(f["geometry"]).intersection(square)) < MIN_SHARE_M2:
                continue
            features.append({"type": "Feature", "geometry": f["geometry"], "properties": {
                "area_id": f"kmc-ward-{number}", "ward": number,
                "source": f"DataMeet Municipal_Spatial_Data/Kolkata (KMC 141-ward scheme), property WARD={number}",
                "licence": "CC BY-SA 2.5 India"}})
            added.append(number)
    features.sort(key=lambda f: int(f["properties"]["ward"]))

    for f in features:
        g = shape(f["geometry"])
        p = f["properties"]
        p["area_km2_geodesic"] = round(geodesic_m2(g) / 1e6, 4)
        p["share_of_obos_box"] = round(geodesic_m2(g.intersection(square)) / square_m2, 4)
        p["holds_box_centre"] = bool(g.contains(centre))
        p.pop("share_of_old_1400m_box", None)

    out = dict(doc)
    out["features"] = features
    out["_README"] = [
        "The KMC wards that the OBOS Ballygunge compute square touches, so that every share of the "
        "square is measured, not carried. Ballygunge IS KMC Ward 68 (founder decision 2026-10-02): "
        f"the square is {ward.footprint_m:,} m, centred on Ward 68's bounding box "
        f"({ward.centre.lat} N, {ward.centre.lon} E). Ward statistics are taken inside Ward 68's "
        "polygon; the other wards' buildings in the square are drawn as context. Geometries are "
        "copied unchanged from DataMeet's file.",
        "Re-measured by scripts/measure-ward-neighbours.py (2026-10-03) against the 1,800 m square. "
        "Until then these shares described the old 1,400 m box at 22.528 N, 88.3659 E, which held "
        "only 28.9 % Ward 68 and was centred in Ward 69.",
        "Ward 68 is also in data/geometry/heat-history-areas.geojson, where the satellite histories "
        "read it; its geometry here is identical. The neighbours live in this separate file because "
        "the satellite histories fingerprint heat-history-areas.geojson byte for byte, and adding "
        "features there would invalidate them.",
        "These are the older 141-ward scheme's numbers; KMC now has 144 wards (see kmc_ward_count), "
        "so numbering may have shifted.",
    ]
    out["measured"] = {
        "method": "WGS84 geodesic areas (pyproj.Geod(ellps='WGS84').geometry_area_perimeter) of each "
                  "ward and of its intersection with the OBOS compute square (_types.ward_bounds for "
                  "Ballygunge); recomputed by scripts/measure-ward-neighbours.py",
        "obos_box_km2_geodesic": round(square_m2 / 1e6, 4),
        "obos_box_m": ward.footprint_m,
        "share_sum": round(sum(f["properties"]["share_of_obos_box"] for f in features), 4),
    }
    return out, added


def load_datameet(expected_sha: str) -> dict[str, Any] | None:
    if not os.path.exists(CACHE):
        return None
    with open(CACHE, "rb") as fh:
        raw = fh.read()
    got = hashlib.sha256(raw).hexdigest()
    if got != expected_sha:
        sys.exit(f"  {CACHE}: sha256 {got} is not the recorded {expected_sha} — a different file")
    parsed: dict[str, Any] = json.loads(raw)
    return parsed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    with open(FILE, encoding="utf-8") as fh:
        doc: dict[str, Any] = json.load(fh)
    datameet = load_datameet(str(doc["source"]["file_sha256"]))
    if datameet is None and not args.check:
        sys.exit(f"  {CACHE} is missing — it is needed to complete the neighbourhood")
    out, added = measure(doc, datameet)
    text = json.dumps(out) + "\n"   # the file's own serialisation: compact, ASCII, one line
    for f in out["features"]:
        p = f["properties"]
        print(f"  ward {p['ward']:>3}: {p['area_km2_geodesic']:.4f} km², "
              f"{p['share_of_obos_box'] * 100:5.2f} % of the square"
              f"{'  (holds the centre)' if p['holds_box_centre'] else ''}")
    print(f"  square {out['measured']['obos_box_km2_geodesic']} km², shares sum to {out['measured']['share_sum']}")
    if added:
        print(f"  added from DataMeet: wards {', '.join(map(str, added))}")
    with open(FILE, encoding="utf-8") as fh:
        current = fh.read()
    if args.check:
        if current != text:
            print("  STALE: the committed shares do not match the current square")
            return 1
        print("  ok")
        return 0
    with open(FILE, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  written {os.path.relpath(FILE, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
