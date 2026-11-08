"""Post-result, descriptive only (declared as such in the note): where the residual sits by month, and the
table-vs-constant paired comparison."""
import dataclasses, json, sys
LAB = "/Volumes/OBOSLab/worktrees/daytime-refit/scripts"; MINE = "/Volumes/OBOSLab/worktrees/kolkata-night-aircorr/scripts"
sys.path[:0] = [MINE, LAB]
import numpy as np
import _refit_lab as lab, _refit_score as sc, _night_air as na, _night_air_data as nd
T = "/Volumes/OBOSLab/tmp/daytime-refit"
allrows = lab.load_p2("/Volumes/OBOSLab/worktrees/daytime-refit/tests/fixtures/daytime-refit/rows-p2.json")
test = [p for p in allrows if lab.in_set(p, "kolkata-mmd-292") and p.stratum == "night" and lab.forced(p, "station") is not None]
dates = [p.row.date for p in test]; table = na.load_table()
utc = {p.rid: na.parse_utc(p.row.utc) for p in test}
err = lambda r: float(lab.error(r, lab.M0, "ws10m"))
e_t = np.array([err(dataclasses.replace(lab.forced(p, "station"), tAir=lab.Celsius(lab.forced(p, "station").tAir - table.offset(na.ist_month(utc[p.rid]))))) for p in test])
e_c = np.array([err(dataclasses.replace(lab.forced(p, "station"), tAir=lab.Celsius(lab.forced(p, "station").tAir - 2.17))) for p in test])
e_p = np.array([float(lab.error(p.row, lab.M0, "ws10m")) for p in test])
e_r = np.array([err(lab.forced(p, "station")) for p in test])
out = {"table_minus_constant_paired": sc.paired(dates, e_c, e_t), "table_minus_power_paired": sc.paired(dates, e_p, e_t)}
mo = np.array([int(na.ist_month(utc[p.rid])) for p in test])
out["by_month"] = {int(m): {"n": int((mo == m).sum()), "dates": len({d for d, k in zip(dates, mo) if k == m}),
    "power": round(float(e_p[mo == m].mean()), 2), "raw_station": round(float(e_r[mo == m].mean()), 2),
    "table": round(float(e_t[mo == m].mean()), 2), "constant": round(float(e_c[mo == m].mean()), 2),
    "air_gap_station_minus_power": round(float(np.mean([lab.forced(p, "station").tAir - p.row.tAir for p, k in zip(test, mo) if k == m])), 2),
    "table_offset": float(table.offset(m))} for m in sorted(set(mo))}
json.dump(out, open("docs/evidence/kolkata-night-air-correction/supp.json", "w"), indent=1); print(json.dumps(out, indent=1))
