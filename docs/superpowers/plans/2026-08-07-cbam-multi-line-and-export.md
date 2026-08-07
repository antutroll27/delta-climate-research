# CBAM Multi-Line, Per-Year Threshold and Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-line CBAM estimates with a per-year de minimis verdict gated on an explicit completeness attestation, plus a CSV and a printable document that carry the full provenance trail.

**Architecture:** A new pure-logic module `src/scripts/cbam-lines.ts` owns the line model, hashing, per-year threshold grouping, totals and CSV serialisation — no DOM, fully unit-testable, calling the vendored `aggregateThresholdBasis`/`evaluateThreshold`/`sectorForCn` directly. `cbam-app.ts` (ours) gains the render functions and rewires `initCbam` around `lines: Line[]` as the first real state this app has held. The Astro page gains three buttons and a print container. **No vendored file is touched; if a step seems to need one, the step is wrong.**

**Tech Stack:** TypeScript, `decimal.js` (installed), `crypto.subtle` (browser + Node ≥19), node:test via tsx, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-07-cbam-multi-line-and-export-design.md`

---

## Two deviations from the spec, decided here

1. **The spec's 2027 test case is unrunnable as written.** It asks that a 30 t 2026
   line and a 30 t 2027 line, both attested, each return `below_threshold`. But the
   pack's `thresholds` table holds **one row, calendarYear 2026** — the Commission
   has published no 2027 threshold. Inventing the 50 t default for 2027 would be
   exactly the fabrication this engine refuses elsewhere. So: a year with no
   threshold row renders a card saying no rule is published for that year, and the
   test asserts 2026 stays `below_threshold` **while the 2027 line exists** — which
   still kills the per-estimate model (it would sum to 60 t and say above).
2. **The CSV gains one column beyond the spec's list: `pack_snapshot`.** Spec §4
   requires the export to state which corpus produced the figures; the CSV's column
   list predates that requirement and had nowhere to carry it. It repeats per row,
   like `rule_packages`.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/scripts/cbam-lines.ts` | create | Pure logic: `Line`, hashing, per-year threshold, totals, CSV. No DOM. Lives **outside** `cbam-algos/` so the "everything under cbam-algos/ except cbam-app.ts is upstream's" statement stays true. |
| `tests/unit/cbam-lines.test.mjs` | create | Unit tests for the above, against the real pack (same convention as `cbam-render.test.mjs`). |
| `src/scripts/cbam-algos/cbam-app.ts` | modify | New renderers (`renderYearThreshold`, `renderTotals`, `buildPrintDocument`, `renderLineCard`); `initCbam` rewired around `lines[]`. |
| `src/pages/cbam/cbam-calculator.astro` | modify | Three buttons, `#cbLines` list container, `#cbPrint` container, print CSS. |
| `tests/e2e/cbam-lines.spec.ts` | create | Add/remove/attest/export flow against the built site. |
| `docs/cbam-engine-reference.md` | modify (final task) | §4/§7 updated once this ships; PDF regenerated. |

Run all unit tests with: `npm run test:unit`
Run one file with: `node --import tsx --test tests/unit/cbam-lines.test.mjs`

---

### Task 1: `cbam-lines.ts` — the line model and the three hashes

**Files:**
- Create: `src/scripts/cbam-lines.ts`
- Create: `tests/unit/cbam-lines.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/cbam-lines.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  yearOf, lineFingerprint, packSnapshotHash,
} from '../../src/scripts/cbam-lines.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

const line = (over = {}) => ({
  id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
  scope: 'direct_and_indirect', massT: '30', date: '2026-03-15', ...over,
});

test('yearOf reads the calendar year from the import date', () => {
  assert.equal(yearOf(line()), 2026);
  assert.equal(yearOf(line({ date: '2027-01-02' })), 2027);
});

test('lineFingerprint is deterministic and input-sensitive', async () => {
  const a = await lineFingerprint(line());
  const b = await lineFingerprint(line());
  const c = await lineFingerprint(line({ massT: '31' }));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b, 'same inputs must give the same fingerprint');
  assert.notEqual(a, c, 'a changed mass must change the fingerprint');
  // The id is a UI key, not an input: two identical lines fingerprint identically.
  assert.equal(a, await lineFingerprint(line({ id: 'L2' })));
});

test('packSnapshotHash pins generatedAt and both workbook hashes', async () => {
  const a = await packSnapshotHash(pack);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await packSnapshotHash(pack), 'stable across calls');
  const altered = { ...pack, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.notEqual(a, await packSnapshotHash(altered), 'generatedAt is part of the claim');
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `node --import tsx --test tests/unit/cbam-lines.test.mjs`
Expected: FAIL — `Cannot find module '../../src/scripts/cbam-lines.ts'`

- [ ] **Step 3: Implement**

```ts
// src/scripts/cbam-lines.ts
/**
 * Pure logic for multi-line CBAM estimates: the line model, the two digests, the
 * per-year threshold grouping, totals and CSV serialisation. No DOM anywhere —
 * everything here is testable under node:test against the real pack.
 *
 * This file is OURS (like cbam-app.ts, unlike everything under cbam-algos/). It
 * sits outside cbam-algos/ so the statement "everything under cbam-algos/ except
 * cbam-app.ts is upstream's, byte-for-byte" stays true.
 */
import type { EstimatorPack } from './cbam-algos/estimator/estimate-from-pack.ts';

export interface Line {
  id: string;        // row key and ImportMassEntry.id — NOT part of the fingerprint
  cn: string;
  country: string;
  route: string;
  scope: 'direct' | 'direct_and_indirect';
  massT: string;
  date: string;      // ISO date; calendar year is date.slice(0, 4)
}

export const yearOf = (line: Line): number => Number(line.date.slice(0, 4));

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A digest over the line's INPUTS AS ENTERED. This is what feeds
 * ImportMassEntry.sourceSha256 — a field that in the SaaS fingerprints a customs
 * document. We have no document, so every surface that prints this value must
 * label it "line fingerprint — inputs as entered; no source document", never as
 * source provenance. The id is excluded: it is a UI key, not an input.
 */
export function lineFingerprint(line: Line): Promise<string> {
  return sha256Hex([line.cn, line.country, line.route, line.scope, line.massT, line.date].join(''));
}

