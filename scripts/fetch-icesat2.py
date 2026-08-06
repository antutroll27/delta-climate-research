"""ICESat-2 ATL03 → ward photon subsets, the only network step in the pipeline.

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §3, §5.1.

    python3 scripts/fetch-icesat2.py --ward ballygunge --granule ATL03_20220510191458_07441501_007_01.h5
    python3 scripts/fetch-icesat2.py --ward ballygunge            # every ATL03 granule over the ward
    python3 scripts/fetch-icesat2.py --purge                      # delete cached granules

Needs h5py (`python3 -m pip install h5py`), the one dependency this workstream
adds. It is a RUNTIME dependency, so it is not in requirements-dev.txt — that
file is the type-checking toolchain only, and every other runtime dependency in
this pipeline (rasterio, shapely, scipy) is likewise a documented install.

Granules (~168 MB) cache at ~/.cache/delta-climate/icesat2/ and NEVER enter the
repo. The committed artefact is the ~200 KB subset per (ward, granule):

    data/calibration/icesat2/<ward>-<yyyymmdd>-<rgt>.json
      ward, granule, rgt, date, sc_orient, geoidNM, geoidSource, demMedianM,
      counts: {photons_read, conf_land, in_box, ground_candidates, ground_nan},
      trackMinDistM,                    # closest in-box photon to the ward centre
      beams: ["gt1r", ...],
      ph: [[lon, lat, h_ellip, h_ortho, conf, beam_i], ...]

GEOID. ATL03 h_ph is ellipsoidal (WGS84). Everything downstream is orthometric.
h_ortho = h_ellip - N with N below. The two-sided check_geoid() gate REFUSES to
write a subset whose ground disagrees with the ward DEM — so a wrong constant, a
skipped conversion, or broken ground extraction all fail loudly here, not
quietly in the statistics. It raises, it is not caught, and it stops the run:
spec §5.1 calls the gate unbypassable, and a sweep that skipped past it would
publish exactly the ~50 m offset the gate exists to catch.

THE GATE MUST NEVER SEE A NaN. `_icesat2.ground_line` returns NaN outside its
populated span rather than extrapolating flat, and every comparison against NaN
is False — so `check_geoid(nan, ...)` passes BOTH sides and the unbypassable
gate becomes a silent no-op. The median is therefore taken over the finite
values only, an all-NaN line is rejected before the gate, and the NaN count is
recorded in `counts.ground_nan` because spec §5.4 forbids silent exclusions.

STRONG BEAMS ONLY. ATLAS fires 3 strong/weak pairs; which side is strong flips
with spacecraft orientation (sc_orient 0=backward→gt*l strong, 1=forward→gt*r).
That mapping is VERIFIED per granule, twice, not trusted: the beam group's own
`atlas_beam_type` attribute must read "strong", and the chosen beam must carry
>= 2x the photons of its pair partner in our latitude band, else the granule is
rejected with a message naming the count ratio. The attribute is deterministic
and the ratio is statistical; the ratio alone can be fooled by a strong beam
under cloud, so the pair is worth more than either.

THE PLACEHOLDER SEGMENT GEOLOCATION. ATL03's per-segment `reference_photon_lat`
is only the beam's own position where the segment actually holds photons; empty
segments carry a placeholder on a different line entirely. See `beam_slice` —
this one silently mis-slices photon arrays and is the reason that function
filters on `segment_ph_cnt > 0`.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from typing import Any

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import _icesat2  # noqa: E402
from _ecostress import token  # noqa: E402
from _types import WARDS, ward_bounds  # noqa: E402

ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "data", "calibration", "icesat2")
CACHE = os.path.expanduser("~/.cache/delta-climate/icesat2")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

#: EGM2008 undulation N at each ward centre, metres. h_ortho = h_ellip - N.
#:
#: Source: GeographicLib's GeoidEval (EGM2008, 1' grid), retrieved 2026-08-06 —
#: https://geographiclib.sourceforge.io/cgi-bin/GeoidEval, queried with the
#: `_types.WARDS` centres verbatim. Retrieved values, to the four decimals the
#: service returns:
#:     ballygunge  22.5280 N 88.3659 E  ->  -56.9503   (EGM96 -56.8469)
#:     barrackpore 22.7621 N 88.3713 E  ->  -56.8389   (EGM96 -56.7259)
#:     baruipur    22.3654 N 88.4319 E  ->  -56.9582   (EGM96 -56.8798)
#: They agree within 0.12 m across the three wards, and EGM96 corroborates each
#: to within 0.12 m, which is the cross-model check — not a second source.
#: Rounded to 2 dp here: the geoid varies by millimetres across a 1.4 km ward
#: (spec §5.1), so anything finer is false precision, and the gate's tolerance
#: is ±5 m. The check_geoid gate makes a wrong value fatal at runtime.
GEOID_N_M: dict[str, float] = {
    "ballygunge": -56.95, "barrackpore": -56.84, "baruipur": -56.96,
}
for _w, _n in GEOID_N_M.items():
    assert -70.0 < _n < -40.0, f"GEOID_N_M[{_w}]={_n} is not a Kolkata-region EGM2008 value"

#: Ward box padding: catches tracks that clip the corner, spec §3.
PAD_M = 200.0
#: A subset with fewer confident photons than this is monsoon noise, spec §5.2.
MIN_CONF_PH = 100
#: `signal_conf_ph` for the land surface type: 4 high, 3 medium, 2 low, 1 buffer,
#: 0 noise, -1/-2 unassociated/TEP. Spec §3 says "medium or better".
CONF_MIN = 3
#: Column of `signal_conf_ph`'s five surface types that is land. Verified on a
#: real granule: the dataset is (n_photons, 5) and 0 is land.
CONF_LAND_COL = 0
#: Ground candidates below this leave the ground line unconstrained, spec §5.2.
MIN_GROUND_PH = 50
#: A granule that downloads smaller than this is an error page, not data — the
#: same trap `_ecostress.MIN_TIF_BYTES` exists for. ATL03 granules are ~168 MB.
MIN_H5_BYTES = 1_000_000

STRONG = {0: ("gt1l", "gt2l", "gt3l"), 1: ("gt1r", "gt2r", "gt3r")}
PARTNER = {"gt1l": "gt1r", "gt1r": "gt1l", "gt2l": "gt2r",
           "gt2r": "gt2l", "gt3l": "gt3r", "gt3r": "gt3l"}


def cmr_atl03(ward: str) -> list[dict[str, object]]:
    """Every ATL03 v007 granule whose bbox touches the padded ward box.

    One page is enough and that is checked, not assumed: the spec measured 107
    ATL03 granules across all three ward boxes (37/38/32), against a page_size
    of 2000. A silently truncated granule list would bias the sweep invisibly,
    the failure `_ecostress.cmr_search` was rewritten to paginate for.
    """
    bbox = ward_bounds(WARDS[ward], PAD_M)
    r = requests.get(CMR, params={
        "short_name": "ATL03", "version": "007",
        "bounding_box": ",".join(f"{v:.6f}" for v in bbox),
        "page_size": "2000", "sort_key": "-start_date"}, timeout=60)
    r.raise_for_status()
    entries = r.json()["feed"]["entry"]
    hits = int(r.headers.get("CMR-Hits", len(entries)))
    if hits > len(entries):
        sys.exit(f"  CMR reports {hits} granules but returned {len(entries)} — "
                 "the result is paginated and this query is not. Refusing a "
                 "partial granule list.")
    out = []
    for e in entries:
        name = e.get("producer_granule_id") or e["title"]
        url = next((l["href"] for l in e.get("links", [])
                    if l["href"].endswith(".h5") and "data" in l.get("rel", "")), None)
        if url:
            out.append({"name": name, "url": url})
    return out


def download(url: str, name: str, tok: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    dest = os.path.join(CACHE, name)
    if os.path.exists(dest) and os.path.getsize(dest) > MIN_H5_BYTES:
        return dest
    print(f"  downloading {name} …")
    with requests.get(url, headers={"Authorization": f"Bearer {tok}"},
                      stream=True, timeout=900) as r:
        r.raise_for_status()
        tmp = dest + ".part"
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
        if os.path.getsize(tmp) < MIN_H5_BYTES:
            os.remove(tmp)
            sys.exit(f"  {name} downloaded {os.path.getsize(tmp)} bytes — that is "
                     "an error page, not a granule. Check the token's expiry.")
        os.replace(tmp, dest)
    return dest


def beam_slice(f: Any, beam: str, south: float, north: float) -> tuple[int, int]:
    """Photon index range for a latitude band, via the 20 m segment index —
    reads two small per-segment arrays instead of hundreds of thousands of
    photons.

    ONLY SEGMENTS THAT HOLD PHOTONS ARE SELECTED, and that is a correctness fix,
    not an optimisation. Verified on ATL03_20220510191458_07441501_007_01
    (2026-08-06): every segment with `segment_ph_cnt == 0` still carries a
    `reference_photon_lat/lon`, and it is NOT the beam's own position — gt2l's
    empty segments sit on a line 11.6 km east and 1.2 km north of its real
    photons, and all six beams share that same placeholder line. The two
    interleaved sequences make `reference_photon_lat` non-monotonic, so
    `np.where(lat in band)` takes its first and last index off whichever line
    happened to cross the band: measured across the six beams over 576
    ward-sized bands, that picked different endpoints from the correct ones 304
    times. The failure is silent in both directions — a wider range (harmless,
    the lon/lat mask drops the extra) or a truncated one (real photons lost).
    Filtering on `segment_ph_cnt > 0` leaves a strictly monotonic sequence of
    genuine photon latitudes; the returned range then held ONLY in-band photons
    on the same granule (in-band fraction 1.0000).

    The arithmetic is `[0] + cumsum(segment_ph_cnt)`, confirmed exactly on that
    granule: `sum(segment_ph_cnt)` equals the photon count on all six beams, and
    `ph_index_beg` equals `cumsum + 1` on every non-empty segment. The equality
    is re-asserted per beam rather than assumed, because an off-by-one here
    pairs latitudes with the wrong heights and nothing downstream can see it.
    """
    geo = f[beam]["geolocation"]
    cnt = geo["segment_ph_cnt"][:].astype(np.int64)
    seg_lat = geo["reference_photon_lat"][:]
    n_ph = int(f[beam]["heights/lat_ph"].shape[0])
    total = int(cnt.sum())
    if total != n_ph:
        raise ValueError(
            f"{beam}: segment_ph_cnt sums to {total} but the beam holds {n_ph} "
            "photons — the segment index no longer addresses the photon arrays, "
            "and every latitude would be paired with the wrong height")
    sel = np.where((cnt > 0) & (seg_lat >= south) & (seg_lat <= north))[0]
    if sel.size == 0:
        return 0, 0
    starts = np.concatenate([[0], np.cumsum(cnt)])
    return int(starts[sel[0]]), int(starts[sel[-1] + 1])


def beam_type(f: Any, beam: str) -> str:
    """The file's own "strong"/"weak" label for a beam group, or "" if absent."""
    v = f[beam].attrs.get("atlas_beam_type", "")
    return v.decode() if isinstance(v, bytes) else str(v)


