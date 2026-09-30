// tests/unit/solar-roi.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRoi, subsidyFor, degradationFactor } from '../../src/scripts/climate-engine/solar-roi.ts';

const S = (value) => ({ value, source: 'test fixture source', as_of: '2026-09-30' });
/* A flat basis: no degradation, no upkeep, no inverter inside the horizon, so a
   payback is a division a reader can do in their head. */
const FLAT = {
  city: 'test',
  subsidy: { home: S({ perKwFirst2: 30000, perKwThird: 18000, cap: 78000 }), society: S({ perKw: 18000, capKw: 500 }) },
  costPerKw: S([60000, 60000]), tariff: S(10), surplusCreditPerKwh: S(4),
  degradation: S({ firstYear: 0, perYear: 0 }), upkeepPerYear: S(0),
  inverter: S({ year: 99, perKw: 0 }), horizonYears: S(25),
  sizingByUnits: S([{ maxUnits: 150, kw: [1, 2] }, { maxUnits: 300, kw: [2, 3] }, { maxUnits: null, kw: [3, null] }]),
};
const input = (over = {}) => ({ sizeKw: 3, kwhPerKw: [1000, 1000], owner: 'home', costPerKw: [60000, 60000],
  tariff: 10, unitsPerMonth: null, basis: FLAT, ...over });

test('subsidyFor: home 30k/kW to 2 kW, 18k for the 3rd, cap 78k; society 18k/kW to 500 kW; business none', () => {
  assert.equal(subsidyFor('home', 1, FLAT), 30000);
  assert.equal(subsidyFor('home', 2.5, FLAT), 69000);
  assert.equal(subsidyFor('home', 3, FLAT), 78000);
  assert.equal(subsidyFor('home', 10, FLAT), 78000);
  assert.equal(subsidyFor('society', 3, FLAT), 54000);
  assert.equal(subsidyFor('society', 600, FLAT), 9_000_000);
  assert.equal(subsidyFor('business', 3, FLAT), 0);
  /* the cap hides the 3 kW tier limit in FLAT, so lift it: kW past the third earn nothing */
  assert.equal(subsidyFor('home', 10, { ...FLAT, subsidy: { ...FLAT.subsidy, home: S({ perKwFirst2: 30000, perKwThird: 18000, cap: 1e9 }) } }), 78000);
});

test('golden: 3 kW home, 1,000 kWh/kW, 60k/kW, 10/kWh: cost 180k - 78k = 102k, 30k a year, pays back in year 4', () => {
  const r = computeRoi(input());
  assert.equal(r.status, 'ok');
  assert.equal(r.fast.upfront, 102000);
  assert.equal(r.fast.subsidy, 78000);
  assert.equal(r.fast.paybackYear, 4);        // 3 × 30k = 90k < 102k; 4 × 30k = 120k
  assert.equal(r.fast.net, 25 * 30000 - 102000);
  assert.equal(r.slow.paybackYear, 4);
});

test('golden: society pays back in year 5, business in year 6', () => {
  assert.equal(computeRoi(input({ owner: 'society' })).fast.paybackYear, 5);   // 126k upfront
  const biz = computeRoi(input({ owner: 'business' }));
  assert.equal(biz.fast.paybackYear, 6);                                         // 180k upfront, 6 × 30k = 180k
  assert.equal(biz.fast.net, 750000 - 180000);
});

test('golden, bill mode: 100 units a month, so 1,200 kWh at 10 and 1,800 surplus at 4 = 19.2k a year: year 6', () => {
  const r = computeRoi(input({ unitsPerMonth: 100 }));
  assert.equal(r.fast.years[0].value, 1200 * 10 + 1800 * 4);
  assert.equal(r.fast.paybackYear, 6);        // 5 × 19.2k = 96k < 102k
});

test('bill mode where surplus lapses (Kolkata): only the 1,200 self-used kWh earn anything', () => {
  const r = computeRoi(input({ unitsPerMonth: 100, basis: { ...FLAT, surplusCreditPerKwh: S(0) } }));
  assert.equal(r.fast.years[0].value, 12000);
});

test('golden: upkeep 1 % and an inverter in year 12', () => {
  const basis = { ...FLAT, upkeepPerYear: S(0.01), inverter: S({ year: 12, perKw: 10000 }) };
  const r = computeRoi(input({ sizeKw: 1, owner: 'business', costPerKw: [50000, 50000], basis }));
  assert.equal(r.fast.years[0].upkeep, 500);
  assert.equal(r.fast.years[11].inverter, 10000);
  assert.equal(r.fast.paybackYear, 6);         // 9,500 a year against 50,000
  assert.equal(r.fast.net, 25 * 9500 - 10000 - 50000);
});

test('degradation: year 1 loses firstYear, each later year perYear more', () => {
  const basis = { ...FLAT, degradation: S({ firstYear: 0.025, perYear: 0.007 }) };
  assert.equal(degradationFactor(1, basis), 0.975);
  assert.ok(Math.abs(degradationFactor(3, basis) - 0.975 * 0.993 ** 2) < 1e-12);
});

test('no payback within the horizon is a status, not a number', () => {
  const r = computeRoi(input({ owner: 'business', tariff: 1 }));
  assert.equal(r.status, 'no_payback');
  assert.equal(r.fast.paybackYear, null);
  assert.equal(r.fast.net, 25 * 3000 - 180000);
});

test('under 1 kW is too small: no scenarios at all', () => {
  const r = computeRoi(input({ sizeKw: 0.8 }));
  assert.deepEqual(r, { status: 'too_small', slow: null, fast: null });
});

test('the range: slow takes low yield and high cost, fast the opposite; pairs given either way round', () => {
  const r = computeRoi(input({ kwhPerKw: [1200, 800], costPerKw: [70000, 50000], owner: 'business' }));
  assert.equal(r.slow.years[0].kwh, 3 * 800);
  assert.equal(r.slow.upfront, 3 * 70000);
  assert.equal(r.fast.years[0].kwh, 3 * 1200);
  assert.equal(r.fast.upfront, 3 * 50000);
  assert.ok(r.fast.paybackYear <= r.slow.paybackYear);
  assert.ok(r.fast.net >= r.slow.net);
});

test('properties over a sweep: more subsidy never lengthens payback; bill mode never beats flat', () => {
  for (const size of [1, 2, 3, 5, 10]) for (const tariff of [4, 8, 12]) for (const kwh of [900, 1200, 1400]) {
    const base = { sizeKw: size, tariff, kwhPerKw: [kwh, kwh] };
    const biz = computeRoi(input({ ...base, owner: 'business' })).fast;
    const soc = computeRoi(input({ ...base, owner: 'society' })).fast;
    const home = computeRoi(input({ ...base, owner: 'home' })).fast;
    const yrs = (s) => s.paybackYear ?? Infinity;
    assert.ok(yrs(home) <= yrs(biz) && yrs(soc) <= yrs(biz), `size ${size} tariff ${tariff}`);
    const bill = computeRoi(input({ ...base, owner: 'home', unitsPerMonth: 150 })).fast;
    assert.ok(bill.net <= home.net + 1e-6, `bill mode out-earned flat at size ${size}`);
  }
});
