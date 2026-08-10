#!/usr/bin/env python3
"""Background line-work for the El Nino Listening Party poster.

Contours a real sea-surface-temperature anomaly field from the strongest El Nino
on record and emits it as layered SVG, plus a generative arc/scatter layer whose
density follows that same field. Light line-work for a near-black poster ground.

    python3 scripts/poster-bg.py           build
    python3 scripts/poster-bg.py --demo    self-check

Data: NOAA ERSST v5 via PSL OPeNDAP, fetched as plain text so no netCDF stack is
needed. Responses are cached, so a restyle never re-hits NOAA.
"""

import re
import ssl
import sys
import urllib.request
from pathlib import Path
from typing import TypedDict

import cv2
import numpy as np
import numpy.typing as npt

F64 = npt.NDArray[np.float64]
F32 = npt.NDArray[np.float32]
Shape = tuple[int, ...]
Xform = tuple[float, float, float]


class Style(TypedDict):
    """One row of INTENSITY. A TypedDict, not dict[str, float | str]: `dash` is
    the only string and every use of it is a format placeholder, so a mixed-value
    dict would type every lookup as `float | str` and infect the arithmetic."""
    op: float
    wide: float
    dot: float
    dot_r: float
    dash: str

ROOT = Path(__file__).resolve().parent.parent
BG = ROOT / "previews" / "poster" / "bg"
CACHE = BG / "cache"

BASE = "https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.ersst.v5"
SST = f"{BASE}/sst.mnmean.nc.ascii"
LTM = f"{BASE}/sst.mon.ltm.1991-2020.nc.ascii"

# ERSST v5 grid: lat 88 -> -88 step -2 (89), lon 0 -> 358 step 2 (180).
LAT0, DLAT, NLAT = 88.0, -2.0, 89
LON0, DLON, NLON = 0.0, 2.0, 180

# Target: November 2015, near the peak of the 2015-16 event.
# index = (year - 1854) * 12 + (month - 1); verified against the file's time axis.
YEAR, MONTH = 2015, 11
T_INDEX = (YEAR - 1854) * 12 + (MONTH - 1)

# Tropical Pacific crop, on-grid (the grid is even-numbered degrees).
LAT_N, LAT_S = 24.0, -24.0
LON_W, LON_E = 120.0, 284.0

# Nino 3.4 box, for the verification check.
N34 = dict(lat=(5.0, -5.0), lon=(190.0, 240.0))

# Poster frame. SVG scales, so this is a reference aspect, not a fixed size.
W, H = 1080, 1350

CREAM = "#EFE6D6"
TEAL = "#1F6F6A"   # the poster's date-chip teal, used for the +2.0 line only
ACCENT_LEVEL = 2.0

# 0.25 degC steps, not 0.5: a strong El Nino is one broad warm tongue, so coarse
# steps yield only a handful of rings. Fine steps give the nested-contour density
# the references have, and every line is still a real isotherm.
LEVELS = [round(v, 2) for v in np.arange(-0.75, 3.75, 0.25) if abs(v) > 1e-9]

MISSING = -9e36  # ERSST land fill is about -9.969e+36


def lat_idx(lat: float) -> int:
    return int(round((lat - LAT0) / DLAT))


def lon_idx(lon: float) -> int:
    return int(round((lon - LON0) / DLON))