/**
 * Identifies the exact corpus a figure was computed from: the pack's generatedAt
 * plus both source-workbook sha256s, in generatedFrom order. Replaces the
 * placeholder 'browser-prototype' the vendored stamp carries in this build —
 * decorated onto the estimate AFTER the engine returns, never inside it.
 */
export function packSnapshotHash(pack: EstimatorPack): Promise<string> {
  const parts = [
    pack.generatedAt ?? '',
    ...pack.generatedFrom.map((s) => `${s.id}@${s.version}:${s.workbookSha256 ?? ''}`),
  ];
  return sha256Hex(parts.join(''));
}
```

- [ ] **Step 4: Run and verify they pass**

Run: `node --import tsx --test tests/unit/cbam-lines.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): line model and the two digests, honestly scoped

lineFingerprint covers inputs as entered and is never source provenance;
packSnapshotHash pins generatedAt plus both workbook hashes, replacing the
'browser-prototype' placeholder with a claim we can actually stand behind."
```

---

### Task 2: Per-year threshold grouping

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (append)
- Modify: `tests/unit/cbam-lines.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cbam-lines.test.mjs` (extend the import from cbam-lines.ts with `thresholdByYear`):

```js
const fp = new Map([['L1', 'a'.repeat(64)], ['L2', 'b'.repeat(64)], ['L3', 'c'.repeat(64)]]);

test('per-year, not per-estimate: a 2027 line cannot push 2026 over the threshold', () => {
  // THE regression test for the per-year decision. A per-estimate model sums
  // 30 + 30 = 60 t and reports above_threshold — inventing a liability. The pack
  // publishes a threshold row for 2026 only, so 2027 gets ruleFound: false
  // rather than a fabricated 50 t default.
  const lines = [
    line({ id: 'L1', massT: '30', date: '2026-03-15' }),
    line({ id: 'L2', massT: '30', date: '2027-03-15' }),
  ];
  const cards = thresholdByYear(lines, fp, new Set([2026, 2027]), pack);
  const y26 = cards.find((c) => c.calendarYear === 2026);
  const y27 = cards.find((c) => c.calendarYear === 2027);
  assert.equal(y26.ruleFound, true);
  assert.equal(y26.state, 'below_threshold', '30 t attested-complete is below 50 t');
  assert.equal(y27.ruleFound, false, 'no threshold rule is published for 2027');
});

test('above threshold is a fact — the attestation cannot gate it', () => {
  const cards = thresholdByYear([line({ massT: '60' })], fp, new Set(), pack);
  assert.equal(cards[0].state, 'above_threshold');
});

test('unattested and under 50 t stays indeterminate', () => {
  const cards = thresholdByYear([line({ massT: '30' })], fp, new Set(), pack);
  assert.equal(cards[0].state, 'indeterminate');
});

test('a hydrogen line is excluded from the eligible mass', () => {
  // sectorForCn('28041000') is hydrogen, absent from the 2026 row's
  // includedSectors. aggregateThresholdBasis's own massSectors filter would also
  // drop it; we exclude before aggregation so entryIds reflects reality.
  const lines = [line({ id: 'L1', massT: '30' }), line({ id: 'L3', cn: '28041000', massT: '900' })];
  const [card] = thresholdByYear(lines, fp, new Set([2026]), pack);
  assert.equal(card.state, 'below_threshold', '900 t of hydrogen must not count');
  assert.deepEqual(card.entryIds, ['L1']);
  assert.deepEqual(card.entryHashes, ['a'.repeat(64)]);
});
```

- [ ] **Step 2: Run and verify the new tests fail**

Run: `node --import tsx --test tests/unit/cbam-lines.test.mjs`
Expected: FAIL — `thresholdByYear` is not exported.

- [ ] **Step 3: Implement**

Append to `src/scripts/cbam-lines.ts`:

```ts
import {
  aggregateThresholdBasis, type ImportMassEntry,
} from './cbam-algos/threshold/aggregate.ts';
import { evaluateThreshold, type ThresholdState } from './cbam-algos/threshold/evaluate.ts';
import { sectorForCn } from './cbam-algos/cbam/sector.ts';

/** Every session entry shares one importer — the aggregation filters on it. */
const IMPORTER = 'estimator-session';

export interface YearThreshold {
  calendarYear: number;
  ruleFound: boolean;
  /** Only when ruleFound. */
  state?: ThresholdState;
  knownEligibleMassT?: string;
  thresholdT?: string;
  sourceLocator?: string;
  entryIds?: string[];
  entryHashes?: string[];
  attested: boolean;
  /** Lines in this year that counted toward the eligible mass. */
  eligibleLineCount: number;
}

/**
 * One threshold verdict per calendar year present in the lines.
 *
 * PER YEAR, NEVER PER ESTIMATE. The de minimis threshold (Reg 2023/956 Art 2(3))
 * is annual; summing across years would report a 30 t 2026 + 30 t 2027 estimate
 * as 60 t "above" — a liability that does not exist.
 *
 * A year with no published threshold row returns ruleFound: false rather than a
 * fabricated default. The Commission has published 2026 only, as of this pack.
 *
 * `completeness` comes from the caller's attestation set — 'complete' only when
 * the user has explicitly ticked "these are all my {year} imports". The tool
 * never asserts completeness; it conditions on the user's statement.
 */
export function thresholdByYear(
  lines: readonly Line[],
  fingerprints: ReadonlyMap<string, string>,
  attestedYears: ReadonlySet<number>,
  pack: EstimatorPack,
): YearThreshold[] {
  const years = [...new Set(lines.map(yearOf))].sort();
  return years.map((calendarYear) => {
    const attested = attestedYears.has(calendarYear);
    const rule = pack.thresholds.find((t) => t.calendarYear === calendarYear);
    const inYear = lines.filter((l) => yearOf(l) === calendarYear);
    if (!rule) return { calendarYear, ruleFound: false, attested, eligibleLineCount: 0 };

    const entries: ImportMassEntry[] = inYear.flatMap((l) => {
      const sector = sectorForCn(l.cn);
      if (!sector || !rule.includedSectors.includes(sector)) return [];
      return [{
        id: l.id, importerOrgId: IMPORTER, calendarYear, sector,
        netMassT: l.massT, sourceSha256: fingerprints.get(l.id) ?? '',
      }];
    });

    const basis = aggregateThresholdBasis(
      { importerOrgId: IMPORTER, calendarYear },
      entries,
      { id: `session-${calendarYear}`, importerOrgId: IMPORTER, calendarYear,
        completeness: attested ? 'complete' : 'partial' },
    );
    const verdict = evaluateThreshold({
      knownEligibleMassT: basis.knownEligibleMassT,
      completeness: basis.completeness,
      thresholdT: rule.thresholdT,
    });
    return {
      calendarYear, ruleFound: true, attested,
      state: verdict.state,
      knownEligibleMassT: verdict.knownEligibleMassT,
      thresholdT: verdict.thresholdT,
      sourceLocator: rule.sourceLocator,
      entryIds: basis.entryIds, entryHashes: basis.entryHashes,
      eligibleLineCount: entries.length,
    };
  });
}
```

- [ ] **Step 4: Run and verify all pass**

Run: `node --import tsx --test tests/unit/cbam-lines.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): per-year threshold with explicit completeness attestation

