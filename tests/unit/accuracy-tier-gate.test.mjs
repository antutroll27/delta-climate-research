import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { AREA_KEYS } from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import {
  heatAccuracyClaim, NOT_VALIDATED_LINE,
} from '../../src/scripts/climate-engine/scope/accuracy-claim.ts';

/* A HEAT-ACCURACY BAND IS A CLAIM ABOUT A CITY, AND THE CITY'S TIER IS WHERE THE
 * CLAIM IS SAID. The ± figures in accuracy.ts were measured against ECOSTRESS over
 * three KOLKATA wards. They were printed on Bengaluru wards (tier `geometry`:
 * "the physics has not been evidenced here") because the readout gated them on dry
 * weather (`M.outsideValidation`), never on `scope.tier`. One helper now decides,
 * and these tests hold every renderer to it. */

const read = (p) => readFileSync(p, 'utf8');
const BENGALURU = AREA_KEYS.filter((k) => k.startsWith('in/bengaluru/'));
const KOLKATA = AREA_KEYS.filter((k) => k.startsWith('in/kolkata/'));

test('the fixtures are what they claim: Kolkata is validated, Bengaluru is geometry', () => {
  assert.ok(KOLKATA.length === 3 && BENGALURU.length === 3);
  for (const k of KOLKATA) assert.equal(resolve(k).tier, 'validated', k);
  for (const k of BENGALURU) assert.equal(resolve(k).tier, 'geometry', k);
});

test('a validated ward may show a band; every other tier gets one honest line instead', () => {
  for (const k of KOLKATA) assert.deepEqual(heatAccuracyClaim(resolve(k).tier), { kind: 'band' }, k);
  for (const tier of ['zone', 'geometry']) {
    const c = heatAccuracyClaim(tier);
    assert.equal(c.kind, 'none', tier);
    assert.equal(c.line, 'Heat accuracy not yet validated for this city');
    assert.equal(c.line, NOT_VALIDATED_LINE);
    assert.ok(!/[±]/.test(c.line + c.detail), `${tier}: the replacement copy must carry no band`);
    assert.match(c.detail, /Kolkata/, `${tier}: say where the bands WERE measured`);
  }
  for (const k of BENGALURU) assert.equal(heatAccuracyClaim(resolve(k).tier).kind, 'none', k);
});

test('the gate fails closed on a tier it does not know', () => {
  assert.equal(heatAccuracyClaim('platinum').kind, 'none');
  assert.equal(heatAccuracyClaim(undefined).kind, 'none');
});

/* WHERE THE BAND RENDERS. Every file that prints `bandK`, `bandLabel(` or an
   ACCURACY/SPATIAL figure to a reader either goes through the helper or is on this
   list, and each listed file says why it cannot reach a non-validated city. */
const ALLOWED_WITHOUT_GATE = new Map([
  ['src/scripts/climate-engine/accuracy.ts', 'the measurements themselves'],
  ['src/scripts/climate-engine/v2/method-copy.ts', 'pure copy; its only callers are gated below'],
  ['src/scripts/climate-engine/scope/accuracy-claim.ts', 'the gate'],
  ['src/scripts/standards/ward-record.ts', 'Kolkata ward records only: built from WARDS (src/data/wards.ts), which holds no other city'],
  ['src/scripts/standards/ngsi-ld.ts', 'serialises a ward record, so Kolkata only'],
  ['src/pages/uncertainty.astro', 'a page about the Kolkata ECOSTRESS study, city-independent by design'],
  ['src/components/sections/Obos.astro', 'marketing copy about the Kolkata study'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|astro)$/.test(name)) out.push(p);
  }
  return out;
}

test('every renderer of an accuracy figure goes through the tier gate', () => {
  const RENDERS = /\bbandK\b|\bbandLabel\(|\bcheckedRows\(|\bcaveatRows\(|\bACCURACY\b|\bSPATIAL\.(rModel|note)\b/;
  const offenders = [];
  for (const f of walk('src')) {
    if (ALLOWED_WITHOUT_GATE.has(f)) continue;
    const src = read(f);
    /* comments only MENTION a figure; strip them so a docstring cannot be mistaken for a renderer */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (!RENDERS.test(code)) continue;
    if (!/heatAccuracyClaim\(/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'these files print an accuracy figure without asking heatAccuracyClaim(tier)');
});

test('the readout, the methods ledger and the heat card each branch on the claim', () => {
  const app = read('src/scripts/climate-engine/heat-map-app.ts');
  assert.match(app, /heatAccuracyClaim\(resolve\(state\.ward\)\.tier\)/, 'heat-map-app reads the CURRENT ward\'s tier (a closure over the boot scope would go stale)');
  const conf = /function applyConfidence\(\)[\s\S]*?\n  \}\n/.exec(app)?.[0] ?? '';
  assert.match(conf, /heatAccuracyClaim|accuracyClaim/, 'applyConfidence must branch on the claim before it builds any band');
  assert.ok(conf.indexOf('claim.kind') < conf.indexOf('a.bandK'), 'the gate comes BEFORE the band is built');
  const refresh = /function refreshStats[\s\S]*?applyConfidence\(\);/.exec(app)?.[0] ?? '';
  assert.match(refresh, /claim\.kind !== 'band'/, '#lst .band is gated on the claim, not only on dry weather');
  const methods = read('src/components/ClimateEngine/v2/MethodsCards.astro');
  assert.match(methods, /heatAccuracyClaim\(scope\.tier\)/);
  assert.match(methods, /claim\.kind === 'band'/, 'the "How sure" ledger needs the tier, not just a ward record');
  const heat = read('src/components/ClimateEngine/v2/HeatCards.astro');
  assert.match(heat, /heatAccuracyClaim\(scope\.tier\)/);
});

test('Kolkata keeps its chip words byte for byte (the chip is only reached on the band branch)', () => {
  const app = read('src/scripts/climate-engine/heat-map-app.ts');
  for (const s of ['Calibrated · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}${seasonChip}',
    'Indicative only · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}',
    'Outside validation · ${outside === \'wet\' ? \'wet surfaces\' : \'station cloud\'}${seasonChip}']) {
    assert.ok(app.includes(s), `the validated-city chip text moved: ${s}`);
  }
});
