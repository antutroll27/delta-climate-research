"""One-shot scoring of the Kolkata night-air correction on the 49 night scenes, per the
pre-registered rules in docs/evidence/2026-11-08-kolkata-night-air-correction.md."""
from __future__ import annotations
import csv, dataclasses, datetime as dt, json, math, subprocess, sys
from typing import cast
LAB = "/Volumes/OBOSLab/worktrees/daytime-refit/scripts"
MINE = "/Volumes/OBOSLab/worktrees/kolkata-night-aircorr/scripts"
sys.path[:0] = [MINE, LAB]   # LAB first: its _physics == mine + scene_phase
import numpy as np
import _refit_lab as lab, _refit_score as sc
import _night_air as na, _night_air_data as nd

T = "/Volumes/OBOSLab/tmp/daytime-refit"
ROWS = "/Volumes/OBOSLab/worktrees/daytime-refit/tests/fixtures/daytime-refit/rows-p2.json"
OUT = "docs/evidence/kolkata-night-air-correction/result.json"

allrows = lab.load_p2(ROWS)
night50 = [p for p in allrows if lab.in_set(p, "kolkata-mmd-292") and p.stratum == "night"]
test = [p for p in night50 if lab.forced(p, "station") is not None]
assert len(night50) == 50 and len(test) == 49, (len(night50), len(test))
dates = [p.row.date for p in test]
assert len(set(dates)) == 19, len(set(dates))  # the 20th date is the stale scene alone
utc = {p.rid: na.parse_utc(p.row.utc) for p in night50}
centres_all = [utc[p.rid] for p in night50]

ld = nd.load_instants(f"{T}/iem/vecc-raw.csv", f"{T}/power/kolkata.json")
table = na.load_table()   # the committed table = build with all 50 scenes excluded
b_ex = nd.rounded(nd.build(ld.instants, centres_all))
assert [float(x) for x in b_ex.offsets_k] == [float(x) for x in table.offsets_k]

def err(r): return float(lab.error(r, lab.M0, "ws10m"))

# --- dew point from the raw text (only for the RH sensitivity)
import re
def dewc(raw):
    for tok in raw.split():
        m = re.match(r"^(M?\d{2})/(M?\d{2}|//|XX)?$", tok)
        if m:
            d = m.group(2)
            if d and re.search(r"\d", d): return -int(d[1:]) if d.startswith("M") else int(d)
            return None
    return None
def magnus_rh(t, td):
    g = lambda x: 17.67 * x / (x + 243.5)
    return min(100.0, 100 * math.exp(g(td) - g(t)))

# 0. references
e_raw = np.array([err(lab.forced(p, "station")) for p in test])
e_pow = np.array([float(lab.error(p.row, lab.M0, "ws10m")) for p in test])
# 1. the pre-registered primary
corr = [na.correction_k(table, utc[p.rid], na.sun_at(utc[p.rid], p.row.lat)) for p in test]
assert all(c != 0 for c in corr) and all(na.is_night(utc[p.rid], p.row.lat) for p in test)
rows_c = [dataclasses.replace(lab.forced(p, "station"), tAir=lab.Celsius(lab.forced(p, "station").tAir - c)) for p, c in zip(test, corr)]
e_c = np.array([err(r) for r in rows_c])
S = lambda e: sc.score(dates, e)
res: dict = {"n_rows": len(test), "n_dates": len(set(dates)), "table_offsets_k": [float(x) for x in table.offsets_k], "n": list(table.n)}
res["raw_station"], res["power"], res["corrected"] = S(e_raw), S(e_pow), S(e_c)
res["corr_k_applied"] = {"mean": round(float(np.mean(corr)), 3), "min": min(corr), "max": max(corr)}
# 2. leave-one-overpass-date: the table rebuilt with ONLY that date's scenes excluded
loo_e: list[float] = []
by_date = sorted(set(dates))
all_dates_of_50 = sorted({p.row.date for p in night50})
for d in by_date:
    cs = [utc[p.rid] for p in night50 if p.row.date == d]
    tab_d = nd.rounded(nd.build(ld.instants, cs))
    t_d = na.NightAirTable("VECC", tab_d.offsets_k, tab_d.n)
    for p in test:
        if p.row.date != d: continue
        r = lab.forced(p, "station"); c = na.correction_k(t_d, utc[p.rid], na.sun_at(utc[p.rid], p.row.lat))
        loo_e.append(err(dataclasses.replace(r, tAir=lab.Celsius(r.tAir - c))))
