"""Terrarium tiles -> one smoothed 128^2 heightfield per ward, for the 3D scene.

WHY SMOOTHING IS THE WHOLE JOB. Every free DEM of this delta is a SURFACE model
(terrarium is SRTM-derived here) -- rooftops and canopy ride in the "ground".
Measured raw relief across each 1400 m window is 6.4-8.9 m p5-p95; honest bare
earth is ~3-5 m. A ~40 m median filter removes single buildings and keeps the
Hooghly embankment and swales, and the artefact records BOTH spans so the
smoothing is visible, not implied.

WHAT THIS IS AND IS NOT. Two independent DEMs -- terrarium (SRTM) and Copernicus
GLO-30 (TanDEM-X) -- agree about this ground only to r ~ 0.5, with a per-cell RMSE
of 1.5-2.1 m against a total relief of 4.9-7.7 m. So the artefact is INDICATIVE
BROAD-SCALE FORM, not measured ground, and every consumer must label it as such.
It is a visual layer. It never enters the simulation and never sits beside the
measured LST figures as though it carried comparable confidence.

This is the acquisition tier: it runs offline on a developer machine, writes a
JSON artefact, and nothing it does ever executes in a browser.

    python3 scripts/fetch-terrain.py            # bake all three wards
    python3 scripts/fetch-terrain.py --check    # assert over the committed artefacts
    python3 scripts/fetch-terrain.py --ward ballygunge   # bake one ward
"""
from __future__ import annotations

import argparse
from typing import Any
import io
import json
import math
import os
import statistics
import sys

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _types  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "public", "heat-map", "data")

TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 15                       # ~4.4 m/px at this latitude; the window spans ~317 px
#: Texel pitch, metres: 128 texels over the original 1400 m window. Held FIXED
#: across ward sizes (an 1800 m ward gets 165 texels, not 128 stretched to
#: 14 m), so the median filter and the clamp mean the same thing in every ward.
TEXEL_M = 1400.0 / 128
SMOOTH_RADIUS_M = 40.0       # median-filter radius: wider than a building, narrower than the embankment
CLAMP_M = 12.0               # residual clamped to +/- this around the window median
RETRIEVED = "2026-08-04"     # constant, not date.today() -- byte-stable regeneration

#: The ward table: _types.WARDS, the window centres and sizes the instrument uses.
#: This file carried a private copy of the centres until Ballygunge moved.
WARDS = _types.WARDS


#: The windows the GLO-30 cross-check (`crossCheck` below) was MEASURED on,
#: 2026-08. A ward whose window has since moved says so in its artefact rather
#: than carrying a comparison of ground it no longer covers.
CROSS_CHECKED: dict[str, tuple[float, float, int]] = {
    "ballygunge": (22.528, 88.3659, 1400),
    "barrackpore": (22.7621, 88.3713, 1400),
    "baruipur": (22.3654, 88.4319, 1400),
}


def grid_n(ward: str) -> int:
    """Texels per side for this ward: 128 at 1400 m, 165 at 1800 m."""
    return round(WARDS[ward].footprint_m / TEXEL_M)


#: RAW p5-p95 relief measured 2026-08-03 on these exact windows, BEFORE smoothing.
#: The tripwire: if a future re-run's raw span drifts past +/-30 % of these, the
#: tile source changed under us and the artefact must not be silently accepted.
#: It compares the RAW span deliberately -- the median filter exists to shrink the
#: smoothed one, so asserting that against these constants would always fail.
#: Ballygunge re-measured 2026-10-02 on its 1800 m Ward 68 window: 8.5 m (was 8.9 m over
#: the old 1400 m box).
RAW_SPAN_M = {"ballygunge": 8.5, "barrackpore": 6.4, "baruipur": 7.5}


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

