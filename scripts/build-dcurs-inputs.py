#!/usr/bin/env python3
"""
Assemble every measured DC-URS indicator into one auditable record per ward.

    python3 scripts/build-dcurs-inputs.py

Reads the per-source outputs produced by the Phase 1 and Phase 2 scripts and
emits `data/dc-urs/inputs.json` — the single file the engine consumes.

    far.json        FAR                             compute-far.py
    tra.json        TRA                             compute-tra.py
    sentinel.json   FVC, NDVI mean/sigma, albedo    fetch-sentinel-composites.py
    ecostress       LST day/night, rural base       the existing calibration set
    worldpop.json   population density              fetch-worldpop.py       (P2)
    socio.json      HVI_socio                       fetch-socio.py          (P2)

EVERY FIELD CARRIES ITS OWN PROVENANCE AND VINTAGE. They land at wildly
different times and from very different places — this morning's satellite pass
sits next to a 2011 census — and a single ward-level "source" label would
flatten that. Missing Phase 2 inputs are written as `placeholder`, never
silently defaulted, and the summary prints what is still missing so an
incomplete record cannot be mistaken for a complete one.

Output: data/dc-urs/inputs.json
"""
import csv, json, os, statistics, sys
from typing import TypedDict, cast

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _types import (WARDS, DcUrsInputsFile, DcUrsWard, FarFile, MetRow, PopFile,
                    Provenance, SentinelFile, SocioFile, Sourced, TraFile)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
D = os.path.join(ROOT, "data", "dc-urs")
CAL = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
OUT = os.path.join(D, "inputs.json")

VIEW_CUT = 0.75          # near-nadir only, matching the thermal calibration


class Lst(TypedDict):
    day: float
    night: float
    rural: float
    scenes: int


def load[T](name: str) -> T | None:
    """Read one data/dc-urs file, or None if it has not been produced yet.

    ABSENT AND CORRUPT ARE DIFFERENT ANSWERS. A missing file is the ordinary
    "Phase 2 has not run yet" case and returns None, which the caller reports as
    a placeholder. A file that exists but does not parse is a broken artefact,
    and letting json raise a bare JSONDecodeError here names no filename and
    fires before the caller's own "Phase 1 incomplete" message can run — so it
    is caught and reported against the file it came from.

    The cast is an assertion, not a validation: see the note in _types.py.
    """
    p = os.path.join(D, name)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        try:
            return cast(T, json.load(fh))
        except json.JSONDecodeError as e:
            sys.exit(f"{os.path.relpath(p, ROOT)} exists but is not valid JSON "
                     f"(line {e.lineno}, column {e.colno}: {e.msg}). Re-run the script "
                     f"that produces it; a truncated file is not a missing file.")


def sourced[T](value: T, source: Provenance, vintage: str | None = None,
               cite: str | None = None) -> Sourced[T]:
    """One indicator with its provenance attached.

    `is not None`, not truthiness: an empty-string vintage is a legitimate value
    and a truthiness test would silently drop it, which is precisely the kind of
    quiet omission this file exists to prevent.
    """
    d: Sourced[T] = {"value": value, "source": source}
    if vintage is not None:
        d["vintage"] = vintage
    if cite is not None:
        d["cite"] = cite
    return d


def lst_from_calibration() -> Lst | None:
    """
    Day and night surface temperature, and the rural reference.

    These come from the SAME near-nadir ECOSTRESS scenes the thermal model was
    validated against, so DC-URS and the heat map describe the same ground and
    the same acquisitions. The measurement is bbox-wide rather than per-ward —
    ECOSTRESS at 70 m over a 1400 m ward is only ~20x20 pixels, too few to
    separate the wards reliably — so all three share the urban figure. Recorded
    as a KNOWN LIMITATION rather than presented as a per-ward measurement.
    """
    if not os.path.exists(CAL):
        return None
    with open(CAL, newline="") as fh:
        rows = [r for r in cast(list[MetRow], list(csv.DictReader(fh)))
                if float(r["view_delta"]) <= VIEW_CUT]
    if not rows:
        return None
    day = [float(r["urban_mean"]) for r in rows if r["phase"] == "day"]
    night = [float(r["urban_mean"]) for r in rows if r["phase"] == "night"]
    rural = [float(r["rural_strict"]) for r in rows if r["phase"] == "day" and r["rural_strict"]]
    if not (day and night and rural):
        return None
    return {
        "day": round(statistics.median(day), 2),
        "night": round(statistics.median(night), 2),
        "rural": round(statistics.median(rural), 2),
        "scenes": len(rows),
    }


