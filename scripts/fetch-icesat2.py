"""ICESat-2 ATL03 → ward photon subsets, the only network step in the pipeline.

Spec: docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §3, §5.1.

    python3 scripts/fetch-icesat2.py --ward ballygunge --granule ATL03_20220510191458_07441501_007_01.h5
    python3 scripts/fetch-icesat2.py --ward ballygunge            # every ATL03 granule over the ward
    python3 scripts/fetch-icesat2.py --ward ballygunge --prefilter # probe only, no downloads
    python3 scripts/fetch-icesat2.py --purge                      # delete cached granules
    python3 scripts/fetch-icesat2.py --self-test                  # RangedFile, offline

Needs h5py (`python3 -m pip install h5py`), the one dependency this workstream
adds. It is a RUNTIME dependency, so it is not in requirements-dev.txt — that
file is the type-checking toolchain only, and every other runtime dependency in
this pipeline (rasterio, shapely, scipy) is likewise a documented install.

Granules (~170-450 MB) cache at ~/.cache/delta-climate/icesat2/ and NEVER enter
the repo. The committed artefact is the ~200 KB subset per (ward, granule):

    data/calibration/icesat2/<ward>-<yyyymmdd>-<rgt>.json
      ward, granule, rgt, date, sc_orient, geoidNM, granuleGeoidNM, geoidSource,
      demMedianM, groundMedianM, demOffsetM,
      counts: {photons_read, conf_land, in_box, ground_candidates, ground_nan},
      trackMinDistM,                    # closest in-box photon to the ward centre
      beams: ["gt1r", ...],
      ph: [[lon, lat, h_ellip, h_ortho, conf, beam_i], ...]

ONE DECISION FUNCTION, TWO WAYS IN. `decide()` holds every accept/reject rule —
the confidence/bbox photon filter, the ground-candidate floor, the geoid gate —
and it takes an OPEN h5py file, not a path. The full path hands it a downloaded
file; the prefilter hands it a `RangedFile` over HTTP. Neither re-implements a
single rule, because a prefilter with its own copy of the logic would drift from
the writer's, and the drift would show up as a granule count and read as a
result. If the two ever disagree, it is the file layer, not the science.

THE PREFILTER (--prefilter). The sweep is 35-42 granules per ward, and they are
much bigger than this workstream's notes assume: measured over CMR 2026-08-06,
ATL03 v007 granules over Ballygunge run 285 MB to 1.82 GB, not the ~168 MB the
plan quotes. `decide()` only ever touches the `geolocation/` arrays and a
latitude slice of `heights/`, so HDF5 can be driven over HTTP range requests
instead: measured 28-35 MB and 46-64 s per granule, whatever its size. Verdicts
cache to data/calibration/icesat2-prefilter.json so a re-run does not re-probe,
and the sweep skips anything the probe already rejected. Measured on the first
20 Ballygunge granules, 16 of 20 are rejected without a byte of them being
downloaded — and 2 of the 4 survivors cross no buildings at all.

THE PREFILTER NEVER WRITES A SUBSET, DELIBERATELY. It has the whole subset dict
in hand and could write it and skip the download entirely, which would be
faster still. It does not: every committed subset then comes from bytes on
disk, opened by the same local-file path that produced every earlier one, so a
subtle bug in the ranged reader can cost transfer but can never author a
committed artefact. The prefilter is allowed to say "don't bother", never "here
is the answer".

FSSPEC 404s ON THESE URLS, AND THE REASON IS NOT THE REDIRECT. `icesat2-coverage.py`
reads granules with `fsspec` + h5py; pointed at an NSIDC Cumulus download URL the
same call raises `FileNotFoundError`, which reads exactly like a 404 and invites
the obvious theory — that the `Authorization` header is being carried across
NSIDC's 303 to a signed CloudFront/S3 URL that rejects it. Measured 2026-08-06,
that theory is wrong on both counts. aiohttp DOES forward the header and the
signed host ignores it: a raw aiohttp ranged GET returns HTTP 206 with the
header attached. What actually fails is TLS — aiohttp does not use certifi's CA
bundle the way requests does, so on this machine the connection dies with
`SSLCertVerificationError`, and `fsspec.HTTPFileSystem` converts any
`aiohttp.ClientError` during its size probe into `FileNotFoundError(url)`. The
transport error is erased and replaced by one that names the file. (Passing
`ssl=ssl.create_default_context(cafile=certifi.where())` to `fsspec.filesystem`
fixes it, and is why `icesat2-coverage.py` may work or not depending on the
machine's trust store.) `RangedFile` below uses plain `requests`, which resolves
CA certificates through certifi by default and surfaces the real status code —
this pipeline has already lost a day to `/vsicurl`'s "misleading 404" over the
same class of redirect (see `_ecostress`), and a second reader that hides
transport failures behind a not-found was not worth the convenience.

GEOID. ATL03 h_ph is ellipsoidal (WGS84). Everything downstream is orthometric.
h_ortho = h_ellip - N with N below. The check_geoid() gate REFUSES to write a
subset unless BOTH of the spec's §5.1 tests hold: G1a, our hardcoded N matches
the granule's OWN `geophys_corr/geoid` over the same photons to <=0.5 m; and
G1b, the resulting ground line lands inside the plausible [-2, +25] m
orthometric band. It raises, it is not caught, and it stops the run — in the
prefilter too, which would otherwise become the bypass: spec §5.1 calls the gate
unbypassable, and a sweep that skipped past it would publish exactly the ~50 m
offset the gate exists to catch.

THE DEM IS A MEASUREMENT NOW, NOT THE REFERENCE. The gate used to require the
ground line within ±5 m of `<ward>-terrain.json`'s median; that failed on 15 of
15 usable passes because the artefact is a smoothed SURFACE model ("NOT surveyed
ground", in its own note) sitting metres above true ground over this delta. The
offset is real and is recorded per subset as `demOffsetM` (= demMedianM -
groundMedianM), spec §5.1's terrain-validation win, instead of being spent as
gate noise.

THE GATE MUST NEVER SEE A NaN. `_icesat2.ground_line` returns NaN outside its
populated span rather than extrapolating flat, and over windows its pointwise
relief gate refused (spec §5.1, CORRECTION 2026-08-07 — an unmapped building can
fill a whole window with roof photons and pin the line tens of metres up), and
every comparison against NaN is False. `check_geoid` is written to fail closed on
NaN, but the median is still taken over the finite values only, an all-NaN line
is rejected before the gate, and the counts are recorded in `counts.ground_nan`,
`counts.ground_windows_gated` and `counts.ground_photons_over_gated` because spec
§5.4 forbids silent exclusions.

STRONG BEAMS ONLY, BY THE FILE'S OWN LABEL. ATLAS fires 3 strong/weak pairs;
which side is strong flips with spacecraft orientation (sc_orient 0=backward→
gt*l strong, 1=forward→gt*r). The sc_orient map is checked against each beam
group's `atlas_beam_type` attribute, which is authoritative and must read
"strong" — an absent or disagreeing label rejects the granule.

WHY THERE IS NO PAIR-RATIO CHECK, AND WHY IT MUST NOT COME BACK. This script
originally also demanded that a chosen beam carry >= 2x the photons of its pair
partner in the latitude band. That heuristic was invented before we knew
`atlas_beam_type` exists per beam group; it is redundant against an exact label,
and it was measured falsely rejecting ~15 of 42 granules, including
Barrackpore's richest pass. Two independent failure modes: (1) it vetoed the
WHOLE granule on a strong beam kilometres from the ward that contributes zero
photons to the subset — the ratio there is noise against noise; (2) on daytime
passes the solar background is counted equally in both beams, which compresses
the ratio toward 1 regardless of signal (Barrackpore's best pass died at 1.60x).
The label is deterministic and the ratio is a proxy for it, so the proxy only
ever added false negatives.

Corroborated independently on 2026-08-06 by replaying the old rule over ranged
reads of the geolocation arrays: it vetoes 3 of 12 Barrackpore granules and 0 of
3 Ballygunge ones. Every Barrackpore veto came from the gt2 pair, which
`data/calibration/icesat2-coverage.json` puts 2.2-2.6 km from that ward centre
with ZERO photons within 900 m of it — the beam decided the granule's fate
without contributing a single photon to the subset. One of the three
(2024-05-06, 14:01 local) is a daytime pass whose ratio is squashed to 1.22x.

THE PLACEHOLDER SEGMENT GEOLOCATION. ATL03's per-segment `reference_photon_lat`
is only the beam's own position where the segment actually holds photons; empty
segments carry a placeholder on a different line entirely. See `beam_slice` —
this one silently mis-slices photon arrays and is the reason that function
filters on `segment_ph_cnt > 0`.
"""
from __future__ import annotations

