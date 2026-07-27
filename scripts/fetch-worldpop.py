#!/usr/bin/env python3
"""
Population density per ward, for the DC-URS exposure pillar.

    python3 scripts/fetch-worldpop.py

GHS-POP R2023A, 100 m, Mollweide. Free, CC BY 4.0, no key.

WHY GHS-POP AND NOT WORLDPOP. The spec named WorldPop, and the WorldPop
constrained product is a fine choice — but its India national raster is 466 MB,
its server does NOT support HTTP range requests (verified: "Range downloading not
supported by this server"), and a full download timed out. GHS-POP ships the same
100 m resolution PRE-TILED at 46 MB, and the tile we need is R7_C27 — byte-for-
byte the same tile and the same Mollweide grid as the GHS-SMOD raster this project
already uses for its urban/rural masks. Same JRC R2023A family, same licence, one
tenth the download, and population now lands on the identical grid as the
settlement classification it will be compared against.

WHY WORLDPOP AND NOT A CENSUS. `ρ_pop` wants a current figure, and India's most
recent completed enumeration is Census 2011 — the 2021 census was deferred and is
now Census 2027 (reference date 1 March 2027). WorldPop is modelled rather than
enumerated, but it is informed by satellite-observed built-up growth, so it
captures fifteen years of expansion that Census 2011 cannot. Recorded as
`measured` with its vintage on the face of it; a modelled population is still a
measurement of something, but the reader must know which.

EPOCH IS PINNED TO 2020 ON PURPOSE. GHS-POP publishes epochs to 2030, but
everything after 2020 is a projection. Probing "newest first" fetched E2030 and
labelled a forecast as a measurement; 2020 is the last epoch grounded in observed
built-up surface. A later epoch requires provenance "modelled", not a silent swap.

Output: data/dc-urs/worldpop.json
"""
import json, math, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _types  # noqa: E402  (path must be set first — the scripts are not a package)

import numpy as np
import rasterio
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "dc-urs", "worldpop.json")
CACHE = os.path.expanduser("~/.cache/delta-climate/worldpop")

FOOTPRINT_M = 1400

WARDS = {
    "ballygunge":  (22.528,  88.3659),
    "baruipur":    (22.3654, 88.4319),
    "barrackpore": (22.7621, 88.3713),
}

# Candidate products, newest first. The constrained UN-adjusted series is the
# right one: "constrained" restricts population to cells satellite imagery shows
# as built, which matters enormously at ward scale, and "UNadj" reconciles the
# national total with UN estimates.
_JRC = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/"
        "GHS_POP_E{yr}_GLOBE_R2023A_54009_100/V1-0/tiles/"
        "GHS_POP_E{yr}_GLOBE_R2023A_54009_100_V1_0_R7_C27.zip")

# 2020 ONLY — deliberately not the newest epoch.
#
# GHS-POP R2023A publishes epochs out to 2030, but everything after 2020 is a
# PROJECTION, not an observation. A first pass here probed newest-first, fetched
# E2030, and labelled a 2030 forecast as `provenance: "measured"` — a modelled
# future population presented as a present-day measurement. 2020 is the last
# epoch grounded in observed built-up surface and census disaggregation.
#
# If a later epoch is ever wanted, it must be labelled `provenance: "modelled"`
# and its projection status stated on the tool, not silently swapped in here.
CANDIDATES = [("2020", _JRC.format(yr="2020"))]


def ensure() -> tuple[str, str]:
    """Download the R7_C27 tile and return the .tif inside it."""
    import zipfile
    os.makedirs(CACHE, exist_ok=True)
    for year, url in CANDIDATES:
        zpath = os.path.join(CACHE, os.path.basename(url))
        tif = zpath.replace(".zip", ".tif")
        if os.path.exists(tif) and os.path.getsize(tif) > 1_000_000:
            return year, tif
        head = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                               "--max-time", "40", "-I", url], capture_output=True, text=True)
        if head.stdout.strip() != "200":
            print(f"  {os.path.basename(url)}: HTTP {head.stdout.strip()}, trying next")
            continue
        print(f"  fetching GHS-POP E{year} tile R7_C27 …")
        r = subprocess.run(["curl", "-s", "--fail", "-L", "--max-time", "1800", url, "-o", zpath])
        if r.returncode != 0:
            if os.path.exists(zpath):
                os.remove(zpath)
            print(f"  download failed (curl {r.returncode}), trying next")
            continue
        with zipfile.ZipFile(zpath) as z:
            name = next((n for n in z.namelist() if n.endswith(".tif")), None)
            if not name:
                print(f"  no .tif inside the archive, trying next")
                continue
            with z.open(name) as src, open(tif, "wb") as dst:
                dst.write(src.read())
        os.remove(zpath)
        return year, tif
    sys.exit("no GHS-POP tile reachable — every candidate epoch failed")


def main() -> None:
    year, path = ensure()

    out: _types.PopFile = {
        "source": "JRC GHS-POP R2023A, 100 m, Mollweide, tile R7_C27 (CC BY 4.0)",
        "product": os.path.basename(path),
        "vintage": year,
        "method": "Sum of per-cell population counts over the ward footprint, divided by "
                  "footprint area. GHS-POP cells are COUNTS, not densities, so they are summed "
                  "and then divided — averaging the cells would give persons per cell, which is "
                  "a different and wrong quantity.",
        "caveat": "Modelled, not enumerated. India's last completed census is 2011 (the 2021 "
                  "round was deferred to Census 2027), so no current enumerated figure exists. "
                  "GHS-POP disaggregates census counts using satellite-observed built-up surface, "
                  "so it captures post-2011 expansion that the census cannot.",
        "why_not_worldpop": "The spec named WorldPop. Its India raster is 466 MB, its server "
                            "rejects HTTP range requests, and the full download timed out. "
                            "GHS-POP is the same 100 m resolution, pre-tiled at 46 MB, on the "
                            "same Mollweide grid and the same R7_C27 tile as the GHS-SMOD masks "
                            "this project already uses.",
        "provenance": "measured",
        "wards": {},
    }

    area_km2 = (FOOTPRINT_M / 1000.0) ** 2
    with rasterio.open(path) as src:
        from rasterio.warp import transform_bounds
        for w, (lat, lon) in WARDS.items():
            half = FOOTPRINT_M / 2
            dlat = half / 110_540.0
            dlon = half / (111_320.0 * math.cos(math.radians(lat)))
            # GHS-POP is Mollweide (ESRI:54009), not geographic — project the box
            l, b, r_, t = transform_bounds("EPSG:4326", src.crs,
                                           lon - dlon, lat - dlat, lon + dlon, lat + dlat)
            win = from_bounds(l, b, r_, t, src.transform)
            arr = src.read(1, window=win, boundless=True, fill_value=0).astype("float64")
            arr = np.where(arr < 0, 0, arr)          # GHS-POP nodata is negative
            total = float(arr.sum())
            out["wards"][w] = _types.PopWard(
                density=round(total / area_km2, 1),
                population=round(total),
                cells=int(arr.size),
                area_km2=round(area_km2, 3),
            )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"\n  {'ward':<14}{'persons/km²':>13}{'population':>12}")
    for w, v in out["wards"].items():
        print(f"  {w:<14}{v['density']:>13,.0f}{v['population']:>12,}")
    print(f"\n  vintage {year} · written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
