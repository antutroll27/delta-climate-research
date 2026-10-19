// rc3: the rail's geometry has ONE source (tokens.css). Everything beside the rail reads it; no stylesheet writes a rail-relative literal again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/styles/obos-v2';
const files = [DIR, join(DIR, 'screens')].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.css')).map((f) => join(d, f)));
const css = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));
const tokens = css[join(DIR, 'tokens.css')];

test('the expanded rail width is written once, as a token, between 176 and 184 px', () => {
  const m = [...tokens.matchAll(/--rail-w:\s*(\d+)px/g)];
  assert.equal(m.length, 1);
  const w = Number(m[0][1]);
  assert.ok(w >= 176 && w <= 184, `--rail-w is ${w}`);
  for (const [f, s] of Object.entries(css)) assert.ok(!/\b220px\b/.test(s), `${f}: the old 220 px rail width is back`);
});

test('no stylesheet writes a rail-relative offset by hand (they were 252, 568, 416, 884, 564, 732, 148 px before)', () => {
  const stale = /\b(252|568|416|884|564|732|712|864|544|396|468|316|148|152)px\b/;
  for (const [f, s] of Object.entries(css)) {
    /* comments may name the old numbers; code may not */
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '');
    const hit = code.split('\n').find((l) => stale.test(l) && /\b(left|right|translateX|--cmp-l|--ctr|--brf-l|--ms-left)\b/.test(l));
    assert.equal(hit, undefined, `${f}: ${hit}`);
  }
});

test('the columns derive from the tokens: panel, title column, toasts, stack, dock, Compare and the brief', () => {
  const shell = css[join(DIR, 'shell.css')];
  assert.match(shell, /\.side-panel \{[^}]*left: var\(--col-x\)/);
  assert.match(shell, /\.st-title \{[^}]*left: var\(--col-icons\)/);
  assert.match(shell, /\.toasts \{[^}]*left: calc\(var\(--lead\) \+ var\(--title-w\) \+ 16px\)/);
  assert.match(shell, /\.st-dock \{ left: var\(--lead\)/);
  assert.match(css[join(DIR, 'screens/mapstack.css')], /\.mapstack \{[^}]*left: var\(--lead\)/);
  assert.match(css[join(DIR, 'screens/scenarios.css')], /--ctr: var\(--lead\)/);
  assert.match(css[join(DIR, 'screens/compare.css')], /--cmp-l: var\(--col-x-side\)/);
  assert.match(css[join(DIR, 'screens/brief.css')], /--brf-l: var\(--col-x\)/);
  assert.match(shell, /clip-path: inset\(0 calc\(var\(--rail-w\) - var\(--rail-w-icons\)\) 0 0 round 22px\)/);
});

test('the rail header\'s air is one token (12-16 px), read by the header and nothing else', () => {
  const m = [...tokens.matchAll(/--rail-head-gap:\s*(\d+)px/g)];
  assert.equal(m.length, 1);
  assert.ok(Number(m[0][1]) >= 12 && Number(m[0][1]) <= 16);
  assert.match(css[join(DIR, 'shell.css')], /\.rail-brand \{[^}]*margin-bottom: var\(--rail-head-gap\);/);
});
