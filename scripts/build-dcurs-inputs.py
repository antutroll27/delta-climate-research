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

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
D = os.path.join(ROOT, "data", "dc-urs")
CAL = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
OUT = os.path.join(D, "inputs.json")

WARDS = ["ballygunge", "baruipur", "barrackpore"]
VIEW_CUT = 0.75          # near-nadir only, matching the thermal calibration


def load(name: str):
    p = os.path.join(D, name)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        return json.load(fh)


def lst_from_calibration() -> dict | None:
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
        rows = [r for r in csv.DictReader(fh) if float(r["view_delta"]) <= VIEW_CUT]
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


def main():
    far, tra, sen = load("far.json"), load("tra.json"), load("sentinel.json")
    pop, socio = load("worldpop.json"), load("socio.json")
    lst = lst_from_calibration()

    missing_sources = [n for n, v in
                       (("far.json", far), ("tra.json", tra), ("sentinel.json", sen)) if v is None]
    if missing_sources:
        sys.exit(f"Phase 1 incomplete — missing {', '.join(missing_sources)}. "
                 f"Run the corresponding scripts first.")

    out = {
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
        if not (f and t and s):
            print(f"  {w}: SKIPPED — missing "
                  f"{', '.join(n for n, v in (('far', f), ('tra', t), ('sentinel', s)) if not v)}")
            continue

        def sourced(value, source, vintage=None, cite=None):
            d = {"value": value, "source": source}
            if vintage:
                d["vintage"] = vintage
            if cite:
                d["cite"] = cite
            return d

        rec = {
            # ── Thermal Hazard ────────────────────────────────────────────
            "lstDayC": sourced(lst["day"] if lst else 0, "measured" if lst else "placeholder",
                               "2024-2026", "NASA ECOSTRESS L2T LSTE v002"),
            "lstNightC": sourced(lst["night"] if lst else 0, "measured" if lst else "placeholder",
                                 "2024-2026", "NASA ECOSTRESS L2T LSTE v002"),
            "ruralBaseC": sourced(lst["rural"] if lst else 0, "measured" if lst else "placeholder",
                                  "2024-2026", "ECOSTRESS urban-rural, GHS-SMOD masks"),
            # ── Exposure & Sensitivity ────────────────────────────────────
            "popDensity": sourced(pop["wards"][w]["density"] if pop else 0,
                                  "measured" if pop else "placeholder",
                                  pop.get("vintage") if pop else None, "WorldPop"),
            "far": sourced(f["far"], "measured", "2023-2025",
                           "MS footprints + Google Open Buildings 2.5D"),
            "socioVuln": sourced(socio["wards"][w]["hvi"] if socio else 0,
                                 "measured" if socio else "placeholder",
                                 socio.get("vintage") if socio else None,
                                 "NFHS-5 levels x Census 2011 pattern"),
            # ── Adaptive Capacity ─────────────────────────────────────────
            "fvc": sourced(s["fvc"], "measured", f"{s['years']} yr", "Sentinel-2 L2A"),
            "canopyFrac": sourced(0.0, "placeholder", None,
                                  "v2 only — inert in the v1 greenness formula"),
            "ndviMean": sourced(s["ndvi_mean"], "measured", f"{s['years']} yr", "Sentinel-2 L2A"),
            "ndviStd": sourced(s["ndvi_std"], "measured", f"{s['years']} yr across annual medians"),
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
    still = set()
    for w, rec in out["wards"].items():
        m = sum(1 for v in rec.values() if v["source"] == "measured")
        p = [k for k, v in rec.items() if v["source"] == "placeholder"]
        still.update(p)
        print(f"  {w:<14}{m:>10}{len(p):>13}")
    print(f"\n  still placeholder: {', '.join(sorted(still)) or 'none'}")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")
    if still - {"canopyFrac"}:
        print("\n  NOT READY FOR PHASE 4 — placeholders other than canopyFrac remain.")


if __name__ == "__main__":
    main()
