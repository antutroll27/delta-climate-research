import assert from 'node:assert/strict';
import test from 'node:test';

import { wardMonthHour } from '../../src/scripts/climate-engine/explore/sun-lighting.ts';

/* THE WARD CLOCK THE FALLBACK AIR TEMPERATURE READS. A wrong month or hour here moves
   the IMD normal the physics falls back on, and nothing on screen would show it. */

test('the month rolls at LOCAL midnight, not UTC midnight', () => {
  // 18:30 UTC on 31 Dec is 00:00 IST on 1 Jan.
  assert.deepEqual(wardMonthHour(Date.UTC(2026, 11, 31, 18, 30), 'Asia/Kolkata'), { month: 1, hour: 0 });
  // One minute earlier it is still March 23:59 IST.
  const endMarch = wardMonthHour(Date.UTC(2026, 2, 31, 18, 29), 'Asia/Kolkata');
  assert.equal(endMarch.month, 3);
  assert.ok(Math.abs(endMarch.hour - (23 + 59 / 60)) < 1e-9, `got ${endMarch.hour}`);
});

test('the zone is the city\'s: Dubai reads 90 minutes behind Kolkata', () => {
  const at = Date.UTC(2026, 3, 1, 8, 30);
  assert.deepEqual(wardMonthHour(at, 'Asia/Kolkata'), { month: 4, hour: 14 });
  assert.deepEqual(wardMonthHour(at, 'Asia/Dubai'), { month: 4, hour: 12.5 });
});
