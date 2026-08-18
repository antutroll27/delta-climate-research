#!/usr/bin/env python3
"""Verify the NGSI-LD entities actually resolve against their declared @context.

"Entities resolve against the declared @context" is the readiness-checklist item
(§13.2), and it is only worth claiming if something checks it. A JSON-LD document
fails SILENTLY: a term the context does not define is simply dropped during
expansion, so a typo'd attribute name vanishes from the graph without any error.
That is exactly the class of failure this repo keeps finding, so it is tested
rather than assumed.

The check expands each entity with a real JSON-LD processor and asserts that
EVERY term reaches a fully-qualified IRI -- nothing dropped, nothing left as a
bare string. It also pins the NGSI-LD structural requirements: a URN id, a type,
and every attribute carrying Property / Relationship / GeoProperty.

The ETSI core context is cached under ~/.cache/delta-climate/ngsi-ld/ so the gate
does not depend on uri.etsi.org being reachable, the same treatment the CityJSON
schemas get.

    python3 scripts/check-ngsi-ld.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

from pyld import jsonld

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIST = os.path.join(ROOT, "dist", "api", "ngsi-ld")
CACHE = os.path.expanduser("~/.cache/delta-climate/ngsi-ld")
CORE_URL = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.7.jsonld"
CORE_FILE = os.path.join(CACHE, "ngsi-ld-core-context-v1.7.jsonld")

#: NGSI-LD attribute kinds. Anything else in an attribute position is a modelling
#: error, not a stylistic one -- a broker would reject it.
ATTR_TYPES = {"Property", "Relationship", "GeoProperty"}


def _cached_loader() -> Any:
    """Document loader that serves the ETSI core context from disk."""
    if not os.path.exists(CORE_FILE) or os.path.getsize(CORE_FILE) < 100:
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["curl", "-sL", "-m", "60", "-A", "Mozilla/5.0", "-o", CORE_FILE, CORE_URL], check=True)
    with open(CORE_FILE, encoding="utf-8") as fh:
        core = json.load(fh)
    default = jsonld.get_document_loader()

    def loader(url: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        if url.startswith("https://uri.etsi.org/ngsi-ld/v1/"):
            return {"contentType": "application/ld+json", "contextUrl": None,
                    "documentUrl": url, "document": core}
        return default(url, options or {})

    return loader


def check_entity(path: str) -> list[str]:
    with open(path, encoding="utf-8") as fh:
        doc: dict[str, Any] = json.load(fh)
    issues: list[str] = []

    eid = doc.get("id", "")
    if not isinstance(eid, str) or not (eid.startswith("urn:") or eid.startswith("http")):
        issues.append(f"id {eid!r} is not a URI/URN")
    if not doc.get("type"):
        issues.append("entity has no type")
    if "@context" not in doc:
        issues.append("entity declares no @context")

    for k, v in doc.items():
        if k.startswith("@") or k in ("id", "type"):
            continue
        if not isinstance(v, dict):
            issues.append(f"attribute {k!r} is a bare value; NGSI-LD attributes are objects")
        elif v.get("type") not in ATTR_TYPES:
            issues.append(f"attribute {k!r} has type {v.get('type')!r}, expected one of {sorted(ATTR_TYPES)}")

    expanded = jsonld.expand(doc)
    if not expanded:
        issues.append("document expanded to nothing -- the context did not resolve")
        return issues
    got = set(expanded[0])
    # every declared term must survive expansion as a real IRI
    for k in doc:
        if k.startswith("@") or k in ("id", "type"):
            continue
        if not any(k in iri for iri in got):
            issues.append(f"term {k!r} was DROPPED during expansion -- not defined by the @context")
    for iri in got:
        if not iri.startswith("@") and "://" not in iri:
            issues.append(f"{iri!r} did not expand to an absolute IRI")
    return issues


def main() -> int:
    if not os.path.isdir(DIST):
        print("  no dist/api/ngsi-ld -- run `npm run build` first")
        return 1
    jsonld.set_document_loader(_cached_loader())
    files = sorted(os.path.join(DIST, "entities", f)
                   for f in os.listdir(os.path.join(DIST, "entities")) if f.endswith(".jsonld"))
    bad = 0
    for p in files:
        issues = check_entity(p)
        print(f"  {'ok  ' if not issues else 'FAIL'} {os.path.relpath(p, ROOT)}")
        for i in issues:
            print(f"        {i}")
        bad += bool(issues)
    print("  all entities resolve against their @context" if not bad else f"  {bad} entity/entities FAILED")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
