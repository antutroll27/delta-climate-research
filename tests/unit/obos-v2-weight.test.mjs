// tests/unit/obos-v2-weight.test.mjs — FINAL audit F5: a flag-off (v1) page carries NO v2 byte. Reads the built dist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = ['heat-map/in/kolkata/ballygunge', 'heat-map/in/bengaluru/mg-road', 'heat-map/ae/dubai/al-quoz', 'heat-map/compare', 'heat-map/brief'];
const built = () => assert.ok(existsSync('dist/_astro') && existsSync('dist/obos-v2/obos-v2.css'), 'run npm run build first');

test('no flag-off page links a v2 stylesheet or carries a v2 template or v2 markup', () => {
  built();
  for (const p of PAGES) {
    const html = readFileSync(`dist/${p}/index.html`, 'utf8');
    assert.ok(!html.includes('obos-v2-tree'), `${p}: v2 template`);
    assert.ok(!/class="[^"]*\bobos-v2\b/.test(html), `${p}: v2 markup`);
    for (const m of html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)) {
      assert.ok(!readFileSync(`dist${m[1]}`, 'utf8').includes('.obos-v2'), `${p}: ${m[1]} carries v2 rules`);
    }
  }
});

test('no bundled stylesheet in dist/_astro carries v2 rules (the v2 sheet is the one served file)', () => {
  built();
  for (const f of readdirSync('dist/_astro').filter((x) => x.endsWith('.css'))) {
    assert.ok(!readFileSync(join('dist/_astro', f), 'utf8').includes('.obos-v2'), `${f} carries v2 rules`);
  }
});

test('the served v2 stylesheet is self-contained (no @import left) and carries the v2 rules', () => {
  built();
  const css = readFileSync('dist/obos-v2/obos-v2.css', 'utf8');
  assert.ok(!/@import/.test(css), 'an @import survived');
  assert.ok(css.includes('.obos-v2') && css.includes('--heat-5'), 'the v2 tokens and rules are in it');
  assert.ok(!css.includes('--studio-ink-amber'), 'v1 rules leaked into the v2 sheet');
});

test('every area has its tree file, and compare and brief have theirs; each holds exactly one v2 root and no script', () => {
  built();
  const files = ['compare.html', 'brief.html', 'area/in/kolkata/ballygunge.html', 'area/in/bengaluru/mg-road.html', 'area/ae/dubai/al-quoz.html'];
  for (const f of files) {
    const t = readFileSync(`dist/obos-v2/${f}`, 'utf8');
    assert.equal((t.match(/<main id="main"/g) ?? []).length, 1, f);
    assert.ok(/class="[^"]*\bobos-v2\b/.test(t), f);
    assert.ok(!/<script/i.test(t), `${f}: a script in a tree set through innerHTML would never run`);
  }
});
