# Dubai South Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dropping structures OSM already describes, and stop rendering Dubai South's
warehouses two and a half times too tall.

**Architecture:** Three measured fixes and one gated one. The Overpass building query is
widened to catch structures OSM tags as attractions rather than buildings — which is why
Terra is missing — and the cache key is first made to cover the query, or the widening
would silently re-serve the old response. The height prior, currently a single global curve
that assumes bigger footprint means taller building, gains a per-site table fitted from that
site's own measured heights and applied only above 5,000 m². The Al Wasl dome is specified
but must not be built until someone cites a height for it.

**Tech Stack:** Python 3.12 (strict mypy over all of `scripts/`), Overpass (cached),
Blender 4.x `bpy`, Node for `npm run verify`.

**Spec:** `docs/superpowers/specs/2026-09-05-dubai-south-accuracy-design.md`

---

## Before you start

**Branch.**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad/.claude/worktrees/flood-sim
git checkout -b feat/dubai-south-accuracy feat/flood-sim
```

**This plan DOES hit the network, once.** Unlike the Creek work, Task 3 changes the Overpass
query, so Task 4 must fetch a genuinely new response. That is expected and is the whole
point of Task 2. Every other fetch reads the cache.

**Strict typing.** `python3 -m mypy` with no arguments after every Python change.

**The footprint gate will legitimately fail once.** Task 4 *adds* rings — Terra and the
exhibition halls become footprints that were not there. That is a real change to the flood
model's building mask and it is correct, because those structures exist. It is re-baselined
deliberately in Task 5, with the diff read first. Every task after that must pass unchanged.

---

## File Structure

| file | responsibility |
|---|---|
| `scripts/_flood.py` | **modify.** `window_key` gains a query-hash companion so a cache entry is invalidated when the question changes, not only when the window does. |
| `scripts/fetch-dubai-heights.py` | **modify.** Widens the building query; routes `min_height` records to `parts`; computes and writes the per-site large-footprint height table. |
| `scripts/blender_dubai.py` | **modify.** `estimate_height` consults the artefact's table above 5,000 m² and the global curve below it. |
| `public/flood-sim/data/dubai-south-buildings.json` | **regenerated.** Gains ids, the widened outlines, and the height table. |
| `public/flood-sim/data/dubai-footprint-baseline.json` | **re-baselined once**, in Task 5 only. |
| `docs/evidence/dubai-authored-massing.md` | **modify.** Records that Dubai South's fixes are measured, and that the dome is blocked. |

---

## Task 1: Record the starting state

Nothing here changes code. It exists so that later claims about what improved are
differences against a written-down number rather than a memory.

**Files:** none — this task only measures.

- [ ] **Step 1: Confirm the tree is clean and the gate is green**

Run:
```bash
cd /Volumes/VSTSAMPLES/Projects/Angad/.claude/worktrees/flood-sim
git status --short public/flood-sim/data/   # MUST be empty
python3 scripts/check-dubai-footprints.py
```
Expected: no output from `git status`, and `footprints unchanged across 2 site(s)`.

- [ ] **Step 2: Write down what Dubai South looks like now**

Run:
```bash
python3 - <<'EOF'
import json
B = json.load(open('public/flood-sim/data/dubai-south-buildings.json'))
def area(p):
    n=len(p)//2; a=0.0
    for i in range(n):
        j=(i+1)%n; a += p[i*2]*p[j*2+1]-p[j*2]*p[i*2+1]
    return abs(a)/2
osm = B['osmB']
print(f"osmB outlines           : {len(osm):,}")
print(f"parts slabs             : {len(B.get('parts', [])):,}")
print(f"ids present             : {'id' in osm[0]}")
print(f"heightTable present     : {'heightTable' in B}")
print(f">= 5,000 m2, no height  : {sum(1 for r in osm if not r.get('h') and area(r['p']) >= 5000):,}")
print(f"Terra present           : {any('Terra - The' in (r.get('name') or '') for r in osm)}")
print(f"exhibition halls present: {sum(1 for r in osm if (r.get('name') or '').startswith('Hall '))}")
EOF
```
Expected, and these are the numbers Task 4 and Task 8 are checked against:
```
osmB outlines           : 33,746
parts slabs             : 234
ids present             : False
heightTable present     : False
>= 5,000 m2, no height  : 923
Terra present           : False
exhibition halls present: 0
```

If any differs, stop — the artefact is not the one this plan was written against.

---

## Task 2: Make the cache key cover the query

`fetch-dubai-heights.py:184` caches Overpass responses at
`f"{site.id}-{window_key(site)}-osm-buildings.json"`, and `window_key` hashes only the
bounding box. **Changing the query does not change the key**, so Task 3's widening would
read the old, narrow response from disk and appear to do nothing.

This is the same class of trap the file already documents for site ids: *"caches were keyed
by site id alone, which is a silent-staleness trap."* The window was added to the key. The
query was not.

**Files:**
- Modify: `scripts/_flood.py` (add `query_key`)
- Modify: `scripts/fetch-dubai-heights.py` (three cache paths)

- [ ] **Step 1: Add the helper**

Append to `scripts/_flood.py`, immediately after `window_key`:

```python
def query_key(query: str) -> str:
    """Short hash of the QUERY, to sit beside window_key in a cache filename.

    Keying a cached response by the window alone is a silent-staleness trap that
    this file already documents for site ids -- and the same trap reappears one
    level up. Widening an Overpass query while the bounds stay put leaves the old,
    narrower response on disk under the same name, so the fetcher re-serves it,
    the new clause appears to return nothing, and no error is raised anywhere.

    A cache entry should be keyed by the question as well as the place.
    """
    import hashlib
    return hashlib.sha1(query.encode()).hexdigest()[:8]
