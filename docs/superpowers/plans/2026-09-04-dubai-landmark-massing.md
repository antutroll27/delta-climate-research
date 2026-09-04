# Dubai Landmark Massing and Height Correction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dubai Creek scene correct heights for every major building and real
three-dimensional form for its icons, without changing a single footprint.

**Architecture:** Two phases against one artefact. Phase A replaces the height join in
`fetch-dubai-wikidata.py` — currently nearest-centroid within 90 m, and wrong about a fifth
of what it touches — with a name-agreement join, then applies the CC0 Wikidata and CTBUH
layers. Phase B adds a tracked recipe file and a set of parametric form builders that loft
the *measured* OSM footprint into a landmark's real silhouette, emitted as separate Blender
objects. A footprint-invariance gate runs throughout, because footprints are the only
building data the flood physics reads.

**Tech Stack:** Python 3.12 (strict mypy, `python3 -m mypy` over all of `scripts/`),
Blender 4.x `bpy`, Overpass and Wikidata SPARQL (both cached on disk), Node for the
repo's `npm run verify` gate.

**Spec:** `docs/superpowers/specs/2026-09-04-dubai-landmark-massing-design.md`

---

## Before you start

**Branch.** All work happens on a branch off `feat/flood-sim`:

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad/.claude/worktrees/flood-sim
git checkout -b feat/dubai-landmarks feat/flood-sim
```

**The network is not needed and must not be used.** Every Overpass and Wikidata response
this plan depends on is already cached under `data/.cache/`. `fetch-dubai-heights.py` reads
`data/.cache/osm/dubai-creek-a2cd3452-osm-buildings.json` (90 MB, fetched 25 Aug) and
`fetch-dubai-wikidata.py` reads `data/.cache/wikidata/dubai-creek-a2cd3452-wikidata.json`.
Re-running them is therefore deterministic. **If a fetcher starts hitting the network, stop
— the window key has changed and the cache has silently missed.**

**Strict typing is not optional.** Every `.py` in `scripts/` must pass
`python3 -m mypy` with no arguments (the config sets `files = scripts`, deliberately, so
nobody can check a subset and declare victory). Run it after every Python task.

**The artefact is 42 MB and tracked.** `public/flood-sim/data/dubai-creek-buildings.json`
is committed to git. Regenerating it produces a large diff; that is expected and correct.

**Phase A alone is shippable.** If work must stop, stop after Task 7. The heights will be
correct and the scene will simply still be boxes.

---

## File Structure

| file | responsibility |
|---|---|
| `scripts/check-dubai-footprints.py` | **new.** The safety net. Hashes every footprint ring in the artefact against a committed baseline. Fails if any ring moved. Nothing else in this plan is safe without it. |
| `scripts/_flood.py` | **modify.** Gains `norm_name()` and `NAME_ALIASES` — shared vocabulary for the join, used by both the fetcher and its checks. |
| `scripts/fetch-dubai-heights.py` | **modify, one line.** Persists the OSM element id on each `osmB` record, giving every later step a stable handle. |
| `scripts/fetch-dubai-wikidata.py` | **modify.** Replaces the nearest-centroid join with name agreement; adds the join gates to `check()`. |
| `public/flood-sim/data/dubai-creek-landmarks.json` | **new.** The tracked recipe file. Authored, small, reviewable. |
| `scripts/blender_landmarks.py` | **new.** One form builder per family. Pure geometry: takes a measured ring plus params, returns verts and faces. No `bpy` import, so it is testable outside Blender. |
| `scripts/blender_dubai.py` | **modify.** Suppresses recipe-covered footprints and emits each landmark as its own named object. |
| `package.json` | **modify.** Wires `check:footprints` into `verify`. |

`blender_landmarks.py` deliberately does not import `bpy`. Blender's Python is not the
system Python, and a module that needs Blender to run cannot be unit tested. Keeping the
geometry pure means Task 9's builders are testable with `python3` directly, and
`blender_dubai.py` does the `bpy` object creation.

---

# Phase A — heights

## Task 1: The footprint-invariance gate

This comes first because every later task edits the artefact, and footprints are the only
building data the flood physics reads (`scripts/fetch-dubai-terrain.py:202` masks buildings
out of the DSM using the rings, so rain does not pond on rooftops). If a ring moves, the
flood model changes and nobody notices.

**Files:**
- Create: `scripts/check-dubai-footprints.py`
- Create: `public/flood-sim/data/dubai-footprint-baseline.json`

- [ ] **Step 1: Write the checker**

Create `scripts/check-dubai-footprints.py`:

```python
"""Footprint rings are the physics boundary. This asserts nothing crossed it.

`fetch-dubai-terrain.py` is the ONLY place building data reaches the flood
solve: it reads the footprint rings and masks buildings out of the DSM so rain
does not pond on rooftops. It reads `p`. It does not read heights, parts or
massing.

So the whole landmark and height programme rests on one rule -- add geometry,
never move a footprint -- and this turns that rule from a promise into a gate.
A baseline of ring hashes is committed alongside the artefact; any drift fails.

    python3 scripts/check-dubai-footprints.py            # verify
    python3 scripts/check-dubai-footprints.py --rebase   # accept a deliberate change
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
BASELINE = os.path.join(DATA, "dubai-footprint-baseline.json")
SITES = ("dubai-creek", "dubai-south")


def ring_digest(doc: dict[str, Any]) -> str:
    """One hash over every ring in the document, in document order.

    Order matters: a reordering would move geometry relative to the height and
    name that sit beside it in the same record, so it is a real change even
    though the set of rings is unchanged.
    """
    h = hashlib.sha256()
    for key in ("b", "osmB", "parts"):
        for rec in doc.get(key, []):
            h.update(b"|")
            for v in rec["p"]:
                h.update(f"{v:.2f}".encode())
    return h.hexdigest()


def digests() -> dict[str, str]:
    out: dict[str, str] = {}
    for sid in SITES:
        path = os.path.join(DATA, f"{sid}-buildings.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            out[sid] = ring_digest(json.load(fh))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebase", action="store_true",
                        help="accept the current footprints as the new baseline")
    args = parser.parse_args()

    now = digests()
    if args.rebase or not os.path.exists(BASELINE):
        with open(BASELINE, "w", encoding="utf-8") as fh:
            json.dump({"note": "sha256 over every footprint ring; see "
                               "scripts/check-dubai-footprints.py",
                       "digests": now}, fh, indent=2)
            fh.write("\n")
        print(f"  baseline written for {len(now)} site(s)")
        return 0

    with open(BASELINE, encoding="utf-8") as fh:
        want: dict[str, str] = json.load(fh)["digests"]

    failures = []
    for sid, digest in now.items():
        if sid not in want:
            failures.append(f"{sid}: no baseline -- run --rebase if this site is new")
        elif want[sid] != digest:
            failures.append(f"{sid}: FOOTPRINTS MOVED. The flood solve reads these rings.")
    for sid in want:
        if sid not in now:
            failures.append(f"{sid}: artefact missing but baselined")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    print(f"  footprints unchanged across {len(now)} site(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Record the baseline from the current, untouched artefact**

Run:
```bash
cd /Volumes/VSTSAMPLES/Projects/Angad/.claude/worktrees/flood-sim
git status --short public/flood-sim/data/   # MUST be empty; if not, git checkout first
python3 scripts/check-dubai-footprints.py
```
Expected: `baseline written for 2 site(s)`

- [ ] **Step 3: Verify it passes against an unchanged artefact**

Run: `python3 scripts/check-dubai-footprints.py`
Expected: `footprints unchanged across 2 site(s)`, exit 0

- [ ] **Step 4: Mutation-check it — a gate that cannot fail is not a gate**

Run:
```bash
python3 - <<'EOF'
import json
p = 'public/flood-sim/data/dubai-creek-buildings.json'
d = json.load(open(p))
d['osmB'][0]['p'][0] += 0.01          # move one vertex by one centimetre
json.dump(d, open(p, 'w'), separators=(',', ':'))
EOF
python3 scripts/check-dubai-footprints.py; echo "EXIT: $?"
git checkout -- public/flood-sim/data/dubai-creek-buildings.json
python3 scripts/check-dubai-footprints.py; echo "EXIT: $?"
```
Expected: first run prints `FAIL dubai-creek: FOOTPRINTS MOVED` and `EXIT: 1`;
second run prints `footprints unchanged` and `EXIT: 0`.

- [ ] **Step 5: Typecheck**

Run: `python3 -m mypy`
Expected: `Success: no issues found in N source files`

- [ ] **Step 6: Wire it into the repo gate**

In `package.json`, add to `"scripts"`:
```json
"check:footprints": "python3 scripts/check-dubai-footprints.py",
```
and insert `&& npm run check:footprints` into `"verify"` immediately after
`npm run check:fresh`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-dubai-footprints.py public/flood-sim/data/dubai-footprint-baseline.json package.json
git commit -m "test(flood-sim): footprints are the physics boundary, so gate them

fetch-dubai-terrain.py is the only place building data reaches the flood solve,
and it reads the rings alone. Everything the landmark work adds is geometry
beside them. This hashes every ring so 'the solve is unaffected' is a check
rather than a claim. Mutation-tested: moving one vertex by a centimetre fails it."
```

---

## Task 2: Persist the OSM element id

Without this there is no stable handle on a building. Coordinate proximity is not a
substitute — during the investigation it attached a 328 m tower to a metro station.

**Files:**
- Modify: `scripts/fetch-dubai-heights.py:342`

- [ ] **Step 1: Add the id to each OSM outline record**

In `scripts/fetch-dubai-heights.py`, find:

```python
        rec: dict[str, Any] = {"p": flat, "roof": tags.get("roof:shape", "flat")}
```

Replace with:

```python
        # THE ARTEFACT HAD NO STABLE HANDLE ON A BUILDING. Records carried only
        # {p, roof, name}, so anything wanting to say "this footprint is the Burj
        # Al Arab" had to match on coordinates -- which, on long concave plans and
        # against approximate landmark points, silently picks the neighbour. It
        # put a 328 m height on a metro station during the investigation that led
        # here. `w12700546` is unambiguous and survives a re-fetch.
        rec: dict[str, Any] = {"id": f"{el['type'][0]}{el['id']}",
                               "p": flat, "roof": tags.get("roof:shape", "flat")}
```

- [ ] **Step 2: Regenerate the artefact from the cache**

Run:
```bash
python3 scripts/fetch-dubai-heights.py --site dubai-creek 2>&1 | tail -8; echo "EXIT: ${PIPESTATUS[0]}"
```
Expected: exit 0. **If this takes more than about a minute or prints anything about
contacting Overpass, stop** — it should be reading `data/.cache/osm/`.

- [ ] **Step 3: Confirm footprints did not move**

Run: `python3 scripts/check-dubai-footprints.py`
Expected: `footprints unchanged across 2 site(s)`

This is the point of Task 1. A regeneration that moved geometry would be caught here.

- [ ] **Step 4: Confirm the ids are present, well-formed and unique**

Run:
```bash
python3 - <<'EOF'
import json, re
d = json.load(open('public/flood-sim/data/dubai-creek-buildings.json'))
ids = [r.get('id') for r in d['osmB']]
assert all(ids), f"{sum(1 for i in ids if not i)} records have no id"
assert all(re.fullmatch(r'[wnr]\d+', i) for i in ids), "malformed id"
assert len(set(ids)) == len(ids), f"{len(ids) - len(set(ids))} duplicate ids"
print(f"OK: {len(ids):,} outlines, all with unique ids, e.g. {ids[0]}")
bk = [r for r in d['osmB'] if r.get('name') == 'برج خليفة']
print("Burj Khalifa id:", bk[0]['id'] if bk else "NOT FOUND")
EOF
```
Expected: `OK: 165,763 outlines, all with unique ids` and `Burj Khalifa id: w446646206`

- [ ] **Step 5: Typecheck and commit**

```bash
python3 -m mypy
git add scripts/fetch-dubai-heights.py public/flood-sim/data/dubai-creek-buildings.json
git commit -m "feat(flood-sim): OSM outlines keep their element id

Records carried {p, roof, name} and nothing else, so identifying a building
meant matching on coordinates. That is how a 328 m height reached a metro
station. An id is unambiguous and survives a re-fetch. Footprint gate green."
```

---

## Task 3: Shared name vocabulary

The join needs one normalisation and one alias table, used identically by the fetcher and
by its checks. Putting them in `_flood.py` beside `CTBUH_LANDMARKS` keeps them together.

**Files:**
- Modify: `scripts/_flood.py`

- [ ] **Step 1: Add the normaliser and the alias table**

Append to `scripts/_flood.py`, after the `CTBUH_LANDMARKS` list:

```python
def norm_name(raw: str | None) -> str:
    """Casefold to alphanumerics, keeping non-Latin scripts.

    Arabic matters here: OSM names much of Dubai in Arabic while Wikidata labels
    it in English, so a normaliser that stripped non-ASCII would erase one side
    of the comparison entirely and turn every Arabic-named building into an
    unverifiable match.
    """
    import unicodedata
    s = unicodedata.normalize("NFKC", raw or "").casefold()
    return "".join(ch for ch in s if ch.isalnum())


# NAMES THAT LOOK DIFFERENT AND ARE THE SAME BUILDING. Every pair here was
# produced by auditing a real run of fetch-dubai-wikidata.py against the OSM
# names in the artefact, then read by hand. Arabic/English pairs dominate;
# the rest are transliteration and house-style differences.
#
# This table only ever ACCEPTS a match. It cannot create one that the audit did
# not already surface, and adding a wrong pair here is the one way to reintroduce
# the defect this join exists to fix -- so a new entry needs the two names read
# side by side, not a guess.
NAME_ALIASES: list[tuple[str, str]] = [
    ("برج خليفة", "Burj Khalifa"),
    ("برج العرب جميرا", "Burj al-Arab"),
    ("متحف المستقبل", "Museum of the Future"),
    ("برواز دبي", "Dubai Frame"),
    ("فندق جيفورا", "Gevora Hotel"),
    ("بوليفارد", "Address Boulevard"),
    ("برج الماس", "Almas Tower"),
    ("إل بريمو", "Il Primo Tower"),
    ("فندق العنوان داون تاون", "Address Downtown"),
    ("مارينا بيناكل", "Marina Pinnacle"),
    ("فندق أتلانتس", "Atlantis The Palm"),
    ("JW Marriott Marquis Hotel", "JW Marriott Marquis Dubai"),
    ("The Torch", "The Marina Torch"),
    ("Rose Rayhaan by Rotana", "Rose Tower"),
    ("Millenium Tower", "Millennium Tower"),
    ("Al Hikma Tower", "Al Hekma Tower"),
]

_ALIAS_INDEX: dict[str, set[str]] = {}
for _a, _b in NAME_ALIASES:
    _na, _nb = norm_name(_a), norm_name(_b)
    _ALIAS_INDEX.setdefault(_na, set()).add(_nb)
    _ALIAS_INDEX.setdefault(_nb, set()).add(_na)


def names_agree(osm: str | None, source: str | None) -> bool:
    """Do an OSM name and a Wikidata/CTBUH label denote the same building?

    Substring containment is allowed because "Emirates Tower One" and "Emirates
    Tower One Hotel" are the same tower. It is also why the alias table is a
    list of read pairs rather than a fuzzy matcher: containment plus fuzz would
    have accepted "Marina 106" for "Marina Arcade Tower", which is exactly the
    kind of near-miss that put a 445 m height on a 254 m building.
    """
    a, b = norm_name(osm), norm_name(source)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    return b in _ALIAS_INDEX.get(a, set())
```

- [ ] **Step 2: Verify the vocabulary against the audit fixture**

Run:
```bash
python3 - <<'EOF'
import sys; sys.path.insert(0, 'scripts')
from _flood import names_agree

MUST_ACCEPT = [
    ("Princess Tower", "Princess Tower"),
    ("23 Marina", "23 Marina"),
    ("Cayan Tower", "Cayan Tower"),
    ("برج خليفة", "Burj Khalifa"),
    ("برج الماس", "Almas Tower"),
    ("Millenium Tower", "Millennium Tower"),
    ("The Torch", "The Marina Torch"),
]
MUST_REJECT = [
    ("Marina Arcade Tower", "Marina 106"),
    ("Al Fattan Currency House", "Lighthouse Tower"),
    ("Skyview Bar", "Burj al-Arab"),
    ("Al Seef Tower", "Ocean Heights"),
    ("Thmanyah", "Emirates Towers"),
    ("Business Central Towers", "Al Kazim Towers"),
    ("Voco Hotel and Nassima Towers", "Acico Twin Towers"),
    ("Bugatti Residences", "Vision Tower"),
    ("ذا كورت", "JW Marriott Marquis Dubai"),
]
bad = [p for p in MUST_ACCEPT if not names_agree(*p)]
bad += [p for p in MUST_REJECT if names_agree(*p)]
for osm, src in bad:
    print(f"  WRONG: {osm!r} vs {src!r}")
print("FAIL" if bad else f"OK: {len(MUST_ACCEPT)} accepted, {len(MUST_REJECT)} rejected")
EOF
```
Expected: `OK: 7 accepted, 9 rejected`

- [ ] **Step 3: Typecheck and commit**

```bash
python3 -m mypy
git add scripts/_flood.py
git commit -m "feat(flood-sim): name agreement, because distance cannot arbitrate a height join

37 of 42 Wikidata points fall outside the footprint they belong to -- including
the correct ones, since Wikidata building coordinates are good to only 40-80 m.
Point-in-polygon would reject Princess Tower, 23 Marina and Cayan, all right.
Ocean Heights fell inside Al Seef Tower and is still wrong. Names decide.

The alias table is read pairs, not fuzz: fuzz would accept 'Marina 106' for
'Marina Arcade Tower', which is how a 254 m building got 445 m."
```

---

## Task 4: Replace the join

**Files:**
- Modify: `scripts/fetch-dubai-wikidata.py:141-155` (Wikidata attach) and `:165-180` (CTBUH attach)

- [ ] **Step 1: Add the shared import**

At the top of `scripts/fetch-dubai-wikidata.py`, change:

```python
from _flood import CTBUH_LANDMARKS, SITES, Site, m_per_deg, site_bounds, window_key  # noqa: E402
```

to:

```python
from _flood import (CTBUH_LANDMARKS, SITES, Site, m_per_deg, names_agree,  # noqa: E402
                    site_bounds, window_key)
```

- [ ] **Step 2: Replace the Wikidata attachment loop**

Find the block beginning `# Attach to whichever outline contains or sits nearest the point.`
and ending with the line `attached += 1`. Replace the whole block with:

```python
    # ATTACH BY NAME, NOT BY DISTANCE. The previous loop took the nearest
    # centroid within MATCH_RADIUS_M, and an audit of a real run found roughly
    # nine of 42 attachments on the wrong building: Marina 106's 445 m on the
    # 254 m Marina Arcade Tower, Ocean Heights' 310 m on Al Seef Tower, and the
    # Burj Al Arab's 321 m on the Skyview Bar -- a room inside it.
    #
    # Geometry cannot fix this. 37 of those 42 points fall OUTSIDE the footprint
    # they belong to, because Wikidata coordinates are approximate to 40-80 m, so
    # a containment test would reject Princess Tower, 23 Marina and Cayan Tower,
    # all correctly matched from outside. And containment does not imply
    # correctness: Ocean Heights fell inside Al Seef Tower and was still wrong.
    #
    # So: names decide, distance only breaks ties between name-agreeing
    # candidates, one footprint per item, and an unnamed footprint is skipped
    # rather than guessed. A wrong height on a named landmark is worse than none.
    attached = 0
    unverifiable = 0
    for lm in landmarks:
        best, best_d = None, MATCH_RADIUS_M
        for arr in (doc.get("osmB", []), doc["b"]):
            for rec in arr:
                if rec.get("hs") in ("wikidata", "ctbuh"):
                    continue           # already claimed by another item
                if not names_agree(rec.get("name"), lm["name"]):
                    continue
                xs, ys = rec["p"][0::2], rec["p"][1::2]
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                d = ((cx - lm["x"]) ** 2 + (cy - lm["y"]) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = rec, d
        if best is None:
            unverifiable += 1
            continue
        best["h"] = lm["h"]
        best["hs"] = "wikidata"
        best["wd"] = lm["name"]
        attached += 1
    print(f"  wikidata: {attached} attached by name, {unverifiable} unmatched")
```

- [ ] **Step 3: Replace the CTBUH attachment loop the same way**

Find the CTBUH loop (it begins `for name, lat, lon, height in CTBUH_LANDMARKS:`) and replace
its candidate search — the nested `for arr` / `for rec` block — with the same name-gated
form:

```python
    for name, lat, lon, height in CTBUH_LANDMARKS:
        lx, ly = (lon - site.lon) * mx, (lat - site.lat) * my
        best, best_d = None, MATCH_RADIUS_M
        for arr in (doc.get("osmB", []), doc["b"]):
            for rec in arr:
                if rec.get("hs") == "ctbuh":
                    continue           # one footprint per CTBUH entry
                if not names_agree(rec.get("name"), name):
                    continue
                xs, ys = rec["p"][0::2], rec["p"][1::2]
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                d = ((cx - lx) ** 2 + (cy - ly) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = rec, d
        if best is not None:
            was = float(best.get("h", 0.0))
```

Leave everything after `was = float(best.get("h", 0.0))` unchanged.

- [ ] **Step 4: Widen the tie-break radius**

`MATCH_RADIUS_M` is now only a tie-break among name-agreeing candidates, so 90 m is
needlessly tight — Wikidata points sit up to 133 m from their building in this window.
In `scripts/fetch-dubai-wikidata.py`, change:

```python
MATCH_RADIUS_M = 90.0
```

to:

```python
# Only a tie-break now that names decide the match, so it can be generous:
# Wikidata points sit up to 133 m from their own building in this window, and
# tightening it was never what made the join wrong.
MATCH_RADIUS_M = 250.0
```

- [ ] **Step 5: Typecheck**

Run: `python3 -m mypy`
Expected: `Success: no issues found in N source files`

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-dubai-wikidata.py
git commit -m "fix(flood-sim): heights attach by name, and one footprint per item

Nearest-centroid put Marina 106's 445 m on the 254 m Marina Arcade Tower, Ocean
Heights' 310 m on Al Seef Tower, and the Burj Al Arab's 321 m on the Skyview
Bar, a room inside it. It also let one item claim several footprints -- JW
Marriott Marquis attached to three at 355 m each, which is two phantom towers.

Distance is demoted to a tie-break among name-agreeing candidates, and its
radius widened to 250 m because tightening it was never the fix. An unnamed
footprint is now skipped: a wrong height on a named landmark is worse than none."
```

---

## Task 5: The join gates

`check()` already asserts Burj Khalifa reaches 828 m and that nothing outgrows it. It does
not notice a height landing on the wrong building, which is the failure that actually
happened.

**Files:**
- Modify: `scripts/fetch-dubai-wikidata.py:205-232` (inside `check()`)

- [ ] **Step 1: Add the two gates**

In `check()`, immediately after the existing line:

```python
        if any(r["h"] > BURJ_KHALIFA_M + 1 for r in wdh):
            failures.append(f"{sid}: a building taller than Burj Khalifa survived the filter")
```

insert:

```python
        # THE GATE THAT WOULD HAVE CAUGHT THE REAL DEFECT. Every existing check
        # here asks whether the heights are plausible. None asked whether they
        # landed on the right building, and that is the failure that happened.
        crossed = [r for r in wdh
                   if r.get("name") and not names_agree(r.get("name"), r.get("wd"))]
        for r in crossed[:5]:
            failures.append(f"{sid}: {r['h']} m from {r.get('wd')!r} landed on "
                            f"{r.get('name')!r} -- different buildings")
        if len(crossed) > 5:
            failures.append(f"{sid}: and {len(crossed) - 5} more crossed attachments")

        # One source item, one footprint. JW Marriott Marquis Dubai previously
        # claimed three at 355 m each, which renders as two towers that do not
        # exist.
        claims: dict[str, int] = {}
        for r in wdh:
            label = r.get("wd")
            if label:
                claims[label] = claims.get(label, 0) + 1
        for label, n in sorted(claims.items()):
            if n > 1:
                failures.append(f"{sid}: {label!r} claims {n} footprints -- "
                                f"phantom towers")
```

Note `wd` is set on Wikidata attachments only; CTBUH attachments set `hs == "ctbuh"` and
are covered because the CTBUH branch also writes `wd` — confirm this while implementing, and
if it does not, add `best["wd"] = name` to the CTBUH branch beside `best["hs"] = "ctbuh"`.

- [ ] **Step 2: Make `check()` tolerate an unbuilt site**

`check()` loops over every site in `SITES` and fails on `dubai-south`, which has never had
the height layer applied. That masks real failures behind a known one. Change:

```python
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        wd = d.get("wikidata")
        if not wd:
            failures.append(f"{sid}: no wikidata block")
            continue
```

to:

```python
    for sid in SITES:
        with open(os.path.join(OUT_DIR, f"{sid}-buildings.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        wd = d.get("wikidata")
        if not wd:
            # A site that has never had the layer applied is not a failure, it is
            # a site that has not been built. Failing here masked every real
            # check behind a known-absent dubai-south.
            print(f"  skip {sid}: no wikidata block yet")
            continue
```

- [ ] **Step 3: Typecheck and commit**

```bash
python3 -m mypy
git add scripts/fetch-dubai-wikidata.py
git commit -m "test(flood-sim): the height checks never asked if it was the right building

Every gate in check() asked whether a height was plausible. None asked whether
it landed on the building it belongs to, which is the failure that happened --
Marina 106's 445 m sat on a 254 m tower and passed every check. Two gates now:
no crossed attachment, and no source item claiming more than one footprint.

check() also stopped failing on dubai-south for never having had the layer
applied, which was masking every other check behind a known absence."
```

---

## Task 6: Apply the corrected heights

**Files:**
- Modify: `public/flood-sim/data/dubai-creek-buildings.json` (regenerated)

- [ ] **Step 1: Run the fetcher**

Run:
```bash
python3 scripts/fetch-dubai-wikidata.py --site dubai-creek 2>&1 | tail -12; echo "EXIT: ${PIPESTATUS[0]}"
```
Expected: exit 0, with lines resembling `wikidata: N attached by name, M unmatched`,
`skip dubai-south: no wikidata block yet`, and no `FAIL` lines.

The attached count will be **lower** than the 42 the broken join produced. That is the
point: the twelve attachments to unnamed footprints and the nine crossed ones are gone.
Expect roughly 15–25.

- [ ] **Step 2: Confirm footprints did not move**

Run: `python3 scripts/check-dubai-footprints.py`
Expected: `footprints unchanged across 2 site(s)`

- [ ] **Step 3: Verify against the audit fixture**

Run:
```bash
python3 - <<'EOF'
import json, sys; sys.path.insert(0, 'scripts')
from _flood import names_agree
d = json.load(open('public/flood-sim/data/dubai-creek-buildings.json'))
recs = list(d['b']) + list(d.get('osmB', []))
att = [r for r in recs if r.get('hs') in ('wikidata', 'ctbuh')]

BANNED = {  # (OSM name, source label) pairs the old join produced and this must not
    ('Marina Arcade Tower', 'Marina 106'),
    ('Al Fattan Currency House', 'Lighthouse Tower'),
    ('Skyview Bar', 'Burj al-Arab'),
    ('Al Seef Tower', 'Ocean Heights'),
    ('Thmanyah', 'Emirates Towers'),
    ('Business Central Towers', 'Al Kazim Towers'),
    ('Voco Hotel and Nassima Towers', 'Acico Twin Towers'),
    ('Bugatti Residences', 'Vision Tower'),
}
found = [(r.get('name'), r.get('wd')) for r in att if (r.get('name'), r.get('wd')) in BANNED]
crossed = [r for r in att if r.get('name') and not names_agree(r.get('name'), r.get('wd'))]
claims = {}
for r in att:
    if r.get('wd'):
        claims[r['wd']] = claims.get(r['wd'], 0) + 1
dupes = {k: v for k, v in claims.items() if v > 1}

print(f"attached: {len(att)}")
print(f"  banned pairs present : {found or 'none'}")
print(f"  crossed attachments  : {len(crossed)}")
print(f"  items claiming >1    : {dupes or 'none'}")
bk = [r['h'] for r in att if names_agree(r.get('name'), 'Burj Khalifa')]
print(f"  Burj Khalifa height  : {bk}")
assert not found and not crossed and not dupes, "FIXTURE FAILED"
assert bk and abs(bk[0] - 828.0) < 0.1, "Burj Khalifa is not 828 m"
print("OK")
EOF
```
Expected: `banned pairs present : none`, `crossed attachments : 0`,
`items claiming >1 : none`, `Burj Khalifa height : [828.0]`, `OK`

- [ ] **Step 4: Look at what actually changed**

Run:
```bash
python3 - <<'EOF'
import json, subprocess
old = json.loads(subprocess.run(
    ['git', 'show', 'HEAD:public/flood-sim/data/dubai-creek-buildings.json'],
    capture_output=True, text=True).stdout)
new = json.load(open('public/flood-sim/data/dubai-creek-buildings.json'))
ch = [(b.get('name') or b.get('wd') or '—', a.get('h'), b.get('h'))
      for a, b in zip(old['osmB'], new['osmB']) if a.get('h') != b.get('h')]
print(f"{len(ch)} heights changed\n")
for nm, o, n in sorted(ch, key=lambda t: -(float(t[2]) if t[2] else 0)):
    print(f"  {(float(o) if o else 0):7.1f} -> {float(n):7.1f}   {nm[:44]}")
EOF
```
Expected: Burj Khalifa `652.0 -> 828.0` present. **Read the whole list before continuing.**
Every row must be a building you can name and a height you would defend. This is a human
check and it is the last one before the numbers become part of the scene.

- [ ] **Step 5: Commit**

```bash
git add public/flood-sim/data/dubai-creek-buildings.json
git commit -m "feat(flood-sim): CC0 heights for the Creek, joined by name

Burj Khalifa 652 -> 828. The 652 was not a mystery: OSM carries no height tag
on w446646206, only building:levels=163, and the fallback is levels x 4.0.

Fewer attachments than the broken join made, deliberately -- the twelve that
landed on unnamed footprints are dropped rather than guessed, and the nine that
crossed to a different building are refused. Footprint gate green."
```

---

## Task 7: Phase A verification

- [ ] **Step 1: Run the full repo gate**

Run:
```bash
npm run verify > /tmp/verify-a.log 2>&1; echo "EXIT: $?"
tail -30 /tmp/verify-a.log
```
Expected: `EXIT: 0`.

**Do not pipe this through `tail` alone** — the pipeline's exit code would be `tail`'s, not
npm's, and a failing gate would read as a pass.

- [ ] **Step 2: If `check:fresh` fails**

`scripts/check-artefacts-fresh.py` compares artefact mtimes against their inputs. The
regenerated buildings file is newer than its cache, which is correct. Read its failure
message; if it is complaining about ordering that this task legitimately changed, re-run
the fetchers in the order the message names. Do not edit the freshness rules to pass.

- [ ] **Step 3: Commit any resulting artefact updates**

```bash
git add -A public/flood-sim/data/
git commit -m "chore(flood-sim): artefact freshness after the height join"
```

Phase A is complete and shippable here.

---

# Phase B — landmark massing

## Task 8: The recipe file

**Files:**
- Create: `public/flood-sim/data/dubai-creek-landmarks.json`

- [ ] **Step 1: Write the recipe file**

```json
{
  "site": "dubai-creek",
  "provenance": "Massing is AUTHORED and is not a measurement. Plans and positions are measured (OpenStreetMap, ODbL 1.0). Heights are cited facts. A render of these landmarks must never be offered as evidence for a number.",
  "landmarks": [
    {
      "osm": "w12700546",
      "name": "Burj Al Arab",
      "form": "sail",
      "height": 321.0,
      "heightSource": "CTBUH, architectural top",
      "params": {
        "apexVertex": 10,
        "expDepth": 2.8,
        "expWidth": 2.0,
        "massFraction": 0.88,
        "mastRadius": 3.0,
        "helipadZ": 212.0,
        "helipadRadius": 12.5
      }
    },
    {
      "osm": "w195527255",
      "name": "Cayan Tower",
      "form": "twist",
      "height": 306.4,
      "heightSource": "CTBUH; OSM height tag agrees",
      "params": { "twistDeg": 90.0, "levels": 30 }
    },
    {
      "osm": "w10316322",
      "name": "Jumeirah Beach Hotel",
      "form": "wave",
      "height": 104.0,
      "heightSource": "OSM height tag",
      "params": { "expDepth": 1.4, "expWidth": 1.0, "leanM": 18.0, "levels": 24 }
    }
  ]
}
```

Only three landmarks. `torus`, `link` and `arch` are deferred to a follow-up: the spec's
shortlist named them, but three builders prove the machinery and each additional family is
independent work that does not block anything.

- [ ] **Step 2: Verify every id resolves to exactly one footprint**

Run:
```bash
python3 - <<'EOF'
import json
B = json.load(open('public/flood-sim/data/dubai-creek-buildings.json'))
L = json.load(open('public/flood-sim/data/dubai-creek-landmarks.json'))
by = {}
for r in B['osmB']:
    by.setdefault(r['id'], []).append(r)
for lm in L['landmarks']:
    hits = by.get(lm['osm'], [])
    assert len(hits) == 1, f"{lm['name']}: {len(hits)} footprints for {lm['osm']}"
    r = hits[0]
    n = len(r['p']) // 2
    av = lm['params'].get('apexVertex')
    if av is not None:
        assert 0 <= av < n, f"{lm['name']}: apexVertex {av} out of range for {n} verts"
    print(f"  OK {lm['name']:22s} {lm['osm']:12s} {n:3d} verts  osm-name={r.get('name')}")
print("all recipe ids resolve")
EOF
```
Expected: three `OK` lines, with `Burj Al Arab w12700546 11 verts osm-name=برج العرب جميرا`

- [ ] **Step 3: Commit**

```bash
git add public/flood-sim/data/dubai-creek-landmarks.json
git commit -m "feat(flood-sim): landmark recipes, keyed on OSM id

Three icons to start. Each recipe supplies only what OSM cannot express -- the
vertical profile -- while plan, position and orientation stay measured. Heights
are cited per landmark, which is more honest than a merge because every one is
visible in a file you can read in a minute."
```

---

## Task 9: The form builders

Pure geometry, no `bpy`, so it can be tested with system Python.

**Files:**
- Create: `scripts/blender_landmarks.py`

- [ ] **Step 1: Write the module**

```python
"""Parametric landmark massing, driven by the MEASURED OSM footprint.

