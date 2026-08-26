"""Microsoft GlobalML footprints -> one clipped, site-local footprint artefact.

WHAT THIS IS. 13,579 real building outlines for the Dubai Creek window, clipped
from the UAE GlobalML release, reprojected into site-local metres (+y north) and
written with their lon/lat twins so the projection can be checked numerically
rather than eyeballed.

WHAT IT IS NOT. It carries NO HEIGHTS. GlobalML ships a `height` field and for
the UAE it is -1.0 on every single one of the 241,667 footprints in the tile --
measured 2026-08-24, not assumed. Heights come from WSF3D 90 m in
fetch-dubai-heights.py, at a resolution three times coarser than the median
building is wide, and the uncertainty that implies is the artefact's problem to
carry, not the renderer's to discover.

Licence: CDLA-Permissive-2.0. Attribution is mandatory and is emitted into the
artefact so the attribution page can be regenerated from provenance rather than
maintained by hand.

    python3 scripts/fetch-dubai-buildings.py            # build
    python3 scripts/fetch-dubai-buildings.py --check    # assert over the artefact
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import os
import sys
from typing import Any, TypedDict

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import GLOBALML_LINKS, SITES, Site, m_per_deg, site_bounds  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "flood-sim", "data")
CACHE_DIR = os.path.join(ROOT, "data", ".cache", "globalml")

REGION = "UnitedArabEmirates"
QUADKEY_ZOOM = 9
MIN_AREA_M2 = 10.0
MIRROR_SAMPLE = 500      # rings that keep their lonlat twin, for the anti-mirror check          # below this a footprint is noise at 30 m terrain scale
LICENCE = "CDLA-Permissive-2.0"
ATTRIBUTION = "Building footprints © Microsoft, Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0)"


class Skipped(TypedDict):
    not_polygon: int
    tiny: int
    outside: int
    holes_dropped: int


def quadkey(lat: float, lon: float, z: int = QUADKEY_ZOOM) -> str:
    """Bing quadkey for a point. GlobalML indexes its releases by these."""
    x = int((lon + 180.0) / 360.0 * 2 ** z)
    s = math.sin(math.radians(lat))
    y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2 ** z)
    out = []
    for i in range(z, 0, -1):
        d, m = 0, 1 << (i - 1)
        if x & m:
            d += 1
        if y & m:
            d += 2
        out.append(str(d))
    return "".join(out)


def cached(url: str, name: str) -> bytes:
    """Download once. The UAE tiles are ~23 MB gzipped and take ~35 s each."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()
    resp = requests.get(url, timeout=600)
    resp.raise_for_status()
    with open(path, "wb") as fh:
        fh.write(resp.content)
    return resp.content


def tile_urls(site: Site) -> list[tuple[str, str]]:
    """(quadkey, url) for every GlobalML tile touching the site window."""
    w, s, e, n = site_bounds(site)
    want = {quadkey(la, lo) for la in (s, n) for lo in (w, e)}
    links = cached(GLOBALML_LINKS, "dataset-links.csv").decode("utf-8")
    out: list[tuple[str, str]] = []
    for row in csv.DictReader(io.StringIO(links)):
        if row.get("Location") == REGION and row.get("QuadKey") in want:
            out.append((row["QuadKey"], row["Url"]))
    return out


def ring_area_m2(ring: list[list[float]], mx: float, my: float) -> float:
    """Shoelace in local metres. Sign-free — orientation is not guaranteed."""
    total = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0] * mx, ring[i][1] * my
        x2, y2 = ring[i + 1][0] * mx, ring[i + 1][1] * my
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def build(site: Site) -> dict[str, Any]:
    w, s, e, n = site_bounds(site)
    mx, my = m_per_deg(site.lat)
    skipped: Skipped = {"not_polygon": 0, "tiny": 0, "outside": 0, "holes_dropped": 0}
    buildings: list[dict[str, Any]] = []
    release = ""

    for qk, url in tile_urls(site):
        release = url.split("/global-buildings/")[1].split("/")[0]
        raw = cached(url, f"{REGION}-{qk}.csv.gz")
        for line in gzip.decompress(raw).decode("utf-8").splitlines():
            if not line.strip():
                continue
            feat = json.loads(line)
            geom = feat.get("geometry", {})
            if geom.get("type") != "Polygon":
                skipped["not_polygon"] += 1
                continue
            rings = geom["coordinates"]
            if len(rings) > 1:
                skipped["holes_dropped"] += len(rings) - 1
            ring = rings[0]
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            # Reject on the bounding box, not the centroid: a building straddling
            # the edge belongs in the window if any of it does.
            if max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n:
                skipped["outside"] += 1
                continue
            if ring_area_m2(ring, mx, my) < MIN_AREA_M2:
                skipped["tiny"] += 1
                continue
            flat: list[float] = []
            for lon, lat in ring:
                flat.append(round((lon - site.lon) * mx, 2))   # +x east
                flat.append(round((lat - site.lat) * my, 2))   # +y NORTH
            rec: dict[str, Any] = {"p": flat}
            # THE lonlat TWIN IS KEPT ONLY FOR THE CHECK SAMPLE. It exists so the
            # local-metre projection can be verified against independent ground
            # truth — the guard against the axis-sign bug that shipped a mirrored
            # render on the Kolkata twin. But `check()` reads the first
            # MIRROR_SAMPLE rings and no more, so carrying it on all of them was
            # 36 % of the artefact for no additional verification. At this site
            # that alone was the difference between ~99 MB and passing GitHub's
            # 100 MB file limit.
            if len(buildings) < MIRROR_SAMPLE:
                rec["lonlat"] = [[round(lon, 7), round(lat, 7)] for lon, lat in ring]
            buildings.append(rec)

    return {
        "site": site.id,
        "release": release,
        "source": "Microsoft GlobalML Building Footprints",
        "licence": LICENCE,
        "attribution": ATTRIBUTION,
        # TWO FIELDS, BECAUSE THERE ARE TWO QUESTIONS. `globalmlHeights` is this
        # script's own claim about its SOURCE and never changes. `heightsPresent`
        # is the artefact's merged STATE, and fetch-dubai-heights.py sets it true
        # after joining OSM heights in.
        #
        # They were one field, and the two checks asserted opposite things about
        # it: this file failed if it was true, fetch-dubai-heights.py failed if it
        # was false. Running the pipeline in its required order guaranteed one
        # gate would fire. A guard that disagrees with its consumer about what a
        # field MEANS is worse than no guard.
        "globalmlHeights": False,
        "heightsPresent": False,
        "heightsNote": (
            "GlobalML ships a `height` property; for the UAE it is -1.0 on every "
            "footprint (241,667 of 241,667 in the source tile, measured 2026-08-24). "
            "Heights come from WSF3D 90 m instead."
        ),
        "centre": [site.lon, site.lat],
        "footprintM": site.footprint_m,
        "count": len(buildings),
        "skipped": skipped,
        "b": buildings,
    }


