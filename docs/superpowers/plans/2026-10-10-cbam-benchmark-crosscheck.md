# CBAM Benchmark Cross-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit test that fails, naming the column, good and route, whenever the calculator's free-allocation benchmarks disagree with the Annex to IR (EU) 2025/2620 as printed in the Official Journal.

**Architecture:** One committed JSON fixture holds the Annex's Column A and Column B values for both benchmark periods, read from the Official Journal PDF and stamped with that PDF's SHA-256. One `node:test` file compares it with the shipped pack in both directions and carries its own proof that the comparison bites. No production code changes.

**Tech Stack:** Node 24 (`.nvmrc`) `node:test`, `tsx`, `decimal.js` (already a dependency); Python 3 and `pdftotext` (poppler) for the one-off fixture build.

**Spec:** `docs/superpowers/specs/2026-10-10-cbam-three-year-view-design.md`, section 3. This is plan 1 of 3 (section 8).

**Status: executed.** The code blocks below are the code as committed. Every expected output below was observed on 2026-10-11.

---

## Rules for whoever executes this

- Work only in the worktree `/Volumes/OBOSLab/worktrees/cbam-three-year`, branch `feat/cbam-three-year-view`. Never touch the shared main checkout; other sessions use it.
- This repository is public. Stage named paths only. Never `git add -A`. `node_modules` and `dist/` must not be staged.
- Never amend, stash, or `reset --hard`.
- Never weaken a test in place to prove it bites. Mutation proofs run on copies outside the repo (task 4). An in-place edit that disables a check is refused by the permission system, and rightly.
- No push, PR or merge without the owner's explicit word.
- `git commit` and `rm` prompt the owner for approval. That is expected.

## File map

| File | Responsibility |
|---|---|
| Create `tests/fixtures/cbam-benchmarks-ir-2025-2620.json` | The Annex's benchmarks: per period, 650 Column A cells and 1,418 Column B cells |
| Create `tests/unit/cbam-benchmarks-crosscheck.test.mjs` | The comparison, both directions, per column and period, and its self-proof |

`npm run test:unit` already runs every `tests/unit/*.test.mjs`, so nothing is wired.

---

### Task 1: Install, build, baseline

**Files:** none tracked.

- [ ] **Step 1: Install from the lockfile**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && npm ci
```

Expected: exits 0. (If `node_modules` is a symlink left by an earlier session, remove the symlink first.)

- [ ] **Step 2: Build the site**

Ten `standards-*` unit tests assert on build output under `dist/` and fail with "build first" in a fresh worktree. `npm run verify` builds before it tests for the same reason.

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && npm run build > /tmp/cbam-crosscheck-build.log 2>&1; echo "build exit $?"; ls dist/standards/index.html
```

Expected: `build exit 0` and the file listed.

