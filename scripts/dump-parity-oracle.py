"""
Freeze the rasterio/GDAL pipeline's output as the parity contract for the Go port.

WHY THIS EXISTS. Replacing rasterio with pure Go means owning a projection and a
GeoTIFF reader. A bug in either does not crash — it silently shifts a grid or
mis-scales a temperature, and the error lands in published science. So the current
GDAL pipeline is captured here as an oracle FIRST, and the Go implementation has to
reproduce it before any logic is ported. If a primitive cannot hit tolerance we fall
back to the hybrid split having lost only the geo work.

WHAT IS CAPTURED, and why each one is a trap:

  transform_bounds  — rasterio is called with `densify_pts=21`. It samples 21 points
                      along each edge and takes the extremes, because a reprojected
                      edge is CURVED. Transforming only the four corners
                      underestimates the box, which would shift the whole target
                      grid by a fraction of a pixel and quietly change every
                      downstream mean. Naive four-corner code passes a casual eye
                      and fails here.
  target_grid       — the shared UTM 45N grid. `ceil` on the extent, north-up
                      transform, 70 m pixels. Off-by-one in either dimension
                      re-registers every raster against every other.
  from_bounds       — pixel window from geographic bounds. Row/col order and the
                      west/south/east/north argument order are both easy to invert,
                      and inverting them reads the wrong window rather than raising.
  align             — reproject onto the target grid. Captured for LST (float32,
                      NaN nodata) AND for a uint16 mask band, because the nodata
                      semantics differ and NaN is the one that bites: comparisons
                      against NaN are all False, so `> threshold` silently drops
                      every masked cell instead of keeping it.

Outputs raw little-endian float32/uint16 next to a JSON sidecar carrying shape,
dtype, nodata, CRS and the affine transform. Raw arrays rather than .npz so the Go
side needs no Python format reader.

Run:  python3 scripts/dump-parity-oracle.py            (uses the local granule cache)
      python3 scripts/dump-parity-oracle.py --list      (show what it would capture)

Reads only cached granules — no network, no token, nothing printed from ~/.config.
"""
from __future__ import annotations

import argparse
from typing import NotRequired, TypedDict
import glob
import json
import os
import sys
from typing import Any

import numpy as np
import numpy.typing as npt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import rasterio  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402

import _types  # noqa: E402
from _ecostress import (  # noqa: E402
    BBOX, CACHE, TARGET_CRS, TARGET_RES, align, target_grid, transform_bounds,
)

ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "tests", "fixtures", "geo-oracle")

#: Ward boxes come from _types, not a private copy. _sentinel.py keeps its own WARDS
#: table and _types' own comment records that private copies had already diverged
#: once — sub-pixel at ECOSTRESS's 70 m but four pixels at Sentinel's 10 m.
WARD_BOXES = {w.id: _types.ward_bounds(w) for w in _types.WARDS.values()}


class BoundsCase(TypedDict):
    """One transformBounds oracle row. `densifyDeltaM` is derived after the row
    is built, hence NotRequired — the CRS strings and the coordinate lists must
    stay separately typed or the delta arithmetic sees `str | list[float]`."""
    src: str
    dst: str
    bounds4326: list[float]
    densify21: list[float]
    naive4corner: list[float]
    densifyDeltaM: NotRequired[list[float]]


def _jsonable(v: Any) -> Any:
    """NaN/inf -> a string tag, so the output is VALID JSON.

    Python's json module happily writes bare `NaN` and `Infinity`, which RFC 8259 does
    not permit and Go's decoder rejects outright ("invalid character 'N'"). Since the
    whole point of this oracle is that two languages read the same file, every dump
    below passes allow_nan=False so an unhandled non-finite raises here rather than
    producing a file that only Python can read.
    """
    if isinstance(v, float):
        if np.isnan(v):
            return "NaN"
        if np.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
    return v


def _write_array(name: str, arr: npt.NDArray[Any], meta: dict[str, Any]) -> None:
    """Raw little-endian array + JSON sidecar. NaN survives the round trip in IEEE754."""
    path = os.path.join(OUT, name)
    arr.astype(arr.dtype.newbyteorder("<")).tofile(f"{path}.bin")
    finite = np.isfinite(arr) if arr.dtype.kind == "f" else np.ones(arr.shape, bool)
    meta |= {
        "shape": list(arr.shape),
        "dtype": arr.dtype.str,          # e.g. '<f4' — byte order is explicit
        "bytes": int(arr.nbytes),
        # Summary statistics so a mismatch is diagnosable from the sidecar alone,
        # without loading two binaries and diffing them by hand.
        "finiteCount": int(finite.sum()),
        "nanCount": int((~finite).sum()),
        "min": _jsonable(float(np.nanmin(arr))) if finite.any() else None,
        "max": _jsonable(float(np.nanmax(arr))) if finite.any() else None,
        "mean": _jsonable(float(np.nanmean(arr))) if finite.any() else None,
    }
    meta = {k: _jsonable(v) for k, v in meta.items()}
    with open(f"{path}.json", "w") as fh:
        json.dump(meta, fh, indent=1, sort_keys=True, allow_nan=False)
    print(f"    {name}.bin  {list(arr.shape)} {arr.dtype.str}  "
          f"finite={meta['finiteCount']} nan={meta['nanCount']}")