import argparse
import glob
import io
import json
import os
import re
import sys
import time
from functools import lru_cache
from typing import Any, NamedTuple

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
#: Prefilter verdicts. NOT in OUT_DIR: everything there is a committed photon
#: subset named <ward>-<date>-<rgt>.json, and a stray file among them would be
#: swept up by `glob("*.json")` in every downstream reader. It sits beside
#: icesat2-coverage.json instead, with the other whole-sweep artefacts.
PREFILTER_JSON = os.path.join(ROOT, "data", "calibration", "icesat2-prefilter.json")
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

#: An EGM2008 undulation outside this range is a fill value, not a geoid — ATL03
#: writes 3.4028235e+38 where the correction is undefined, and the real global
#: range of the field is -107 to +86 m.
GEOID_VALID_M = (-120.0, 100.0)

#: Ranged-read block size, bytes. A range request against NSIDC Cumulus costs
#: ~2 s of latency and then runs at ~4 MB/s, so bigger blocks buy fewer round
#: trips at the price of reading bytes nothing wants. HDF5's reads here are a
#: handful of small, scattered, individually contiguous regions — three beams'
#: `geolocation/` arrays and one latitude slice of `heights/` — so the block
#: mostly sets how much waste rides along with each of them. Measured on
#: ATL03_20240714172436_04162407 over Ballygunge, 2026-08-06, all four giving
#: byte-identical verdicts:
#:     4 MiB   92.3 MB   23 req   66 s
#:     1 MiB   29.4 MB   28 req   51 s     <- here
#:   512 KiB   19.9 MB   33 req   56 s
#: 4 MiB is NOT the knee it looks like: five extra round trips cost less than
#: the 63 MB of block padding they avoid. Below 1 MiB the round trips start
#: winning again. Against that granule's 444 MB this is a 15x reduction, and the
#: probe cost does not grow with the granule — the biggest one over Ballygunge
#: is 1.82 GB and probes for the same ~30 MB.
RANGE_BLOCK_BYTES = 1 << 20
#: Blocks held per open granule. A probe touches ~35; the cap only exists so a
#: pathological access pattern cannot cache the whole 440 MB file into RAM.
RANGE_CACHE_BLOCKS = 256
#: Seconds before a range request is abandoned. Generous: the first one carries
#: the redirect and the TLS handshake.
RANGE_TIMEOUT_S = 300

