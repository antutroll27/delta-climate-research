// tests/unit/obos-v2-credits.test.mjs — C audit F2: every model input is credited, with the licence wording the repo already publishes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SENTINEL_CREDIT, WATER_CREDIT } from '../../src/scripts/climate-engine/v2/credits.ts';
import { LICENCES } from '../../src/scripts/standards/ward-record.ts';

test('the Sentinel-2 credit names the composite years from the pipeline provenance, never a typed year', () => {
  const years = JSON.parse(readFileSync('data/dc-urs/sentinel.json', 'utf8')).years_requested;
  assert.deepEqual(years, [...years].sort(), 'years_requested is ascending');
  assert.equal(SENTINEL_CREDIT.lead, `Contains modified Copernicus Sentinel data ${years[0]}–${years[years.length - 1]}`);
});

test('the Sentinel-2 licence label and link are the ones /attribution publishes (ward-record LICENCES)', () => {
  const l = LICENCES['Sentinel-2 L2A'];
  assert.equal(SENTINEL_CREDIT.licence, l.licence);
  assert.equal(SENTINEL_CREDIT.url, l.url);
  assert.match(SENTINEL_CREDIT.url, /^https:\/\//);
});

test('the water credit is OpenStreetMap under ODbL, as in v1\'s attribution line', () => {
  assert.equal(WATER_CREDIT.lead, 'Water © OpenStreetMap');
  assert.equal(WATER_CREDIT.licence, 'ODbL');
});

test('the area page credits Sentinel-2 where the area has a model (inside the hasData branch), from the shared constant', () => {
  const o = readFileSync('src/components/ClimateEngine/v2/Overlays.astro', 'utf8');
  assert.match(o, /creditsPanelHtml\(scope\.city\.id, SENTINEL_CREDIT\)/, 'the shared constant is what the renderer is handed (it writes .lead and .url; tests/unit/city-credits.test.mjs holds the output)');
  const data = o.indexOf('scope.area.hasData ? (<Fragment>');
  const lines = o.indexOf('set:html={creditsHtml}');
  const none = o.indexOf('Nothing is mapped for this area yet.');
  assert.ok(data > 0 && lines > data && none > lines, 'the credit lines sit inside the data branch; the no-data branch says only that nothing is mapped (a-02)');
});
