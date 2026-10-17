// tests/unit/obos-v2-sections.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, RAIL_ORDER, sectionOf, onMenuClick, COMPARE_ITEM } from '../../src/scripts/climate-engine/v2/sections.ts';

test('the menu is the founder\'s eight, in order (BRIEF "Layout")', () => {
  const label = (id) => (id === 'compare' ? COMPARE_ITEM.label : sectionOf(id).label);
  assert.deepEqual(RAIL_ORDER.map(label),
    ['Overview', 'Heat', 'Air', 'Solar', 'Weather', 'Scenarios', 'Analysis · Compare', 'Data & methods']);
});

test('side panes and the data-open-pane each section publishes (spec §3.2)', () => {
  assert.deepEqual(SECTIONS.map((s) => [s.id, s.side, s.openPane]), [
    ['overview', 'explore', 'map'], ['heat', null, 'heat'], ['air', 'air', 'air'], ['solar', 'solar', 'solar'],
    ['weather', null, 'weather'], ['scenarios', 'explore', 'scenarios'], ['methods', null, 'reports'],
  ]);
  assert.equal(sectionOf('nope').id, 'overview');
});

test('the current item toggles its panel; another item switches and keeps the panel preference', () => {
  assert.deepEqual(onMenuClick({ section: 'overview', sideOpen: true }, 'overview'), { section: 'overview', sideOpen: false });
  assert.deepEqual(onMenuClick({ section: 'overview', sideOpen: false }, 'overview'), { section: 'overview', sideOpen: true });
  assert.deepEqual(onMenuClick({ section: 'overview', sideOpen: true }, 'solar'), { section: 'solar', sideOpen: true });
  assert.deepEqual(onMenuClick({ section: 'solar', sideOpen: false }, 'heat'), { section: 'heat', sideOpen: false });
});
