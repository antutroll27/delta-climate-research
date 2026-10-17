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

/* D2 REVISED (founder, 17 Oct): PLATES is the default on every device and tier. Glass is a manual choice, and the safety rules
   (tier 2 only, no phones, no software renderer, no reduced transparency, no save-data, no demotion) still decide whether a CHOSEN Glass is live. */
test('default cards: plates on every device and tier (D2 revised, 17 Oct)', () => {
  for (const baseTier of [0, 1, 2]) for (const coarsePointer of [false, true]) {
    assert.equal(defaultCards({ coarsePointer, baseTier }), 'plates', `tier ${baseTier}, coarse ${coarsePointer}`);
  }
  assert.deepEqual(TIER_NAME, { 0: 'low', 1: 'balanced', 2: 'full' });
});

test('a CHOSEN Glass is still refused on tier 0, tier 1, phones, software rendering, reduced transparency and after demotion', () => {
  assert.equal(decideGlass({ ...BASE, cards: 'glass', baseTier: 0 }), 'flat');
  assert.equal(decideGlass({ ...BASE, cards: 'glass', baseTier: 1 }), 'flat');
  assert.equal(decideGlass({ ...BASE, cards: 'glass', coarsePointer: true }), 'flat');
  assert.equal(decideGlass({ ...BASE, cards: 'glass', reducedTransparency: true }), 'flat');
  assert.equal(decideGlass({ ...BASE, cards: 'glass', demoted: true }), 'flat');
  assert.equal(decideGlass({ ...BASE, cards: 'plates' }), 'flat', 'the default never blurs');
});
