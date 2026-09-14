"""Bengaluru DC-URS inputs: the pure half.

Everything here runs without the network or a raster on disk, so the rules the
design fixed in advance can be tested offline. Two layers in fetch-bangalore.py
measure (`dcurs-static`, `dcurs-lst`); export-bangalore-obos.py assembles the
served file. The engine (src/scripts/climate-engine/dc-urs.ts) does not change.

Spec: docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md
"""
from __future__ import annotations

import os
import statistics
import sys
from typing import Literal, TypedDict

import numpy as np
import numpy.typing as npt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr  # noqa: E402  (path set above)
from _types import DcUrsInputsFile, DcUrsWard, Provenance, Sourced  # noqa: E402

STATIC_PATH = os.path.join(blr.DATA, "dcurs-static.json")
LST_PATH = os.path.join(blr.DATA, "dcurs-lst-scenes.json")
SOURCE_PATH = os.path.join(blr.DATA, "dc-urs-inputs.json")
SERVED_NAME = "bengaluru-dc-urs-inputs.json"

# PRE-REGISTERED GATES (spec §2), fixed before any Bengaluru scene was fetched.
MIN_CLEAR_FRAC = 0.10       # Kolkata's per-ward rule: 40 usable of ~400 pixels
MIN_SHARED_SCENES = 8       # per phase, scenes clear in ALL three wards
MAX_NIGHT_SUHII_C = 2.5     # above this a night heat island is a processing error
VIEW_CUT = 0.75             # near-nadir, as build-dcurs-inputs.py and _physics.py
MIN_RURAL_PX = 50           # as _suhii.measure_scene
RURAL_CLASSES = (11, 12, 13)

#: Mirror of ANCHORS in src/scripts/climate-engine/dc-urs.ts, used only for the
#: clamp report. tests/unit/bangalore-dc-urs.test.mjs pins the two equal.
ANCHORS: dict[str, float] = {
    "lstDayBase": 25.0, "lstDaySpan": 20.0,
    "lstNightBase": 20.0, "lstNightSpan": 15.0,
    "uhiSpan": 10.0,
    "popDensityMax": 25_000.0,
    "farMax": 5.0,
    "albedoRef": 0.60,
}

F32 = npt.NDArray[np.float32]
U16 = npt.NDArray[np.uint16]
Mask = npt.NDArray[np.bool_]
Phase = Literal["day", "night"]


class WardStat(TypedDict):
    mean_c: float | None
    clear: float


class SceneRow(TypedDict):
    utc: str
    phase: Phase
    view_delta: float | None
    rural_c: float | None
    rural_px: int
    wards: dict[str, WardStat]


class ScenesFile(TypedDict):
    source: str
    rural_bbox: list[float]
    start: str
    rows: list[SceneRow]
    skipped: list[str]


class StaticWard(TypedDict):
    popDensity: float
    population: int
    far: float
    storeyM: float
    distCoolM: float
    ndviMean: float
    ndviStd: float
    ndviYears: int


class StaticFile(TypedDict):
    generated: str
    ghsPop: str
    worldCover: str
    sentinel: str
    wards: dict[str, StaticWard]


class Thermal(TypedDict):
    lstDayC: float | None
    lstNightC: float | None
    ruralBaseC: float | None
    suhiiDayC: float | None
    suhiiNightC: float | None
    dayScenes: int
    nightScenes: int
    vintage: str


def granule_celsius(lst_k: F32, qc: U16 | None, cloud: U16 | None, water: U16 | None) -> F32:
    """Kolkata's per-granule mask (build-ward-observations.ward_lst): Kelvin in, C out, NaN unusable."""
    good = np.isfinite(lst_k) & (lst_k > 200) & (lst_k < 400)
    if qc is not None:
        good &= (qc != 0xFFFF) & ((qc & 0b11) == 0)
    if cloud is not None:
        good &= cloud != 1
    if water is not None:
        good &= water != 1
    return np.where(good, lst_k - np.float32(273.15), np.float32(np.nan)).astype(np.float32)


def first_finite(acc: F32 | None, nxt: F32) -> F32:
    """Overlapping granules: the first finite pixel wins, as in _suhii and ward_lst."""
    if acc is None:
        return nxt
    return np.where(np.isfinite(acc), acc, nxt).astype(np.float32)