WHY THIS EXISTS. The pipeline can only make vertical prisms: a building is its
footprint extruded to its height. 461 of the 520 buildings over 100 m in the
Creek window have no OSM `building:part` record, so they are boxes -- and even
where parts exist, Simple 3D Buildings is stacked prisms, which can never make a
sail, a twist or a torus. A live Overpass query returns ZERO parts for the Burj
Al Arab, so no amount of re-fetching will produce one.

WHAT MAKES IT DEFENSIBLE. Every builder here reads the measured plan and shapes
only the vertical profile. The Burj Al Arab's OSM footprint already encodes the
building: ten vertices trace the membrane arc and vertex 10 is the spine, 76 m
north-west, where the two wings meet. Scaling the measured ring toward that
fixed spine as height rises produces the sail. The plan does the identifying;
the parameters only say how it tapers.

THE MASSING IS STILL AUTHORED and is not a measurement. See the `provenance`
line in dubai-creek-landmarks.json.

No `bpy` import: Blender's Python is not the system Python, and geometry that
needs Blender to run cannot be unit tested. blender_dubai.py turns these
verts/faces into objects.
"""
from __future__ import annotations

import math
from typing import Any

Ring = list[tuple[float, float]]
Mesh = tuple[list[tuple[float, float, float]], list[tuple[int, ...]]]


def open_ring(flat: list[float]) -> Ring:
    """Flat [x0,y0,x1,y1,...] to points, dropping the repeated closing vertex."""
    n = len(flat) // 2
    if n >= 2 and abs(flat[0] - flat[-2]) < 1e-6 and abs(flat[1] - flat[-1]) < 1e-6:
        n -= 1
    return [(flat[2 * i], flat[2 * i + 1]) for i in range(n)]


def _loft(sections: list[tuple[Ring, float]]) -> Mesh:
    """Stack rings of equal length into a closed solid: walls, floor, cap."""
    n = len(sections[0][0])
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for ring, z in sections:
        for (x, y) in ring:
            verts.append((x, y, z))
    for level in range(len(sections) - 1):
        a, b = level * n, (level + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple((len(sections) - 1) * n + i for i in range(n)))
    return verts, faces


def sail(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Burj Al Arab. The ring collapses toward a fixed spine vertex as it rises.

    Anisotropic on purpose: the wings close in on each other (width) at a
    different rate from the membrane sweeping back toward the spine (depth), and
    a single scale reads as a cone rather than a sail.
    """
    apex_i = int(params["apexVertex"])
    exp_d, exp_w = float(params["expDepth"]), float(params["expWidth"])
    mass = float(params["massFraction"])
    levels = int(params.get("levels", 36))

    ax, ay = ring[apex_i]
    others = [p for i, p in enumerate(ring) if i != apex_i]
    mx = sum(p[0] for p in others) / len(others) - ax
    my = sum(p[1] for p in others) / len(others) - ay
    mag = math.hypot(mx, my) or 1.0
    ux, uy = mx / mag, my / mag          # depth axis: spine -> membrane
    wx, wy = -uy, ux                     # width axis: wing to wing
    duw = [((x - ax) * ux + (y - ay) * uy, (x - ax) * wx + (y - ay) * wy)
           for (x, y) in ring]

    sections: list[tuple[Ring, float]] = []
    for level in range(levels + 1):
        t = level / levels
        sd = max(0.02, 1.0 - t ** exp_d)
        sw = max(0.02, 1.0 - t ** exp_w)
        sections.append(([(ax + ux * d * sd + wx * w * sw,
                           ay + uy * d * sd + wy * w * sw) for (d, w) in duw],
                         base + height * mass * t))
    return _loft(sections)