- [ ] **Step 3: Baseline**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored engine|in sync"
```

Expected: `ℹ fail 0`. On `origin/main` `f0b19fe` this printed `ℹ tests 1379`. Task 4 expects the total to rise by exactly 8.

---

### Task 2: The failing test

**Files:**
- Create: `tests/unit/cbam-benchmarks-crosscheck.test.mjs`

- [ ] **Step 1: Write the test file**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import Decimal from 'decimal.js';

/**
 * THE PACK'S FREE-ALLOCATION BENCHMARKS, CHECKED AGAINST THE REGULATION'S OWN TEXT.
 *
 * The pack's benchmarks come from the Commission's benchmarks workbook, which describes itself
 * as informational: the legally valid values are those in the Annex to IR (EU) 2025/2620. The
 * fixture was read from that Annex in the Official Journal PDF, the document the pack itself
 * cites as source `ir-2025-2620`, and carries that PDF's SHA-256. So this compares the workbook's
 * route into the pack with the law it transcribes, Column A and Column B, both periods, in both
 * directions. A failure names the column, the good and the route to look up.
 *
 * WHAT THIS DOES NOT COVER. Default values, the free-allocation factor, the cross-sectoral
 * correction factor and certificate prices. A green run here is a statement about benchmarks.
 *
 * PERIODS ARE CHECKED AT ONE INSTANT EACH, which is only sound because a separate test pins
 * every benchmark row to one of the three validity windows the instants fall inside. A row valid
 * for 2027 alone would sit between the probes; that test is what refuses it.
 *
 * WHEN THE COMMISSION AMENDS THE ANNEX this fails at the next sync. Rebuild the fixture from the
 * amending act with the script in docs/superpowers/plans/2026-10-10-cbam-benchmark-crosscheck.md
 * and commit it with the regulation cited. A new good changes CELLS; a new period changes PROBE
 * and WINDOWS as well. Do not edit the fixture by hand to make the suite green.
 */
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const pack = read('../../public/cbam/estimator-pack.json');
const fixture = read('../fixtures/cbam-benchmarks-ir-2025-2620.json');

/** One instant inside each period, used to ask the pack which rows are in force. */
const PROBE = {
  '2026-2027': '2026-07-01T00:00:00.000Z',
  '2028-2030': '2028-07-01T00:00:00.000Z',
};
/** Cells in force per period, per column. */
const CELLS = { A: 650, B: 1418 };
const COLUMNS = Object.keys(CELLS);

/** The only validity windows a benchmark row may have. Each contains exactly the probes it should. */
const WINDOWS = new Set([
  '2026-01-01T00:00:00.000Z to open',
  '2026-01-01T00:00:00.000Z to 2027-12-31T23:59:59.999Z',
  '2028-01-01T00:00:00.000Z to 2030-12-31T23:59:59.999Z',
]);
const windowOf = (b) => `${b.validFrom} to ${b.validTo === null ? 'open' : b.validTo}`;
const ROUTE = /^(\([A-L]\))?$/;

const label = (cn, route) => `${cn} ${route || '(no route)'}`;
const key = (cn, route) => `${cn}|${route}`;

/**
 * Rows the comparison below could not read correctly, one line each: a validity window the
 * probes do not cover, a route the keys do not expect, or a column that is neither A nor B.
 */
function shapeProblems(benchmarks) {
  const problems = [];
  for (const b of benchmarks) {
    const who = `${b.benchmarkColumn} ${label(b.scopeCode, b.routeIndicator)}`;
    if (!COLUMNS.includes(b.benchmarkColumn)) problems.push(`${who}: column is neither A nor B`);
    if (typeof b.routeIndicator !== 'string' || !ROUTE.test(b.routeIndicator)) problems.push(`${who}: route is not '' or one letter in brackets`);
    if (!WINDOWS.has(windowOf(b))) problems.push(`${who}: valid ${windowOf(b)}, a window this test does not probe`);
  }
  return problems;
}

/** Every disagreement between the pack and the regulation for one column and period, one line each. */
function crossCheck(benchmarks, cells, period, column) {
  const probe = PROBE[period];
  const at = (cn, route) => `${period} ${column} ${label(cn, route)}`;
  const problems = [];
  // ISO timestamps of one shape sort as text; shapeProblems pins the shape.
  const packRows = new Map();
  for (const b of benchmarks) {
    if (b.benchmarkColumn !== column) continue;
    if (b.validFrom > probe) continue;
    if (b.validTo !== null && b.validTo < probe) continue;
    const k = key(b.scopeCode, b.routeIndicator);
    if (packRows.has(k)) problems.push(`${at(b.scopeCode, b.routeIndicator)}: two rows in force`);
    packRows.set(k, b);
  }
  const seen = new Set();
  for (const cell of cells) {
    const k = key(cell.cn, cell.route);
    seen.add(k);
    const got = packRows.get(k)?.bmTco2ePerT;
    if (!packRows.has(k)) problems.push(`${at(cell.cn, cell.route)}: regulation ${cell.value}, pack has no row`);
    else if (typeof got !== 'string') problems.push(`${at(cell.cn, cell.route)}: pack value ${got} is a ${typeof got}, not a decimal string`);
    else if (!new Decimal(got).eq(cell.value)) problems.push(`${at(cell.cn, cell.route)}: regulation ${cell.value}, pack ${got}`);
  }
  for (const [k, b] of packRows) {
    if (!seen.has(k)) problems.push(`${at(b.scopeCode, b.routeIndicator)}: pack ${b.bmTco2ePerT}, not in the regulation`);
  }
  return problems;
}

// This ties the fixture's stated source to the pack's. It cannot prove the cells were read from
// that PDF: the rebuild in the plan, which refuses any other file, is what shows that.
test('the fixture names the document the pack cites as the law', () => {
  const source = pack.sources.find((s) => s.id === 'ir-2025-2620');
  assert.ok(source, 'sanity: the pack cites IR (EU) 2025/2620');
  assert.equal(fixture.pdfSha256, source.sha256);
  assert.equal(fixture.eli, source.url);
});

test('the fixture holds exactly two periods of two columns', () => {
  assert.deepEqual(Object.keys(fixture.periods), Object.keys(PROBE));
  for (const period of Object.keys(PROBE)) assert.deepEqual(Object.keys(fixture.periods[period]), COLUMNS);
});

test('every benchmark row has a column, route and validity window the comparison can read', () => {
  assert.deepEqual(shapeProblems(pack.benchmarks), []);
});

for (const period of Object.keys(PROBE)) {
  for (const column of COLUMNS) {
    test(`Column ${column} benchmarks in force in ${period} match the regulation, both ways`, () => {
      const cells = fixture.periods[period][column];
      assert.deepEqual(crossCheck(pack.benchmarks, cells, period, column), []);
      assert.equal(cells.length, CELLS[column], 'the fixture itself has not lost or gained cells');
    });
  }
}

// IF THIS FAILS TOGETHER WITH A COLUMN TEST, READ THE COLUMN TEST FIRST. This one asserts exact
// lines against the live pack, so a real disagreement reddens it too, with a noisier diff.
test('the check bites: each kind of drift is reported by name', () => {
  const p26 = '2026-2027';
  const p28 = '2028-2030';
  const b26 = fixture.periods[p26].B;
  const b28 = fixture.periods[p28].B;
  const a26 = fixture.periods[p26].A;
  const isTube = (b) => b.benchmarkColumn === 'B' && b.scopeCode === '73063077' && b.routeIndicator === '(C)';
  const target = b26.find((c) => c.cn === '73063077' && c.route === '(C)');
  assert.ok(target, 'sanity: the welded-tube cell is in the fixture');
  const tubeRow = pack.benchmarks.find(isTube);
  assert.ok(tubeRow, 'sanity: and in the pack');

  // A pack value that drifts.
  assert.deepEqual(
    crossCheck(pack.benchmarks.map((b) => (isTube(b) ? { ...b, bmTco2ePerT: '1.5' } : b)), b26, p26, 'B'),
    [`2026-2027 B 73063077 (C): regulation ${target.value}, pack 1.5`]);

  // The same value as a JSON number: Decimal would accept it and the pack validator would not.
  assert.deepEqual(
    crossCheck(pack.benchmarks.map((b) => (isTube(b) ? { ...b, bmTco2ePerT: Number(target.value) } : b)), b26, p26, 'B'),
    [`2026-2027 B 73063077 (C): pack value ${Number(target.value)} is a number, not a decimal string`]);

  // A regulation cell the pack has lost.
  assert.deepEqual(crossCheck(pack.benchmarks.filter((b) => !isTube(b)), b26, p26, 'B'),
    [`2026-2027 B 73063077 (C): regulation ${target.value}, pack has no row`]);

  // A pack row the regulation does not have.
  assert.deepEqual(crossCheck(pack.benchmarks, b26.filter((c) => c !== target), p26, 'B'),
    [`2026-2027 B 73063077 (C): pack ${target.value}, not in the regulation`]);

  // The same good and route twice.
  assert.deepEqual(crossCheck([...pack.benchmarks, { ...tubeRow }], b26, p26, 'B'),
    ['2026-2027 B 73063077 (C): two rows in force']);

  // A value that changes only in the second period is caught there, and only there.
  const isPowder28 = (b) => b.benchmarkColumn === 'B' && b.scopeCode === '72052100'
    && b.routeIndicator === '(F)' && b.validFrom.startsWith('2028');
  assert.ok(pack.benchmarks.some(isPowder28), 'sanity: the iron-powder row has its own 2028 window');
  const drifted28 = pack.benchmarks.map((b) => (isPowder28(b) ? { ...b, bmTco2ePerT: '1.3' } : b));
  const powder28 = b28.find((c) => c.cn === '72052100' && c.route === '(F)');
  assert.deepEqual(crossCheck(drifted28, b28, p28, 'B'),
    [`2028-2030 B 72052100 (F): regulation ${powder28.value}, pack 1.3`]);
  assert.deepEqual(crossCheck(drifted28, b26, p26, 'B'), []);

  // Column A drift is caught under Column A, and Column B stays clean.
  const isFoilA = (b) => b.benchmarkColumn === 'A' && b.scopeCode === '76071990' && b.routeIndicator === '';
  const foilA = a26.find((c) => c.cn === '76071990' && c.route === '');
  assert.ok(foilA && pack.benchmarks.some(isFoilA), 'sanity: the foil has a Column A cell in both');
  const driftedA = pack.benchmarks.map((b) => (isFoilA(b) ? { ...b, bmTco2ePerT: '0.021' } : b));
  assert.deepEqual(crossCheck(driftedA, a26, p26, 'A'),
    [`2026-2027 A 76071990 (no route): regulation ${foilA.value}, pack 0.021`]);
  assert.deepEqual(crossCheck(driftedA, b26, p26, 'B'), []);

  // A row valid for 2027 alone falls between the probes. The shape test is what names it.
  const only2027 = { ...tubeRow, scopeCode: '99999999', bmTco2ePerT: '9.999',
    validFrom: '2027-01-01T00:00:00.000Z', validTo: '2027-12-31T23:59:59.999Z' };
  assert.deepEqual(crossCheck([...pack.benchmarks, only2027], b26, p26, 'B'), [],
    'sanity: the cross-check alone cannot see it, which is why the shape test exists');
  assert.deepEqual(shapeProblems([only2027]),
    ['B 99999999 (C): valid 2027-01-01T00:00:00.000Z to 2027-12-31T23:59:59.999Z, a window this test does not probe']);

  // A route the keys would not match, a missing end date, and a third column.
  assert.deepEqual(shapeProblems([{ ...tubeRow, routeIndicator: '(c)' }]),
    ["B 73063077 (c): route is not '' or one letter in brackets"]);
  const { validTo: _dropped, ...noEnd } = tubeRow;
  assert.deepEqual(shapeProblems([noEnd]),
    ['B 73063077 (C): valid 2026-01-01T00:00:00.000Z to undefined, a window this test does not probe']);
  assert.deepEqual(shapeProblems([{ ...tubeRow, benchmarkColumn: 'C' }]),
    ['C 73063077 (C): column is neither A nor B']);
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && node --import tsx --test tests/unit/cbam-benchmarks-crosscheck.test.mjs 2>&1 | grep -E "ENOENT|cbam-benchmarks-ir-2025-2620|^ℹ (pass|fail)"
```