```

- [ ] **Step 2: Import it**

In `scripts/fetch-dubai-heights.py`, add `query_key` to the existing `from _flood import ...`
line, keeping the names alphabetical.

- [ ] **Step 3: Build the query before the cache path, in all three fetchers**

`fetch_osm_buildings`, `fetch_parts` and the heights fetcher each build a query *after*
computing their cache path. Invert that in each: build `query` first, then

```python
        path = os.path.join(CACHE, f"{site.id}-{window_key(site)}-{query_key(query)}-osm-buildings.json")
```

using the matching suffix for each fetcher (`-parts.json`, `-heights.json`).

- [ ] **Step 4: Typecheck**

Run: `python3 -m mypy`
Expected: `Success: no issues found in N source files`

- [ ] **Step 5: Confirm the existing caches are now missed, deliberately**

Run:
```bash
ls data/.cache/osm/ | grep dubai-south
```
Expected: the old `dubai-south-bd205c2d-*.json` files are still present. They will no longer
be found, which is correct — they answer a different question. **Do not delete them**: if
Task 3 goes wrong, they are the only copy of the old response.

- [ ] **Step 6: Commit**

```bash
git add scripts/_flood.py scripts/fetch-dubai-heights.py
git commit -m "fix(flood-sim): a cached Overpass response is keyed by its question, not just its place

Cache entries were keyed by site and window. Widening a query while the bounds
stay put therefore re-serves the old, narrower response from disk: the new clause
appears to return nothing and nothing errors. The file already documents this
trap one level down, for site ids. It was still open one level up."
```

---

## Task 3: Widen the building query

**Files:**
- Modify: `scripts/fetch-dubai-heights.py` (`fetch_osm_buildings`)

- [ ] **Step 1: Add the second clause**

In `fetch_osm_buildings`, replace the query construction with:

```python
        # OSM DOES NOT TAG EVERY STRUCTURE `building=`. Terra -- The
        # Sustainability Pavilion carries tourism=attraction with height=30 and
        # min_height=28, a fully described floating canopy, and was absent from
        # the model entirely. So were ~27 Dubai Exhibition Centre halls at
        # 10-14 m.
        #
        # The second clause takes anything carrying a height or a storey count,
        # minus the things that are emphatically not buildings. The risk is
        # bounded and was measured rather than guessed: 33 ways in the whole
        # Dubai South window match it, five of them walls.
        query = (
            f"[out:json][timeout:600];("
            f'way["building"]({s_},{w},{n},{e});'
            f'relation["building"]({s_},{w},{n},{e});'
            f'way["height"][!"building"][!"building:part"][!"barrier"][!"wall"]'
            f'[!"highway"][!"landuse"][!"natural"][!"boundary"]({s_},{w},{n},{e});'
            f'way["building:levels"][!"building"][!"building:part"][!"barrier"][!"wall"]'
            f'[!"highway"][!"landuse"][!"natural"][!"boundary"]({s_},{w},{n},{e});'
            f");"
            f"out tags geom;"
        )
```

- [ ] **Step 2: Route `min_height` records to the massing path**

A widened record that carries `min_height` describes a slab that starts above the ground.
Terra is one: `min_height=28`, `height=30`. Extruded from the ground it is a solid 30 m
block instead of a canopy.

In the `osmB` loop, after `rec["h"]` is set, add:

```python
        # A RECORD WITH min_height IS A SLAB, NOT A BUILDING. Terra floats
        # between 28 m and 30 m; drawn from the ground it becomes a solid block
        # the size of a city square. The parts path already extrudes exactly this
        # shape, so send it there and mark the outline so it is not also drawn
        # flat -- the same double-draw that `parts` and `sup` already guard.
        try:
            low = float(str(tags.get("min_height", "0")).replace("m", "").strip())
        except ValueError:
            low = 0.0
        if low > 0.0 and top and top > low:
            parts_from_outlines.append({
                "p": flat, "h": round(top, 1), "min": round(low, 1),
                "roof": tags.get("roof:shape", "flat"),
            })
            rec["parts"] = True
```

Declare `parts_from_outlines: list[dict[str, Any]] = []` before the loop, and extend the
`parts` list with it where `doc["parts"] = parts` is assigned:

```python
    parts.extend(parts_from_outlines)
    doc["parts"] = parts