def fetch_window(lat: float, lon: float, size_m: float, n: int) -> list[float]:
    """RAW n^2 heightfield over the size_m window, nearest-sampled from z15 tiles.

    Nearest, not bilinear: at ~4.4 m/px source against ~11 m/texel output the median
    filter downstream swallows any sampling difference, and nearest keeps this loop
    trivially fast in pure Python.
    """
    cx, cy = tile_xy(lat, lon)
    m_per_px = 40075016.7 * math.cos(math.radians(lat)) / (2 ** Z * 256)
    half_px = (size_m / 2) / m_per_px

    tiles: dict[tuple[int, int], Image.Image] = {}

    def px_at(gx: float, gy: float) -> float:
        tx, ty = int(gx // 256), int(gy // 256)
        if (tx, ty) not in tiles:
            r = requests.get(TILE.format(z=Z, x=tx, y=ty), timeout=60)
            r.raise_for_status()
            tiles[(tx, ty)] = Image.open(io.BytesIO(r.content)).convert("RGB")
        px = tiles[(tx, ty)].getpixel((int(gx) % 256, int(gy) % 256))
        assert isinstance(px, tuple), "tile was converted to RGB, so this is a triple"
        return decode(px)

    field = []
    for row in range(n):
        for col in range(n):
            gx = cx * 256 - half_px + (col + 0.5) / n * 2 * half_px
            gy = cy * 256 - half_px + (row + 0.5) / n * 2 * half_px
            field.append(px_at(gx, gy))
    return field


def cross_check(ward: str) -> str:
    """The GLO-30 comparison sentence, or that sentence plus where it was measured."""
    text = ("vs Copernicus GLO-30 over the same window: shape agreement "
            "r=0.49/0.48/0.67, per-cell RMSE 1.5-2.1 m against a 4.9-7.7 m "
            "relief. Two instruments disagree by ~a quarter of the signal.")
    w = WARDS[ward]
    lat, lon, size = CROSS_CHECKED[ward]
    if (w.centre.lat, w.centre.lon, w.footprint_m) == (lat, lon, size):
        return text
    return (text + f" MEASURED 2026-08 on the earlier {size} m window centred {lat} N, "
            f"{lon} E; not re-measured for this {w.footprint_m} m window.")


def build_artefact(ward: str) -> dict[str, Any]:
    w = WARDS[ward]
    size_m, n = float(w.footprint_m), grid_n(ward)
    raw = fetch_window(w.centre.lat, w.centre.lon, size_m, n)
    raw_lo, raw_hi = p5_p95(raw)

    radius_tx = max(1, round(SMOOTH_RADIUS_M / (size_m / n)))
    smooth = median_filter(raw, n, radius_tx)
    med = statistics.median(smooth)
    h = [round(max(-CLAMP_M, min(CLAMP_M, v - med)), 1) for v in smooth]
    sm_lo, sm_hi = p5_p95(h)

    return {
        "ward": ward,
        "source": "AWS Open Data terrain tiles (terrarium z15; SRTM-derived over India)",
        "licence": "elevation public domain (SRTM/NASA); tile assembly per Mapzen attribution list",
        "retrieved": RETRIEVED,
        "n": n,
        "sizeM": size_m,
        "medianM": round(med, 1),
        "smoothRadiusM": SMOOTH_RADIUS_M,
        "clampM": CLAMP_M,
        "rawSpanM": round(raw_hi - raw_lo, 1),      # BEFORE smoothing -- the tripwire's subject
        "smoothSpanM": round(sm_hi - sm_lo, 1),     # AFTER -- what the eye will see
        "confidence": "indicative",
        "note": "smoothed surface model, indicative broad-scale form -- NOT surveyed "
                "ground and NOT used by the simulation",
        "crossCheck": cross_check(ward),
        "h": h,
    }


def serialise(doc: dict[str, Any]) -> str:
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
        n = grid_n(ward)
        if d["n"] != n or len(d["h"]) != n * n:
            failures.append(f"{ward}: expected {n}x{n} texels, found n={d['n']} "
                            f"and {len(d['h'])} values")
        if d["sizeM"] != float(WARDS[ward].footprint_m):
            failures.append(f"{ward}: artefact is {d['sizeM']} m, the ward is "
                            f"{WARDS[ward].footprint_m} m -- regenerate it")
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
    parser.add_argument("--ward", choices=sorted(WARDS), default=None)
    args = parser.parse_args()
    if args.check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for ward in ([args.ward] if args.ward else list(WARDS)):
        doc = build_artefact(ward)
        path = os.path.join(OUT_DIR, f"{ward}-terrain.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(serialise(doc))
        print(f"  {ward}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