Expected: an `ENOENT` naming `tests/fixtures/cbam-benchmarks-ir-2025-2620.json`, and a non-zero fail count. Any other failure means the test file has a typo: fix that first.

---

### Task 3: The fixture

**Files:**
- Create: `tests/fixtures/cbam-benchmarks-ir-2025-2620.json`

The fixture is built once from the Official Journal PDF of IR (EU) 2025/2620 (OJ L, 22.12.2025). The PDF is not in the repository. Download it from EUR-Lex through the ELI `http://data.europa.eu/eli/reg_impl/2025/2620/oj`; EUR-Lex may need a browser. The build script refuses any file whose SHA-256 is not `8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05`, which is the digest the pack records for its source `ir-2025-2620`.

The build script is not committed. It runs once per amending act, and it is recorded here in full.

- [ ] **Step 1: Point at the PDF**

```bash
export CBAM_REGULATION_PDF="<path to the downloaded Official Journal PDF>"
shasum -a 256 "$CBAM_REGULATION_PDF" | cut -c1-64
```

Expected: `8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05`.

- [ ] **Step 2: Write the build script outside the repo**

```bash
mkdir -p ~/.cache/delta-climate/cbam && cat > ~/.cache/delta-climate/cbam/build-benchmark-fixture.py <<'EOF'
"""Build the benchmark fixture from the Official Journal PDF of IR (EU) 2025/2620.

    python3 build.py <regulation.pdf> <out.json>

Needs `pdftotext` (poppler). The PDF is not in the repository; its SHA-256 is the one the
estimator pack records for source `ir-2025-2620`, and this script refuses any other file.
"""
import hashlib
import json
import re
import subprocess
import sys
from decimal import Decimal

PDF_SHA256 = "8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05"
PERIODS = {"2026-2027": "1", "2028-2030": "2"}   # the Annex marks period variants (1) and (2)
EXPECTED = {"goods": 570, "A": 650, "B": 1418}   # cells in force per period

CODE = re.compile(r"^\s*(\d{4} \d{2} \d{2})\s")
# A benchmark as printed: 1,460 optionally followed by a route (F) and a period marker (1).
VALUE = re.compile(r"(\d+,\d+)(?:\s*\(([A-L])\))?(?:\s*\(([12])\))?")
# In this PDF every continuation value starts exactly under the value above it (offset 0 for all
# 1,325), and the two columns sit 16 characters apart. Any margin below 16 reads it correctly.
MARGIN = 7

pdf, out = sys.argv[1], sys.argv[2]
digest = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
if digest != PDF_SHA256:
    sys.exit(f"not the pinned regulation PDF\n  expected {PDF_SHA256}\n  got      {digest}")
text = subprocess.run(["pdftotext", "-layout", pdf, "-"], check=True, capture_output=True, text=True).stdout

# Each good opens with its CN code on a line that carries Column A then Column B at the right.
# Further values for the same good follow on later lines, under the column they belong to.
found = {"A": [], "B": []}          # (cn, route, marker, value)
goods = []
cn = start_a = start_b = None
for line in text.split("\n"):
    values = [(m.start(), m.group(1), m.group(2) or "", m.group(3) or "") for m in VALUE.finditer(line)]
    head = CODE.match(line)
    if head:
        cn = head.group(1).replace(" ", "")
        right = [v for v in values if v[0] > head.end() + 20]   # past the description's start
        if len(right) < 2:
            sys.exit(f"{cn}: the code line does not carry both columns: {line.strip()[:80]}")
        goods.append(cn)
        (start_a, *a), (start_b, *b) = right[-2], right[-1]
        found["A"].append((cn, a[1], a[2], a[0]))
        found["B"].append((cn, b[1], b[2], b[0]))
        continue
    if cn is None:
        continue
    for start, value, route, marker in values:
        if start >= start_b - MARGIN:
            found["B"].append((cn, route, marker, value))
        elif start >= start_a - MARGIN:
            found["A"].append((cn, route, marker, value))

if len(goods) != EXPECTED["goods"] or len(set(goods)) != len(goods):
    sys.exit(f"expected {EXPECTED['goods']} distinct goods, read {len(goods)} ({len(set(goods))} distinct)")

periods = {}
for period, marker in PERIODS.items():
    periods[period] = {}
    for column in ("A", "B"):
        cells = {}
        for good, route, mark, value in found[column]:
            if mark and mark != marker:
                continue
            key = (good, f"({route})" if route else "")
            text_value = value.replace(",", ".")
            Decimal(text_value)
            if key in cells:
                sys.exit(f"{period} column {column} {key}: read twice ({cells[key]} and {text_value})")
            cells[key] = text_value
        if len(cells) != EXPECTED[column]:
            sys.exit(f"{period} column {column}: expected {EXPECTED[column]} cells, read {len(cells)}")
        periods[period][column] = [{"cn": k[0], "route": k[1], "value": v} for k, v in sorted(cells.items())]

with open(out, "w", encoding="utf-8") as fh:
    fh.write("{\n")
    fh.write('  "regulation": "Commission Implementing Regulation (EU) 2025/2620, Annex, point 5 (OJ L, 22.12.2025)",\n')
    fh.write('  "eli": "http://data.europa.eu/eli/reg_impl/2025/2620/oj",\n')
    fh.write(f'  "pdfSha256": "{PDF_SHA256}",\n')
    fh.write('  "readWith": "pdftotext -layout, then the build script recorded in '
             'docs/superpowers/plans/2026-10-10-cbam-benchmark-crosscheck.md",\n')
    fh.write('  "periods": {\n')
    for i, (period, columns) in enumerate(periods.items()):
        fh.write(f'    "{period}": {{\n')
        for j, (column, cells) in enumerate(columns.items()):
            fh.write(f'      "{column}": [\n')
            fh.write(",\n".join("        " + json.dumps(c) for c in cells))
            fh.write("\n      ]" + ("," if j == 0 else "") + "\n")
        fh.write("    }" + ("," if i == 0 else "") + "\n")
    fh.write("  }\n}\n")
print({p: {c: len(v) for c, v in cols.items()} for p, cols in periods.items()})
print("printed values read:", {c: len(v) for c, v in found.items()})
EOF
```

