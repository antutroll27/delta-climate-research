/**
 * THE INSTRUMENT'S SIDE OF THE PRE-SHIP AUDIT (2026-10-03), read off heat-map-app.ts's
 * source — the painters are closures inside `mountHeatMap` and cannot be called from
 * a test (the same constraint as ward68-stats-guard.test.mjs). Each assertion names
 * the defect it holds shut; the e2e specs (ward68-credit, solar-pane, console-contrast)
 * check the same behaviour in a browser.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PEAK_CHIP_BASIS } from '../../src/scripts/climate-engine/accuracy.ts';

const APP = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function body(name) {
  const at = CODE.search(new RegExp(`\\n  function ${name}\\s*\\(`));
  assert.ok(at >= 0, `heat-map-app.ts has no function ${name} — the guard has lost its target`);
  const end = CODE.indexOf('\n  }\n', at + 1);
  return CODE.slice(at, end + 4);
}

test('the DataMeet credit is shown wherever the boundary is: scope line, map attribution and legend (N4)', () => {
  const paint = body('paintWardScope');
  assert.match(paint, /scope\.hidden = wardMask === null;/, 'the scope line is not shown with the boundary');
  assert.match(paint, /<span class="ward-credit">boundary © DataMeet, <a href="\$\{wardMask\.licenceUri\}"/, 'the on-screen credit left the scope line');
  assert.match(paint, /credit\.hidden = wardMask === null;/, 'the legend credit is never shown');
  assert.match(paint, /setMapCredit\(wardMask\s*\? `Ward boundary © DataMeet, <a href="\$\{wardMask\.licenceUri\}"/, 'the map attribution does not credit DataMeet');
  assert.match(body('setMapCredit'), /new maplibregl\.AttributionControl\(\{ compact: true, \.\.\.\(credit \? \{ customAttribution: credit \} : \{\}\) \}\)/);
});

test('the peak chip says on its face that it is the earlier evidence set', () => {
  assert.equal(PEAK_CHIP_BASIS, 'earlier set');
  assert.match(body('applyConfidence'), /\$\{fig\(`n=\$\{a\.n\}`\)\}\$\{state\.phase === 'peak' \? ` · \$\{PEAK_CHIP_BASIS\}` : ''\}/);
});

test('the idle orbit and drag inertia never cancel a camera animation; a row click pauses the orbit (solar-pane:129)', () => {
  assert.match(body('advanceOrbit'), /if \(active && !map\.isEasing\(\)\) map\.setBearing\(/, 'the orbit steps through an ease, and setBearing → jumpTo → stop() kills it');
  assert.match(body('advanceDrag'), /else if \(map\.isEasing\(\)\) \{ vel\.b = vel\.p = 0; \}\s*else if \(Math\.abs\(vel\.b\) > 0\.02/, 'inertia jumpTo would cancel an ease');
  assert.match(CODE, /nudgeOrbit\(\);\s*map\.easeTo\(\{ center: \[ll\.lon, ll\.lat\], duration: reduceMotion \? 0 : 700, essential: true \}\);/);
});

test('the greenery tag is placed first; ring labels avoid it and the HUD, and the tag avoids the HUD', () => {
  const place = body('placeCard');
  const tagAt = place.indexOf("const tag = el('coolTag');"), ringAt = place.indexOf('for (const { r, el: id } of RINGS)');
  assert.ok(tagAt > 0 && ringAt > tagAt, 'the ring labels are placed before the tag they must avoid');
  assert.match(place, /tagBox = boxAt\(Math\.round\(tx\), Math\.round\(ty\)\);/);
  assert.match(place, /if \(\(tagBox && overlaps\(box, \{ left: tagBox\[0\], top: tagBox\[1\], right: tagBox\[2\], bottom: tagBox\[3\] \}\)\)\s*\|\| hud\.some\(\(rect\) => overlaps\(box, rect\)\)\) continue;/, 'a ring label may land on the tag or the HUD');
  assert.match(place, /if \(!clearOfHud\(q\.x, y\)\) return false;/, 'the tag may land on the HUD');
  assert.match(place, /if \(!clearOfHud\(tx, ty\)\) ty = null;/, 'the docked tag may land on the HUD');
  assert.match(CODE, /const HUD_KEEP_OUT = '\.rail-r > \*, #clockw, #vegw, #svw, \.chiprow, \.synthetic, \.stamp-slot, #sunLine, #compass';/);
});

test('overlaps: a shared edge is not an overlap, a pixel of intrusion is', () => {
  const m = CODE.match(/const overlaps = \(a: readonly number\[\], b: [^)]*\) =>\s*([^;]+);/);
  assert.ok(m, 'overlaps() is gone');
  // eslint-disable-next-line no-new-func
  const overlaps = new Function('a', 'b', `return ${m[1]};`);
  const b = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(overlaps([0, 0, 10, 10], b), false);
  assert.equal(overlaps([20, 10, 30, 20], b), false);
  assert.equal(overlaps([0, 0, 10.5, 10.5], b), true);
  assert.equal(overlaps([12, 12, 14, 14], b), true);
});