```

- [ ] **Step 3: Typecheck**

Run: `python3 -m mypy`
Expected: `Success: no issues found in N source files`

- [ ] **Step 4: Commit before fetching**

Commit now, so Task 4's large artefact diff lands separately from the code that caused it.

```bash
git add scripts/fetch-dubai-heights.py
git commit -m "feat(flood-sim): structures OSM does not call buildings are still structures

Terra -- The Sustainability Pavilion is tagged tourism=attraction, carries
height=30 and min_height=28, and was absent from the model entirely. So were
~27 Dubai Exhibition Centre halls at 10-14 m.

A record with min_height is a slab, not a building: Terra floats between 28 and
30 m, and extruded from the ground it is a solid block the size of a city
square. Those go to the parts path, which already draws exactly that shape, and
their outline is marked so it is not also drawn flat."
```

---

## Task 4: Re-fetch Dubai South

**This is the one task that hits the network.**

**Files:**
- Modify: `public/flood-sim/data/dubai-south-buildings.json` (regenerated)

- [ ] **Step 1: Fetch**

Run:
```bash
python3 scripts/fetch-dubai-heights.py --site dubai-south > /tmp/south.log 2>&1
echo "EXIT: $?" >> /tmp/south.log
tail -12 /tmp/south.log
```
Expected: `EXIT: 0`. This will take minutes, not seconds — it is a live Overpass call over a
28.4 km window. A new cache file appears under `data/.cache/osm/` with a different key.

- [ ] **Step 2: Confirm what arrived**

Run:
```bash
python3 - <<'EOF'
import json
B = json.load(open('public/flood-sim/data/dubai-south-buildings.json'))
osm = B['osmB']
terra = [r for r in osm if 'Terra - The' in (r.get('name') or '')]
halls = [r for r in osm if (r.get('name') or '').startswith('Hall ')]
print(f"osmB outlines : {len(osm):,}  (was 33,746)")
print(f"parts slabs   : {len(B['parts']):,}  (was 234)")
print(f"ids present   : {'id' in osm[0]}")
print(f"Terra         : {[(r['name'], r.get('h'), r.get('parts')) for r in terra] or 'MISSING'}")
print(f"exhibition halls: {len(halls)}")
added = len(osm) - 33746
print(f"\noutlines added by the widened clause: {added}")
assert 10 <= added <= 80, f"expected roughly 28 (33 ways, 5 of them walls); got {added}"
assert terra, "Terra did not arrive -- the widened clause or the cache key is wrong"
assert terra[0].get('parts'), "Terra must be routed to the massing path, not extruded flat"
print("OK")
EOF
```
Expected: Terra present with `h=30.0` and `parts=True`, a double-digit number of halls, and
`added` in the low tens. **If `added` is 0, the cache key change in Task 2 did not take** —
that is the exact failure Task 2 exists to prevent, so check it before anything else.

- [ ] **Step 3: Expect the footprint gate to FAIL, and read why**

Run:
```bash
python3 scripts/check-dubai-footprints.py; echo "EXIT: $?"
```
Expected: `FAIL dubai-south: FOOTPRINTS MOVED` and `EXIT: 1`.

**This is correct.** New rings exist because new structures exist. Do not re-baseline yet —
Task 5 does it after the diff has been read.

- [ ] **Step 4: Commit the artefact**

```bash
git add public/flood-sim/data/dubai-south-buildings.json
git commit -m "feat(flood-sim): Dubai South regains Terra, the exhibition halls, and its OSM ids

Terra arrives as a slab between 28 and 30 m rather than a block, because OSM
described it that way all along and only the building= filter stood in the way.
The footprint gate now fails, correctly: new structures mean new rings, and the
flood model's building mask should include them."
```

---

## Task 5: Read the footprint diff, then re-baseline

The gate exists so that a footprint change is never silent. It is now loud. This task is
where a human decides the change is right.

**Files:**
- Modify: `public/flood-sim/data/dubai-footprint-baseline.json`

- [ ] **Step 1: List exactly which rings are new**

Run:
```bash
python3 - <<'EOF'
import json, subprocess
old = json.loads(subprocess.run(
    ['git','show','HEAD~1:public/flood-sim/data/dubai-south-buildings.json'],
    capture_output=True, text=True).stdout)
new = json.load(open('public/flood-sim/data/dubai-south-buildings.json'))
def key(r): return tuple(r['p'])
oldset = {key(r) for r in old['osmB']}
added = [r for r in new['osmB'] if key(r) not in oldset]
def area(p):
    n=len(p)//2; a=0.0
    for i in range(n):
        j=(i+1)%n; a += p[i*2]*p[j*2+1]-p[j*2]*p[i*2+1]
    return abs(a)/2
print(f"{len(added)} new rings:\n")
for r in sorted(added, key=lambda r: -area(r['p'])):
    print(f"  {area(r['p']):9.0f} m2  h={str(r.get('h','—')):>7}  {r.get('name') or '(unnamed)'}")
