import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';
import { resolve, requireCosts, costsOrNull } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { nextDistinctArea, areaKeysInCity } from '../../src/scripts/climate-engine/scope/registry.ts';
import { heatAccuracyClaim, NOT_VALIDATED_LINE } from '../../src/scripts/climate-engine/scope/accuracy-claim.ts';
import { fmtMoneyOrNone, noCostBasisLine, planScoreLine, fmtMoney } from '../../src/scripts/climate-engine/money.ts';

/* PHASE A TASK A3. The first drawable city outside India has no cost basis, no warming
   pathway and no validation. Each of the three must reach the screen as a sentence,
   never as a number borrowed from Kolkata. */

const NL = 'nl/amsterdam/canal-ring';
const KOL = 'in/kolkata/ballygunge';

test('costsOrNull: null for the Netherlands, the rupee table for Kolkata; requireCosts stays strict', () => {
  assert.equal(costsOrNull(resolve(NL)), null);
  assert.equal(costsOrNull(resolve(KOL))?.currency, 'INR');
  assert.equal(requireCosts(resolve(KOL)).currency, 'INR');
  assert.throws(() => requireCosts(resolve(NL)), /Netherlands declares no intervention costs/);
});

test('the plan readout for a country with no cost basis names the gap and prints no currency or figure', () => {
  const html = planScoreLine(3.2, null, costsOrNull(resolve(NL)), 'Netherlands', 'guidance');
  assert.equal(html, '3.2 pts from this plan · No cost basis for Netherlands yet<br>guidance');
  assert.ok(!/[₹€]|INR|EUR/.test(html));
  assert.equal(fmtMoneyOrNone(123456, null, 'Netherlands'), noCostBasisLine('Netherlands'));
  assert.equal(fmtMoneyOrNone(null, costsOrNull(resolve(KOL)), 'India'), noCostBasisLine('India'), 'a null amount is never a zero');
});

test('Kolkata readout is exactly what it was: points, rupee figure, guidance', () => {
  const costs = requireCosts(resolve(KOL));
  const was = (pts, cost, g) => `${pts.toFixed(1)} pts from this plan · ${fmtMoney(cost, costs)}<br>${g}`;
  assert.equal(planScoreLine(4.56, 1.1e7, costs, 'India', 'g'), was(4.56, 1.1e7, 'g'));
  assert.match(planScoreLine(4.56, 1.1e7, costs, 'India', 'g'), /₹/);
});

test('the Compare / brief / app cost sites branch on null (no requireCosts left in the readouts)', () => {
  for (const f of ['compare/paired-brief.ts', 'compare/paired-controller.ts', 'compare/paired-core.ts', 'heat-map-app.ts']) {
    const src = readFileSync(`src/scripts/climate-engine/${f}`, 'utf8');
    assert.ok(!/requireCosts\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${f} must use costsOrNull`);
  }
  const core = readFileSync('src/scripts/climate-engine/compare/paired-core.ts', 'utf8');
  assert.match(core, /costs === null \? null : computeCost/);
});

test('a pathway-less country offers no buttons, no citation and an empty table; the pane renders buttons only when there are options', () => {
  const s = resolve(NL);
  assert.deepEqual(s.pathway.options, []);
  assert.equal(s.pathway.initial, null);
  assert.equal(s.pathway.source, null);
  assert.deepEqual(s.climate.pathDelta, {});
  const pane = readFileSync('src/components/ClimateEngine/shell/InterventionPane.astro', 'utf8');
  assert.match(pane, /scope\.pathway\.options\.length > 0\s*\n?\s*\?/);
});

test('a geometry-tier city gets the not-validated line and never a band', () => {
  const claim = heatAccuracyClaim(resolve(NL).tier);
  assert.equal(resolve(NL).tier, 'geometry');
  assert.equal(claim.kind, 'none');
  assert.equal(claim.line, NOT_VALIDATED_LINE);
  assert.ok(!/±/.test(claim.line + claim.detail));
  /* #77: a band claim now carries its figures (`figures`, `footLine`); the gate is the KIND. */
  assert.equal(heatAccuracyClaim(resolve(KOL).tier).kind, 'band');
});

test('a one-area city has no "other area": Compare\'s fallback is null, not a self-pair', () => {
  assert.deepEqual(areaKeysInCity(NL), [NL]);
  assert.equal(nextDistinctArea(NL), null);
  assert.notEqual(nextDistinctArea(KOL), null);
});

test('every city in CITIES has a credits row and a map-credit row, and no other city does', async () => {
  const { CITY_CREDITS, CITY_MAP_CREDIT, CITY_CREDIT_NOTE } = await import('../../src/data/city-credits.ts');
  const ids = Object.keys(CITIES).sort();
  for (const table of [CITY_CREDITS, CITY_MAP_CREDIT, CITY_CREDIT_NOTE]) assert.deepEqual(Object.keys(table).sort(), ids);
});
