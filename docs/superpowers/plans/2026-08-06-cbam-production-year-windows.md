# CBAM Production-Year Validity Windows — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a verified, upstream-ready patch to `CBM/scripts/build-fa-package.py` that moves Annex §5.3 production-year markers `(1)`/`(2)` out of `routeIndicator` and into `validFrom`/`validTo`, together with the evidence that no benchmark value moved.

**Architecture:** All work happens in a scratch tree. `build-fa-package.py` is copied there, edited, and run there — `OUT` resolves relative to the script's parent, so a regenerated package lands in the scratch tree and neither repo is touched. Nothing in Angad or CBM is modified by this plan. The deliverable is a patch file plus an evidence file.

**Tech Stack:** Python 3 with openpyxl 3.1.5 (installed), Node + tsx for driving the live TypeScript engine, `git diff --no-index` for the patch.

**Spec:** `docs/superpowers/specs/2026-08-06-cbam-production-year-windows-design.md`

---

## Working paths

Every task uses these. `SCRATCH` is outside both repos on purpose.

```
SCRATCH=/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/4cfc08a6-a969-440b-92fa-7eb9e10fc4de/scratchpad/cbam-fix
CBM=/Volumes/VSTSAMPLES/Projects/CBM
ANGAD=/Volumes/VSTSAMPLES/Projects/Angad
```

- `$SCRATCH/scripts/build-fa-package.py` — the working copy we edit
- `$SCRATCH/golden/rule-packages/eu-cbam-2026-free-allocation.json` — where `OUT` resolves to
- `$SCRATCH/benchmarks.xlsx` — the pinned EC workbook
- `$SCRATCH/baseline.json` — regeneration from the *unmodified* script
- `$SCRATCH/evidence.md` — the deliverable write-up

## File structure

| File | Responsibility |
| --- | --- |
| `$SCRATCH/scripts/build-fa-package.py` | The patched generator. Only file whose content ships upstream. |
| `$SCRATCH/tests/test_invariants.py` | The regression test — asserts no year marker survives in `routeIndicator`, and no `(CN, column, route)` group mixes bounded and unbounded rows. Written in Python here because it must run against the generator's output in this tree. **Porting it to CBM's vitest suite is Phase 2 work**, not covered by this plan. |
| `$SCRATCH/tests/migration_gate.py` | One-off. Proves no `bmTco2ePerT` moved between old and new golden. Deleted after the migration. |
| `$SCRATCH/measure_coverage.mts` | Drives the live engine to re-measure priceable goods. Evidence only. |
| `$SCRATCH/build-fa-package.patch` | The deliverable diff. |
| `$SCRATCH/evidence.md` | The deliverable write-up. |

---

### Task 1: Scratch tree and the pinned workbook

**Files:**
- Create: `$SCRATCH/scripts/build-fa-package.py` (copy)
- Create: `$SCRATCH/benchmarks.xlsx` (download)

- [ ] **Step 1: Create the tree and copy the generator unmodified**

```bash
SCRATCH=/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/4cfc08a6-a969-440b-92fa-7eb9e10fc4de/scratchpad/cbam-fix
mkdir -p "$SCRATCH/scripts" "$SCRATCH/tests"
cp /Volumes/VSTSAMPLES/Projects/CBM/scripts/build-fa-package.py "$SCRATCH/scripts/"
shasum -a256 "$SCRATCH/scripts/build-fa-package.py" | cut -c1-16
```

Expected: a hash prints. Record it — Task 7 diffs against this pristine copy.

- [ ] **Step 2: Fetch the pinned workbook and verify its hash**

```bash
curl -sL --max-time 90 -A "Mozilla/5.0" \
  -o "$SCRATCH/benchmarks.xlsx" \
  "https://taxation-customs.ec.europa.eu/document/download/9877523c-2a02-4926-a211-aefae7cf6d0d_en"
shasum -a256 "$SCRATCH/benchmarks.xlsx"
```

Expected exactly:
```
b79108b025e697822f0f59de477fa68066c1c05c228fae2270cd230af84e8a7b
```

If it differs, **stop**. The EC has reissued the workbook, which per the generator's own guard is a new rule-package version and a different piece of work. Do not proceed.

---

### Task 2: Fidelity baseline — prove the scratch pipeline is faithful

