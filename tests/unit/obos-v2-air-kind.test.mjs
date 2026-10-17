// tests/unit/obos-v2-air-kind.test.mjs — OBOS v2 A-S3 audit F1 [H]: the air row's provenance follows the app's own source decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airKind } from '../../src/scripts/climate-engine/v2/heat-v2.ts';

test('a fresh airport report is OBSERVED, solid', () => {
  assert.deepEqual(airKind(true, true), { text: 'observed', cls: 'measured', mark: 'measured', showMark: true });
});
test('Met Norway is a FORECAST, outlined: never "observed"', () => {
  assert.deepEqual(airKind(false, true), { text: 'forecast', cls: 'modelled', mark: 'modelled', showMark: true });
});
test('no reading at all says so and draws no air mark', () => {
  assert.deepEqual(airKind(false, false), { text: 'no reading', cls: 'modelled', mark: 'modelled', showMark: false });
});
test('an observation without a number is not drawn as observed (the airport said nothing usable)', () => {
  assert.equal(airKind(true, false).showMark, false);
  assert.notEqual(airKind(true, false).text, 'observed');
});

test('the card ships in the safe state: forecast, outlined, until the app says otherwise; the disc colour is the ink token', () => {
  const card = readFileSync('src/components/ClimateEngine/v2/TempCard.astro', 'utf8');
  assert.ok(card.includes('<span class="kind modelled" data-v2-airkind>forecast</span>'));
  assert.ok(card.includes('<span class="air-sym" data-v2-airsym><Sym shape="disc" c="ink" kind="modelled" size={26} /></span>'));
  assert.ok(!/kind measured">observed/.test(card), 'the card hard-codes "observed"');
});

test('the binder listens to the app\'s own source event and mounts with the shell', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/heat-v2.ts', 'utf8');
  assert.ok(src.includes("'obos:observed'"));
  const shell = readFileSync('src/scripts/climate-engine/v2/shell-v2.ts', 'utf8');
  assert.ok(shell.includes('bindMirrors(ctx)'), 'bindMirrors is the mount point');
  assert.match(src, /export function bindMirrors[^]*bindAirKind\(ctx\)/, 'bindMirrors must start the air-kind binder');
});