# restore order to match `dates` (sort by date; score needs same order of dates)
order_dates = [p.row.date for d in by_date for p in test if p.row.date == d]
res["loo_overpass"] = sc.score(order_dates, np.array(loo_e))
# 3. verdict, as pre-registered
c = res["corrected"]; l = res["loo_overpass"]
a = c["bias_ci95_K"]["lo"] <= 0 <= c["bias_ci95_K"]["hi"]
b = c["rmse_K"] <= 3.0
cc = l["rmse_K"] <= 3.0
# rmse_K is rounded to 3 dp in score(); recompute unrounded
res["unrounded"] = {"rmse": float(np.sqrt(np.mean(e_c**2))), "loo_rmse": float(np.sqrt(np.mean(np.array(loo_e)**2)))}
b = res["unrounded"]["rmse"] <= 3.0; cc = res["unrounded"]["loo_rmse"] <= 3.0
res["verdict"] = {"a_bias_ci_includes_0": a, "b_rmse_le_3": b, "c_loo_rmse_le_3": cc, "PASS": bool(a and b and cc)}
# 4. reported, not decided
unx = nd.rounded(nd.build(ld.instants, []))
t_un = na.NightAirTable("VECC", unx.offsets_k, unx.n)
e_un = np.array([err(dataclasses.replace(lab.forced(p, "station"), tAir=lab.Celsius(lab.forced(p, "station").tAir - na.correction_k(t_un, utc[p.rid], 0.0)))) for p in test])
res["sens_unexcluded_table"] = S(e_un)
night_all = [i for i in ld.instants if i.night]
const = float(np.mean([i.diff for i in night_all if not nd.excluded(i.utc, centres_all)]))
e_const = np.array([err(dataclasses.replace(lab.forced(p, "station"), tAir=lab.Celsius(lab.forced(p, "station").tAir - const))) for p in test])
res["sens_single_constant"] = {"const_k": round(const, 3), **S(e_const)}
e_rh = []
for p, c_ in zip(test, corr):
    r = lab.forced(p, "station"); td = dewc(p.st.raw or "")
    t2 = r.tAir - c_
    r2 = dataclasses.replace(r, tAir=lab.Celsius(t2), rh=(magnus_rh(t2, td) if td is not None else r.rh))
    e_rh.append(err(r2))
res["sens_rh_from_corrected_air"] = S(np.array(e_rh))
# per-month residual
bm: dict[int, list[float]] = {}
for p, e in zip(test, e_c): bm.setdefault(int(na.ist_month(utc[p.rid])), []).append(float(e))
res["residual_by_month"] = {m: {"n": len(v), "mean_K": round(float(np.mean(v)), 2)} for m, v in sorted(bm.items())}
# 5. cloud
raws = [{"raw": p.st.raw, "valid": p.st.report_utc} for p in test]
cf = json.loads(subprocess.run(["node", "--import", "tsx", "docs/evidence/kolkata-night-air-correction/cloud_fraction.mjs"],
    input=json.dumps(raws), capture_output=True, text=True, check=True, cwd="/Volumes/OBOSLab/worktrees/kolkata-night-aircorr").stdout)
e_cl = []; used = 0; dc = []
for r, p, f in zip(rows_c, test, cf):
    if f is None: e_cl.append(err(r)); continue
    used += 1; dc.append(f - p.row.cloud)
    e_cl.append(err(dataclasses.replace(r, cloud=float(f))))
res["cloud"] = {"scenes_with_station_cloud": used, "station_minus_power_cloud_mean": round(float(np.mean(dc)), 3),
                "corrected_air_plus_station_cloud": S(np.array(e_cl)),
                "raw_air_plus_station_cloud": S(np.array([err(dataclasses.replace(lab.forced(p, "station"), cloud=(f if f is not None else p.row.cloud))) for p, f in zip(test, cf)]))}
# monthly night mean of (VECC cloud - POWER CLOUD_AMT/100)
pw = json.load(open(f"{T}/power/kolkata.json"))["properties"]["parameter"]["CLOUD_AMT"]
import _power
inp = []; keep = []
with open(f"{T}/iem/vecc-raw.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        u = na.parse_utc(r["valid"])
        if not (nd.WINDOW_START <= u.date() <= nd.WINDOW_END) or not na.is_night(u): continue
        v = pw.get(_power.power_stamp(u.isoformat(), na.POWER_LON))
        if v is None or v < -900: continue
        inp.append({"raw": r["metar"], "valid": r["valid"]}); keep.append((int(na.ist_month(u)), v / 100.0))
cfa = json.loads(subprocess.run(["node", "--import", "tsx", "docs/evidence/kolkata-night-air-correction/cloud_fraction.mjs"],
    input=json.dumps(inp), capture_output=True, text=True, check=True, cwd="/Volumes/OBOSLab/worktrees/kolkata-night-aircorr").stdout)
bmc: dict[int, list[float]] = {}; nnull = 0
for (m, pv), f in zip(keep, cfa):
    if f is None: nnull += 1; continue
    bmc.setdefault(m, []).append(f - pv)
res["cloud"]["night_monthly_vecc_minus_power"] = {m: {"n": len(v), "mean": round(float(np.mean(v)), 3)} for m, v in sorted(bmc.items())}
res["cloud"]["night_instants_total"] = len(keep); res["cloud"]["night_instants_vecc_cloud_null"] = nnull
json.dump(res, open(OUT, "w"), indent=1)
print(json.dumps({k: res[k] for k in ("n_rows","n_dates","raw_station","power","corrected","loo_overpass","unrounded","verdict")}, indent=1))