The scratch tree must reproduce CBM's committed golden exactly *before* we change anything. If it cannot, every later comparison is meaningless.

**Note on the other baseline.** The spec calls for running CBM's `npm test` and `npm run typecheck` before editing, to establish what "passing" looks like. That belongs to **Phase 2** — Phase 1 never touches CBM, so there is nothing there to regress. Whoever applies the patch must still run it as their step 0.

**Files:**
- Create: `$SCRATCH/golden/rule-packages/eu-cbam-2026-free-allocation.json` (generated)
- Create: `$SCRATCH/baseline.json` (copy of the above)

- [ ] **Step 1: Run the unmodified generator**

```bash
cd "$SCRATCH" && python3 scripts/build-fa-package.py benchmarks.xlsx
```

Expected: `wrote golden/rule-packages/eu-cbam-2026-free-allocation.json`

- [ ] **Step 2: Compare it to CBM's committed golden**

```bash
python3 - <<'PY'
import json
a=json.load(open('/Volumes/VSTSAMPLES/Projects/CBM/golden/rule-packages/eu-cbam-2026-free-allocation.json'))
b=json.load(open('/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/4cfc08a6-a969-440b-92fa-7eb9e10fc4de/scratchpad/cbam-fix/golden/rule-packages/eu-cbam-2026-free-allocation.json'))
print("benchmark rows  committed:", len(a['benchmarks']), " regenerated:", len(b['benchmarks']))
print("identical:", a['benchmarks'] == b['benchmarks'])
PY
```

Expected:
```
benchmark rows  committed: 2465  regenerated: 2465
identical: True
```

If `identical` is False, **stop and investigate**. Either the committed golden was hand-edited or the workbook drifted. Report the first differing row before going further.

- [ ] **Step 3: Freeze the baseline**

```bash
cp "$SCRATCH/golden/rule-packages/eu-cbam-2026-free-allocation.json" "$SCRATCH/baseline.json"
```

---

### Task 3: The failing invariant test

TDD: this test asserts the property the bug violates, so it must fail against the current output.

**Files:**
- Create: `$SCRATCH/tests/test_invariants.py`

- [ ] **Step 1: Write the failing test**

```python
"""Structural invariants for the free-allocation benchmark rows.

Annex §5.3 marks production-year variants (1) 2026-27 and (2) 2028-30. Those are
validity windows. A year marker surviving in routeIndicator is the bug this
guards against — defaultFactors never emits such a route, so the row is
unreachable and the good cannot be priced.
"""
import json
import re
import sys
from collections import defaultdict

GOLDEN = "golden/rule-packages/eu-cbam-2026-free-allocation.json"
YEAR_MARKER = re.compile(r"\(\d\)")


def load():
    with open(GOLDEN, encoding="utf-8") as fh:
        return json.load(fh)["benchmarks"]


def test_no_year_marker_in_route(rows):
    bad = [r for r in rows if YEAR_MARKER.search(r.get("routeIndicator") or "")]
    assert not bad, (
        f"{len(bad)} rows carry a production-year marker in routeIndicator; "
        f"first: {bad[0]['id']} route={bad[0]['routeIndicator']!r}"
    )


def test_bounded_rows_have_both_ends(rows):
    bad = [r for r in rows if r.get("validTo") and not r.get("validFrom")]
    assert not bad, f"{len(bad)} rows have validTo without validFrom"


def test_no_group_mixes_bounded_and_open(rows):
    """The dedupe key is (scopeCode, column, routeIndicator, validFrom). It is
    sufficient only while no group holds both a windowed and an unwindowed row —
    otherwise resolveBenchmark sees two active rows for one date and throws
    REGULATION_AMBIGUOUS. True of the current workbook; a reissue could break it.
    """
    groups = defaultdict(set)
    for r in rows:
        key = (r["scopeCode"], r["benchmarkColumn"], r.get("routeIndicator") or "")
        groups[key].add(bool(r.get("validTo")))
    bad = {k: v for k, v in groups.items() if len(v) > 1}
    assert not bad, f"{len(bad)} groups mix bounded and unbounded rows; first: {next(iter(bad))}"


if __name__ == "__main__":
    rows = load()
    failures = 0
    for fn in (test_no_year_marker_in_route, test_bounded_rows_have_both_ends,
               test_no_group_mixes_bounded_and_open):
        try:
            fn(rows)
            print(f"  PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"  FAIL  {fn.__name__}: {exc}")
    sys.exit(1 if failures else 0)
```

