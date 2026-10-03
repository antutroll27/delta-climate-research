"""Ward polygon mask -> public/heat-map/data/{ward}-ward.json, for wards that have one.

WHY. Ballygunge's compute domain is an 1800 m square around KMC Ward 68
(founder decision 2026-10-02), and ward statistics are to be masked to the real
polygon. The app does not mask anything yet; this is the artefact it will load
when it does, so the boundary, the solver grid and the building rows are
already aligned to each other and checked here rather than re-derived in the
browser.

WHAT IT CARRIES, all in the ward-local frame (metres, x east, y north, about
`center`, the same frame as {ward}.json):

    ring      the Ward 68 exterior as a flat [x0, y0, x1, y1, ...], 0.1 m
    grid      the SOLVER grid mask: n x n over sizeM, SOUTH-up (row 0 is the
              southern edge, index gy*n + gx, exactly ward-raster.ts's layout),
              True where the cell CENTRE lies inside the polygon, run-length
              encoded (first run is OUTSIDE; see _wardmask.rle)
    surface   the same at the served 10 m surface/canopy PNG grid, NORTH-up
              (row 0 is the northern edge, as the PNGs are stored)
    inWard    row-indexed against {ward}.json's `b`: 1 when that footprint
              INTERSECTS the polygon (fetch-buildings.py's flag), else 0

LICENCE. The ring and both masks are derivatives of the DataMeet polygon, so
this file carries CC BY-SA 2.5 India and its attribution.

    python3 scripts/build-ward-mask.py
    python3 scripts/build-ward-mask.py --check
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _types  # noqa: E402
import _wardmask  # noqa: E402
from _sentinel import grid_for  # noqa: E402

ROOT = os.path.join(HERE, "..")
DATA = os.path.join(ROOT, "public", "heat-map", "data")
GEOM = os.path.join(ROOT, "data", "geometry")
TYPES_TS = os.path.join(ROOT, "src", "scripts", "climate-engine", "types.ts")


def solver_n(size_m: int) -> int:
    """The admitted solver grid for this ward size, READ from types.ts.

    Not a Python copy of ADMITTED_GRIDS: a second table is how the two would
    drift, and a mask on the wrong grid is a correctly-shaped array describing
    the wrong cells.
    """
    with open(TYPES_TS, encoding="utf-8") as fh:
        src = fh.read()
    pairs = {int(m.group(2)): int(m.group(1)) for m in
             re.finditer(r"\{\s*n:\s*(\d+),\s*sizeM:\s*(\d+),\s*version:", src)}
    if size_m not in pairs:
        raise SystemExit(f"no admitted grid for a {size_m} m ward in types.ts")
    return pairs[size_m]


def out_path(ward_id: str) -> str:
    return os.path.join(DATA, f"{ward_id}-ward.json")


def build(ward: _types.Ward) -> dict[str, Any]:
    poly = _wardmask.polygon_local(ward)
    assert poly is not None
    n = solver_n(ward.footprint_m)
    ns = grid_for(ward.footprint_m)
    solver = _wardmask.mask_grid(ward, n, rows="south-up")
    surface = _wardmask.mask_grid(ward, ns, rows="north-up")
    assert solver is not None and surface is not None
    with open(os.path.join(DATA, f"{ward.id}.json"), encoding="utf-8") as fh:
        shipped = json.load(fh)
    with open(os.path.join(GEOM, f"{ward.id}-footprints.json"), encoding="utf-8") as fh:
        foot = json.load(fh)
    if len(foot["b"]) != len(shipped["b"]):
        raise SystemExit(f"{ward.id}: {len(foot['b'])} footprints vs {len(shipped['b'])} "
                         f"shipped rows -- the row index would not line up")
    in_ward = [1 if r["inWard"] else 0 for r in foot["b"]]
    ring: list[float] = []
    for x, y in list(poly.exterior.coords)[:-1]:
        ring += [round(x, 1), round(y, 1)]
    kmc = _wardmask.POLYGONS[ward.id][1]
    return {
        "ward": ward.id,
        "kmcWard": kmc,
        "name": f"KMC Ward {kmc}",
        "licence": _wardmask.LICENCE,
        "licenceUri": _wardmask.LICENCE_URI,
        "attribution": _wardmask.ATTRIBUTION,
        "center": [ward.centre.lat, ward.centre.lon],
        "sizeM": ward.footprint_m,
        "frame": "ward-local metres about `center`: x east, y north (the {ward}.json frame)",
        "areaM2": round(poly.area),
        "ring": ring,
        "grid": {
            "n": n, "cellM": ward.footprint_m / n, "rows": "south-up",
            "index": "gy*n + gx; cell centre (-sizeM/2 + (gx+0.5)*cellM, -sizeM/2 + (gy+0.5)*cellM)",
            "rule": "cell centre inside the polygon",
            "cells": int(solver.sum()),
            "rle": _wardmask.rle(solver),
        },
        "surface": {
            "n": ns, "cellM": ward.footprint_m / ns, "rows": "north-up",
            "index": "row*n + col; row 0 is the NORTHERN edge, as the surface/canopy PNGs",
            "rule": "cell centre inside the polygon",
            "cells": int(surface.sum()),
            "rle": _wardmask.rle(surface),
        },
        "inWardRule": "footprint INTERSECTS the polygon (scripts/fetch-buildings.py)",
        "inWardCount": sum(in_ward),
        "inWard": in_ward,
    }


def check() -> int:
    bad = 0
    for ward in _types.WARDS.values():
        path = out_path(ward.id)
        if not _wardmask.has_polygon(ward.id):
            if os.path.exists(path):
                print(f"  {ward.id}: has a mask artefact but no polygon"); bad += 1
            continue
        if not os.path.exists(path):
            print(f"  {ward.id}: MISSING {os.path.relpath(path, ROOT)}"); bad += 1; continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        want = build(ward)
        for key in ("licence", "licenceUri", "attribution", "center", "sizeM", "ring", "grid", "surface", "inWard"):
            if doc.get(key) != want[key]:
                print(f"  {ward.id}: `{key}` is stale against the polygon, the ward table "
                      f"or the footprints -- regenerate"); bad += 1
        for key in ("grid", "surface"):
            g = doc[key]
            if sum(g["rle"]) != g["n"] ** 2:
                print(f"  {ward.id}: {key} runs sum to {sum(g['rle'])}, not {g['n'] ** 2}"); bad += 1
        if not bad:
            share = doc["grid"]["cells"] / doc["grid"]["n"] ** 2
            print(f"  {ward.id}: KMC Ward {doc['kmcWard']} · {doc['areaM2'] / 1e6:.4f} km² · "
                  f"{doc['grid']['cells']:,} of {doc['grid']['n']}² solver cells ({share:.1%}) · "
                  f"{doc['inWardCount']:,} of {len(doc['inWard']):,} buildings touch it")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    if ap.parse_args().check:
        return check()
    for ward in _types.WARDS.values():
        if not _wardmask.has_polygon(ward.id):
            continue
        doc = build(ward)
        with open(out_path(ward.id), "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
        print(f"  {os.path.relpath(out_path(ward.id), ROOT)}  "
              f"{os.path.getsize(out_path(ward.id)) / 1024:.1f} KB")
    return check()


if __name__ == "__main__":
    sys.exit(main())