EOF
```
Expected: a readable list dominated by `Hall *` entries and Terra. **Read every line.** Each
must be a structure that genuinely exists. If anything is a wall, a car park surface or a
road, the exclusion list in Task 3 needs another key and this task restarts.

- [ ] **Step 2: Re-baseline, deliberately**

Run:
```bash
python3 scripts/check-dubai-footprints.py --rebase
python3 scripts/check-dubai-footprints.py; echo "EXIT: $?"
```
Expected: `baseline written for 2 site(s)`, then `footprints unchanged across 2 site(s)` and
`EXIT: 0`.

- [ ] **Step 3: Commit**

```bash
git add public/flood-sim/data/dubai-footprint-baseline.json
git commit -m "chore(flood-sim): re-baseline footprints after Dubai South gained real structures

The gate fired because rings changed, which is what it is for. The diff was read
line by line: every new ring is an exhibition hall or Terra, all of them
buildings that exist and that rain does not pond on either. Re-baselined once,
deliberately. Every later task must pass this unchanged."
```

---

## Task 6: Fit the large-footprint height table

**Files:**
- Modify: `scripts/fetch-dubai-heights.py`

- [ ] **Step 1: Compute and write the table**

Add to `scripts/fetch-dubai-heights.py`, before `build`:

```python
# THE HEIGHT PRIOR IS MONOTONIC IN FOOTPRINT AND REALITY IS NOT. `3 + 9*log10(...)`
# assumes a bigger footprint means a taller building, which is a residential
# assumption. Dubai South is Logistics City, JAFZA and Al Maktoum: its largest
# buildings are its flattest. Measured medians, per site:
#
#   band            Creek    South    the global prior says
#   500-2,000 m2     32 m      8 m    12.6 m
#   2,000-10,000     33 m      8 m    17.0 m
#   10,000-50,000    16 m     10 m    23.0 m
#
# The same footprint is a tower in one window and a warehouse in the other, so
# one curve cannot serve both. This fits a table from each site's OWN measured
# buildings.
#
# ONLY ABOVE 5,000 m2. Below that a fitted prior measurably makes things worse,
# so it is not applied there. Held out against genuine height= tags at or above
# 5,000 m2, excluding every levels-derived value: Dubai South's mean absolute
# error falls from 15.16 m to 8.58 m, the Creek's from 33.18 to 32.69.
HEIGHT_TABLE_MIN_AREA_M2 = 5000.0
HEIGHT_TABLE_EDGES = [5000.0, 10000.0, 25000.0, 50000.0, float("inf")]
HEIGHT_TABLE_MIN_SAMPLES = 25


def height_table(outlines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Median measured height per area band, from this site's own buildings."""
    import statistics
    buckets: dict[int, list[float]] = {}
    for rec in outlines:
        h = rec.get("h")
        if not h:
            continue
        a = ring_area(rec["p"])
        for i in range(len(HEIGHT_TABLE_EDGES) - 1):
            if HEIGHT_TABLE_EDGES[i] <= a < HEIGHT_TABLE_EDGES[i + 1]:
                buckets.setdefault(i, []).append(float(h))
                break
    out: list[dict[str, Any]] = []
    for i in range(len(HEIGHT_TABLE_EDGES) - 1):
        vals = buckets.get(i, [])
        out.append({
            "minArea": HEIGHT_TABLE_EDGES[i],
            "n": len(vals),
            # A thin band is not trusted. It falls back to the nearest populated
            # band BELOW it rather than to the global curve, because the global
            # curve is the thing being corrected -- falling back to it would undo
            # the fix precisely where footprints are largest.
            "medianM": round(statistics.median(vals), 1) if len(vals) >= HEIGHT_TABLE_MIN_SAMPLES else None,
        })
    return out
```

`ring_area` exists in neither `fetch-dubai-heights.py` nor `_flood.py` — only in
`blender_dubai.py`, which imports `bpy` and so cannot be imported from a fetcher. Add it to
`scripts/_flood.py` instead, beside `norm_name`, so both sides share one definition:

```python
def ring_area(flat: list[float]) -> float:
    """Shoelace area of a flat [x0,y0,x1,y1,...] ring, in square metres.

    Lives here rather than in blender_dubai.py because that module imports bpy
    and cannot be imported from a build-time fetcher. Two copies of a shoelace
    would be two chances to disagree about winding.
    """
    n = len(flat) // 2
    a = 0.0
    for i in range(n):
        j = (i + 1) % n
        a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]
    return abs(a) / 2.0
```

Import it in `fetch-dubai-heights.py` alongside `query_key`, and have
`scripts/check-height-prior.py` import it too rather than defining its own.

- [ ] **Step 2: Attach it to the document**

Where `doc["osmB"] = osm_b` is assigned, add below it:

```python
    doc["heightTable"] = {
        "minArea": HEIGHT_TABLE_MIN_AREA_M2,
        "bands": height_table(osm_b),
        "note": (
            "Median MEASURED height per footprint band, fitted from this site's own "
            "buildings. Used only at or above minArea; below it the global curve is "
            "kept, because a fitted prior measurably does worse there. A band with "
            f"fewer than {HEIGHT_TABLE_MIN_SAMPLES} samples has medianM null and falls "
            "back to the nearest populated band below."
        ),
    }