- [ ] **Step 2: Run it and verify it fails**

```bash
cd "$SCRATCH" && python3 tests/test_invariants.py
```

Expected: exit 1, with
```
  FAIL  test_no_year_marker_in_route: 794 rows carry a production-year marker in routeIndicator; first: ...
  PASS  test_bounded_rows_have_both_ends
  PASS  test_no_group_mixes_bounded_and_open
```

The first test failing on **794** rows is the confirmation that the plan's arithmetic matches reality. If the count differs, stop and reconcile with the spec before continuing.

---

### Task 4: Add `split_route` and rewire the call site

**Files:**
- Modify: `$SCRATCH/scripts/build-fa-package.py`

- [ ] **Step 1: Add the `re` import**

`re` is not currently imported. Change the import block (around line 19) from:

```python
import hashlib
import json
import sys
from pathlib import Path
```

to:

```python
import hashlib
import json
import re
import sys
from pathlib import Path
```

- [ ] **Step 2: Add the constants and helper immediately after `VALID_FROM`**

`VALID_FROM = "2026-01-01T00:00:00.000Z"` sits near line 29. Insert directly below it:

```python
# Annex §5.3 marks production-year variants of a benchmark: (1) is used for
# production years 2026-27 and (2) for 2028-30. These are VALIDITY WINDOWS, not
# production routes. Left in routeIndicator they are unreachable — the defaults
# corpus never declares a route of "(1)", nor a compound "(F)(1)" — so the good
# simply cannot be priced. 794 of 2465 rows are affected.
YEAR_WINDOWS = {
    "(1)": ("2026-01-01T00:00:00.000Z", "2027-12-31T23:59:59.999Z"),
    "(2)": ("2028-01-01T00:00:00.000Z", "2030-12-31T23:59:59.999Z"),
}
YEAR_SLUG = {"(1)": "2026", "(2)": "2028"}
_ROUTE_WITH_YEAR = re.compile(r"(\([A-Z]\))?(\([12]\))")


def split_route(raw):
    """Separate a production route from a production-year marker.

        "(F)(1)" -> route "(F)", valid 2026-27
        "(1)"    -> route-independent, valid 2026-27
        "(C)"    -> route "(C)", open-ended
        ""       -> route-independent, open-ended

    Returns (routeIndicator, validFrom, validTo, period_slug).
    """
    match = _ROUTE_WITH_YEAR.fullmatch(raw or "")
    if not match:
        return raw or "", VALID_FROM, None, None
    valid_from, valid_to = YEAR_WINDOWS[match.group(2)]
    return (match.group(1) or ""), valid_from, valid_to, YEAR_SLUG[match.group(2)]
```

- [ ] **Step 3: Rewire the row-building loop**

Replace this block (around lines 155-173):

```python
        for column, value, route in (("A", col_a, route_a), ("B", col_b, route_b)):
            if value is None:
                continue
            slug = route.strip("()") or "base"
            benchmarks.append({
                "id": f"bm-{carried_cn}-{column.lower()}-{slug.lower()}",
                "rulePackageId": PACKAGE_ID,
                "scopeCode": carried_cn,
                "codeLevel": len(carried_cn),
                "benchmarkColumn": column,
                "routeIndicator": route,
                "bmTco2ePerT": value,
                "sourceId": "ec-benchmarks-workbook-v1",
                "sourceLocator": f"IR (EU) 2025/2620 Annex, Column {column}"
                                 f"{' route ' + route if route else ''}"
                                 f" (via EC benchmarks workbook v1, sheet row {index})",
                "validFrom": VALID_FROM,
                "validTo": None,
            })
```

with:

```python
        for column, value, route in (("A", col_a, route_a), ("B", col_b, route_b)):
            if value is None:
                continue
            route_id, valid_from, valid_to, period = split_route(route)
            # str.strip("()") only removes LEADING/TRAILING chars, so "(F)(1)"
            # yielded "F)(1" and ids like bm-72052100-b-f)(1. Extract the letters.
            slug = "-".join(re.findall(r"[A-Z]", route_id)).lower() or "base"
            if period:
                slug = f"{slug}-{period}"
            benchmarks.append({
                "id": f"bm-{carried_cn}-{column.lower()}-{slug}",
                "rulePackageId": PACKAGE_ID,
                "scopeCode": carried_cn,
                "codeLevel": len(carried_cn),
                "benchmarkColumn": column,
                "routeIndicator": route_id,
                "bmTco2ePerT": value,
                "sourceId": "ec-benchmarks-workbook-v1",
                # The ORIGINAL marker, not the split route. The provenance string
                # must still point at the workbook cell this row came from.
                "sourceLocator": f"IR (EU) 2025/2620 Annex, Column {column}"
                                 f"{' route ' + route if route else ''}"
                                 f" (via EC benchmarks workbook v1, sheet row {index})",
                "validFrom": valid_from,
                "validTo": valid_to,
            })
```

- [ ] **Step 4: Widen the duplicate-selector key**

Replace this block (around lines 180-185):

```python
    seen = {}
    for row in benchmarks:
        key = (row["scopeCode"], row["benchmarkColumn"], row["routeIndicator"])
        if key in seen:
            sys.exit(f"duplicate benchmark selector {key!r} — would resolve REGULATION_AMBIGUOUS")
        seen[key] = row["id"]
    return benchmarks, cn_rows
```

with:

```python
    seen = {}
    for row in benchmarks:
        # validFrom is part of the key because (F)(1) and (F)(2) both resolve to
        # route (F) and are separated only by their validity window.
        key = (row["scopeCode"], row["benchmarkColumn"], row["routeIndicator"],
               row["validFrom"])
        if key in seen:
            sys.exit(f"duplicate benchmark selector {key!r} — would resolve REGULATION_AMBIGUOUS")
        seen[key] = row["id"]
    return benchmarks, cn_rows
```

- [ ] **Step 5: Regenerate and run the invariant test**

```bash
cd "$SCRATCH" && python3 scripts/build-fa-package.py benchmarks.xlsx && python3 tests/test_invariants.py
```

Expected: `wrote golden/...`, then exit 0 with all three PASS.

- [ ] **Step 6: Confirm the rewritten-row count**

```bash
cd "$SCRATCH" && python3 -c "
import json
rows=json.load(open('golden/rule-packages/eu-cbam-2026-free-allocation.json'))['benchmarks']
print('rows with a bounded window:', sum(1 for r in rows if r.get('validTo')))
print('total rows              :', len(rows))"
```

Expected exactly:
```
rows with a bounded window: 794
total rows              : 2465
```

---

### Task 5: Migration gate — prove no benchmark value moved

This is the money-safety property. It is the reason the whole change is safe to ship.

**Files:**
- Create: `$SCRATCH/tests/migration_gate.py`

- [ ] **Step 1: Write the gate**

```python
"""One-off migration gate: the year-window change must not move a single value.

Run once, during this migration, then delete. It answers exactly one question —
did we corrupt the data — and nothing else.
"""
import json
import sys
from collections import Counter

BASE = "baseline.json"
NEW = "golden/rule-packages/eu-cbam-2026-free-allocation.json"
MUTABLE = {"id", "routeIndicator", "validFrom", "validTo"}


def rows(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["benchmarks"]


old, new = rows(BASE), rows(NEW)
failures = []

if len(old) != len(new):
    failures.append(f"row count changed: {len(old)} -> {len(new)}")

# The property that matters: every value still present, on the same CN and column.
old_values = Counter((r["scopeCode"], r["benchmarkColumn"], r["bmTco2ePerT"]) for r in old)
new_values = Counter((r["scopeCode"], r["benchmarkColumn"], r["bmTco2ePerT"]) for r in new)
if old_values != new_values:
    lost = old_values - new_values
    gained = new_values - old_values
    failures.append(f"VALUES MOVED. lost={list(lost)[:5]} gained={list(gained)[:5]}")

# Only the four expected fields may differ, and only where a year marker existed.
by_locator_old = {r["sourceLocator"]: r for r in old}
by_locator_new = {r["sourceLocator"]: r for r in new}
if set(by_locator_old) != set(by_locator_new):
    failures.append("sourceLocator set changed — provenance strings are not stable")
else:
    for loc, o in by_locator_old.items():
        n = by_locator_new[loc]
        for field in o.keys() | n.keys():
            if field in MUTABLE:
                continue
            if o.get(field) != n.get(field):
                failures.append(f"immutable field {field!r} changed on {loc[:70]}")
                break

changed = sum(1 for loc, o in by_locator_old.items()
              if by_locator_new[loc].get("validTo"))
print(f"rows gaining a bounded window: {changed}")
print(f"total rows: {len(new)}")

if failures:
    print("\nGATE FAILED")
    for f in failures[:10]:
        print("  -", f)
    sys.exit(1)
print("\nGATE PASSED — no benchmark value moved, provenance stable")
```