STRONG = {0: ("gt1l", "gt2l", "gt3l"), 1: ("gt1r", "gt2r", "gt3r")}


class RangedFile(io.RawIOBase):
    """A read-only, seekable file over HTTP range requests, for h5py.

    h5py's file-object driver only ever calls `seek`/`readinto`, so HDF5 can be
    driven over the network with no local copy: `decide()` touches the
    `geolocation/` arrays and one latitude slice of `heights/`, which is ~38 MB
    of a ~440 MB granule.

    WHY NOT fsspec, WHICH `icesat2-coverage.py` USES. See the module docstring:
    fsspec's HTTP filesystem reports an aiohttp TLS failure as
    `FileNotFoundError(url)`, i.e. as a 404 on a file that is plainly there, and
    this pipeline has already been burned once by a transport error wearing a
    not-found's clothes (`/vsicurl` against LP DAAC). `requests` trusts certifi
    out of the box and reports the real status.

    THE SIGNED URL IS RESOLVED ONCE AND THEN USED WITHOUT THE TOKEN. NSIDC
    answers the download URL with a 303 to a time-limited CloudFront/S3 URL that
    carries its own signature. Re-authenticating on every block would double the
    round trips that dominate the cost, so the signed URL is kept and hit with a
    session that has NO Authorization header — a pre-signed request needs none,
    and some signers reject a request that carries both. When the signature
    expires the signed host answers non-206 and the request is retried through
    the authenticated original, which mints a fresh one.

    Bytes and request counts are tallied on the instance (`bytes_fetched`,
    `requests_made`) so a probe can report what it actually cost.
    """

    def __init__(self, url: str, tok: str, block: int = RANGE_BLOCK_BYTES,
                 cache_blocks: int = RANGE_CACHE_BLOCKS) -> None:
        self._url = url
        self._block = block
        self._cache_blocks = cache_blocks
        self._pos = 0
        self._blocks: dict[int, bytes] = {}
        self.bytes_fetched = 0
        self.requests_made = 0
        self._auth = requests.Session()
        self._auth.headers["Authorization"] = f"Bearer {tok}"
        self._plain = requests.Session()
        r = self._auth.get(url, headers={"Range": "bytes=0-0"},
                           timeout=RANGE_TIMEOUT_S)
        r.raise_for_status()
        cr = r.headers.get("Content-Range", "")
        if r.status_code != 206 or "/" not in cr:
            raise OSError(
                f"{os.path.basename(url)}: the server answered {r.status_code} "
                f"without a Content-Range — it does not support ranged reads, and "
                "reading an HDF5 file without them would pull the whole granule")
        self.size = int(cr.rsplit("/", 1)[1])
        self._signed = r.url
        self.bytes_fetched += len(r.content)
        self.requests_made += 1

    def _fetch(self, start: int, end: int) -> bytes:
        """One range request, [start, end] inclusive, signed URL first."""
        last: requests.Response | None = None
        for attempt in (0, 1):
            url = self._signed if attempt == 0 else self._url
            sess = self._plain if attempt == 0 else self._auth
            last = sess.get(url, headers={"Range": f"bytes={start}-{end}"},
                            timeout=RANGE_TIMEOUT_S)
            self.requests_made += 1
            if last.status_code in (200, 206):
                if attempt == 1:                 # the signature had expired
                    self._signed = last.url
                self.bytes_fetched += len(last.content)
                return last.content
        assert last is not None
        last.raise_for_status()
        raise OSError(f"range {start}-{end} returned {last.status_code}")

    def _ensure(self, b0: int, b1: int) -> None:
        """Fetch any missing blocks in [b0, b1], contiguous runs in one request.

        Eviction happens HERE, before the fetch, and never touches a block the
        caller's current read spans. Evicting inside `_load` instead would be
        the obvious place and is a latent KeyError: a read wide enough to fill
        the cache would drop its own earlier blocks before it had reassembled
        them."""
        excess = len(self._blocks) + (b1 - b0 + 1) - self._cache_blocks
        for b in list(self._blocks):                       # insertion-order FIFO
            if excess <= 0:
                break
            if b0 <= b <= b1:
                continue
            del self._blocks[b]
            excess -= 1
        run: list[int] = []
        for b in range(b0, b1 + 1):
            if b in self._blocks:
                continue
            if run and b != run[-1] + 1:
                self._load(run)
                run = []
            run.append(b)
        if run:
            self._load(run)

    def _load(self, run: list[int]) -> None:
        start = run[0] * self._block
        end = min(self.size, (run[-1] + 1) * self._block) - 1
        data = self._fetch(start, end)
        for i, b in enumerate(run):
            self._blocks[b] = data[i * self._block:(i + 1) * self._block]

    def readinto(self, buf: Any) -> int:
        n = min(len(buf), self.size - self._pos)
        if n <= 0:
            return 0
        b0 = self._pos // self._block
        b1 = (self._pos + n - 1) // self._block
        self._ensure(b0, b1)
        joined = b"".join(self._blocks[b] for b in range(b0, b1 + 1))
        skip = self._pos - b0 * self._block
        buf[:n] = joined[skip:skip + n]
        self._pos += n
        return n

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        if whence == os.SEEK_SET:
            self._pos = offset
        elif whence == os.SEEK_CUR:
            self._pos += offset
        else:
            self._pos = self.size + offset
        return self._pos

    def tell(self) -> int:
        return self._pos

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True