```

- [ ] **Step 3: Regenerate both sites from cache and inspect the tables**

Run:
```bash
python3 scripts/fetch-dubai-heights.py --site dubai-south > /tmp/t6s.log 2>&1; echo "south EXIT: $?"
python3 scripts/fetch-dubai-heights.py --site dubai-creek > /tmp/t6c.log 2>&1; echo "creek EXIT: $?"
python3 - <<'EOF'
import json
for s in ('dubai-south','dubai-creek'):
    d = json.load(open(f'public/flood-sim/data/{s}-buildings.json'))['heightTable']
    print(f"{s}: minArea {d['minArea']:.0f}")
    for b in d['bands']:
        print(f"   >= {b['minArea']:>9,.0f} m2  n={b['n']:4d}  median {b['medianM']}")
EOF
```
Expected — `dubai-south` bands roughly `n=208 median 8.0`, `n=117 median 10.0`,
`n=35 median 10.0`, `n=5 median None`; `dubai-creek` roughly `n=260 median 20.0`,
`n=88 median 16.0`, `n=16 median None`, `n=9 median None`.

**The Creek regeneration must not move a footprint.** Run
`python3 scripts/check-dubai-footprints.py` and expect `footprints unchanged`.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-dubai-heights.py public/flood-sim/data/dubai-south-buildings.json public/flood-sim/data/dubai-creek-buildings.json
git commit -m "feat(flood-sim): each site fits its own height prior for large footprints

The global prior is monotonic in footprint and reality is not: the same area is
a tower in the Creek and a warehouse in Dubai South, whose largest buildings are
its flattest. One curve cannot serve both, so each site now carries a table of
median measured heights fitted from its own buildings.

Only above 5,000 m2. Below that a fitted prior measurably does worse, so it is
left alone. A band under 25 samples falls back to the nearest populated band
below, never to the global curve -- that would undo the fix exactly where
footprints are largest."
```

---

## Task 7: Consume the table in Blender

**Files:**
- Modify: `scripts/blender_dubai.py` (`estimate_height` and its two call sites at lines 234 and 266)

- [ ] **Step 1: Teach `estimate_height` about the table**

Replace `estimate_height` with:

```python
HEIGHT_TABLE: dict[str, Any] = {}


def estimate_height(area: float, seed: int) -> float:
    """Fallback ONLY. Used where OSM has no height for this footprint.

    Above the table's minArea the site's own measured median wins, because the
    log curve below is monotonic in footprint and reality is not -- it rendered
    923 Dubai South warehouses 2.3 to 2.6 times too tall. Below minArea the curve
    is kept: a fitted prior measurably does worse there.
    """
    bands = HEIGHT_TABLE.get("bands") or []
    if bands and area >= float(HEIGHT_TABLE.get("minArea", 5000.0)):
        best: float | None = None
        for band in bands:
            if area >= float(band["minArea"]) and band.get("medianM") is not None:
                best = float(band["medianM"])       # nearest populated band at or below
        if best is not None:
            jitter = 0.92 + 0.16 * ((math.sin(seed * 127.1) * 43758.5453) % 1.0)
            return max(3.0, best * jitter)
    base = 3.0 + 9.0 * math.log10(1.0 + area / 100.0)
    jitter = 0.85 + 0.30 * ((math.sin(seed * 127.1) * 43758.5453) % 1.0)
    return max(3.0, min(60.0, base * jitter))
```

- [ ] **Step 2: Populate it in `main()`**

Beside the existing `LANDMARKS = load_landmarks(SITE)` assignment, after `buildings_doc` is
loaded:

```python
    global HEIGHT_TABLE
    HEIGHT_TABLE = buildings_doc.get("heightTable") or {}
    if not HEIGHT_TABLE:
        print("  no heightTable in the artefact -- falling back to the global curve")
```

- [ ] **Step 3: Typecheck and render**

Run:
```bash
python3 -m mypy
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender_dubai.py -- --site dubai-south --out /tmp/south.png \
  --blend /tmp/dubai-south-acc.blend --samples 8 2>&1 | grep -E "buildings:|heightTable|Error|Traceback"
echo "EXIT: ${PIPESTATUS[0]}"
```
Expected: exit 0, no `no heightTable` warning, and a `buildings:` line.

- [ ] **Step 4: Measure the change in the rendered scene**

Run:
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background /tmp/dubai-south-acc.blend \
  --python-expr "
