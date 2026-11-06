"""Freeze guard: Kolkata and Bengaluru must stay byte-identical while new cities land.

WHY THIS EXISTS. The plan for cities three and up (Amsterdam, then Tokyo) adds
files beside the two existing cities and edits one shared file
(`public/heat-map/data/surface-meta.json`, which gains a row per city). The
existing pipelines are FROZEN on purpose: the Bengaluru Overture release that
produced them is gone from the bucket, so a refactor cannot be proved harmless by
re-running it. What can be proved is that nothing they produced has moved. This
script hashes every artefact of the two existing cities at `origin/main` and, in
its default mode, fails and names every file that no longer matches.

WHAT IS FROZEN (relative to the repo root):

    public/heat-map/data/{ballygunge,baruipur,barrackpore,indiranagar,mg-road,whitefield}*
    public/heat-map/models/*.glb
    data/geometry/**   data/bangalore/*.json   data/dc-urs/**   data/calibration/**

`public/heat-map/data/surface-meta.json` is NOT hashed whole, because every new
city adds a row to it. It is compared PER WARD KEY: each row that existed at the
baseline must be unchanged (rows may be added, never edited or removed) and every
top-level key except `wards` must be unchanged.

    python3 scripts/check-existing-cities-unchanged.py                  # compare
    python3 scripts/check-existing-cities-unchanged.py --write-baseline # re-pin
    python3 scripts/check-existing-cities-unchanged.py --self-test

`--write-baseline` reads the blobs with `git cat-file` from `origin/main`, NOT from
the working tree, so a baseline can never be pinned to an edit that is already in
the tree. Re-pin deliberately, in its own commit, when main legitimately changes
a frozen artefact; never to make a failing run pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import NamedTuple, TypedDict, cast

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
BASELINE_REL = "data/baselines/existing-cities.sha256.json"
BASELINE_REF = "origin/main"

SURFACE_META_REL = "public/heat-map/data/surface-meta.json"
#: The one shared file that new cities append to. Compared per key, never whole.
WARDS_KEY = "wards"

EXISTING_WARDS = ("ballygunge", "baruipur", "barrackpore", "indiranagar", "mg-road", "whitefield")

#: Glob syntax: `*` stays inside one path segment, `**` crosses segments.
FROZEN_PATTERNS: tuple[str, ...] = (
    *(f"public/heat-map/data/{w}*" for w in EXISTING_WARDS),
    "public/heat-map/models/*.glb",
    "data/geometry/**",
    "data/bangalore/*.json",
    "data/dc-urs/**",
    "data/calibration/**",
)


class SurfaceMetaPins(TypedDict):
    """Hashes of the parts of surface-meta.json that must not move."""
    topLevel: dict[str, str]
    wards: dict[str, str]


class Baseline(TypedDict):
    schema: int
    ref: str
    commit: str
    note: str
    fileCount: int
    files: dict[str, str]
    surfaceMeta: SurfaceMetaPins


class Problem(NamedTuple):
    kind: str          # "changed" | "missing" | "unexpected" | "surface-meta"
    path: str
    detail: str


# ── glob matching ──────────────────────────────────────────────────────────

def _glob_to_re(pattern: str) -> re.Pattern[str]:
    """`**` crosses '/', `*` does not. Anchored at both ends."""
    out: list[str] = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


_FROZEN_RES = tuple(_glob_to_re(p) for p in FROZEN_PATTERNS)


def is_frozen(rel: str) -> bool:
    return rel != SURFACE_META_REL and any(r.match(rel) for r in _FROZEN_RES)


# ── hashing ────────────────────────────────────────────────────────────────

def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canonical(obj: object) -> str:
    """Key order and whitespace must not make two equal rows look different."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def surface_meta_pins(raw: bytes) -> SurfaceMetaPins:
    doc = cast("dict[str, object]", json.loads(raw))
    wards = cast("dict[str, object]", doc.get(WARDS_KEY, {}))
    return SurfaceMetaPins(
        topLevel={k: sha256_bytes(canonical(v).encode()) for k, v in doc.items() if k != WARDS_KEY},
        wards={k: sha256_bytes(canonical(v).encode()) for k, v in wards.items()},
    )


# ── reading the two worlds ─────────────────────────────────────────────────

def _git(root: str, *args: str, stdin: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-C", root, *args], input=stdin, check=True,
                          capture_output=True).stdout


