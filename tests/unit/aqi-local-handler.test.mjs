import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { handle } from '../../api/air-quality.ts';
import { localAirCityReady, localAirReady, LOCAL_LIVE_MS } from '../../src/lib/aqi/local-areas.ts';
import { newLocalCache } from '../../src/lib/aqi/local-handler.ts';
import { isLocalAirPayload } from '../../src/lib/aqi/local-valid.ts';
import { lkiUrl, measurementsUrl } from '../../src/lib/aqi/luchtmeetnet.ts';
import { METADATA_URL, SORAMAME_BASE } from '../../src/lib/aqi/soramame.ts';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const read = (p) => readFileSync(p, 'utf8');
const NL = 'tests/fixtures/aqi/nl/', JP = 'tests/fixtures/aqi/jp/';
const NL_NOW = new Date('2026-11-06T13:43:52Z');
const JP_NOW = new Date('2026-11-06T13:28:00Z');

function replay(map) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const body = map[url];
    if (body === undefined) return { ok: false, status: 503, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}
const nlMap = () => ({ [lkiUrl('NL49014', NL_NOW)]: read(NL + 'lki-NL49014.json'), [measurementsUrl('NL49014', NL_NOW)]: read(NL + 'measurements-NL49014.json') });
const jpMap = () => ({ [METADATA_URL]: read(JP + 'noudoAll-metadata.json'), [`${SORAMAME_BASE}/2026/11/06/21.csv`]: read(JP + 'noudoAll-2026-11-06-21.csv') });
const ready = () => true;
const call = async (area, local, query = {}) => { const r = res(); await handle({ method: 'GET', query: { area, ...query } }, r, { key: '', local }); return r; };

test('NOT DRAWABLE, NOT SERVED: until the city can be opened, its area is a 404 and nothing is fetched', async () => {
  const f = replay(nlMap());
  const r = await call('nl/amsterdam/canal-ring', { fetch: f.fetch, now: () => NL_NOW, drawable: () => false, cache: newLocalCache() });
  assert.equal(r.code, 404);
  assert.deepEqual(r.body, { error: 'unknown area' });
  assert.equal(f.calls.length, 0);
  assert.equal(localAirReady('nl/amsterdam/canal-ring', () => false), false);
  assert.equal(localAirCityReady('jp/tokyo/marunouchi', () => false), false);
  assert.equal(localAirReady('in/kolkata/ballygunge', ready), false, 'only the registered local areas are local');
});

test('once drawable, Amsterdam answers 200 with the LKI payload, cacheable for minutes not an hour', async () => {
  const f = replay(nlMap());
  const r = await call('nl/amsterdam/canal-ring', { fetch: f.fetch, now: () => NL_NOW, drawable: ready, cache: newLocalCache() });
  assert.equal(r.code, 200);
  assert.ok(isLocalAirPayload(r.body));
  assert.deepEqual([r.body.state, r.body.standard, r.body.lki.value, r.body.station.id], ['live', 'nl-lki', 3, 'NL49014']);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
});

test('once drawable, Tokyo answers 200 with provisional national-station readings', async () => {
  const f = replay(jpMap());
  const r = await call('jp/tokyo/marunouchi', { fetch: f.fetch, now: () => JP_NOW, drawable: ready, cache: newLocalCache() });
  assert.equal(r.code, 200);
  assert.ok(isLocalAirPayload(r.body));
  assert.deepEqual([r.body.state, r.body.standard, r.body.provisional], ['live', 'jp-eqs', true]);
  assert.ok(r.body.readings.every((x) => x.station.owner === '環境省'));
});

test('a source that is down is 200 "not reporting", uncached at the CDN and not remembered by the function', async () => {
  const cache = newLocalCache();
  const f = replay({});
  const a = await call('nl/amsterdam/canal-ring', { fetch: f.fetch, now: () => NL_NOW, drawable: ready, cache });
  assert.equal(a.code, 200);
  assert.deepEqual([a.body.state, a.body.reason], ['not_reporting', 'source_down']);
  assert.equal(a.headers['Cache-Control'], 'no-store');
  assert.ok(isLocalAirPayload(a.body));
  const before = f.calls.length;
  await call('nl/amsterdam/canal-ring', { fetch: f.fetch, now: () => NL_NOW, drawable: ready, cache });
  assert.ok(f.calls.length > before, 'the next request asks again');
  /* and the live one that follows is a live one, not the failure */
  const ok = replay(nlMap());
  const b = await call('nl/amsterdam/canal-ring', { fetch: ok.fetch, now: () => NL_NOW, drawable: ready, cache });
  assert.equal(b.body.state, 'live');
});

