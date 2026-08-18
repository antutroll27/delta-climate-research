#!/usr/bin/env python3
"""Validate the built CityJSON exports against the OFFICIAL CityJSON 2.0 schema.

Our unit tests prove the export is INTERNALLY consistent -- vertex indices in
range, one Building per row, rings closed. They cannot prove it CONFORMS. Only
the specification's own schema can, and the first time it was run it rejected
two things no internal test would ever notice: `metadata` is a CLOSED object
(six keys) so `metadata.lineage` was illegal, and `pointOfContact` requires an
`emailAddress`. Both were fixed; this script exists so they stay fixed.

The schema and its five sub-schemas are pinned to the 2.0.0 tag and cached under
~/.cache/delta-climate/cityjson-schema/. They $ref each other by bare filename,
so each is registered under both the bare name and its canonical cityjson.org
URL. Draft-7.

    python3 scripts/check-cityjson-schema.py            # validates dist/api/wards/*/cityjson.json
    python3 scripts/check-cityjson-schema.py path.json  # validates one file
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
from typing import Any

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CACHE = os.path.expanduser("~/.cache/delta-climate/cityjson-schema")
TAG = "2.0.0"
FILES = ("cityjson", "appearance", "cityobjects", "geomprimitives", "geomtemplates", "metadata")
RAW = f"https://raw.githubusercontent.com/cityjson/specs/{TAG}/schemas/"
CANON = f"https://www.cityjson.org/schemas/{TAG}/"


def fetch_schemas() -> None:
    os.makedirs(CACHE, exist_ok=True)
    for name in FILES:
        path = os.path.join(CACHE, f"{name}.schema.json")
        if os.path.exists(path) and os.path.getsize(path) > 100:
            continue
        subprocess.run(["curl", "-sL", "-m", "60", "-o", path, f"{RAW}{name}.schema.json"], check=True)
        with open(path, encoding="utf-8") as fh:
            head = fh.read(20)
        if not head.lstrip().startswith("{"):
            os.remove(path)
            raise SystemExit(f"  schema fetch failed for {name}: {head!r}")


def validator() -> jsonschema.protocols.Validator:
    fetch_schemas()
    reg = Registry()
    for name in FILES:
        with open(os.path.join(CACHE, f"{name}.schema.json"), encoding="utf-8") as fh:
            doc = json.load(fh)
        for uri in (f"{name}.schema.json", f"{CANON}{name}.schema.json"):
            reg = reg.with_resource(uri, Resource.from_contents(doc, default_specification=DRAFT7))
    with open(os.path.join(CACHE, "cityjson.schema.json"), encoding="utf-8") as fh:
        main = json.load(fh)
    cls = jsonschema.validators.validator_for(main)
    return cls(main, registry=reg)


def run_cjval(paths: list[str]) -> int:
    """Run the REFERENCE validator too, when it is on PATH.

    The JSON Schema and cjval do NOT check the same things, and neither is a
    superset. The schema accepted an undeclared `+delta_lineage` root property
    that cjval rejected outright -- and cjval aborts on that error, so every
    geometry check after it was silently SKIPPED while we read "schema valid" as
    though geometry had been audited. Going the other way, cjval accepted an
    extension version of '1.0.0' that the schema rejects, because the schema pins
    it to MAJOR.MINOR. Each caught a real defect the other missed.

    cjval is a Rust binary (`cargo install cjval --features build-binary`), so it
    cannot be assumed present in CI. When it is missing this reports that fact
    rather than passing quietly -- an absent check must never read as a clean one.
    """
    exe = shutil.which("cjval") or os.path.expanduser("~/.cargo/bin/cjval")
    if not os.path.exists(exe):
        print("  cjval not installed — reference validation SKIPPED (not passed).")
        print("  install: cargo install cjval --features build-binary")
        return 0
    ext = os.path.join(ROOT, "dist", "api", "cityjson", "delta-lineage.ext.json")
    bad = 0
    for p in paths:
        cmd = [exe, "--summary"] + (["-e", ext] if os.path.exists(ext) else []) + [p]
        out = subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
        ok = "valid" in out.lower() and "invalid" not in out.lower()
        print(f"  {'ok  ' if ok else 'FAIL'} cjval {os.path.relpath(p, ROOT):<44} {out[:60]}")
        bad += not ok
    return bad


def main(argv: list[str]) -> int:
    paths = argv[1:] or sorted(glob.glob(os.path.join(ROOT, "dist", "api", "wards", "*", "cityjson.json")))
    if not paths:
        print("  no CityJSON files found — run `npm run build` first")
        return 1
    v = validator()
    print(f"  CityJSON {TAG} official schema · {len(FILES)} sub-schemas · Draft-7\n")
    bad = 0
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            doc: dict[str, Any] = json.load(fh)
        errs = sorted(v.iter_errors(doc), key=lambda e: list(e.path))
        rel = os.path.relpath(p, ROOT)
        n_obj = len(doc.get("CityObjects", {}))
        n_v = len(doc.get("vertices", []))
        print(f"  {'ok  ' if not errs else 'FAIL'} {rel:<44} {n_obj:>5} objects {n_v:>6} vertices")
        for e in errs[:6]:
            print(f"        {'/'.join(map(str, e.path)) or '<root>'}: {e.message[:140]}")
        bad += bool(errs)
    print()
    print("  ALL VALID against the CityJSON 2.0 schema" if not bad else f"  {bad} file(s) FAIL schema validation")
    bad += run_cjval(paths)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
