import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { handle } from '../../api/air-quality.ts';
import { isAirCity } from '../../src/lib/aqi/stations.ts';
import { localAirReady } from '../../src/lib/aqi/local-areas.ts';
import { publicAreaPaths } from '../../src/scripts/climate-engine/scope/public-routes.ts';
import { AREA_KEYS, PUBLIC_AREA_KEYS, REGISTRY, isAreaKey, isDrawable } from '../../src/scripts/climate-engine/scope/registry.ts';

/**
 * TOKYO'S AIR CARD SHIPS DARK. The Soramame adapter, its standards and its painter are wired, but Tokyo is not a public city:
 * it has no registry entry, so there is no route, no sitemap row, no API answer, and no Air card to open. This file pins every
 * one of those, so adding the adapter cannot publish Tokyo by itself. Flipping Tokyo on is a registry decision (a `drawable`
 * area) and then these assertions are the ones to change on purpose.
 */
const KEY = 'jp/tokyo/marunouchi';
const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };

test('Tokyo is not in the registry, not public, not drawable, and has no Air card', () => {
  assert.equal(Object.hasOwn(REGISTRY, 'jp'), false, 'no Japan entry in the registry');
  assert.equal(isAreaKey(KEY), false);
  assert.ok(!AREA_KEYS.some((k) => /tokyo|^jp\//.test(k)));
  assert.ok(!PUBLIC_AREA_KEYS.some((k) => /tokyo|^jp\//.test(k)));
  assert.equal(isDrawable('jp', 'tokyo', 'marunouchi'), false);
  assert.equal(localAirReady(KEY), false, 'the real drawable gate, not an injected one');
  assert.equal(isAirCity(KEY), false);
});

test('no route and no sitemap row for Tokyo', () => {
  assert.ok(!publicAreaPaths().some((p) => /tokyo|\/jp\//i.test(p)));
});

test('the API answers Tokyo like an unknown area with the real gate, and fetches nothing', async () => {
  let calls = 0;
  const r = res();
  await handle({ method: 'GET', query: { area: KEY } }, r, { key: '', local: { fetch: async () => { calls += 1; throw new Error('must not fetch'); } } });
  assert.equal(r.code, 404);
  assert.deepEqual(r.body, { error: 'unknown area' });
  assert.equal(calls, 0);
});

/* Built pages: every emitted HTML, XML and JSON file is free of Tokyo and Soramame. The one allowed carrier is the heat-map app's JS chunk,
   which holds the dormant Tokyo painter and config behind the gate above; a second JS file naming Tokyo would be a leak the other tests miss. */
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
test('the build output names Tokyo only in the heat-map app chunk (dormant, gated); no page, sitemap, feed or data file does', { skip: !existsSync('dist') && 'needs dist/ (npm run build)' }, () => {
  const named = walk('dist').filter((f) => /\.(html|xml|json|txt|js|css|webmanifest|svg)$/.test(f))
    .filter((f) => /tokyo|soramame|そらまめ/i.test(readFileSync(f, 'utf8')));
  const unexpected = named.filter((f) => !/\/_astro\/heat-map-app\.[^/]+\.js$/.test(f));
  assert.deepEqual(unexpected, [], 'Tokyo or Soramame appears in a public file other than the app chunk');
});