def twist(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Cayan Tower. The plan rotates about its own centroid as it rises.

    The total rotation is a published figure for this building, so it is one
    cited number rather than a shape anyone had to invent.
    """
    total = math.radians(float(params["twistDeg"]))
    levels = int(params.get("levels", 30))
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)

    sections: list[tuple[Ring, float]] = []
    for level in range(levels + 1):
        t = level / levels
        a = total * t
        ca, sa = math.cos(a), math.sin(a)
        sections.append(([(cx + (x - cx) * ca - (y - cy) * sa,
                           cy + (x - cx) * sa + (y - cy) * ca) for (x, y) in ring],
                         base + height * t))
    return _loft(sections)


def wave(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Jumeirah Beach Hotel. A curved slab that leans as it rises to a crest.

    The 76-vertex plan already carries the curve, so the builder adds only the
    lean and the taper -- the wave is in the measurement, not in the parameters.
    """
    exp_d, exp_w = float(params["expDepth"]), float(params["expWidth"])
    lean = float(params["leanM"])
    levels = int(params.get("levels", 24))
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)

    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    long_axis_x = (max(xs) - min(xs)) >= (max(ys) - min(ys))

    sections: list[tuple[Ring, float]] = []
    for level in range(levels + 1):
        t = level / levels
        sd = max(0.05, 1.0 - t ** exp_d)
        sw = max(0.05, 1.0 - t ** exp_w)
        dx = 0.0 if long_axis_x else lean * t
        dy = lean * t if long_axis_x else 0.0
        sections.append(([(cx + (x - cx) * (sw if long_axis_x else sd) + dx,
                           cy + (y - cy) * (sd if long_axis_x else sw) + dy)
                          for (x, y) in ring],
                         base + height * t))
    return _loft(sections)


