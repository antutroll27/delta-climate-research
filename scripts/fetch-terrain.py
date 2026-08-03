"""Terrarium tiles -> one smoothed 128^2 heightfield per ward, for the terrain preview.

WHY SMOOTHING IS THE WHOLE JOB. Every free DEM of this delta is a SURFACE model
(terrarium is SRTM-derived here) -- rooftops and canopy ride in the "ground".
Measured raw relief across each 1400 m window is 6.4-8.9 m p5-p95; honest bare
earth is ~3-5 m. A ~40 m median filter removes single buildings and keeps the
Hooghly embankment and swales, and the artefact records BOTH spans so the
smoothing is visible, not implied.

PREVIEW-SIDE ONLY. Output lands in previews/terrain-3d/data/, never public/. This
is the acquisition tier: it runs offline on a developer machine, writes a JSON
artefact, and nothing it does ever executes in a browser.

    python3 scripts/fetch-terrain.py            # bake all three wards
    python3 scripts/fetch-terrain.py --check    # assert over the committed artefacts
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import statistics
import sys

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "previews", "terrain-3d", "data")

TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 15                       # ~4.4 m/px at this latitude; the window spans ~317 px
N = 128                      # texels per side -> ~11 m/texel over 1400 m
SIZE_M = 1400.0              # the instrument's ward window, edge to edge
SMOOTH_RADIUS_M = 40.0       # median-filter radius: wider than a building, narrower than the embankment
CLAMP_M = 12.0               # residual clamped to +/- this around the window median
RETRIEVED = "2026-08-04"     # constant, not date.today() -- byte-stable regeneration

#: lat, lon of each ward window centre (same values the instrument uses)
WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

#: RAW p5-p95 relief measured 2026-08-03 on these exact windows, BEFORE smoothing.
#: The tripwire: if a future re-run's raw span drifts past +/-30 % of these, the
#: tile source changed under us and the artefact must not be silently accepted.
#: It compares the RAW span deliberately -- the median filter exists to shrink the
#: smoothed one, so asserting that against these constants would always fail.
RAW_SPAN_M = {"ballygunge": 8.9, "barrackpore": 6.4, "baruipur": 7.5}


# -- pure helpers ------------------------------------------------------------

def tile_xy(lat: float, lon: float) -> tuple[float, float]:
    """Fractional web-mercator tile coordinates at zoom Z."""
    n = 2 ** Z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def decode(px: tuple[int, ...]) -> float:
    """Terrarium encoding: metres = (R*256 + G + B/256) - 32768."""
    return px[0] * 256 + px[1] + px[2] / 256 - 32768


def p5_p95(values: list[float]) -> tuple[float, float]:
    s = sorted(values)
    return s[len(s) // 20], s[int(len(s) * 0.95)]


def median_filter(field: list[float], n: int, radius: int) -> list[float]:
    """Median over a (2r+1)^2 window, edge-clamped. O(n^2 r^2) -- fine once at 128^2."""
    out = [0.0] * (n * n)
    for row in range(n):
        for col in range(n):
            window = []
            for dr in range(-radius, radius + 1):
                r = min(n - 1, max(0, row + dr))
                for dc in range(-radius, radius + 1):
                    c = min(n - 1, max(0, col + dc))
                    window.append(field[r * n + c])
            out[row * n + col] = statistics.median(window)
    return out


# -- acquisition -------------------------------------------------------------

def fetch_window(lat: float, lon: float) -> list[float]:
    """RAW N^2 heightfield over the SIZE_M window, nearest-sampled from z15 tiles.

    Nearest, not bilinear: at ~4.4 m/px source against ~11 m/texel output the median
    filter downstream swallows any sampling difference, and nearest keeps this loop
    trivially fast in pure Python.
    """
    cx, cy = tile_xy(lat, lon)
    m_per_px = 40075016.7 * math.cos(math.radians(lat)) / (2 ** Z * 256)
    half_px = (SIZE_M / 2) / m_per_px

    tiles: dict[tuple[int, int], Image.Image] = {}

    def px_at(gx: float, gy: float) -> float:
        tx, ty = int(gx // 256), int(gy // 256)
        if (tx, ty) not in tiles:
            r = requests.get(TILE.format(z=Z, x=tx, y=ty), timeout=60)
            r.raise_for_status()
            tiles[(tx, ty)] = Image.open(io.BytesIO(r.content)).convert("RGB")
        return decode(tiles[(tx, ty)].getpixel((int(gx) % 256, int(gy) % 256)))

    field = []
    for row in range(N):
        for col in range(N):
            gx = cx * 256 - half_px + (col + 0.5) / N * 2 * half_px
            gy = cy * 256 - half_px + (row + 0.5) / N * 2 * half_px
            field.append(px_at(gx, gy))
    return field


def build_artefact(ward: str) -> dict:
    lat, lon = WARDS[ward]
    raw = fetch_window(lat, lon)
    raw_lo, raw_hi = p5_p95(raw)

    radius_tx = max(1, round(SMOOTH_RADIUS_M / (SIZE_M / N)))
    smooth = median_filter(raw, N, radius_tx)
    med = statistics.median(smooth)
    h = [round(max(-CLAMP_M, min(CLAMP_M, v - med)), 1) for v in smooth]
    sm_lo, sm_hi = p5_p95(h)

    return {
        "ward": ward,
        "source": "AWS Open Data terrain tiles (terrarium z15; SRTM-derived over India)",
        "licence": "elevation public domain (SRTM/NASA); tile assembly per Mapzen attribution list",
        "retrieved": RETRIEVED,
        "n": N,
        "sizeM": SIZE_M,
        "medianM": round(med, 1),
        "smoothRadiusM": SMOOTH_RADIUS_M,
        "clampM": CLAMP_M,
        "rawSpanM": round(raw_hi - raw_lo, 1),      # BEFORE smoothing -- the tripwire's subject
        "smoothSpanM": round(sm_hi - sm_lo, 1),     # AFTER -- what the eye will see
        "note": "smoothed surface model, indicative -- not surveyed ground",
        "h": h,
    }


def serialise(doc: dict) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


# -- commands ----------------------------------------------------------------

def check() -> int:
    failures: list[str] = []
    for ward in WARDS:
        path = os.path.join(OUT_DIR, f"{ward}-terrain.json")
        if not os.path.exists(path):
            failures.append(f"{ward}: artefact missing -- run without --check first")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        if len(d["h"]) != N * N:
            failures.append(f"{ward}: expected {N*N} texels, found {len(d['h'])}")
        if any(abs(v) > CLAMP_M for v in d["h"]):
            failures.append(f"{ward}: a texel escapes the +/-{CLAMP_M} m clamp")
        expect = RAW_SPAN_M[ward]
        if not (0.7 * expect <= d["rawSpanM"] <= 1.3 * expect):
            failures.append(f"{ward}: raw span {d['rawSpanM']} m vs measured {expect} m "
                            f"-- the tile source changed under the artefact")
        if d["smoothSpanM"] > d["rawSpanM"]:
            failures.append(f"{ward}: smoothing INCREASED the span -- filter broken")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for ward in WARDS:
        with open(os.path.join(OUT_DIR, f"{ward}-terrain.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        print(f"    {ward:<12} median {d['medianM']:>5} m ASL · raw span {d['rawSpanM']} m "
              f"-> smoothed {d['smoothSpanM']} m")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for ward in WARDS:
        doc = build_artefact(ward)
        path = os.path.join(OUT_DIR, f"{ward}-terrain.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(serialise(doc))
        print(f"  {ward}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