class Decision(NamedTuple):
    """What the shared subset logic concluded about one granule.

    `sub` is the subset ready to be written, or None. `reason` is "" exactly
    when `sub` is not None — it is the printed rejection message, returned
    rather than printed so the prefilter can record WHY a granule was skipped
    instead of re-deriving it. `counts` holds whatever stages ran before the
    decision. `crossed` is how many buildings would clear `MIN_ROOF_PH`, or -1
    if the run stopped before that could be known.
    """
    sub: dict[str, Any] | None
    reason: str
    counts: dict[str, int]
    crossed: int


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


def beam_segments(f: Any, beam: str, south: float,
                  north: float) -> tuple[Any, Any]:
    """The 20 m segments that HOLD PHOTONS inside a latitude band, and the
    per-segment photon counts. Returns (segment indices, segment_ph_cnt) — the
    addressing every other per-segment read in this script goes through, so the
    photon slice and the geoid correction always describe the same segments.

    Reads two small per-segment arrays instead of hundreds of thousands of
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
    genuine photon latitudes; the resulting slice then held ONLY in-band photons
    on the same granule (in-band fraction 1.0000).

    `sum(segment_ph_cnt)` must equal the beam's photon count, and that is
    re-asserted per beam rather than assumed: an off-by-one here pairs latitudes
    with the wrong heights and nothing downstream can see it.
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
    return sel, cnt


def beam_slice(sel: Any, cnt: Any) -> tuple[int, int]:
    """Photon index range spanned by the selected segments, empty as (0, 0).

    The arithmetic is `[0] + cumsum(segment_ph_cnt)`, confirmed exactly on
    ATL03_20220510191458_07441501_007_01: `ph_index_beg` equals `cumsum + 1` on
    every non-empty segment of all six beams."""
    if sel.size == 0:
        return 0, 0
    starts = np.concatenate([[0], np.cumsum(cnt)])
    return int(starts[sel[0]]), int(starts[sel[-1] + 1])


def beam_geoid(f: Any, beam: str, sel: Any) -> Any:
    """The granule's OWN EGM2008 undulation over the selected segments, metres.

    ATL03 carries `geophys_corr/geoid` per 20 m segment, on the same segment
    index as `geolocation/` — asserted here, because an index mismatch would
    compare our constant against a geoid from somewhere else on the orbit and
    the G1a test would be meaningless. Fill values (3.4e+38 where the correction
    is undefined) are dropped; the caller rejects a granule that has none left,
    since the spec's G1a cannot run without them.
    """
    ds = f[beam]["geophys_corr/geoid"]
    n_seg = int(f[beam]["geolocation/segment_ph_cnt"].shape[0])
    if int(ds.shape[0]) != n_seg:
        raise ValueError(
            f"{beam}: geophys_corr/geoid holds {int(ds.shape[0])} values against "
            f"{n_seg} geolocation segments — the two are not on the same index, "
            "so the granule's geoid cannot be read over our photons")
    v = np.asarray(ds[:], dtype=np.float64)[sel]
    lo, hi = GEOID_VALID_M
    return v[np.isfinite(v) & (v >= lo) & (v <= hi)]


def beam_type(f: Any, beam: str) -> str:
    """The file's own "strong"/"weak" label for a beam group, or "" if absent."""
    v = f[beam].attrs.get("atlas_beam_type", "")
    return v.decode() if isinstance(v, bytes) else str(v)