def scene_row(utc: str, phase: Phase, cel: F32, view: F32 | None,
              smod: npt.NDArray[np.int16], masks: dict[str, Mask]) -> SceneRow:
    """One acquisition, every ward and the rural reference, on ONE aligned grid."""
    ok = np.isfinite(cel)
    union = np.zeros(cel.shape, dtype=bool)
    wards: dict[str, WardStat] = {}
    for wid, m in masks.items():
        union |= m
        n, k = int(m.sum()), int((ok & m).sum())
        wards[wid] = {"mean_c": round(float(np.mean(cel[ok & m])), 3) if k else None,
                      "clear": round(k / n, 4) if n else 0.0}
    rural = ok & np.isin(smod, RURAL_CLASSES) & ~union
    rural_px = int(rural.sum())
    rural_c = round(float(np.mean(cel[rural])), 3) if rural_px >= MIN_RURAL_PX else None
    view_delta: float | None = None
    if view is not None and rural_c is not None and bool((ok & union).any()):
        vu = float(np.nanmean(np.abs(view[ok & union])))
        vr = float(np.nanmean(np.abs(view[rural])))
        view_delta = round(abs(vu - vr), 2)
    return {"utc": utc, "phase": phase, "view_delta": view_delta, "rural_c": rural_c,
            "rural_px": rural_px, "wards": wards}


def shared(row: SceneRow, ward_ids: list[str]) -> bool:
    """A scene counts only if it is near-nadir, has a rural reference, and every ward is clear."""
    if row["rural_c"] is None or row["view_delta"] is None or row["view_delta"] > VIEW_CUT:
        return False
    for w in ward_ids:
        st = row["wards"].get(w)
        if st is None or st["mean_c"] is None or st["clear"] < MIN_CLEAR_FRAC:
            return False
    return True


def _c(row: SceneRow, w: str) -> float:
    v = row["wards"][w]["mean_c"]
    assert v is not None
    return v


def _rural(row: SceneRow) -> float:
    v = row["rural_c"]
    assert v is not None
    return v


def thermal(rows: list[SceneRow], ward_ids: list[str]) -> dict[str, Thermal]:
    """Day/night medians over SHARED scenes, and the heat island as a median of differences."""
    use = [r for r in rows if shared(r, ward_ids)]
    day = [r for r in use if r["phase"] == "day"]
    night = [r for r in use if r["phase"] == "night"]
    years = sorted({r["utc"][:4] for r in use})
    vintage = f"{years[0]}-{years[-1]}" if years else ""
    day_ok, night_ok = len(day) >= MIN_SHARED_SCENES, len(night) >= MIN_SHARED_SCENES
    out: dict[str, Thermal] = {}
    for w in ward_ids:
        lst_day = round(statistics.median(_c(r, w) for r in day), 2) if day_ok else None
        suhii_day = round(statistics.median(_c(r, w) - _rural(r) for r in day), 2) if day_ok else None
        out[w] = {
            "lstDayC": lst_day,
            "lstNightC": round(statistics.median(_c(r, w) for r in night), 2) if night_ok else None,
            "ruralBaseC": (round(lst_day - suhii_day, 2)
                           if lst_day is not None and suhii_day is not None else None),
            "suhiiDayC": suhii_day,
            "suhiiNightC": (round(statistics.median(_c(r, w) - _rural(r) for r in night), 2)
                            if night_ok else None),
            "dayScenes": len(day),
            "nightScenes": len(night),
            "vintage": vintage,
        }
    return out


def night_suhii_refusal(th: dict[str, Thermal]) -> str | None:
    """A reason to refuse the export, or None."""
    bad = {w: t["suhiiNightC"] for w, t in th.items()
           if t["suhiiNightC"] is not None and t["suhiiNightC"] > MAX_NIGHT_SUHII_C}
    if not bad:
        return None
    return (f"night heat island above {MAX_NIGHT_SUHII_C} C in {bad}: published Indian values sit "
            "near 1-1.5 C, so this is treated as a processing error and nothing is exported")


def sourced(value: float, source: Provenance, vintage: str | None = None,
            cite: str | None = None) -> Sourced[float]:
    d: Sourced[float] = {"value": value, "source": source}
    if vintage is not None:
        d["vintage"] = vintage
    if cite is not None:
        d["cite"] = cite
    return d


ECO = "NASA ECOSTRESS L2T LSTE v002, scenes clear in all three wards"


