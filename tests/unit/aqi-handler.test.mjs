// tests/unit/aqi-handler.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };

test('only GET', async () => { const r = res(); await handle({ method: 'POST', query: {} }, r, { key: 'k' }); assert.equal(r.code, 405); assert.equal(r.headers.Allow, 'GET'); });
test('unknown area is 404', async () => { const r = res(); await handle({ method: 'GET', query: { area: 'in/kolkata/nowhere' } }, r, { key: 'k' }); assert.equal(r.code, 404); });
test('missing key fails closed, with no upstream call, never cached', async () => { let called = false; const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: '', fetch: async () => { called = true; } }); assert.equal(r.code, 503); assert.equal(called, false);
  assert.equal(r.headers['Cache-Control'], 'no-store'); });
test('Baruipur answers no_station without calling OpenAQ, cacheable', async () => { const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/baruipur' } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'no_station'); assert.match(r.headers['Cache-Control'], /s-maxage=600/); });
test('upstream failure is 200 unavailable, never cached long, never a number', async () => { const r = res();
  const orig = console.error; console.error = () => {};
  try { await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: 'k', fetch: async () => new Response('x', { status: 503 }) }); }
  finally { console.error = orig; }
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'unavailable'); assert.match(r.headers['Cache-Control'], /s-maxage=60\b/); });

// Additions beyond the plan.
test('prototype keys are not areas', async () => { const r = res();
  await handle({ method: 'GET', query: { area: '__proto__' } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } }); assert.equal(r.code, 404); });
test('an array area is 404, not its first element', async () => { const r = res();
  await handle({ method: 'GET', query: { area: ['in/kolkata/ballygunge'] } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } }); assert.equal(r.code, 404); });
test('upstream failure is logged by area and status, and the key appears in no logged argument', async () => {
  const KEY = 'SECRET-XYZ', logged = [], orig = console.error;
  console.error = (...a) => { logged.push(a); };
  const r = res();
  try {
    await handle({ method: 'GET', query: { area: 'in/kolkata/barrackpore' } }, r, { key: KEY,
      fetch: async (u, init) => new Response(`bad key ${init?.headers?.['X-API-Key']} at ${u}`, { status: 401 }) });
  } finally { console.error = orig; }
  assert.equal(r.body.current.state, 'unavailable');
  assert.ok(logged.length >= 1, 'the failure was logged');
  assert.deepEqual(logged[0], ['air-quality upstream failure', 'in/kolkata/barrackpore', 401]);
  for (const args of logged) for (const a of args) {
    const s = typeof a === 'string' ? a : JSON.stringify(a) ?? String(a);
    assert.ok(!s.includes(KEY), 'key leaked into a log argument');
    assert.ok(!(a instanceof Error), 'raw error object logged');
  }
  assert.ok(!JSON.stringify(r.body).includes(KEY), 'key leaked into the response');
});

test('tsconfig rewrites .ts import specifiers, or the deployed function cannot load', () => {
  const src = readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(src);
  assert.equal(cfg.compilerOptions.rewriteRelativeImportExtensions, true,
    "Vercel's @vercel/node compiles api/*.ts file by file and keeps import specifiers verbatim: without rewriteRelativeImportExtensions, "
    + "api/air-quality.js imports '../src/lib/aqi/*.ts' files that are not shipped, and every request 500s (ERR_MODULE_NOT_FOUND, measured 2026-09-26).");
});