- [ ] **Step 2: Run it**

```bash
cd "$SCRATCH" && python3 tests/migration_gate.py
```

Expected:
```
rows gaining a bounded window: 794
total rows: 2465

GATE PASSED — no benchmark value moved, provenance stable
```

If it fails, **stop**. Do not proceed to the deliverable. Report the exact failure.

---

### Task 6: Re-measure coverage through the live engine

Evidence, not a test. Confirms the fix does what the spec claims.

**Files:**
- Create: `$SCRATCH/measure_coverage.mts`

- [ ] **Step 1: Write the measurement**

```typescript
// Drives the real vendored engine over (a) the shipped pack and (b) the same pack
// with the regenerated benchmark rows spliced in, and reports how many catalogue
// goods become priceable. The engine is unmodified — only the data differs.
import { readFileSync } from 'node:fs'
import { estimateFromPack, routesFor } from '/Volumes/VSTSAMPLES/Projects/Angad/src/scripts/cbam-algos/estimator/estimate-from-pack.ts'

const SCRATCH = '/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/4cfc08a6-a969-440b-92fa-7eb9e10fc4de/scratchpad/cbam-fix'
const shipped = JSON.parse(readFileSync('/Volumes/VSTSAMPLES/Projects/Angad/public/cbam/estimator-pack.json', 'utf8'))
const regenerated = JSON.parse(readFileSync(`${SCRATCH}/golden/rule-packages/eu-cbam-2026-free-allocation.json`, 'utf8'))

const fixed = { ...shipped, benchmarks: regenerated.benchmarks }

function sweep(pack: any, year: number, date: string) {
  const codes: string[] = pack.classifications.map((c: any) => c.code)
  const priced = new Set<string>(), dead = new Set<string>()
  for (const cn of codes) for (const origin of ['IN', 'CN', 'TR', 'UA', 'BR']) {
    for (const route of routesFor(pack, cn, origin, year)) {
      try {
        const e: any = estimateFromPack(pack, { cn, country: origin, route, massT: '100', date })
        ;(e.status === 'unavailable' ? dead : priced).add(cn)
      } catch { /* counted as not-priced */ }
    }
  }
  return { priced: priced.size, dead: [...dead].filter(c => !priced.has(c)).length }
}

const before = sweep(shipped, 2026, '2026-03-01')
const after = sweep(fixed, 2026, '2026-03-01')
console.log('2026 imports, 574 catalogue CN codes x 5 origins')
console.log(`  BEFORE  priceable=${before.priced}  never-priceable=${before.dead}`)
console.log(`  AFTER   priceable=${after.priced}  never-priceable=${after.dead}`)
console.log(`  DELTA   +${after.priced - before.priced} goods`)
```

- [ ] **Step 2: Run it**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad && npx tsx "$SCRATCH/measure_coverage.mts"
```

Expected:
```
2026 imports, 574 catalogue CN codes x 5 origins
  BEFORE  priceable=385  never-priceable=185
  AFTER   priceable=547  never-priceable=23
  DELTA   +162 goods
```

If AFTER differs from 547, that is **informative, not fatal** — it means the real generator produced something the earlier simulation did not. Record the actual number and note the discrepancy in the evidence file rather than forcing the expected figure.

---

### Task 7: Package the deliverable

**Files:**
- Create: `$SCRATCH/build-fa-package.patch`
- Create: `$SCRATCH/evidence.md`

- [ ] **Step 1: Produce the patch against the pristine upstream file**

```bash
cd "$SCRATCH"
git diff --no-index --no-prefix \
  /Volumes/VSTSAMPLES/Projects/CBM/scripts/build-fa-package.py \
  scripts/build-fa-package.py > build-fa-package.patch || true