def ward_record(t: Thermal, s: StaticWard, fvc: float, albedo: float) -> DcUrsWard:
    """One ward's twelve indicators, in the TypeScript DcUrsInputs shape."""
    def lst(v: float | None, cite: str) -> Sourced[float]:
        if v is None:
            return sourced(0.0, "placeholder", None,
                           f"{cite} -- fewer than {MIN_SHARED_SCENES} shared clear scenes")
        return sourced(v, "measured", t["vintage"], cite)
    return {
        "lstDayC": lst(t["lstDayC"], f"{ECO}, median of {t['dayScenes']} day scenes"),
        "lstNightC": lst(t["lstNightC"], f"{ECO}, median of {t['nightScenes']} night scenes"),
        "ruralBaseC": lst(t["ruralBaseC"],
                          "EFFECTIVE rural baseline: lstDayC minus the median per-scene difference "
                          "(ward - GHS-SMOD rural 11/12/13), so lstDayC - ruralBaseC is that median"),
        "popDensity": sourced(s["popDensity"], "measured", "2020",
                              "JRC GHS-POP R2023A 100 m, tile R8_C26, people in the 2.8 km box / 7.84 km2"),
        "far": sourced(s["far"], "measured", "2023-2026",
                       f"Overture footprints + Google Open Buildings 2.5D / OSM heights, storey {s['storeyM']} m"),
        "socioVuln": sourced(0.0, "placeholder", None,
                             "not measured: no commercially clear ward-level source "
                             "(docs/evidence/known-limitations.md)"),
        "fvc": sourced(fvc, "measured", "2021-2025",
                       "Sentinel-2 L2A per-cell composite, surface-meta.json fvc_mean"),
        "canopyFrac": sourced(0.0, "placeholder", None, "v2 only -- inert in the v1 greenness formula"),
        "ndviMean": sourced(s["ndviMean"], "measured", f"{s['ndviYears']} yr", "Sentinel-2 L2A"),
        "ndviStd": sourced(s["ndviStd"], "measured", f"{s['ndviYears']} yr",
                           "Sentinel-2 L2A, across-year std of annual medians"),
        "albedo": sourced(albedo, "measured", "2021-2025",
                          "Sentinel-2 per-cell composite, surface-meta.json albedo_mean"),
        "distCoolM": sourced(s["distCoolM"], "measured", "2021",
                             "ESA WorldCover 10 m, tile N12E075, patches >= 0.77 ha"),
    }


def assemble(th: dict[str, Thermal], static: dict[str, StaticWard],
             surface: dict[str, tuple[float, float]]) -> DcUrsInputsFile:
    return {
        "generated": "export-bangalore-obos.py",
        "engine": ("v1 -- see docs/dc-urs-source-of-truth.md; Bengaluru inputs per "
                   "docs/superpowers/specs/2026-09-14-bengaluru-resilience-score-design.md"),
        "note": ("Every field carries source and vintage. A 'placeholder' sits at its optimistic "
                 "endpoint and is disclosed by the score's confidence chip."),
        "known_limitations": [
            "socioVuln is unmeasured: district data is identical across the three wards, WorldPop "
            "age shares are state-uniform for India, and the Census 2011 ward tables are not cleared "
            "for commercial use.",
            "fvc and albedo are the map's per-cell Sentinel-2 composite means (surface-meta.json), a "
            "different reduction from Kolkata's sentinel.json, kept identical to the served texture "
            "so the map and the score cannot disagree.",
            "ruralBaseC is an effective baseline (lstDayC minus the median per-scene heat island), so "
            "the engine reproduces a median of differences, not a difference of medians.",
            "Anchors are Kolkata's; the clamp report is in docs/evidence/known-limitations.md.",
        ],
        "wards": {w: ward_record(th[w], static[w], surface[w][0], surface[w][1]) for w in th},
    }


def clamps(rec: DcUrsWard) -> list[str]:
    """Every term that sits on a Kolkata anchor's floor or ceiling, in words."""
    a = ANCHORS
    out: list[str] = []
    if rec["lstDayC"]["source"] != "placeholder":
        d = rec["lstDayC"]["value"]
        t = (d - a["lstDayBase"]) / a["lstDaySpan"]
        if t <= 0:
            out.append(f"lstDayC {d} C at or below the {a['lstDayBase']} C floor: day hazard reads 0")
        elif t >= 1:
            out.append(f"lstDayC {d} C at or above the {a['lstDayBase'] + a['lstDaySpan']} C ceiling")
        u = max(0.0, d - rec["ruralBaseC"]["value"]) / a["uhiSpan"]
        if u <= 0:
            out.append("heat island at or below 0: the UHI term reads 0")
        elif u >= 1:
            out.append(f"heat island at or above the {a['uhiSpan']} C ceiling")
    if rec["lstNightC"]["source"] != "placeholder":
        n = rec["lstNightC"]["value"]
        t = (n - a["lstNightBase"]) / a["lstNightSpan"]
        if t <= 0:
            out.append(f"lstNightC {n} C at or below the {a['lstNightBase']} C floor: night hazard reads 0")
        elif t >= 1:
            out.append(f"lstNightC {n} C at or above the {a['lstNightBase'] + a['lstNightSpan']} C ceiling")
    if rec["popDensity"]["value"] >= a["popDensityMax"]:
        out.append(f"popDensity {rec['popDensity']['value']:,.0f}/km2 at or above the "
                   f"{a['popDensityMax']:,.0f} ceiling: exposure saturates")
    if rec["far"]["value"] >= a["farMax"]:
        out.append(f"far {rec['far']['value']} at or above the {a['farMax']} ceiling")
    if rec["albedo"]["value"] >= a["albedoRef"]:
        out.append(f"albedo {rec['albedo']['value']} at or above the {a['albedoRef']} reference")
    return out


