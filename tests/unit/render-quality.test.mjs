import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdaptiveRenderGovernor,
  classifyGpu,
  classifyHardware,
  resolveRenderQuality,
} from '../../src/utils/render-quality.ts';

test('takes the most conservative device or GPU quality tier', () => {
  assert.equal(classifyHardware({ hardwareConcurrency: 12, deviceMemory: 16 }), 2);
  assert.equal(classifyHardware({ coarsePointer: true, hardwareConcurrency: 8, deviceMemory: 8 }), 1);
  assert.equal(classifyHardware({ saveData: true, hardwareConcurrency: 12, deviceMemory: 16 }), 0);
  assert.equal(classifyGpu('ANGLE (Intel(R) UHD Graphics 630 Direct3D11)'), 0);
  assert.equal(classifyGpu('ANGLE (Intel Iris Xe Graphics Direct3D11)'), 1);
  assert.equal(classifyGpu('ANGLE (Intel(R) Iris(R) Xe Graphics Direct3D11)'), 1);
  assert.equal(classifyGpu('ANGLE (NVIDIA GeForce RTX 4080 Direct3D11)'), 2);

  const profile = resolveRenderQuality(
    { hardwareConcurrency: 16, deviceMemory: 16 },
    'ANGLE (Intel(R) UHD Graphics 630 Direct3D11)',
  );
  assert.deepEqual(
    {
      tier: profile.tier,
      maxDevicePixelRatio: profile.maxDevicePixelRatio,
      bloom: profile.bloom,
      vortexIterations: profile.vortexIterations,
      targetFps: profile.targetFps,
    },
    { tier: 0, maxDevicePixelRatio: 1, bloom: false, vortexIterations: 24, targetFps: 30 },
  );
});

test('demotes after sustained slow browser frames and ignores tab suspensions', () => {
  const changes = [];
  const governor = new AdaptiveRenderGovernor(2, {
    sampleFrames: 4,
    settleFrames: 0,
    budgetMs: 17,
    onTierChange: (tier) => changes.push(tier),
  });

  [0, 20, 40, 60, 80].forEach((timestamp) => governor.frame(timestamp));
  assert.deepEqual(changes, [1]);

  governor.frame(1_000); // Background-tab gap: never treat it as a slow render.
  [1_020, 1_040, 1_060, 1_080].forEach((timestamp) => governor.frame(timestamp));
  assert.deepEqual(changes, [1, 0]);
});