Groups lines by calendar year and hands each year to the vendored
aggregateThresholdBasis/evaluateThreshold — referenced by the calculator for
the first time. below_threshold becomes reachable, gated on the user's own
attestation. A year without a published rule says so instead of inventing 50 t."
```

---

### Task 3: Totals in Decimal

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (append)
- Modify: `tests/unit/cbam-lines.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append (extend imports with `sumTotals`; also import the engine to make real estimates):

```js
import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

const est = (cn, country, route, massT, date = '2026-03-15') =>
  estimateFromPack(pack, { cn, country, route, massT, date });

test('sumTotals sums scenarios in Decimal and stays labelled a what-if', () => {
  // Two known cscf_pending lines. 25231000/DZ/(A)/100 has certificates 71.465
  // (§8-pinned); the same line at 200 t doubles it. 0.1-style float drift is
  // what Decimal prevents; the assertion is exact string equality.
  const a = est('25231000', 'DZ', '(A)', '100');
  const b = est('25231000', 'DZ', '(A)', '200');
  const t = sumTotals([a, b]);
  assert.equal(t.certificates, '214.395');
  assert.equal(t.costEur, '16156.80');       // (71.465 + 142.93) × 75.36
  assert.equal(t.pricedLines, 2);
  assert.equal(t.refusedLines, 0);
  assert.equal(t.anyPending, true, 'a total containing what-ifs is a what-if');
});

test('a refused line is counted and does not poison the total', () => {
  const good = est('25231000', 'DZ', '(A)', '100');
  const bad = est('72052100', 'IN', '(C)', '60');   // stranded: unavailable
  const t = sumTotals([good, bad]);
  assert.equal(bad.status, 'unavailable');
  assert.equal(t.certificates, '71.465');
  assert.equal(t.pricedLines, 1);
  assert.equal(t.refusedLines, 1);
});
```

- [ ] **Step 2: Run, expect failure** — `sumTotals` not exported.

- [ ] **Step 3: Implement**

Append to `src/scripts/cbam-lines.ts`:

```ts
import Decimal from 'decimal.js';
import type { CertificateEstimate } from './cbam-algos/cbam/certificate-estimate.ts';

export interface Totals {
  certificates: string;
  /** null when any priced line lacks a published price — a partial € total lies. */
  costEur: string | null;
  chargeableTco2e: string;
  pricedLines: number;
  refusedLines: number;
  /** True when any contributing line is a CSCF what-if; the total then is too. */
  anyPending: boolean;
}

/** The figures of a priced branch, whichever branch carried them. */
function figuresOf(e: CertificateEstimate):
  { certificates: string; costEur: string | null; netTco2e: string } | null {
  switch (e.status) {
    case 'ok':
    case 'zero_by_fiat': return e.figure;
    case 'cscf_pending': return e.scenario;
    case 'unavailable': return null;
  }
}

export function sumTotals(results: readonly CertificateEstimate[]): Totals {
  let certs = new Decimal(0), cost = new Decimal(0), net = new Decimal(0);
  let priced = 0, refused = 0, anyPending = false, costKnown = true;
  for (const e of results) {
    const f = figuresOf(e);
    if (!f) { refused += 1; continue; }
    priced += 1;
    if (e.status === 'cscf_pending') anyPending = true;
    certs = certs.plus(f.certificates);
    net = net.plus(f.netTco2e);
    if (f.costEur === null) costKnown = false;
    else cost = cost.plus(f.costEur);
  }
  return {
    certificates: certs.toString(),
    costEur: priced > 0 && costKnown ? cost.toFixed(2) : null,
    chargeableTco2e: net.toString(),
    pricedLines: priced, refusedLines: refused, anyPending,
  };
}
```

- [ ] **Step 4: Run, expect 9 passing tests.**

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): Decimal totals that stay labelled what-ifs

A total containing any CSCF scenario is itself a scenario, a refused line is
counted but never poisons the sum, and a missing price nulls the euro total
rather than under-reporting it."
```

---

### Task 4: CSV rows and serialisation

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (append)
- Modify: `tests/unit/cbam-lines.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
test('csvRows carries figures, locators and the §4 claims per row', () => {
  const lines2 = [line({ id: 'L1', massT: '100' })];
  const results = [est('25231000', 'DZ', '(A)', '100')];
  const rows = csvRows(lines2, results, fp, 'f'.repeat(64), pack);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.cn_code, '25231000');
  assert.equal(r.embedded_tco2e, '136.4');
  assert.equal(r.free_allocation_tco2e, '64.935');
  assert.equal(r.chargeable_tco2e, '71.465');
  assert.equal(r.cost_eur, '5385.60');
  assert.equal(r.cscf_status, 'pending (what-if)');
  assert.match(r.benchmark_locator, /2025\/2620 Annex/);
  assert.match(r.cbam_factor_locator, /Art 10a\(1a\)/);
  assert.equal(r.line_fingerprint, 'a'.repeat(64));
  assert.equal(r.pack_snapshot, 'f'.repeat(64));
  // the identity the spec pins: chargeable = embedded − free allocation
  assert.equal(
    Number(r.embedded_tco2e) - Number(r.free_allocation_tco2e),
    Number(r.chargeable_tco2e));
});

test('a refused line exports its refusal, not empty-looking zeros', () => {
  const rows = csvRows(
    [line({ id: 'L1', cn: '72052100', country: 'IN', route: '(C)', massT: '60' })],
    [est('72052100', 'IN', '(C)', '60')], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].status, 'unavailable');
  assert.equal(rows[0].certificates, '');
  assert.equal(rows[0].cost_eur, '');
});