def main() -> None:
    far: FarFile | None = load("far.json")
    tra: TraFile | None = load("tra.json")
    sen: SentinelFile | None = load("sentinel.json")
    pop: PopFile | None = load("worldpop.json")
    socio: SocioFile | None = load("socio.json")
    lst = lst_from_calibration()

    missing_sources = [n for n, v in
                       (("far.json", far), ("tra.json", tra), ("sentinel.json", sen)) if v is None]
    if missing_sources:
        sys.exit(f"Phase 1 incomplete — missing {', '.join(missing_sources)}. "
                 f"Run the corresponding scripts first.")

    out: DcUrsInputsFile = {
        "generated": "build-dcurs-inputs.py",
        "engine": "v1 — see docs/dc-urs-source-of-truth.md",
        "note": "Every field carries source and vintage. 'placeholder' means NOT YET MEASURED "
                "and must not reach production.",
        "known_limitations": [
            "LST day/night and the rural reference are bbox-wide, not per-ward: ECOSTRESS at "
            "70 m gives only ~20x20 pixels over a 1400 m ward, too few to separate the three "
            "wards reliably. All three currently share the urban figure, so the thermal pillar "
            "does not yet discriminate between them.",
        ],
        "wards": {},
    }

    for w in WARDS:
        f = far["wards"].get(w) if far else None
        t = tra["wards"].get(w) if tra else None
        s = sen["wards"].get(w) if sen else None
        # .get, not [w], for pop and socio too. Indexing them directly raised an
        # unlabelled KeyError for a file that exists but is missing this ward —
        # after the careful "Phase 1 incomplete" check above had already passed,
        # so the one message designed to explain a partial pipeline never ran.
        # A ward absent from a present file is a placeholder, like any other
        # unmeasured value.
        p = pop["wards"].get(w) if pop else None
        so = socio["wards"].get(w) if socio else None
        if not (f and t and s):
            print(f"  {w}: SKIPPED — missing "
                  f"{', '.join(n for n, v in (('far', f), ('tra', t), ('sentinel', s)) if not v)}")
            continue

        rec: DcUrsWard = {
            # ── Thermal Hazard ────────────────────────────────────────────
            "lstDayC": sourced(lst["day"] if lst else 0, "measured" if lst else "placeholder",
                               "2024-2026", "NASA ECOSTRESS L2T LSTE v002"),
            "lstNightC": sourced(lst["night"] if lst else 0, "measured" if lst else "placeholder",
                                 "2024-2026", "NASA ECOSTRESS L2T LSTE v002"),
            "ruralBaseC": sourced(lst["rural"] if lst else 0, "measured" if lst else "placeholder",
                                  "2024-2026", "ECOSTRESS urban-rural, GHS-SMOD masks"),
            # ── Exposure & Sensitivity ────────────────────────────────────
            "popDensity": sourced(p["density"] if p else 0,
                                  "measured" if p else "placeholder",
                                  pop["vintage"] if pop and p else None, "WorldPop"),
            "far": sourced(f["far"], "measured", "2023-2025",
                           "MS footprints + Google Open Buildings 2.5D"),
            "socioVuln": sourced(so["hvi"] if so else 0,
                                 "measured" if so else "placeholder",
                                 socio["vintage"] if socio and so else None,
                                 "NFHS-5 levels x Census 2011 pattern"),
            # ── Adaptive Capacity ─────────────────────────────────────────
            "fvc": sourced(s["fvc"], "measured", f"{s['years']} yr", "Sentinel-2 L2A"),
            "canopyFrac": sourced(0.0, "placeholder", None,
                                  "v2 only — inert in the v1 greenness formula"),
            "ndviMean": sourced(s["ndvi_mean"], "measured", f"{s['years']} yr", "Sentinel-2 L2A"),
            # ndviStd was the only measured field shipped without a cite, in a
            # file whose entire purpose is per-field provenance — and it put its
            # method description in the vintage slot, so the vintage read
            # "5 yr across annual medians" while every neighbour read "5 yr".
            "ndviStd": sourced(s["ndvi_std"], "measured", f"{s['years']} yr",
                               "Sentinel-2 L2A, across-year std of annual medians"),
            "albedo": sourced(s["albedo"], "measured", f"{s['years']} yr",
                              "Sentinel-2, source doc §3B coefficients"),
            "distCoolM": sourced(t["median_dist_m"], "measured", "2021",
                                 "ESA WorldCover, patches >= 0.77 ha"),
            # TRA is already distance-decayed in tra.json; the engine recomputes it
            # from distCoolM so the formula stays in one place.
        }
        out["wards"][w] = rec

    if not out["wards"]:
        sys.exit("no ward assembled")

    os.makedirs(D, exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)

    # report, loudly, what is not yet measured
    print(f"  {'ward':<14}{'measured':>10}{'placeholder':>13}")
    still: set[str] = set()
    for wid, ward_rec in out["wards"].items():
        # A TypedDict's .values() is typed `object`, since in general its values
        # differ per key. Here every one of the twelve is a Sourced[float], so
        # say that once rather than at each use.
        fields = cast(dict[str, Sourced[float]], ward_rec)
        measured = len([v for v in fields.values() if v["source"] == "measured"])
        placeholders = [k for k, v in fields.items() if v["source"] == "placeholder"]
        still.update(placeholders)
        print(f"  {wid:<14}{measured:>10}{len(placeholders):>13}")
    print(f"\n  still placeholder: {', '.join(sorted(still)) or 'none'}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")
    if still - {"canopyFrac"}:
        print("\n  NOT READY FOR PHASE 4 — placeholders other than canopyFrac remain.")


if __name__ == "__main__":
    main()