def baseline_from_git(root: str, ref: str) -> Baseline:
    """Hash every frozen blob as it is at `ref`. Never touches the working tree."""
    commit = _git(root, "rev-parse", ref).decode().strip()
    listing = _git(root, "ls-tree", "-r", "-z", ref).decode("utf-8", "surrogateescape")
    blobs: dict[str, str] = {}     # path -> blob id
    for entry in listing.split("\0"):
        if not entry:
            continue
        meta, path = entry.split("\t", 1)
        _mode, kind, blob = meta.split(" ")
        if kind == "blob" and (is_frozen(path) or path == SURFACE_META_REL):
            blobs[path] = blob
    if SURFACE_META_REL not in blobs:
        raise SystemExit(f"{SURFACE_META_REL} is not in {ref}")

    stream = _git(root, "cat-file", "--batch", stdin=("\n".join(blobs.values()) + "\n").encode())
    contents: dict[str, bytes] = {}
    pos = 0
    for path, blob in blobs.items():
        nl = stream.index(b"\n", pos)
        head = stream[pos:nl].decode().split(" ")
        if head[0] != blob or head[1] != "blob":
            raise SystemExit(f"git cat-file desync at {path}: {head}")
        size = int(head[2])
        contents[path] = stream[nl + 1: nl + 1 + size]
        pos = nl + 1 + size + 1

    files = {p: sha256_bytes(b) for p, b in sorted(contents.items()) if p != SURFACE_META_REL}
    return Baseline(
        schema=1, ref=ref, commit=commit,
        note="sha256 of every frozen artefact as it is at `commit`; see scripts/check-existing-cities-unchanged.py",
        fileCount=len(files), files=files,
        surfaceMeta=surface_meta_pins(contents[SURFACE_META_REL]),
    )


def list_working_files(root: str) -> list[str]:
    """Tracked + untracked-but-not-ignored files, so a stray new file is seen."""
    out = _git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    return sorted({p for p in out.decode("utf-8", "surrogateescape").split("\0") if p})


