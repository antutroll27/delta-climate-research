import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = () => readFile(join(ROOT, 'api/live.js'), 'utf8');

test('the proxy identifies itself, as met.no requires', async () => {
  const s = await src();
  assert.match(s, /['"]User-Agent['"]/,
    'met.no: "All requests must include an identifying User Agent-string… Failure to '
    + 'identify risks being blocked without warning." A browser cannot set this header, '
    + 'which is the whole reason this proxy exists.');
  assert.match(s, /deltaclimate\.earth/,
    'the UA must carry the domain so met.no can identify us');
  assert.match(s, /@/, 'the UA must carry a contact address');
});

test('only latitude and longitude reach met.no', async () => {
  const s = await src();
  assert.doesNotMatch(s, /req\.url/,
    'forwarding the raw URL would pass arbitrary query strings upstream; read lat/lon '
    + 'from req.query and rebuild the URL');
  assert.match(s, /Number\.isFinite/,
    'lat/lon must be parsed as numbers, not interpolated as strings');
});

test('responses are cached so N visitors are not N upstream calls', async () => {
  const s = await src();
  assert.match(s, /Cache-Control/,
    'met.no asks clients to respect cache headers; collapsing visitors into one upstream '
    + 'call per window is the point of a backend-for-frontend');
  assert.match(s, /s-maxage/, 'the shared CDN cache is what actually collapses the calls');
});

test('no secret is present — this endpoint needs none', async () => {
  const s = await src();
  assert.doesNotMatch(s, /process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/,
    'met.no is keyless; anything that looks like a credential here is a mistake');
});
