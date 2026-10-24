// tests/unit/obos-v2-firewall.test.mjs — what the BUILD ships (v1's stage CSS and its fence are deleted; PR 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

test('the BUILD ships no native CSS nesting, and no v1 stage CSS (the v1 UI source is deleted)', () => {
  assert.ok(existsSync('dist/_astro'), 'run npm run build first');
  const files = readdirSync('dist/_astro').filter((f) => f.endsWith('.css'));
  assert.ok(files.length > 0, 'no stylesheet was built');
  /* No stylesheet may ship native nesting (S0 audit F1): Chrome<112, Safari<16.5 and Firefox<117 drop it whole. */
  for (const f of files) {
    const css = readFileSync(`dist/_astro/${f}`, 'utf8');
    assert.ok(!/\{&|[,{]&[\s.[#:]/.test(css), `${f} ships native CSS nesting`);
    assert.ok(!css.includes('--studio-ink-amber'), `${f} carries the v1 stage CSS, which is deleted`);
    assert.ok(!css.includes(':where(html:not([data-ui="v2"]))') && !css.includes(':where(html:not([data-ui=v2]))'), `${f} carries the v1 CSS fence`);
  }
});
