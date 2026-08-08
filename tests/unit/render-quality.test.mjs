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

/**
 * Real strings, exactly as Chrome's WEBGL_debug_renderer_info reports them.
 *
 * This table exists because the old `radeon vega` rule could never match one of
 * them: ANGLE writes "AMD Radeon(TM) Vega 8 Graphics", and "(TM) " sits between
 * the two words the pattern wanted adjacent. Every AMD APU therefore scored
 * tier 2 and ran the GPU solver on precisely the integrated hardware caps.ts
 * says must stay on the CPU. Three Intel integrated labels leaked the same way.
 *
 * Tier 2 is the ONLY tier that reaches the GPU backend, so a wrong answer here
 * puts a real user on a solver that is slower than the one they would have got.
 */
const GPU_LABELS = [
  // integrated — capable enough for 3D relief, never for the GPU solver
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  ['ANGLE (Intel, Intel(R) Xe Graphics Direct3D11, D3D11)', 1],
  ['ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  ['ANGLE (Intel, Intel(R) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 3 Graphics Direct3D11, D3D11)', 1],
  ['ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics, D3D11)', 1],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', 1],
  // integrated and weak — drops to the 2D isotherm view as well
  ['ANGLE (Intel, Intel(R) HD Graphics 4000, D3D11)', 0],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 0],
  ['ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)', 0],
  ['ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 655, D3D11)', 0],
  ['Google SwiftShader', 0],
  ['no-webgl', 0],
  // discrete — the only hardware that earns the GPU solver
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11, D3D11)', 2],
  ['ANGLE (AMD, Radeon RX Vega 64 Direct3D11 vs_5_0 ps_5_0, D3D11)', 2],
  ['ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11, D3D11)', 2],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)', 2],
  ['ANGLE (Apple, Apple M2, Unspecified Version)', 2],
];

test('every real GPU label lands on the tier its hardware deserves', () => {
  for (const [label, expected] of GPU_LABELS) {
    assert.equal(classifyGpu(label), expected, `${label} should be tier ${expected}`);
  }
});

test('no integrated GPU reaches the GPU solver', () => {
  const integrated = GPU_LABELS.filter(([label]) => /vega [0-9]|radeon\(tm\) graphics|intel/i.test(label)
    && !/A770|RX 6800|RX Vega 64/i.test(label));
  assert.ok(integrated.length >= 12, 'the table must actually cover the integrated space');
  for (const [label] of integrated) {
    assert.notEqual(classifyGpu(label), 2, `${label} is integrated and must not reach the GPU backend`);
  }
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
