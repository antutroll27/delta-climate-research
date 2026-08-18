#!/usr/bin/env python3
"""Are the committed artefacts still consistent with the inputs they were built from?

public/3d-tiles/ and data/indicators/ are written by Python and COMMITTED;
`npm run build` does not regenerate them. Edit a raster or a ward centre without
re-running the generator and the tileset quietly disagrees with the map.

The first version of this check regenerated and diffed. CI killed it: the .glb
files came back the same LENGTH but different BYTES on Linux, because vertex
positions are float32 trigonometry and the last bits differ between macOS ARM
and Linux x86. Byte-identical binary across platforms was never achievable —
check-geo-oracle.py carries EPS_M = 1e-9 for the same reason.

So each artefact now embeds a sha256 of every input AND of its generator's own
source, and this compares those. Platform-independent, instant, and it also
catches a hand-edited artefact: the stamp travels inside the file, so altering
the data without re-running the generator leaves a stamp that no longer matches.
"""
from __future__ import annotations

import json
import os
import sys

from _stamp import ROOT, verify

ARTEFACTS = [
    ("public/3d-tiles/ballygunge/tileset.json", ("extras", "inputsHash")),
    ("public/3d-tiles/barrackpore/tileset.json", ("extras", "inputsHash")),
    ("public/3d-tiles/baruipur/tileset.json", ("extras", "inputsHash")),
    ("data/indicators/iso-city-indicators.json", ("inputsHash",)),
]


def main() -> int:
    bad = 0
    for rel, path in ARTEFACTS:
        full = os.path.join(ROOT, rel)
        if not os.path.exists(full):
            print(f"  MISSING {rel}")
            bad += 1
            continue
        with open(full, encoding="utf-8") as fh:
            doc = json.load(fh)
        node = doc
        for key in path:
            node = node.get(key, {}) if isinstance(node, dict) else {}
        if not node:
            print(f"  FAIL {rel}: no inputsHash — regenerate it")
            bad += 1
            continue
        issues = verify(node)
        print(f"  {'ok  ' if not issues else 'STALE'} {rel}")
        for i in issues:
            print(f"        {i}")
        bad += bool(issues)
    if bad:
        print("  regenerate and commit:  (cd scripts && python3 build-3d-tiles.py) "
              "&& python3 scripts/build-city-indicators.py")
    else:
        print("  committed artefacts match the inputs they were built from")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
