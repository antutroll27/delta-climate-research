// tests/unit/obos-v2-sun-card.test.mjs — OBOS v2 spec §3.8, H12 (plan S4.1; the E4 pin lives in obos-v2-app-hooks.test.mjs since A1 S2.8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sunView } from '../../src/scripts/climate-engine/v2/sun-card.ts';

test('up: elevation figure, azimuth and set time, straight from the data attributes', () => {
  assert.deepEqual(sunView({ up: '1', az: '231', el: '45', sets: '17:46' }),
    { up: true, big: '45°', unit: 'up', line: '231° azimuth · sets 17:46', az: 231, el: 45 });
});
test('down: "Below horizon" and the rise time; no azimuth claimed', () => {
  assert.deepEqual(sunView({ up: '0', rises: '06:14' }),
    { up: false, big: 'Below', unit: 'horizon', line: 'rises 06:14', az: null, el: 0 });
});
test('no data yet: nothing is drawn', () => { assert.equal(sunView({}), null); });
test('a bad number is never drawn as a figure (no NaN on the card)', () => { assert.equal(sunView({ up: '1', az: 'x', el: '45', sets: '17:46' }), null); });

test('the card never parses the app\'s sentence, and types no figure of its own', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/sun-card.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/sunLineText|textContent\.match|\.split\(/.test(src.replace(/title/g, '')), 'sun-card.ts must read data-* only');
  assert.ok(!/sunLineText/.test(src));
});

test('H12: "geometry only" is the disclosure\'s own control, carries the app\'s #sunLineNote id, and its body is filled from the app\'s title', () => {
  const ms = readFileSync('src/components/ClimateEngine/v2/MapStack.astro', 'utf8');
  assert.match(ms, /<summary class="kind modelled" id="sunLineNote">geometry only<\/summary>/);
  assert.ok(ms.includes('data-sun="note"'));
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.ok(app.includes("sunNoteEl?.setAttribute('title'"), 'the app no longer writes the caveat as the note\'s title');
  assert.ok(readFileSync('src/scripts/climate-engine/v2/sun-card.ts', 'utf8').includes("note.getAttribute('title')"));
});

test('the app\'s sentence stays on the page for screen readers (#sunLine + #sunLineText, visually hidden), the visible lines are aria-hidden', () => {
  const ms = readFileSync('src/components/ClimateEngine/v2/MapStack.astro', 'utf8');
  assert.match(ms, /<p class="sunline sr-only" id="sunLine" hidden><span id="sunLineText"><\/span><\/p>/);
  assert.match(ms, /<p class="sun-s" data-sun="line" aria-hidden="true"><\/p>/);
});

test('the scale bar is MapLibre\'s own control, moved into the card; no static "100 m" is drawn', () => {
  const ms = readFileSync('src/components/ClimateEngine/v2/MapStack.astro', 'utf8');
  assert.ok(ms.includes('data-v2-scale-slot'));
  assert.ok(!/100 m/.test(ms), 'the preview\'s static 100 m must not be copied');
  assert.match(readFileSync('src/scripts/climate-engine/v2/sun-card.ts', 'utf8'), /maplibregl-ctrl-scale/);
});

test('rc3: the scale bar has five quarter ticks drawn from tokens, and its label sits above the bar', () => {
  const ms = readFileSync('src/components/ClimateEngine/v2/MapStack.astro', 'utf8');
  assert.match(ms, /<div class="scale-ticks" aria-hidden="true">(<i><\/i>){5}<\/div>/);
  const css = readFileSync('src/styles/obos-v2/screens/mapstack.css', 'utf8');
  const bar = css.slice(css.indexOf('.scale {'), css.indexOf('/* ── the Ward card ── */'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/.test(bar), 'no colour literal in the scale bar CSS');
  for (const n of [1, 2, 3, 4, 5]) assert.ok(bar.includes(`.scale-ticks > i:nth-child(${n})`), `tick ${n} is placed`);
  for (const l of ['0', '25%', '50%', '75%', '100%']) assert.ok(bar.includes(`left: ${l}`), `a tick at ${l}`);
  assert.match(bar, /--scale-gap: 7px/);
  assert.match(bar, /margin: 0 0 var\(--scale-gap\)/);
});
