"""A6 raw check: AHN DSM has no points over WATER (service abstract), so DSM-nodata ~ water. Compare DTM next to it
(quay / bank level) with the known Amsterdam canal summer level (NAP -0.40 m, 'zomerpeil'; NOT re-verified here) and
report where the lowest DTM pixels sit relative to that water.
"""
import os
import numpy as np, rasterio
from scipy import ndimage
raw = os.path.expanduser("~/.cache/delta-climate/cities/amsterdam/raw/ahn")
def load(n):
    with rasterio.open(os.path.join(raw, n)) as r:
        a = r.read(1)[::2, ::2]          # 1 m
    return a
dtm, dsm = load("dtm_05m_clip.tif"), load("dsm_05m_clip.tif")
water = np.isnan(dsm)                    # no DSM point = water (or outside the NL coverage: none here)
# keep only big connected nodata blobs (>= 400 m2 at 1 m) so isolated dropouts do not count as canals
lab, n = ndimage.label(water)
sizes = ndimage.sum(water, lab, range(1, n + 1))
big = np.isin(lab, 1 + np.flatnonzero(sizes >= 400))
print(f"DSM-nodata share {water.mean():.3f}; in blobs >= 400 m2: {big.mean():.3f} ({int((sizes >= 400).sum())} blobs)")
ring = ndimage.binary_dilation(big, iterations=3) & ~big          # bank pixels within 3 m of 'water'
bank = dtm[ring & ~np.isnan(dtm)]
print(f"DTM at the bank (<= 3 m from DSM-nodata blobs): n={bank.size}, median {np.median(bank):.2f} m NAP, p10 {np.percentile(bank,10):.2f}, p90 {np.percentile(bank,90):.2f}")
far = dtm[~ndimage.binary_dilation(big, iterations=30) & ~np.isnan(dtm)]
print(f"DTM > 30 m from water: n={far.size}, median {np.median(far):.2f}, p5 {np.percentile(far,5):.2f}, p95 {np.percentile(far,95):.2f}")
low = (dtm < -1.5)
near = ndimage.binary_dilation(big, iterations=3)
print(f"DTM pixels < -1.5 m NAP: {int(low.sum())}; of them within 3 m of a water blob: {int((low & near).sum())} ({(low & near).sum() / max(1, low.sum()):.2f})")
