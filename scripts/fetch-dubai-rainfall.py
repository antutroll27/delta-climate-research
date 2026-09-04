"""The observed hyetograph for April 2024, from GPM IMERG — replacing an invented storm.

WHY THIS EXISTS. Every rainfall figure in the flood model has rested on a storm
SHAPE I made up: an SCS Type II design curve, chosen because it is conventional,
not because Dubai did that. It is the largest unconstrained parameter in the
model — at a fixed 142 mm total, runoff swings 0 % -> 27.3 % on shape alone,
because infiltration is intensity-resolved. A gentle 142 mm soaks away; the same
142 mm in a two-hour burst runs off. So the storm shape decides the answer, and
until now it was a guess.

GPM IMERG half-hourly (0.1 deg, V07B) is the observation. It is not a rain gauge
— it is a satellite retrieval calibrated against gauges, and Dubai's gauge
network is not in the public calibration set — so treat it as the best available
constraint on SHAPE and TIMING, and keep the 142 mm total from the ground
report. What we want from IMERG is when the rain fell and how hard, not how much.

WHY OPeNDAP AND NOT THE FILES. 145 granules x 7.6 MB is 1.1 GB to read nine grid
cells. The OPeNDAP `.ascii` endpoint subsets server-side and returns ~200 bytes.
It needs the SAME Earthdata bearer token but a DIFFERENT authorisation: the
`nasa_gesdisc_data_archive` application EULA, accepted per-account at
urs.earthdata.nasa.gov. Without it every request is 403, not 401, and the body
carries a `resolution_url` — that is the tell.

TWO TRAPS, BOTH MEASURED
  · DIMENSION ORDER IS [time][lon][lat], NOT [time][lat][lon]. Verified against
    the file rather than assumed: a 3x3 box read at lon 2352 returned the same
    value the single-cell read gave at [2352][1151].
  · INDEXING IS FLOOR, NOT ROUND. IMERG cell centres sit at x.x5, so 25.154 N
    belongs to the cell centred 25.15. Rounding sends it to 25.25 — one cell,
    ~11 km north, and it reads 6.13 mm/h where the right cell reads 7.42.
    `--check` asks the file for its own coordinates and fails if they drift.

    python3 scripts/fetch-dubai-rainfall.py --check     # verify indexing only
    python3 scripts/fetch-dubai-rainfall.py             # fetch the hyetograph
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _flood import SITES  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "flood-sim", "data")
TOKEN = os.path.expanduser("~/.config/delta-climate/earthdata-token")

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
OPENDAP = "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGHH.07"
FILL = -9999.0            # IMERG missing; real rain is never negative
DEG = 0.1                 # IMERG V07 grid step, both axes

# The 2024 event. Dubai's rain fell on 16 April; the window is padded a day
# either side so the run-up and the tail are both visible rather than clipped.
START, END = "2024-04-15T00:00:00Z", "2024-04-18T00:00:00Z"
LICENCE = "NASA Earthdata open data policy — free reuse with attribution"
ATTRIBUTION = ("Huffman et al. (2023), GPM IMERG Final Precipitation L3 "
               "Half Hourly 0.1 degree V07, GES DISC")


def idx(deg: float, origin: float) -> int:
    """Grid index containing `deg`. FLOOR — cell centres are at x.x5, not x.x0."""
    return int(math.floor((deg - origin) / DEG))


def window() -> tuple[float, float, float, float]:
    """Site bbox in degrees: (lon0, lat0, lon1, lat1)."""
    site = SITES["dubai-creek"]
    half = site.footprint_m / 2.0
    dlat = half / 111320.0
    dlon = half / (111320.0 * math.cos(math.radians(site.lat)))
    return site.lon - dlon, site.lat - dlat, site.lon + dlon, site.lat + dlat


def session() -> requests.Session:
    if not os.path.exists(TOKEN):
        sys.exit(f"no Earthdata token at {TOKEN}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {open(TOKEN).read().strip()}"})
    return s


def ascii_values(s: requests.Session, url: str, expr: str) -> list[float]:
    """Every number in an OPeNDAP .ascii body, minus the index labels.

    The body repeats the filename in its header, and that filename contains
    digits (`20240416-S060000`). Parsing "all numbers" scoops those up as
    rainfall. So: skip the header, and drop the leading `precipitation[0][i],`
    label on each row.
    """
    # GES DISC THROTTLES, IT DOES NOT FAIL. Eight concurrent workers lost 46 of
    # 145 granules to HTTP errors; every one of them returned 200 when retried
    # alone. Without this the run looks like sparse data rather than a busy
    # server, and a rainfall series with 32 % of its half-hours missing would
    # have been a completely different storm.
    r = requests.Response()
    for attempt in range(5):
        r = s.get(f"{url}.ascii?{expr}", timeout=180, allow_redirects=True)
        if r.status_code == 403 and "resolution_url" in r.text:
            sys.exit("403 EULA — accept nasa_gesdisc_data_archive at urs.earthdata.nasa.gov")
        if r.status_code < 400:
            break
        time.sleep(2.0 * (attempt + 1))
    r.raise_for_status()
    out: list[float] = []
    for line in r.text.strip().splitlines():
        if "," not in line or "Dataset:" in line:
            continue
        out += [float(v) for v in re.findall(r"-?\d+\.?\d*(?:[eE][-+]?\d+)?",
                                             line.split(",", 1)[1])]
    return out


def granules(s: requests.Session) -> list[tuple[str, str]]:
    """(iso_start, opendap_url) for every half-hour over the site, time-ordered."""
    lo0, la0, lo1, la1 = window()
    q: dict[str, str] = {
        "short_name": "GPM_3IMERGHH", "version": "07", "page_size": "500",
        "temporal": f"{START},{END}",
        "bounding_box": f"{lo0:.4f},{la0:.4f},{lo1:.4f},{la1:.4f}"}
    entries = s.get(CMR, params=q, timeout=180).json()["feed"]["entry"]
    out: list[tuple[str, str]] = []
    for e in entries:
        href = next((l["href"] for l in e["links"]
                     if l["href"].endswith(".HDF5") and l["href"].startswith("http")), None)
        if href:
            # CMR hands back the direct-download host; OPeNDAP is a different one.
            out.append((e["time_start"], OPENDAP + "/" + href.split("GPM_3IMERGHH.07/")[1]))
    return sorted(set(out))


def box() -> tuple[int, int, int, int]:
    """Grid index bounds covering the site window, inclusive."""
    lo0, la0, lo1, la1 = window()
    return (idx(lo0, -180.0), idx(lo1, -180.0), idx(la0, -90.0), idx(la1, -90.0))


def check(s: requests.Session, url: str) -> int:
    """Ask the file where our indices actually are. The mirror-bug guard."""
    lo0, lo1, la0, la1 = box()
    site = SITES["dubai-creek"]
    lons = ascii_values(s, url, f"lon[{lo0}:{lo1}]")
    lats = ascii_values(s, url, f"lat[{la0}:{la1}]")
    print(f"  lon[{lo0}:{lo1}] = {lons}")
    print(f"  lat[{la0}:{la1}] = {lats}")
    ok = True
    for name, vals, want in (("lon", lons, site.lon), ("lat", lats, site.lat)):
        # the site centre must fall INSIDE the span these cells cover
        if not (min(vals) - DEG/2 <= want <= max(vals) + DEG/2):
            print(f"  FAIL {name}: site {want} outside {min(vals)}..{max(vals)}")
            ok = False
        step = [round(b - a, 6) for a, b in zip(vals, vals[1:])]
        if any(abs(d - DEG) > 1e-6 for d in step):
            print(f"  FAIL {name}: step {set(step)} != {DEG}")
            ok = False
    # the centre cell must be the one FLOOR picks, not ROUND
    ci = idx(site.lat, -90.0)
    cv = ascii_values(s, url, f"lat[{ci}]")[0]
    if not (cv <= site.lat < cv + DEG):
        print(f"  FAIL centre: lat[{ci}]={cv} does not contain {site.lat}")
        ok = False
    print(f"  centre cell lat[{ci}] = {cv} contains {site.lat}  {'OK' if ok else ''}")
    print("\n  " + ("all checks pass" if ok else "INDEXING IS WRONG — do not fetch"))
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="verify indexing, fetch nothing")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=os.path.join(OUT, "dubai-creek-rainfall.json"))
    a = ap.parse_args()

    s = session()
    gr = granules(s)
    if not gr:
        sys.exit("CMR returned no granules")
    lo0, lo1, la0, la1 = box()
    print(f"  {len(gr)} half-hourly granules, {START[:10]} .. {END[:10]}")
    print(f"  box lon[{lo0}:{lo1}] lat[{la0}:{la1}] "
          f"= {(lo1-lo0+1)}x{(la1-la0+1)} cells over the site\n")

    if a.check:
        return check(s, gr[0][1])
    if check(s, gr[0][1]) != 0:
        return 1
    print()

    expr = f"precipitation[0][{lo0}:{lo1}][{la0}:{la1}]"

    def one(g: tuple[str, str]) -> tuple[str, float | None]:
        try:
            v = [x for x in ascii_values(s, g[1], expr) if x > FILL]
            return g[0], (sum(v) / len(v) if v else None)
        except Exception as e:                       # one bad granule != no storm
            print(f"    {g[0][:16]} FAILED: {type(e).__name__}", flush=True)
            return g[0], None

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        rows = list(ex.map(one, gr))

    got = [(t, v) for t, v in rows if v is not None]
    print(f"  {len(got)}/{len(rows)} granules read")
    if len(got) < len(rows) * 0.9:
        sys.exit(f"only {len(got)}/{len(rows)} granules — refusing to write a holed storm")

    # mm/h sampled every half hour -> mm per half hour -> mm total
    total = sum(v for _, v in got) * 0.5
    peak_t, peak_v = max(got, key=lambda r: r[1])
    site = SITES["dubai-creek"]
    doc: dict[str, Any] = {
        "site": site.id, "product": "GPM_3IMERGHH v07B", "stepMinutes": 30,
        "boxCells": [(lo1-lo0+1), (la1-la0+1)],
        "licence": LICENCE, "attribution": ATTRIBUTION,
        "times": [t for t, _ in got],
        "intensityMmHr": [round(v, 4) for _, v in got],
        "totalMm": round(total, 2),
        "peakMmHr": round(peak_v, 2), "peakAt": peak_t,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(doc, open(os.path.abspath(a.out), "w"), indent=2)

    print(f"\n  IMERG total over the box: {total:.1f} mm")
    print(f"  peak {peak_v:.1f} mm/h at {peak_t}")
    print(f"  ground report for Dubai on 16 Apr: 142 mm")
    print(f"\n  wrote {os.path.abspath(a.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
