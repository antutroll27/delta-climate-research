"""Name every shipping Amsterdam area after a neighbourhood (wijk): writes data/cities/amsterdam/area-names.json.

WHY. The area picker repeated the stadsdeel ("Nieuw-West" seven times). A reader choosing where to go needs a name that
tells two areas apart, so each area is named after the wijk that covers most of the area's MUNICIPAL part (the area's box
intersected with the union of the nine stadsdelen). If a second wijk covers more than 35 % of that part the name is
"A / B". E4 stays "Canal Ring" (it is the hand-named anchor, and its name is the product's).

SOURCE. Gemeente Amsterdam, Kernregistratie gebieden, wijken (https://api.data.amsterdam.nl/v1/gebieden/wijken/). The same
registry as the stadsdelen the sheet table already uses: CC0 1.0 on the catalogue record, and the Maps Data terms allow
commercial reuse with no attribution duty (docs/evidence/2026-11-07-amsterdam-stadsdelen-licence.md; the wijken entry is in
docs/evidence/data-sources.md). Only NAMES and overlap shares are kept; no geometry is redistributed.

    python3 scripts/build-area-names.py                       # fetch (once) and write the file for the committed table
    python3 scripts/build-area-names.py --table PATH          # name the shipping sheets of another sheets.json
    python3 scripts/build-area-names.py --check               # the committed file covers every shipping sheet, with names

Downloads go to /Volumes/OBOSLab/raw/amsterdam-names/ (never ~ or /tmp), with the generic user-agent.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from dataclasses import dataclass
from typing import Final, NewType, TypedDict, cast

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402
import _sheets  # noqa: E402

WijkName = NewType("WijkName", str)

RAW_DIR: Final = "/Volumes/OBOSLab/raw/amsterdam-names"
WIJKEN_FILE: Final = "wijken.json"
WIJKEN_URL: Final = "https://api.data.amsterdam.nl/v1/gebieden/wijken/?_format=json&_pageSize=200"
STADSDELEN_FILE: Final = "stadsdelen.json"
OUT_REL: Final = os.path.join("data", "cities", "amsterdam", "area-names.json")
#: A second wijk makes the name "A / B" when it covers MORE than this share of the area's municipal part.
SECOND_WIJK_SHARE: Final = 0.35
#: How many wijken an entry records, for the reader who wants to see why a name was chosen.
KEEP_WIJKEN: Final = 3
SOURCE_WIJK: Final = "Gemeente Amsterdam, Kernregistratie gebieden, wijken (CC0 1.0)"
SOURCE_ANCHOR: Final = "hand-named anchor: Canal Ring"
CREDIT: Final = "Gemeente Amsterdam, Kernregistratie gebieden (CC0 1.0): wijk names"
#: Two areas must never share a name, so a name two areas would share gets a compass qualifier: "Waterland (west)".
QUALIFIERS: Final = {2: ("{lo}", "{hi}"), 3: ("{lo}", "centre", "{hi}")}
RULE: Final = (
    "name = the wijk with the largest overlap inside the area's municipal part (the area's box intersected with the union "
    f"of the nine stadsdelen); if the second wijk covers more than {SECOND_WIJK_SHARE:.0%} of that part, 'A / B'; E4 stays 'Canal Ring'; "
    "a name two areas would share gets a compass qualifier, '(west)' / '(east)' or '(north)' / '(south)', so every name is unique"
)


@dataclass(frozen=True, slots=True)
class WijkShare:
    """One wijk's share of an area's municipal part."""
    name: WijkName
    share: float


class WijkShareJson(TypedDict):
    name: str
    share: float


class AreaNameJson(TypedDict):
    name: str
    stadsdeel: str
    source: str
    wijken: list[WijkShareJson]


class AreaNamesFile(TypedDict):
    city: str
    credit: str
    rule: str
    retrieved: str
    areas: dict[str, AreaNameJson]


# ── pure rules (the unit-testable part) ────────────────────────────────────

def name_from_shares(shares: list[WijkShare]) -> str:
    """The area's name from its wijk shares, largest first. 'A / B' when the second covers more than SECOND_WIJK_SHARE."""
    if not shares:
        raise ValueError("an area with no wijk overlap cannot be named")
    ranked = sorted(shares, key=lambda s: (-s.share, s.name))
    first = ranked[0]
    if len(ranked) > 1 and ranked[1].share > SECOND_WIJK_SHARE:
        return f"{first.name} / {ranked[1].name}"
    return str(first.name)


