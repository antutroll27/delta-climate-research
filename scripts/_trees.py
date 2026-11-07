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
from typing import Final, Literal, cast, get_args

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402

#: Column order of every row. Written into each file so the file describes itself.
COLS: tuple[str, ...] = ("x_m", "y_m", "h_dm", "r_dm", "species")

#: Every species name a tree file may carry. Must match the browser's `Species` union
#: (vegetation-layer.ts) -- asTreesFile rejects any other name. APPEND ONLY: a file's rows
#: index into its OWN `speciesNames`, but a reorder here would silently relabel every stored
#: index the day a header were rebuilt from this list.
Species = Literal["neem", "gulmohar", "palm", "broadleaf"]
ALL_SPECIES_NAMES: Final[tuple[str, ...]] = get_args(Species)

#: Index -> name for the species column of the KOLKATA-FAMILY files (Kolkata, Bengaluru).
#: DISTINCT names, not fetch-canopy.py's weighted draw tuple ("neem", "neem", "gulmohar",
#: "palm"). This is deliberately NOT the whole vocabulary: fetch-canopy.py (frozen) and
#: export-bangalore-obos.py write `list(SPECIES_NAMES)` as their header, and appending
#: "broadleaf" here would change what a re-run of either writes. A city with another draw
#: writes its own header (`names_for`), and every decoder accepts any subset of
#: ALL_SPECIES_NAMES.
SPECIES_NAMES: tuple[str, ...] = ("neem", "gulmohar", "palm")


def names_for(draw: tuple[str, ...]) -> tuple[str, ...]:
    """A file's own `speciesNames`: the distinct names of a species draw, in vocabulary order."""
    unknown = [n for n in draw if n not in ALL_SPECIES_NAMES]
    if unknown:
        raise ValueError(f"unknown species {unknown}; expected a subset of {ALL_SPECIES_NAMES}")
    return tuple(n for n in ALL_SPECIES_NAMES if n in draw)

Row = list[int]


#: HALF-TO-EVEN, DELIBERATELY. Python's round() sends exact .5 ties to the even
#: neighbour, which is unbiased: measured over the 86,569 shipped trees, the mean
#: signed error on the crown radius is +0.00012 m, against +0.00499 m for
#: half-up -- 42x the bias, all of it one-directional. fetch-canopy.py's
#: int(v + 0.5) does not transfer: it exists to MATCH JavaScript's Math.round for
#: a value both languages compute, and nothing here is rounded in the browser.
#: int(v + 0.5) is also wrong for any negative coordinate -- int() truncates
#: toward zero, so -915.72 becomes -915, not -916 (mean +0.57 m, max 1.49 m on
#: the shipped x positions). The tie fixture in _self_test pins this choice.
def encode_trees(trees: list[_types.TreeInstanceJSON],
                 names: tuple[str, ...] = SPECIES_NAMES) -> list[Row]:
    """Objects -> rows. Rounds position to 1 m and height/radius to 0.1 m.

    `names` is the header the file will carry; the species column indexes into IT. The default
    is the Kolkata-family header, so every existing caller writes exactly what it always did.
    """
    index = {name: i for i, name in enumerate(names)}
    rows: list[Row] = []
    for t in trees:
        if t["species"] not in index:
            raise ValueError(f"unknown species {t['species']!r}; expected one of {names}")
        rows.append([round(t["x"]), round(t["y"]), round(t["h"] * 10),
                     round(t["r"] * 10), index[t["species"]]])
    return rows


