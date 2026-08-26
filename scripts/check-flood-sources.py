"""Probe every external data-source claim the flood-sim spec makes.

WHY THIS EXISTS. Three claims in BUILD-SPEC-flood-explorer.md and its preflight
research were wrong on 2026-08-24, and all three failed the same way: somebody
read a plausible search result and wrote it down as verified. A stale host, a
registration requirement that does not exist, and an attribute assumed present
that is -1 on every record. None of them would have survived a single HTTP
request, and none of them was failing loudly -- the pipeline would simply have
been built on a wrong premise.

So this asserts the claims themselves. It talks to the network, which is why it
is NOT part of `npm run build` -- a CDN hiccup must never fail a deploy. Run it
before trusting the spec, and when a fetcher starts behaving oddly.

    python3 scripts/check-flood-sources.py
    python3 scripts/check-flood-sources.py --quiet    # exit code only
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import zlib
import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import GLOBALML_LINKS, SITES, dem_tile_url, site_bounds  # noqa: E402
from _flood import m_per_deg  # noqa: E402

TIMEOUT = 60
AL_AIN_QUADKEY = "123023311"     # the 254.8 mm peak — absent from GlobalML
DUBAI_QUADKEYS = {"123023130", "123023132"}


class Result:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.notes: list[str] = []

    def claim(self, ok: bool, name: str, detail: str) -> None:
        (self.notes if ok else self.failures).append(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")


def check_dem(r: Result) -> None:
    """CLAIM: GLO-30 is anonymously reachable and supports range requests.

    BUILD-SPEC originally said this needed CDSE registration. It does not.
    """
    site = SITES["dubai-creek"]
    url = dem_tile_url(site.lat, site.lon).replace("/vsicurl/", "")
    try:
        resp = requests.get(url, headers={"Range": "bytes=0-2047"}, timeout=TIMEOUT)
    except Exception as exc:                                   # noqa: BLE001
        r.claim(False, "GLO-30 anonymous", f"unreachable: {exc}")
        return
    r.claim(resp.status_code == 206, "GLO-30 anonymous + range",
            f"HTTP {resp.status_code} (206 = range honoured, so windowed reads stay cheap)")
    r.claim(resp.content[:2] in (b"II", b"MM"), "GLO-30 is a TIFF",
            f"magic {resp.content[:2]!r}")


def check_globalml(r: Result) -> None:
    """CLAIMS: index host, CSV schema, UAE coverage, Al Ain gap, absent heights."""
    stale = "https://bfppub.blob.core.windows.net/global-buildings/dataset-links.csv"
    try:
        code = requests.get(stale, headers={"Range": "bytes=0-64"}, timeout=TIMEOUT).status_code
        r.claim(code >= 400, "preflight flag-9 host is still wrong",
                f"{stale} -> HTTP {code} (a 2xx here means the flag was right after all)")
    except Exception:                                          # noqa: BLE001
        r.claim(True, "preflight flag-9 host is still wrong", "unreachable, as recorded")

    try:
        resp = requests.get(GLOBALML_LINKS, timeout=TIMEOUT)
        resp.raise_for_status()
    except Exception as exc:                                   # noqa: BLE001
        r.claim(False, "GlobalML index", f"unreachable: {exc}")
        return
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    cols = set(rows[0].keys()) if rows else set()
    r.claim({"Location", "QuadKey", "Url"} <= cols, "GlobalML CSV schema",
            f"columns {sorted(cols)} (we key on Location/QuadKey/Url, NOT RegionName)")

    uae = [row for row in rows if row.get("Location") == "UnitedArabEmirates"]
    keys = {row["QuadKey"] for row in uae}
    r.claim(DUBAI_QUADKEYS <= keys, "Dubai tiles present",
            f"{len(uae)} UAE tiles; Dubai {sorted(DUBAI_QUADKEYS)} present")
    r.claim(AL_AIN_QUADKEY not in keys, "Al Ain gap unchanged",
            f"quadkey {AL_AIN_QUADKEY} absent — if this ever PASSES as present, "
            f"the launch narrative's best site just became buildable")

    tile = next((row for row in uae if row["QuadKey"] == "123023130"), None)
    if tile is None:
        r.claim(False, "GlobalML heights", "Dubai tile row missing")
        return
    # Sample the head of the tile rather than the whole 23 MB.
    resp = requests.get(tile["Url"], headers={"Range": "bytes=0-262143"}, timeout=TIMEOUT)
    try:
        text = gzip.decompress(resp.content).decode("utf-8", "ignore")
    except Exception:                                          # noqa: BLE001
        # A partial gzip member — expected, since we deliberately fetched a
        # range. Decompress what arrived and drop the truncated tail line.
        text = zlib.decompressobj(zlib.MAX_WBITS | 16).decompress(
            resp.content).decode("utf-8", "ignore")
    heights = []
    for line in text.splitlines()[:-1]:
        try:
            heights.append(json.loads(line)["properties"].get("height", -1.0))
        except Exception:                                      # noqa: BLE001
            continue
    real = [h for h in heights if h is not None and h > 0]
    r.claim(bool(heights) and not real, "GlobalML UAE heights still absent",
            f"{len(heights)} sampled, {len(real)} with height>0 — "
            f"any non-zero here means per-building heights arrived and WSF3D can be dropped")


def check_geometry(r: Result) -> None:
    """CLAIM: the shipped artefacts still describe the window the spec names."""
    site = SITES["dubai-creek"]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "public", "flood-sim", "data", "dubai-creek-buildings.json")
    if not os.path.exists(path):
        r.claim(False, "artefact present", "run fetch-dubai-buildings.py first")
        return
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    w, s, e, n = site_bounds(site)
    r.claim(doc["count"] > 10_000, "footprint count", f"{doc['count']:,} in the window")
    r.claim(doc["licence"] == "CDLA-Permissive-2.0", "licence recorded",
            f"{doc['licence']} — permissive, no share-alike on derivatives")
    # Checks the SOURCE claim, not the merged state — fetch-dubai-heights.py
    # legitimately sets heightsPresent true after joining OSM heights in.
    r.claim(not doc.get("globalmlHeights", doc["heightsPresent"]),
            "artefact agrees GlobalML ships no heights", "globalmlHeights=false")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true")
    quiet = parser.parse_args().quiet
    r = Result()
    for probe in (check_dem, check_globalml, check_geometry):
        probe(r)
    if not quiet:
        for line in r.notes:
            print(f"  {line}")
        for line in r.failures:
            print(f"  {line}")
    print(f"\n  {len(r.notes)} claims verified, {len(r.failures)} failed.")
    return 1 if r.failures else 0


if __name__ == "__main__":
    sys.exit(main())
