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

/* ── brainstorm 04 (20 Oct): the on-map building card. The app's side of the seam is small and v1-neutral: with no sink every v1 line runs as it did. ── */
test('E6: placeCard hands the roof\'s apex to the card sink and stops there; v1\'s own card placement is still the next statement when there is no sink', () => {
  const fn = app.slice(app.indexOf('function placeCard'), app.indexOf('/* ── the tag\'s entrance'));
  assert.match(fn, /const cardBox: CardBox \| null = bcard\.hasAttribute\('hidden'\) \? null : sink \? sink\.box\(\) : bcard\.getBoundingClientRect\(\);/, 'the map labels read the sink\'s cached box in v2 (no per-frame card measure), v1\'s rect otherwise');
  assert.match(fn, /if \(sink\) \{[\s\S]*?sink\.place\(p\.w > 0 \? \{ x: p\.x \+ cvBox\.left, y: p\.y \+ cvBox\.top \} : null, !!relief\);[\s\S]*?return;\s*\}\s*if \(p\.w <= 0\) \{ bcard\.style\.opacity = '0'; bsel\.style\.opacity = '0'; return; \}/);
  assert.match(fn, /bcard\.style\.transform = `translate3d\(\$\{Math\.round\(dx\)\}px, \$\{Math\.round\(cy\)\}px, 0\) translateY\(-50%\)`;/, 'v1\'s placement is untouched');
  assert.match(fn, /const leadBox = sink\?\.lead\(\);/, 'the lead line is a keep-out for the tag and the ring labels');
});

test('E7: a roof row lands where the card has room (v2 only); v1\'s ease is the same statement; one Esc, one thing in v2', () => {
  assert.match(app, /if \(cardSink\.current\) \{ easeRowToFreeGround\(b, ll\); return; \}\s*nudgeOrbit\(\);\s*map\.easeTo\(\{ center: \[ll\.lon, ll\.lat\], duration: reduceMotion \? 0 : 700, essential: true \}\);/);
  assert.match(app, /map\.easeTo\(\{ center: \[ll\.lon, ll\.lat\], \.\.\.\(to \? \{ offset: \[to\.x - w \/ 2, to\.y \+ lift - h \/ 2\] as \[number, number\] \} : \{\}\)/, 'the offset puts the apex (not the ground) on the free spot');
  const esc = app.slice(app.indexOf('const onPickKey'), app.indexOf("el('bcX')?.addEventListener"));
  assert.match(esc, /if \(cardSink\.current\) \{[\s\S]*?closeBrief\(\); return; \}[\s\S]*?closeStreetView\(\); return; \}[\s\S]*?if \(selected\) select\(null\);\s*return;\s*\}\s*closeBrief\(\);/, 'v2: the brief, then the street view, then the card; v1\'s three-in-one is the code after it');
});

test('E8: the card reads one lat/lon line in v2 (it is wide enough) and the old two-line form in v1; the tag\'s metres are the card\'s in v2 only', () => {
  assert.match(app, /formatLatLon\(ll\.lat, ll\.lon, cardSink\.current \? ' · ' : '<br>'\)/);
  assert.match(app, /popCoolTag\(walkRoundM\(nearestCool\.distM\)\)/); // founder 20 Oct: v1 drops its `|| 10` floor too
});