def fetch(url: str, params: str, cache_name: str) -> str:
    """GET an OPeNDAP ascii slice, cached on disk."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / cache_name
    if not path.exists():
        full = f"{url}?{params}"
        # this python.org build ships no CA bundle; use certifi's when present
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = ssl.create_default_context()
        with urllib.request.urlopen(full, timeout=90, context=ctx) as r:
            path.write_bytes(r.read())
    return path.read_text()


def parse_grid(text: str, rows: int, cols: int) -> F64:
    """Pull the value block out of an OPeNDAP ascii grid response.

    Data lines look like:  [0][12], 29.44, 29.39, ...
    one line per (leading-index, row), each holding a full row of columns.
    """
    out = np.full((rows, cols), np.nan, np.float64)
    seen = 0
    for line in text.splitlines():
        m = re.match(r"^\[(\d+)\]\[(\d+)\],\s*(.+)$", line.strip())
        if not m:
            continue
        r = int(m.group(2))
        vals = [float(v) for v in m.group(3).split(",")]
        if r < rows and len(vals) == cols:
            out[r] = vals
            seen += 1
    if seen != rows:
        raise ValueError(f"expected {rows} data rows, parsed {seen}")
    out[out < MISSING / 1e3] = np.nan  # land / missing
    return out


def slab(a: int, b: int) -> str:
    """Inclusive index range string for OPeNDAP."""
    lo, hi = sorted((a, b))
    return f"[{lo}:1:{hi}]"


def load_anomaly() -> F64:
    """SST anomaly for the target month over the crop box, land as NaN."""
    r0, r1 = sorted((lat_idx(LAT_N), lat_idx(LAT_S)))
    c0, c1 = sorted((lon_idx(LON_W), lon_idx(LON_E)))
    rows, cols = r1 - r0 + 1, c1 - c0 + 1

    sst = parse_grid(
        fetch(SST, f"sst[{T_INDEX}:1:{T_INDEX}]{slab(r0, r1)}{slab(c0, c1)}",
              f"sst_{YEAR}{MONTH:02d}.txt"),
        rows, cols)
    clim = parse_grid(
        fetch(LTM, f"sst[{MONTH - 1}:1:{MONTH - 1}]{slab(r0, r1)}{slab(c0, c1)}",
              f"ltm_{MONTH:02d}.txt"),
        rows, cols)
    return sst - clim


def nino34(anom: F64) -> float:
    """Area of the Nino 3.4 box inside the cropped field. Used to sanity-check."""
    r0 = lat_idx(N34["lat"][0]) - lat_idx(LAT_N)
    r1 = lat_idx(N34["lat"][1]) - lat_idx(LAT_N)
    c0 = lon_idx(N34["lon"][0]) - lon_idx(LON_W)
    c1 = lon_idx(N34["lon"][1]) - lon_idx(LON_W)
    box = anom[min(r0, r1):max(r0, r1) + 1, min(c0, c1):max(c0, c1) + 1]
    return float(np.nanmean(box))


# --------------------------------------------------------------------------
# contouring
# --------------------------------------------------------------------------

UP = 8  # upsample factor; the source grid is a coarse 2 degrees


def field_for_contour(anom: F64) -> F32:
    """Smooth, upsampled field with land neutralised.

    Land goes to 0.0 rather than NaN so contour lines follow the anomaly and
    never trace a coastline - no drawn level sits between -0.5 and +0.5.
    """
    f = np.nan_to_num(anom, nan=0.0).astype(np.float32)
    big = cv2.resize(f, (f.shape[1] * UP, f.shape[0] * UP), interpolation=cv2.INTER_CUBIC)
    return np.asarray(cv2.GaussianBlur(big, (0, 0), UP * 0.6), dtype=np.float32)


def smooth_closed(pts: F64, window: int) -> F64:
    """Moving average around a closed polyline.

    cv2.findContours walks the pixel grid, so a nearly-horizontal isotherm comes
    back as a staircase. Blurring the field harder does not fix it - the steps are
    in the boundary, not the data - so smooth the polyline itself, wrapping at the
    seam to keep the ring closed.
    """
    n = len(pts)
    if n < window * 2:
        return pts
    k = np.ones(window) / window
    wrap = np.concatenate([pts[-window:], pts, pts[:window]])
    sx = np.convolve(wrap[:, 0], k, mode="same")[window:window + n]
    sy = np.convolve(wrap[:, 1], k, mode="same")[window:window + n]
    return np.stack([sx, sy], 1)


def contours_at(field: F32, level: float) -> list[F64]:
    """Iso-lines at `level`, as pixel-space polylines."""
    mask = (field >= level if level > 0 else field <= level).astype(np.uint8)
    if mask.sum() == 0:
        return []
    found, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in found:
        if cv2.contourArea(c) < (UP * 3) ** 2:  # drop specks
            continue
        pts = c.reshape(-1, 2).astype(np.float64)
        if len(pts) < 8:
            continue
        # smooth the staircase out first, then simplify only lightly - a loose
        # epsilon on its own just trades stair steps for faceting
        pts = smooth_closed(pts, window=max(int(UP * 1.5), 3))
        keep = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2),
                                epsilon=UP * 0.06, closed=True)
        if len(keep) >= 4:
            out.append(keep.reshape(-1, 2).astype(np.float64))
    return out


# Where the warm core should sit on the poster. Low and right, so the densest
# nested rings stay clear of the title block in the upper left.
CORE_TARGET = (0.66, 0.70)


def frame_transform(shape: Shape, anchor: tuple[float, float] | None = None) -> Xform:
    """Cover-fit scale and offset, optionally anchoring a point in the field.

    Cover leaves the field overflowing the frame, so there is slack to slide it.
    `anchor` is a pixel coord placed at CORE_TARGET where the slack allows.
    """
    h, w = shape
    s = max(W / w, H / h)
    if anchor is None:
        ox, oy = (W - w * s) / 2, (H - h * s) / 2
    else:
        ox = CORE_TARGET[0] * W - anchor[0] * s
        oy = CORE_TARGET[1] * H - anchor[1] * s
        ox = min(0.0, max(W - w * s, ox))   # never uncover the frame
        oy = min(0.0, max(H - h * s, oy))
    return s, ox, oy


def warm_core(field: F32) -> tuple[float, float]:
    """Pixel coord of the strongest anomaly - the composition's anchor."""
    idx = int(np.argmax(field))
    return float(idx % field.shape[1]), float(idx // field.shape[1])


def to_frame(pts: F64, shape: Shape, xform: Xform | None = None) -> F64:
    s, ox, oy = xform if xform else frame_transform(shape)
    return pts * s + np.array([ox, oy], dtype=np.float64)


def path_d(pts: F64) -> str:
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    d += [f"L{x:.1f} {y:.1f}" for x, y in pts[1:]]
    return " ".join(d) + " Z"


# --------------------------------------------------------------------------
# generative arcs + scatter, driven by the same field
# --------------------------------------------------------------------------

def arc_layer(field: F32, xform: Xform, seed: int = 20260805
              ) -> tuple[list[tuple[float, float]], list[F64]]:
    """Concentric arcs plus a point field whose density follows the anomaly.

    The scatter is not decoration: points are rejection-sampled against the warm
    anomaly, so the cloud thickens exactly where the El Nino signal is strongest.
    Sampling happens in the field's own pixel space and is then pushed through the
    same transform as the contours, so the two layers register with each other.
    """
    rng = np.random.default_rng(seed)
    warm = np.clip(field / max(float(np.max(field)), 1e-6), 0, 1)
    hh, ww = warm.shape

    pts: list[tuple[float, float]] = []
    tries = 0
    while len(pts) < 900 and tries < 200000:
        tries += 1
        px, py = rng.random() * ww, rng.random() * hh
        if rng.random() < warm[min(int(py), hh - 1), min(int(px), ww - 1)] ** 1.6:
            x, y = to_frame(np.array([[px, py]]), warm.shape, xform)[0]
            if -4 <= x <= W + 4 and -4 <= y <= H + 4:   # keep what lands on the poster
                pts.append((x, y))

    # arcs centre on the warm core too, so the whole layer shares one focus
    cx, cy = CORE_TARGET[0] * W, CORE_TARGET[1] * H
    arcs = []
    for i in range(9):
        t = np.linspace(-2.7 + i * 0.045, -0.8 + i * 0.045, 64)
        r = W * (0.26 + i * 0.115)
        arcs.append(np.stack([cx + r * np.cos(t), cy + r * np.sin(t)], 1))
    return pts, arcs


# --------------------------------------------------------------------------
# svg
# --------------------------------------------------------------------------

INTENSITY: dict[str, Style] = {
    # Calibrated on the dark preview page, not guessed. Cream on near-black needs
    # noticeably more opacity than dark-on-cream to register at all.
    "ghost": dict(op=0.40, wide=1.3, dot=0.34, dot_r=1.5, dash="2 6"),
    "present": dict(op=0.72, wide=1.5, dot=0.72, dot_r=1.9, dash="2.5 5"),
}


def svg_open() -> list[str]:
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}" fill="none">']


