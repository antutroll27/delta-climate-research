// tests/unit/aqi-openaq.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSensorWindow, OpenAqError } from '../../src/lib/aqi/openaq.ts';

const page = (n, from) => ({ results: Array.from({ length: n }, (_, i) => ({ value: i, period: { datetimeTo: { utc: new Date(Date.parse(from) + i * 900_000).toISOString() } } })) });

test('pages until a short page and sends the key only as a header', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url: String(url), key: init.headers['X-API-Key'] });
    return new Response(JSON.stringify(calls.length === 1 ? page(1000, '2026-09-01T00:15:00Z') : page(3, '2026-09-12T00:15:00Z'))); };
  const rows = await fetchSensorWindow(123, '2026-09-01T00:00:00Z', '2026-09-25T00:00:00Z', { key: 'k', fetch: fake });
  assert.equal(rows.length, 1003);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.key === 'k' && !c.url.includes('k=') && !c.url.includes('api_key')));
});

test('malformed rows are dropped, not coerced to zero', async () => {
  const fake = async () => new Response(JSON.stringify({ results: [{ value: 'x', period: { datetimeTo: { utc: '2026-09-01T00:15:00Z' } } }, { value: 5, period: {} }, { value: 7, period: { datetimeTo: { utc: '2026-09-01T00:30:00Z' } } }] }));
  const rows = await fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake });
  assert.deepEqual(rows, [{ end_utc: '2026-09-01T00:30:00Z', value: 7 }]);
});

test('numeric strings and nulls are dropped, never coerced by Number()', async () => {
  const at = (m) => ({ period: { datetimeTo: { utc: `2026-09-01T00:${m}:00Z` } } });
  const fake = async () => new Response(JSON.stringify({ results: [{ value: '12', ...at('15') }, { value: null, ...at('30') }, { value: '', ...at('45') }, { value: 9, ...at('00') }] }));
  const rows = await fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake });
  assert.deepEqual(rows, [{ end_utc: '2026-09-01T00:00:00Z', value: 9 }]);
});

test('an upstream error becomes a typed OpenAqError', async () => {
  const fake = async () => new Response('nope', { status: 503 });
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake }), (e) => e instanceof OpenAqError && e.status === 503);
});

test('a window that fills the last allowed page rejects instead of truncating', async () => {
  let n = 0;
  const fake = async () => { n += 1; return new Response(JSON.stringify(page(1000, n === 1 ? '2026-09-01T00:15:00Z' : '2026-09-11T10:15:00Z'))); };
  await assert.rejects(fetchSensorWindow(42, 'a', 'b', { key: 'k', fetch: fake, maxPages: 2 }),
    (e) => e instanceof OpenAqError && e.status === 502 && /exceeded 2 pages/.test(e.message) && e.message.includes('42'));
  assert.equal(n, 2);
});

test('a short final page within maxPages still resolves', async () => {
  let n = 0;
  const fake = async () => { n += 1; return new Response(JSON.stringify(n === 1 ? page(1000, '2026-09-01T00:15:00Z') : page(999, '2026-09-11T10:15:00Z'))); };
  const rows = await fetchSensorWindow(42, 'a', 'b', { key: 'k', fetch: fake, maxPages: 2 });
  assert.equal(rows.length, 1999);
});

test('a timeout becomes OpenAqError 504', async () => {
  // Honours the signal the way real fetch does: rejects with signal.reason (a DOMException TimeoutError).
  const fake = (_url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake, timeoutMs: 20 }),
    (e) => e instanceof OpenAqError && e.status === 504);
});

test('a network TypeError becomes OpenAqError 502', async () => {
  const fake = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake }), (e) => e instanceof OpenAqError && e.status === 502);
});

test('a 200 with a non-JSON body becomes OpenAqError 502', async () => {
  const fake = async () => new Response('<html>gateway</html>', { status: 200 });
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake }), (e) => e instanceof OpenAqError && e.status === 502);
});

test('a JSON body that is not an object becomes OpenAqError 502', async () => {
  const fake = async () => new Response('null', { status: 200 });
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake }), (e) => e instanceof OpenAqError && e.status === 502);
});

test('error messages never carry the key or the URL', async () => {
  const key = 'SECRET-KEY-abc123';
  const leaky = [
    async (u) => { throw new TypeError(`fetch failed for ${u} with ${key}`); },
    async (u) => new Response(`bad key ${key} at ${u}`, { status: 401 }),
    async () => new Response(`not json ${key}`, { status: 200 }),
    async (u) => { throw new DOMException(`timed out ${u} ${key}`, 'TimeoutError'); },
  ];
  for (const fake of leaky) {
    await assert.rejects(fetchSensorWindow(7, 'a', 'b', { key, fetch: fake }), (e) => {
      assert.ok(e instanceof OpenAqError);
      assert.ok(!e.message.includes(key), 'key in message');
      assert.ok(!e.message.includes('api.openaq.org'), 'URL in message');
      assert.ok(!String(e.stack).includes(key), 'key in stack');
      assert.equal(e.cause, undefined);
      return true;
    });
  }
});