test('toCsv escapes commas and quotes and round-trips its own header', () => {
  const csv = toCsv([{ a: 'plain', b: 'has,comma', c: 'has "quote"' }]);
  assert.equal(csv.split('\n')[0], 'a,b,c');
  assert.equal(csv.split('\n')[1], 'plain,"has,comma","has ""quote"""');
});
```

- [ ] **Step 2: Run, expect failure** — `csvRows`/`toCsv` not exported.

- [ ] **Step 3: Implement**

Append to `src/scripts/cbam-lines.ts`:

```ts
/**
 * One row per line, engine values VERBATIM — no locale formatting, no rounding.
 * This is the working artefact an auditor loads into a model; presentation
 * formatting belongs to the page, full precision belongs here.
 */
export function csvRows(
  lines: readonly Line[],
  results: readonly CertificateEstimate[],
  fingerprints: ReadonlyMap<string, string>,
  packSnapshot: string,
  pack: EstimatorPack,
): Record<string, string>[] {
  return lines.map((l, i) => {
    const e = results[i]!;
    const f = figuresOf(e);
    const terms = 'terms' in e ? e.terms : null;
    const bm = terms?.benchmarks[0] ?? null;
    const pending = e.status === 'cscf_pending';
    return {
      line_id: l.id,
      cn_code: l.cn,
      description: pack.classifications.find((c) => c.code === l.cn)?.description ?? '',
      origin: l.country,
      route: l.route,
      emissions_scope: l.scope,
      mass_t: l.massT,
      import_date: l.date,
      embedded_tco2e: 'emissionsTco2e' in e ? e.emissionsTco2e : '',
      free_allocation_tco2e: pending ? e.scenario.faaTco2e : '',
      chargeable_tco2e: f?.netTco2e ?? '',
      certificates: f?.certificates ?? '',
      cost_eur: f?.costEur ?? '',
      cbam_factor: terms?.cbamFactor ?? '',
      cbam_factor_locator: terms?.cbamFactorLocator ?? '',
      cscf_status: e.status === 'ok' ? 'published'
        : e.status === 'zero_by_fiat' ? 'not applicable (Art 1(2): nil by law)'
        : pending ? 'pending (what-if)' : '',
      cscf_locator: terms?.cscfLocator ?? '',
      assumed_cscf: pending ? e.scenario.assumedCscf : '',
      price_quarter: 'priceQuarter' in e ? e.priceQuarter : '',
      price_eur: ('priceEur' in e ? e.priceEur : null) ?? '',
      price_status: 'priceStatus' in e ? e.priceStatus : '',
      benchmark_column: bm?.benchmarkColumn ?? '',
      benchmark_value: bm?.benchmarkTco2ePerT ?? '',
      benchmark_route: bm?.routeIndicator ?? '',
      benchmark_locator: bm?.sourceLocator ?? '',
      status: e.status,
      rule_packages: e.stamp.rulePackages.join(' | '),
      line_fingerprint: fingerprints.get(l.id) ?? '',
      pack_snapshot: packSnapshot,
    };
  });
}

export function toCsv(rows: readonly Record<string, string>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const cell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join('\n');
}
```

Note: `figuresOf` (Task 3) is reused — do not redefine it. `unavailable` estimates
carry no `terms`, which the `'terms' in e` guard handles.

- [ ] **Step 4: Run, expect 12 passing tests.**

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): CSV rows carry engine values verbatim, with locators

Full precision, one row per line, every figure beside its legal locator and
both §4 claims (line fingerprint, pack snapshot) on every row. Refusals export
as refusals, not as zeros."
```

---

### Task 5: The new renderers in `cbam-app.ts`

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (add functions after `renderThreshold`, ~line 147)
- Modify: `tests/unit/cbam-render.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cbam-render.test.mjs` (extend the cbam-app import with
`renderYearThreshold, renderTotals, buildPrintDocument`):

```js
test('renderYearThreshold: below-attested says so and names its basis', () => {
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'below_threshold',
    knownEligibleMassT: '30', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: true, eligibleLineCount: 1,
  });
  assert.match(html, /Below threshold/);
  assert.match(html, /attested/i, 'the verdict must say what it rests on');
  assert.match(html, /data-attest="2026"[^>]*checked/, 'checkbox reflects the attestation');
});

test('renderYearThreshold: above hides the checkbox — a fact needs no attestation', () => {
  const html = renderYearThreshold({
    calendarYear: 2026, ruleFound: true, state: 'above_threshold',
    knownEligibleMassT: '60', thresholdT: '50',
    sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)',
    entryIds: ['L1'], entryHashes: [], attested: false, eligibleLineCount: 1,
  });
  assert.match(html, /Above threshold/);
  assert.doesNotMatch(html, /data-attest/, 'no checkbox when it cannot change the answer');
});

test('renderYearThreshold: a year without a rule refuses to invent one', () => {
  const html = renderYearThreshold({ calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.match(html, /no.*threshold.*published.*2027/i);
  assert.doesNotMatch(html, /50/, 'must not show the 2026 figure for 2027');
});

test('renderTotals: a pending total is tagged a what-if and shows no false euro', () => {
  const html = renderTotals({
    certificates: '214.395', costEur: null, chargeableTco2e: '214.395',
    pricedLines: 2, refusedLines: 1, anyPending: true,
  });
  assert.match(html, /What-if/);
  assert.match(html, /1 line.*no estimate/i, 'refusals are counted, not hidden');
  assert.doesNotMatch(html, /€/, 'no euro figure when any price is missing');
});

test('buildPrintDocument carries all four §4 caveats and the snapshot', () => {
  const html = buildPrintDocument({
    lines: [{ id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
              scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' }],
    results: [run('25231000', 'DZ', '(A)', '100')],
    yearCards: [], totals: sumTotals([run('25231000', 'DZ', '(A)', '100')]),
    packSnapshot: 'f'.repeat(64),
    rulePackages: ['eu-cbam-2026-defaults-v2@v1', 'eu-cbam-2026-free-allocation@v1'],
  });
  assert.match(html, /cross-sectoral correction factor/i);
  assert.match(html, /Art(icle)? 9/i, 'the carbon-price-abroad gap must be stated');
  assert.match(html, /inputs as entered/i, 'the fingerprint must be labelled honestly');
  assert.match(html, /completeness/i, 'the attestation basis must be stated');
  assert.match(html, new RegExp('f'.repeat(16)), 'the pack snapshot appears');
  assert.match(html, /What this does not tell you/i);
});
```

