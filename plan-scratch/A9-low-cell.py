"""What is the -4.52 m NAP cell of the A6 terrain mesh (~830 m south of centre)?"""
import sys, json, importlib.util
import numpy as np, shapely
sys.path.insert(0, "scripts")
spec = importlib.util.spec_from_file_location("cf", "scripts/check-city-frame.py"); cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)
import _city
a = _city.AREAS["canal-ring"]
t = cf.load(a, "terrain"); n = t["n"]; h = np.array(t["h"]).reshape(n, n)     # row 0 = SOUTH
cell = a.size_m / n
r, c = np.unravel_index(np.argmin(h), h.shape)
x, y = (c + .5) * cell - a.size_m / 2, (r + .5) * cell - a.size_m / 2
print(f"min {h.min():.2f} m NAP at row {r} col {c} (row 0 = south) -> local ({x:.0f}, {y:.0f}) m")
lon = a.centre.lon + x / _city.m_per_deg(a.centre.lat)[0]; lat = a.centre.lat + y / _city.m_per_deg(a.centre.lat)[1]
print(f"   lat {lat:.5f} lon {lon:.5f}")
print("  the 8 lowest cells:", sorted((round(float(v), 2), int(i // n), int(i % n)) for i, v in enumerate(h.ravel()) if v <= np.sort(h.ravel())[7]))
# native DTM around it
dtm, grid = cf.read_downsampled("dtm_05m_clip.tif", 2)
dsm, _ = cf.read_downsampled("dsm_05m_clip.tif", 2)
X, Y = cf.to_crs_xy(a, np.array([[x, y]]))[0]
inv = ~grid.transform
col, row = inv * (X, Y); col, row = int(col), int(row)
half = int(cell / 2) + 2
w = dtm[row - half:row + half, col - half:col + half]; d = dsm[row - half:row + half, col - half:col + half]
print(f"   window {w.shape}: DTM valid {np.isfinite(w).mean():.2f} min {np.nanmin(w):.2f} median {np.nanmedian(w):.2f}; DSM valid {np.isfinite(d).mean():.2f}")
ctx = cf.load(a, "context"); b = cf.load(a, "buildings")["b"]
cellbox = shapely.box(x - cell / 2, y - cell / 2, x + cell / 2, y + cell / 2)
water = [shapely.Polygon(cf.ring_xy(wp["p"])).buffer(0) for wp in ctx["water"] if "p" in wp]
wa = sum(p.intersection(cellbox).area for p in water) / cellbox.area
bu = sum(shapely.Polygon(cf.ring_xy(r_["p"])).buffer(0).intersection(cellbox).area for r_ in b) / cellbox.area
print(f"   Overture water covers {wa:.1%} of the cell, BAG footprints {bu:.1%}")
roads = [r_ for r_ in ctx["roads"] if cellbox.intersects(shapely.LineString(np.array(r_["line"]).reshape(-1, 2)))]
print(f"   road segments in the cell: {len(roads)} {sorted({r_['cls'] for r_ in roads})}")
green = [g for g in ctx["green"] if cellbox.intersects(shapely.Polygon(cf.ring_xy(g["p"])).buffer(0))]
print(f"   green polygons touching it: {sorted({g['cls'] for g in green})}")
# what are the deep pixels? inside a BAG footprint, and is there a surface above them?
ids = cf.rasterise_ids(cf.crs_polygons(a, cf.polygons(b, False)), grid)
sub_ids = ids[row - half:row + half, col - half:col + half]
deep = np.isfinite(w) & (w < -4.0)
print(f"   pixels with DTM < -4 m NAP in the cell window: {int(deep.sum())}; inside a BAG footprint {int((deep & (sub_ids > 0)).sum())}")
print(f"   DSM - DTM over those pixels: median {np.nanmedian((d - w)[deep]):.2f} m; DSM median {np.nanmedian(d[deep]):.2f} m NAP")
src = sorted({b[i - 1]['src_id'] for i in np.unique(sub_ids[deep & (sub_ids > 0)])})[:5]
print("   BAG ids under the deep pixels:", src, " h:", [round(b[i - 1]['h'], 1) for i in np.unique(sub_ids[deep & (sub_ids > 0)])][:5])
print(f"   DTM >30 m from any footprint, region median (A6 raw check): 0.55 m NAP; this window median {np.nanmedian(w):.2f}")