def subset(path: str, ward: str) -> dict[str, object] | None:
    import h5py
    w = WARDS[ward]
    west, south, east, north = ward_bounds(w, PAD_M)
    fp = json.load(open(os.path.join(ROOT, "data", "geometry", f"{ward}-footprints.json")))
    rings = [r["p"] for r in fp["b"]]
    dem_median = json.load(open(os.path.join(
        ROOT, "public", "heat-map", "data", f"{ward}-terrain.json")))["medianM"]
    gname = os.path.basename(path)
    m = re.match(r"ATL03_(\d{8})\d{6}_(\d{4})\d{4}_", gname)
    if not m:
        sys.exit(f"  cannot parse granule name {gname}")
    date, rgt = m.group(1), m.group(2)

    rows: list[list[float]] = []
    beams: list[str] = []
    n_read = n_conf = 0
    with h5py.File(path, "r") as f:
        ori = int(f["orbit_info/sc_orient"][0])
        if ori not in STRONG:
            print(f"  {gname}: sc_orient={ori} (transition) — rejected")
            return None
        for beam in STRONG[ori]:
            if beam not in f or "heights" not in f[beam] or "geolocation" not in f[beam]:
                continue
            # verification 1 — the file's own label, against the sc_orient map
            label = beam_type(f, beam)
            if label and label != "strong":
                print(f"  {gname} {beam}: sc_orient={ori} maps this to a strong "
                      f"beam but the granule labels it '{label}' — the "
                      "strong-beam mapping is wrong, rejected")
                return None
            i0, i1 = beam_slice(f, beam, south, north)
            if i1 <= i0:
                continue
            # verification 2 — photon count against the pair partner. Statistical
            # where the label is deterministic, so it also catches a beam that is
            # labelled strong and behaving weak.
            partner = PARTNER[beam]
            p0, p1 = ((0, 0) if partner not in f or "geolocation" not in f[partner]
                      else beam_slice(f, partner, south, north))
            if (i1 - i0) < 2 * max(1, p1 - p0):
                print(f"  {gname} {beam}: only {(i1-i0)}/{max(1,p1-p0)} photons vs "
                      "its pair partner — strong-beam mapping suspect, rejected")
                return None
            g = f[beam]["heights"]
            lat = g["lat_ph"][i0:i1]
            lon = g["lon_ph"][i0:i1]
            h_e = g["h_ph"][i0:i1].astype(np.float64)
            conf = g["signal_conf_ph"][i0:i1, CONF_LAND_COL]
            n_read += int(lat.size)
            keep = (conf >= CONF_MIN) & (lon >= west) & (lon <= east) \
                 & (lat >= south) & (lat <= north)
            n_conf += int(keep.sum())
            if not keep.any():
                continue
            bi = len(beams)
            beams.append(beam)
            h_o = h_e[keep] - GEOID_N_M[ward]
            for a, b_, c, d, e in zip(lon[keep], lat[keep], h_e[keep], h_o, conf[keep]):
                rows.append([round(float(a), 6), round(float(b_), 6),
                             round(float(c), 2), round(float(d), 2), int(e), bi])

    if n_conf < MIN_CONF_PH:
        print(f"  {gname}: {n_conf} confident photons in the box (<{MIN_CONF_PH}) — rejected")
        return None

    ph = np.asarray(rows, dtype=np.float64)
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)
    # ground candidates: outside every footprint dilated by the geolocation error
    dil_idx, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil_idx == -1
    if int(gnd.sum()) < MIN_GROUND_PH:
        print(f"  {gname}: only {int(gnd.sum())} ground candidates — rejected")
        return None
    try:
        gline = _icesat2.ground_line(s, s[gnd], ph[gnd, 3])
    except ValueError as exc:
        # a data-sufficiency rejection (too few populated windows), NOT the geoid
        # gate — which is called below, outside this try, and must stay fatal
        print(f"  {gname}: ground line unusable ({exc}) — rejected")
        return None
    fin = np.isfinite(gline)
    n_nan = int((~fin).sum())
    if not fin.any():
        print(f"  {gname}: every photon fell outside the ground line's populated "
              "span — rejected")
        return None

    # THE GATE: two-sided geoid known-answer check. Raises ValueError on failure
    # and is deliberately not caught. The median is over the FINITE ground line
    # only: np.median of an array holding one NaN is NaN, and check_geoid's
    # `abs(nan - dem) > 5.0` is False, so a NaN would walk straight through the
    # gate the spec calls unbypassable.
    _icesat2.check_geoid(float(np.median(gline[fin])), float(dem_median), GEOID_N_M[ward])

    return {
        "ward": ward, "granule": gname, "rgt": rgt, "date": date, "sc_orient": ori,
        "geoidNM": GEOID_N_M[ward],
        "geoidSource": "EGM2008 via GeographicLib GeoidEval, retrieved 2026-08-06",
        "demMedianM": dem_median,
        "trackMinDistM": round(float(np.min(np.hypot(x, y))), 1),
        "counts": {"photons_read": n_read, "conf_land": n_conf,
                   "in_box": int(ph.shape[0]), "ground_candidates": int(gnd.sum()),
                   "ground_nan": n_nan},
        "beams": beams,
        "ph": rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", choices=sorted(WARDS), default="ballygunge")
    ap.add_argument("--granule", help="process exactly this granule name")
    ap.add_argument("--limit", type=int, default=0, help="stop after N granules")
    ap.add_argument("--purge", action="store_true", help="delete cached .h5 and exit")
    args = ap.parse_args()

    if args.purge:
        for p in glob.glob(os.path.join(CACHE, "*.h5")):
            os.remove(p)
            print(f"  purged {os.path.basename(p)}")
        return

    tok = token()
    grans = cmr_atl03(args.ward)
    print(f"  {len(grans)} ATL03 granules over {args.ward}")
    if args.granule:
        grans = [g for g in grans if g["name"] == args.granule]
        if not grans:
            sys.exit(f"  {args.granule} not in the CMR result for this ward")
    if args.limit:
        grans = grans[: args.limit]

    os.makedirs(OUT_DIR, exist_ok=True)
    written = 0
    for g in grans:
        sub = subset(download(str(g["url"]), str(g["name"]), tok), args.ward)
        if sub is None:
            continue
        out = os.path.join(OUT_DIR, f"{args.ward}-{sub['date']}-{sub['rgt']}.json")
        with open(out, "w") as fh:
            json.dump(sub, fh)
            fh.write("\n")
        kb = os.path.getsize(out) / 1024
        counts: dict[str, int] = sub["counts"]  # type: ignore[assignment]
        print(f"  wrote {os.path.relpath(out, ROOT)}  ({kb:.0f} KB, "
              f"{counts['in_box']} photons, closest {sub['trackMinDistM']} m)")
        written += 1
    print(f"\n  {written} subsets written")


if __name__ == "__main__":
    main()
