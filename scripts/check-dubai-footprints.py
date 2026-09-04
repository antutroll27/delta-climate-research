"""Footprint rings are the physics boundary. This asserts nothing crossed it.

`fetch-dubai-terrain.py` is the ONLY place building data reaches the flood
solve: it reads the footprint rings and masks buildings out of the DSM so rain
does not pond on rooftops. It reads `p`. It does not read heights, parts or
massing.

So the whole landmark and height programme rests on one rule -- add geometry,
never move a footprint -- and this turns that rule from a promise into a gate.
A baseline of ring hashes is committed alongside the artefact; any drift fails.

    python3 scripts/check-dubai-footprints.py            # verify
    python3 scripts/check-dubai-footprints.py --rebase   # accept a deliberate change
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
BASELINE = os.path.join(DATA, "dubai-footprint-baseline.json")
SITES = ("dubai-creek", "dubai-south")


def ring_digest(doc: dict[str, Any]) -> str:
    """One hash over every ring in the document, in document order.

    Order matters: a reordering would move geometry relative to the height and
    name that sit beside it in the same record, so it is a real change even
    though the set of rings is unchanged.
    """
    h = hashlib.sha256()
    for key in ("b", "osmB", "parts"):
        for rec in doc.get(key, []):
            h.update(b"|")
            for v in rec["p"]:
                h.update(f"{v:.2f}".encode())
    return h.hexdigest()


def digests() -> dict[str, str]:
    out: dict[str, str] = {}
    for sid in SITES:
        path = os.path.join(DATA, f"{sid}-buildings.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            out[sid] = ring_digest(json.load(fh))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebase", action="store_true",
                        help="accept the current footprints as the new baseline")
    args = parser.parse_args()

    now = digests()
    if args.rebase or not os.path.exists(BASELINE):
        with open(BASELINE, "w", encoding="utf-8") as fh:
            json.dump({"note": "sha256 over every footprint ring; see "
                               "scripts/check-dubai-footprints.py",
                       "digests": now}, fh, indent=2)
            fh.write("\n")
        print(f"  baseline written for {len(now)} site(s)")
        return 0

    with open(BASELINE, encoding="utf-8") as fh:
        want: dict[str, str] = json.load(fh)["digests"]

    failures = []
    for sid, digest in now.items():
        if sid not in want:
            failures.append(f"{sid}: no baseline -- run --rebase if this site is new")
        elif want[sid] != digest:
            failures.append(f"{sid}: FOOTPRINTS MOVED. The flood solve reads these rings.")
    for sid in want:
        if sid not in now:
            failures.append(f"{sid}: artefact missing but baselined")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    print(f"  footprints unchanged across {len(now)} site(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
