#!/usr/bin/env python3
"""
Attach meteorological forcing to each ECOSTRESS calibration scene.

    python3 scripts/fetch-met.py

The calibration CSV records what the surface WAS; the model predicts surface
temperature GIVEN the atmosphere. Without air temperature, humidity and wind at
the moment of overpass there is nothing to fit against — so this joins NASA
POWER hourly meteorology onto every usable scene.

WHY NASA POWER. Free, no API key, and public domain — no attribution or
non-commercial clause. Open-Meteo's archive is easier still but its licence is
non-commercial, which rules it out for work Delta sells to municipalities.
ERA5 via Copernicus CDS is the other clean option but needs account
registration; POWER is MERRA-2 derived and adequate here.

RESOLUTION CAVEAT. POWER is ~0.5 deg (~50 km) — one grid cell over greater
Kolkata. That is the regional background, not a ward reading, which is exactly
the right quantity: the model takes regional air temperature as forcing and
generates the local anomaly itself. Feeding it a ward-level air temperature
would double-count the heat island.

TIME BASE. POWER hourly is stamped in Local Solar Time, and the calibration CSV
already carries local_solar_hour derived from centre longitude. The join is
therefore direct, with no timezone arithmetic to get wrong.

Output: data/calibration/met-forcing.csv
"""
import csv, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SCENES = os.path.join(ROOT, "data", "calibration", "ecostress-suhii.csv")
OUT = os.path.join(ROOT, "data", "calibration", "met-forcing.csv")
CACHE = os.path.expanduser("~/.cache/delta-climate/power-hourly.json")

LAT, LON = 22.55, 88.37                       # centre of the three-ward bbox
PARAMS = "T2M,RH2M,WS2M,CLOUD_AMT"
URL = ("https://power.larc.nasa.gov/api/temporal/hourly/point"
       f"?parameters={PARAMS}&community=RE&longitude={LON}&latitude={LAT}"
       "&start={start}&end={end}&format=JSON")


def power_hourly(start: str, end: str) -> dict:
    """One request for the whole span — 49 separate calls would be rude and slow."""
    if os.path.exists(CACHE):
        with open(CACHE) as fh:
            blob = json.load(fh)
        if blob.get("_span") == [start, end]:
            return blob
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    url = URL.format(start=start, end=end)
    out = subprocess.run(["curl", "-s", "--fail", url], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"POWER request failed (curl {out.returncode})")
    blob = json.loads(out.stdout)
    if "properties" not in blob:
        sys.exit(f"POWER returned no data: {str(blob)[:200]}")
    blob["_span"] = [start, end]
    with open(CACHE, "w") as fh:
        json.dump(blob, fh)
    return blob


def main():
    with open(SCENES, newline="") as fh:
        scenes = [r for r in csv.DictReader(fh) if r["status"] == "ok"]
    if not scenes:
        sys.exit("no usable scenes in the calibration CSV")

    dates = sorted(r["date"] for r in scenes)
    blob = power_hourly(dates[0].replace("-", ""), dates[-1].replace("-", ""))
    p = blob["properties"]["parameter"]
    assert blob["header"]["time_standard"] == "LST", "POWER changed its time base"

    rows, missing = [], 0
    for s in scenes:
        # POWER keys are YYYYMMDDHH in local solar time; round the scene's solar
        # hour to the nearest stamp rather than truncating, so a 13:50 overpass
        # takes the 14:00 reading it is closest to.
        hour = int(round(float(s["local_solar_hour"]))) % 24
        key = s["date"].replace("-", "") + f"{hour:02d}"
        vals = {k: p[k].get(key) for k in ("T2M", "RH2M", "WS2M", "CLOUD_AMT")}
        if any(v is None or v <= -900 for v in vals.values()):   # POWER fill = -999
            missing += 1
            continue
        rows.append({
            "date": s["date"], "phase": s["phase"],
            "local_solar_hour": s["local_solar_hour"],
            "view_delta": s["view_delta"],
            "usable_frac": s["usable_frac"],
            "urban_mean": s["urban_mean"], "rural_strict": s["rural_strict"],
            "suhii": s["suhii"],
            "tAir": round(vals["T2M"], 2), "rh": round(vals["RH2M"], 2),
            "wind": round(vals["WS2M"], 2), "cloud": round(vals["CLOUD_AMT"] / 100, 3),
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    print(f"  {len(rows)} scenes with forcing ({missing} dropped for missing POWER data)")
    print(f"  written to {os.path.relpath(OUT, ROOT)}")
    for ph in ("day", "night"):
        v = [r for r in rows if r["phase"] == ph]
        if v:
            t = [r["tAir"] for r in v]
            print(f"    {ph:<6} n={len(v):<3} tAir {min(t):.1f}–{max(t):.1f} °C")


if __name__ == "__main__":
    main()
