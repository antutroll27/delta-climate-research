"""frame_lat bit-identity gate (city-streaming P2a).

`Area.frame_lat` is the frame's standard parallel: the latitude whose cosine scales the east axis. It
DEFAULTS to the area's own latitude, so every area that existed before it -- Kolkata, Bengaluru, Canal Ring
-- must keep exactly the frame it had, to the last bit. This script is that proof, and it is deliberately NOT
a re-derivation: `tests/fixtures/frame-lat/python.json` was written from the code as it stood BEFORE
`frame_lat` existed (`--write-golden`, run once, before the first edit to `_city.py`), and every run
compares the current code against it with `==`, never a tolerance.

    python3 scripts/check-frame-lat.py                   # compare against the pinned golden (test:py)
    python3 scripts/check-frame-lat.py --self-test       # the gate fails when it should
    python3 scripts/check-frame-lat.py --write-golden    # re-pin: only ever from a frame that is KNOWN good

WHAT IS PINNED, per existing area: the metres-per-degree pair, `bounds` at two pads, `to_local` on a 5 x 5
lattice around the centre, and (for `_city` areas) the envelope in the source CRS. Kolkata and Bengaluru have
their own FROZEN modules (`_types`, `_bangalore`) with no Area and no `frame_lat`; they are pinned too, so a
change that leaks into them shows up here, and the existing parity oracle in `_city.py` ties `_city` to
`_bangalore` separately.

The artefact side of "bit-identical" (exports, rasters) is `check-existing-cities-unchanged.py` and
`export-city-obos.py --check`; the TS side of the frame is `tests/unit/frame-lat-default.test.mjs`.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Final, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _bangalore as blr  # noqa: E402
import _city  # noqa: E402
import _types  # noqa: E402

GOLDEN_REL: Final = os.path.join("tests", "fixtures", "frame-lat", "python.json")
PADS: Final = (0.0, 50.0)
LATTICE_STEP_DEG: Final = 0.004


class AreaFrame(TypedDict):
    mPerDeg: list[float]
    bounds: dict[str, list[float]]
    local: list[list[float]]
    #: only for `_city` areas
    boundsLocalCrs: list[float] | None


Golden = dict[str, AreaFrame]


def _lattice(lat: float, lon: float) -> list[tuple[float, float]]:
    return [(lon + (i - 2) * LATTICE_STEP_DEG, lat + (j - 2) * LATTICE_STEP_DEG) for i in range(5) for j in range(5)]


def compute() -> Golden:
    """The current frame of every area that existed before frame_lat, through the public helpers only."""
    out: Golden = {}
    for w in _types.WARDS.values():
        mx, my = _types.m_per_deg(w.centre.lat)
        out[f"kolkata/{w.id}"] = AreaFrame(
            mPerDeg=[mx, my],
            bounds={repr(p): list(_types.ward_bounds(w, p)) for p in PADS},
            local=[[(lon - w.centre.lon) * mx, (lat - w.centre.lat) * my] for lon, lat in _lattice(w.centre.lat, w.centre.lon)],
            boundsLocalCrs=None)
    for bw in blr.WARDS.values():
        out[f"bengaluru/{bw.id}"] = AreaFrame(
            mPerDeg=list(blr.m_per_deg(bw.centre.lat)),
            bounds={repr(p): list(blr.bounds(bw, p)) for p in PADS},
            local=[list(blr.to_local(bw, lon, lat)) for lon, lat in _lattice(bw.centre.lat, bw.centre.lon)],
            boundsLocalCrs=None)
    for a in _city.AREAS.values():
        out[f"{a.city}/{a.id}"] = AreaFrame(
            mPerDeg=list(_city.m_per_deg(a.centre.lat)),
            bounds={repr(p): list(_city.bounds(a, p)) for p in PADS},
            local=[list(_city.to_local(a, lon, lat)) for lon, lat in _lattice(a.centre.lat, a.centre.lon)],
            boundsLocalCrs=list(_city.bounds_local_crs(a)))
    return out


def golden_path() -> str:
    return os.path.join(_city.ROOT, GOLDEN_REL)


def compare(current: Golden, pinned: Golden) -> list[str]:
    bad: list[str] = []
    for key in sorted(set(current) | set(pinned)):
        if key not in pinned:
            continue                      # a NEW area is not an existing one: it has no golden to break
        if key not in current:
            bad.append(f"{key}: pinned but no longer produced")
            continue
        for field in ("mPerDeg", "bounds", "local", "boundsLocalCrs"):
            if current[key][field] != pinned[key][field]:                       
                bad.append(f"{key}: {field} is not bit-identical to the pinned frame")
    return bad


def load_golden() -> Golden:
    with open(golden_path(), encoding="utf-8") as fh:
        return cast("Golden", json.load(fh))


def write_golden() -> None:
    os.makedirs(os.path.dirname(golden_path()), exist_ok=True)
    with open(golden_path(), "w", encoding="utf-8") as fh:
        json.dump(compute(), fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(f"wrote {GOLDEN_REL}")


def main(argv: list[str]) -> int:
    if "--write-golden" in argv:
        write_golden()
        return 0
    cur = compute()
    pinned = load_golden()
    bad = compare(cur, pinned)
    if "--self-test" in argv:
        return self_test(cur, pinned)
    if bad:
        for b in bad:
            print("FAIL", b)
        return 1
    existing = [k for k in pinned if k in cur]
    print(f"check-frame-lat: ok -- {len(existing)} existing areas bit-identical to the pre-frame_lat golden "
          f"({', '.join(sorted(existing))})")
    return 0


def _flat(v: object) -> list[float]:
    if isinstance(v, (int, float)):
        return [float(v)]
    if isinstance(v, dict):
        return [x for k in sorted(v) for x in _flat(v[k])]
    if isinstance(v, (list, tuple)):
        return [x for e in v for x in _flat(e)]
    return []


def _max_diff(cur: Golden, pinned: Golden, line: str) -> str:
    """The size of a mismatch named by `compare`, so a CI log tells a last-bit difference from a real one."""
    key, rest = line.split(": ", 1)
    field = rest.split(" ", 1)[0]
    if key not in cur or field not in cur[key]:
        return "n/a"
    a, b = _flat(cur[key][field]), _flat(pinned[key][field])  # type: ignore[literal-required]
    return "length differs" if len(a) != len(b) else repr(max(abs(x - y) for x, y in zip(a, b)))


def self_test(cur: Golden, pinned: Golden) -> int:
    bad = compare(cur, pinned)
    assert bad == [], "the live frame must match its golden: " + "; ".join(f"{b} (max |d| {_max_diff(cur, pinned, b)})" for b in bad)
    # one ulp in one coordinate must be caught: the gate is exact, not a tolerance
    import copy
    import math
    bent = copy.deepcopy(cur)
    key = next(iter(bent))
    bent[key]["local"][7][0] = math.nextafter(bent[key]["local"][7][0], math.inf)
    assert compare(bent, pinned) == [f"{key}: local is not bit-identical to the pinned frame"]
    # a vanished area is caught; a new area is not a regression
    gone = {k: v for k, v in cur.items() if k != key}
    assert compare(gone, pinned) == [f"{key}: pinned but no longer produced"]
    extra = dict(cur)
    extra["x/new"] = cur[key]
    assert compare(extra, pinned) == []
    print("check-frame-lat --self-test: ok (exact comparison, ulp caught, vanished area caught, new area allowed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
