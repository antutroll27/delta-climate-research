"""Export a city after Bengaluru to the browser contracts (Task A10).

    python3 scripts/export-city-obos.py --city amsterdam            # write public/heat-map/data/<area>*.json
    python3 scripts/export-city-obos.py --city amsterdam --check    # re-export in memory; fail unless byte-identical

Modelled on `export-bangalore-obos.py` and reading the `_city` contracts. The browser fetches
six artefacts per area: `{id}.json`, `-roads.json`, `-water.json`, `-trees.json`,
`-terrain.json` and `-surface.png` (the PNG is written by `export-surface-rasters.py`, not here).

THE FRAME. `b` rows are [h, x, z, x, z, ...] with z = the local y, i.e. NORTH, exactly as
Bengaluru's (`rasterizeWardBuilt` reads the odd entries as the northward metres `to_local`
produces). Terrain is stored row 0 = SOUTH and exported row 0 = NORTH, because `terrain.ts`
reads row 0 = NORTH: ONE flip, here, and guard G8 (check-city-frame.py) pins it.

`--check` is the determinism gate: every document is built in memory, serialised exactly as it
is written, and compared byte for byte with the file on disk. Nothing here reads the clock.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Final, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city                                             # noqa: E402
import _src_overture as ovt                              # noqa: E402
import _trees                                            # noqa: E402
from _city import Area, CityBuildingsFile, CityCanopyFile, CityContextFile, CityTerrainFile   # noqa: E402
from _types import TreeInstanceJSON                      # noqa: E402

#: The browser's `w` values: KEYS INTO `ROAD_WIDTH_M`, not measurements (see export-bangalore-obos.py).
W_MAJOR: Final = 2
W_MINOR: Final = 1


def load(area: Area, layer: str) -> Any:
    with open(os.path.join(_city.data_dir(area.city), f"{area.id}-{layer}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def buildings_doc(area: Area, src: CityBuildingsFile) -> dict[str, Any]:
    rows: list[list[float]] = []
    for b in src["b"]:
        p = b["p"]
        if len(p) < 6:                       # not a polygon: dropped here, where it can be counted
            continue
        rows.append([round(float(b["h"]), 2), *[round(float(v), 1) for v in p]])
    return {
        "name": area.id,
        "type": "",                          # zone labels live on the registry row; carried empty for shape parity
        "center": [area.centre.lat, area.centre.lon],
        "sizeM": float(area.size_m),
        "count": len(rows),
        "source": src["source"],
        "heightsNote": src["heightNote"],
        "heightTiers": src["heightTiers"],
        "b": rows,
    }


def roads_doc(area: Area, ctx: CityContextFile) -> dict[str, Any]:
    ways = [{"w": W_MAJOR if r["cls"] in ovt.MAJOR_ROAD_CLASSES else W_MINOR, "p": r["line"]}
            for r in ctx["roads"] if r.get("line")]
    return {"ward": area.id, "count": len(ways), "source": ctx["source"], "ways": ways}


def water_doc(area: Area, ctx: CityContextFile) -> dict[str, Any]:
    polys: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    covered = 0
    for x in ctx["water"]:
        if x.get("p"):
            polys.append({"k": x["cls"], "p": x["p"]})
        elif x.get("line"):
            if x.get("covered"):
                covered += 1                 # under a road or slab: invisible from above, counted not drawn
                continue
            lines.append({"k": x["cls"], "p": x["line"]})
    return {"ward": area.id, "count": len(polys), "source": ctx["source"], "fieldM": float(area.size_m),
            "polys": polys, "lines": lines, "coveredDropped": covered}


def trees_doc(area: Area, canopy: CityCanopyFile, retrieved: str) -> dict[str, Any]:
    trees: list[TreeInstanceJSON] = canopy["trees"]
    return {
        "ward": area.id, "grid": canopy["grid"], "sizeM": float(area.size_m), "retrieved": retrieved,
        "source": canopy["source"], "densityRefM": canopy["densityRefM"],
        "cols": list(_trees.COLS), "speciesNames": list(_trees.SPECIES_NAMES),
        "trees": _trees.encode_trees(trees),
    }


def terrain_doc(area: Area, src: CityTerrainFile) -> dict[str, Any]:
    """Row 0 NORTH, metres relative to `meanM`, exaggeration 1.0. Render-only: no simulation layer reads it."""
    n = int(src["n"])
    datum = float(src["meanM"])
    rows = [src["h"][r * n:(r + 1) * n] for r in range(n)]
    rel = [round(float(v) - datum, 2) for row in reversed(rows) for v in row]
    ordered = sorted(rel)
    span = round(ordered[int(0.95 * (len(ordered) - 1))] - ordered[int(0.05 * (len(ordered) - 1))], 1)
    return {
        "ward": area.id, "source": src["source"], "n": n, "sizeM": float(src["sizeM"]),
        "datumM": datum, "exaggeration": 1.0, "rawSpanM": span, "smoothSpanM": span,
        "confidence": "indicative",
        "note": ("AHN4 DTM 0.5 m (Het Waterschapshuis, CC0) area-averaged onto the solver mesh; metres relative to datumM "
                 "(the mesh mean), rows north-first; no data under buildings or water is filled from the nearest valid "
                 "neighbour; not smoothed, so smoothSpanM equals rawSpanM; NOT used by the simulation"),
        "h": rel,
    }


def documents(area: Area) -> dict[str, dict[str, Any]]:
    """Every JSON artefact of the area, by file name, built in memory."""
    b = cast(CityBuildingsFile, load(area, "buildings"))
    ctx = cast(CityContextFile, load(area, "context"))
    canopy = cast(CityCanopyFile, load(area, "canopy"))
    terrain = cast(CityTerrainFile, load(area, "terrain"))
    return {
        f"{area.id}.json": buildings_doc(area, b),
        f"{area.id}-roads.json": roads_doc(area, ctx),
        f"{area.id}-water.json": water_doc(area, ctx),
        f"{area.id}-trees.json": trees_doc(area, canopy, b["retrieved"]),
        f"{area.id}-terrain.json": terrain_doc(area, terrain),
    }


def serialise(doc: dict[str, Any]) -> str:
    return json.dumps(doc, separators=(",", ":"))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", required=True, choices=["amsterdam"])
    ap.add_argument("--check", action="store_true", help="re-export in memory and require byte equality with the files on disk")
    args = ap.parse_args(argv)
    bad: list[str] = []
    for area in (a for a in _city.AREAS.values() if a.city == args.city):
        docs = documents(area)
        for name, doc in docs.items():
            text = serialise(doc)
            path = os.path.join(_city.PUBLIC, name)
            if args.check:
                if not os.path.isfile(path):
                    bad.append(f"{name}: not exported")
                else:
                    with open(path, encoding="utf-8") as fh:
                        if fh.read() != text:
                            bad.append(f"{name}: differs from a fresh export")
            else:
                os.makedirs(_city.PUBLIC, exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
                print(f"  {name:<28} {len(text) / 1e3:9.1f} kB")
        c = docs[f"{area.id}.json"]["count"], docs[f"{area.id}-roads.json"]["count"], docs[f"{area.id}-water.json"]["count"], len(docs[f"{area.id}-trees.json"]["trees"])
        print(f"  {area.id}: {c[0]:,} buildings · {c[1]:,} ways · {c[2]} water polys · {c[3]:,} trees · "
              f"ground span {docs[f'{area.id}-terrain.json']['rawSpanM']} m")
    if bad:
        print("\n".join(f"  FAIL {m}" for m in bad))
        return 1
    if args.check:
        print("  export is byte-identical to a fresh run")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
