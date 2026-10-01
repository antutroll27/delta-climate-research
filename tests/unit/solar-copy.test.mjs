import assert from 'node:assert/strict';
import test from 'node:test';

import {
  wardSummary, validatedSentence, noteFor, sharePct,
  ESTIMATE_TAG, BANNED_PAYBACK_WORDS, paybackText, savingText, capFirst, subsidyLine, assumptionsLine, sizingText, surplusText, flatCaveat, oldestAsOf,
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
const LIVE = SOLAR_COST.kolkata;

/* A frozen fixture basis, so the assertions below do not move when the shipped data is refreshed.
   Every value an assertion names is set here, and every as_of is pinned. Only the banned-word
   sweep at the bottom reads the LIVE basis: it guards what actually ships. */
const pinDates = (o) => (o !== null && typeof o === 'object'
  ? ('source' in o ? { ...o, as_of: '2026-09-30' } : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pinDates(v)])))
  : o);
const deepFreeze = (o) => { if (o !== null && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const set = (cited, value) => ({ ...cited, value });
const B = deepFreeze(pinDates({
  ...LIVE,
  subsidy: {
    home: set(LIVE.subsidy.home, { perKwFirst2: 30000, perKwThird: 18000, cap: 78000 }),
    society: set(LIVE.subsidy.society, { perKw: 18000, capKw: 500 }),
  },
  costPerKw: set(LIVE.costPerKw, [55000, 65000]),
  tariff: set(LIVE.tariff, 8),
  surplusCreditPerKwh: set(LIVE.surplusCreditPerKwh, 0),
  degradation: set(LIVE.degradation, { firstYear: 0.03, perYear: 0.005 }),
  upkeepPerYear: set(LIVE.upkeepPerYear, 0.01),
  inverter: set(LIVE.inverter, { year: 10, perKw: 8000 }),
  horizonYears: set(LIVE.horizonYears, 25),
}));
const paidBasis = { ...B, surplusCreditPerKwh: { ...B.surplusCreditPerKwh, value: 3.5 } };
const TOO_SMALL = { status: 'too_small', slow: null, fast: null };
const roi = (over = {}) => computeRoi({ sizeKw: 3, kwhPerKw: [1000, 1300], owner: 'home', costPerKw: [55000, 65000],
  tariff: 8, unitsPerMonth: null, basis: B, ...over });
const sc = (paybackYear, net = 0) => ({ upfront: 0, subsidy: 0, paybackYear, net, years: [] });
const home3 = { owner: 'home', sizeKw: 3, costPerKw: [55000, 65000], subsidy: 78000, tariff: 8, unitsPerMonth: null, basis: B };

test('paybackText: a range, a single year, never, too small', () => {
  assert.equal(paybackText(roi(), 25), '4–6 years');
  assert.equal(paybackText(computeRoi({ sizeKw: 0.5, kwhPerKw: [1, 1], owner: 'home', costPerKw: [1, 1], tariff: 1, unitsPerMonth: null, basis: B }), 25),
    'Too small for a useful system');
  assert.equal(paybackText(roi({ owner: 'business', tariff: 0.5 }), 25), 'Does not pay back within 25 years at these assumptions');
});

test('paybackText: singular and plural, and no number past the horizon', () => {
  assert.equal(paybackText({ status: 'ok', fast: sc(7), slow: sc(7) }, 25), '7 years');
  assert.equal(paybackText({ status: 'ok', fast: sc(1), slow: sc(1) }, 25), '1 year');
  assert.equal(paybackText({ status: 'ok', fast: sc(1), slow: sc(2) }, 25), '1–2 years');
  assert.equal(paybackText({ status: 'ok', fast: sc(6), slow: sc(9) }, 25), '6–9 years');
  assert.equal(paybackText({ status: 'ok', fast: sc(7), slow: sc(null) }, 25), '7 years at best; may not pay back within 25 years');
  assert.equal(paybackText({ status: 'ok', fast: sc(1), slow: sc(null) }, 25), '1 year at best; may not pay back within 25 years');
});

test('savingText: a saving range, a loss-to-saving range, and a plain loss', () => {
  const r = (slowNet, fastNet) => ({ status: 'ok', slow: sc(9, slowNet), fast: sc(6, fastNet) });
  assert.equal(savingText(r(1000, 5000), money, 25), 'M1000 to M5000');
  assert.equal(savingText(r(-1000, 5000), money, 25), 'a loss of M1000 to a saving of M5000');
  assert.equal(savingText({ status: 'no_payback', slow: sc(null, -9000), fast: sc(null, -2000) }, money, 25),
    'A net loss over 25 years at these assumptions');
  assert.equal(savingText(TOO_SMALL, money, 25), '');
  assert.match(savingText(roi(), money, 25), /^M-?\d+ to M-?\d+$/);
});

test('subsidyLine assumes, it does not promise, and speaks through the injected formatter only', () => {
  assert.equal(subsidyLine('home', 78000, money), 'Home: assumes the PM Surya Ghar subsidy of M78000, if eligible');
  assert.equal(subsidyLine('society', 54000, money), 'Housing society: assumes M54000 for common areas, if eligible');
  assert.equal(subsidyLine('business', 0, money), 'Business: no subsidy assumed');
});

test('assumptionsLine: flat mode declares that it assumes you use every kWh', () => {
  const s = assumptionsLine(home3, money, rate);
  assert.equal(s, 'Home · 3 kW · installed cost M55000–M65000 per kW · subsidy M78000 if eligible · every kWh valued at R8.00 per unit (kWh), assuming you use all of it'
    + ' · output falls 3% in year 1, then 0.5% a year · upkeep 1% of cost a year · inverter replaced in year 10'
    + ' · today\'s prices, no tariff rise · reference defaults as of Sep 2026');
});

test('assumptionsLine: a subsidy is assumed only if eligible; a business with none says "no subsidy"', () => {
  const biz = assumptionsLine({ ...home3, owner: 'business', subsidy: 0 }, money, rate);
  assert.ok(biz.includes(' · no subsidy · '), biz);
  assert.ok(!biz.includes('if eligible'), biz);
  assert.ok(assumptionsLine({ ...home3, owner: 'society', subsidy: 54000 }, money, rate).includes(' · subsidy M54000 if eligible · '));
});

test('capFirst: a saving sentence that begins a cell begins with a capital', () => {
  assert.equal(capFirst(savingText({ status: 'ok', slow: sc(9, -1000), fast: sc(6, 5000) }, money, 25)),
    'A loss of M1000 to a saving of M5000');
  assert.equal(capFirst('M1000 to M5000'), 'M1000 to M5000');
  assert.equal(capFirst(''), '');
});

test('assumptionsLine: bill mode names the units and what happens to surplus; sizes print whole or to a half', () => {
  const bill = assumptionsLine({ ...home3, owner: 'society', sizeKw: 2.5, unitsPerMonth: 120 }, money, rate);
  assert.ok(bill.includes('2.5 kW'), bill);
  assert.ok(bill.includes('R8.00 per unit (kWh) for your own use, 120 units a month, surplus not paid'), bill);
  assert.ok(assumptionsLine({ ...home3, unitsPerMonth: 1 }, money, rate).includes('1 unit a month'));
  assert.ok(assumptionsLine({ ...home3, unitsPerMonth: 119.6 }, money, rate).includes('120 units a month'));
  const paid = assumptionsLine({ ...home3, unitsPerMonth: 120, basis: paidBasis }, money, rate);
  assert.ok(paid.includes('surplus at R3.50'), paid);
  assert.ok(assumptionsLine({ ...home3, costPerKw: [65000, 55000] }, money, rate).includes('M55000–M65000 per kW'));
});

test('oldestAsOf: the OLDEST as_of across every cited field, as month and year', () => {
  assert.equal(oldestAsOf(B), 'Sep 2026');
  const older = { ...B, tariff: { ...B.tariff, as_of: '2025-03-04' } };
  assert.equal(oldestAsOf(older), 'Mar 2025');
  assert.ok(assumptionsLine({ ...home3, basis: older }, money, rate).endsWith('reference defaults as of Mar 2025'));
  const nested = { ...B, subsidy: { ...B.subsidy, society: { ...B.subsidy.society, as_of: '2024-12-01' } } };
  assert.equal(oldestAsOf(nested), 'Dec 2024');
  assert.throws(() => oldestAsOf({ ...B, tariff: { ...B.tariff, as_of: '!soon' } }), /unreadable as_of/);
  assert.equal(paybackText(TOO_SMALL, 25), 'Too small for a useful system');
});

test('flatCaveat: says surplus earns nothing for home and society, nothing for business', () => {
  const said = 'In West Bengal, power beyond your own yearly use earns nothing. Add your monthly units under "Use my bill" to see the payback on what you actually use.';
  assert.equal(flatCaveat('home', B), said);
  assert.equal(flatCaveat('society', B), said);
  assert.equal(flatCaveat('business', B), '');
  assert.equal(flatCaveat('home', paidBasis), '');
});

test('sizingText and surplusText', () => {
  assert.equal(sizingText(180, [2, 3]), 'PM Surya Ghar suggests 2–3 kW for 180 units a month');
  assert.equal(sizingText(400, [3, null]), 'PM Surya Ghar suggests above 3 kW for 400 units a month');
  assert.equal(sizingText(1, [1, 2]), 'PM Surya Ghar suggests 1–2 kW for 1 unit a month');
  assert.equal(surplusText(3, [0.2, 0.4], 8, paidBasis, rate),
    'At 3 kW about 20–40% of your generation is beyond your own yearly use, credited at R3.50 per kWh, not your R8.00 tariff.');
  assert.equal(surplusText(2.5, [0.2, 0.4], 8, B, rate),
    'At 2.5 kW about 20–40% of your generation is beyond your own yearly use. Under West Bengal\'s 2025 rooftop solar rules (WBERC), credit for it is set to zero at the end of each year and nothing is paid.');
  assert.ok(surplusText(3, [0.3, 0.3], 8, B, rate).includes('about 30% of'));
});

/* Every exported sentence, built from the LIVE shipped basis. */
const EVERY_SENTENCE = (() => {
  const roiLive = (over = {}) => roi({ basis: LIVE, ...over });
  const live3 = { ...home3, basis: LIVE };
  const r = roiLive();
  return [
    paybackText(r, 25), paybackText(roiLive({ owner: 'business', tariff: 0.5 }), 25), paybackText(TOO_SMALL, 25),
    paybackText({ status: 'ok', fast: sc(7), slow: sc(null) }, 25), paybackText({ status: 'ok', fast: sc(1), slow: sc(2) }, 25),
    savingText(r, money, 25), savingText({ status: 'ok', slow: sc(9, -1000), fast: sc(6, 5000) }, money, 25),
    savingText({ status: 'no_payback', slow: sc(null, -9), fast: sc(null, -2) }, money, 25),
    subsidyLine('home', 1, money), subsidyLine('society', 1, money), subsidyLine('business', 0, money),
    sizingText(180, [2, 3]), sizingText(400, [3, null]),
    surplusText(3, [0.2, 0.4], 8, paidBasis, rate), surplusText(3, [0.2, 0.4], 8, LIVE, rate),
    flatCaveat('home', LIVE), flatCaveat('society', LIVE), flatCaveat('business', LIVE),
    assumptionsLine(live3, money, rate),
    assumptionsLine({ ...live3, owner: 'business', sizeKw: 2, costPerKw: [1, 2], subsidy: 0, unitsPerMonth: 120 }, money, rate),
  ];
})();

test('BANNED_PAYBACK_WORDS matches what it must, and no sentence of any kind matches it', () => {
  for (const w of ['guaranteed', 'assured', 'ROI of 20%', 'returns', 'return']) assert.match(w, BANNED_PAYBACK_WORDS, w);
  for (const s of [...EVERY_SENTENCE, ESTIMATE_TAG]) assert.doesNotMatch(s, BANNED_PAYBACK_WORDS, s);
});

test('the tag is exact, and "quote" appears in no sentence but the tag', () => {
  assert.equal(ESTIMATE_TAG, 'screened · estimate, not a quote');
  for (const s of EVERY_SENTENCE) assert.doesNotMatch(s, /quot/i, s);
});
