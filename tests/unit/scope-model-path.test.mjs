import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_WARDS, modelPath } from '../../src/scripts/climate-engine/scope/paths.ts';
import { hasBuildingModel } from '../../src/scripts/climate-engine/explore/building-model.ts';

test('modelPath names the GLB for a ward with an authored city, and nothing for one without', () => {
  assert.equal(modelPath('mg-road'), '/heat-map/models/mg-road.glb');
  assert.equal(modelPath('ballygunge'), null);
});

test('hasBuildingModel and modelPath answer from one list', () => {
  for (const ward of [...MODEL_WARDS, 'ballygunge', 'baruipur', 'barrackpore']) {
    assert.equal(hasBuildingModel(ward), modelPath(ward) !== null, ward);
  }
});
