// tests/unit/obos-v2-ci-split.test.mjs — OBOS v2 S8: the @v2 e2e suite is two Playwright projects, and no spec falls between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { V2_PART_A, V2_PART_B, V2_LOCAL_ONLY } from '../e2e/fixtures/v2-split.ts';

const specs = readdirSync('tests/e2e').filter((f) => /^obos-v2-.+\.spec\.ts$/.test(f)).map((f) => f.replace(/\.spec\.ts$/, ''));
const CONFIG = readFileSync('playwright.config.ts', 'utf8');

test('every obos-v2-*.spec.ts is claimed by exactly one of part A, part B, or the local-only list', () => {
  const claims = new Map();
  for (const [part, names] of [['A', V2_PART_A], ['B', V2_PART_B], ['local', V2_LOCAL_ONLY]]) for (const n of names) claims.set(n, [...(claims.get(n) ?? []), part]);
  for (const s of specs) assert.equal(claims.get(s)?.length, 1, `${s} must be claimed by exactly one part (claimed by: ${claims.get(s)?.join(', ') ?? 'none'})`);
  for (const n of claims.keys()) assert.ok(specs.includes(n), `${n} is claimed but there is no such spec`);
  for (const [n, parts] of claims) assert.equal(parts.length, 1, `${n} is in more than one part: ${parts.join(', ')}`);
});

test('the two parts are projects, chromium-v2 as one project and chromium-v2-split are gone, and neither part runs a local-only file', () => {
  assert.match(CONFIG, /name: 'chromium-v2-a'/);
  assert.match(CONFIG, /name: 'chromium-v2-b'/);
  assert.doesNotMatch(CONFIG, /name: 'chromium-v2'[,\s]/, 'the single chromium-v2 project is split');
  assert.doesNotMatch(CONFIG, /chromium-v2-split|obos-v2-split-baseline/, 'the one-off split baseline is deleted (A1: it was a gate for S2.9 only)');
  for (const n of V2_LOCAL_ONLY) assert.ok(!V2_PART_A.includes(n) && !V2_PART_B.includes(n), `${n} runs only in chromium-v2-relief`);
  assert.match(CONFIG, /name: 'chromium-tier0', testIgnore: \[[^\]]*'\*\*\/obos-v2-\*\.spec\.ts'/, 'the v1 project still ignores every v2 spec');
});

test('the @v2 budget names both parts and the CI arithmetic (S8)', () => {
  assert.match(CONFIG, /TWO PROJECTS, ONE SUITE/);
  assert.match(CONFIG, /<= 6\.5 min on the dev machine/);
});