(`sumTotals` import comes from `../../src/scripts/cbam-lines.ts`.)

- [ ] **Step 2: Run, expect failure** — the three functions are not exported.

Run: `node --import tsx --test tests/unit/cbam-render.test.mjs`

- [ ] **Step 3: Implement**

Insert into `src/scripts/cbam-algos/cbam-app.ts` after `renderThreshold` (line 147),
with the import at the top of the file:

```ts
import { sumTotals, type Line, type Totals, type YearThreshold } from '../cbam-lines.ts';
```

```ts
/**
 * One card per calendar year present in the line list. This is the multi-line
 * counterpart of renderThreshold above: the single-line card can only ever say
 * "indeterminate", because one line is not a year. Here the user can attest the
 * list IS the year, which is what unlocks below_threshold — the verdict then
 * says on every surface that it rests on their statement, not on ours.
 */
export function renderYearThreshold(y: YearThreshold): string {
  if (!y.ruleFound) return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis · ${esc(String(y.calendarYear))}</h3>
        <span class="cb-tag pending">No published rule</span>
      </div>
      <p class="cb-sub">No de minimis threshold has been published for
        ${esc(String(y.calendarYear))}. We show no verdict rather than assume one.</p>
    </section>`;

  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  const tag = above ? 'Above threshold' : below ? 'Below threshold' : 'Indeterminate';
  // Above is provable from partial data; the checkbox cannot change it, so it is
  // not shown. Anywhere else the attestation is the whole game.
  const attest = above ? '' : `
    <label class="cb-attest">
      <input type="checkbox" data-attest="${esc(String(y.calendarYear))}" ${y.attested ? 'checked' : ''} />
      These are all my ${esc(String(y.calendarYear))} imports of CBAM goods
    </label>`;
  return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis · ${esc(String(y.calendarYear))}</h3>
        <span class="cb-tag ${above ? 'unavail' : 'ok'}">${esc(tag)}</span>
      </div>
      <div class="cb-water">
        <div class="cb-row"><span>Eligible mass · ${y.eligibleLineCount} line${y.eligibleLineCount === 1 ? '' : 's'}</span>
          <b>${num(y.knownEligibleMassT!)} t</b></div>
        <div class="cb-row"><span>Threshold</span><b>${num(y.thresholdT!)} t</b></div>
      </div>
      <p class="cb-sub">${
        above ? `The listed ${esc(String(y.calendarYear))} imports exceed the threshold; the exemption does not apply.`
        : below ? `Below the threshold an importer owes nothing for ${esc(String(y.calendarYear))}.
            This verdict rests on your attested statement that the list is complete —
            it is your completeness claim, verified by no one.`
        : `Under the threshold so far, but unattested. Tick the box only if this list is
            genuinely every ${esc(String(y.calendarYear))} CBAM import; the verdict is only
            as good as that statement.`}</p>
      ${attest}
      <p class="cb-prov">${esc(y.sourceLocator!)} · as amended by Reg (EU) 2025/2083</p>
    </section>`;
}

/** The summed exposure. A total containing any what-if is itself a what-if. */
export function renderTotals(t: Totals): string {
  const tone = t.anyPending ? 'pending' : 'ok';
  const tag = t.anyPending ? 'What-if · CSCF unpublished' : 'Priced';
  return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure · ${t.pricedLines} line${t.pricedLines === 1 ? '' : 's'}</h3>
        <span class="cb-tag ${tone}">${esc(tag)}</span>
      </div>
      <div class="cb-fig"><span class="cb-n">${num(t.certificates)}</span></div>
      <div class="cb-u">certificates</div>
      ${t.costEur ? `<div class="cb-cost">${eur(t.costEur)}</div>`
        : '<div class="cb-sub">No € total — at least one line has no published certificate price.</div>'}
      ${t.refusedLines ? `<p class="cb-sub cb-warn">${t.refusedLines} line${t.refusedLines === 1 ? ' has' : 's have'}
        no estimate and ${t.refusedLines === 1 ? 'is' : 'are'} excluded from this total.</p>` : ''}
    </section>`;
}

/** A line's header plus the ordinary result card, with a remove control. */
export function renderLineCard(line: Line, e: CertificateEstimate, index: number): string {
  return `
    <article class="cb-line" data-line="${esc(line.id)}">
      <div class="cb-line-head">
        <span class="cb-line-n">Line ${index + 1}</span>
        <span class="cb-line-sum">${esc(line.cn)} · ${esc(line.country)} · ${esc(line.route)} ·
          ${num(line.massT)} t · ${esc(line.date)}</span>
        <button type="button" class="cb-line-x" data-remove="${esc(line.id)}"
          aria-label="Remove line ${index + 1}">Remove</button>
      </div>
      ${renderResult(e)}
    </article>`;
}

/**
 * The credibility artefact. Section 4 is the point: any tool can print a number;
 * this one prints what the number cannot tell you.
 */
