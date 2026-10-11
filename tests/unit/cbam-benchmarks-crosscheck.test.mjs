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
