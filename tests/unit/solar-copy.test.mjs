import assert from 'node:assert/strict';
import test from 'node:test';

import { wardSummary, validatedSentence, noteFor } from '../../src/scripts/climate-engine/solar-copy.ts';

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