import bpy
b = bpy.data.objects['buildings']
zs = sorted(v.co.z for v in b.data.vertices)
print('BUILDINGS z p50 %.1f  p95 %.1f  max %.1f' % (zs[len(zs)//2], zs[int(len(zs)*0.95)], zs[-1]))
" 2>&1 | grep BUILDINGS
```
Expected: the p95 is materially lower than before this task, because 923 buildings that were
rendering at 20–26 m now render near 8–10 m. Record the number.

- [ ] **Step 5: Commit**

```bash
git add scripts/blender_dubai.py
git commit -m "feat(flood-sim): the scene reads each site's fitted height prior

923 Dubai South buildings over 5,000 m2 carry no height and were taking a curve
that assumes bigger footprint means taller building. In Logistics City that is
backwards, and they rendered 2.3 to 2.6 times too tall. Above 5,000 m2 the
site's own measured median now wins; below it the curve is untouched."
```

---

## Task 8: Prove the prior actually improved things

A rendered scene looking shorter is not evidence. This is.

**Files:**
- Create: `scripts/check-height-prior.py`

- [ ] **Step 1: Write the check**

Create `scripts/check-height-prior.py`:

```python
"""Hold-out test for the fitted height prior, plus the trap that invalidated the first one.

THE FIRST VERSION OF THIS TEST WAS MEANINGLESS AND SCORED 100 %. It held out all
"measured" heights -- but 76-81 % of those are `building:levels x 4.0`, and 57 %
of Dubai South is the single value 8.0 m. Predicting 8.0 scores perfectly and
proves nothing.

So the ground truth here is ONLY the genuine `height=` tags, identified by not
being an exact multiple of 4.0. That is a heuristic and it is imperfect -- a real
20 m building tagged `height=20` is excluded -- but it errs toward a HARDER test,
which is the right direction for a check that exists to stop a false claim.

    python3 scripts/check-height-prior.py
"""
from __future__ import annotations

import json
import math
import os
import random
import statistics
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
SITES = ("dubai-creek", "dubai-south")
MIN_AREA = 5000.0


sys.path.insert(0, HERE)
from _flood import ring_area  # noqa: E402


def global_prior(area: float) -> float:
    return max(3.0, min(60.0, 3.0 + 9.0 * math.log10(1.0 + area / 100.0)))


def levels_derived(h: float) -> bool:
    return abs(h / 4.0 - round(h / 4.0)) < 1e-6


def fitted(table: dict[str, Any], area: float) -> float:
    bands = table.get("bands") or []
    if area >= float(table.get("minArea", MIN_AREA)):
        best = None
        for band in bands:
            if area >= float(band["minArea"]) and band.get("medianM") is not None:
                best = float(band["medianM"])
        if best is not None:
            return best
    return global_prior(area)


def main() -> int:
    failures: list[str] = []
    for sid in SITES:
        path = os.path.join(DATA, f"{sid}-buildings.json")
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        table = doc.get("heightTable")
        if not table:
            failures.append(f"{sid}: no heightTable in the artefact")
            continue

        obs = [(ring_area(r["p"]), float(r["h"])) for r in doc["osmB"]
               if r.get("h") and ring_area(r["p"]) >= MIN_AREA
               and 1.5 <= float(r["h"]) <= 900.0]
        truth = [t for t in obs if not levels_derived(t[1])]
        if len(truth) < 20:
            print(f"  skip {sid}: only {len(truth)} genuine height tags over "
                  f"{MIN_AREA:.0f} m2 -- too few to test")
            continue
        random.seed(7)
        random.shuffle(truth)
        test = truth[int(len(truth) * 0.7):]

        g = statistics.mean(abs(global_prior(a) - h) for a, h in test)
        f = statistics.mean(abs(fitted(table, a) - h) for a, h in test)
        verdict = "better" if f <= g else "WORSE"
        print(f"  {sid}: n={len(test):3d}  global {g:6.2f} m -> fitted {f:6.2f} m  ({verdict})")
        if f > g:
            failures.append(f"{sid}: the fitted prior is worse than the global curve")

        # BELOW the threshold the prior must be untouched, exactly.
        for area in (100.0, 900.0, 4999.0):
            if abs(fitted(table, area) - global_prior(area)) > 1e-9:
                failures.append(f"{sid}: the table leaked below {MIN_AREA:.0f} m2 at {area:.0f}")

        # A thin band falls back to the nearest populated band BELOW, never to
        # the global curve. Dubai South's 50,000+ band has n=5 and exercises it.
        thin = [b for b in table["bands"] if b.get("medianM") is None and b["n"] > 0]
        for band in thin:
            a = float(band["minArea"]) * 1.5
            if abs(fitted(table, a) - global_prior(a)) < 1e-9:
                failures.append(f"{sid}: thin band at {band['minArea']:.0f} fell back to "
                                f"the global curve instead of the band below")

    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    print("  height prior: fitted beats global above the threshold, and is inert below it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it**

Run: `python3 scripts/check-height-prior.py; echo "EXIT: $?"`
Expected: `dubai-south` improving roughly 15.16 → 8.58 m, `dubai-creek` roughly
33.18 → 32.69 m, then the summary line and `EXIT: 0`.

- [ ] **Step 3: Mutation-check it — commit first**

```bash
python3 -m mypy
git add scripts/check-height-prior.py
git commit -m "test(flood-sim): hold out the fitted prior against real height tags only

The first version of this test scored 100 % and meant nothing: 76-81 % of
'measured' heights are building:levels x 4.0, and 57 % of Dubai South is the
single value 8.0 m, so predicting 8.0 is perfect and proves nothing. Ground
truth here is only the genuine height= tags."
```

Then break it and confirm it notices:

```bash
python3 - <<'EOF'
import json
p = 'public/flood-sim/data/dubai-south-buildings.json'
d = json.load(open(p))
for b in d['heightTable']['bands']:
    if b.get('medianM') is not None:
        b['medianM'] = 26.0          # force every band back to roughly the global curve
json.dump(d, open(p, 'w'), separators=(',', ':'))
EOF
python3 scripts/check-height-prior.py; echo "EXIT: $?"
git checkout -- public/flood-sim/data/dubai-south-buildings.json
python3 scripts/check-height-prior.py; echo "EXIT: $?"
```
Expected: `EXIT: 1` with `the fitted prior is worse than the global curve`, then `EXIT: 0`.

- [ ] **Step 4: Wire it into the gate**

In `package.json`, add to `"scripts"`:
```json
"check:heightprior": "python3 scripts/check-height-prior.py",
```
and insert `&& npm run check:heightprior` into `"verify"` immediately after
`npm run check:footprints`.

```bash
git add package.json
git commit -m "test(flood-sim): the height prior check joins the gate"
```

---

## Task 9: Look at it

**Files:** none.

- [ ] **Step 1: Open the scene**

```bash
/Applications/Blender.app/Contents/MacOS/Blender /tmp/dubai-south-acc.blend
```

- [ ] **Step 2: Frame Expo City and confirm Terra floats**

In Blender's Python console:

```python
import bpy, math
from mathutils import Euler
terra = [o for o in bpy.data.objects]
# Terra sits near site-local (2524, 2850); the parts path draws it inside `buildings`
for win in bpy.context.window_manager.windows:
    for area in win.screen.areas:
        if area.type != 'VIEW_3D':
            continue
        sp = area.spaces[0]; sh = sp.shading
        sh.type = 'SOLID'; sh.light = 'STUDIO'
        sh.color_type = 'SINGLE'; sh.single_color = (0.74, 0.74, 0.72)
        sh.show_cavity = True
        sh.background_type = 'VIEWPORT'; sh.background_color = (0.32, 0.36, 0.40)
        sp.overlay.show_floor = False
        sp.clip_start, sp.clip_end = 1.0, 200000
        r = sp.region_3d
        r.view_location = (2524, 2850, 40)
        r.view_distance = 700
        r.view_rotation = Euler((math.radians(78), 0, math.radians(140)), 'XYZ').to_quaternion()
        area.tag_redraw()
```

**Apply shading across `bpy.context.window_manager.windows`, not `bpy.context.screen`** — on
a freshly launched Blender the screenshot otherwise captures an unstyled area and looks
black.

Terra should read as a disc floating clear of the ground, not a solid block.

- [ ] **Step 3: Compare the warehouse district against the previous render**

Frame Dubai Logistics City near site-local (6057, 5566). The large flat-roofed buildings
should read as single-storey sheds rather than mid-rise blocks.

---

## Task 10: Al Wasl Dome — do not build this without a citation

**Files:**
- Modify: `public/flood-sim/data/dubai-south-landmarks.json` (create only if a source is found)
- Modify: `scripts/blender_landmarks.py` (only if a source is found)

- [ ] **Step 1: Try to find a citable height**

The dome is absent from the model. OSM has only the paved plaza (`w546958882`,
`highway=pedestrian`, 114 × 115 m) and the square (`w986435237`, `place=square`). Neither
carries a dimension. Wikidata's `Q108748896` holds exactly one claim: country.

Look for a height in a source you can name in `heightSource`. Expo City Dubai's own
published material, a structural engineering paper, or a Wikidata edit that adds `P2048`
with a reference all qualify.

- [ ] **Step 2: If no source is found, stop and record it**

Add to `docs/evidence/dubai-authored-massing.md`, under **Open**:

```markdown
- **Al Wasl Dome is absent and stays absent.** The 130 m-wide trellis over Expo
  City's centre has no structure in OSM — only the paved plaza beneath it
  (`w546958882`, `highway=pedestrian`) — and no dimension in any open source
  checked: OSM carries no height tag, and Wikidata's `Q108748896` holds a single
  claim, country. It is not modelled, because the height would have to be
  invented, and a landmark whose height is invented is exactly what the
  `heightSource` field exists to prevent.
```

Commit and **close the task**. This is a legitimate outcome, not a failure.

- [ ] **Step 3: Only if a source WAS found — add the `dome` builder**

In `scripts/blender_landmarks.py`, beside the other builders:

```python
def dome(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """A hemisphere over the ring's own extent, scaled to `height`.

    The Al Wasl dome is a steel LATTICE used as a projection surface, not a
    shell. A solid dome is a coarser approximation than the Burj Al Arab's sail,
    where the plan at least encoded the building. The evidence note says so.
    """
    rings = int(params.get("rings", 12))
    seg = len(ring)
    cx = sum(p[0] for p in ring) / seg
    cy = sum(p[1] for p in ring) / seg
    sections: list[tuple[Ring, float]] = []
    for i in range(rings + 1):
        t = i / rings
        s = math.cos(t * math.pi / 2)          # radius shrinks as a quarter circle
        z = base + height * math.sin(t * math.pi / 2)
        sections.append(([(cx + (x - cx) * s, cy + (y - cy) * s) for (x, y) in ring], z))
    return _loft(sections)
```

Register it in `BUILDERS` as `"dome": dome`, and add a self-test asserting the top ring
collapses toward the centre while the base ring does not, mirroring the `sail` test.

- [ ] **Step 4: Only if a source WAS found — the recipe with an explicit plan**

Because the plaza is a pavement and not in the buildings artefact, the recipe carries its
own ring. Extend the loader to accept `plan` (a flat `[x0,y0,x1,y1,...]` array in site-local
metres) as an alternative to `osm`, and **fail if a recipe carries both** — they are
alternatives, and silently preferring one would hide a mistake.

Create `public/flood-sim/data/dubai-south-landmarks.json` with `planSource` naming
`w546958882` and `heightSource` naming whatever was found in Step 1.

---

## Task 11: Final verification

- [ ] **Step 1: Run the whole gate, recording the exit code inside the log**

```bash
npm run verify > /tmp/verify-south.log 2>&1
echo "=== VERIFY EXIT: $? ===" >> /tmp/verify-south.log
tail -1 /tmp/verify-south.log
```
Expected: `=== VERIFY EXIT: 0 ===`.

**Write the exit code into the file.** Piping into `tail` reports tail's status, and a
background wrapper's own `echo` masks npm's — both have produced a false "green" in this
repo before.

- [ ] **Step 2: Confirm the footprint gate is unchanged since Task 5**

Run: `python3 scripts/check-dubai-footprints.py`
Expected: `footprints unchanged across 2 site(s)`. Anything else means a task after 5 moved
a ring, which nothing in this plan should do.

- [ ] **Step 3: Update the evidence note**

Add to `docs/evidence/dubai-authored-massing.md`:

```markdown
## Dubai South (2026-09-05)

Everything done to Dubai South is **measured**, with no authored geometry at all.

- **Terra and ~27 exhibition halls** were absent because OSM tags them
  `tourism=attraction` rather than `building=`, and the fetcher asked only for
  buildings. They are now included at OSM's own heights. Terra arrives as a slab
  between `min_height=28` and `height=30`, which is what OSM described all along.
- **The height prior is now fitted per site above 5,000 m².** The global curve is
  monotonic in footprint; reality is not. Dubai South is Logistics City and
  JAFZA, where the largest buildings are the flattest, and 923 of them rendered
  2.3–2.6× too tall. Held out against genuine `height=` tags only, mean absolute
  error falls from 15.16 m to 8.58 m. The Creek moves 33.18 → 32.69 m, so this is
  a Dubai South fix.
- **Wikidata contributes nothing here.** Two items with heights fall in the
  window and both are unbuilt.
```

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/evidence/dubai-authored-massing.md
git commit -m "docs(evidence): Dubai South's fixes are measured, and the dome is not modelled"
git push -u origin feat/dubai-south-accuracy
gh pr create --base feat/flood-sim --title "Dubai South: recover dropped structures and fit the height prior" --body "$(cat <<'EOF'
## What Dubai South needed, and did not

Most of the Creek's fixes do not transfer. **Wikidata contributes exactly zero heights** — two items with a height fall inside the window, Nakheel Tower and Victory of Robots, and both are unbuilt. There is no skyline to rescue either: 41 buildings over 100 m against the Creek's 530.

## Structures OSM does not call buildings

The fetcher asked for `way["building"]`. **Terra — The Sustainability Pavilion** is tagged `tourism=attraction` with `height=30` and `min_height=28`, and was absent from the model entirely, along with ~27 Dubai Exhibition Centre halls. Terra now arrives as the floating canopy OSM described, not a solid block.

The cache key had to be fixed first: it hashed the window and not the query, so widening the query would have silently re-served the old response.

## The height prior

The global curve is monotonic in footprint. Reality is not — the same area is a tower in the Creek and a warehouse in Dubai South. **923 buildings over 5,000 m² rendered 2.3–2.6× too tall.**

Each site now fits a table from its own measured buildings, applied only above 5,000 m² because below that a fitted prior measurably does worse. Held out against genuine `height=` tags only:

| site | n | global | fitted |
|---|---:|---:|---:|
| dubai-south | 45 | 15.16 m | **8.58 m** |
| dubai-creek | 56 | 33.18 m | 32.69 m |

An earlier version of that test scored 100% and meant nothing: 76–81% of "measured" heights are `building:levels × 4.0`, and 57% of Dubai South is the single value 8.0 m.

## Al Wasl Dome — deliberately not built

It is absent from the model, OSM has no dimension tag, and Wikidata's `Q108748896` holds one claim: country. No height could be cited, so it was not added.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019Wp1ArE4ctCbgHDvjhY1XY
EOF
)"
```

---

## Deferred

- **Al Maktoum concourse massing.** `Concourse 1` is 481,308 m² with no height and will now
  take the large-band median rather than the global 36 m. Whether an airport concourse
  deserves authored form is a separate question.
- **Palm Jebel Ali.** Inside the window, largely undeveloped. Nothing to fix.
- **The Creek's open items** — the wave crest, Ciel Tower, The Marina Torch.
