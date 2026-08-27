import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { currentParams } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'data/calibration/golden-params.json');

// currentParams is WARD-INDEPENDENT: ScenarioState carries
// {live, phase, path, iv, heatTairC, sunNow} and no ward. So the matrix varies
// only what actually reaches it. 2 phases x 3 pathways x 2 live x 2 heatwave.
const LIVE = { tAir: 31.2, rh: 74, wind: 2.4, cloud: 40 };
const IV = { trees: 12, roof: 40, parks: 2, facades: 0 };

function matrix() {
  const out = {};
  for (const phase of ['peak', 'night']) {
    for (const path of ['2025', 'ssp245', 'ssp585']) {
      for (const [liveName, live] of [['nolive', null], ['live', LIVE]]) {
        for (const [hwName, heatTairC] of [['plain', null], ['heatwave', 41.5]]) {
          const key = `${phase}/${path}/${liveName}/${hwName}`;
          out[key] = currentParams({ live, phase, path, iv: IV, heatTairC });
        }
      }
    }
  }
  return out;
}

test('currentParams output is frozen against the pre-migration baseline', async () => {
  const now = matrix();
  assert.equal(Object.keys(now).length, 24, 'the matrix must be 24 cases');

  if (!existsSync(GOLDEN)) {
    await writeFile(GOLDEN, JSON.stringify(now, null, 2) + '\n');
    assert.fail('golden-params.json did not exist; it has been written. '
      + 'Inspect it, commit it, and re-run. It must be captured BEFORE any '
      + 'scope-model change lands, or it freezes the wrong thing.');
  }

  const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
  assert.deepEqual(now, golden,
    'currentParams drifted from the frozen baseline. If the change was '
    + 'intentional, say so explicitly and regenerate — do not edit the JSON.');
});
