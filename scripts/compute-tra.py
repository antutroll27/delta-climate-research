#!/usr/bin/env python3
"""
Thermal Refuge Accessibility per ward, for the DC-URS adaptive-capacity pillar.

    python3 scripts/compute-tra.py

TRA = exp(−λ·d_cool), λ = 0.002 per metre (≈347 m half-distance), where d_cool is
distance to the nearest thermal refuge. The source document
(dc-urs-source-of-truth.md §3C) defines refuges as *"public cooling centres,
shaded parks, and urban water bodies (Hooghly River, wetlands)"*.

REFUGES COME FROM ESA WorldCover, NOT OpenStreetMap.

The first implementation used OSM via Overpass. It was replaced because Overpass
rate-limited two of three wards, and one mirror returned HTTP 200 with **zero
elements** for Barrackpore — a ward that sits on the Hooghly and cannot have no
water. A valid-but-empty response is more dangerous than an error, because it
looks like a measurement. WorldCover is already cached locally, is 10 m,
wall-to-wall, and covers all three wards identically. No network, no rate limit,
no partial mirror.

WorldCover classes mapped to the source document's refuge definition:
    10  tree cover          shaded green
    20  shrubland           shaded green
    30  grassland           open park / maidan
    80  permanent water     the Hooghly, tanks, canals
    90  herbaceous wetland  East Kolkata Wetlands
    95  mangroves           water-adjacent green

WARD FIGURE. The source document defines d_cool for a point; a ward is an area.
The ward value is the MEAN over the footprint of each cell's distance-decayed
access — mean(exp(−λ·d)), not exp(−λ·mean(d)). Those differ, and the mean of the
decay is the right one: it is the average accessibility experienced across the
ward, not the accessibility of the average distance.

Output: data/dc-urs/tra.json
"""
import json, os, sys

import numpy as np
import rasterio
from rasterio.io import DatasetReader
from rasterio.windows import from_bounds
from scipy.ndimage import distance_transform_edt, label

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _types import WARDS, F64, Mask, TraFile, TraWard, Ward, m_per_deg, ward_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data", "dc-urs", "tra.json")
WC = os.path.expanduser("~/.cache/delta-climate/worldcover/N21E087.tif")

LAMBDA = 0.002                       # per metre, as specified
# The ward analysis footprint is NOT set here — it is Ward.footprint_m in
# _types.py, the single ward table this pipeline shares.
# Search beyond the ward: the nearest refuge to an edge cell is often outside it.
PAD_M = 2000

REFUGE_CLASSES = {10, 20, 30, 80, 90, 95}

# MINIMUM REFUGE SIZE. A single 10 m pixel of grass is not a thermal refuge you
# can walk to. Without this filter every ward scored 0.94–0.97 with a median
# distance of 9–26 m — the index stopped discriminating, because in a vegetated
# tropical city every cell is metres from *some* green pixel.
#
# The source document's own worked examples put d_cool at 800 m (Ballygunge) and
# 250 m (Baruipur), which can only mean substantial refuges, not stray pixels.
#
# The threshold is Kolkata-specific and already cited elsewhere in this project:
# Mitra et al. (2022) put the Threshold Value of Efficiency — the minimum park
# area that delivers measurable cooling in Kolkata — at 0.77 ha.
MIN_REFUGE_HA = 0.77
CLASS_NAME = {10: "tree cover", 20: "shrubland", 30: "grassland",
              80: "permanent water", 90: "wetland", 95: "mangroves"}

