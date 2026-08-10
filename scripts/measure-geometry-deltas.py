"""Every downstream number, shipped vs staged, in one table. THE PHASE STOPS HERE.

Adding ~5,200 buildings changes the built raster; the built raster feeds FAR; FAR
carries 0.30 of the DC-URS exposure pillar, which feeds the resilience score shown
on the page. This measures that chain instead of assuming it.

Nothing here writes to public/. far.json is restored to its shipped state before
exit, so a measurement run leaves no trace in the working tree.

    python3 scripts/measure-geometry-deltas.py
"""
from __future__ import annotations

import json
from typing import Any, cast
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
STAGING = os.path.join(ROOT, "data", "geometry", "staging")
FAR_JSON = os.path.join(ROOT, "data", "dc-urs", "far.json")
OUT = os.path.join(ROOT, "data", "calibration", "geometry-replacement.json")
WARDS = ("ballygunge", "barrackpore", "baruipur")


def far_for(geom_dir: str | None) -> dict[str, Any]:
    env = dict(os.environ)
    if geom_dir:
        env["GEOM_DIR"] = geom_dir
    else:
        env.pop("GEOM_DIR", None)
    subprocess.run([sys.executable, "scripts/compute-far.py"], cwd=ROOT, env=env,
                   check=True, capture_output=True, text=True)
    with open(FAR_JSON, encoding="utf-8") as fh:
        return cast(dict[str, Any], json.load(fh)["wards"])


def main() -> int:
    before = far_for(None)
    after = far_for(STAGING)
    far_for(None)                      # restore: the gate measures, it does not mutate

    table: dict[str, Any] = {
        "note": "shipped vs staged geometry. Nothing ships until this is reviewed.",
        "staged_from": "Overture 2026-07-22.0 footprints + Open Buildings 2.5D p65 heights",
        "wards": {},
    }
    for ward in WARDS:
        b, a = before[ward], after[ward]
        table["wards"][ward] = {
            "buildings": [b["buildings"], a["buildings"]],
            "far": [b["far"], a["far"]],
            "built_fraction": [b["built_fraction"], a["built_fraction"]],
            "footprint_m2": [b["footprint_m2"], a["footprint_m2"]],
            "floor_m2": [b["floor_m2"], a["floor_m2"]],
        }
    # The sim delta belongs IN this artefact, not bolted on afterwards. The first
    # version wrote a partial table and the sim numbers were added by hand; the
    # next run silently discarded them. A gate that loses its own evidence on
    # re-run is not a gate.
    sim = subprocess.run(["node", "--experimental-strip-types", "scripts/geometry-sim-delta.mjs"],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    payload = next((l[5:] for l in sim.splitlines() if l.startswith("JSON ")), None)
    if payload is None:
        raise SystemExit("geometry-sim-delta.mjs emitted no JSON line -- cannot gate blind")
    table["sim_delta_K"] = json.loads(payload)
    table["sim_delta_K"]["note"] = (
        "eqMean at canonical forcing, flat measured means, so the only difference is the "
        "built raster. Published bands: +/-4.5 K peak, +/-3.0 K night.")

    # Carry forward any verdict a previous run recorded, so re-measuring the
    # geometry never erases the accuracy evidence beside it.
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            prior = json.load(fh)
        if "accuracy_rerun" in prior:
            table["accuracy_rerun"] = prior["accuracy_rerun"]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(table, indent=2) + "\n")

    print(f"  {'ward':<13}{'buildings':>18}{'FAR':>16}{'built fraction':>22}")
    for ward, t in table["wards"].items():
        fb, fa = t["far"]
        bb, ba = t["built_fraction"]
        print(f"  {ward:<13}{t['buildings'][0]:>8} ->{t['buildings'][1]:>6}"
              f"{fb:>8.2f} ->{fa:>6.2f}{(fa-fb)/fb:>+8.0%}"
              f"{bb:>9.3f} ->{ba:>6.3f}{(ba-bb)/bb:>+8.0%}")
    print(f"\n  -> {os.path.relpath(OUT, ROOT)}")
    print("  FAR carries 0.30 of the DC-URS exposure pillar. STOP and review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
