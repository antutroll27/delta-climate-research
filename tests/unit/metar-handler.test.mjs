// tests/unit/metar-handler.test.mjs — GET /api/metar, the airport-observation proxy.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handle, UPSTREAM } from '../../api/metar.ts';
import { parseMetar } from '../../src/lib/weather/metar.ts';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const FIX = JSON.parse(readFileSync(new URL('../fixtures/metar/metar-20261007T0609Z.json', import.meta.url), 'utf8'));
const NOW = () => new Date('2026-10-07T06:09:00Z');
const ok = (rows) => async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
const noFetch = async () => { throw new Error('must not fetch'); };

test('only GET', async () => {
  const r = res(); await handle({ method: 'POST', query: { ids: 'VECC' } }, r, { fetch: noFetch });
  assert.equal(r.code, 405); assert.equal(r.headers.Allow, 'GET');
});

test('only the stations OBOS reads, in canonical order — anything else is 400 without an upstream call', async () => {
  for (const q of [{}, { ids: '' }, { ids: 'KJFK' }, { ids: 'VOBL,VOBG' }, { ids: 'VECC,VECC' },
    { ids: ['VECC'] }, { ids: 'VECC', hours: '30' }, { ids: '__proto__' }, { ids: 'vecc' }]) {
    const r = res(); await handle({ method: 'GET', query: q }, r, { fetch: noFetch });
    assert.equal(r.code, 400, JSON.stringify(q));
    assert.equal(r.headers['Cache-Control'], 'no-store');
  }
});

test('a good answer: raw reports for the asked stations, cached at the edge for 10 minutes', async () => {
  let asked = null, ua = null;
  const r = res();
  await handle({ method: 'GET', query: { ids: 'VOBG,VOBL' } }, r, {
    now: NOW,
    fetch: async (u, init) => { asked = String(u); ua = init?.headers?.['User-Agent']; return ok(FIX)(); },
  });
  assert.equal(r.code, 200);
  assert.ok(asked.startsWith(UPSTREAM), asked);
  assert.match(asked, /ids=VOBG,VOBL/); assert.match(asked, /format=json/); assert.match(asked, /hours=4/);
  assert.match(ua, /deltaclimate\.earth/, 'aviationweather.gov asks for a custom User-Agent');
  assert.match(r.headers['Cache-Control'], /s-maxage=600/);
  assert.equal(r.body.source, 'aviationweather.gov');
  assert.equal(r.body.fetchedAt, '2026-10-07T06:09:00.000Z');
  assert.ok(r.body.reports.length > 0);
  assert.ok(r.body.reports.every(x => x.icao === 'VOBG' || x.icao === 'VOBL'), 'stations not asked for are dropped');
  // every raw report still parses on the client
  for (const x of r.body.reports) assert.ok(parseMetar(x.raw, Date.parse(r.body.fetchedAt)), x.raw);
});

test('upstream failure is 502, never cached', async () => {
  for (const f of [async () => new Response('x', { status: 503 }), async () => { throw new Error('ECONNRESET'); },
    async () => new Response('not json', { status: 200 })]) {
    const r = res(); const orig = console.error; console.error = () => {};
    try { await handle({ method: 'GET', query: { ids: 'VECC' } }, r, { fetch: f, now: NOW }); } finally { console.error = orig; }
    assert.equal(r.code, 502); assert.equal(r.headers['Cache-Control'], 'no-store');
  }
});

test('no reports (204) is an honest empty list, cached briefly', async () => {
  const r = res();
  await handle({ method: 'GET', query: { ids: 'VECC' } }, r, { fetch: async () => new Response(null, { status: 204 }), now: NOW });
  assert.equal(r.code, 200); assert.deepEqual(r.body.reports, []);
  assert.match(r.headers['Cache-Control'], /s-maxage=120/);
});

test('hostile upstream shapes cannot inject: strings only, bounded', async () => {
  const rows = [{ icaoId: 'VECC', rawOb: 'X'.repeat(5000) }, { icaoId: 'VECC', rawOb: 42 }, { icaoId: 'VECC' }, null, 'str',
    { icaoId: 'VECC', rawOb: 'METAR VECC 070600Z 05004KT 3200 -RA BKN100 31/23 Q1015' }];
  const r = res();
  await handle({ method: 'GET', query: { ids: 'VECC' } }, r, { fetch: ok(rows), now: NOW });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.reports.map(x => x.raw), ['METAR VECC 070600Z 05004KT 3200 -RA BKN100 31/23 Q1015']);
});

test('no secret: aviationweather.gov is keyless', async () => {
  const s = await readFile(new URL('../../api/metar.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/);
});