BUILDERS = {"sail": sail, "twist": twist, "wave": wave}


def build(form: str, ring: Ring, base: float, height: float,
          params: dict[str, Any]) -> Mesh:
    if form not in BUILDERS:
        raise SystemExit(f"unknown landmark form {form!r}; have {sorted(BUILDERS)}")
    if len(ring) < 3:
        raise SystemExit(f"form {form!r} needs a ring of 3+ vertices, got {len(ring)}")
    apex = params.get("apexVertex")
    if apex is not None and not 0 <= int(apex) < len(ring):
        # An IndexError here would read as a crash. It is actually a recipe that
        # has drifted from the data -- OSM redrew the plan and the spine vertex
        # moved -- and the message should say so.
        raise SystemExit(f"form {form!r}: apexVertex {apex} is out of range for a "
                         f"{len(ring)}-vertex ring; the OSM plan may have been redrawn")
    return BUILDERS[form](ring, base, height, params)


def self_test() -> int:
    """Run with: python3 scripts/blender_landmarks.py"""
    square: Ring = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]

    v, f = twist(square, 5.0, 100.0, {"twistDeg": 90.0, "levels": 4})
    assert len(v) == 4 * 5, len(v)
    assert abs(min(p[2] for p in v) - 5.0) < 1e-6
    assert abs(max(p[2] for p in v) - 105.0) < 1e-6
    top = v[-4:]
    # a 90-degree turn about the centroid maps (0,0) to (10,0)
    assert any(abs(p[0] - 10.0) < 1e-6 and abs(p[1] - 0.0) < 1e-6 for p in top), top

    v, f = sail(square + [(20.0, 20.0)], 0.0, 200.0,
                {"apexVertex": 4, "expDepth": 2.0, "expWidth": 2.0,
                 "massFraction": 0.9, "levels": 8})
    assert abs(max(p[2] for p in v) - 180.0) < 1e-6, max(p[2] for p in v)
    apex_at_top = [p for p in v[-5:]]
    spread = max(math.hypot(a[0] - b[0], a[1] - b[1])
                 for a in apex_at_top for b in apex_at_top)
    assert spread < 2.0, f"sail should converge on the spine, spread {spread:.1f} m"

    v, f = wave(square, 0.0, 50.0, {"expDepth": 1.4, "expWidth": 1.0,
                                    "leanM": 10.0, "levels": 4})
    assert abs(max(p[2] for p in v) - 50.0) < 1e-6

    try:
        build("torus", square, 0.0, 10.0, {})
    except SystemExit as exc:
        assert "unknown landmark form" in str(exc)
    else:
        raise AssertionError("an unknown form must be refused")

    try:
        build("twist", [(0.0, 0.0), (1.0, 1.0)], 0.0, 10.0,
              {"twistDeg": 90.0})
    except SystemExit as exc:
        assert "3+ vertices" in str(exc)
    else:
        raise AssertionError("a degenerate ring must be refused")

    try:
        build("sail", square, 0.0, 10.0,
              {"apexVertex": 99, "expDepth": 2.0, "expWidth": 2.0,
               "massFraction": 0.9})
    except SystemExit as exc:
        assert "out of range" in str(exc), exc
    else:
        raise AssertionError("an out-of-range apexVertex must be refused")

    print("  blender_landmarks self-test: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test())
```

- [ ] **Step 2: Run the self-test and watch it pass**

Run: `python3 scripts/blender_landmarks.py`
Expected: `blender_landmarks self-test: OK`

- [ ] **Step 3: Mutation-check the self-test**

Run:
```bash
python3 - <<'EOF'
import re, pathlib
p = pathlib.Path('scripts/blender_landmarks.py')
s = p.read_text()
p.write_text(s.replace('a = total * t', 'a = 0.0'))   # break the twist
EOF
python3 scripts/blender_landmarks.py; echo "EXIT: $?"
git checkout -- scripts/blender_landmarks.py
python3 scripts/blender_landmarks.py; echo "EXIT: $?"
```
Expected: first `EXIT: 1` with an AssertionError on the twist; second `EXIT: 0`.

(If `git checkout` fails because the file is not yet tracked, `git add` it first, or restore
by hand.)

- [ ] **Step 4: Wire the self-test into the Python gate**

In `package.json`, append to `"test:py"`:
```
 && python3 scripts/blender_landmarks.py
```

- [ ] **Step 5: Typecheck and commit**

```bash
python3 -m mypy
python3 scripts/blender_landmarks.py
git add scripts/blender_landmarks.py package.json
git commit -m "feat(flood-sim): parametric landmark massing from the measured plan

The pipeline could only make vertical prisms, and OSM has zero building:part
for the Burj Al Arab, so no re-fetch would ever produce a sail. These builders
read the measured footprint and shape only the vertical profile -- the Burj Al
Arab's plan already encodes the building, with ten vertices tracing the membrane
and vertex 10 the spine where the wings meet.

No bpy import, so the geometry is testable with system Python. Self-test is
mutation-checked: zeroing the twist angle fails it."
```

---

## Task 10: Emit landmarks in the Blender scene

**Files:**
- Modify: `scripts/blender_dubai.py` (`build_buildings`, and the scene assembly that calls it)

- [ ] **Step 1: Load the recipes beside the other artefacts**

Near the top of `scripts/blender_dubai.py`, after the `DATA` constant, add:

```python
def load_landmarks(site: str) -> dict[str, dict[str, Any]]:
    """Recipes keyed by OSM id. Absent file is a warning, not an error.

    Landmarks are an enhancement, not a dependency: the scene must stay
    regenerable from OSM alone, so a missing recipe file draws prisms and says
    so. Every OTHER disagreement between recipe and data is fatal, because a
    recipe naming a building that is no longer there means an upstream edit
    silently removed a landmark -- exactly the class of defect this work fixes.
    """
    path = os.path.join(DATA, f"{site}-landmarks.json")
    if not os.path.exists(path):
        print(f"  no landmark recipes at {path} -- drawing prisms")
        return {}
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return {lm["osm"]: lm for lm in doc["landmarks"]}
```

- [ ] **Step 2: Suppress recipe-covered footprints in the flat extrusion**

In `build_buildings`, inside the `for rec in doc.get("osmB", []):` loop, immediately after:

```python
        if rec.get("parts"):
            continue                       # its massing slabs handle it
```

add:

```python
        if rec.get("id") in LANDMARKS:
            continue                       # drawn as authored massing instead
```

and add a module-level `LANDMARKS: dict[str, dict[str, Any]] = {}` near the other globals,
assigned in the scene assembly before `build_buildings` is called:

```python
    global LANDMARKS
    LANDMARKS = load_landmarks(site)
```

- [ ] **Step 3: Build the landmark objects**

Add this function to `scripts/blender_dubai.py`:

```python
def build_landmarks(terrain_doc: dict[str, Any], doc: dict[str, Any],
                    mat: Any) -> int:
    """One named object per landmark, never merged into the buildings mesh.

    Separate objects stay inspectable, swappable and independently hideable.
    Merging them into the 1.6 M-face `buildings` mesh would make every future
    landmark edit a surgery on a single enormous object.
    """
    # Blender does not reliably put a --python script's own directory on
    # sys.path, so the import has to be told where its sibling lives.
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import blender_landmarks as BL

    by_id = {r["id"]: r for r in doc.get("osmB", []) if "id" in r}
    built = 0
    for osm_id, lm in LANDMARKS.items():
        rec = by_id.get(osm_id)
        if rec is None:
            raise SystemExit(
                f"landmark {lm['name']!r} names {osm_id}, which is not in the "
                f"artefact. An OSM edit may have removed or renumbered it.")
        ring = BL.open_ring(rec["p"])
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        base = sample_ground(terrain_doc, cx, cy) - 0.4
        verts, faces = BL.build(lm["form"], ring, base,
                                float(lm["height"]), lm["params"])
        name = "lm." + lm["name"].lower().replace(" ", "-")
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(mat)
        bpy.context.collection.objects.link(ob)
        built += 1
        print(f"  landmark {name}: {lm['form']}, {len(verts)} verts, "
              f"{lm['height']} m ({lm['heightSource']})")
    return built
```

Call it in the scene assembly immediately after `build_buildings`, passing the same material
the buildings mesh uses so landmarks read as part of the city rather than as imports.

- [ ] **Step 4: Render the scene headless and confirm the landmarks appear**

Run:
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender_dubai.py -- --site dubai-creek --out /tmp/creek.png --samples 8 \
  2>&1 | grep -E "landmark|OSM outlines|massing|Error|Traceback"
echo "EXIT: ${PIPESTATUS[0]}"
```
Expected: three `landmark lm.*` lines — `lm.burj-al-arab`, `lm.cayan-tower`,
`lm.jumeirah-beach-hotel` — and exit 0.

- [ ] **Step 5: Confirm no landmark is drawn twice**

A footprint suppressed for massing must not also appear as a prism; the `parts` path had
exactly this bug before it was fixed.

Run:
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python-expr "
import bpy, sys
bpy.ops.wm.open_mainfile(filepath='/tmp/dubai-creek.blend')
lm = [o for o in bpy.data.objects if o.name.startswith('lm.')]
print('landmark objects:', [o.name for o in lm])
b = bpy.data.objects['buildings']
for o in lm:
    cx = sum(v.co.x for v in o.data.vertices) / len(o.data.vertices)
    cy = sum(v.co.y for v in o.data.vertices) / len(o.data.vertices)
    top = max((v.co.z for v in b.data.vertices
               if abs(v.co.x-cx) < 60 and abs(v.co.y-cy) < 60), default=0.0)
    lmtop = max(v.co.z for v in o.data.vertices)
    print(f'{o.name}: landmark top {lmtop:.0f} m, tallest prism within 60 m {top:.0f} m')
" 2>&1 | grep -E "landmark|lm\."
```
Expected: for each landmark, the nearby prism height is clearly lower than the landmark —
if a prism matches the landmark's height, the suppression did not take.

Adjust the `.blend` path to wherever `blender_dubai.py` saves it; check its `--out`
handling if unsure.

- [ ] **Step 6: Confirm each landmark stands at its cited height**

The recipe's `height` is a cited fact. If the built object does not reach it, the builder
is silently disagreeing with the citation, and the number in the evidence note becomes
false.

Run:
```bash
python3 - <<'EOF'
import json, sys
sys.path.insert(0, 'scripts')
import blender_landmarks as BL

B = json.load(open('public/flood-sim/data/dubai-creek-buildings.json'))
L = json.load(open('public/flood-sim/data/dubai-creek-landmarks.json'))
by = {r['id']: r for r in B['osmB'] if 'id' in r}

bad = []
for lm in L['landmarks']:
    ring = BL.open_ring(by[lm['osm']]['p'])
    verts, _ = BL.build(lm['form'], ring, 0.0, float(lm['height']), lm['params'])
    got = max(v[2] for v in verts) - min(v[2] for v in verts)
    want = float(lm['height'])
    # `sail` tops its MASS out below the architectural height and leaves the rest
    # to the mast, so it is measured against massFraction; the others are full.
    want *= float(lm['params'].get('massFraction', 1.0))
    ok = abs(got - want) < 0.5
    print(f"  {'OK  ' if ok else 'FAIL'} {lm['name']:24s} built {got:7.1f} m, expected {want:7.1f} m")
    if not ok:
        bad.append(lm['name'])
assert not bad, f"height fidelity failed: {bad}"
print("all landmarks stand at their cited height")
EOF
```
Expected: three `OK` lines and `all landmarks stand at their cited height`.

- [ ] **Step 7: Mutation-check that height test**

Run:
```bash
python3 - <<'EOF'
import json
p = 'public/flood-sim/data/dubai-creek-landmarks.json'
d = json.load(open(p))
d['landmarks'][1]['height'] += 50.0          # Cayan Tower, +50 m
json.dump(d, open(p, 'w'), indent=2)
EOF
```
Re-run the Step 6 command. Expected: it still passes — because the builder reads the same
recipe it is checked against, so this test cannot catch a wrong *citation*, only a builder
that fails to honour one.

That is worth knowing rather than papering over: **the height test proves the geometry
obeys the recipe, and nothing proves the recipe is right except the `heightSource` and a
human reading it.** Restore the file:

```bash
git checkout -- public/flood-sim/data/dubai-creek-landmarks.json
```

Now break the builder instead, which is what the test is actually for:

```bash
python3 - <<'EOF'
import pathlib
p = pathlib.Path('scripts/blender_landmarks.py')
p.write_text(p.read_text().replace('base + height * t),', 'base + height * t * 0.5),'))
EOF
```
Re-run Step 6. Expected: `FAIL Cayan Tower` and `FAIL Jumeirah Beach Hotel`.

```bash
git checkout -- scripts/blender_landmarks.py
```

- [ ] **Step 8: Commit**

```bash
git add scripts/blender_dubai.py
git commit -m "feat(flood-sim): landmarks are their own objects, and their footprints stop being boxes

A recipe-covered footprint is skipped in the flat extrusion the same way `parts`
and `sup` already skip theirs, and the landmark is emitted as its own named
lm.* object rather than merged into the 1.6 M-face buildings mesh.

A recipe naming a building the artefact does not have is fatal: it means an OSM
edit removed or renumbered a landmark, which is precisely the silent loss this
work exists to catch. A missing recipe FILE is only a warning -- the scene has
to stay regenerable from OSM alone."
```

---

## Task 11: Look at it

Automated checks cannot tell you whether the Burj Al Arab looks like the Burj Al Arab.

- [ ] **Step 1: Open the scene and frame each landmark**

```bash
/Applications/Blender.app/Contents/MacOS/Blender /tmp/dubai-creek.blend
```

Then, in Blender's Python console, for each landmark:

```python
import bpy, math
from mathutils import Euler
o = bpy.data.objects['lm.burj-al-arab']
cx = sum(v.co.x for v in o.data.vertices) / len(o.data.vertices)
cy = sum(v.co.y for v in o.data.vertices) / len(o.data.vertices)
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        r = area.spaces[0].region_3d
        r.view_location = (cx, cy, 160)
        r.view_distance = 900
        r.view_rotation = Euler((math.radians(84), 0, math.radians(133)), 'XYZ').to_quaternion()
        area.spaces[0].clip_end = 100000
```

- [ ] **Step 2: Tune the profile exponents against reference**

`expDepth` and `expWidth` in the recipe file are the prototype's values. Higher `expDepth`
holds the belly longer and pinches later. Edit
`public/flood-sim/data/dubai-creek-landmarks.json`, re-run the Task 10 Step 4 command, and
look again. This is look-dev; there is no correct number, only a better-looking one.

- [ ] **Step 3: Commit any tuning**

```bash
git add public/flood-sim/data/dubai-creek-landmarks.json
git commit -m "chore(flood-sim): landmark profile tuning against reference"
```

---

## Task 12: Final verification and the evidence note

**Files:**
- Create: `docs/evidence/dubai-authored-massing.md`

- [ ] **Step 1: Write the evidence note**

```markdown
# Dubai Creek: authored landmark massing

The Creek scene contains geometry that is **not a measurement**. This records
exactly which, and on what basis, so nobody later cites a render as evidence.

## What is measured

- **Footprints, plans, positions** — OpenStreetMap, ODbL 1.0. Never modified by
  the landmark work; gated by `scripts/check-dubai-footprints.py`, which hashes
  every ring against a committed baseline.
- **Heights** — cited facts. Wikidata (CC0 1.0) and CTBUH, named per landmark in
  `public/flood-sim/data/dubai-creek-landmarks.json` under `heightSource`.
  A building's height is a fact and facts are not copyrightable; the limit that
  does exist is EU/UK database right on bulk extraction, which a hand-entered
  list of landmarks does not approach.

## What is authored

The **vertical massing** of the landmarks listed in
`dubai-creek-landmarks.json`. Each is built by a function in
`scripts/blender_landmarks.py` that reads the measured plan and shapes only how
it tapers with height.

This is an approximation with a documented method, not a scan and not a
photogrammetric model. It carries no facade detail, which is correct for a scene
where every other building is untextured massing.

## Why it was necessary

461 of the 520 buildings over 100 m in this window have no OSM `building:part`
record, so the pipeline draws them as vertical prisms. A live Overpass query
returns **zero** part elements for the Burj Al Arab: the data does not exist
upstream, so no re-fetch produces a sail. And Simple 3D Buildings is stacked
prisms even where coverage is complete — it cannot express a sail, a twist or a
torus at all.

## What was rejected, and why

- **Downloaded 3D models** (Sketchfab and similar). A large share of landmark
  models are photogrammetry derived from Google Earth captures, and provenance
  cannot be verified at scale. Viable only case by case with a confirmed CC0 or
  CC-BY source.
- **Generative 3D.** Fabricated geometry with no provenance, in a project whose
  argument is receipts rather than renders.
- **Upstream OSM mapping.** Correct for the stepped towers and worth doing, but
  slow, and Simple 3D Buildings still cannot make a curve.

## The boundary that keeps this out of the numbers

`scripts/fetch-dubai-terrain.py:202` is the only place building data reaches the
flood solve, and it reads the footprint rings alone, to mask buildings out of the
DSM so rain does not pond on rooftops. Authored massing adds geometry beside
those rings and never modifies them, so the flood solve is bit-identical across
this feature. `npm run check:footprints` proves it rather than asserting it.
```

- [ ] **Step 2: Run the whole gate**

Run:
```bash
npm run verify > /tmp/verify-b.log 2>&1; echo "EXIT: $?"
tail -30 /tmp/verify-b.log
```
Expected: `EXIT: 0`

- [ ] **Step 3: Confirm the footprint gate one final time**

Run: `python3 scripts/check-dubai-footprints.py`
Expected: `footprints unchanged across 2 site(s)`

If this fails at any point in Phase B, **stop and find out why**. Nothing in Phase B should
touch a footprint, so a failure means a builder wrote back into `rec["p"]` or a fetcher
re-ran against a changed window.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/evidence/dubai-authored-massing.md
git commit -m "docs(evidence): which Dubai geometry is measured and which is authored

Footprints and positions are OSM. Heights are cited facts with a named source
per landmark. The vertical massing of three icons is authored, is not a
measurement, and must never be offered as evidence for a number."
git push -u origin feat/dubai-landmarks
gh pr create --base feat/flood-sim --title "Dubai Creek: correct heights and landmark massing" --body "$(cat <<'EOF'
## Heights

The join was nearest-centroid within 90 m and wrong about a fifth of what it
touched: Marina 106's 445 m on the 254 m Marina Arcade Tower, Ocean Heights'
310 m on Al Seef Tower, the Burj Al Arab's 321 m on the Skyview Bar — a room
inside it. One item could also claim several footprints; JW Marriott Marquis
attached to three at 355 m each.

Geometry cannot arbitrate this. 37 of 42 Wikidata points fall outside their own
footprint, so containment would reject Princess Tower, 23 Marina and Cayan, all
correct. Names decide; distance is a tie-break.

Burj Khalifa 652 → 828. The 652 was `building:levels=163 × 4.0`, OSM carrying no
height tag at all.

## Massing

461 of 520 buildings over 100 m are vertical prisms, and OSM has zero
`building:part` for the Burj Al Arab, so this could never be re-fetched. Three
icons are now built from their measured plans — the Burj Al Arab's footprint
already encodes the sail, ten vertices tracing the membrane and vertex 10 the
spine where the wings meet.

## The boundary

`fetch-dubai-terrain.py` is the only place building data reaches the flood
solve, and it reads footprint rings alone. `npm run check:footprints` hashes
every ring against a committed baseline, so "the flood solve is unaffected" is
a check rather than a claim.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019Wp1ArE4ctCbgHDvjhY1XY
EOF
)"
```

---

## Deferred, deliberately

- **`torus`, `link` and `arch` builders** (Museum of the Future, One Za'abeel,
  Atlantis). Independent work; the machinery is proven by three families.
- **Atlantis The Palm's OSM id.** Its record is Arabic-named (فندق أتلانتس) and did not
  match the shortlist query cleanly. Confirm by hand before adding a recipe — guessing an
  id is the exact failure this plan is built to avoid.
- **Dubai South.** Same machinery, different window.
- **The other ~450 prisms.** Rule-driven massing at that scale needs its own honesty
  argument and its own decision.
- **Membrane curvature.** The Burj Al Arab's sail is doubly curved; `sail` spans it flat.
