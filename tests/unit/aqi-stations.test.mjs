// tests/unit/aqi-stations.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AREAS, stationFor, stationPayload } from '../../src/lib/aqi/stations.ts';
import { allWards } from '../../src/data/cities.ts';

/* _types.py ward_bounds, restated: the square OBOS reads is built with this spherical factor. */
const mPerDeg = (lat) => [111_320 * Math.cos((lat * Math.PI) / 180), 110_540];
const havM = (a, b, c, d) => { const R = 6_371_008.8, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

test('every Kolkata area is registered, Baruipur deliberately without a station', () => {
  assert.deepEqual(Object.keys(AREAS).sort(), ['in/kolkata/ballygunge', 'in/kolkata/barrackpore', 'in/kolkata/baruipur']);
  assert.equal(stationFor('in/kolkata/baruipur'), null);
});

/* THE HONEST STATUS, TESTED FROM THE COORDINATES. A monitor either stands inside its
   area's 3 km window, and says `window_3km`, or it does not, and says `outside_window`
   with where it stands. The status is DERIVED here from the station's own position
   and compared with what the registry declares, so neither half can drift: moving an
   area's centre (Ballygunge became KMC Ward 68 on 2026-10-02) turns a stale claim into
   a failure here, and the fix is the honest label, never a wider window. */
test('each station declares where it stands against its area\'s 3 km window, at the distance it claims', () => {
  for (const [key, st] of Object.entries(AREAS)) {
    if (!st) continue;
    const w = allWards().find((x) => x.id === key.split('/')[2]);
    const [mx, my] = mPerDeg(w.lat);
    const inWindow = Math.abs(st.lon - w.lon) * mx <= 1500 && Math.abs(st.lat - w.lat) * my <= 1500;
    assert.equal(st.inside, inWindow ? 'window_3km' : 'outside_window',
      `${key}: the station is ${inWindow ? 'inside' : 'outside'} the 3 km window but declares ${st.inside}`);
    if (inWindow) assert.equal(st.placement, null, `${key}: a monitor inside the window carries no placement note`);
    else assert.ok(typeof st.placement === 'string' && st.placement.length > 0, `${key}: a monitor outside the window must say where it stands`);
    assert.ok(Math.abs(havM(w.lat, w.lon, st.lat, st.lon) - st.distance_m) <= 10, `${key}: distance_m disagrees with the coordinates`);
    /* What the wire carries is what the registry declares, by the one builder every path uses. */
    const wire = stationPayload(st);
    assert.equal(wire.inside, st.inside, `${key}: the payload asserts a different status from the registry`);
    assert.equal(wire.distance_m, st.distance_m);
    if (st.inside === 'outside_window') assert.equal(wire.placement, st.placement);
    else assert.ok(!('placement' in wire), `${key}: an inside monitor's payload carries a placement`);
  }
});

test('Ballygunge keeps the WBPCB monitor as its nearest official one, labelled outside Ward 68; Barrackpore\'s SVSPA stays inside', () => {
  /* Founder, 2026-10-03: KEEP the monitor and say what it is. Pinned by value, so a
     future "fix" that drops it, widens the window or quietly restores the old
     993 m / window_3km claim fails here by name. */
  const b = stationFor('in/kolkata/ballygunge');
  assert.equal(b.id, 'openaq:10918');
  assert.equal(b.inside, 'outside_window');
  assert.match(b.placement, /Ward 69/);
  assert.match(b.placement, /outside Ward 68/);
  assert.ok(b.distance_m > 1500 && b.distance_m < 1700, `Ballygunge's monitor is ${b.distance_m} m away, not the old 993`);
  const r = stationFor('in/kolkata/barrackpore');
  assert.equal(r.id, 'openaq:3409509');
  assert.equal(r.inside, 'window_3km');
  assert.equal(r.distance_m, 995);
});

test('no sensor is declared in ppb: units come from verification, never from OpenAQ labels', () => {
  for (const st of Object.values(AREAS)) {
    if (!st) continue;
    for (const s of Object.values(st.sensors)) assert.ok(s.unit === 'ug_m3' || s.unit === 'mg_m3');
    assert.equal(st.sensors.co.unit, 'mg_m3');
  }
});

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

test("each station's CPCB name is in CPCB's feed, within 100 m of the registered position", () => {
  const xml = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');
  for (const [key, st] of Object.entries(AREAS)) {
    if (!st) continue;
    const m = new RegExp(`<Station id="${st.cpcb_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*latitude="([\\d.]+)" longitude="([\\d.]+)"`).exec(xml);
    assert.ok(m, `${key}: "${st.cpcb_name}" not in the feed`);
    assert.ok(havM(st.lat, st.lon, Number(m[1]), Number(m[2])) <= 100, `${key}: feed position is more than 100 m from the registry`);
  }
});
