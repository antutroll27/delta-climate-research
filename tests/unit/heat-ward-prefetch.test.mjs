import assert from 'node:assert/strict';
import test from 'node:test';
import { prefetchPlan, runPrefetch, shouldPrefetch } from '../../src/scripts/climate-engine/ward-prefetch.ts';

test('prefetch backs off for Save-Data and 2G, and runs otherwise', () => {
  assert.equal(shouldPrefetch(undefined), true);
  assert.equal(shouldPrefetch({ effectiveType: '4g' }), true);
  assert.equal(shouldPrefetch({ saveData: true, effectiveType: '4g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: '2g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: 'slow-2g' }), false);
});

test('the plan is the two other Bengaluru wards, each with its model', () => {
  const plan = prefetchPlan('in/bengaluru/indiranagar');
  assert.equal(plan.length, 2);
  const flat = plan.flat();
  assert.ok(flat.includes('/heat-map/data/mg-road.json'));
  assert.ok(flat.includes('/heat-map/data/whitefield-trees.json'));
  assert.ok(flat.includes('/heat-map/models/mg-road.glb'));
  assert.ok(flat.includes('/heat-map/data/whitefield-layers.json'), 'renderSources re-reads the manifest on every switch');
  assert.ok(flat.includes('/heat-map/data/mg-road-surface.png'), 'surface-raster fetches the PNG on every switch');
  assert.ok(!flat.some((url) => url.includes('indiranagar')), 'never the ward already open');
});

test('a Kolkata plan asks for no GLB, because Kolkata has none', () => {
  const flat = prefetchPlan('in/kolkata/ballygunge').flat();
  assert.ok(flat.includes('/heat-map/data/baruipur.json'));
  assert.ok(!flat.some((url) => url.endsWith('.glb')));
});

test('runPrefetch goes ward by ward, reads every body, and stops when aborted', async () => {
  const calls = [];
  let bodies = 0;
  const controller = new AbortController();
  const fakeFetch = async (url) => {
    calls.push(url);
    return { arrayBuffer: async () => { bodies += 1; if (url === 'b1') controller.abort(); return new ArrayBuffer(0); } };
  };
  await runPrefetch([['a1', 'a2'], ['b1'], ['c1']], fakeFetch, controller.signal);
  assert.deepEqual(calls, ['a1', 'a2', 'b1'], 'the ward after the abort is never started');
  assert.equal(bodies, 3);
});