def hash_working_tree(root: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for rel in list_working_files(root):
        if not is_frozen(rel):
            continue
        full = os.path.join(root, rel)
        if os.path.isfile(full):
            with open(full, "rb") as fh:
                result[rel] = sha256_bytes(fh.read())
    return result


# ── comparison ─────────────────────────────────────────────────────────────

def compare_files(baseline: dict[str, str], current: dict[str, str]) -> list[Problem]:
    problems: list[Problem] = []
    for path, digest in baseline.items():
        if path not in current:
            problems.append(Problem("missing", path, "in the baseline, absent from the working tree"))
        elif current[path] != digest:
            problems.append(Problem("changed", path, f"{digest[:12]} -> {current[path][:12]}"))
    for path in current:
        if path not in baseline:
            problems.append(Problem("unexpected", path, "matches a frozen pattern but is not in the baseline"))
    return problems


def compare_surface_meta(pins: SurfaceMetaPins, raw: bytes) -> list[Problem]:
    now = surface_meta_pins(raw)
    problems: list[Problem] = []
    for key, digest in pins["topLevel"].items():
        if key not in now["topLevel"]:
            problems.append(Problem("surface-meta", SURFACE_META_REL, f"top-level key '{key}' removed"))
        elif now["topLevel"][key] != digest:
            problems.append(Problem("surface-meta", SURFACE_META_REL, f"top-level key '{key}' changed"))
    for ward, digest in pins["wards"].items():
        if ward not in now["wards"]:
            problems.append(Problem("surface-meta", SURFACE_META_REL, f"ward row '{ward}' removed"))
        elif now["wards"][ward] != digest:
            problems.append(Problem("surface-meta", SURFACE_META_REL, f"ward row '{ward}' changed"))
    return problems


def check(root: str, baseline: Baseline) -> list[Problem]:
    problems = compare_files(baseline["files"], hash_working_tree(root))
    meta = os.path.join(root, SURFACE_META_REL)
    if not os.path.isfile(meta):
        problems.append(Problem("missing", SURFACE_META_REL, "absent from the working tree"))
    else:
        with open(meta, "rb") as fh:
            problems += compare_surface_meta(baseline["surfaceMeta"], fh.read())
    return problems


def load_baseline(root: str) -> Baseline:
    path = os.path.join(root, BASELINE_REL)
    if not os.path.isfile(path):
        raise SystemExit(f"missing {BASELINE_REL} -- run with --write-baseline on a clean origin/main checkout")
    with open(path, encoding="utf-8") as fh:
        return cast(Baseline, json.load(fh))


def report(problems: list[Problem]) -> None:
    print(f"FAIL: {len(problems)} frozen-city problem(s):")
    for p in problems:
        print(f"  {p.kind:12s} {p.path}  ({p.detail})")


# ── self-test ──────────────────────────────────────────────────────────────

def _write(root: str, rel: str, data: bytes) -> None:
    full = os.path.join(root, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as fh:
        fh.write(data)


def self_test() -> None:
    """Mutate a copy, never the real tree: a temp dir UNDER the worktree (so the
    mount matches), deleted on the way out."""
    tmp = tempfile.mkdtemp(prefix=".freeze-selftest-", dir=ROOT)
    try:
        subprocess.run(["git", "init", "-q", tmp], check=True)
        meta = {"source": "s", "veg_range": [0, 1], WARDS_KEY: {"ballygunge": {"grid": 180}, "mg-road": {"grid": 384}}}
        _write(tmp, "public/heat-map/data/ballygunge.json", b'{"b":[1,2,3]}')
        _write(tmp, "public/heat-map/data/amsterdam-not-frozen.json", b"new city, ignored")
        _write(tmp, "public/heat-map/models/mg-road.glb", b"glb-bytes")
        _write(tmp, "data/bangalore/mg-road-buildings.json", b"[]")
        _write(tmp, "data/bangalore/scenes/big.json", b"not matched by data/bangalore/*.json")
        _write(tmp, "data/calibration/deep/dir/x.csv", b"1,2")
        _write(tmp, SURFACE_META_REL, json.dumps(meta).encode())
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True)
        subprocess.run(["git", "-C", tmp, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"],
                       check=True)
        base = baseline_from_git(tmp, "HEAD")
        assert base["fileCount"] == 4 + 0, base["files"]   # json, glb, bangalore json, calibration csv
        assert "data/bangalore/scenes/big.json" not in base["files"]
        assert "public/heat-map/data/amsterdam-not-frozen.json" not in base["files"]
        assert check(tmp, base) == [], "clean tree must pass"

        # a new city's row in surface-meta is allowed
        meta2 = json.loads(json.dumps(meta))
        meta2[WARDS_KEY]["canal-ring"] = {"grid": 280}
        _write(tmp, SURFACE_META_REL, json.dumps(meta2, indent=2).encode())
        assert check(tmp, base) == [], "an added ward row (and reformatting) must pass"
        # editing an existing row, or a top-level key, must fail
        meta3 = json.loads(json.dumps(meta2))
        meta3[WARDS_KEY]["mg-road"]["grid"] = 383
        _write(tmp, SURFACE_META_REL, json.dumps(meta3).encode())
        assert [p.detail for p in check(tmp, base)] == ["ward row 'mg-road' changed"]
        meta4 = json.loads(json.dumps(meta2))
        meta4["veg_range"] = [0, 2]
        _write(tmp, SURFACE_META_REL, json.dumps(meta4).encode())
        assert [p.detail for p in check(tmp, base)] == ["top-level key 'veg_range' changed"]
        del meta4[WARDS_KEY]["ballygunge"]
        meta4["veg_range"] = [0, 1]
        _write(tmp, SURFACE_META_REL, json.dumps(meta4).encode())
        assert [p.detail for p in check(tmp, base)] == ["ward row 'ballygunge' removed"]
        _write(tmp, SURFACE_META_REL, json.dumps(meta).encode())

        # one flipped byte in a frozen file fails and names the file
        target = "public/heat-map/models/mg-road.glb"
        _write(tmp, target, b"glb-bytez")
        got = check(tmp, base)
        assert [(p.kind, p.path) for p in got] == [("changed", target)], got
        _write(tmp, target, b"glb-bytes")
        assert check(tmp, base) == [], "restoring the byte must pass again"

        # deletion and a stray new file both fail
        os.remove(os.path.join(tmp, "data/bangalore/mg-road-buildings.json"))
        _write(tmp, "data/calibration/new.csv", b"3")
        got = check(tmp, base)
        assert sorted((p.kind, p.path) for p in got) == [
            ("missing", "data/bangalore/mg-road-buildings.json"),
            ("unexpected", "data/calibration/new.csv"),
        ], got
        print("check-existing-cities-unchanged self-test: ok (clean, +row, edited row, edited key, removed row, "
              "flipped byte, deleted file, stray file)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── entry ──────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0] if __doc__ else None)
    ap.add_argument("--write-baseline", action="store_true",
                    help=f"hash the frozen artefacts at {BASELINE_REF} and write {BASELINE_REL}")
    ap.add_argument("--self-test", action="store_true", help="exercise the guard on a mutated temp copy")
    args = ap.parse_args(argv)

    if args.self_test:
        self_test()
        return 0
    if args.write_baseline:
        base = baseline_from_git(ROOT, BASELINE_REF)
        out = os.path.join(ROOT, BASELINE_REL)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(base, fh, indent=1, sort_keys=True)
            fh.write("\n")
        print(f"wrote {BASELINE_REL}: {base['fileCount']} files + surface-meta "
              f"({len(base['surfaceMeta']['wards'])} ward rows, {len(base['surfaceMeta']['topLevel'])} top-level keys) "
              f"at {BASELINE_REF} = {base['commit'][:12]}")
        return 0

    base = load_baseline(ROOT)
    problems = check(ROOT, base)
    if problems:
        report(problems)
        return 1
    print(f"ok: {base['fileCount']} frozen files + {len(base['surfaceMeta']['wards'])} surface-meta rows "
          f"match the baseline taken at {base['commit'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
