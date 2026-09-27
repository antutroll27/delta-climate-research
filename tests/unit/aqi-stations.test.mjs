// tests/unit/aqi-stations.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AREAS, stationFor } from '../../src/lib/aqi/stations.ts';
import { allWards } from '../../src/data/cities.ts';

/* _types.py ward_bounds, restated: the square OBOS reads is built with this spherical factor. */
const mPerDeg = (lat) => [111_320 * Math.cos((lat * Math.PI) / 180), 110_540];
const havM = (a, b, c, d) => { const R = 6_371_008.8, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

test('every Kolkata area is registered, Baruipur deliberately without a station', () => {
  assert.deepEqual(Object.keys(AREAS).sort(), ['in/kolkata/ballygunge', 'in/kolkata/barrackpore', 'in/kolkata/baruipur']);
  assert.equal(stationFor('in/kolkata/baruipur'), null);
});

test('each station lies inside its area\'s 3 km window, at the distance it claims', () => {
  for (const [key, st] of Object.entries(AREAS)) {
    if (!st) continue;
    const w = allWards().find((x) => x.id === key.split('/')[2]);
    const [mx, my] = mPerDeg(w.lat);
    assert.ok(Math.abs(st.lon - w.lon) * mx <= 1500 && Math.abs(st.lat - w.lat) * my <= 1500, `${key}: station outside the 3 km window`);
    assert.ok(Math.abs(havM(w.lat, w.lon, st.lat, st.lon) - st.distance_m) <= 10, `${key}: distance_m disagrees with the coordinates`);
  }
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