def area_name(code: str, shares: list[WijkShare]) -> str:
    return _sheets.ANCHOR_NAME if code == _sheets.ANCHOR_CODE else name_from_shares(shares)


def disambiguate(names: dict[str, str], cells: dict[str, tuple[int, int]]) -> dict[str, str]:
    """Give every name that two or more areas share a compass qualifier along the axis they are spread on (west/east when
    the spread is wider than tall, else north/south; i grows east, j grows north). Raises when it cannot tell them apart."""
    by_name: dict[str, list[str]] = {}
    for code, name in names.items():
        by_name.setdefault(name, []).append(code)
    out = dict(names)
    for name, codes in by_name.items():
        if len(codes) < 2:
            continue
        if len(codes) not in QUALIFIERS:
            raise ValueError(f"{len(codes)} areas share the name {name!r}: add a rule for it")
        spread_i = max(cells[c][0] for c in codes) - min(cells[c][0] for c in codes)
        spread_j = max(cells[c][1] for c in codes) - min(cells[c][1] for c in codes)
        axis = 0 if spread_i >= spread_j else 1
        lo, hi = ("west", "east") if axis == 0 else ("south", "north")
        ranked = sorted(codes, key=lambda c: cells[c][axis])
        coords = [cells[c][axis] for c in ranked]
        if len(set(coords)) != len(coords):
            raise ValueError(f"the areas sharing {name!r} cannot be told apart along one axis: {ranked}")
        for code, q in zip(ranked, QUALIFIERS[len(codes)], strict=True):
            out[code] = f"{name} ({q.format(lo=lo, hi=hi)})"
    return out


# ── inputs ─────────────────────────────────────────────────────────────────

def fetch_if_absent(url: str, dest: str) -> None:
    if os.path.exists(dest):
        return
    _sheets._get(url, None, dest)


def read_wijken(path: str) -> dict[WijkName, BaseGeometry]:
    """The current wijken (no end date) by name, in RD. A name must be unique among the current ones."""
    with open(path, encoding="utf-8") as fh:
        doc = cast("dict[str, dict[str, list[dict[str, object]]]]", json.load(fh))
    out: dict[WijkName, BaseGeometry] = {}
    for row in doc["_embedded"]["wijken"]:
        if row["eindGeldigheid"] is not None:
            continue
        name = WijkName(str(row["naam"]))
        if name in out:
            raise SystemExit(f"two current wijken are both called {name!r}: the name would not identify one")
        out[name] = shape(cast("dict[str, object]", row["geometrie"]))
    if not out:
        raise SystemExit(f"no current wijken in {path}")
    return out


def shares_in_area(i: int, j: int, municipality: BaseGeometry, wijken: dict[WijkName, BaseGeometry]) -> tuple[list[WijkShare], float]:
    """Each wijk's share of the area's municipal part, largest first, and the part's share the wijken cover at all."""
    part = _sheets.rd_polygon(i, j).intersection(municipality)
    if part.is_empty or part.area <= 0.0:
        raise SystemExit(f"cell ({i}, {j}) has no municipal part")
    out = [WijkShare(n, g.intersection(part).area / part.area) for n, g in wijken.items()]
    out = sorted((s for s in out if s.share > 0.0), key=lambda s: (-s.share, s.name))
    return out, sum(s.share for s in out)


# ── build and check ────────────────────────────────────────────────────────