@lru_cache(maxsize=None)
def ward_geometry(ward: str) -> tuple[tuple[tuple[float, ...], ...], float]:
    """Footprint rings (ward metres) and the DEM median for a ward.

    Cached because the sweep re-reads them once per granule and the footprint
    file is thousands of rings; tuples rather than lists so the cached value
    cannot be mutated by one caller under another's feet."""
    fp = json.load(open(os.path.join(ROOT, "data", "geometry",
                                     f"{ward}-footprints.json")))
    dem = json.load(open(os.path.join(
        ROOT, "public", "heat-map", "data", f"{ward}-terrain.json")))["medianM"]
    return tuple(tuple(float(v) for v in r["p"]) for r in fp["b"]), float(dem)


def decide(f: Any, gname: str, ward: str) -> Decision:
    """THE subset decision for one granule, from an already-open h5py file.

    Every accept/reject rule in this pipeline lives here and nowhere else: the
    strong-beam label, the confidence/bbox photon filter, `MIN_CONF_PH`,
    `MIN_GROUND_PH`, the ground line's own sufficiency check, and the §5.1 geoid
    gate. The full download path and the ranged prefilter both call this
    function with different file objects, which is the whole point — a prefilter
    holding a second copy of these rules would drift from the writer's, and a
    drifting granule count is indistinguishable from a finding.

    Takes an OPEN file, not a path, because that is the only seam between "read
    440 MB from disk" and "read 38 MB over HTTP". Raises ValueError from
    `check_geoid` on a gate failure — deliberately not caught here or by either
    caller (spec §5.1: unbypassable).
    """
    w = WARDS[ward]
    west, south, east, north = ward_bounds(w, PAD_M)
    rings = [list(r) for r in ward_geometry(ward)[0]]
    dem_median = ward_geometry(ward)[1]
    m = re.match(r"ATL03_(\d{8})\d{6}_(\d{4})\d{4}_", gname)
    if not m:
        sys.exit(f"  cannot parse granule name {gname}")
    date, rgt = m.group(1), m.group(2)

    rows: list[list[float]] = []
    beams: list[str] = []
    geoid_vals: list[Any] = []
    n_read = n_conf = 0
    counts: dict[str, int] = {}

    ori = int(f["orbit_info/sc_orient"][0])
    if ori not in STRONG:
        return Decision(None, f"sc_orient={ori} (transition)", counts, -1)
    for beam in STRONG[ori]:
        if beam not in f or "heights" not in f[beam] or "geolocation" not in f[beam]:
            continue
        # THE strong-beam check: the granule's own label, which is
        # authoritative and exact. There is deliberately no second,
        # pair-ratio check — see the module docstring for the two ways it
        # produced false rejections (~15 of 42 granules), and do not
        # reinstate it.
        label = beam_type(f, beam)
        if label != "strong":
            return Decision(None, (
                f"{beam}: sc_orient={ori} maps this to a strong beam but the "
                f"granule labels it {('missing' if not label else repr(label))} "
                "— the strong-beam mapping is wrong"), counts, -1)
        sel, cnt = beam_segments(f, beam, south, north)
        i0, i1 = beam_slice(sel, cnt)
        if i1 <= i0:
            continue
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
        # G1a's reference: the granule's own EGM2008 undulation over exactly
        # the segments these photons came from
        geoid_vals.append(beam_geoid(f, beam, sel))
        h_o = h_e[keep] - GEOID_N_M[ward]
        for a, b_, c, d, e in zip(lon[keep], lat[keep], h_e[keep], h_o, conf[keep]):
            rows.append([round(float(a), 6), round(float(b_), 6),
                         round(float(c), 2), round(float(d), 2), int(e), bi])

    counts = {"photons_read": n_read, "conf_land": n_conf}
    if n_conf < MIN_CONF_PH:
        return Decision(None, f"{n_conf} confident photons in the box "
                              f"(<{MIN_CONF_PH})", counts, -1)

    ph = np.asarray(rows, dtype=np.float64)
    counts["in_box"] = int(ph.shape[0])
    x, y = _icesat2.to_local(w, ph[:, 0], ph[:, 1])
    s = _icesat2.along_track(x, y)
    # ground candidates: outside every footprint dilated by the geolocation error
    dil_idx, _ = _icesat2.assign_footprints(x, y, rings, +_icesat2.ERODE_M)
    gnd = dil_idx == -1
    counts["ground_candidates"] = int(gnd.sum())
    if int(gnd.sum()) < MIN_GROUND_PH:
        return Decision(None, f"only {int(gnd.sum())} ground candidates", counts, -1)
    gstats: _icesat2.GroundLineStats = {}
    try:
        gline = _icesat2.ground_line(s, s[gnd], ph[gnd, 3], stats=gstats)
    except ValueError as exc:
        # a data-sufficiency rejection (too few populated windows, before or
        # after the pointwise relief gate), NOT the geoid gate — which is called
        # below, outside this try, and must stay fatal
        return Decision(None, f"ground line unusable ({exc})", counts, -1)
    fin = np.isfinite(gline)
    n_nan = int((~fin).sum())
    counts["ground_nan"] = n_nan
    # §5.4 again, split by cause: the relief gate's refusals are not the same
    # exclusion as falling outside the line's populated span, and a single total
    # would let an unmapped-building excursion read as a short track.
    counts["ground_windows_gated"] = int(gstats["n_windows_gated"])
    counts["ground_photons_over_gated"] = int(gstats["photons_over_gated_windows"])
    if not fin.any():
        return Decision(None, "every photon fell outside the ground line's "
                              "populated span", counts, -1)

    pooled = np.concatenate(geoid_vals) if geoid_vals else np.empty(0)
    if pooled.size == 0:
        return Decision(None, "no usable geophys_corr/geoid values over the ward "
                              "— the spec's G1a cannot be run", counts, -1)
    granule_geoid = float(np.median(pooled))
    ground_median = float(np.median(gline[fin]))

    # THE GATE (spec §5.1). G1a: our constant against the granule's own geoid.
    # G1b: the ground line inside the plausible orthometric band. Raises
    # ValueError on failure and is deliberately not caught. The median is over
    # the FINITE ground line only — np.median of an array holding one NaN is NaN,
    # and although check_geoid fails closed on NaN, a NaN here would reject good
    # data for the wrong reason.
    _icesat2.check_geoid(ground_median, GEOID_N_M[ward], granule_geoid)

    # Not a criterion — a report. How many buildings this granule would actually
    # contribute to the n >= 30 bar, computed here so the prefilter and the
    # writer quote the same number rather than two implementations of it.
    ero_idx, _ = _icesat2.assign_footprints(x, y, rings, -_icesat2.ERODE_M)
    crossed = len(_icesat2.building_heights(ero_idx, ph[:, 3] - gline))

    return Decision({
        "ward": ward, "granule": gname, "rgt": rgt, "date": date, "sc_orient": ori,
        "geoidNM": GEOID_N_M[ward],
        "granuleGeoidNM": round(granule_geoid, 3),
        "geoidSource": "EGM2008 via GeographicLib GeoidEval, retrieved 2026-08-06",
        "demMedianM": dem_median,
        "groundMedianM": round(ground_median, 2),
        # The same median taken BEFORE the pointwise relief gate — the quantity
        # every subset written before that gate existed carries in
        # `groundMedianM`. `measure-height-accuracy.py`'s drift recheck asks
        # whether the photons or the committed footprints have moved under a
        # subset, so it must compare like with like; without this field the
        # recheck would fire on every existing subset because the ALGORITHM
        # improved, which is the one thing it is not meant to detect.
        "groundMedianUngatedM": round(float(gstats["median_ungated_m"]), 2),
        # MEASUREMENT, not a gate: the shipped relief surface is a DSM and sits
        # above laser ground over this delta (spec §5.1's terrain-validation win)
        "demOffsetM": round(float(dem_median) - ground_median, 2),
        "trackMinDistM": round(float(np.min(np.hypot(x, y))), 1),
        "counts": dict(counts),
        "beams": beams,
        "ph": rows,
    }, "", counts, crossed)


