// tests/unit/obos-v2-symbols.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_PATH, SYMBOL_HEX, AQ_HEX, symbolCssVars, symSvg, heatClass } from '../../src/scripts/climate-engine/v2/symbols.ts';

test('shapes are the preview table, verbatim', () => {
  assert.deepEqual(Object.keys(SHAPE_PATH).sort(), ['bar', 'bowl', 'disc', 'dome', 'quarter', 'square', 'ward']);
  assert.equal(SHAPE_PATH.ward, 'M50 2 94 27v46L50 98 6 73V27Z');
});

test('kind alone decides solid vs outlined', () => {
  const solid = symSvg('square', 'ink', 'measured', 14);
  const outlined = symSvg('square', 'ink', 'modelled', 14);
  assert.match(solid, /fill="var\(--ink-1\)"/);
  assert.ok(!/stroke-dasharray/.test(solid));
  assert.match(outlined, /fill="none"[^>]*stroke="var\(--ink-1\)"[^>]*stroke-dasharray="5 4"/);
  assert.match(outlined, /vector-effect="non-scaling-stroke"/);
  assert.match(solid, /width="14" height="14"/);
  assert.match(solid, /aria-hidden="true"/);
});

test('light fills get an ink keyline', () => {
  for (const c of ['solar', 'aq-moderate', 'aq-satisfactory']) assert.match(symSvg('disc', c, 'measured', 10), /class="f sym-keyline"/);
  assert.ok(!/sym-keyline/.test(symSvg('disc', 'water', 'measured', 10)));
});

test('css vars carry every symbol and AQ colour once, and never --sym-green itself (the theme maps it)', () => {
  const v = symbolCssVars();
  for (const [k, hex] of Object.entries(SYMBOL_HEX)) assert.ok(v.includes(`--sym-${k}:${hex}`), k);
  for (const [k, hex] of Object.entries(AQ_HEX)) assert.ok(v.includes(`--aq-${k}:${hex}`), k);
  assert.ok(!/--sym-green:/.test(v));
  const hexes = v.match(/#[0-9a-fA-F]{6}/g);
  assert.equal(new Set(hexes.map((h) => h.toLowerCase())).size, hexes.length, 'a colour is spelled twice');
});

test('the only violet is AQ severe', () => {
  const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return { h: 0, s: 0 };
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
  };
  const violets = [...Object.entries(SYMBOL_HEX), ...Object.entries(AQ_HEX)].filter(([, x]) => { const { h, s } = hue(x); return h >= 260 && h <= 320 && s > 0.25; });
  assert.deepEqual(violets.map(([k]) => k), ['severe']);
});

test('heatClass mirrors lstColor thresholds (heat-map-app.ts:3153)', () => {
  assert.equal(heatClass(32.9), 'heat-1');
  assert.equal(heatClass(33), 'heat-3');
  assert.equal(heatClass(37), 'heat-4');
  assert.equal(heatClass(40), 'heat-5');
  assert.equal(heatClass(Number.NaN), 'heat-1');
});