def decode_trees(cols: list[str], names: list[str],
                 rows: list[Row]) -> list[_types.TreeInstanceJSON]:
    """Rows -> objects. Refuses a file whose header does not match this codec."""
    if tuple(cols) != COLS:
        raise ValueError(f"tree columns {cols} are not {list(COLS)}")
    # ANY SUBSET of the vocabulary, not one fixed list: each file names the species it uses, and
    # its rows index into that header. Kolkata's stored three-name header is still accepted.
    if not names or len(set(names)) != len(names) or any(n not in ALL_SPECIES_NAMES for n in names):
        raise ValueError(f"speciesNames {names} are not distinct names from {list(ALL_SPECIES_NAMES)}")
    out: list[_types.TreeInstanceJSON] = []
    for row in rows:
        if len(row) != len(COLS):
            raise ValueError(f"tree row {row} has {len(row)} fields, expected {len(COLS)}")
        x, y, h_dm, r_dm, s = row
        # `row` is typed list[int], but json.load can hand over a bool or a float.
        # bool is an int subclass, so `0 <= True < 3` passes and a corrupted file
        # would silently draw the wrong species -- hence `type(s) is int`, not
        # isinstance, which accepts True.
        if type(s) is not int or not 0 <= s < len(names):
            raise ValueError(f"tree row {row}: species index must be an int from 0 to "
                             f"{len(names) - 1}, got {s!r}")
        out.append({"x": float(x), "y": float(y), "h": h_dm / 10,
                    "species": names[s], "r": r_dm / 10})
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
    # EXACT TIES, which the fixture above never hits. round() sends each to the even
    # neighbour: 2.5 -> 2, -3.5 -> -4, 12.5 -> 12. Half-up gives [3, -3, 50, 13, 1]
    # and int(v + 0.5) gives the same, so either "fix" fails here.
    tie: list[_types.TreeInstanceJSON] = [
        {"x": 2.5, "y": -3.5, "h": 5.0, "species": "gulmohar", "r": 1.25},
    ]
    assert encode_trees(tie) == [[2, -4, 50, 12, 1]], encode_trees(tie)
    for bad_cols in (["x_m", "y_m", "h_dm", "r_dm"], ["y_m", "x_m", "h_dm", "r_dm", "species"]):
        try:
            decode_trees(bad_cols, list(SPECIES_NAMES), rows)
        except ValueError:
            pass
        else:
            raise AssertionError(f"columns {bad_cols} must be refused")
    for bad in ([[1, 2, 3, 4]], [[1, 2, 3, 4, 3]], [[1, 2, 3, 4, True]],
                cast("list[Row]", [[1, 2, 3, 4, 1.0]])):
        try:
            decode_trees(list(COLS), list(SPECIES_NAMES), bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"row {bad} must be refused")
    # A city with its own draw writes its own header, and the rows index into it.
    assert ALL_SPECIES_NAMES[:len(SPECIES_NAMES)] == SPECIES_NAMES and ALL_SPECIES_NAMES[-1] == "broadleaf", \
        "broadleaf is APPENDED: the Kolkata-family indices 0..2 must not move"
    assert names_for(("broadleaf",)) == ("broadleaf",)
    assert names_for(("neem", "neem", "gulmohar", "palm")) == SPECIES_NAMES
    bl: list[_types.TreeInstanceJSON] = [{"x": 1.0, "y": 2.0, "h": 8.0, "species": "broadleaf", "r": 2.8}]
    brows = encode_trees(bl, names_for(("broadleaf",)))
    assert brows == [[1, 2, 80, 28, 0]], brows
    assert decode_trees(list(COLS), ["broadleaf"], brows)[0]["species"] == "broadleaf"
    assert decode_trees(list(COLS), list(SPECIES_NAMES), rows)[1]["species"] == "palm", "Kolkata's stored header still decodes"
    for bad_names in ([], ["oak"], ["neem", "neem"], ["neem", "broadleaf", "oak"]):
        try:
            decode_trees(list(COLS), bad_names, [])
        except ValueError:
            pass
        else:
            raise AssertionError(f"header {bad_names} must be refused")
    try:
        decode_trees(list(COLS), ["broadleaf"], [[1, 2, 3, 4, 1]])
    except ValueError:
        pass
    else:
        raise AssertionError("an index past the FILE's own header must be refused, even if the vocabulary has more")
    try:
        encode_trees(bl)
    except ValueError:
        pass
    else:
        raise AssertionError("a broadleaf tree cannot be written under the Kolkata-family header")
    try:
        encode_trees([{"x": 0.0, "y": 0.0, "h": 5.0, "species": "oak", "r": 1.0}])
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown species must be refused on encode")
    print("  _trees self-test OK")


if __name__ == "__main__":
    _self_test()