def subset(path: str, ward: str) -> Decision:
    """`decide()` over a downloaded granule — the path that writes subsets."""
    import h5py
    with h5py.File(path, "r") as f:
        return decide(f, os.path.basename(path), ward)


def probe(url: str, name: str, ward: str, tok: str) -> dict[str, Any]:
    """`decide()` over HTTP range requests — the same verdict, no download.

    Returns a JSON-able record for the prefilter cache. A probe that fails for
    TRANSPORT reasons records `probeError` and no verdict, because "the network
    hiccuped" must never be cached as "this granule is unusable" — the sweep
    treats an unknown granule as worth downloading, so a blip costs bandwidth,
    never a silently missing pass.

    The error string is truncated at the first '?': a signed CloudFront URL
    carries its signature in the query string, and although that is not our
    Earthdata token it is still a credential and does not belong in a committed
    artefact.
    """
    import h5py
    t0 = time.monotonic()
    rf: RangedFile | None = None
    rec: dict[str, Any] = {"ward": ward, "granule": name}
    try:
        rf = RangedFile(url, tok)
        with h5py.File(rf, "r") as f:
            dec = decide(f, name, ward)
    except (requests.RequestException, OSError) as exc:
        rec["probeError"] = f"{type(exc).__name__}: {str(exc).split('?')[0][:200]}"
        rec["probeSeconds"] = round(time.monotonic() - t0, 1)
        return rec
    finally:
        if rf is not None:
            rec["probeBytes"] = rf.bytes_fetched
            rec["probeRequests"] = rf.requests_made
            rf.close()
    rec.update({
        "usable": dec.sub is not None,
        "reason": dec.reason,
        "counts": dec.counts,
        "crossed": dec.crossed,
        "probeSeconds": round(time.monotonic() - t0, 1),
    })
    if dec.sub is not None:
        for k in ("rgt", "date", "trackMinDistM", "groundMedianM", "demOffsetM"):
            rec[k] = dec.sub[k]
    return rec