export function buildPrintDocument(input: {
  lines: readonly Line[];
  results: readonly CertificateEstimate[];
  yearCards: readonly YearThreshold[];
  totals: Totals;
  packSnapshot: string;
  rulePackages: readonly string[];
}): string {
  const { lines, results, yearCards, totals, packSnapshot, rulePackages } = input;
  const lineRows = lines.map((l, i) => {
    const e = results[i]!;
    const pending = e.status === 'cscf_pending';
    const certs = pending ? e.scenario.certificates
      : e.status === 'ok' || e.status === 'zero_by_fiat' ? e.figure.certificates : '—';
    const cost = pending ? e.scenario.costEur
      : e.status === 'ok' || e.status === 'zero_by_fiat' ? e.figure.costEur : null;
    const bm = 'terms' in e ? e.terms.benchmarks[0] : null;
    return `<tr>
      <td>${esc(l.cn)}</td><td>${esc(l.country)}</td><td>${esc(l.route)}</td>
      <td>${num(l.massT)}</td><td>${esc(l.date)}</td>
      <td>${e.status === 'unavailable' ? 'no estimate' : num(certs)}</td>
      <td>${cost ? eur(cost) : '—'}</td>
      <td class="cbp-loc">${bm ? esc(bm.sourceLocator) : ('selector' in e && e.selector ? `missing: ${esc(e.selector)}` : '—')}</td>
    </tr>`;
  }).join('');
  const verdicts = yearCards.map((y) => y.ruleFound
    ? `<li>${y.calendarYear}: <b>${esc(y.state!.replace(/_/g, ' '))}</b> at ${num(y.knownEligibleMassT!)} t
        of ${num(y.thresholdT!)} t — completeness box ${y.attested ? 'TICKED by the user' : 'not ticked'}.</li>`
    : `<li>${y.calendarYear}: no de minimis threshold published; no verdict.</li>`).join('');
  return `
    <h1>CBAM certificate exposure — provisional estimate</h1>
    <p class="cbp-sub">Generated ${esc(new Date().toISOString().slice(0, 10))} ·
      deltaclimate.earth/cbam/cbam-calculator · not a filing, not verified data</p>

    <h2>1 · What you asked</h2>
    <table><thead><tr><th>CN</th><th>Origin</th><th>Route</th><th>Mass t</th><th>Import date</th>
      <th>Certificates</th><th>Cost</th><th>Benchmark authority</th></tr></thead>
      <tbody>${lineRows}</tbody></table>

    <h2>2 · What we computed</h2>
    <p>Total: <b>${num(totals.certificates)} certificates</b>${
      totals.costEur ? ` · <b>${eur(totals.costEur)}</b>` : ' · no € total (a certificate price is unpublished)'}${
      totals.anyPending ? ' — a <b>what-if</b>, because the CSCF is unpublished (see §4)' : ''}.
      ${totals.refusedLines ? `${totals.refusedLines} line(s) refused and excluded.` : ''}</p>
    <ul>${verdicts || '<li>No de minimis verdict — no eligible lines.</li>'}</ul>

    <h2>3 · On what authority</h2>
    <ul>
      <li>Rule packages: ${rulePackages.map((r) => `<code>${esc(r)}</code>`).join(' · ')}</li>
      <li>Data snapshot: <code>${esc(packSnapshot)}</code> — SHA-256 over the pack's
        generation timestamp and both Commission source-workbook hashes.</li>
      <li>IR (EU) 2025/2620 (free allocation): <code>8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05</code></li>
      <li>IR (EU) 2025/2621 (default values): <code>3155016c2e07b049b64f1ac4c2320061534245b81971ce5cba7814736f09acb4</code></li>
      <li>Per-line benchmark authority is printed in the table above; the CBAM factor is
        Dir 2003/87/EC Art 10a(1a) (free allocation retained).</li>
    </ul>

    <h2>4 · What this does not tell you</h2>
    <ul>
      <li>The cross-sectoral correction factor for 2026–2030 is unpublished. Every figure
        above is a labelled scenario at CSCF = 1, the last value the Commission set; the
        real figure cannot be higher and may be lower.</li>
      <li>Article 9 deductions for a carbon price paid in the country of origin are not
        modelled (implementing act still draft), so figures are conservative.</li>
      <li>Any below-threshold verdict rests on the user's own completeness statement,
        ticked in the tool. No one has verified that list.</li>
      <li>Line fingerprints cover inputs as entered; no source document exists. They are
        not customs provenance.</li>
    </ul>`;
}
```

- [ ] **Step 4: Run, expect all cbam-render tests passing** (existing + 5 new).

Run: `node --import tsx --test tests/unit/cbam-render.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): renderers for year verdicts, totals and the print document

The below-threshold card says on its face that it rests on the user's
attestation; above hides the checkbox because a fact needs no attestation; a
year without a published rule refuses to invent one; and the document's §4
prints what the figures cannot tell you."
```

---

### Task 6: Wire it — state, page markup, export buttons, print

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` — `initCbam` (lines 256–388) and imports
- Modify: `src/pages/cbam/cbam-calculator.astro`

- [ ] **Step 1: Extend the cbam-lines import in `cbam-app.ts`**

```ts
import {
  csvRows, lineFingerprint, packSnapshotHash, sumTotals, thresholdByYear, toCsv, yearOf,
  type Line, type Totals, type YearThreshold,
} from '../cbam-lines.ts';
```

- [ ] **Step 2: Add the page markup**

In `src/pages/cbam/cbam-calculator.astro`, directly after the `#cbStatus` line
(line 114), inside the form section:

```html
<div class="cb-lineactions">
  <button id="cbAdd" type="button" class="cb-btn">Add line to estimate</button>
  <button id="cbCsv" type="button" class="cb-btn" disabled>Export CSV</button>
  <button id="cbDoc" type="button" class="cb-btn" disabled>Export document</button>
</div>
```

Immediately before the closing tag of the page's main wrapper (after the
`.cb-out` section), add the print container:

```html
<!-- Print-only. Filled at export time; offscreen otherwise. NOT [hidden] —
     display:none would defeat the visibility trick below. -->
<section id="cbPrint" aria-hidden="true"></section>
```

And a **new** `<style is:global>` block (separate from the existing scoped
`<style>`; plain selectors only — `:global()` inside an `is:global` block ships
literally and the browser drops the rule):

```html
<style is:global>
  /* Injected via innerHTML, so Astro's scoped styles cannot reach these nodes. */
  #cbPrint { position: absolute; left: -200vw; top: 0; width: 180mm; }
  .cb-lineactions { display: flex; gap: 0.6rem; margin-top: 0.9rem; flex-wrap: wrap; }
  .cb-attest { display: flex; gap: 0.5rem; align-items: baseline; margin-top: 0.6rem; font-size: 0.85rem; }
  .cb-line-head { display: flex; gap: 0.75rem; align-items: baseline; margin: 1.1rem 0 0.35rem; }
  .cb-line-x { margin-left: auto; }
  #cbPrint table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  #cbPrint th, #cbPrint td { border: 1px solid #999; padding: 3pt 5pt; text-align: left; }
  #cbPrint .cbp-loc { font-size: 7pt; }
  #cbPrint code { word-break: break-all; }
  @media print {
    html.cb-printing body * { visibility: hidden; }
    html.cb-printing #cbPrint, html.cb-printing #cbPrint * { visibility: visible; }
    html.cb-printing #cbPrint { position: absolute; inset: 0; width: auto; }
  }
</style>
```

- [ ] **Step 3: Rewire `initCbam`**

Replace the body of `run()` and the listener block at the bottom of `initCbam`
(keep `ensurePack`, `syncRoutes`, `syncScope` exactly as they are). New element
lookups join the existing ones at the top of `initCbam`:

```ts
  const add = $<HTMLButtonElement>('cbAdd'), csvBtn = $<HTMLButtonElement>('cbCsv');
  const docBtn = $<HTMLButtonElement>('cbDoc'), printEl = $('cbPrint');
```

State, beside `let pack`:

```ts
  // The first state this controller has held. lines[] is the source of truth in
  // multi-line mode; the six form fields become the editor for the NEXT line.
  // With lines empty the app behaves exactly as it always has (single draft line,
  // vendored single-line threshold card) — that path is pinned by the existing
  // unit tests and stays byte-compatible.
  const lines: Line[] = [];
  const attested = new Set<number>();
  const fingerprints = new Map<string, string>();
  let snapshot = '';
```

Inside `ensurePack`, after `pack = await loadPack();` add:

```ts
    snapshot = await packSnapshotHash(pack);
```

Replace `run()`'s estimate block (the `try` body) so every estimate gets the real
snapshot decorated on — and add the dispatcher:

```ts
  function estimateLine(l: Line) {
    const e = estimateFromPack(pack!, {
      cn: l.cn, country: l.country, route: l.route,
      massT: l.massT, date: l.date, emissionsScope: l.scope,
    });
    // Decorate OUR copy of the result. The vendored engine still writes
    // 'browser-prototype'; replacing it here, after the fact, keeps the claim
    // real without touching upstream code.
    e.stamp.snapshotHash = snapshot;
    return e;
  }

  function draftLine(): Line | null {
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) return null;
    const massT = Number(mass!.value);
    if (!Number.isFinite(massT) || massT < 0) return null;
    return {
      id: crypto.randomUUID(), cn: cn!.value, country: country!.value, route: route!.value,
      scope: (scope?.value as Line['scope']) ?? 'direct_and_indirect',
      massT: mass!.value, date: date!.value,
    };
  }

  /**
   * A refused line comes back as status 'unavailable' and renders its own card.
   * A THROWN DomainError is rarer (the coverage sweep saw zero across 2,870
   * pairs) but the old run() caught it for a reason — one bad line must not
   * blank the other nine. Thrown lines render the same fallback the single-line
   * path used, and are excluded from totals and exports.
   */
  function safeEstimates(ls: readonly Line[]) {
    return ls.map((l) => {
      try { return { l, e: estimateLine(l), err: null as string | null }; }
      catch (err) { return { l, e: null, err: (err as Error).message }; }
    });
  }

  function renderAll(): void {
    if (!lines.length) { run(); return; }           // single-line path, unchanged
    const pairs = safeEstimates(lines);
    const ok = pairs.filter((p) => p.e !== null);
    const years = thresholdByYear(lines, fingerprints, attested, pack!);
    const totals = sumTotals(ok.map((p) => p.e!));
    out!.innerHTML =
      years.map(renderYearThreshold).join('') +
      renderTotals(totals) +
      pairs.map((p, i) => p.e
        ? renderLineCard(p.l, p.e, i)
        : `<article class="cb-line" data-line="${esc(p.l.id)}">
             <div class="cb-line-head">
               <span class="cb-line-n">Line ${i + 1}</span>
               <span class="cb-line-sum">${esc(p.l.cn)} · ${esc(p.l.country)} · ${num(p.l.massT)} t</span>
               <button type="button" class="cb-line-x" data-remove="${esc(p.l.id)}"
                 aria-label="Remove line ${i + 1}">Remove</button>
             </div>
             <div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate</div>
             <p class="cb-reason">${esc(p.err!)}</p></div>
           </article>`).join('');
    csvBtn && (csvBtn.disabled = false);
    docBtn && (docBtn.disabled = false);
    status!.textContent = `${lines.length} line${lines.length === 1 ? '' : 's'} in this estimate.`;
  }

  async function onAdd(): Promise<void> {
    if (!await ensurePack()) return;
    const l = draftLine();
    if (!l) {
      status!.textContent = 'Complete the line first: good, origin, route and a non-negative mass.';
      return;
    }
    fingerprints.set(l.id, await lineFingerprint(l));
    lines.push(l);
    renderAll();
  }

  function onOutClick(ev: Event): void {
    const t = ev.target as HTMLElement;
    const rm = t.getAttribute('data-remove');
    if (rm) {
      const i = lines.findIndex((l) => l.id === rm);
      if (i >= 0) { lines.splice(i, 1); fingerprints.delete(rm); }
      if (!lines.length) { csvBtn && (csvBtn.disabled = true); docBtn && (docBtn.disabled = true); }
      renderAll(); return;
    }
    const at = (t as HTMLInputElement).getAttribute?.('data-attest');
    if (at) {
      (t as HTMLInputElement).checked ? attested.add(Number(at)) : attested.delete(Number(at));
      renderAll();
    }
  }

  function onCsv(): void {
    if (!lines.length || !pack) return;
    // Thrown lines are excluded — the CSV parallel arrays must stay parallel.
    const ok = safeEstimates(lines).filter((p) => p.e !== null);
    const csv = toCsv(csvRows(ok.map((p) => p.l), ok.map((p) => p.e!), fingerprints, snapshot, pack));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cbam-estimate-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onDoc(): void {
    if (!lines.length || !pack || !printEl) return;
    const ok = safeEstimates(lines).filter((p) => p.e !== null);
    if (!ok.length) return;
    const results = ok.map((p) => p.e!);
    printEl.innerHTML = buildPrintDocument({
      lines: ok.map((p) => p.l), results,
      yearCards: thresholdByYear(lines, fingerprints, attested, pack),
      totals: sumTotals(results),
      packSnapshot: snapshot,
      rulePackages: results[0]?.stamp.rulePackages ?? [],
    });
    document.documentElement.classList.add('cb-printing');
    const done = () => document.documentElement.classList.remove('cb-printing');
    window.addEventListener('afterprint', done, { once: true });
    window.print();
  }
```

Listener block — the existing listeners stay; `run` calls become `renderAll` where
they re-render (route/scope/mass/date/cn/country changes keep previewing the
draft only when `lines` is empty; with lines present they just edit the next
line, so keep the existing `run`-bound listeners but pointed at a guard):