def dump_transform_bounds(cases: dict[str, Any]) -> None:
    """The densify_pts=21 curve, on every box the pipeline actually reprojects."""
    boxes: dict[str, tuple[float, float, float, float]] = {
        "ecostress-BBOX": BBOX,
        "study-BBOX": _types.STUDY_BBOX,
        **{f"ward-{k}": v for k, v in WARD_BOXES.items()},
        # REGRESSION GUARD, not a box the pipeline uses. Measured: densify_pts makes
        # exactly 0.0 m difference at 0.15 deg (wards) and 0.85 deg (study bbox),
        # because UTM is conformal and Kolkata sits ~1.4 deg off the zone-45 central
        # meridian — so four-corner code matches to the metre and the densification
        # is, today, unobservable. It reaches 2.8 km at 6 deg. This case exists so a
        # naive Go transform FAILS here even though it passes on the real boxes: if
        # the study area ever widens, the test catches it instead of the science.
        "guard-zonewide-6deg": (84.00, 20.00, 90.00, 28.00),
    }
    out: dict[str, BoundsCase] = {}
    for name, box in boxes.items():
        # densify_pts must match _ecostress.target_grid exactly. Both the densified
        # and the naive four-corner result are recorded so the Go test can assert it
        # matches the FORMER and differs from the latter — proving the densification
        # is actually implemented rather than coincidentally close.
        out[name] = {
            "src": "EPSG:4326",
            "dst": TARGET_CRS,
            "bounds4326": list(box),
            "densify21": list(transform_bounds("EPSG:4326", TARGET_CRS, *box, densify_pts=21)),
            "naive4corner": list(transform_bounds("EPSG:4326", TARGET_CRS, *box, densify_pts=0)),
        }
        d, n = out[name]["densify21"], out[name]["naive4corner"]
        out[name]["densifyDeltaM"] = [abs(a - b) for a, b in zip(d, n)]
    cases["transformBounds"] = out
    worst = max(max(v["densifyDeltaM"]) for v in out.values())
    print(f"    {len(out)} boxes · largest densify-vs-naive gap: {worst:.2f} m")


def dump_target_grid(cases: dict[str, Any]) -> None:
    """Affine + width/height of the shared grid, for the full bbox and each ward."""
    out = {}
    for name, box in [("default", None), ("study", _types.STUDY_BBOX),
                      *[(f"ward-{k}", v) for k, v in WARD_BOXES.items()]]:
        tf, w, h = target_grid(box)
        out[name] = {
            "bbox4326": list(box) if box else list(BBOX),
            "width": w, "height": h, "res": TARGET_RES,
            # rasterio Affine order: (a, b, c, d, e, f) — c/f are the origin, e is
            # negative for a north-up grid.
            "transform": [tf.a, tf.b, tf.c, tf.d, tf.e, tf.f],
        }
    cases["targetGrid"] = out
    print(f"    {len(out)} grids · default {out['default']['width']}x{out['default']['height']}")


def dump_windows(src_path: str, cases: dict[str, Any]) -> None:
    """from_bounds windows, in the scene's own CRS, against a real granule."""
    with rasterio.open(src_path) as src:
        out: dict[str, Any] = {
            "scene": {
                "crs": str(src.crs), "width": src.width, "height": src.height,
                "transform": [src.transform.a, src.transform.b, src.transform.c,
                              src.transform.d, src.transform.e, src.transform.f],
                "nodata": None if src.nodata is None else _jsonable(float(src.nodata)),
                "dtype": src.dtypes[0],
            },
            "windows": {},
        }
        for name, box in WARD_BOXES.items():
            l, b, r, t = transform_bounds("EPSG:4326", src.crs, *box, densify_pts=21)
            win = from_bounds(l, b, r, t, src.transform)
            out["windows"][name] = {
                "bounds4326": list(box),
                "boundsSceneCrs": [l, b, r, t],
                "colOff": win.col_off, "rowOff": win.row_off,
                "width": win.width, "height": win.height,
            }
    cases["fromBounds"] = out
    print(f"    {len(out['windows'])} windows against {os.path.basename(src_path)}")


