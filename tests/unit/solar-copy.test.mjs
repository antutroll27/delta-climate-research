import assert from 'node:assert/strict';
import test from 'node:test';

import {
  wardSummary, validatedSentence, noteFor, sharePct,
  ESTIMATE_TAG, BANNED_PAYBACK_WORDS, paybackText, savingText, subsidyLine, assumptionsLine, sizingText, surplusText,
} from '../../src/scripts/climate-engine/solar-copy.ts';
import { computeRoi } from '../../src/scripts/climate-engine/solar-roi.ts';
import { SOLAR_COST } from '../../src/scripts/climate-engine/solar-cost.ts';

const MANY = { n: 31, months: 9, median_ratio: 0.97, within_15pct_share: 0.84, date: '2026-10-01' };
const ONE = { n: 1, months: 1, median_ratio: 1.02, within_15pct_share: 1, date: '2026-10-01' };

test('wardSummary: screened names the five limits, no numbers to pluralise', () => {
  const s = wardSummary({ tiers: { validated: null } });
  assert.match(s, /^Screened from satellites and open data\./);
  assert.match(s, /roof obstacles/);
  assert.match(s, /no comparison with real rooftops yet/);
});

test('wardSummary: validated pluralises the roster size and the months, many and one', () => {
  assert.match(wardSummary({ tiers: { validated: MANY } }), /Checked against 31 real rooftops over 9 months/);
  assert.match(wardSummary({ tiers: { validated: ONE } }), /Checked against 1 real rooftop over 1 month\b/);
});

test('validatedSentence pluralises the same way, many and one', () => {
  assert.equal(
    validatedSentence(MANY),
    'Compared with 31 real rooftops over 9 months: median ratio 0.97, 84% within 15%.',
  );
  assert.equal(
    validatedSentence(ONE),
    'Compared with 1 real rooftop over 1 month: median ratio 1.02, 100% within 15%.',
  );
});

test('noteFor: screened returns the default note untouched', () => {
  const DEFAULT = 'Screening estimate · not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance';
  assert.equal(noteFor({ tiers: { validated: null } }, DEFAULT), DEFAULT);
});

test('noteFor: validated strips the "Screening estimate" prefix and pluralises the roster', () => {
  const DEFAULT = 'Screening estimate · not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance';
  assert.equal(
    noteFor({ tiers: { validated: MANY } }, DEFAULT),
    'Checked against 31 real rooftops · still a screening estimate · '
    + 'not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance',
  );
  assert.equal(
    noteFor({ tiers: { validated: ONE } }, DEFAULT),
    'Checked against 1 real rooftop · still a screening estimate · '
    + 'not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance',
  );
  assert.doesNotMatch(noteFor({ tiers: { validated: MANY } }, DEFAULT), /^Screening estimate/);
});

/* THE FLOOR UNDER A ROUNDED SHARE. The card's tree line and the brief's
   buildings/trees split print this side by side, and a second copy of the rule is
   how they would come to disagree at the boundary. */
test('a share rounds, but never rounds a real one down to none', () => {
  assert.equal(sharePct(0), 'under 1%');
  assert.equal(sharePct(0.0049), 'under 1%');   // a real share, a rounding away from none
  assert.equal(sharePct(0.005), '1%');          // the first share that may be printed as a number
  assert.equal(sharePct(0.094), '9%');
  assert.equal(sharePct(1), '100%');
});

const money = (n) => `M${Math.round(n)}`;
const rate = (n) => `R${n.toFixed(2)}`;
const B = SOLAR_COST.kolkata;
const roi = (over = {}) => computeRoi({ sizeKw: 3, kwhPerKw: [1000, 1300], owner: 'home', costPerKw: [55000, 65000],
  tariff: 8, unitsPerMonth: null, basis: B, ...over });

test('paybackText: a range, a single year, beyond the horizon, never, too small', () => {
  assert.match(paybackText(roi(), 25), /^\d+–\d+ years$|^\d+ years$/);
  assert.equal(paybackText(computeRoi({ sizeKw: 0.5, kwhPerKw: [1, 1], owner: 'home', costPerKw: [1, 1], tariff: 1, unitsPerMonth: null, basis: B }), 25),
    'Too small for a useful system');
  assert.equal(paybackText(roi({ owner: 'business', tariff: 0.5 }), 25), 'Does not pay back within 25 years at these assumptions');
});