How it reads the Annex: each good opens with its CN code on a line that carries the Column A value and then the Column B value at the right. Further values for the same good follow on later lines, under the column they belong to. A value's column is decided by where it starts on the line, so a number inside a description (a foil thickness of "0,021 mm", for example) is never read as a benchmark.

- [ ] **Step 3: Build the fixture**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && python3 ~/.cache/delta-climate/cbam/build-benchmark-fixture.py "$CBAM_REGULATION_PDF" tests/fixtures/cbam-benchmarks-ir-2025-2620.json
```

Expected, exactly:

```
{'2026-2027': {'A': 650, 'B': 1418}, '2028-2030': {'A': 650, 'B': 1418}}
printed values read: {'A': 661, 'B': 1804}
```

The script stops with a named reason if it reads anything other than 570 distinct goods, or a different number of cells. That would mean a different PDF or a `pdftotext` whose layout differs (this was built with poppler 26.04.0): stop and report, do not adjust the counts.

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && node --import tsx --test tests/unit/cbam-benchmarks-crosscheck.test.mjs 2>&1 | grep -E "^(✔|✖)|^ℹ (tests|pass|fail)"
```

Expected: eight `✔` lines, `ℹ tests 8`, `ℹ pass 8`, `ℹ fail 0`.

If a comparison fails, the output lists each disagreement as `<period> <column> <good> <route>: regulation X, pack Y`. Do not edit the fixture. Look the good up in the regulation and report which side is wrong.

