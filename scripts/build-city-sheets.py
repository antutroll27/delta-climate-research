"""The whole-city batch: build every shipping sheet of Amsterdam, resumably (city-streaming P2b).

    taskpolicy -b nice python3 scripts/build-city-sheets.py                    # every shipping sheet except E4
    taskpolicy -b nice python3 scripts/build-city-sheets.py --sheets F4,G3     # some of them
    taskpolicy -b nice python3 scripts/build-city-sheets.py --e4-identity      # E4 through the sheet path -> scratch; byte-compare with Canal Ring
    taskpolicy -b nice python3 scripts/build-city-sheets.py --e4-new           # E4 with the ground repair + reprojected surface -> scratch
    python3 scripts/build-city-sheets.py --report                              # cross-sheet checks on what is built (G9a on emitted rows, seams)

E4 is Canal Ring, whose committed files are frozen, so E4 is only ever built into scratch: `--e4-identity` is the batch's own regression
test (the PLAN: "E4 re-emitted by the batch must be byte-identical") and `--e4-new` is the founder's preview of the two decided-pending
fixes. The other sheets write `data/cities/amsterdam/<id>-<layer>.json` and `<id>/`, and `public/heat-map/data/<id>*` (UNTRACKED; nothing
here commits them: founder D7 decides gzipped-in-repo versus off-repo).

RESUMABLE: a sheet with `<data>/<id>/build.json` is skipped unless --force; every file is written atomically. A sheet that raises is
recorded and the batch goes on. The batch stops cleanly before a sheet if the volume has less than --min-free-gib free.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _city  # noqa: E402
import _sheet_build as sb  # noqa: E402
import _sheets  # noqa: E402

SCRATCH = "/Volumes/OBOSLab/tmp/p2b/scratch"
E4_IDENTITY = "/Volumes/OBOSLab/tmp/p2b/e4-sheet-path"
E4_NEW = "/Volumes/OBOSLab/tmp/p2b/e4-reprojected"
VOLUME = "/Volumes/OBOSLab"
COMMITTED_LAYERS = ("buildings", "context", "canopy", "terrain")


def free_gib() -> float:
    s = os.statvfs(VOLUME)
    return s.f_bavail * s.f_frsize / 2**30


def committed_retrieved() -> str:
    with open(os.path.join(_city.data_dir("amsterdam"), "canal-ring-buildings.json"), encoding="utf-8") as fh:
        return str(json.load(fh)["retrieved"])


def compare_committed(out: sb.SheetOut) -> dict[str, str]:
    """E4 through the sheet path versus Canal Ring's committed files, byte for byte."""
    res: dict[str, str] = {}
    for layer in COMMITTED_LAYERS:
        a = os.path.join(out.data, f"canal-ring-{layer}.json")
        b = os.path.join(_city.data_dir("amsterdam"), f"canal-ring-{layer}.json")
        with open(a, "rb") as fa, open(b, "rb") as fb:
            x, y = fa.read(), fb.read()
        res[layer] = "IDENTICAL" if x == y else f"DIFFERS ({len(x)} vs {len(y)} bytes)"
    return res


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheets", default="all", help="comma-separated codes (E4 excluded unless named with an --e4 flag), or 'all'")
    ap.add_argument("--e4-identity", action="store_true")
    ap.add_argument("--e4-new", action="store_true")
    ap.add_argument("--no-repair", action="store_true", help="skip the 3D BAG ground plausibility repair")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--min-free-gib", type=float, default=4.5)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args(argv)
    table = _sheets.load_table()
    today = datetime.date.today().isoformat()

    if args.report:
        return report(table)

    jobs: list[tuple[str, sb.SheetOut, sb.SheetOptions]] = []
    if args.e4_identity:
        jobs.append(("E4", sb.SheetOut(E4_IDENTITY, os.path.join(E4_IDENTITY, "public"), SCRATCH),
                     sb.SheetOptions(repair_ground=False, surface="none", retrieved=committed_retrieved(), legacy_chm=True)))
    if args.e4_new:
        jobs.append(("E4", sb.SheetOut(E4_NEW, os.path.join(E4_NEW, "public"), SCRATCH),
                     sb.SheetOptions(repair_ground=True, surface="reprojected", retrieved=committed_retrieved())))
    if not jobs:
        want = [s["code"] for s in table["sheets"] if s["code"] != "E4"] if args.sheets == "all" else args.sheets.split(",")
        known = {s["code"] for s in table["sheets"]}
        for c in want:
            if c not in known:
                ap.error(f"{c} is not a shipping sheet")
            if c == "E4":
                ap.error("E4 is Canal Ring: use --e4-identity / --e4-new (its committed files are never overwritten)")
        out = sb.SheetOut(_city.data_dir("amsterdam"), _city.PUBLIC, SCRATCH)
        jobs = [(c, out, sb.SheetOptions(repair_ground=not args.no_repair)) for c in want]

    shared = sb.Shared(SCRATCH)
    print(f"VRTs over {shared.vrts.ahn_files} AHN blocks + 2 CHM tiles; {len(shared.index)} 3D BAG tiles indexed; "
          f"{free_gib():.1f} GiB free", flush=True)
    failures: list[str] = []
    for code, out, opt in jobs:
        i, j = _sheets.ij_of(code)
        area = _sheets.sheet_area(i, j)
        marker = os.path.join(out.data, area.id, "build.json")
        if os.path.isfile(marker) and not args.force:
            print(f"{code} ({area.id}): done, skipping", flush=True)
            continue
        if free_gib() < args.min_free_gib:
            print(f"STOP before {code}: {free_gib():.1f} GiB free < {args.min_free_gib} GiB. Re-run to resume.", flush=True)
            return 3
        print(f"{code} ({area.id}) start; {free_gib():.1f} GiB free", flush=True)
        try:
            rec = sb.build_sheet(area, out, shared, opt, today)
        except Exception as ex:                      # one sheet's failure must not stop the other 30
            traceback.print_exc()
            failures.append(f"{code}: {type(ex).__name__}: {ex}")
            continue
        sb.write_json(marker, rec)
        bad = [g["id"] for g in rec["guards"] if g["status"] == "fail"]
        print(f"{code} done in {rec['wallSeconds']}s: {rec['counts']['buildings']} buildings, {rec['counts']['trees']} trees, "
              f"guards {' '.join(g['id'] + ':' + g['status'] for g in rec['guards'])}" + (f"  FAILED {bad}" if bad else ""), flush=True)
        if args.e4_identity:
            cmp = compare_committed(out)
            print("  E4 sheet path vs Canal Ring's committed files:", cmp, flush=True)
            sb.write_json(os.path.join(out.data, "identity.json"), cmp)
        shutil.rmtree(os.path.join(SCRATCH, area.id), ignore_errors=True)
    if failures:
        print("\nFAILURES:\n  " + "\n  ".join(failures))
        return 1
    return 0


def report(table: _sheets.SheetTable) -> int:
    return sb.cross_checks(table)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
