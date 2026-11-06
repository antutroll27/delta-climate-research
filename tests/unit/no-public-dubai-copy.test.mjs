import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * NO PUBLISHED COPY NAMES DUBAI. The companion to no-public-dubai.test.mjs, which
 * covers the routes: this one scans the markup and the copy modules the pages
 * render (landing section, attribution page, standards matrix, licence table).
 * Comments are stripped first -- a comment is not published, and the code
 * legitimately explains why Dubai is registered.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const BANNED = /dubai|\/ae\/|\bwsf3d\b|\buae\b|united arab emirates/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* `//` only counts at a line start or after whitespace, so `https://` survives. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

test('no published markup or copy module names Dubai', () => {
  const hits = [];
  const roots = ['src/pages', 'src/components', 'src/layouts', 'src/data', 'src/scripts/standards'];
  for (const dir of roots) {
    for (const f of walk(join(ROOT, dir))) {
      if (!/\.(astro|ts|tsx|json)$/.test(f)) continue;
      const code = stripComments(readFileSync(f, 'utf8'));
      const m = BANNED.exec(code);
      if (m) hits.push(`${relative(ROOT, f)}: "${m[0]}"`);
    }
  }
  assert.deepEqual(hits, [], 'Dubai text reaches a published surface');
});

