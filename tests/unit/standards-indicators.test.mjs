import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync('data/indicators/iso-city-indicators.json', 'utf8'));

test('every published indicator names its standard, threshold and source', () => {
  assert.equal(doc.status, 'prototype');
  assert.equal(doc.published.length, 3);
  for (const w of doc.published) {
    for (const key of ['iso37123_8_8', 'iso37123_8_9']) {
      const i = w[key];
      assert.match(i.standard, /^ISO 37123:2019, \d+\.\d+$/, `${w.ward} ${key}: standard clause`);
      assert.ok(i.indicator.length > 20, 'the indicator wording must be quoted');
      assert.ok(typeof i.value === 'number' && i.value >= 0 && i.value <= 100, `${w.ward} ${key}: ${i.value}`);
      assert.ok(Object.keys(i.threshold).length >= 1, 'a threshold must be stated, never implied');
      assert.ok(Object.keys(i.sensitivity).length >= 2, 'alternative thresholds must be published too');
      assert.ok(i.source, 'every value needs a source');
    }
  }
});

test('canopy cover is consistent with the sensitivity ladder', () => {
  for (const w of doc.published) {
    const i = w.iso37123_8_8;
    // a lower height threshold must admit MORE canopy — catches a sign or
    // dequantisation error that a single number would hide
    assert.ok(i.sensitivity['>=2.0 m'] >= i.value, `${w.ward}: >=2 m must be >= >=3 m`);
    assert.ok(i.sensitivity['>=5.0 m'] <= i.value, `${w.ward}: >=5 m must be <= >=3 m`);
  }
});

test('a near-zero high-albedo value is labelled a measurement, not a gap', () => {
  for (const w of doc.published) {
    const i = w.iso37123_8_9;
    // the wards genuinely have almost no cool surface; the artefact must say so
    // rather than leave a bare 0 that reads as missing data
    assert.ok(i.interpretation && /MEASUREMENT/.test(i.interpretation));
    assert.ok(i.wardMeanAlbedo > 0.05 && i.wardMeanAlbedo < 0.5, `${w.ward}: mean albedo ${i.wardMeanAlbedo}`);
    if (i.value < 1) assert.ok(i.maxAlbedo < 0.4, 'a near-zero share should come with a low maximum');
  }
});

test('the omissions are as explicit as the values — including the tempting ones', () => {
  const omitted = doc.deliberatelyNotPublished;
  assert.ok(omitted.length >= 5);
  for (const o of omitted) assert.ok(o.reason.length > 30, `${o.standard}: reason too thin`);
  const byClause = Object.fromEntries(omitted.map((o) => [o.standard, o.reason]));
  // 8.1 is the indicator closest to our product and the one we cannot claim:
  // it specifies ATMOSPHERIC urban heat island; we model surface temperature
  assert.match(byClause['ISO 37123:2019, 8.1'], /atmospheric|surface/i);
  // 21.1 is satisfiable by pointing at our own map — excluded on purpose
  assert.match(byClause['ISO 37123:2019, 21.1'], /pointing at oneself|measures nothing/i);
  const all = JSON.stringify(doc);
  assert.ok(!/population_exposed|populationExposed/.test(all), 'no fabricated exposure figures');
});

test('the protocol caveat travels with the numbers', () => {
  assert.match(doc.protocolCaveat, /not a verified conformant measurement/i);
  assert.match(doc.scope, /ward/i, 'ward-vs-city scale must be stated');
});
