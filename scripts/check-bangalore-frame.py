"""Assert the Bangalore ward frame is not mirrored, and that the wards contain
the buildings they were chosen for.

WHY THIS EXISTS. A north-south mirror renders perfectly. Every building is
closed, every height is right, the count is right, and the city is reflected
about its own centre line -- and nobody notices, because nobody knows what
Indiranagar looks like from above. It has now happened twice on this project:
once in the Kolkata footprints, once in the Dubai terrain, where it shipped for
a day. Both were settled numerically in the end, and this is that check written
down before it is needed rather than after.

THE METHOD. Take landmarks whose coordinates are published, convert them into
the ward frame, and require a building of a plausible size within a tight
radius. A mirrored frame puts them hundreds of metres away, on the wrong side of
the ward, every time.

    python3 scripts/check-bangalore-frame.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)

#: (ward, name, lat, lon, max_dist_m, min_area_m2).
#:
#: DELIBERATELY NOT VIDHANA SOUDHA, even though it is the reason MG Road's
#: centre moved. Its published coordinate sits 142 m from the nearest large
#: Overture polygon and 286 m from the largest, so which polygon is the building
#: is unresolved -- and a gate built on an unresolved match tests nothing. It is
#: checked for CONTAINMENT below instead, which is the claim actually made about
#: it. The stadium and UB Tower match at 14 m and 5 m, so they carry the frame.
LANDMARKS = [
    ("mg-road", "M. Chinnaswamy Stadium", 12.9789, 77.5997, 60.0, 20_000.0),
    ("mg-road", "UB Tower", 12.97287, 77.595848, 60.0, 1_500.0),
]

#: (ward, name, lat, lon) -- must fall inside the ward box. This is the claim
#: the MG Road centre shift was made to satisfy, so it is the claim gated.
CONTAINED = [
    ("mg-road", "Vidhana Soudha", 12.9796, 77.5906),
    ("mg-road", "M. Chinnaswamy Stadium", 12.9789, 77.5997),
    ("mg-road", "Subhas Chandra Bose Tower", 12.97406, 77.609894),
    ("mg-road", "UB Tower", 12.97287, 77.595848),
]


def load(ward: str) -> list[blr.BlrBuilding]:
    path = os.path.join(blr.DATA, f"{ward}-buildings.json")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} -- run scripts/fetch-bangalore.py first")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return [cast(blr.BlrBuilding, b) for b in doc["b"]]


def main() -> int:
    failures: list[str] = []
    cache: dict[str, list[blr.BlrBuilding]] = {}

    for ward, name, lat, lon, max_d, min_a in LANDMARKS:
        bs = cache.setdefault(ward, load(ward))
        w = blr.WARDS[ward]
        ex, ey = blr.to_local(w, lon, lat)
        best_d, best_a = 1e9, 0.0
        for b in bs:
            p = b["p"]
            if blr.ring_area(p) < min_a:
                continue
            cx, cy = blr.ring_centroid(p)
            d = math.hypot(cx - ex, cy - ey)
            if d < best_d:
                best_d, best_a = d, blr.ring_area(p)
        ok = best_d <= max_d
        print(f"  {name:<26} expected ({ex:7.0f},{ey:6.0f})  nearest "
              f"{best_a:8.0f} m2 at {best_d:5.0f} m  {'ok' if ok else 'FAIL'}")
        if not ok:
            failures.append(
                f"{ward}/{name}: nearest building >= {min_a:.0f} m2 is {best_d:.0f} m "
                f"away (limit {max_d:.0f} m). A mirrored frame looks exactly like this.")

    for ward, name, lat, lon in CONTAINED:
        w = blr.WARDS[ward]
        ex, ey = blr.to_local(w, lon, lat)
        half = w.size_m / 2.0
        inside = abs(ex) <= half and abs(ey) <= half
        margin = half - max(abs(ex), abs(ey))
        print(f"  {name:<26} inside {ward}? {'yes' if inside else 'NO'} "
              f"(margin {margin:+.0f} m)")
        if not inside:
            failures.append(
                f"{ward}/{name}: falls {-margin:.0f} m OUTSIDE the ward box. "
                "The MG Road centre was moved 300 m west specifically to contain "
                "it; if this fails, that move has been reverted.")

    if failures:
        print()
        for f in failures:
            print(f"  FAIL {f}")
        return 1
    print("\n  frame is not mirrored, and the wards contain what they were chosen for")
    return 0


if __name__ == "__main__":
    sys.exit(main())