test('savingText and subsidyLine speak through the injected formatters only', () => {
  assert.match(savingText(roi(), money), /^M-?\d+ to M-?\d+$/);
  assert.equal(subsidyLine('home', 78000, money), 'Home: PM Surya Ghar subsidy M78000 applied');
  assert.equal(subsidyLine('society', 54000, money), 'Housing society: M54000 for common areas (assumes common-area use)');
  assert.equal(subsidyLine('business', 0, money), 'Business: no subsidy');
});

test('assumptionsLine names every input the result depends on, and the as-of date', () => {
  const s = assumptionsLine({ owner: 'home', sizeKw: 3, costPerKw: [55000, 65000], subsidy: 78000, tariff: 8, unitsPerMonth: null, basis: B }, money, rate);
  for (const part of ['Home', '3.0 kW', 'M55000–M65000 per kW', 'subsidy M78000', 'R8.00 per kWh', 'degradation', 'upkeep', 'inverter', 'defaults as of 2026-09-30']) {
    assert.ok(s.includes(part), `missing "${part}" in: ${s}`);
  }
});

test('the tag, and no sentence ever uses a banned word', () => {
  assert.equal(ESTIMATE_TAG, 'screened · estimate, not a quote');
  const all = [paybackText(roi(), 25), savingText(roi(), money), subsidyLine('home', 1, money), subsidyLine('society', 1, money),
    subsidyLine('business', 0, money), sizingText(180, [2, 3]), sizingText(400, [3, null]),
    surplusText(3, [0.2, 0.4], 8, 3.5, rate), surplusText(3, [0.2, 0.4], 8, 0, rate), ESTIMATE_TAG,
    assumptionsLine({ owner: 'business', sizeKw: 2, costPerKw: [1, 2], subsidy: 0, tariff: 8, unitsPerMonth: 120, basis: B }, money, rate)];
  for (const s of all) assert.doesNotMatch(s, BANNED_PAYBACK_WORDS, s);
});

test('sizingText and surplusText', () => {
  assert.equal(sizingText(180, [2, 3]), 'Official sizing for 180 units a month: 2–3 kW');
  assert.equal(sizingText(400, [3, null]), 'Official sizing for 400 units a month: above 3 kW');
  assert.equal(surplusText(3, [0.2, 0.4], 8, 3.5, rate),
    'At 3.0 kW about 20–40 % of your generation is surplus, credited at R3.50 per kWh, not your R8.00 tariff.');
  assert.equal(surplusText(3, [0.2, 0.4], 8, 0, rate),
    'At 3.0 kW about 20–40 % of your generation is surplus beyond your yearly use. Under WBERC\'s 2025 rules it is reset to zero at the end of each year, not paid.');
});

test('paybackText: fast pays back, slow never does within the horizon (hand-built result)', () => {
  const sc = (paybackYear) => ({ upfront: 0, subsidy: 0, paybackYear, net: 0, years: [] });
  assert.equal(paybackText({ status: 'ok', fast: sc(7), slow: sc(null) }, 25), '7 years to more than 25');
  assert.equal(paybackText({ status: 'ok', fast: sc(7), slow: sc(7) }, 25), '7 years');
  assert.equal(paybackText({ status: 'ok', fast: sc(6), slow: sc(9) }, 25), '6–9 years');
});

test('assumptionsLine: exact strings for flat and bill mode, from the real basis', () => {
  const flat = assumptionsLine({ owner: 'home', sizeKw: 3, costPerKw: [65000, 55000], subsidy: 78000, tariff: 8, unitsPerMonth: null, basis: B }, money, rate);
  assert.equal(flat, 'Home · 3.0 kW · M55000–M65000 per kW · subsidy M78000 · R8.00 per kWh flat · degradation 3.0 % then 0.50 %/yr · upkeep 1.0 %/yr · inverter replaced in year 10 · defaults as of 2026-09-30');
  const bill = assumptionsLine({ owner: 'society', sizeKw: 2, costPerKw: [1, 2], subsidy: 0, tariff: 8, unitsPerMonth: 120, basis: B }, money, rate);
  assert.ok(bill.includes('R8.00 per kWh for your own use, 120 units a month, surplus not paid'), bill);
  const paid = assumptionsLine({ owner: 'home', sizeKw: 2, costPerKw: [1, 2], subsidy: 0, tariff: 8, unitsPerMonth: 120,
    basis: { ...B, surplusCreditPerKwh: { ...B.surplusCreditPerKwh, value: 3.5 } } }, money, rate);
  assert.ok(paid.includes('surplus at R3.50'), paid);
});
