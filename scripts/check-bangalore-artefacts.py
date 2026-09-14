"""Every artefact OBOS fetches for a Bengaluru ward is present and coherent.

THE SURFACE RASTER IS THE POINT. `loadSurfaceRaster` returns null when it is
missing and the ward silently collapses to ONE uniform vegetation value — the
heat field driven by buildings alone, no error anywhere. This gate refuses that.

    python3 scripts/check-bangalore-artefacts.py
"""
from __future__ import annotations

import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402

OUT = os.path.join(blr.ROOT, "public", "heat-map", "data")
REQUIRED = ("{w}.json", "{w}-roads.json", "{w}-water.json",
            "{w}-trees.json", "{w}-surface.png")


def main() -> int:
    failures: list[str] = []
    for w in blr.WARDS.values():
        for pattern in REQUIRED:
            path = os.path.join(OUT, pattern.format(w=w.id))
            if not os.path.exists(path):
                failures.append(f"{w.id}: missing {os.path.basename(path)}")
                continue
            if os.path.getsize(path) == 0:
                failures.append(f"{w.id}: {os.path.basename(path)} is empty")

        # THE HEIGHT CROSS-CHECK MUST EXIST. A "SKIPPED" here once meant only that a
        # tile was missing, and it read like "no disagreement". Every ward now has a
        # covering UT-GLOBUS tile, so a skip or zero matches is a regression.
        cpath = os.path.join(blr.DATA, f"{w.id}-buildings.json")
        with open(cpath, encoding="utf-8") as fh:
            cross = str(json.load(fh).get("crossCheck", ""))
        matched = re.match(r"UT-GLOBUS \S+: ([\d,]+) of", cross)
        if cross.startswith("SKIPPED") or not matched or int(matched.group(1).replace(",", "")) == 0:
            failures.append(f"{w.id}: no UT-GLOBUS cross-check recorded ({cross[:50]!r})")

        bpath = os.path.join(OUT, f"{w.id}.json")
        if os.path.exists(bpath):
            with open(bpath, encoding="utf-8") as fh:
                doc = json.load(fh)
            if abs(float(doc["sizeM"]) - w.size_m) > 1e-6:
                failures.append(f"{w.id}: sizeM {doc['sizeM']} != registry {w.size_m}")
            if doc["count"] != len(doc["b"]):
                failures.append(f"{w.id}: count {doc['count']} != {len(doc['b'])} rows")
            # NOT an absolute bound, and NOT a sample. Both were wrong:
            #   · `size/2 + 40` is 1440 m, and Whitefield's z legitimately
            #     reaches 1443 — a building whose centroid sits inside the box
            #     carries ring vertices up to its own width past the edge. The
            #     old bound refused correct data.
            #   · `doc["b"][:2000]` inspected 13 % of 14,867 rows, so whether
            #     the gate fired at all was luck.
            # What this gate is FOR is an OFFSET frame. |lo + hi| is ~0 when
            # centred and ~size when offset, separating the two by three orders
            # of magnitude instead of quibbling over a few metres of overhang.
            #
            # IT DOES NOT CATCH A MIRROR, and must not be described as if it
            # did. Measured 2026-09-12: negating every x turns indiranagar's
            # span −1421.6..1417.1 into −1417.1..1421.6, so |lo + hi| is
            # IDENTICAL and the gate passes. A mirror about a centred origin is
            # invisible to any symmetric statistic. The mirror guard is
            # `scripts/check-bangalore-frame.py`, which converts published
            # landmark coordinates into the ward frame and requires a building
            # of plausible size within 60 m — a mirror puts them hundreds of
            # metres away. That check owns mirrors; this one owns offsets.
            xs = [float(row[i]) for row in doc["b"] for i in range(1, len(row), 2)]
            zs = [float(row[i]) for row in doc["b"] for i in range(2, len(row), 2)]
            for axis, vals in (("x", xs), ("z", zs)):
                lo, hi = min(vals), max(vals)
                skew = abs(lo + hi) / w.size_m
                if skew > 0.05:
                    failures.append(
                        f"{w.id}: {axis} spans {lo:.0f}..{hi:.0f}, skew {skew:.1%} — "
                        f"the frame is offset, not merely overhanging")
                if max(abs(lo), abs(hi)) > w.size_m / 2 + 120.0:
                    failures.append(
                        f"{w.id}: {axis} reaches {max(abs(lo), abs(hi)):.0f} m, beyond "
                        f"any plausible building overhang")

        spath = os.path.join(OUT, f"{w.id}-surface.png")
        if os.path.exists(spath):
            a = np.asarray(Image.open(spath)).astype(float)
            veg = a[:, :, 0] / 255.0
            if float(veg.std()) < 0.01:
                failures.append(
                    f"{w.id}: surface raster has no spatial variance (std "
                    f"{veg.std():.4f}) — this is the silent-uniform-vegetation "
                    f"failure the artefact exists to prevent")
            print(f"  {w.id:<12} veg mean {veg.mean():.3f} std {veg.std():.3f} "
                  f"grid {a.shape[0]}x{a.shape[1]}")

    if failures:
        for f in failures:
            print(f"  FAIL {f}")
        return 1
    print("\n  every Bengaluru artefact present, sized and spatially varying")
    return 0


if __name__ == "__main__":
    sys.exit(main())