def ward_tra(src: DatasetReader, w: Ward) -> TraWard:
    ward = w.id
    mx, my = m_per_deg(w.centre.lat)
    win = from_bounds(*ward_bounds(w, PAD_M), transform=src.transform)
    cover = src.read(1, window=win)
    if cover.size == 0:
        sys.exit(f"{ward}: empty WorldCover window — the tile does not cover this ward")

    # cell size in metres (WorldCover is a geographic grid, so x and y differ)
    px_deg = abs(src.transform.a)
    cell_x, cell_y = px_deg * mx, px_deg * my

    raw: Mask = np.isin(cover, list(REFUGE_CLASSES))
    if not raw.any():
        sys.exit(f"{ward}: no refuge class present within {PAD_M} m. That is a data "
                 f"failure, not a measurement — refusing to write TRA=0.")

    # keep only contiguous patches at or above the Mitra threshold
    cell_area_m2 = cell_x * cell_y
    min_cells = int(round(MIN_REFUGE_HA * 10_000 / cell_area_m2))
    if min_cells <= 1:
        # The 0.77 ha threshold is the only thing making this term discriminate;
        # on a coarse raster it would clamp to 1 and silently switch itself off.
        sys.exit(f"{ward}: cell area {cell_area_m2:.0f} m2 is too coarse for a "
                 f"{MIN_REFUGE_HA} ha minimum patch — the threshold would be inert.")
    lab, n = label(raw)
    if n == 0:
        sys.exit(f"{ward}: labelling found no refuge patches")
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0                                   # background
    keep = np.flatnonzero(sizes >= min_cells)
    refuge: Mask = np.isin(lab, keep) if keep.size else np.zeros_like(raw)
    if not refuge.any():
        sys.exit(f"{ward}: no refuge patch reaches {MIN_REFUGE_HA} ha within {PAD_M} m. "
                 f"Largest was {sizes.max() * cell_area_m2 / 10_000:.2f} ha.")

    # distance (metres) from every cell to the nearest refuge cell
    d: F64 = distance_transform_edt(~refuge, sampling=(cell_y, cell_x))

    # crop back to the ward footprint before averaging
    py, px = int(round(PAD_M / cell_y)), int(round(PAD_M / cell_x))
    core = d[py:-py or None, px:-px or None]
    if core.size == 0:
        # Silently averaging the 5.4 km search window and calling it the ward is
        # exactly the class of failure this file already fixed once. Refuse.
        sys.exit(f"{ward}: ward footprint fell outside the raster after cropping "
                 f"({d.shape} padded). Refusing to report the search window as the ward.")

    decay = np.exp(-LAMBDA * core)

    # EVERY REPORTED STATISTIC MUST DESCRIBE THE WARD, NOT THE SEARCH WINDOW.
    # The distance transform legitimately runs over the padded window — the
    # nearest refuge to an edge cell is often outside the ward. But the refuge
    # counts must be cropped back, or they describe the surrounding countryside.
    # A first version reported them padded: Baruipur showed 286,817 refuge cells
    # against a ward of 24,776, and a "largest patch" of 2,201 ha against a ward
    # of 196 ha — an 11.6x domain mismatch, printed beside the ward's own TRA.
    cover_ward = cover[py:-py or None, px:-px or None]
    refuge_ward = refuge[py:-py or None, px:-px or None]
    if cover_ward.size == 0:
        cover_ward, refuge_ward = cover, refuge

    counts: dict[str, int] = {CLASS_NAME[c]: int((cover_ward == c).sum())
                              for c in sorted(REFUGE_CLASSES) if (cover_ward == c).any()}
    # largest patch AS SEEN WITHIN THE WARD — a patch may extend well beyond it,
    # so this is the in-ward area, not the patch's true total extent.
    lab_ward = np.where(refuge_ward, lab[py:-py or None, px:-px or None], 0)
    ward_sizes = np.bincount(lab_ward.ravel())
    ward_sizes[0] = 0
    return {
        "tra": round(float(decay.mean()), 4),
        "median_dist_m": round(float(np.median(core)), 1),
        "max_dist_m": round(float(core.max()), 1),
        "refuge_cell_fraction": round(float(refuge_ward.mean()), 4),
        "refuge_patches_in_ward": int((ward_sizes > 0).sum()),
        "largest_patch_in_ward_ha": round(float(ward_sizes.max() * cell_area_m2 / 10_000), 2),
        "refuge_patches_in_search_window": int(keep.size),
        "min_patch_ha": MIN_REFUGE_HA,
        "refuge_classes_present": counts,
        "cells": int(core.size),
    }


def main() -> None:
    if not os.path.exists(WC):
        sys.exit(f"WorldCover not cached at {WC}. Run scripts/landcover-fractions.py first.")

    out: TraFile = {
        "source": "ESA WorldCover 10 m v200 (2021), CC BY 4.0, tile N21E087",
        "method": f"TRA = mean over the ward footprint of exp(-{LAMBDA}*d), d = Euclidean "
                  f"distance to the nearest refuge cell. Mean of the decay, NOT decay of the "
                  f"mean distance.",
        "refuge_definition": "WorldCover classes 10/20/30/80/90/95 — tree cover, shrubland, "
                             "grassland, permanent water, wetland, mangroves. Maps the source "
                             "document's 'shaded parks and urban water bodies (Hooghly River, "
                             f"wetlands)'. Only contiguous patches >= {MIN_REFUGE_HA} ha count — "
                             "the Threshold Value of Efficiency for Kolkata parks (Mitra et al. "
                             "2022). Without it a single 10 m grass pixel counted as a refuge and "
                             "every ward scored 0.94-0.97, so the index stopped discriminating.",
        "why_not_osm": "Overpass rate-limited two of three wards, and one mirror returned "
                       "HTTP 200 with zero elements for Barrackpore — a ward on the Hooghly. "
                       "A valid-but-empty response looks like a measurement and is more "
                       "dangerous than an error. WorldCover is cached, wall-to-wall and "
                       "identical across wards.",
        "caveat": "WorldCover is a top-of-canopy product and carries no notion of public access. "
                  "A private garden and a public park are both 'grassland'. TRA therefore "
                  "measures proximity to cooling SURFACE, not to a refuge a resident may enter.",
        "provenance": "measured",
        "wards": {},
    }
    with rasterio.open(WC) as src:
        for wid, w in WARDS.items():
            out["wards"][wid] = ward_tra(src, w)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"  {'ward':<14}{'TRA':>8}{'med d':>9}{'max d':>9}{'refuge':>9}{'largest':>13}")
    for wid, v in out["wards"].items():
        print(f"  {wid:<14}{v['tra']:>8.3f}{v['median_dist_m']:>9.0f}"
              f"{v['max_dist_m']:>9.0f}{v['refuge_cell_fraction'] * 100:>8.1f}%"
              f"{v['largest_patch_in_ward_ha']:>10.1f} ha")
        print(f"                 {', '.join(f'{k} {n:,}' for k, n in v['refuge_classes_present'].items())}")
    print(f"\n  written to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