test('a live answer is held for 10 minutes and shared by concurrent requests; then it is read again', async () => {
  const cache = newLocalCache();
  const f = replay(nlMap());
  const deps = (now) => ({ fetch: f.fetch, now: () => now, drawable: ready, cache });
  const [a, b] = await Promise.all([call('nl/amsterdam/canal-ring', deps(NL_NOW)), call('nl/amsterdam/canal-ring', deps(NL_NOW))]);
  assert.equal(f.calls.length, 2, 'one LKI and one measurements request for two visitors');
  assert.deepEqual(a.body, b.body);
  await call('nl/amsterdam/canal-ring', deps(new Date(NL_NOW.getTime() + 9 * 60_000)));
  assert.equal(f.calls.length, 2, 'inside the window: from memory');
  await call('nl/amsterdam/canal-ring', deps(new Date(NL_NOW.getTime() + 11 * 60_000)));
  assert.ok(f.calls.length > 2, 'past the window: asked again');
});

test('an extra query parameter is refused before anything is read, as on the CPCB path', async () => {
  const f = replay(nlMap());
  const r = await call('nl/amsterdam/canal-ring', { fetch: f.fetch, now: () => NL_NOW, drawable: ready, cache: newLocalCache() }, { station: 'NL49012' });
  assert.equal(r.code, 400);
  assert.equal(f.calls.length, 0);
});

test('the payload validator refuses what the painter must never see', async () => {
  const live = (await call('nl/amsterdam/canal-ring', { fetch: replay(nlMap()).fetch, now: () => NL_NOW, drawable: ready, cache: newLocalCache() })).body;
  assert.ok(isLocalAirPayload(live));
  const bad = (m) => isLocalAirPayload({ ...live, ...m });
  assert.equal(bad({ state: 'stale' }), false);
  assert.equal(bad({ lki: { value: 3, band: 'bad' } }), false, 'a band that disagrees with its number');
  assert.equal(bad({ lki: { value: 3.5, band: 'good' } }), false);
  assert.equal(bad({ schema: 2 }), false);
  assert.equal(bad({ standard: 'cpcb' }), false);
  assert.equal(bad({ observed_at: 'yesterday' }), false);
  assert.equal(bad({ readings: [{ formula: 'CO', value: 3, observed_at: live.observed_at }] }), false);
  assert.equal(bad({ credit: { ...live.credit, line: '' } }), false);
  assert.equal(isLocalAirPayload(null), false);
  assert.equal(isLocalAirPayload({ ...live, state: 'not_reporting', reason: 'because', station: null, last_observed_at: null }), false);
});

test('the freshness windows are the ones the adapters state: 2 h Amsterdam, 3 h Tokyo', () => {
  assert.deepEqual([LOCAL_LIVE_MS['nl-lki'], LOCAL_LIVE_MS['jp-eqs']], [2 * 3_600_000, 3 * 3_600_000]);
});

test('SERVER-SIDE ONLY: no key and no environment read in any local-air file; the browser-bundled files import no adapter', () => {
  const dir = 'src/lib/aqi/';
  const files = ['local-areas.ts', 'local-handler.ts', 'local-types.ts', 'local-valid.ts', 'luchtmeetnet.ts', 'nl-stations.ts', 'soramame.ts', 'jp-stations.ts', 'jp-standards.ts', 'lki.ts', 'http.ts', 'geo.ts'];
  for (const f of files) {
    const code = read(dir + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/process\.env|import\.meta\.env|API_KEY|apikey|api_key|Authorization/i.test(code), `${f} reads a key or the environment`);
  }
  assert.ok(readdirSync(dir).includes('local-areas.ts'));
  for (const f of ['local-areas.ts', 'local-types.ts', 'local-valid.ts', 'lki.ts', 'jp-standards.ts']) {
    const imports = [...read(dir + f).matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
    for (const i of imports) assert.ok(!/luchtmeetnet|soramame|http|local-handler/.test(i), `${f} (client-safe) imports ${i}`);
  }
});

test('the user-agent is generic and carries no address, in every request the adapters make', () => {
  for (const f of ['http.ts', 'luchtmeetnet.ts', 'soramame.ts']) {
    const code = read('src/lib/aqi/' + f);
    assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(code.replace(/\/\*[\s\S]*?\*\//g, '')), `${f} contains an address`);
  }
  assert.match(read('src/lib/aqi/http.ts'), /obos-pipeline\/1\.0 \(\+https:\/\/deltaclimate\.earth\)/);
});
