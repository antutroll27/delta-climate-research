import assert from 'node:assert/strict';
import test from 'node:test';

import { wardSummary, validatedSentence, noteFor, sharePct } from '../../src/scripts/climate-engine/solar-copy.ts';

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
