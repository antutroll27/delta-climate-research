import assert from 'node:assert/strict';
import test from 'node:test';
import { recencyBucket, coverageColorExpression, assertCoverageLogic } from '../../src/scripts/climate-engine/streetview/coverage-layer.ts';
import { nearestImage, asNearest } from '../../src/scripts/climate-engine/streetview/nearest-image.ts';

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

test('asNearest parses a Graph image row and string-casts the id', () => {
  assert.equal(asNearest({}), null);
  const n = asNearest({ id: 12345678901234567, thumb_1024_url: 'https://x/t.jpg', captured_at: 1700000000000 });
  assert.ok(n && typeof n.id === 'string' && n.thumbUrl === 'https://x/t.jpg' && n.capturedAt === 1700000000000);
});

test('nearestImage hits the radius search and returns the first result', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({ data: [{ id: '99', thumb_1024_url: 'https://x/9.jpg', captured_at: 1710000000000 }] }) }; };
  const n = await nearestImage(88.371, 22.762, 'MLY|tok', fakeFetch);
  assert.ok(n && n.id === '99');
  assert.match(calls[0], /lat=22\.762/); assert.match(calls[0], /lng=88\.371/); assert.match(calls[0], /radius=50/);
});

test('nearestImage returns null on empty coverage', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  assert.equal(await nearestImage(88.43, 22.36, 'MLY|tok', fakeFetch), null);
});

import { shouldOpen, assertStreetViewLogic } from '../../src/scripts/climate-engine/streetview/street-view-panel.ts';

test('shouldOpen guards missing token / imageId (no viewer construction)', () => {
  assert.equal(shouldOpen('', 'img1'), false);
  assert.equal(shouldOpen('MLY|t', ''), false);
  assert.equal(shouldOpen('MLY|t', 'img1'), true);
});
test('street-view self-check passes', () => { assertStreetViewLogic(); });
