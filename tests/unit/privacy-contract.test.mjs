import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import climateClockHandler from '../../api/climate-clock.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFile(join(ROOT, path), 'utf8');

test('approved Vercel telemetry stays explicit in the shared layout', async () => {
  const base = await read('src/layouts/Base.astro');
  assert.match(base, /@vercel\/analytics\/astro/);
  assert.match(base, /<Analytics\s*\/>/);
  assert.match(base, /@vercel\/speed-insights\/astro/);
  assert.match(base, /<SpeedInsights\s*\/>/);
});

test('Climate Clock data goes through the same-origin privacy proxy', async () => {
  const client = await read('src/scripts/climate-clock.ts');
  const proxy = await read('api/climate-clock.js');

  assert.match(client, /fetch\(['"]\/api\/climate-clock['"]/);
  assert.doesNotMatch(client, /api\.climateclock\.world/);
  assert.match(proxy, /https:\/\/api\.climateclock\.world\/v2\/clock\.json/);
  assert.match(proxy, /management@deltaclimate\.earth/);
  assert.match(proxy, /s-maxage/);
});

test('Climate Clock proxy returns and caches only the upstream public payload', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ data: { modules: { carbon_deadline_1: { initial: 1 } } } }),
    };
  };

  const headers = new Map();
  const response = {
    statusCode: 0,
    body: undefined,
    setHeader(name, value) { headers.set(name, value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };

  try {
    await climateClockHandler({ method: 'GET' }, response);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    data: { modules: { carbon_deadline_1: { initial: 1 } } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.climateclock.world/v2/clock.json');
  assert.equal(calls[0].init.headers['User-Agent'],
    'delta-climate-research/1.0 (https://deltaclimate.earth; management@deltaclimate.earth)');
  assert.match(headers.get('Cache-Control'), /s-maxage=3600/);
});

test('the met.no integration uses the designated organisation contact', async () => {
  const live = await read('api/live.js');
  assert.match(live, /angad@deltaclimate\.earth/);
  assert.doesNotMatch(live, /kumarantar98@gmail\.com/);
});
