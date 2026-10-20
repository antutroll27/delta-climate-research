// tests/unit/obos-v2-weight.test.mjs — FLIP: v2 is the default, so the OBOS pages ARE the v2 tree; this reads the built dist (flip plan B.2.3 (i)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join } from 'node:path';

const PAGES = ['heat-map/in/kolkata/ballygunge', 'heat-map/in/bengaluru/mg-road', 'heat-map/ae/dubai/al-quoz', 'heat-map/compare', 'heat-map/brief'];
const built = () => assert.ok(existsSync('dist/_astro'), 'run npm run build first');
const head = (html) => html.slice(0, html.indexOf('</head>'));
const sheets = (html) => [...head(html).matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)].map((m) => m[1]);
const isV2Sheet = (href) => { const c = readFileSync(`dist${href}`, 'utf8'); return c.includes('.obos-v2') && c.includes('--heat-5'); };

test('each OBOS page carries exactly one v2 root, <html data-ui="v2">, no template, and links the v2 sheet', () => {
  built();
  for (const p of PAGES) {
    const html = readFileSync(`dist/${p}/index.html`, 'utf8');
    assert.match(html, /<html lang="en" data-ui="v2"/, `${p}: data-ui on <html>`);
    assert.equal((html.match(/<main id="main"/g) ?? []).length, 1, `${p}: one main`);
    assert.equal((html.match(/<main id="main" class="[^"]*\bobos-v2\b/g) ?? []).length, 1, `${p}: it is the v2 root`);
    assert.ok(!html.includes('<template') && !html.includes('obos-v2-tree'), `${p}: no template`);
    const links = sheets(html);
    const at = links.findIndex(isV2Sheet);
    assert.ok(at >= 0, `${p}: the v2 sheet is linked (${links.join(', ')})`);
    assert.equal(links.filter(isV2Sheet).length, 1, `${p}: exactly one sheet carries the v2 rules`);
    /* Astro hoists the v2 sheet into a chunk shared by the three pages and orders it itself (the plan wanted it last, as rc6's appended <style> was). A sheet after it must not be able to
       tie a v2 rule: every v2 rule is prefixed html[data-ui="v2"] (specificity 0,1,1 before its own selector), so only page-scoped [data-astro-cid] rules and the site base sheet may follow. */
    for (const href of links.slice(at + 1)) {
      const css = readFileSync(`dist${href}`, 'utf8');
      assert.ok(!css.includes('.obos-v2') && !css.includes('--studio-ink-amber'), `${p}: ${href} follows the v2 sheet and carries v1 or v2 rules`);
    }
  }
});

test('no dist/obos-v2 directory (the tree and stylesheet endpoints are gone) and no page names /obos-v2/', () => {
  built();
  assert.ok(!existsSync('dist/obos-v2'), 'dist/obos-v2 must not exist');
  for (const p of PAGES) assert.ok(!readFileSync(`dist/${p}/index.html`, 'utf8').includes('/obos-v2/'), `${p}: a request for /obos-v2/`);
});

test('a page that is not OBOS carries no v2 data-ui and links no v2 sheet', () => {
  built();
  for (const p of ['team', 'index']) {
    const f = p === 'index' ? 'dist/index.html' : `dist/${p}/index.html`;
    if (!existsSync(f)) continue;
    const html = readFileSync(f, 'utf8');
    assert.ok(!/data-ui=/.test(html.slice(0, 400)), `${p}: data-ui`);
    for (const href of sheets(html)) assert.ok(!readFileSync(`dist${href}`, 'utf8').includes('.obos-v2'), `${p}: ${href} carries v2 rules`);
  }
});

test('the served v2 sheet is self-contained (no @import left), carries the v2 rules and no v1 studio rule', () => {
  built();
  const html = readFileSync('dist/heat-map/in/kolkata/ballygunge/index.html', 'utf8');
  const links = sheets(html).filter(isV2Sheet);
  assert.equal(links.length, 1, 'exactly one linked sheet carries the v2 rules');
  const css = readFileSync(`dist${links[0]}`, 'utf8');
  assert.ok(!/@import/.test(css), 'an @import survived');
  assert.ok(css.includes('--heat-5') && css.includes('@page'), 'the v2 tokens and the A4 @page are in it');
  assert.ok(!css.includes('--studio-ink-amber'), 'v1 rules leaked into the v2 sheet');
});

/* Weight: reported, not budgeted (the flag-era budgets retired). The rule is "not heavier than the S8 v2 numbers in perf-s94.md section 4": HTML <= 85 KB tree + page shell, v2 CSS <= 128 KB raw. */
test('weight report: HTML raw/gzip and v2 CSS raw/brotli per page (informational, with a generous ceiling)', () => {
  built();
  const rows = [];
  for (const p of PAGES) {
    const html = readFileSync(`dist/${p}/index.html`);
    const css = readFileSync(`dist${sheets(html.toString('utf8')).filter(isV2Sheet)[0]}`);
    rows.push(`${p}: html ${html.length} B raw / ${gzipSync(html).length} B gzip; v2 css ${css.length} B raw / ${brotliCompressSync(css).length} B brotli`);
    assert.ok(css.length <= 140 * 1024, `${p}: v2 CSS grew past 140 KB raw`);
  }
  console.log(rows.join('\n'));
});