def enso_groups(anom: F64, k: Style) -> list[str]:
    field = field_for_contour(anom)
    xform = frame_transform(field.shape, anchor=warm_core(field))
    parts = []
    for lv in LEVELS:
        polys = contours_at(field, lv)
        if not polys:
            continue
        accent = abs(lv - ACCENT_LEVEL) < 1e-6
        colour = TEAL if accent else CREAM
        # warm levels read stronger than cool ones; the accent is deliberately louder
        op = k["op"] * (1.0 if lv > 0 else 0.62) * (1.9 if accent else 1.0)
        parts.append(
            f'<g id="anom_{lv:+.2f}C" stroke="{colour}" '
            f'stroke-width="{k["wide"] * (1.9 if accent else 1):.2f}" '
            f'opacity="{min(op, 1):.3f}">')
        for p in polys:
            parts.append(f'  <path d="{path_d(to_frame(p, field.shape, xform))}"/>')
        parts.append("</g>")
    return parts


def arc_groups(anom: F64, k: Style) -> list[str]:
    field = field_for_contour(anom)
    pts, arcs = arc_layer(field, frame_transform(field.shape, anchor=warm_core(field)))
    parts = [f'<g id="arcs" stroke="{CREAM}" stroke-width="{k["wide"]:.2f}" '
             f'opacity="{k["op"] * 0.85:.3f}" stroke-dasharray="{k["dash"]}">']
    for a in arcs:
        parts.append(f'  <path d="{path_d(a)[:-2]}"/>')  # open arc, drop the Z
    parts.append("</g>")
    parts.append(f'<g id="scatter" fill="{CREAM}" opacity="{k["dot"]:.3f}">')
    for x, y in pts:
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="{k["dot_r"]}"/>')
    parts.append("</g>")
    return parts


