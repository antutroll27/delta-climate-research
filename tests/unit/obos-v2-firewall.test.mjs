// tests/unit/obos-v2-firewall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const STAGE = readFileSync('src/components/ClimateEngine/HeatMapStage.astro', 'utf8');
const style = STAGE.slice(STAGE.indexOf('<style is:global>'), STAGE.indexOf('</style>'));
const WRAP = ':where(html:not([data-ui="v2"])) {';

test('v1 global CSS is fenced exactly once, with keyframes and @page hoisted out (spec §1.4)', () => {
  const at = style.indexOf(WRAP);
  assert.ok(at > 0, 'the :where(html:not([data-ui="v2"])) wrapper is missing');
  assert.equal(style.split(WRAP).length - 1, 1, 'the wrapper must appear exactly once');
  const inside = style.slice(at + WRAP.length);
  for (const name of ['tipIn', 'hmPulse', 'loadchip-sweep', 'entry-in', 'rn-in', 'rn-tip']) {
    const k = style.indexOf(`@keyframes ${name}`);
    assert.ok(k > 0 && k < at, `@keyframes ${name} must be hoisted above the wrapper`);
  }
  assert.ok(!/@page/.test(inside), '@page cannot nest; hoist it');
  assert.ok(/@media print\{\s*@page\{size:A4;margin:16mm\}\s*\}/.test(style.slice(0, at)), '@page must sit in a top-level @media print');
  for (const line of inside.split('\n')) {
    assert.ok(!/^\s*html[\s[.:]/.test(line), `a nested rule starts with html and would never match: ${line.trim()}`);
  }
  assert.ok(inside.includes('&[data-panel="collapsed"] .sidebar{display:none}'));
});

test('the BUILD flattened the fence (lightningcss include: Nesting, S0 audit F1)', () => {
  assert.ok(existsSync('dist/_astro'), 'run npm run build first');
  const files = readdirSync('dist/_astro').filter((f) => f.endsWith('.css'));
  const css = files.map((f) => readFileSync(`dist/_astro/${f}`, 'utf8')).find((c) => c.includes('--studio-ink-amber'));
  assert.ok(css, 'v1 stage CSS not found in dist');
  assert.match(css, /:where\(html:not\(\[data-ui=("?)v2\1\]\)\) \.stage\{/, 'flattened .stage rule missing');
  assert.ok(!/:where\(html:not\(\[data-ui=("?)v2\1\]\)\)\{/.test(css), 'an unflattened nesting block reached the browser');
  assert.ok(!/(^|[}{;,])\.stage\{--base:/.test(css), 'an un-fenced v1 .stage token rule reached the browser');
  assert.equal((css.match(/@keyframes tipIn/g) ?? []).length, 1);
  /* No stylesheet may ship native nesting (S0 audit F1): Chrome<112, Safari<16.5 and Firefox<117 drop it whole. */
  for (const f of files) {
    assert.ok(!/\{&|[,{]&[\s.[#:]/.test(readFileSync(`dist/_astro/${f}`, 'utf8')), `${f} ships native CSS nesting`);
  }
});