---

### Task 4: Prove the test is not vacuous, then commit

**Files:** none in the repo. The proofs run on copies outside it.

The test carries its own proof ("the check bites"). This task proves that proof works, by disabling in turn each check it depends on. Every disabled version is a COPY in a scratch directory.

- [ ] **Step 1: Build a scratch copy that resolves the same relative paths**

```bash
S=/tmp/cbam-crosscheck-proof && mkdir -p $S/tests/unit $S/tests/fixtures $S/public \
 && W=/Volumes/OBOSLab/worktrees/cbam-three-year \
 && cp $W/tests/fixtures/cbam-benchmarks-ir-2025-2620.json $S/tests/fixtures/ \
 && cp $W/tests/unit/cbam-benchmarks-crosscheck.test.mjs $S/original.mjs \
 && ln -sfn $W/public/cbam $S/public/cbam && ln -sfn $W/node_modules $S/node_modules && echo ready
```

Expected: `ready`.

- [ ] **Step 2: Run ten mutants**

```bash
cd /tmp/cbam-crosscheck-proof && mut() { python3 - original.mjs "tests/unit/m-$1.test.mjs" "$2" "$3" <<'EOF'
import sys
src, dst, a, b = sys.argv[1:5]
s = open(src).read()
print(f"landed={s.count(a)}", end=" ")
open(dst, "w").write(s.replace(a, b, 1))
EOF
o=$(node --import tsx --test "tests/unit/m-$1.test.mjs" 2>&1); echo "$1: $(echo "$o" | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')"; }
mut value "else if (!new Decimal(got).eq(cell.value))" "else if (false)"
mut type "else if (typeof got !== 'string')" "else if (false)"
mut dup "if (packRows.has(k)) problems.push" "if (false) problems.push"
mut reverse "if (!seen.has(k)) problems.push" "if (false) problems.push"
mut norow "if (!packRows.has(k)) problems.push" "if (false) problems.push"
mut window "if (!WINDOWS.has(windowOf(b))) problems.push" "if (false) problems.push"
mut route "if (typeof b.routeIndicator !== 'string' || !ROUTE.test(b.routeIndicator)) problems.push" "if (false) problems.push"
mut column "if (!COLUMNS.includes(b.benchmarkColumn)) problems.push" "if (false) problems.push"
mut colfilter "if (b.benchmarkColumn !== column) continue;" ""
mut probe "'2028-2030': '2028-07-01T00:00:00.000Z'," "'2028-2030': '2026-07-01T00:00:00.000Z',"
```

