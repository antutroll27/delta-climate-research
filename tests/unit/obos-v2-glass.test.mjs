// tests/unit/obos-v2-glass.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideGlass, defaultCards, TIER_NAME } from '../../src/scripts/climate-engine/v2/glass.ts';

const BASE = { cards: 'glass', baseTier: 2, coarsePointer: false, softwareRenderer: false, reducedTransparency: false, supportsBackdrop: true, saveData: false, demoted: false };

test('live only on tier 2 with every condition met (D2, spec §2.3)', () => {
  assert.equal(decideGlass(BASE), 'live');
  for (const [k, v] of [['cards', 'plates'], ['baseTier', 1], ['baseTier', 0], ['coarsePointer', true], ['softwareRenderer', true],
    ['reducedTransparency', true], ['supportsBackdrop', false], ['saveData', true], ['demoted', true]]) {
    assert.equal(decideGlass({ ...BASE, [k]: v }), 'flat', `${k}=${v}`);
  }
});

test('default cards: plates on tier 0 or a coarse pointer, else glass', () => {
  assert.equal(defaultCards({ coarsePointer: false, baseTier: 2 }), 'glass');
  assert.equal(defaultCards({ coarsePointer: false, baseTier: 1 }), 'glass');
  assert.equal(defaultCards({ coarsePointer: false, baseTier: 0 }), 'plates');
  assert.equal(defaultCards({ coarsePointer: true, baseTier: 2 }), 'plates');
  assert.deepEqual(TIER_NAME, { 0: 'low', 1: 'balanced', 2: 'full' });
});