# ── self-test ────────────────────────────────────────────────────────────────

def _row(utc: str, phase: Phase, wards: dict[str, float | None],
         rural: float | None = 30.0, view: float | None = 0.2, clear: float = 0.5) -> SceneRow:
    return {"utc": utc, "phase": phase, "view_delta": view, "rural_c": rural,
            "rural_px": 999 if rural is not None else 0,
            "wards": {w: {"mean_c": v, "clear": clear if v is not None else 0.0}
                      for w, v in wards.items()}}


def _unpaired_median(rows: list[SceneRow], w: str, phase: Phase) -> float:
    """The aggregation the spec REJECTS, kept only to prove the ranking flip."""
    vals: list[float] = []
    for r in rows:
        st = r["wards"][w]
        if r["phase"] == phase and st["mean_c"] is not None and st["clear"] >= MIN_CLEAR_FRAC:
            vals.append(st["mean_c"])
    return statistics.median(vals)


def _self_test() -> None:
    nan = np.float32(np.nan)
    # 1. Kolkata's granule mask: range, QC mandatory bits, cloud, water.
    lst = np.array([[300.0, 150.0], [310.0, nan]], dtype=np.float32)
    qc = np.array([[0, 0], [1, 0]], dtype=np.uint16)
    zero = np.zeros((2, 2), dtype=np.uint16)
    cel = granule_celsius(lst, qc, zero, zero)
    assert abs(float(cel[0, 0]) - 26.85) < 1e-4, "300 K is 26.85 C"
    assert np.isnan(cel[0, 1]) and np.isnan(cel[1, 0]) and np.isnan(cel[1, 1]), \
        "out-of-range, QC-flagged and missing pixels are unusable"
    wet = np.array([[1, 0], [0, 0]], dtype=np.uint16)
    assert np.isnan(granule_celsius(lst, None, None, wet)[0, 0]), "water is masked"

    # 2. first finite wins across overlapping granules.
    a = np.array([[1.0, nan]], dtype=np.float32)
    b = np.array([[9.0, 2.0]], dtype=np.float32)
    assert first_finite(a, b).tolist() == [[1.0, 2.0]], "the earlier granule keeps its pixels"
    assert first_finite(None, b).tolist() == [[9.0, 2.0]]

    # 3. scene row: ward means and clear fractions, rural reference, view delta.
    grid = np.full((10, 10), 30.0, dtype=np.float32)
    ma = np.zeros((10, 10), dtype=bool)
    ma[0:2, 0:2] = True
    mb = np.zeros((10, 10), dtype=bool)
    mb[0:2, 8:10] = True
    grid[ma] = 35.0
    grid[1, 1] = nan                                   # one of ward a's 4 pixels is cloud
    smod = np.full((10, 10), 11, dtype=np.int16)
    view = np.full((10, 10), -5.0, dtype=np.float32)
    row = scene_row("2024-03-01T05:00:00", "day", grid, view, smod, {"a": ma, "b": mb})
    assert row["wards"]["a"] == {"mean_c": 35.0, "clear": 0.75}, row["wards"]["a"]
    assert row["wards"]["b"] == {"mean_c": 30.0, "clear": 1.0}, row["wards"]["b"]
    assert row["rural_px"] == 92 and row["rural_c"] == 30.0, "ward pixels are excluded from rural"
    assert row["view_delta"] == 0.0

    # 4. THE RANKING FLIP (dc-urs-diagnosis.md): unpaired medians rank b hottest,
    #    the shared-scene method ranks a hottest, on the same rows.
    ids = ["a", "b", "c"]
    rows = [_row(f"2024-01-{d:02d}T05:00:00", "day", {"a": 31.0, "b": 30.0, "c": 29.0}, rural=25.0)
            for d in range(1, 9)]
    rows += [_row(f"2024-02-{d:02d}T05:00:00", "day", {"a": None, "b": 40.0, "c": None}, rural=25.0)
             for d in range(1, 11)]
    assert _unpaired_median(rows, "b", "day") > _unpaired_median(rows, "a", "day"), \
        "fixture must reproduce the flip, or it proves nothing"
    th = thermal(rows, ids)
    assert th["a"]["lstDayC"] == 31.0 and th["b"]["lstDayC"] == 30.0, th
    assert th["a"]["dayScenes"] == 8, "only scenes clear in all three wards count"

    # 5. MEDIAN OF DIFFERENCES, not difference of medians (the Kolkata sign bug).
    wa = [30.0, 31.0, 32.0, 33.0, 34.0, 35.0, 36.0, 37.0, 38.0]
    ru = [29.0, 30.0, 31.0, 32.0, 33.0, 20.0, 21.0, 22.0, 23.0]
    rows2 = [_row(f"2025-01-{i + 1:02d}T05:00:00", "day", {"a": v, "b": v, "c": v}, rural=r)
             for i, (v, r) in enumerate(zip(wa, ru))]
    t2 = thermal(rows2, ids)["a"]
    assert statistics.median(wa) - statistics.median(ru) == 5.0, "fixture: difference of medians is 5"
    assert t2["suhiiDayC"] == 1.0, f"median of per-scene differences is 1, got {t2['suhiiDayC']}"
    assert t2["lstDayC"] == 34.0 and t2["ruralBaseC"] == 33.0, \
        "effective baseline = lstDayC - median difference, so the engine reproduces 1.0"
    assert t2["vintage"] == "2025-2025"

    # 6. the 8-scene gate.
    t3 = thermal(rows2[:7], ids)["a"]
    assert t3["lstDayC"] is None and t3["ruralBaseC"] is None, "7 shared scenes must not ship"

    # 7. the night sanity gate.
    night_rows = [_row(f"2025-02-{i + 1:02d}T18:00:00", "night", {"a": 23.0, "b": 23.0, "c": 23.0},
                       rural=20.0) for i in range(8)]
    assert night_suhii_refusal(thermal(night_rows, ids)) is not None, "3.0 C at night must refuse"
    ok_rows = [_row(r["utc"], "night", {"a": 22.0, "b": 22.0, "c": 22.0}, rural=20.0) for r in night_rows]
    assert night_suhii_refusal(thermal(ok_rows, ids)) is None, "2.0 C at night is plausible"

    # 8. view angle and clear-fraction filters.
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, view=0.9), ids), "off-nadir"
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, clear=0.09), ids), "under 10 %"
    assert not shared(_row("x", "day", {"a": 1.0, "b": 1.0, "c": 1.0}, rural=None), ids), "no rural"

    # 9. records: a gated field is a placeholder at 0; socio is always a placeholder.
    static: StaticWard = {"popDensity": 30_000.0, "population": 235_200, "far": 1.2, "storeyM": 3.33,
                          "distCoolM": 150.0, "ndviMean": 0.3, "ndviStd": 0.02, "ndviYears": 5}
    rec = ward_record(t3, static, 0.4, 0.17)
    assert rec["lstDayC"]["source"] == "placeholder" and rec["lstDayC"]["value"] == 0.0
    assert rec["socioVuln"]["source"] == "placeholder" and rec["socioVuln"]["value"] == 0.0
    assert rec["fvc"]["value"] == 0.4 and rec["albedo"]["value"] == 0.17
    measured = ward_record(t2, static, 0.4, 0.17)
    assert measured["lstDayC"]["source"] == "measured" and measured["lstDayC"]["vintage"] == "2025-2025"
    assert "EFFECTIVE" in str(measured["ruralBaseC"].get("cite", "")), "the baseline construction is disclosed"

    # 10. clamp report.
    cold_night = t2.copy()
    cold_night["lstNightC"] = 18.0
    cold_night["nightScenes"] = 8
    report = clamps(ward_record(cold_night, static, 0.4, 0.17))
    assert any("lstNightC" in s for s in report), report
    assert any("popDensity" in s for s in report), "30,000/km2 is over the 25,000 ceiling"
    assert sourced(1.0, "measured") == {"value": 1.0, "source": "measured"}, "None keys are omitted"
    print("  _dcurs_blr self-test OK")


if __name__ == "__main__":
    _self_test()
