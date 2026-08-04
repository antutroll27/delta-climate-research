import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutCumulus, layoutVeil, fitLobes, cloudFuse, CLOUD }
  from '../../src/scripts/climate-engine/cloud-sprites.ts';

/** Deterministic source so a layout can be asserted at all. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

test('no lobe reaches the sprite border, at any roundness or ovalness', () => {
  // This is the "straight edges" bug: lobes were positioned in canvas pixels and
  // overflowed, so the bitmap's own rectangle became the cloud's silhouette.
  for (const oval of [0, 0.36, 0.72, 1]) {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    for (const L of lobes) {
      const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
      assert.ok(gap >= W * 0.08,
        `oval ${oval}: a lobe sits ${gap.toFixed(1)}px from the border (need >= ${W * 0.08}). `
        + 'Overflow here is what made the clouds look like rectangles.');
    }
  }
});

test('ovalness widens the silhouette monotonically', () => {
  const aspect = (oval) => {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const L of lobes) {
      minX = Math.min(minX, L.cx - L.rx); maxX = Math.max(maxX, L.cx + L.rx);
      minY = Math.min(minY, L.cy - L.ry); maxY = Math.max(maxY, L.cy + L.ry);
    }
    return (maxX - minX) / (maxY - minY);
  };
  const a0 = aspect(0), a1 = aspect(0.72), a2 = aspect(1);
  assert.ok(a0 < a1 && a1 < a2, `aspect must increase with oval: ${a0} ${a1} ${a2}`);
  assert.ok(a1 > 3 && a1 < 4, `at the approved oval 0.72 expect ~3.4:1, got ${a1.toFixed(2)}`);
});

test('lobes are ellipses, squashed hardest at the base', () => {
  const lobes = layoutCumulus(seeded(7723117), 0.72).filter(L => L.main);
  const base = lobes.filter(L => L.cy > 0.45), crown = lobes.filter(L => L.cy < 0.2);
  const flat = (a) => a.reduce((s, L) => s + L.ry / L.rx, 0) / a.length;
  assert.ok(flat(base) < flat(crown),
    'a cumulus has a flat bottom and a domed top; base lobes must be flatter than crowns');
});

test('cover crosses from cumulus to veil, continuously', () => {
  assert.equal(cloudFuse(0), 0, 'clear sky is all cumulus');
  assert.equal(cloudFuse(1), 1, 'overcast is all veil');
  assert.equal(cloudFuse(0.42), 0, 'the crossover starts at 42% cover');
  let prev = -1;
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const f = cloudFuse(c);
    assert.ok(f >= prev - 1e-9, `fuse must not decrease: ${c} gave ${f} after ${prev}`);
    assert.ok(f >= 0 && f <= 1, `fuse out of range at ${c}: ${f}`);
    prev = f;
  }
});

test('the veil layout also stays inside its border', () => {
  const W = 768, H = Math.round(W * 0.44);
  const lobes = layoutVeil(seeded(31337));
  fitLobes(lobes, W, H, CLOUD.PAD);
  for (const L of lobes) {
    const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
    assert.ok(gap >= W * 0.08, `veil lobe ${gap.toFixed(1)}px from the border`);
  }
});

test('the approved constants are pinned', () => {
  assert.equal(CLOUD.ROUND, 0.62);
  assert.equal(CLOUD.OVAL, 0.72);
  assert.equal(CLOUD.SIZE, 0.72);
  assert.equal(CLOUD.DECK_M, 320);
  assert.equal(CLOUD.COUNT, 26);
});
