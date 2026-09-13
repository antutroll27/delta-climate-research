#!/usr/bin/env python3
"""data/bangalore/* -> the shapes public/heat-map/data/ serves.

THE RINGS SHIP EVEN THOUGH THEY ARE NOT DRAWN. A Bengaluru ward is RENDERED from
a glTF, so the obvious economy is to stop shipping 62,847 footprint vertices that
no mesh reads. Do not. `rasterizeWardBuilt` (ward-raster.ts) stamps every one of
these rings into the `built` grid the heat model solves on -- `Q * built` is the
anthropogenic term and, measured, the dominant source of within-ward pattern --
and `building-pick.ts` projects their centroids to hit-test a click. Drawn and
solved are different jobs done from the same measurement.

WHAT THIS DOES NOT DO. It does not measure anything. Every number written here
was measured by fetch-bangalore.py and fetch-canopy.py; this is a reshape from
the pipeline's own file contracts (`_bangalore.BlrBuildingsFile` and friends)
into the contracts the browser fetches (`WardData`, `RoadsData`, `WaterData`,
`TreesFile`). Where the two disagree the difference is stated below, never
papered over with a plausible default.

    python3 scripts/export-bangalore-obos.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402  (path set above)
import _trees  # noqa: E402

OUT = os.path.join(blr.ROOT, "public", "heat-map", "data")

#: Overture road classes that take the MAJOR width in the browser's `w` field.
#:
#: `w` IS NOT A WIDTH IN METRES, AND IT IS NOT COSMETIC. Two consumers read it:
#: `roadHalfWidthM` (road-ribbon.ts) maps 2 -> 14 m and everything else -> 4 m
#: for the drawn ribbon, and -- the one that matters -- `buildSpatial`
#: (heat-map-model.ts) does `rad = way.w > 1 ? 2 : 1`, which at 7.29 m per cell
#: is a 36.5 m or 21.9 m TREE-PLANTING CORRIDOR feeding `corridorSorted` and
#: from there the published COOLING and the delivered `treeCorridorCells`.
#: NOT the rupee cost: `computeCost` reads `corridorKm`, which sums segment
#: length regardless of `w`. Saying "cost" here overstates the blast radius,
#: and the claim was inherited from road-ribbon.ts's own comment.
#:
#: So a blanket `w = 2` -- which is what the first draft of this exporter did --
#: would not merely draw fat roads. It would declare every service alley behind
#: a shop a 36.5 m planting corridor and inflate the tree count and the rupee
#: cost of every Bengaluru intervention. Kolkata's own share is 9.0 % at
#: Ballygunge but 7.1 % at Barrackpore and 2.5 % at Baruipur, so the honest
#: comparison is a 2.5-9.0 % RANGE, not the one flattering ward. Bengaluru
#: lands at 9.2 / 13.7 / 3.7 %; mg-road sits above every Kolkata ward, which is
#: what a CBD should do. Kolkata ships 45 of 500 ways (9 %) at
#: the major width; this list puts Indiranagar at 9.2 %, MG Road at 13.7 % and
#: Whitefield at 3.7 %, which is the same shape of city.
#:
#: WHY THESE TWO CLASSES. The 14 m figure is derived in road-ribbon.ts from an
#: Overpass survey of Kolkata: OSM carries no carriageway width there at all, and
#: the only real evidence was `lanes` on PRIMARY ways (22 x 4 lanes, 2 x 8), so
#: 4 lanes x 3.25 m ~ 14 m. `secondary` joins it because the two are one class in
#: that evidence -- an arterial either way -- and everything below is the
#: `assumed` 4 m. Anything not listed falls to the minor width, which is the safe
#: error: an unclassified road is far likelier to be a gully than an arterial.
MAJOR_ROAD_CLASSES = frozenset({"primary", "secondary"})

#: The browser's `w` values, named rather than written as bare 1s and 2s. They
#: are KEYS INTO `ROAD_WIDTH_M`, not measurements -- see the note above.
W_MAJOR = 2
W_MINOR = 1


def ward_size_m(w: blr.Ward) -> int:
    """The ward's footprint as the browser's contracts want it: a whole metre.

    THE TWO WARD TABLES ARE DIFFERENT NAMEDTUPLES WITH DIFFERENT TYPES, and this
    is the same conversion `surface_wards()` in export-surface-rasters.py makes,
    for the same reason. `_bangalore.Ward` carries `size_m: float` (2800.0);
    `_types.Ward` carries `footprint_m: int`; the shipped Kolkata ward files
    carry `"sizeM": 1400`, an int.

    It matters on the TypeScript side. `gridFor` looks the admitted pair up by
    `g.sizeM === sizeM`, and every layer stride downstream comes from that
    lookup. 2800.0 happens to satisfy `=== 2800` in JavaScript, so this is
    belt-and-braces there -- but the conversion has to happen somewhere, and it
    happens HERE, once, after asserting wholeness, rather than as a bare `int()`
    at each call site where a truncation would silently ship a 2799 m ward.
    """
    if w.size_m != int(w.size_m):
        raise ValueError(
            f"{w.id}: ward size {w.size_m} m is not a whole number of metres. The browser's "
            f"admitted (grid, ward size) pairs are integers, so this cannot be truncated "
            f"into one -- add the pair to ADMITTED_GRIDS in types.ts instead.")
    return int(w.size_m)


def export_buildings(w: blr.Ward) -> int:
    """`{ward}.json` -- the footprints the solver rasterises and picking hit-tests.

    The browser's `b` row is [height, x, z, x, z, ...] and our `p` is
    [x, y, x, y, ...] with +y NORTH. OBOS's z IS that y: `rasterizeWardBuilt`
    reads the odd entries as the same northward metres `to_local` produces, and
    `check-bangalore-frame.py` has already settled that the local frame is not
    mirrored, numerically, against two landmarks whose coordinates are published.
    """
    with open(os.path.join(blr.DATA, f"{w.id}-buildings.json"), encoding="utf-8") as fh:
        src = cast(blr.BlrBuildingsFile, json.load(fh))

    rows: list[list[float]] = []
    for b in src["b"]:
        p = b["p"]
        # Fewer than three vertices is not a polygon. `stampRing` would sample a
        # degenerate shape rather than refuse it, so the drop happens here where
        # it can be counted. Measured: zero such rings in all three wards today.
        if len(p) < 6:
            continue
        rows.append([round(float(b["h"]), 2), *[round(float(v), 1) for v in p]])

    doc: dict[str, Any] = {
        "name": w.id,
        # The ward's zone label ('Dense Low-Rise', 'Mixed Downtown', 'Sparse
        # High-Rise') lives on the registry row in src/data/cities.ts and is
        # rendered from there. Nothing reads this key -- build-ward-geometry.py
        # copies Kolkata's forward and no page displays it -- so it is carried
        # empty for shape parity rather than duplicated into a second source
        # that could then disagree with the one on screen.
        "type": "",
        "center": [w.centre.lat, w.centre.lon],
        "sizeM": ward_size_m(w),
        "count": len(rows),
        "source": src["source"],
        "heightsNote": src["heightNote"],
        # Which evidence each height came from, counted. Kolkata's ward files
        # predate this and carry only the prose note; it is kept because it is
        # the difference between "heights are modelled" and "1,170 of these are
        # OSM storey counts and 1,094 are Google's 2.5 m no-confidence fill".
        "heightTiers": src.get("heightTiers", {}),
        "b": rows,
    }
    with open(os.path.join(OUT, f"{w.id}.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return len(rows)


def export_context(w: blr.Ward) -> tuple[int, int, int]:
    """`{ward}-roads.json` and `{ward}-water.json`, in the RoadsData / WaterData shapes.

    Returns (ways, polygons, water features dropped as centrelines).
    """
    with open(os.path.join(blr.DATA, f"{w.id}-context.json"), encoding="utf-8") as fh:
        ctx = cast(dict[str, Any], json.load(fh))

    ways: list[dict[str, Any]] = []
    for r in ctx.get("roads", []):
        line = r.get("line")
        if not line:
            continue
        ways.append({
            "w": W_MAJOR if str(r.get("cls", "")) in MAJOR_ROAD_CLASSES else W_MINOR,
            "p": line,
        })
    roads: dict[str, Any] = {
        "ward": w.id, "count": len(ways),
        "source": ctx["source"],
        "ways": ways,
    }
    with open(os.path.join(OUT, f"{w.id}-roads.json"), "w", encoding="utf-8") as fh:
        json.dump(roads, fh, separators=(",", ":"))

    # WATER CENTRELINES ARE DROPPED, AND THAT IS A LOSS WORTH NAMING. Overture
    # gives a canal or a stream as a LINE, not a ring, and `WaterData.polys` has
    # nowhere to put one: `rasterizeWardWater` stamps rings, and the render
    # layer fills polygons. Buffering a centreline into a ring here would invent
    # a width nobody measured. Measured cost: 26 of Indiranagar's 39 water
    # features, 37 of MG Road's 90, 29 of Whitefield's 92 -- mostly the storm
    # canals. They are in data/bangalore/<ward>-context.json for whoever gives
    # `WaterData` a line contract; they are not silently gone.
    polys: list[dict[str, Any]] = []
    dropped = 0
    for x in ctx.get("water", []):
        if not x.get("p"):
            dropped += 1
            continue
        polys.append({"k": str(x.get("cls", "water")), "p": x["p"]})
    water: dict[str, Any] = {
        "ward": w.id, "count": len(polys),
        "source": ctx["source"],
        "polys": polys,
    }
    with open(os.path.join(OUT, f"{w.id}-water.json"), "w", encoding="utf-8") as fh:
        json.dump(water, fh, separators=(",", ":"))
    return (len(ways), len(polys), dropped)


def export_trees(w: blr.Ward) -> int:
    """`{ward}-trees.json` -- the rendered canopy, which is NOT in the solve.

    `CANOPY_BLEND_STRENGTH` is 0, measured: blending canopy into `veg`
    monotonically degraded agreement with ECOSTRESS. These instances drive the
    tree layer and nothing else.
    """
    with open(os.path.join(blr.DATA, f"{w.id}-canopy.json"), encoding="utf-8") as fh:
        cn = cast(dict[str, Any], json.load(fh))

    doc: dict[str, Any] = {
        "ward": w.id,
        "grid": cn["grid"],
        "sizeM": ward_size_m(w),
        "retrieved": "2026-09-11",
        "source": cn["source"],
        "densityRefM": cn["densityRefM"],
        "cols": list(_trees.COLS),
        "speciesNames": list(_trees.SPECIES_NAMES),
        "trees": _trees.encode_trees(cn["trees"]),
    }
    with open(os.path.join(OUT, f"{w.id}-trees.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return len(doc["trees"])


def export_terrain(w: blr.Ward) -> float:
    """`{ward}-terrain.json` -- the ground the GLB buildings were SEATED on.

    WITHOUT IT THE TREES FLOAT. blender_bangalore.py seats every building base at
    `(sample_ground - meanM) * TERRAIN_EXAG - BASE_SINK_M` and bakes that into the
    GLB, but the browser had no Bengaluru terrain, so `terrainDrawAt` read 0 and
    the trees, roads, water and heat ground lay flat beneath buildings standing on
    up to +-35 m of real relief. Measured 2026-09-13: 61-67 % of trees sat more
    than 5 m off the ground their neighbouring buildings stand on.

    THREE CONVERSIONS, each a way to get this wrong:
    - ROWS FLIPPED. fetch-bangalore.py stores row 0 as the SOUTH edge; terrain.ts
      reads row 0 as the NORTH edge. Unflipped, the ground is mirrored against the
      buildings by up to 50 m (measured). bangalore-terrain-frame.test.mjs pins it.
    - RELATIVE TO meanM, the datum blender_bangalore.py used -- not the median.
    - EXAGGERATION 1, carried in the file. The browser's default is x4, chosen for
      Kolkata's 5-8 m delta; the GLB was baked at x1, so x4 would reopen the gap.

    Render-only, as terrain.ts insists: no simulation layer reads it. Returns the
    p5-p95 relief span in metres, for the progress line.
    """
    with open(os.path.join(blr.DATA, f"{w.id}-terrain.json"), encoding="utf-8") as fh:
        src = cast(dict[str, Any], json.load(fh))
    n = int(src["n"])
    datum = float(src["meanM"])
    h = [float(v) for v in src["h"]]
    rows = [h[r * n:(r + 1) * n] for r in range(n)]
    rel = [round(v - datum, 2) for row in reversed(rows) for v in row]
    ordered = sorted(rel)
    span = round(ordered[int(0.95 * (len(ordered) - 1))] - ordered[int(0.05 * (len(ordered) - 1))], 1)
    doc: dict[str, Any] = {
        "ward": w.id,
        "source": src["source"],
        "n": n,
        "sizeM": float(src["sizeM"]),
        "datumM": datum,
        "exaggeration": 1.0,
        "rawSpanM": span,
        "smoothSpanM": span,
        "confidence": "indicative",
        "note": ("GLO-30 resampled bilinear to the mesh blender_bangalore.py seated the GLB "
                 "buildings on; metres relative to datumM (the mesh mean), rows north-first; "
                 "not smoothed, so smoothSpanM equals rawSpanM; NOT used by the simulation"),
        "h": rel,
    }
    with open(os.path.join(OUT, f"{w.id}-terrain.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return span


def main() -> int:
    # Refuse BEFORE writing anything. Checked per ward inside export_trees, a
    # missing species left that ward's buildings, roads and water rewritten and
    # its trees not -- a half export that exits 1 but is already on disk.
    for w in blr.WARDS.values():
        with open(os.path.join(blr.DATA, f"{w.id}-canopy.json"), encoding="utf-8") as fh:
            if any("species" not in t for t in json.load(fh)["trees"]):
                raise SystemExit(f"{w.id}: canopy file has trees with no species -- run "
                                 "python3 scripts/fetch-bangalore.py --layer species first")
    os.makedirs(OUT, exist_ok=True)
    for w in blr.WARDS.values():
        buildings = export_buildings(w)
        ways, polys, dropped = export_context(w)
        trees = export_trees(w)
        span = export_terrain(w)
        print(f"  {w.id:<12} {buildings:6,} buildings · {ways:5,} ways · "
              f"{polys:3,} water polys ({dropped} centrelines dropped) · {trees:6,} trees · "
              f"ground {span:.1f} m")
    print(f"  written to {os.path.relpath(OUT, blr.ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
