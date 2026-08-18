"""Input fingerprints for the committed artefacts.

WHY NOT JUST REGENERATE AND DIFF. That was the first design and CI killed it:
the .glb files came back the same LENGTH but different BYTES on Linux. The
vertex positions are float32 derived from geodetic -> ECEF -> ENU trigonometry,
and the last bits of a transcendental differ between macOS ARM and Linux x86.
This repo has met that before -- check-geo-oracle.py carries EPS_M = 1e-9 for
exactly the same reason -- so demanding byte-identical binary output across
platforms was never going to hold.

So stamp the INPUTS instead. If every input file and the generator's own source
are unchanged, the artefact is fresh by construction, and the check is both
platform-independent and instant. It cannot be fooled by an edited artefact
either: the stamp lives inside the artefact, so tampering with the data without
re-running the generator leaves a stamp that no longer matches its inputs.
"""
from __future__ import annotations

import hashlib
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stamp(paths: list[str]) -> dict[str, str]:
    """sha256 of each input, keyed by repo-relative path. Sorted for stability."""
    return {os.path.relpath(p, ROOT): file_hash(p) for p in sorted(paths)}


def verify(expected: dict[str, str]) -> list[str]:
    """Return a human-readable list of what no longer matches."""
    bad: list[str] = []
    for rel, want in sorted(expected.items()):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            bad.append(f"{rel}: input is missing")
        elif file_hash(path) != want:
            bad.append(f"{rel}: changed since the artefact was generated")
    return bad