Expected: every line starts `landed=1`. The first eight end `ℹ pass 7 ℹ fail 1` (only "the check bites" fails). `colfilter` ends `ℹ pass 3 ℹ fail 5` and `probe` ends `ℹ pass 5 ℹ fail 3`. A line with `landed=0` proves nothing: stop.

- [ ] **Step 3: Confirm the repo's test file was not touched**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && cmp tests/unit/cbam-benchmarks-crosscheck.test.mjs /tmp/cbam-crosscheck-proof/original.mjs && echo untouched
```

Expected: `untouched`.

- [ ] **Step 4: Full unit suite**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored engine|in sync"
```

Expected: `ℹ fail 0`, and `ℹ tests` is the task 1 baseline plus 8 (1387 on 2026-10-11).

- [ ] **Step 5: Scan everything this branch will publish**

A pull request publishes every commit on the branch, not only its final files, and keeps them
reachable after a squash-merge. So scan the whole of `git log -p`, messages included.

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && git log -p origin/main..HEAD > /tmp/cbam-crosscheck-publish.txt \
 && git diff --cached >> /tmp/cbam-crosscheck-publish.txt \
 && echo "name-list hits: $(grep -Eicf "$CBAM_EXCLUDE_PATTERNS" /tmp/cbam-crosscheck-publish.txt)" \
 && echo "spreadsheet or document names: $(grep -ciE '\\.(xlsx|xls|docx)\\b' /tmp/cbam-crosscheck-publish.txt)" \
 && echo "commits to be published: $(git rev-list --count origin/main..HEAD)"
