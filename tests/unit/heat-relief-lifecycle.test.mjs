import test from 'node:test';
import assert from 'node:assert/strict';

const {
  attachReliefCustomLayer,
  isReliefLayerAttached,
  shouldShowRelief,
} = await import('../../src/scripts/climate-engine/explore/relief-lifecycle.ts');

function mapHarness({ reject = false } = {}) {
  const layers = new Map();
  return {
    layers,
    map: {
      getLayer: (id) => layers.get(id),
      addLayer: (layer) => {
        if (reject) throw new Error('style not ready');
        layers.set(layer.id, layer);
      },
    },
  };
}

test('relief attaches without an isStyleLoaded gate once addLayer is valid', () => {
  const { map } = mapHarness();
  const layer = { id: 'delta-city', type: 'custom', render() {} };
  assert.equal(attachReliefCustomLayer(map, layer), true);
  assert.equal(isReliefLayerAttached(map, layer.id), true);
});

test('core remains visible when a relief renderer exists but its layer did not attach', () => {
  const { map } = mapHarness({ reject: true });
  const layer = { id: 'delta-city', type: 'custom', render() {} };
  const attached = attachReliefCustomLayer(map, layer);
  assert.equal(attached, false);
  assert.equal(shouldShowRelief(attached), false);
});

/* 2D Isotherm is a camera state over the same 3D scene, so the relief layer must
   keep RENDERING there. Hiding it makes MapLibre's painter skip the custom layer
   entirely, which empties the isotherm view of the city and freezes the renderer's
   pick matrix at the last relief-mode camera — clicks then open the card for the
   wrong building. Visibility is a renderer question, never a view-mode question. */
test('relief keeps rendering in every view mode once attached', () => {
  assert.equal(shouldShowRelief(true), true);
  assert.equal(shouldShowRelief(false), false);
  assert.equal(shouldShowRelief.length, 1, 'view mode must not be an input to relief visibility');
});
