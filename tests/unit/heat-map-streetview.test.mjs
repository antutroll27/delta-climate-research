import assert from 'node:assert/strict';
import test from 'node:test';
import { recencyBucket, coverageColorExpression, assertCoverageLogic } from '../../src/scripts/climate-engine/streetview/coverage-layer.ts';

test('recencyBucket maps captured_at (epoch-ms) to old/mid/fresh at the 2018/2023 boundaries', () => {
  assert.equal(recencyBucket(Date.UTC(2016, 0, 1)), 'old');
  assert.equal(recencyBucket(Date.UTC(2020, 5, 1)), 'mid');
  assert.equal(recencyBucket(Date.UTC(2024, 0, 1)), 'fresh');
  assert.equal(recencyBucket(1672531200000), 'fresh', '2023-01-01 exact = fresh');
  assert.equal(recencyBucket(1514764800000), 'mid', '2018-01-01 exact = mid');
});

test('coverageColorExpression is a MapLibre step expression over captured_at', () => {
  const e = coverageColorExpression();
  assert.equal(e[0], 'step');
  assert.deepEqual(e[1], ['get', 'captured_at']);
  assert.equal(e[3], 1514764800000);
  assert.equal(e[5], 1672531200000);
});

test('coverage self-check passes', () => { assertCoverageLogic(); });