```

`CBAM_EXCLUDE_PATTERNS` is a file of regular expressions, one per line, for the names that must
never appear in this repository. The owner keeps it outside the repo.

Expected: both counts `0`. Report counts only; never print a matching line. If the branch has
more than one commit, read each commit's diff before pushing: a file removed in a later commit
is still published.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/OBOSLab/worktrees/cbam-three-year && git add tests/fixtures/cbam-benchmarks-ir-2025-2620.json tests/unit/cbam-benchmarks-crosscheck.test.mjs \
 && git status --porcelain && git commit -m "test(cbam): cross-check the pack's benchmarks against IR (EU) 2025/2620" && git log --oneline -1
```

Expected: `git status` shows the two files and nothing else staged.

---

### Task 5: Independent review

- [ ] **Step 1: Dispatch a fresh reviewer, read-only**

Give it the spec section 3, this plan, and the commits, and ask it to read the regulation's PDF with a parser of its own. Ask for: whether a changed value, a lost row and an extra row are each caught in each column and period; whether any realistic pack error survives both this test and the pack validator; whether every claim in the test's header is true of the code; and whether anything committed carries local or private detail.

- [ ] **Step 2: Verify each finding before acting on it, fix what is real, and re-run task 4**

- [ ] **Step 3: Stop**

Report the result to the owner. Push and PR only on their word.
