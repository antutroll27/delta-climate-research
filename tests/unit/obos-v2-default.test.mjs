// tests/unit/obos-v2-default.test.mjs — OBOS v2 is the default UI (flip plan A.2 / B.2.3 (i)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('T1: Base takes a ui prop and renders it as data-ui on <html> (server-rendered, so no-JS and soft hops are right)', () => {
  const src = readFileSync('src/layouts/Base.astro', 'utf8');
  assert.match(src, /ui\?: 'v2';/);
  assert.match(src, /<html lang="en" data-ui=\{ui\}>/);
});
