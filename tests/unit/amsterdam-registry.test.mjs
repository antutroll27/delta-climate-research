import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES, wardsOfCity } from '../../src/data/cities.ts';
import { RENDERABLE_CITIES, RENDERABLE_WARDS, WARDS } from '../../src/data/wards.ts';
import { REGISTRY, AREA_KEYS, assertRegistryLogic } from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { requireGrid } from '../../src/scripts/climate-engine/types.ts';

/* AMSTERDAM, PHASE A TASK A2. Registered and nameable; NOT drawable, NOT published.
   Everything below is a fact about the registry entry, so the later tasks (A3
   front-end generalisations, A12 drawable flip) cannot move it without a test
   saying so. */

const KEY = 'nl/amsterdam/canal-ring';
const city = REGISTRY.nl.cities.amsterdam;

test('Amsterdam is one ward on the admitted 2,800 m / 384-cell pair', () => {
  const wards = wardsOfCity('amsterdam');
  assert.equal(wards.length, 1);
  const w = wards[0];
  assert.equal(w.id, 'canal-ring');
  assert.equal(w.footprintM, 2800);
  assert.equal(requireGrid(2800).n, 384);
  assert.equal(w.lat, 52.364);
  assert.equal(w.lon, 4.885);
  assert.ok(Math.abs(CITIES.amsterdam.cellMeters - 2800 / 384) < 1e-9);
});

test('the registry entry says what is known: Cfb, geometry tier, Europe/Amsterdam', () => {
  assert.ok(AREA_KEYS.includes(KEY));
  assert.equal(REGISTRY.nl.name, 'Netherlands');
  assert.equal(REGISTRY.nl.pathway, null);
  assert.equal(REGISTRY.nl.costs, null, 'no euro figure until the founder sources one (plan Q1)');
  assert.equal(city.koppen, 'Cfb');
  assert.equal(city.tier, 'geometry');
  assert.equal(city.tz, 'Europe/Amsterdam');
  assert.deepEqual(city.data, { heatwave: null, dcUrs: null });
  assertRegistryLogic();
});

test('it is not drawable and not published yet (flips in A12, not here)', () => {
  const area = city.areas['canal-ring'];
  assert.equal(area.shipsData, false);
  assert.equal(area.drawable, false);
  assert.ok(!RENDERABLE_CITIES.includes('amsterdam'));
  assert.ok(!RENDERABLE_WARDS.some((w) => w.id === 'canal-ring'));
  assert.ok(!WARDS.some((w) => w.id === 'canal-ring'));
  assert.equal(CITIES.amsterdam.since, undefined, '`since` belongs in the release commit only (plan A13)');
  assert.equal(CITIES.amsterdam.showcase, undefined);
});

test('KNMI Schiphol 1991-2020 normals: twelve months, max above min, hottest in July', () => {
  const n = city.airNormals;
  assert.equal(n.measured, true);
  assert.equal(n.period, '1991–2020');
  assert.match(n.source, /bron: KNMI/);
  assert.equal(n.maxC.length, 12);
  assert.equal(n.minC.length, 12);
  for (let m = 0; m < 12; m++) assert.ok(n.maxC[m] > n.minC[m], `month ${m + 1}`);
  assert.equal(Math.max(...n.maxC), n.maxC[6]);
  assert.equal(Math.min(...n.minC), n.minC[1]); // 1.0 °C, February, as KNMI prints it
  /* the table's own annual mean temperature is 10.7 °C; the mean of the monthly
     (max+min)/2 is within a few tenths of it (it is not the same statistic) */
  const mean = n.maxC.reduce((a, b, i) => a + (b + n.minC[i]) / 2, 0) / 12;
  assert.ok(Math.abs(mean - 10.7) < 0.4, `mean of monthly mid-ranges ${mean.toFixed(2)}`);
});

test('resolve names the area from the registry while it is not renderable', () => {
  const s = resolve(KEY);
  assert.equal(s.tier, 'geometry');
  assert.equal(s.city.tz, 'Europe/Amsterdam');
  assert.equal(s.city.koppen, 'Cfb');
  assert.equal(s.area.name, 'Canal Ring');
  assert.equal(s.climate.costs, null);
  assert.deepEqual(s.pathway.options, [], 'no warming pathway: an empty control, not a zero table');
});

test('the temporary registry name is deleted the day the area becomes renderable', () => {
  const area = city.areas['canal-ring'];
  if (RENDERABLE_CITIES.includes('amsterdam')) {
    assert.ok(!('name' in area) && !('descriptor' in area),
      'resolve refuses an area that names itself in both registry.ts and src/data/wards.ts');
  } else {
    assert.equal(area.name, 'Canal Ring');
  }
});

/* The first DST zone in the registry. 2027-03-28 01:00 UTC is the spring-forward
   instant (last Sunday of March) and 2027-10-31 01:00 UTC the fall-back one. */
function hm(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: city.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).format(new Date(iso));
}
test('Europe/Amsterdam springs forward and falls back at the right UTC instants', () => {
  assert.match(hm('2027-03-28T00:30:00Z'), /^01:30 (CET|GMT\+1)$/);
  assert.match(hm('2027-03-28T01:30:00Z'), /^03:30 (CEST|GMT\+2)$/);
  assert.match(hm('2027-10-31T00:30:00Z'), /^02:30 (CEST|GMT\+2)$/);
  assert.match(hm('2027-10-31T01:30:00Z'), /^02:30 (CET|GMT\+1)$/);
});

/* RED BY DESIGN once Task A8 lands: `veg` is a 0 placeholder until the Sentinel-2
   fractional vegetation cover is measured over the footprint. `todo` keeps the run
   green today and prints the debt on every run; A8 must replace the value and drop
   the `todo` option. */
test('veg is a measured Sentinel-2 FVC, not the A2 placeholder', { todo: 'A8 measures it' }, () => {
  const veg = wardsOfCity('amsterdam')[0].veg;
  assert.ok(veg > 0 && veg < 1, `veg is ${veg}`);
});
