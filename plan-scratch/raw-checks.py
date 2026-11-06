"""A5/A6 raw orientation checks (NOT the A9 guards): footprints vs the AHN nodata mask, and heights vs AHN nDSM,
north-up against a deliberately mirrored (y -> -y) copy. Reads the committed buildings JSON + the raw AHN clips.
Run: taskpolicy -b python3 plan-scratch/raw-checks.py
"""
import json, os, sys
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
from shapely.geometry import Polygon
from scipy.stats import spearmanr
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import _city

a = _city.AREAS["canal-ring"]
raw = os.path.expanduser("~/.cache/delta-climate/cities/amsterdam/raw/ahn")
doc = json.load(open(os.path.join(_city.data_dir("amsterdam"), "canal-ring-buildings.json")))
half = a.size_m / 2
N = 1400            # 2 m cells over 2800 m
w, s, e, n = _city.bounds(a)
dst_tf = from_bounds(w, s, e, n, N, N)

def to_grid(path, resampling, nodata_in):
    with rasterio.open(path) as src:
        arr = src.read(1)
        dst = np.full((N, N), np.nan, dtype=np.float32)
        reproject(source=arr, destination=dst, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_tf,
                  dst_crs="EPSG:4326", src_nodata=nodata_in, dst_nodata=np.nan, resampling=resampling)
    return dst

dtm = to_grid(os.path.join(raw, "dtm_05m_clip.tif"), Resampling.average, float("nan"))
dsm = to_grid(os.path.join(raw, "dsm_05m_clip.tif"), Resampling.average, float("nan"))
# nodata share per 2 m cell: reproject a 0/1 mask with average
with rasterio.open(os.path.join(raw, "dtm_05m_clip.tif")) as src:
    m = np.isnan(src.read(1)).astype(np.float32)
    nod = np.zeros((N, N), np.float32)
    reproject(source=m, destination=nod, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_tf, dst_crs="EPSG:4326", resampling=Resampling.average)
mask = nod >= 0.5                       # row 0 = NORTH

def raster_fp(flip):
    tf = from_bounds(-half, -half, half, half, N, N)     # local metres, row 0 = north
    shapes = []
    for b in doc["b"]:
        p = np.array(b["p"]).reshape(-1, 2)
        if flip: p = p * np.array([1, -1])
        shapes.append((Polygon(p), 1))
    return rasterize(shapes, out_shape=(N, N), transform=tf, fill=0, dtype="uint8").astype(bool)

def jac(x, y): return float((x & y).sum() / max(1, (x | y).sum()))
fp_n, fp_m = raster_fp(False), raster_fp(True)
print(f"G6-style: AHN DTM nodata mask (>=50% of a 2 m cell) vs 3D BAG footprints rasterised at 2 m")
print(f"  mask share {mask.mean():.3f}, footprint share {fp_n.mean():.3f}")
jn, jm = jac(mask, fp_n), jac(mask, fp_m)
print(f"  Jaccard north-up {jn:.3f}   mirrored {jm:.3f}   ratio {jn / jm:.2f}")
# share of footprint cells that are nodata
print(f"  share of footprint cells with DTM nodata: north-up {(mask & fp_n).sum() / fp_n.sum():.3f}  mirrored {(mask & fp_m).sum() / fp_m.sum():.3f}")

# G5-style: DSM p70-ish (mean of the top cells is overkill; use per-footprint mean DSM) vs h, Spearman, with ground = DTM mesh nearest fill
from scipy import ndimage
bad = np.isnan(dtm)
idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
ground = dtm[idx[0], idx[1]]
ndsm = dsm - ground
def per_building(flip):
    tf = from_bounds(-half, -half, half, half, N, N)
    hs, vals = [], []
    for k, b in enumerate(doc["b"]):
        p = np.array(b["p"]).reshape(-1, 2)
        if flip: p = p * np.array([1, -1])
        x0, y0, x1, y1 = p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()
        c0, c1 = int((x0 + half) / 2), int((x1 + half) / 2) + 1
        r0, r1 = int((half - y1) / 2), int((half - y0) / 2) + 1
        c0, r0 = max(c0, 0), max(r0, 0)
        if c1 <= c0 or r1 <= r0 or c1 > N or r1 > N: continue
        win = ndsm[r0:r1, c0:c1]
        sub = np.isfinite(win)
        if sub.sum() < 2: continue
        hs.append(b["h"]); vals.append(float(np.percentile(win[sub], 70)))
    return np.array(hs), np.array(vals)
hn, vn = per_building(False)
hm, vm = per_building(True)
print(f"G5-style: Spearman rho between 3D BAG h and AHN4 nDSM p70 inside the 2 m bbox window of each footprint (DSM minus filled DTM)")
print(f"  north-up rho {spearmanr(hn, vn)[0]:.3f} (n={len(hn)})   mirrored rho {spearmanr(hm, vm)[0]:.3f} (n={len(hm)})")
d = vn - hn
print(f"  nDSM p70 minus h: median {np.median(d):.2f} m, p5 {np.percentile(d,5):.2f}, p95 {np.percentile(d,95):.2f}  (AHN4 2020-22 vs mostly AHN5 2023; bbox windows overstate)")