def dump_align(lst: str, mask: str | None, cases: dict[str, Any]) -> None:
    """The reprojection itself — float32/NaN and uint16/sentinel side by side."""
    bbox = WARD_BOXES["ballygunge"]
    tf, w, h = target_grid(bbox)
    grid = {"transform": [tf.a, tf.b, tf.c, tf.d, tf.e, tf.f], "width": w, "height": h,
            "dstCrs": TARGET_CRS, "bbox4326": list(bbox), "resampling": "nearest"}

    a = align(lst, np.nan, "float32", bbox=bbox)
    _write_array("align-lst-ballygunge", a, {"source": os.path.basename(lst),
                                             "nodata": "NaN", **grid})
    cases.setdefault("align", {})["lst"] = {"file": "align-lst-ballygunge",
                                            "source": os.path.basename(lst), **grid}

    # THE NaN CASE, which the ward box does not provide. A single ward sits well
    # inside one tile, so its 21x21 window came back 441 finite / 0 NaN — an oracle
    # that cannot fail on the exact trap _ecostress.py documents ("mask with
    # isfinite(), never > threshold: NaN comparisons are all False"). The full BBOX
    # grid is 227x651 and spans beyond any single granule's footprint, so the
    # off-tile region reprojects to NaN and the mask has real structure to match.
    tf_f, w_f, h_f = target_grid(None)
    full = {"transform": [tf_f.a, tf_f.b, tf_f.c, tf_f.d, tf_f.e, tf_f.f],
            "width": w_f, "height": h_f, "dstCrs": TARGET_CRS,
            "bbox4326": list(BBOX), "resampling": "nearest"}
    af = align(lst, np.nan, "float32")          # no bbox -> the full shared grid
    _write_array("align-lst-fullbbox", af, {"source": os.path.basename(lst),
                                            "nodata": "NaN", **full})
    cases["align"]["lstFullBbox"] = {"file": "align-lst-fullbbox",
                                     "source": os.path.basename(lst), **full}
    if mask:
        m = align(mask, 0xFFFF, "uint16", bbox=bbox)
        _write_array("align-qc-ballygunge", m, {"source": os.path.basename(mask),
                                                "nodata": 65535, **grid})
        cases["align"]["qc"] = {"file": "align-qc-ballygunge",
                                "source": os.path.basename(mask), "nodata": 65535, **grid}


def pick_granule() -> tuple[str, str | None]:
    """A cached LST granule and its matching QC band, chosen deterministically.

    Sorted, and the LST must actually contain finite pixels over the ward — an
    all-NaN scene would make every parity assertion pass for the wrong reason.
    """
    bbox = WARD_BOXES["ballygunge"]
    for lst in sorted(glob.glob(os.path.join(CACHE, "*_LST.tif"))):
        try:
            a = align(lst, np.nan, "float32", bbox=bbox)
        except Exception:
            continue
        if np.isfinite(a).sum() < a.size // 2:
            continue     # mostly cloud/off-tile — a weak oracle
        qc = lst.replace("_LST.tif", "_QC.tif")
        return lst, (qc if os.path.exists(qc) else None)
    sys.exit(f"No usable cached LST granule in {CACHE} — run the fetch scripts first.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="show what would be captured")
    args = ap.parse_args()

    lst, qc = pick_granule()
    if args.list:
        print(f"  granule: {os.path.basename(lst)}")
        print(f"  qc band: {os.path.basename(qc) if qc else '(none cached)'}")
        print(f"  wards:   {', '.join(WARD_BOXES)}")
        return

    os.makedirs(OUT, exist_ok=True)
    cases: dict[str, Any] = {
        "note": "GENERATED from the rasterio/GDAL pipeline — the parity contract for "
                "the pure-Go port. Regenerate only when the pipeline legitimately "
                "changes, and review the diff as a change to published science.",
        "generatedBy": "scripts/dump-parity-oracle.py",
        "rasterio": rasterio.__version__,
        "gdal": rasterio.__gdal_version__,
        "numpy": np.__version__,
        "targetCrs": TARGET_CRS,
        "targetRes": TARGET_RES,
        "densifyPts": 21,
        "wards": {k: list(v) for k, v in WARD_BOXES.items()},
    }

    print("  transform_bounds:");  dump_transform_bounds(cases)
    print("  target_grid:");       dump_target_grid(cases)
    print("  from_bounds:");       dump_windows(lst, cases)
    print("  align:");             dump_align(lst, qc, cases)

    with open(os.path.join(OUT, "oracle.json"), "w") as fh:
        json.dump(cases, fh, indent=1, sort_keys=True, allow_nan=False)
    print(f"\n  wrote {OUT}/oracle.json")


if __name__ == "__main__":
    main()
