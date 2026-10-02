// tests/unit/solar-cost.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { SOLAR_COST, costBasisFor, isComplete } from '../../src/scripts/climate-engine/solar-cost.ts';

const sourcedFields = (b) => [b.subsidy.home, b.subsidy.society, b.costPerKw, b.tariff, b.degradation,
  b.upkeepPerYear, b.inverter, b.horizonYears, b.sizingByUnits, b.surplusCreditPerKwh];

test('every Kolkata default carries a source and an as-of date', () => {
  const b = SOLAR_COST.kolkata;
  for (const f of sourcedFields(b)) {
    assert.ok(typeof f.source === 'string' && f.source.trim().length > 10, `unsourced value: ${JSON.stringify(f.value)}`);
    assert.match(f.as_of, /^\d{4}-\d{2}-\d{2}$/, `bad as_of on ${JSON.stringify(f.value)}`);
  }
  assert.equal(isComplete(b), true);
});

test('every registry key names its own city', () => {
  for (const k of Object.keys(SOLAR_COST)) assert.equal(SOLAR_COST[k].city, k);
});

test('every Kolkata value is pinned', () => {
  const b = SOLAR_COST.kolkata;
  assert.deepEqual(b.subsidy.home.value, { perKwFirst2: 30000, perKwThird: 18000, cap: 78000 });
  assert.deepEqual(b.subsidy.society.value, { perKw: 18000, capKw: 500 });
  assert.deepEqual(b.costPerKw.value, [55000, 70000]);
  assert.equal(b.tariff.value, 8);
  assert.equal(b.surplusCreditPerKwh.value, 0);
  assert.deepEqual(b.degradation.value, { firstYear: 0.03, perYear: 0.005 });
  assert.equal(b.upkeepPerYear.value, 0.01);
  assert.deepEqual(b.inverter.value, { year: 10, perKw: 8000 });
  assert.equal(b.horizonYears.value, 25);
  assert.deepEqual(b.sizingByUnits.value, [
    { maxUnits: 150, kw: [1, 2] },
    { maxUnits: 300, kw: [2, 3] },
    { maxUnits: null, kw: [3, null] },
  ]);
});

test('the sources name the documents the values come from', () => {
  const b = SOLAR_COST.kolkata;
  assert.match(b.subsidy.home.source, /CFA_structure20240307\.pdf/); // PM Surya Ghar CFA PDF, 7 Mar 2024
  assert.match(b.surplusCreditPerKwh.source, /81\/WBERC/); // WBERC 2025 rooftop regulations
  assert.match(b.surplusCreditPerKwh.source, /reset to zero/);
  /* the installed-cost default names its documents, not "the market" (audit fix 5) */
  assert.match(b.costPerKw.source, /202507081690964295\.pdf/); // MNRE PM Surya Ghar guidelines, clause 2(g) benchmark
  assert.match(b.costPerKw.source, /SECONDARY/);
  for (const site of ['myrsolar.com', 'vikramsolar.com', 'ushasolarindia.com', 'avaadaelectro.com']) {
    assert.ok(b.costPerKw.source.includes(site), `the cost source does not name ${site}`);
  }
});

test('costBasisFor: a known city, or null', () => {
  assert.equal(costBasisFor('kolkata'), SOLAR_COST.kolkata);
  assert.equal(costBasisFor('bengaluru'), null);
});

test('costBasisFor is fail-closed for inherited property names', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(costBasisFor(name), null, `costBasisFor(${name})`);
  }
});

test('isComplete: an empty source is refused', () => {
  const broken = { ...SOLAR_COST.kolkata, tariff: { ...SOLAR_COST.kolkata.tariff, source: '' } };
  assert.equal(isComplete(broken), false);
});

test('costBasisFor refuses an incomplete REGISTERED basis', () => {
  // node:test runs a file's tests sequentially; the finally removes the key before any other test runs.
  SOLAR_COST.broken = {
    ...SOLAR_COST.kolkata,
    city: 'broken',
    tariff: { ...SOLAR_COST.kolkata.tariff, source: '' },
  };
  try {
    assert.equal(costBasisFor('broken'), null);
  } finally {
    delete SOLAR_COST.broken;
  }
  assert.equal(costBasisFor('broken'), null);
});

test('isComplete fails when ANY sourced field loses its source or has a bad date', () => {
  const b = SOLAR_COST.kolkata;
  const paths = [['subsidy', 'home'], ['subsidy', 'society'], ['costPerKw'], ['tariff'], ['surplusCreditPerKwh'],
    ['degradation'], ['upkeepPerYear'], ['inverter'], ['horizonYears'], ['sizingByUnits']];
  for (const path of paths) {
    for (const patch of [{ source: '' }, { as_of: 'soon' }]) {
      const copy = { ...b };
      if (path.length === 2) {
        copy[path[0]] = { ...b[path[0]], [path[1]]: { ...b[path[0]][path[1]], ...patch } };
      } else {
        copy[path[0]] = { ...b[path[0]], ...patch };
      }
      assert.equal(isComplete(copy), false, `${path.join('.')} with ${JSON.stringify(patch)}`);
    }
  }
});

test('isComplete covers a field added later, without anyone listing it', () => {
  const extended = { ...SOLAR_COST.kolkata, extra: { value: 1, source: '', as_of: '2026-09-30' } };
  assert.equal(isComplete(extended), false);
  assert.equal(isComplete({ ...extended, extra: { ...extended.extra, source: 'a real citation here' } }), true);
});

test('isComplete: a basis with no cited fields at all is not complete', () => {
  assert.equal(isComplete({ city: 'empty' }), false);
});