def build(table: _sheets.SheetTable, raw_dir: str = RAW_DIR) -> tuple[AreaNamesFile, dict[str, float]]:
    os.makedirs(raw_dir, exist_ok=True)
    fetch_if_absent(WIJKEN_URL, os.path.join(raw_dir, WIJKEN_FILE))
    fetch_if_absent(_sheets.STADSDELEN_URL, os.path.join(raw_dir, STADSDELEN_FILE))
    wijken = read_wijken(os.path.join(raw_dir, WIJKEN_FILE))
    municipality = _sheets.municipality_of(_sheets.read_districts(os.path.join(raw_dir, STADSDELEN_FILE)))
    areas: dict[str, AreaNameJson] = {}
    coverage: dict[str, float] = {}
    shares_of: dict[str, list[WijkShare]] = {}
    for row in table["sheets"]:
        shares_of[row["code"]], coverage[row["code"]] = shares_in_area(row["i"], row["j"], municipality, wijken)
    names = disambiguate(
        {r["code"]: area_name(r["code"], shares_of[r["code"]]) for r in table["sheets"]},
        {r["code"]: (r["i"], r["j"]) for r in table["sheets"]},
    )
    for row in table["sheets"]:
        shares = shares_of[row["code"]]
        areas[row["code"]] = {
            "name": names[row["code"]],
            "stadsdeel": row["stadsdeel"],
            "source": SOURCE_ANCHOR if row["code"] == _sheets.ANCHOR_CODE else SOURCE_WIJK,
            "wijken": [{"name": str(s.name), "share": round(s.share, 3)} for s in shares[:KEEP_WIJKEN]],
        }
    doc: AreaNamesFile = {
        "city": table["city"], "credit": CREDIT, "rule": RULE,
        "retrieved": datetime.date.today().isoformat(), "areas": areas,
    }
    return doc, coverage


def check(doc: AreaNamesFile, table: _sheets.SheetTable) -> list[str]:
    """Problems with a names file against a sheet table: a shipping sheet without a usable name or stadsdeel."""
    bad: list[str] = []
    for row in table["sheets"]:
        entry = doc["areas"].get(row["code"])
        if entry is None:
            bad.append(f"{row['code']}: no name")
            continue
        if not entry["name"].strip():
            bad.append(f"{row['code']}: empty name")
        if entry["stadsdeel"] != row["stadsdeel"]:
            bad.append(f"{row['code']}: stadsdeel {entry['stadsdeel']!r} differs from the table's {row['stadsdeel']!r}")
        if not entry["source"].strip():
            bad.append(f"{row['code']}: no source")
    if doc["areas"].get(_sheets.ANCHOR_CODE, {"name": ""})["name"] != _sheets.ANCHOR_NAME:
        bad.append("E4 must stay 'Canal Ring'")
    names = [doc["areas"][r["code"]]["name"] for r in table["sheets"] if r["code"] in doc["areas"]]
    for dup in sorted({n for n in names if names.count(n) > 1}):
        bad.append(f"name {dup!r} is shared by more than one area")
    return bad


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", default=os.path.join(_city.ROOT, _sheets.JSON_REL), help="the sheets.json to name (default: the repo's)")
    ap.add_argument("--raw", default=RAW_DIR)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    with open(args.table, encoding="utf-8") as fh:
        table = cast("_sheets.SheetTable", json.load(fh))
    out_path = os.path.join(_city.ROOT, OUT_REL)
    if args.check:
        with open(out_path, encoding="utf-8") as fh:
            problems = check(cast("AreaNamesFile", json.load(fh)), table)
        for p in problems:
            print("FAIL", p)
        print(f"area-names: {len(table['sheets'])} shipping sheets, {len(problems)} problems")
        return 1 if problems else 0
    doc, coverage = build(table, args.raw)
    problems = check(doc, table)
    if problems:
        raise SystemExit("\n".join(problems))
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    for code, e in doc["areas"].items():
        print(f"{code:3} {e['name']:42} {e['stadsdeel']:11} wijken cover {coverage[code]:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