wc -l build-fa-package.patch
```

Expected: a non-empty diff, roughly 60-80 lines. `|| true` is needed because `git diff --no-index` exits 1 when files differ.

- [ ] **Step 2: Verify the patch applies cleanly to a pristine copy**

```bash
cd "$SCRATCH"
mkdir -p verify && cp /Volumes/VSTSAMPLES/Projects/CBM/scripts/build-fa-package.py verify/
cd verify && git apply --check ../build-fa-package.patch && echo "PATCH APPLIES CLEANLY"
```

Expected: `PATCH APPLIES CLEANLY`

If it does not apply, the patch was generated against the wrong base. Regenerate it.

- [ ] **Step 3: Spot-check the hand-verified rows**

The spec records rows checked against the Annex PDF by eye. Confirm the regenerated package still carries them, so the evidence file can cite a check rather than an assertion.

```bash
cd "$SCRATCH" && python3 -c "
import json
rows=json.load(open('golden/rule-packages/eu-cbam-2026-free-allocation.json'))['benchmarks']
want=[('25232900','B',''),('25231000','B','(A)'),('72241010','A','(F)'),('72241010','B','(F)')]
for cn,col,route in want:
    hits=[r for r in rows if r['scopeCode']==cn and r['benchmarkColumn']==col and r.get('routeIndicator','')==route]
    for h in hits:
        print(f\"  {cn} col{col} route={route or chr(39)*2:<5} bm={h['bmTco2ePerT']:<7} validTo={h.get('validTo') or 'open'}\")"
```

Expected: `25232900` col B = `0.666` open; `25231000` col B route `(A)` = `0.666` open; `72241010` col A route `(F)` = `0.453` open; `72241010` col B route `(F)` = **two rows**, `1.807` bounded to 2027 and `1.640` bounded to 2030.

That last line is the whole fix in one output — one route, two windows, values untouched.

- [ ] **Step 4: Write the evidence file**

Write `$SCRATCH/evidence.md`. Substitute every angle-bracketed field with the actual output from the runs above — do not leave a bracket in the finished file.

```markdown
# Evidence — CBAM production-year validity windows (Phase 1)

Generated <date>. Spec: docs/superpowers/specs/2026-08-06-cbam-production-year-windows-design.md

## Fidelity
Unmodified generator reproduces CBM's committed golden exactly: 2465 rows, identical == True.

## Workbook
sha256 b79108b025e697822f0f59de477fa68066c1c05c228fae2270cd230af84e8a7b — matches the pin.

## Invariants (tests/test_invariants.py)
Before: FAIL, 794 rows carry a year marker in routeIndicator.
After:  PASS on all three.

## Migration gate (tests/migration_gate.py)
GATE PASSED — no benchmark value moved, provenance stable. 794 of 2465 rows gained a window.

## Coverage (measure_coverage.mts, live engine)
2026 imports, 574 CN codes x 5 origins:
  BEFORE priceable=385 never-priceable=185
  AFTER  priceable=<actual> never-priceable=<actual>

## Not proven here
The browser pack was not regenerated — Angad has no golden/ dir and
build-estimator-pack.mts needs both the free-allocation and default-values golden
packages. Coverage above splices regenerated benchmarks into the shipped pack and
drives the real engine, so it is a strong prediction, not a measurement of the
true artefact. Confirm after running build-estimator-pack.mts inside CBM.

## To apply
cd $CBM && git apply /path/to/build-fa-package.patch
python3 scripts/build-fa-package.py /path/to/benchmarks.xlsx
npx tsx scripts/build-estimator-pack.mts
npm test && npm run typecheck
```

- [ ] **Step 5: Report to the user**

Print the patch path, the evidence path, and the three headline numbers (794 rows rewritten, gate result, coverage delta). Do not commit anything to either repo — Phase 2 is a human's decision.

The plan and spec live in Angad and may be committed; the scratch artefacts must not be.

---

## Out of scope for this plan

- Editing anything in `$CBM` or `$ANGAD`. Phase 1 touches neither.
- Regenerating the browser pack (impossible here — see Task 6 Step 2 note).
- The certificate-price dead zone for 2027+ import dates. Separate finding.
- Replacing the timestamp-only pack guard in `UPSTREAM.json` with a content hash. Separate finding, recorded in the spec.
- Any change to `resolve-fa.ts`, `sefa.ts`, `estimate-from-pack.ts`, or the calculator UI. The engine is correct and needs no edit.
