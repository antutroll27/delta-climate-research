/**
 * THE GUARD: every ward statistic the instrument prints for an area with a polygon
 * is taken over the polygon (ward-mask.ts), never over the compute square.
 *
 * Read off heat-map-app.ts's SOURCE, because the painters are closures inside
 * `mountHeatMap` and cannot be called from a test, and because the failure this
 * guards against is silent: a painter that reads `snapshot.stats` or `pv.totals`
 * directly renders a perfectly plausible number — the square's — under the ward's
 * name. Each assertion names the statistic it protects. The behaviour of the
 * functions these painters call is tested in ward68-mask.test.mjs.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
/** Comments stripped, so a sentence about `pv.totals` cannot satisfy or trip the guard. */
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `function name(…) … { … }` in CODE: from its line to the closing brace at the
 *  closure's own indentation (two spaces) — every painter in mountHeatMap is written
 *  that way, and a return type with braces in it cannot confuse the cut. */
function body(name) {
  const at = CODE.search(new RegExp(`\\n  function ${name}\\s*\\(`));
  assert.ok(at >= 0, `heat-map-app.ts has no function ${name} — the guard has lost its target`);
  const end = CODE.indexOf('\n  }\n', at + 1);
  assert.ok(end > at, `could not find the end of ${name}`);
  return CODE.slice(at, end + 4);
}

test('mean surface temperature, area above 40 °C and the strip tile are taken over the polygon', () => {
  const b = body('refreshStats');
  assert.match(b, /const st = wardMask \? fieldStats\(t, wardMask, snapshot\.stats\.thresholdC\) : snapshot\.stats;/,
    'refreshStats no longer re-takes the stats over the polygon when there is one');
  /* Every later read goes through `st`; a direct read of the solver's whole-domain stats is the square. */
  assert.doesNotMatch(b.replace(/const st = [^;]*;/, ''), /snapshot\.stats\b/, 'a readout reads the solver\'s whole-square stats directly');
  for (const use of [/st\.meanC\.toFixed\(1\)/, /st\.fracAbove \* 100/, /state\.lastMean\[state\.ward\] = st\.meanC/, /greenReferenceContrastC\(st\.meanC/]) {
    assert.match(b, use, `${use} no longer reads the masked stats`);
  }
});

test('the heat-stress histogram counts the polygon\'s cells only', () => {
  const b = body('refreshStats');
  assert.match(b, /fieldHistogram\(t, wardMask, ramp\[0\], ramp\[1\], 12\)/, 'the histogram is not taken over the polygon');
  assert.doesNotMatch(b, /for \(let i = 0; i < t\.length;/, 'a whole-field loop over the solver output is back in refreshStats');
});

test('the solar totals, the ward line and the stratum come from the ward\'s blocks, through one helper', () => {
  /* pvScope is the ONLY place `pv.totals` / `pv.stratum` may be read: everywhere else
     a direct read would be the square's figures. */
  const scope = body('pvScope');
  assert.match(scope, /wardMask && pv\.totals_in_ward && pv\.stratum_in_ward/);
  assert.match(scope, /t: pv\.totals_in_ward, s: pv\.stratum_in_ward, n: wardMask\.inWardCount, rows: wardRows\(wardMask/);
  const outside = CODE.replace(scope, '');
  assert.doesNotMatch(outside, /\bpv\.(totals|stratum)\b(?!_in_ward)/, 'a painter reads the square\'s pv.totals or pv.stratum directly');
  for (const name of ['paintSolarWard', 'paintSolarPane']) assert.match(body(name), /= pvScope\(pv\)/, `${name} does not take its figures from pvScope`);
});

test('the ten best roofs are the ward\'s, and the whole-ward payback is over the ward\'s roofs', () => {
  assert.match(body('paintSolarPane'), /const order = \[\.\.\.rows\]\.sort/, 'the best-roofs list is drawn from every roof in the square');
  assert.match(body('paintSolarWard'), /wardRoi\(pv, SOLAR_BASIS, tariff, rows\)/, 'the whole-ward payback is computed over the square');
});

test('the CSV marks every roof in_ward where a polygon exists', () => {
  assert.match(body('buildCsv'), /wardMask \? \[\['in_ward', buildingInWard\(wardMask, i\) \? 1 : 0\]/);
});

test('the building count leads with the ward\'s buildings', () => {
  assert.match(CODE, /wardMask\s*\? `\$\{wardMask\.inWardCount\.toLocaleString\(\)\} buildings in \$\{wardMask\.name\}/);
});

test('a polygon area cannot load without its boundary, nor read a solar file without the ward\'s blocks', () => {
  assert.match(CODE, /if \(!r\.ok\) throw new Error\(`Ward boundary unavailable/, 'a missing boundary would fall back to the square silently');
  assert.match(CODE, /if \(maskUrl !== null && mask === null\) throw new Error/, 'a refused boundary would fall back to the square silently');
  assert.match(body('asPvFile'), /mask === null\s*\|\| \(typeof f\.totals_in_ward\?\.capacity_mwp === 'number'[\s\S]*f\.totals_in_ward\?\.buildings === mask\.inWardCount/,
    'a polygon area would read a solar file that carries only the square\'s totals');
  /* The open area's mask is assigned with the open area, so the two never disagree. */
  assert.match(CODE, /state\.ward = name; state\.climate = resolve\(name\)\.climate;\s*wardMask = b\.mask;/);
});

test('Compare takes Ballygunge\'s figures inside the polygon too, and says so', async () => {
  const core = (await readFile(new URL('../../src/scripts/climate-engine/compare/paired-core.ts', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(core, /return boundary \? \{ field: solved\.field, stats: fieldStats\(solved\.field, boundary, solved\.stats\.thresholdC\) \} : solved;/,
    'Compare no longer re-takes a ward\'s stats over its boundary');
  assert.match(core, /field\(prepared\.base, baselineParams, prepared\.wardData\.sizeM, options, prepared\.boundary\)/, 'the baseline is solved over the square');
  assert.match(core, /field\(scenarioLayers, scenarioParams, prepared\.wardData\.sizeM, options, prepared\.boundary\)/, 'the scenario is solved over the square');
  assert.match(core, /statsOver: prepared\.boundary \? \{ name: prepared\.boundary\.name, areaM2: prepared\.boundary\.areaM2 \} : null,/);
  /* and the PLAN — what is planted, priced and counted — is the ward's too (ward-plan.ts;
     behaviour in ward68-compare-plan.test.mjs) */
  assert.match(core, /const planSpatial = wardSpatial\(spatial, loaded\.boundary, /, 'the plan is targeted over the square');
  assert.match(core, /confineToWard\(prepared\.base,\s*applyInterventions\(prepared\.base, interventions, prepared\.planSpatial, /, 'the plan lands outside the ward');
  assert.match(core, /capitalCost: computeCost\(interventions, prepared\.planSpatial, costs\),/, 'Compare prices the square\'s plan');
  assert.match(core, /delivered: deliveredQuantities\(state\.coverage, prepared\.planSpatial\),/, 'Compare counts the square\'s quantities');
});
