"""Acquire the OpenCity datasets, and record what we are allowed to do with them.

ONE TABLE, ONE ROW PER RESOURCE. Adding a dataset later is a row, not a script.
The catalogue is CKAN, so every resource is {dataset_id, resource_id} and the
download URL is derivable — nothing here has to be hand-copied except the ids.

WHY THE MANIFEST MATTERS MORE THAN THE FILES. Two of these carry a licence that
permits publication and one does not state a licence at all. That distinction
does not survive in a folder of CSVs, and "we forgot to ask" quietly becomes
"public domain" the first time someone reaches for a dataset months from now. So
every artefact gets a manifest row carrying its source URL, retrieval date,
licence and sha256, plus BLOCKERS: the specific facts someone must establish
before the data may be displayed. --check refuses to pass if a blocked row is
marked displayable.

Raw archives stay here in data/opencity/ and never enter public/. The browser
gets derived artefacts only — that rule is asserted, not just intended.

    python3 scripts/fetch-opencity.py            # download + write the manifest
    python3 scripts/fetch-opencity.py --check    # verify hashes, licences, blockers
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from typing import Any, NamedTuple

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DATA_DIR = os.path.join(ROOT, "data", "opencity")
MANIFEST = os.path.join(DATA_DIR, "manifest.json")

CKAN = "https://data.opencity.in/dataset/{dataset}/resource/{resource}/download"

#: Constant, not date.today(): the manifest must regenerate byte-identically or
#: --check cannot separate a real source change from the calendar moving.
RETRIEVED = "2026-08-03"

#: The literal a licence field takes when the publisher states none. Never an
#: empty string and never absent — an absent licence reads as "fine to use", and
#: for a consultancy deliverable that assumption is the expensive one.
NOT_STATED = "not stated"


class Resource(NamedTuple):
    """One downloadable artefact and everything we know about using it."""
    id: str                     # stable key, also the manifest key
    dataset: str                # CKAN dataset uuid
    resource: str               # CKAN resource uuid
    path: str                   # repo-relative destination
    licence: str
    notes: str
    blockers: tuple[str, ...] = ()

    @property
    def url(self) -> str:
        return CKAN.format(dataset=self.dataset, resource=self.resource)

    @property
    def display(self) -> bool:
        """A blocked artefact may be held, studied and cited — not rendered."""
        return not self.blockers


AQI_DATASET = "3a0c1c28-dbd2-42f0-8d76-7acb0b2f9e18"

#: Seven WBPCB stations, 2017-2023 hourly. Ballygunge is one of the three wards
#: the model simulates, which is the whole point: a multi-year measured record
#: standing beside a modelled ward. The other six give it context.
AQI_STATIONS: tuple[tuple[str, str], ...] = (
    ("ballygunge", "251013c7-808c-4c24-955f-67e27445b5f8"),
    ("bidhannagar", "ad9debfa-aa31-4776-bd67-c7419b34f42d"),
    ("fort-william", "a6cf271a-bee4-434e-a844-4b080b651158"),
    ("jadavpur", "40843135-dbcc-467a-9672-91d2beff390b"),
    ("rabindra-bharati", "8b972781-07fa-4f8a-a4ab-a35494384d53"),
    ("rabindra-sarobar", "caf1333b-6684-479a-864e-bf20bf5f0884"),
    ("victoria", "538a8db9-88b8-4fb1-ac1d-90aa29f6a041"),
)

PUBLIC_DOMAIN = "Public Domain"

DATASETS: tuple[Resource, ...] = (
    Resource(
        id="imd-kolkata-daily",
        dataset="e57cd149-fd78-4853-80b8-47d3d082845e",
        resource="2f2fd6a8-cfad-4648-989c-08272d01982b",
        path="data/opencity/imd-kolkata-daily.csv",
        licence=PUBLIC_DOMAIN,
        notes=(
            "IMD Kolkata daily Date/Rain/Temp Max/Temp Min, 74 years. Downloaded by "
            "scripts/build-heatwave-percentiles.py, which owns its derivation and "
            "asserts 26,806 rows / 26,747 usable; it is listed here so the ONE "
            "archive that feeds a SERVED artefact (heatwave-percentiles.json) is "
            "hash-pinned like every other, rather than being the exception."
        ),
    ),
    Resource(
        id="microwatersheds",
        dataset="e6360adc-99b7-42b8-8c4d-7d6d8ec2bd20",
        resource="a53210e3-28c3-4154-a104-2152b3889492",
        path="data/opencity/microwatersheds.geojson",
        licence=PUBLIC_DOMAIN,
        notes=(
            "535 catchment polygons. All three wards verified inside a containing "
            "polygon by point-in-polygon: Ballygunge MWS 2A1A5k3, Baruipur 2A1A5h3, "
            "Barrackpore 2A1C1a5, all basin 2A. BUT the median polygon is ~5-8x the "
            "196 ha ward window, so this is CITY-SCALE DRAINAGE CONTEXT and not a "
            "finer layer for the heat map. It is a second instrument with its own "
            "route and its own spec; acquisition only here."
        ),
    ),
    Resource(
        id="water-census",
        dataset="d9c9b5e1-01e2-4fa4-8c7c-ff335d327f96",
        resource="8b4faaae-746e-4079-8d08-93c54fa04956",
        path="data/opencity/water-census.kml",
        licence=PUBLIC_DOMAIN,
        notes=(
            "Jal Dharohar census 2018-19. 3,051 records, ZERO polygons — points "
            "only, so it cannot supply water geometry; that comes from OSM "
            "(scripts/fetch-water.py). Coverage is KMC-only: nearest record is "
            "11.4 km from Baruipur and 14.5 km from Barrackpore, and just one "
            "falls inside Ballygunge's window. What it uniquely carries is "
            "attributes OSM lacks — water_spread_area, storage capacity, max "
            "depth — for a future join on the Ballygunge polygons."
        ),
    ),
    Resource(
        id="kmc-parks",
        dataset="a940e732-e38e-49ba-b0bb-33aea7deddf2",
        resource="4640f53a-9cbe-4bb9-8595-fb3593f70c25",
        path="data/opencity/kmc-parks.csv",
        licence=NOT_STATED,
        notes=(
            "93 KMC parks, keyed by KMC ward number. Of our three wards only "
            "Ballygunge is inside KMC — Baruipur and Barrackpore are separate "
            "municipalities — so an indicator built from this can score one ward "
            "of three, which kills the DC-URS route considered for it. Recorded "
            "so nobody retries it."
        ),
        blockers=(
            "licence not stated by the publisher — confirm before any client-facing use",
            "Area column units unstated and present on only 34 of 93 rows",
        ),
    ),
) + tuple(
    Resource(
        id=f"aqi-{station}",
        dataset=AQI_DATASET,
        resource=resource,
        path=f"data/opencity/aqi/{station}.csv",
        licence=PUBLIC_DOMAIN,
        notes=(
            f"WBPCB hourly air quality, 2017-2023, {station.replace('-', ' ')} station."
            + (" THIS STATION IS A MODELLED WARD — a measured multi-year record "
               "beside a simulated one." if station == "ballygunge" else "")
        ),
    )
    for station, resource in AQI_STATIONS
)


# ── pure helpers ────────────────────────────────────────────────────────────

def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def count_records(path: str) -> int | None:
    """Rows for CSV, features for GeoJSON, placemarks for KML. None if unknown.

    A byte count says a file arrived; a record count says it arrived intact.
    """
    lower = path.lower()
    try:
        if lower.endswith(".csv"):
            with open(path, encoding="utf-8-sig", errors="replace") as handle:
                return max(0, sum(1 for _ in handle) - 1)     # minus the header
        if lower.endswith(".geojson"):
            with open(path, encoding="utf-8") as handle:
                return len(json.load(handle).get("features", []))
        if lower.endswith(".kml"):
            with open(path, encoding="utf-8", errors="replace") as handle:
                return handle.read().count("<Placemark")
    except Exception:
        return None
    return None


def describe(resource: Resource) -> dict[str, Any]:
    """One manifest row, from the file on disk plus what we know about its use."""
    absolute = os.path.join(ROOT, resource.path)
    return {
        "path": resource.path,
        "source_url": resource.url,
        "retrieved": RETRIEVED,
        "licence": resource.licence,
        "sha256": sha256_of(absolute),
        "bytes": os.path.getsize(absolute),
        "records": count_records(absolute),
        "notes": resource.notes,
        "blockers": list(resource.blockers),
        "display": resource.display,
    }


def serialise(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2) + "\n"


# ── effectful edge ──────────────────────────────────────────────────────────

def download(resource: Resource) -> None:
    absolute = os.path.join(ROOT, resource.path)
    if os.path.exists(absolute):
        return
    os.makedirs(os.path.dirname(absolute), exist_ok=True)
    response = requests.get(resource.url, timeout=300)
    response.raise_for_status()
    with open(absolute, "wb") as handle:
        handle.write(response.content)
    print(f"    {resource.id:<22} {os.path.getsize(absolute):>10,} B")
    time.sleep(1)                                   # be polite to the catalogue


# ── commands ────────────────────────────────────────────────────────────────

def build_manifest() -> dict[str, Any]:
    return {
        "generated_by": "scripts/fetch-opencity.py",
        "catalogue": "https://data.opencity.in",
        "retrieved": RETRIEVED,
        "note": (
            "Raw acquisition. Nothing here is served to the browser — derived "
            "artefacts go to public/heat-map/data/. A row with a non-empty "
            "blockers list must not be displayed until those facts are settled."
        ),
        "artefacts": {r.id: describe(r) for r in DATASETS},
    }


def check() -> int:
    if not os.path.exists(MANIFEST):
        print("  MISSING manifest — run without --check first")
        return 1
    with open(MANIFEST, encoding="utf-8") as handle:
        doc = json.load(handle)
    artefacts = doc["artefacts"]
    failures: list[str] = []

    for resource in DATASETS:
        row = artefacts.get(resource.id)
        if row is None:
            failures.append(f"{resource.id}: absent from the manifest")
            continue
        absolute = os.path.join(ROOT, row["path"])
        if not os.path.exists(absolute):
            failures.append(f"{resource.id}: file missing on disk")
            continue
        # 1 · drift — the bytes on disk must be the bytes we recorded
        if sha256_of(absolute) != row["sha256"]:
            failures.append(f"{resource.id}: sha256 drift, the file changed under the manifest")
        # 2 · a licence is always stated, even when the statement is "not stated"
        if not row.get("licence"):
            failures.append(f"{resource.id}: licence field empty — say '{NOT_STATED}' explicitly")
        # 3 · blocked means blocked
        if row["blockers"] and row["display"]:
            failures.append(f"{resource.id}: has blockers but is marked displayable")
        # 4 · nothing raw is served
        if row["path"].startswith("public/"):
            failures.append(f"{resource.id}: raw archive under public/ — serve a derived artefact")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1

    blocked = [r.id for r in DATASETS if r.blockers]
    print(f"  {len(DATASETS)} artefacts · hashes match · licences stated · "
          f"{len(blocked)} blocked from display ({', '.join(blocked) or 'none'})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify hashes, licences and display blockers")
    if parser.parse_args().check:
        return check()

    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"  downloading {len(DATASETS)} artefacts")
    for resource in DATASETS:
        download(resource)
    with open(MANIFEST, "w", encoding="utf-8") as handle:
        handle.write(serialise(build_manifest()))
    print(f"  manifest -> {os.path.relpath(MANIFEST, ROOT)}")
    return check()


if __name__ == "__main__":
    sys.exit(main())