```ts
  const refresh = () => { if (!lines.length) run(); };
  const onPick = async () => { if (await ensurePack()) { syncRoutes(); syncScope(); refresh(); } };
  route.addEventListener('change', () => { syncScope(); refresh(); });
  scope?.addEventListener('change', refresh);
  cn.addEventListener('change', onPick);
  cn.addEventListener('focus', () => { void ensurePack(); }, { once: true });
  country.addEventListener('change', onPick);
  date.addEventListener('change', onPick);
  let massTimer: number | undefined;
  mass.addEventListener('input', () => {
    clearTimeout(massTimer);
    massTimer = window.setTimeout(refresh, 250);
  });
  add?.addEventListener('click', () => { void onAdd(); });
  csvBtn?.addEventListener('click', onCsv);
  docBtn?.addEventListener('click', onDoc);
  out.addEventListener('click', onOutClick);
  out.addEventListener('change', onOutClick);
```

(The `data-attest` checkbox fires `change`, not `click`-with-target-button —
binding `onOutClick` to both events on the container covers remove buttons and
checkboxes with one delegate.)

- [ ] **Step 4: Type-check and run every unit test**

Run: `npx astro check && npm run test:unit`
Expected: 0 errors; all unit tests pass (the single-line path is untouched, so
`cbam-render`'s §8 pins still hold).

- [ ] **Step 5: Build and eyeball**

Run: `npm run build && npm run preview` → open `http://localhost:4321/cbam/cbam-calculator/`
(or the next free port). Add two lines, remove one, tick the attestation, export
both artefacts.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts src/pages/cbam/cbam-calculator.astro
git commit -m "feat(cbam): multi-line estimates, attested threshold verdicts, CSV and print export

lines[] is the first state this controller has held; the form becomes the
editor for the next line, and the empty-list path stays byte-compatible with
the single-line behaviour the existing tests pin. Every estimate is decorated
with the real pack snapshot before render. Print CSS lives in an is:global
block with plain selectors — :global() inside is:global ships literally."
```

---

### Task 7: End-to-end test

**Files:**
- Create: `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

// The multi-line flow: add, remove, attest, export. Runs against the built
// site like every other spec here.
test.describe('multi-line CBAM estimate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cbam/cbam-calculator/');
    await page.fill('#cbCn', '25231000');
    await page.dispatchEvent('#cbCn', 'change');
    await page.selectOption('#cbCountry', 'DZ');
    await page.selectOption('#cbRoute', '(A)');
    await page.fill('#cbMass', '30');
  });

  test('attestation turns indeterminate into below-threshold, and back', async ({ page }) => {
    await page.click('#cbAdd');
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');
    await page.check('[data-attest="2026"]');
    await expect(page.locator('.cb-thresh')).toContainText('Below threshold');
    await page.uncheck('[data-attest="2026"]');
    await expect(page.locator('.cb-thresh')).toContainText('Indeterminate');
  });

  test('add two, remove one, totals follow', async ({ page }) => {
    await page.click('#cbAdd');
    await page.fill('#cbMass', '100');
    await page.click('#cbAdd');
    await expect(page.locator('.cb-line')).toHaveCount(2);
    await expect(page.locator('.cb-total')).toContainText('2 lines');
    await page.locator('[data-remove]').first().click();
    await expect(page.locator('.cb-line')).toHaveCount(1);
  });

  test('a 60 t line is above threshold with nothing ticked', async ({ page }) => {
    await page.fill('#cbMass', '60');
    await page.click('#cbAdd');
    await expect(page.locator('.cb-thresh')).toContainText('Above threshold');
    await expect(page.locator('[data-attest]')).toHaveCount(0);
  });

  test('CSV downloads with the full header; document fills the print container', async ({ page }) => {
    await page.click('#cbAdd');
    const dl = page.waitForEvent('download');
    await page.click('#cbCsv');
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^cbam-estimate-\d{4}-\d{2}-\d{2}\.csv$/);
    // Stub print so the dialog never opens headless; assert the document is built.
    await page.evaluate(() => { (window as never as { print: () => void }).print = () => {}; });
    await page.click('#cbDoc');
    await expect(page.locator('#cbPrint')).toContainText('What this does not tell you');
    await expect(page.locator('#cbPrint')).toContainText('inputs as entered');
  });
});
```

- [ ] **Step 2: Build and run it**

Run: `npm run build && npx playwright test tests/e2e/cbam-lines.spec.ts`
Expected: 4 passing. If `#cbRoute` has one published route for DZ it will already
be selected (`nextRoute` collapses a single option); `selectOption` is then a
no-op that still succeeds.

- [ ] **Step 3: Run the whole gate**

Run: `npm run verify && npx playwright test`
Expected: verify green (sync-check must still say "vendored engine intact" —
this plan touched no vendored file), all e2e specs pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): e2e for add/remove/attest and both exports"
```

---

### Task 8: Update the engine reference — the feature exists now

**Files:**
- Modify: `docs/cbam-engine-reference.md`

- [ ] **Step 1: Update §4.3 and §7**

In §4.3, replace the final paragraph ("**\"Above\" can be proven…** …referenced
zero times by the calculator.") with:

```markdown
**"Above" can be proven from one line. "Below" cannot** — it requires the whole
year. The calculator now takes multiple lines and evaluates the threshold **per
calendar year** through `aggregateThresholdBasis`; `below_threshold` is reachable
only when the user explicitly attests the list is their complete year, and every
surface that shows the verdict names that attestation as its basis. Estimates
export as a CSV (engine values verbatim, one row per line, each beside its legal
locator) and as a printable document whose final section states what the figures
cannot tell you.
```

In §7, delete the "Multi-line and the annual threshold" row.

- [ ] **Step 2: Regenerate the PDF and commit**

Run: `node scripts/md-to-pdf.mjs docs/cbam-engine-reference.md`

```bash
git add docs/cbam-engine-reference.md
git commit -m "docs(cbam): the reference catches up — multi-line and the threshold verdict shipped"
```

---

## Final acceptance checklist

- [ ] `npm run test:unit` — all pass, including the per-year regression test
- [ ] `npx playwright test` — all pass
- [ ] `npm run verify` — publication contract green
- [ ] `node scripts/cbam-sync-check.mjs` — "vendored engine intact"; `git status` shows **no vendored file modified**
- [ ] Single-line behaviour with an empty list is unchanged (§8 pins still green)
- [ ] The CSV opens in a spreadsheet and `chargeable = embedded − free_allocation` holds per row
- [ ] The printed document shows all four §4 caveats