def write(name: str, body: list[str]) -> Path:
    out = BG / name
    out.write_text("\n".join(svg_open() + body + ["</svg>"]) + "\n")
    return out


def main() -> int:
    BG.mkdir(parents=True, exist_ok=True)
    anom = load_anomaly()

    n34 = nino34(anom)
    print(f"Nov {YEAR} Nino 3.4 anomaly = {n34:+.2f} degC  (published record: about +2.5 to +3.0)")
    if not 2.0 < n34 < 3.5:
        print("  WARNING: outside the expected range - check the index maths.")

    made = []
    for tag, k in INTENSITY.items():
        e, a = enso_groups(anom, k), arc_groups(anom, k)
        made += [write(f"enso-{tag}.svg", e),
                 write(f"arcs-{tag}.svg", a),
                 write(f"combined-{tag}.svg", e + a)]
    for p in made:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size // 1024}KB")
    return 0


def demo() -> int:
    """Self-check on the parsing, contouring and sampling logic."""
    # axis maths
    assert lat_idx(88.0) == 0 and lat_idx(-88.0) == NLAT - 1, "lat index maps end to end"
    assert lon_idx(0.0) == 0 and lon_idx(358.0) == NLON - 1, "lon index maps end to end"
    assert T_INDEX == 1942, f"Nov 2015 should be index 1942, got {T_INDEX}"

    # parser: two rows of three, plus a land fill
    txt = "junk\n[0][0], 1.0, 2.0, 3.0\n[0][1], 4.0, -9.96921e+36, 6.0\n"
    g = parse_grid(txt, 2, 3)
    assert g.shape == (2, 3) and g[0, 0] == 1.0, "grid parsed in order"
    assert np.isnan(g[1, 1]), "land fill must become NaN"
    try:
        parse_grid("[0][0], 1.0, 2.0, 3.0\n", 2, 3)
        raise AssertionError("short response should raise")
    except ValueError:
        pass

    # contouring: a warm blob yields one closed ring at +1.0 and none at +3.0
    f = np.zeros((40, 60), np.float64)
    cv2.circle(f, (30, 20), 12, (2.0,), -1)
    big = field_for_contour(f)
    assert len(contours_at(big, 1.0)) == 1, "one blob -> one contour"
    assert contours_at(big, 3.0) == [], "no contour above the blob's peak"

    # smoothing kills the staircase: a stepped near-horizontal line should end up
    # far flatter, while a closed ring stays closed and keeps its extent
    steps = np.array([[float(i), float((i // 6) % 2)] for i in range(120)])
    before = np.abs(np.diff(steps[:, 1])).sum()
    after = np.abs(np.diff(smooth_closed(steps, 12)[:, 1])).sum()
    assert after < before / 3, f"smoothing should flatten steps ({after:.2f} vs {before:.2f})"
    ring = contours_at(big, 1.0)[0]
    assert np.hypot(*(ring[0] - ring[-1])) < big.shape[1] * 0.5, "ring stays closed"

    # cover-fit keeps the frame filled
    pts = to_frame(np.array([[0.0, 0.0], [60.0, 40.0]]), (40, 60))
    assert pts[0][0] <= 0 and pts[1][0] >= W, "cover must span the full width"

    # Anchoring places the warm core on target along whichever axis has slack.
    # For this field (much wider than the poster) cover-scale is set by height,
    # so vertical position is fully determined and only x is steerable.
    shape = (200, 664)
    s, ox, oy = xf = frame_transform(shape, anchor=(500.0, 100.0))
    assert abs(H - shape[0] * s) < 1e-6, "no vertical slack for a wide field"
    assert oy == 0, "vertical offset is pinned when there is no slack"
    ax, _ = to_frame(np.array([[500.0, 100.0]]), shape, xf)[0]
    assert abs(ax - CORE_TARGET[0] * W) < 1, "anchor lands on target in x"
    assert ox <= 0 and ox >= W - shape[1] * s, "offset must keep the frame covered"
    edge = frame_transform(shape, anchor=(0.0, 0.0))   # anchor demands more slack than exists
    assert edge[1] <= 0, "clamped rather than leaving a gap"

    # peak finder
    peak = np.zeros((20, 30), np.float32)
    peak[7, 22] = 5.0
    assert warm_core(peak) == (22.0, 7.0), "warm core is the argmax pixel"

    # scatter tracks the warm half of the field, and is reproducible
    fld = np.zeros((200, 664), np.float32)
    fld[:, 400:] = 3.0
    xf2 = frame_transform(fld.shape, anchor=warm_core(fld))
    p1, _ = arc_layer(fld, xf2)
    p2, _ = arc_layer(fld, xf2)
    assert p1 == p2, "seeded output must be reproducible"
    assert len(p1) > 100, f"sampler should find points in the warm half, got {len(p1)}"
    cold = to_frame(np.array([[100.0, 100.0]]), fld.shape, xf2)[0][0]
    assert all(x > cold for x, _ in p1), "no scatter in the cold half"
    print("demo ok")
    return 0


if __name__ == "__main__":
    sys.exit(demo() if "--demo" in sys.argv else main())
