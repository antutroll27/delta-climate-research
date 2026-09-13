#!/usr/bin/env python3
"""
The tree file's on-disk row format, in one place.

WHY THIS FILE EXISTS. `{ward}-trees.json` is written by two pipelines --
fetch-canopy.py (Kolkata) and export-bangalore-obos.py (Bengaluru) -- and read
back by fetch-canopy.py --check. The rows are the contract with the browser's
asTreesFile (src/scripts/climate-engine/vegetation-layer.ts), so encoding and
decoding live here once rather than three times.

THE FORMAT. Each tree is [x_m, y_m, h_dm, r_dm, species]: position in whole
metres, height and crown radius in whole decimetres, species an index into
`speciesNames`. Measured against the object form it replaced: 715 -> 424 KB
brotli across the six wards, species kept.

WHY WHOLE METRES ARE SAFE HERE AND NOT FOR BUILDINGS. Tree positions are a
deterministic jitter inside a 10 m cell, drawn for display, never rasterised
into the solver and never picked. Building rings ARE rasterised: rounding them
to 1 m moved 6.34 % of Ballygunge's solver cells by up to 0.75 of a cell's
built fraction. Do not reuse this precision for buildings.

In memory every caller still works with TreeInstanceJSON objects. Only disk
changes.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

#: Column order of every row. Written into each file so the file describes itself.
COLS: tuple[str, ...] = ("x_m", "y_m", "h_dm", "r_dm", "species")

#: Index -> name for the species column. DISTINCT names, not fetch-canopy.py's
#: weighted draw tuple ("neem", "neem", "gulmohar", "palm"). Must match the
#: browser's `Species` union exactly -- asTreesFile rejects any other name.
SPECIES_NAMES: tuple[str, ...] = ("neem", "gulmohar", "palm")

Row = list[int]


def encode_trees(trees: list[_types.TreeInstanceJSON]) -> list[Row]:
    """Objects -> rows. Rounds position to 1 m and height/radius to 0.1 m."""
    index = {name: i for i, name in enumerate(SPECIES_NAMES)}
    rows: list[Row] = []
    for t in trees:
        if t["species"] not in index:
            raise ValueError(f"unknown species {t['species']!r}; expected one of {SPECIES_NAMES}")
        rows.append([round(t["x"]), round(t["y"]), round(t["h"] * 10),
                     round(t["r"] * 10), index[t["species"]]])
    return rows


def decode_trees(cols: list[str], names: list[str],
                 rows: list[Row]) -> list[_types.TreeInstanceJSON]:
    """Rows -> objects. Refuses a file whose header does not match this codec."""
    if tuple(cols) != COLS:
        raise ValueError(f"tree columns {cols} are not {list(COLS)}")
    if tuple(names) != SPECIES_NAMES:
        raise ValueError(f"speciesNames {names} are not {list(SPECIES_NAMES)}")
    out: list[_types.TreeInstanceJSON] = []
    for row in rows:
        if len(row) != len(COLS):
            raise ValueError(f"tree row {row} has {len(row)} fields, expected {len(COLS)}")
        x, y, h_dm, r_dm, s = row
        if not 0 <= s < len(SPECIES_NAMES):
            raise ValueError(f"tree row {row} has species index {s} out of range")
        out.append({"x": float(x), "y": float(y), "h": h_dm / 10,
                    "species": SPECIES_NAMES[s], "r": r_dm / 10})
    return out


def _self_test() -> None:
    trees: list[_types.TreeInstanceJSON] = [
        {"x": -915.72, "y": 1394.82, "h": 4.3, "species": "neem", "r": 1.52},
        {"x": 12.49, "y": -0.51, "h": 30.0, "species": "palm", "r": 11.9},
    ]
    rows = encode_trees(trees)
    assert rows == [[-916, 1395, 43, 15, 0], [12, -1, 300, 119, 2]], rows
    back = decode_trees(list(COLS), list(SPECIES_NAMES), rows)
    assert [t["species"] for t in back] == ["neem", "palm"]
    assert back[0]["h"] == 4.3 and back[0]["x"] == -916.0 and back[1]["r"] == 11.9
    assert encode_trees(back) == rows, "decode then encode must be stable"
    for bad_cols in (["x_m", "y_m", "h_dm", "r_dm"], ["y_m", "x_m", "h_dm", "r_dm", "species"]):
        try:
            decode_trees(bad_cols, list(SPECIES_NAMES), rows)
        except ValueError:
            pass
        else:
            raise AssertionError(f"columns {bad_cols} must be refused")
    for bad in ([[1, 2, 3, 4]], [[1, 2, 3, 4, 3]]):
        try:
            decode_trees(list(COLS), list(SPECIES_NAMES), bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"row {bad} must be refused")
    try:
        encode_trees([{"x": 0.0, "y": 0.0, "h": 5.0, "species": "oak", "r": 1.0}])
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown species must be refused on encode")
    print("  _trees self-test OK")


if __name__ == "__main__":
    _self_test()
