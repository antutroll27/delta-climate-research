import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handle } from '../../api/air-quality.ts';
import { LOCAL_LIVE_MS } from '../../src/lib/aqi/local-areas.ts';
import { liveCacheControl, newLocalCache } from '../../src/lib/aqi/local-handler.ts';
import { judge } from '../../src/lib/aqi/local-judge.ts';
import { readAmsterdam } from '../../src/lib/aqi/luchtmeetnet.ts';
import { loadLocalAir } from '../../src/scripts/climate-engine/air/local-air-panel.ts';

/* F1 (audit 2026-11-06): hard rule 2, no stale number shown as current. Two holes: the browser judged a payload's
   age once, when it painted, and the server returned a cached live payload without re-judging it. */
const read = (p) => readFileSync(p, 'utf8');
const NL = 'tests/fixtures/aqi/nl/';
const HOUR_END = Date.parse('2026-11-06T13:00:00Z');
const at = (min) => new Date(HOUR_END + min * 60_000);
const AREA = 'nl/amsterdam/canal-ring';
/** Any LKI / measurements URL gets the recorded Vondelpark answer (its newest row is the hour ending 13:00Z). */
const hook = (url) => (url.includes('/lki?') ? read(NL + 'lki-NL49014.json') : url.includes('/measurements?') ? read(NL + 'measurements-NL49014.json') : undefined);
const fetchOf = (calls = []) => async (url) => {
  calls.push(url);
  const b = hook(url);
  return b === undefined ? { ok: false, status: 503, text: async () => '' } : { ok: true, status: 200, text: async () => b };
};
const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const call = async (now, cache, f) => { const r = res(); await handle({ method: 'GET', query: { area: AREA } }, r, { key: '', local: { fetch: f, now: () => now, drawable: () => true, cache } }); return r; };

test('a card painted at t=0 flips to "Not reporting" once the window passes, with no reload', async () => {
  const live = await readAmsterdam(AREA, { fetch: fetchOf(), now: at(40) });
  const io = { fetch: async () => ({ ok: true, json: async () => live }), signal: new AbortController().signal, isCurrent: () => true, now: at(40) };
  const paint = await loadLocalAir(AREA, 'Canal Ring', io);
  assert.match(paint.block, /class="num">3</);
  assert.equal(typeof paint.refresh, 'function', 'the painter hands the app a way to re-judge the payload it kept');
  const mid = paint.refresh(at(100));
  assert.match(mid.block, /chip live/, '100 minutes after the hour closed: still current');
  const edge = paint.refresh(at(120));
  assert.match(edge.block, /chip live/, 'exactly at the window: still current');
  const late = paint.refresh(at(121));
  for (const h of [late.block, late.pane]) {
    assert.match(h, /Not reporting/);
    assert.ok(!/class="num"/.test(h) && !h.includes('16.2') && !h.includes('22.9'), 'no value in the markup');
  }
  assert.match(late.status, /not reporting/);
});

test('the app re-judges on its EXISTING one-minute clock tick, not a new timer', () => {
  const src = read('src/scripts/climate-engine/heat-map-app.ts');
  assert.match(src, /const clockTick = window\.setInterval\(\(\) => \{ paintClock\(\); [^}]*refreshAir\(\)/);
  const airTimers = [...src.matchAll(/setInterval\(/g)].length;
  assert.equal(airTimers, 2, 'the clock tick and the METAR tick: no third timer was added');
  assert.match(src, /function refreshAir\(\)/);
  assert.match(src, /airRefresh = v\.refresh/);
});

test('a cached live hour that has since expired never comes back as live (128 minutes old)', async () => {
  const cache = newLocalCache();
  const calls = [];
  const first = await call(at(119), cache, fetchOf(calls));
  assert.equal(first.body.state, 'live', 'fresh at 119 minutes');
  const n = calls.length;
  const second = await call(at(128), cache, fetchOf(calls));
  assert.ok(calls.length > n, 'the expired entry was not served; the source was asked again');
  assert.equal(second.body.state, 'not_reporting');
  assert.equal(second.body.reason, 'no_current_hour');
  assert.equal(second.headers['Cache-Control'], 'no-store');
});

test('judge is one function for the server and the browser: live inside the window, not reporting past it', async () => {
  const live = await readAmsterdam(AREA, { fetch: fetchOf(), now: at(30) });
  assert.equal(judge(live, at(120)).state, 'live');
  const j = judge(live, new Date(HOUR_END + LOCAL_LIVE_MS['nl-lki'] + 1));
  assert.deepEqual([j.state, j.reason, j.last_observed_at], ['not_reporting', 'no_current_hour', live.observed_at]);
});

test('Cache-Control can never outlive the live window: max-age + s-maxage + stale-while-revalidate <= time left', async () => {
  const live = await readAmsterdam(AREA, { fetch: fetchOf(), now: at(40) });
  const total = (h) => [...h.matchAll(/(?:s-maxage|stale-while-revalidate)=(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(liveCacheControl(live, at(40)), 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
  for (const min of [40, 90, 100, 110, 115, 118, 119.5]) {
    const h = liveCacheControl(live, at(min));
    const left = (HOUR_END + LOCAL_LIVE_MS['nl-lki'] - at(min).getTime()) / 1000;
    assert.ok(total(h) <= left + 1e-9, `${min} min: ${h} vs ${left} s left`);
    assert.ok(Number(/max-age=(\d+)/.exec(h)[1]) <= left, `${min} min: browser max-age`);
  }
  assert.equal(liveCacheControl(live, at(120)), 'no-store', 'nothing left to hold');
  assert.equal(liveCacheControl(live, at(125)), 'no-store');
});

/* F5 (audit): Luchtmeetnet allows 100 requests / 5 min; an outage walks five rungs, so a failure answer is held in-process for 60 s. */
test('F5: a not-reporting answer is held 60 s in the function (CDN still no-store), then the source is asked again', async () => {
  const cache = newLocalCache();
  const calls = [];
  const down = async (url) => { calls.push(url); return { ok: false, status: 503, text: async () => '' }; };
  const a = await call(at(40), cache, down);
  assert.deepEqual([a.body.state, a.body.reason], ['not_reporting', 'source_down']);
  assert.equal(a.headers['Cache-Control'], 'no-store');
  const n = calls.length;
  assert.equal(n, 5, 'one LKI request per rung');
  for (let i = 0; i < 20; i++) await call(new Date(at(40).getTime() + i * 2_900), cache, down); // 20 page views inside 58 s
  assert.equal(calls.length, n, 'no further request to the source inside the back-off');
  const b = await call(new Date(at(40).getTime() + 61_000), cache, down);
  assert.equal(calls.length, 2 * n, 'after 60 s it asks again');
  assert.equal(b.headers['Cache-Control'], 'no-store');
  const recovered = await call(new Date(at(40).getTime() + 125_000), cache, fetchOf(calls));
  assert.equal(recovered.body.state, 'live', 'and a recovered source is live again');
});
