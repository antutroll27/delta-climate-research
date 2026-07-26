#!/usr/bin/env python3
"""
Build the ECOSTRESS SUHII calibration set for the Kolkata heat map.

    python3 scripts/build-calibration-set.py [--from 2024-01-01] [--to 2026-07-01]
                                             [--max N] [--phase day|night|both]

Sweeps every acquisition in range, measures SUHII per scene, and writes one CSV
row each — including scenes that fail, with the reason. The spec forbids silent
exclusions: a calibration set you cannot audit is not a calibration set.

RESUMABLE. Rows already present in the CSV are skipped, so an interrupted run
picks up where it stopped. Roughly 1.3 GB of COGs over 237 acquisitions, which
will not survive a single uninterrupted session on a domestic connection.

TWO-STAGE BANDS. Stage 1 fetches LST + QC + cloud + water (~1.1 MB per tile).
Stage 2 re-measures scenes that cleared the usability bar with view_zenith
(3.3 MB per tile) attached, so the view-angle control check costs only what the
kept scenes cost rather than what the whole population would.

Output: data/calibration/ecostress-suhii.csv
"""
import argparse, csv, importlib.util, os, sys, time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("suhii", os.path.join(HERE, "ecostress-suhii.py"))
suhii = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(suhii)
census = suhii.census

OUT = os.path.join(HERE, "..", "data", "calibration", "ecostress-suhii.csv")
USABLE_BAR = 0.30          # spec §3: scenes below this are recorded, not measured further

COLUMNS = [
    "date", "phase", "status", "reason", "utc", "local_solar_hour", "month",
    "tiles", "usable_frac", "valid_px", "water_px",
    "urban_mean", "urban_px",
    "rural_strict", "suhii_strict", "rural_+rural", "suhii_+rural", "rural_wide", "suhii_wide",
    "suhii", "suhii_spread",
    "view_urban", "view_rural", "view_delta",
]

SEASON = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM",
          6: "JJAS", 7: "JJAS", 8: "JJAS", 9: "JJAS", 10: "ON", 11: "ON"}


def load_done(path):
    if not os.path.exists(path):
        return {}, []
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    return {(r["date"], r["phase"]) for r in rows}, rows


def write_all(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda x: (x.get("date", ""), x.get("phase", ""))):
            w.writerow(r)


def coverage(rows):
    ok = [r for r in rows if r.get("status") == "ok"]
    grid = Counter()
    for r in ok:
        try:
            grid[(SEASON[int(r["month"])], r["phase"])] += 1
        except (KeyError, ValueError):
            pass
    print("\n  season x phase coverage (usable scenes only)")
    print("       " + "".join(f"{s:>7}" for s in ("DJF", "MAM", "JJAS", "ON")))
    for ph in ("day", "night"):
        print(f"  {ph:<5}" + "".join(f"{grid[(s, ph)]:>7}" for s in ("DJF", "MAM", "JJAS", "ON")))
    return len(ok), sum(1 for r in ok if r["phase"] == "night")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="2024-01-01")
    ap.add_argument("--to", dest="end", default="2026-07-01")
    ap.add_argument("--max", type=int, default=0, help="stop after N new scenes (0 = all)")
    ap.add_argument("--phase", default="both", choices=("day", "night", "both"))
    args = ap.parse_args()

    phases = ("day", "night") if args.phase == "both" else (args.phase,)
    done, rows = load_done(OUT)

    todo = []
    for ph in phases:
        acqs = census.cmr_search(ph, args.start, None, args.end, bbox=suhii.BBOX)
        print(f"  {ph:<6} {len(acqs):>4} acquisitions in range")
        for when, _ in acqs:
            d = when[:10]
            if (d, ph) not in done:
                todo.append((d, ph))
    # one row per (date, phase); several acquisitions can share a date
    todo = sorted(set(todo))
    if args.max:
        todo = todo[:args.max]

    print(f"\n  {len(done)} already recorded · {len(todo)} to measure\n")
    if not todo:
        n_ok, n_night = coverage(rows)
        print(f"\n  {n_ok} usable scenes ({n_night} night)")
        return

    t0 = time.time()
    for i, (d, ph) in enumerate(todo, 1):
        try:
            r = suhii.measure_scene(d, ph, want_view=False)
        except KeyboardInterrupt:
            print("\n  interrupted — progress saved, re-run to resume")
            break
        except Exception as exc:                      # never let one scene kill the sweep
            r = {"date": d, "phase": ph, "status": "error", "reason": str(exc)[:70]}
        if r is None:
            r = {"date": d, "phase": ph, "status": "error", "reason": "returned None"}

        # stage 2: only scenes over the bar pay for the 3.3 MB view_zenith band
        if r.get("status") == "ok" and r.get("usable_frac", 0) >= USABLE_BAR:
            try:
                r2 = suhii.measure_scene(d, ph, want_view=True)
                if r2 and r2.get("status") == "ok":
                    r = r2
            except Exception:
                pass                                   # keep stage-1 row; view fields stay blank
        elif r.get("status") == "ok":
            r["status"] = "skipped"
            r["reason"] = f"usable {r.get('usable_frac', 0):.0%} < {USABLE_BAR:.0%}"

        rows.append(r)
        write_all(OUT, rows)                           # persist every row — resumable
        el = time.time() - t0
        tag = r.get("status")
        extra = f"suhii {r['suhii']:+.2f}" if tag == "ok" else r.get("reason", "")[:34]
        print(f"  [{i:>3}/{len(todo)}] {d} {ph:<5} {tag:<8} {extra:<38} "
              f"{el/i:.0f}s/scene")

    n_ok, n_night = coverage(rows)
    print(f"\n  {n_ok} usable scenes ({n_night} night) of {len(rows)} attempted")
    print(f"  written to {os.path.relpath(OUT, os.path.join(HERE, '..'))}")
    if n_ok < 20:
        print(f"\n  WARNING: spec requires >=20 usable scenes. Widen --from to 2023.")


if __name__ == "__main__":
    main()