def load_prefilter() -> dict[str, Any]:
    """The cached verdicts, keyed "<ward>/<granule>" — empty on first run."""
    if not os.path.exists(PREFILTER_JSON):
        return {}
    d = json.load(open(PREFILTER_JSON))
    g: dict[str, Any] = d.get("granules", {})
    return g


def save_prefilter(granules: dict[str, Any]) -> None:
    out = {
        "retrieved": "2026-08-06",
        "blockBytes": RANGE_BLOCK_BYTES,
        "note": ("Verdicts from `fetch-icesat2.py --prefilter`: `decide()` run "
                 "over HTTP range requests instead of a downloaded granule, so "
                 "the sweep can skip granules the subset writer would reject "
                 "without moving 0.3-1.8 GB each. Same function, same rules — a "
                 "prefilter with its own copy of the logic would drift, and the "
                 "drift would read as a result. `usable` false means the writer "
                 "rejects it for `reason`; `crossed` is how many buildings would "
                 "clear MIN_ROOF_PH, reported, never used as a criterion. A "
                 "record with `probeError` is an unknown, not a rejection, and "
                 "the sweep still downloads it."),
        "granules": dict(sorted(granules.items())),
    }
    os.makedirs(os.path.dirname(PREFILTER_JSON), exist_ok=True)
    with open(PREFILTER_JSON, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")


def describe(rec: dict[str, Any]) -> str:
    """One line of prefilter verdict, for the console."""
    if "probeError" in rec:
        return f"probe FAILED ({rec['probeError']}) — will download"
    c = rec.get("counts", {})
    stage = (f"{c.get('conf_land', 0)} conf, "
             f"{c.get('ground_candidates', '-')} ground")
    if rec.get("usable"):
        return (f"KEEP   {stage}, gate PASS, {rec['crossed']} buildings crossed, "
                f"closest {rec['trackMinDistM']} m")
    return f"SKIP   {stage} — {rec['reason']}"


def _self_test() -> None:
    """Byte-exactness of `RangedFile`, offline — no network, no token.

    THE ONE THING THE SHARED-LOGIC DESIGN CANNOT CATCH. Everything else the
    prefilter does is `decide()`, the same function the writer runs, so the two
    cannot disagree about the science. The block cache underneath is the
    exception: an off-by-one in the block arithmetic would hand h5py subtly
    wrong bytes, and HDF5 would either raise something unrelated or — worse —
    decode a plausible number. So the reader is checked against a buffer whose
    every byte is known, including the two cases the arithmetic gets wrong first:
    a read straddling a block boundary, and an eviction that would drop a block
    the in-flight read still needs.

        python3 scripts/fetch-icesat2.py --self-test
    """
    rng = np.random.default_rng(4)
    buf = rng.integers(0, 256, 300_000, dtype=np.uint8).tobytes()

    class _Memory(RangedFile):
        """RangedFile with the HTTP leg replaced by a slice of `buf`."""

        def __init__(self, block: int, cache_blocks: int) -> None:
            self._url, self._block, self._cache_blocks = "mem://", block, cache_blocks
            self._pos, self._blocks = 0, {}
            self.bytes_fetched = self.requests_made = 0
            self.size = len(buf)

        def _fetch(self, start: int, end: int) -> bytes:
            self.requests_made += 1
            self.bytes_fetched += end - start + 1
            return buf[start:end + 1]

    f = _Memory(1024, 64)
    assert f.read(10) == buf[:10], "read from offset 0 is wrong"
    f.seek(1020)
    assert f.read(8) == buf[1020:1028], "read straddling a block boundary is wrong"
    f.seek(-5, os.SEEK_END)
    assert f.read(99) == buf[-5:], "SEEK_END / short read at EOF is wrong"
    f.seek(0)
    assert f.read() == buf, "whole-file read is wrong"
    assert f.tell() == len(buf)

    # contiguous blocks coalesce into ONE request, which is the entire point of
    # the block cache on a link where latency dominates
    g = _Memory(1024, 64)
    g.seek(2048)
    g.read(4096)
    assert g.requests_made == 1, f"4 fresh blocks cost {g.requests_made} requests"
    g.seek(2048)
    g.read(4096)
    assert g.requests_made == 1, "a fully cached read went back to the network"

    # a read wider than the whole cache must still be exact: eviction has to
    # spare every block the current read spans, so the cache holds exactly that
    # read's span and no more ...
    h = _Memory(1024, 2)
    h.seek(500)
    assert h.read(20_000) == buf[500:20_500], "eviction corrupted a wide read"
    assert len(h._blocks) == 21, f"wide read cached {len(h._blocks)} blocks, not its span"
    # ... and the next narrow read is where the overspill is finally reclaimed,
    # so the cache cannot grow without bound across a granule
    h.seek(100_000)
    assert h.read(16) == buf[100_000:100_016], "read after eviction is wrong"
    assert len(h._blocks) <= 2, f"cache stuck at {len(h._blocks)} blocks over its cap"

    print("  fetch-icesat2 RangedFile self-test OK")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ward", choices=sorted(WARDS), default="ballygunge")
    ap.add_argument("--granule", help="process exactly this granule name")
    ap.add_argument("--limit", type=int, default=0, help="stop after N granules")
    ap.add_argument("--purge", action="store_true", help="delete cached .h5 and exit")
    ap.add_argument("--prefilter", action="store_true",
                    help="probe granules over HTTP range requests and record the "
                         "verdicts; downloads and writes nothing")
    ap.add_argument("--no-prefilter", action="store_true",
                    help="download every granule, ignoring the prefilter verdicts")
    ap.add_argument("--reprobe", action="store_true",
                    help="re-probe granules that already have a cached verdict")
    ap.add_argument("--self-test", action="store_true",
                    help="check RangedFile against a known buffer; no network")
    args = ap.parse_args()

    if args.self_test:
        _self_test()
        return

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

    verdicts = load_prefilter()

    if args.prefilter:
        kept = probed = 0
        for g in grans:
            key = f"{args.ward}/{g['name']}"
            rec = verdicts.get(key)
            if rec is not None and "probeError" not in rec and not args.reprobe:
                print(f"  {g['name']}  (cached) {describe(rec)}")
            else:
                try:
                    rec = probe(str(g["url"]), str(g["name"]), args.ward, tok)
                except ValueError:
                    # the geoid gate. Keep what we learned, then let it stop the
                    # run exactly as it stops the writer — spec §5.1.
                    save_prefilter(verdicts)
                    raise
                verdicts[key] = rec
                probed += 1
                save_prefilter(verdicts)         # crash-safe: one granule at most
                print(f"  {g['name']}  {describe(rec)}"
                      f"  [{rec.get('probeBytes', 0) / 1e6:.0f} MB, "
                      f"{rec.get('probeRequests', 0)} req, {rec['probeSeconds']:.0f} s]")
            kept += int(bool(rec.get("usable")) or "probeError" in rec)
        save_prefilter(verdicts)
        mb = sum(r.get("probeBytes", 0) for r in verdicts.values()) / 1e6
        print(f"\n  {kept}/{len(grans)} granules survive the prefilter "
              f"({probed} newly probed, {mb:.0f} MB of range reads so far)")
        print(f"  written to {os.path.relpath(PREFILTER_JSON, ROOT)}")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    written = skipped = 0
    for g in grans:
        key = f"{args.ward}/{g['name']}"
        if not args.no_prefilter:
            rec = verdicts.get(key)
            if rec is None or args.reprobe:
                rec = probe(str(g["url"]), str(g["name"]), args.ward, tok)
                verdicts[key] = rec
                save_prefilter(verdicts)
            # only a definite rejection skips: a probe that errored is an
            # unknown, and an unknown is downloaded rather than dropped
            if "probeError" not in rec and not rec.get("usable"):
                print(f"  {g['name']}: prefiltered out — {rec['reason']}")
                skipped += 1
                continue
        dec = subset(download(str(g["url"]), str(g["name"]), tok), args.ward)
        if dec.sub is None:
            print(f"  {g['name']}: {dec.reason} — rejected")
            # The two paths run the SAME function, so a granule the probe kept
            # and the writer rejected means the ranged reader handed h5py
            # different bytes. Say so here rather than let it pass as one more
            # rejected granule, which is what it would otherwise look like.
            if not args.no_prefilter and verdicts.get(key, {}).get("usable"):
                print("    ^ PREFILTER DISAGREES: it read this granule as usable. "
                      "Same decide(), different bytes — suspect RangedFile, and "
                      "re-run with --no-prefilter before trusting the sweep.")
            continue
        sub = dec.sub
        out = os.path.join(OUT_DIR, f"{args.ward}-{sub['date']}-{sub['rgt']}.json")
        with open(out, "w") as fh:
            json.dump(sub, fh)
            fh.write("\n")
        kb = os.path.getsize(out) / 1024
        counts: dict[str, int] = sub["counts"]
        print(f"  wrote {os.path.relpath(out, ROOT)}  ({kb:.0f} KB, "
              f"{counts['in_box']} photons, closest {sub['trackMinDistM']} m, "
              f"ground {sub['groundMedianM']} m, "
              f"DEM sits {sub['demOffsetM']:+.2f} m above it, "
              f"{dec.crossed} buildings crossed)")
        written += 1
    print(f"\n  {written} subsets written, {skipped} prefiltered out")


if __name__ == "__main__":
    main()
