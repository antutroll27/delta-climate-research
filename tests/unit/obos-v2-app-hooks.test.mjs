// tests/unit/obos-v2-app-hooks.test.mjs — OBOS v2 spec §0.2 E4, E5 (landed in S2.8 by plan amendment A1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');

test('E4: writeSunLine publishes the same placement it prints, and nothing else changed', () => {
  const fn = app.slice(app.indexOf('function writeSunLine'), app.indexOf('const onCompass'));
  assert.match(fn, /sunLineEl\.dataset\.up = sun\.placement\.up \? '1' : '0';/);
  assert.match(fn, /sunLineEl\.dataset\.az = String\(Math\.round\(sun\.placement\.azimuthDeg\)\);/);
  assert.match(fn, /sunLineEl\.dataset\.el = String\(Math\.round\(sun\.placement\.elevationDeg\)\);/);
  assert.match(fn, /sunLineEl\.dataset\.sets = hhmm\(day\.sunset\);/);
  assert.match(fn, /sunLineEl\.dataset\.rises = hhmm\(day\.sunrise\);/);
  assert.match(fn, /`sun \$\{Math\.round\(sun\.placement\.azimuthDeg\)\}° · \$\{Math\.round\(sun\.placement\.elevationDeg\)\}° up · sets \$\{hhmm\(day\.sunset\)\}`/);
});

test('E5: paintWeatherLine publishes the observation it painted, and only adds', () => {
  const fn = app.slice(app.indexOf('function paintWeatherLine'), app.indexOf('function paintLive'));
  assert.match(fn, /document\.dispatchEvent\(new CustomEvent\('obos:observed', \{ detail: \{ observed, reports: /);
});
