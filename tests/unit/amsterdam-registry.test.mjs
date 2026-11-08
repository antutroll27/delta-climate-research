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

test('Amsterdam is Canal Ring first, then the 31 streamed areas, every one on the admitted 2,800 m / 384-cell pair', () => {
  const wards = wardsOfCity('amsterdam');
  /* city-streaming P2c: the other 31 areas are ward-table rows too (src/data/sheets/amsterdam-areas.ts, generated). Canal Ring stays first because
     `wards[0]` sets the city's declared resolution and is the showcase. */
  assert.equal(wards.length, 32);
  assert.ok(wards.every((x) => x.footprintM === 2800), 'every area is the 2,800 m square');
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

test('it is drawable (A12) and released (A13) but not published: noindex, out of the sitemap, no catalogue record', () => {
  const area = city.areas['canal-ring'];
  assert.equal(area.shipsData, false);
  assert.equal(area.drawable, true);
  assert.ok(RENDERABLE_CITIES.includes('amsterdam'));
  assert.ok(RENDERABLE_WARDS.some((w) => w.id === 'canal-ring'));
  assert.ok(!WARDS.some((w) => w.id === 'canal-ring'), 'the CATALOGUE (WARDS) does not list it: it publishes nothing');
  assert.equal(CITIES.amsterdam.since, '2026-11-07', 'released by the A13 commit');
  assert.equal(CITIES.amsterdam.showcase, 'canal-ring');
  assert.equal(area.shipsData, false, 'released and announced, but not indexed: the same rule Bengaluru launched under');
});

test('the area names itself ONCE: the temporary registry name and descriptor are gone', () => {
  const area = city.areas['canal-ring'];
  assert.equal('name' in area, false);
  assert.equal('descriptor' in area, false);
  const scope = resolve(KEY);
  assert.equal(scope.area.name, 'Canal Ring');
  assert.equal(scope.area.hasData, true);
  assert.equal(scope.area.publishes, false);
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

/* `veg` was a 0 placeholder until Task A8 measured the Sentinel-2 fractional vegetation
   cover (surface-meta.json `fvc_mean`); the equality test lives in amsterdam-artefacts.test.mjs. */
test('veg is no longer the A2 placeholder', () => {
  assert.ok(wardsOfCity('amsterdam')[0].veg > 0);
});
