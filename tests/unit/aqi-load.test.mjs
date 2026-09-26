// tests/unit/aqi-load.test.mjs
/* THE FETCH-AND-CHOOSE STEP, run against a fake fetch. heat-map-app.ts only moves
   what `loadAir` returns into the DOM, so every decision about WHAT the reader sees
   after a request (the payload, the designed failure, or nothing at all because the
   answer is for an area they have already left) is made here, where it can be run. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAir, cardHtml, paneHtml, unavailableHtml, loadingPaneHtml, uncoveredPaneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const raw = (lastEnd) => { const e = Date.parse(lastEnd), o = {}; for (const p of ['pm25','pm10','no2','so2','co','o3']) { o[p] = []; for (let t = e - 31*864e5; t <= e; t += 9e5) o[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 }); } return o; };
const K = 'in/kolkata/ballygunge';
const NOW = new Date('2026-09-26T08:30:00Z');
const PAYLOAD = buildPayload(K, stationFor(K), raw('2026-09-24T17:30:00Z'), NOW);

/** A fake fetch: records the url, answers with `res` (or throws it). */
function fakeFetch(res) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); if (res instanceof Error) throw res; return res; };
  return { f, calls };
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const run = (res, { isCurrent = () => true, ctl = new AbortController() } = {}) => {
  const { f, calls } = fakeFetch(res);
  return { calls, out: loadAir(K, 'Ballygunge', { fetch: f, signal: ctl.signal, isCurrent, now: NOW }) };
};
const assertFailed = (v) => {
  assert.ok(v, 'a failure paints the designed view, not nothing');
  assert.equal(v.block, unavailableHtml('Ballygunge'), 'the block shows unavailableHtml');
  assert.match(v.pane, /could not be loaded/, 'the pane says the same thing');
  assert.match(v.pane, /id="pane-air-h"/, 'the pane keeps its labelled heading');
  assert.doesNotMatch(v.pane + v.block, /class="num/, 'a failure never prints a number');
  assert.deepEqual(v.days, []);
};

test('a good payload paints the card and the pane from the painters', async () => {
  const { out, calls } = run(json(PAYLOAD));
  const v = await out;
  assert.equal(calls[0].url, '/api/air-quality?area=in%2Fkolkata%2Fballygunge');
  assert.ok(calls[0].init.signal, 'the request carries the abort signal');
  assert.equal(v.block, cardHtml(PAYLOAD, 'Ballygunge', NOW));
  assert.equal(v.pane, paneHtml(PAYLOAD, 'Ballygunge', NOW));
  assert.equal(v.days, PAYLOAD.history.days);
});
test('a 500 paints the designed failure, and its body is never read', async () => {
  let read = false;
  assertFailed(await run({ ok: false, status: 500, json: async () => { read = true; return PAYLOAD; } }).out);
  assert.equal(read, false, 'a non-OK body is not trusted, even if it parses');
});
test('a network error paints the designed failure', async () => {
  assertFailed(await run(new TypeError('Failed to fetch')).out);
});
test('a body that is not JSON paints the designed failure', async () => {
  assertFailed(await run({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }).out);
});
test('a body with no `current` paints the designed failure', async () => {
  assertFailed(await run(json({ error: 'upstream' })).out);
  assertFailed(await run(json(null)).out);
  assertFailed(await run(json({ current: { nope: 1 } })).out);
});
test('an aborted request paints nothing', async () => {
  const ctl = new AbortController(); ctl.abort();
  const err = new DOMException('aborted', 'AbortError');
  assert.equal(await run(err, { ctl }).out, null);
});
test('an answer for an area the reader has left paints nothing, success or failure', async () => {
  assert.equal(await run(json(PAYLOAD), { isCurrent: () => false }).out, null);
  assert.equal(await run(json({}, 500), { isCurrent: () => false }).out, null);
  assert.equal(await run(new TypeError('Failed to fetch'), { isCurrent: () => false }).out, null);
});
test('the loading and not-covered panes name the place and keep the heading', () => {
  for (const [html, say] of [[loadingPaneHtml('Ballygunge'), /Loading air quality…/], [uncoveredPaneHtml('MG <Road>'), /covers Kolkata first; this city is not yet covered/]]) {
    assert.match(html, /<p class="pane-h" id="pane-air-h">Air · /);
    assert.match(html, say);
    assert.doesNotMatch(html, /<Road>/, 'the place is escaped');
  }
});