def check() -> int:
    failures: list[str] = []
    for sid, site in SITES.items():
        path = os.path.join(OUT_DIR, f"{sid}-buildings.json")
        if not os.path.exists(path):
            failures.append(f"{sid}: artefact missing -- run without --check first")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        mx, my = m_per_deg(site.lat)
        half = site.footprint_m / 2
        if d["count"] != len(d["b"]):
            failures.append(f"{sid}: count {d['count']} disagrees with {len(d['b'])} rings")
        if d["count"] < 1000:
            failures.append(f"{sid}: only {d['count']} footprints -- the source or clip changed")

        # THE ANTI-MIRROR CHECK. `p` and `lonlat` are two representations of one
        # ring; recomputing one from the other catches a sign flip or a
        # transposed axis, which is exactly the class of bug that shipped a
        # mirrored render for a day on the Kolkata twin.
        worst = 0.0
        for bld in [b for b in d["b"] if "lonlat" in b][:MIRROR_SAMPLE]:
            flat, ll = bld["p"], bld["lonlat"]
            for i, (lon, lat) in enumerate(ll):
                ex = (lon - site.lon) * mx
                ey = (lat - site.lat) * my
                worst = max(worst, abs(flat[2 * i] - ex), abs(flat[2 * i + 1] - ey))
        checked = sum(1 for b in d["b"] if "lonlat" in b)
        if checked < MIRROR_SAMPLE:
            failures.append(f"{sid}: only {checked} rings carry a lonlat twin -- "
                            f"the anti-mirror check has nothing to verify against")
        if worst > 0.05:
            failures.append(f"{sid}: p/lonlat disagree by {worst:.3f} m -- projection or axis sign is wrong")

        outside = sum(
            1 for bld in d["b"]
            for i in range(0, len(bld["p"]), 2)
            if abs(bld["p"][i]) > half * 1.6 or abs(bld["p"][i + 1]) > half * 1.6
        )
        if outside:
            failures.append(f"{sid}: {outside} vertices far outside the window -- clip failed")
        # NO FALLBACK. An artefact written before globalmlHeights existed cannot
        # answer this question — heightsPresent may be true simply because
        # fetch-dubai-heights.py merged OSM heights in afterwards. Guessing from
        # the old field would silently pass or silently fail; say so instead.
        if "globalmlHeights" not in d:
            failures.append(f"{sid}: predates globalmlHeights — cannot verify the source "
                            f"claim; re-run fetch-dubai-buildings.py --site {sid}")
        elif d["globalmlHeights"]:
            failures.append(f"{sid}: globalmlHeights is true, but GlobalML UAE ships none "
                            f"(-1.0 on all 241,667 footprints in the source tile)")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        print(f"  OK {sid}: {d['count']:,} footprints, release {d['release']}, {LICENCE}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--site", default=None,
                        help="build one site only (default: all)")
    args = parser.parse_args()
    if args.check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    wanted = {k: v for k, v in SITES.items() if args.site in (None, k)}
    if not wanted:
        raise SystemExit(f"unknown site {args.site!r}; have {list(SITES)}")
    for sid, site in wanted.items():
        doc = build(site)
        path = os.path.join(OUT_DIR, f"{sid}-buildings.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        print(f"  {sid}: {doc['count']:,} footprints, {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
