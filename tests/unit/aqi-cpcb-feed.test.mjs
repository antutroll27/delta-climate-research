// tests/unit/aqi-cpcb-feed.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

export const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');

test("CPCB's feed carries SUB-INDICES: the published AQI is the largest Avg, and the predominant pollutant is the one holding it", () => {
  let n = 0;
  for (const m of FEED_XML.matchAll(/<Station id="([^"]+)"[^>]*>([\s\S]*?)<\/Station>/g)) {
    const a = /Air_Quality_Index Value="(\d+)" Predominant_Parameter="([^"]*)"/.exec(m[2]);
    if (!a) continue;
    const avgs = [...m[2].matchAll(/Pollutant_Index id="([^"]+)" Min="[^"]*" Max="[^"]*" Avg="(\d+)"/g)].map(([, p, v]) => [p, Number(v)]);
    const max = Math.max(...avgs.map(([, v]) => v));
    assert.equal(Number(a[1]), max, `${m[1]}: AQI ${a[1]} is not the largest Avg ${max}`);
    assert.ok(avgs.some(([p, v]) => p === a[2] && v === max), `${m[1]}: ${a[2]} does not hold the largest Avg`);
    n++;
  }
  assert.equal(n, 442, 'the capture had 442 stations with a numeric AQI');
});

import { FeedError, istStamp, parseFeed, pick } from '../../src/lib/aqi/cpcb-feed.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const one = (station, body) => `<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${station.replaceAll('BODY', body)}</City></State></Country></AqIndex>`;
const ST = (name = 'Ballygunge, Kolkata - WBPCB', lat = '22.5367507', lon = '88.3638022') => `<Station id="${name}" lastupdate="27-09-2026 05:00:00" latitude="${lat}" longitude="${lon}">BODY</Station>`;
const POLS = '<Pollutant_Index id="PM2.5" Min="19" Max="37" Avg="24" Hourly_sub_index="26"/><Pollutant_Index id="PM10" Min="18" Max="53" Avg="38" Hourly_sub_index="45"/><Pollutant_Index id="NO2" Min="16" Max="36" Avg="23" Hourly_sub_index="16"/>';

test('parseFeed reads the real capture: Ballygunge 38 PM10 and Barrackpore 46 PM10, seven sub-index rows each', () => {
  const feed = parseFeed(FEED_XML);
  assert.equal(feed.length, 481);
  const b = feed.find((s) => s.name === 'Ballygunge, Kolkata - WBPCB');
  assert.deepEqual({ aqi: b.aqi, dominant: b.dominant, published_at: b.published_at }, { aqi: 38, dominant: 'pm10', published_at: '2026-09-26T23:30:00.000Z' });
  assert.equal(b.subindices.length, 7);
  assert.deepEqual(b.subindices.find((q) => q.parameter === 'pm25'), { parameter: 'pm25', avg: 24, min: 19, max: 37, hourly: 26 });
  const s = feed.find((x) => x.name === 'SVSPA Campus, Barrackpore - WBPCB');
  assert.deepEqual({ aqi: s.aqi, dominant: s.dominant }, { aqi: 46, dominant: 'pm10' });
  assert.equal(s.subindices.find((q) => q.parameter === 'pm25').hourly, null, 'NA is null, never 0');
});

test('a blank AQI is null with no dominant; OZONE is o3', () => {
  const [g] = parseFeed(one(ST('G'), '<Pollutant_Index id="OZONE" Min="11" Max="12" Avg="11" Hourly_sub_index="11"/><Air_Quality_Index Value="" Predominant_Parameter=""/>'));
  assert.deepEqual({ aqi: g.aqi, dominant: g.dominant, p: g.subindices[0].parameter }, { aqi: null, dominant: null, p: 'o3' });
});

test('entities in names are decoded', () => {
  const [s] = parseFeed(one(ST('A &amp; B, X - Y'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(s.name, 'A & B, X - Y');
});

test('a station with a non-numeric value is dropped, never coerced; the rest survive', () => {
  const xml = one(ST('Bad') + ST('Good'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>')
    .replace('Avg="24"', 'Avg="2x"');
  assert.deepEqual(parseFeed(xml).map((s) => s.name), ['Good']);
});

test('lastupdate is IST, whatever the machine zone', () => {
  assert.equal(istStamp('27-09-2026 05:00:00'), '2026-09-26T23:30:00.000Z');
  assert.throws(() => istStamp('2026-09-27 05:00'), FeedError);
});

test('not a feed, or no stations, is a FeedError', () => {
  assert.throws(() => parseFeed('<html>busy</html>'), FeedError);
  assert.throws(() => parseFeed('<AqIndex></AqIndex>'), FeedError);
});

test("pick finds our station by exact name within 100 m, and only if CPCB's AQI is the largest Avg", () => {
  const st = stationFor('in/kolkata/ballygunge');
  assert.equal(pick(parseFeed(FEED_XML), st).aqi, 38);
  const moved = parseFeed(one(ST('Ballygunge, Kolkata - WBPCB', '22.5400', '88.3638022'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(moved, st), null, '370 m away is not our station');
  const odd = parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="99" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(odd, st), null, 'an AQI that is not the largest Avg means the fields changed meaning');
  const wrongLead = parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="NO2"/>'));
  assert.equal(pick(wrongLead, st), null, 'the predominant pollutant must be the one holding the largest Avg');
  assert.equal(pick(parseFeed(one(ST('Other'), POLS)), st), null);
});

import { FEED_MAX_BYTES, fetchFeed } from '../../src/lib/aqi/cpcb-feed.ts';

test('fetchFeed sends an identifying User-Agent and parses the body', async () => {
  let ua = '';
  const feed = await fetchFeed({ fetch: async (u, init) => { ua = init.headers['User-Agent']; return new Response(FEED_XML); } });
  assert.match(ua, /^delta-climate-research\//);
  assert.equal(feed.length, 481);
});

test('fetchFeed failures are FeedErrors: non-OK, oversize, network, timeout', async () => {
  await assert.rejects(fetchFeed({ fetch: async () => new Response('x', { status: 502 }) }), FeedError);
  await assert.rejects(fetchFeed({ fetch: async () => new Response(FEED_XML + ' '.repeat(FEED_MAX_BYTES)) }), { name: 'FeedError', message: 'CPCB feed too large' });
  await assert.rejects(fetchFeed({ fetch: async () => new Response(FEED_XML, { headers: { 'content-length': String(FEED_MAX_BYTES + 1) } }) }), { name: 'FeedError', message: 'CPCB feed too large' });
  await assert.rejects(fetchFeed({ fetch: async () => { throw new TypeError('fetch failed'); } }), FeedError);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(fetchFeed({ signal: ctl.signal, fetch: async (_u, init) => { init.signal.throwIfAborted(); return new Response(FEED_XML); } }), FeedError);
});

import { currentFromFeed } from '../../src/lib/aqi/cpcb-feed.ts';

const B = 'in/kolkata/ballygunge', stB = stationFor(B);
const at = (iso) => new Date(iso);
const bFeed = () => pick(parseFeed(FEED_XML), stB); // published 2026-09-26T23:30Z

test('≤ 2 h after publication is live, origin cpcb, with CPCB source', () => {
  const c = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:30:00Z'));
  assert.equal(c.state, 'live');
  assert.deepEqual({ o: c.result.origin, aqi: c.result.aqi, cat: c.result.category, dom: c.result.dominant, w: c.result.window_h }, { o: 'cpcb', aqi: 38, cat: 'good', dom: 'pm10', w: 24 });
  assert.equal(c.observed_at, '2026-09-26T23:30:00.000Z');
  assert.equal(c.source.via, 'CPCB');
  assert.equal(c.schema, 2);
});

test('2 h + 1 min is stale with its age; 7 days + 1 min falls back (null)', () => {
  const s = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:31:00Z'));
  assert.deepEqual({ st: s.state, age: s.age_h }, { st: 'stale', age: 2 });
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-10-03T23:31:00Z')), null);
});

test('CO or O3 leading means an 8-hour window', () => {
  const f = { ...bFeed(), dominant: 'o3' };
  assert.equal(currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z')).result.window_h, 8);
});

test('a blank AQI is insufficient_data (origin cpcb) when fresh, unavailable no_valid_aqi when stale', () => {
  const f = { ...bFeed(), aqi: null, dominant: null, subindices: bFeed().subindices.map((q) => (q.parameter.startsWith('pm') ? { ...q, avg: null } : q)) };
  const fresh = currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z'));
  assert.equal(fresh.state, 'insufficient_data');
  assert.equal(fresh.origin, 'cpcb');
  assert.deepEqual(fresh.reasons, ['No valid PM2.5 or PM10 reading']);
  const stale = currentFromFeed(f, B, stB, at('2026-09-27T05:00:00Z'));
  assert.deepEqual({ st: stale.state, r: stale.reason, at: stale.last_observed_at }, { st: 'unavailable', r: 'no_valid_aqi', at: '2026-09-26T23:30:00.000Z' });
});

test('a publication stamped more than 15 min in the future is not trusted (null)', () => {
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-09-26T23:00:00Z')), null);
});

/* ---- Audit I2: the parser is linear. Every hostile body up to the 2 MB cap parses or throws in under 200 ms. ---- */

const HOSTILE_MS = 200;
const HEAD = '<?xml version="1.0"?><AqIndex><Country id="India"><State id="X"><City id="Y">';
const TAIL = '</City></State></Country></AqIndex>';
const fill = (unit, room) => unit.repeat(Math.max(0, Math.floor(room / unit.length)));
const timed = (xml) => {
  assert.ok(xml.length >= 1_900_000 && xml.length <= FEED_MAX_BYTES, `a ${xml.length}-byte body is not near the cap`);
  const t = performance.now();
  try { parseFeed(xml); } catch (e) { assert.ok(e instanceof FeedError, `threw ${e}`); }
  return performance.now() - t;
};

test('the real capture parses exactly as it did before the linear rewrite (481 stations, deep-equal)', () => {
  const golden = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.parsed.json.gz', import.meta.url))).toString('utf8'));
  assert.deepEqual(parseFeed(FEED_XML), golden);
});

test('I2: a 2 MB opening tag with no "=" in it parses or throws in under 200 ms', () => {
  const ms = timed(HEAD + '<Station ' + 'a'.repeat(FEED_MAX_BYTES - HEAD.length - TAIL.length - 30) + '></Station>' + TAIL);
  assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms`);
});

test('I2: 2 MB of unclosed <Station> elements parses or throws in under 200 ms', () => {
  const u = '<Station id="S" lastupdate="27-09-2026 05:00:00" latitude="22.5" longitude="88.3">';
  const ms = timed(HEAD + fill(u, FEED_MAX_BYTES - HEAD.length - TAIL.length) + TAIL);
  assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms`);
});

test('I2: 2 MB of unterminated <Pollutant_Index> tags inside one station parses or throws in under 200 ms', () => {
  const open = '<Station id="S" lastupdate="27-09-2026 05:00:00" latitude="22.5" longitude="88.3">', close = '</Station>';
  const junk = fill('<Pollutant_Index id' + 'x'.repeat(40) + ' ', FEED_MAX_BYTES - HEAD.length - TAIL.length - open.length - close.length - 2);
  /* No ">" at all, and one distant "/>" that every unterminated tag would reach: both must stay linear. */
  for (const body of [junk, junk + '/>']) {
    const ms = timed(HEAD + open + body + close + TAIL);
    assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms (${body.endsWith('/>') ? 'with' : 'without'} a closing "/>")`);
  }
});

/* ---- Audit I3: one test per surviving mutation. ---- */
import { execFileSync } from 'node:child_process';
import { FEED_TIMEOUT_MS } from '../../src/lib/aqi/cpcb-feed.ts';

test('M2: a blank CPCB AQI still picks our station, and becomes insufficient_data from CPCB', () => {
  const f = pick(parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="" Predominant_Parameter=""/>')), stB);
  assert.ok(f, 'pick kept the station');
  assert.equal(f.aqi, null);
  const c = currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z'));
  assert.deepEqual({ st: c.state, o: c.origin }, { st: 'insufficient_data', o: 'cpcb' });
});

test('M4: two valid pollutants are too few for CPCB, even with PM present', () => {
  const f = { ...bFeed(), aqi: null, dominant: null, subindices: bFeed().subindices.map((q) => (['pm10', 'no2'].includes(q.parameter) ? q : { ...q, avg: null })) };
  assert.deepEqual(currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z')).reasons, ['2 valid pollutants; CPCB needs 3']);
});

test('M6: exactly 7 days old is still stale; 7 days and 1 ms falls back', () => {
  const pub = Date.parse('2026-09-26T23:30:00Z');
  assert.equal(currentFromFeed(bFeed(), B, stB, new Date(pub + 7 * 864e5)).state, 'stale');
  assert.equal(currentFromFeed(bFeed(), B, stB, new Date(pub + 7 * 864e5 + 1)), null);
});

test('M14: age_h is floored, never rounded up (2 h 50 min is 2 h)', () => {
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-09-27T02:20:00Z')).age_h, 2);
});

test('M18: the name must match exactly; a longer or shorter name at our position is not our station', () => {
  for (const name of ['Ballygunge, Kolkata - WBPCB (old)', 'Ballygunge, Kolkata']) {
    assert.equal(pick(parseFeed(one(ST(name), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>')), stB), null, name);
  }
});

test('M19: the feed timeout is 8 s, so CPCB settles well inside the function\'s 30 s', () => {
  assert.equal(FEED_TIMEOUT_MS, 8_000);
});

test('spec §8: the IST reading and the card\'s IST time hold in any machine zone (child processes under TZ)', () => {
  const root = new URL('../../', import.meta.url);
  const code = `const [f, p, s] = await Promise.all([import('./src/lib/aqi/cpcb-feed.ts'), import('./src/scripts/climate-engine/air/air-panel.ts'), import('./src/lib/aqi/stations.ts')]);
    const st = s.stationFor('in/kolkata/ballygunge'), now = new Date('2026-09-27T00:30:00Z');
    const one = '<AqIndex><Station id="Ballygunge, Kolkata - WBPCB" lastupdate="27-09-2026 05:00:00" latitude="22.5367507" longitude="88.3638022"><Pollutant_Index id="PM10" Min="18" Max="53" Avg="38" Hourly_sub_index="45"/><Air_Quality_Index Value="38" Predominant_Parameter="PM10"/></Station></AqIndex>';
    const c = f.currentFromFeed(f.pick(f.parseFeed(one), st), 'in/kolkata/ballygunge', st, now);
    const card = p.cardHtml({ current: c, history: null }, 'Ballygunge', now);
    console.log(JSON.stringify({ stamp: f.istStamp('27-09-2026 05:00:00'), state: c.state, time: /Published by CPCB at .*?<b>([^<]*)<\\/b>/.exec(card)?.[1] }));`;
  for (const TZ of ['UTC', 'America/New_York', 'Pacific/Kiritimati']) {
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: root, env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), { stamp: '2026-09-26T23:30:00.000Z', state: 'live', time: '27 Sept 05:00 IST' }, TZ);
  }
});

/* ---- Audit minors (M-d, M-e, M-f). ---- */
const AQ38 = '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>';

test('M-d: with every field present, the reason says the fields show no cause', () => {
  const f = { ...bFeed(), aqi: null, dominant: null };
  assert.deepEqual(currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z')).reasons, ['No cause is visible']);
});

test('M-e: pick rejects an AQI or any sub-index above 500 (off CPCB\'s scale), with or without a published AQI', () => {
  assert.notEqual(pick(parseFeed(one(ST(), POLS.replace('Avg="38"', 'Avg="500"') + '<Air_Quality_Index Value="500" Predominant_Parameter="PM10"/>')), stB), null, '500 is on the scale');
  assert.equal(pick(parseFeed(one(ST(), POLS.replace('Avg="38"', 'Avg="501"') + '<Air_Quality_Index Value="501" Predominant_Parameter="PM10"/>')), stB), null, 'AQI 501');
  assert.equal(pick(parseFeed(one(ST(), POLS.replace('Max="53"', 'Max="501"') + AQ38)), stB), null, 'a 24-h max of 501');
  assert.equal(pick(parseFeed(one(ST(), POLS.replace('Hourly_sub_index="16"', 'Hourly_sub_index="999"') + AQ38)), stB), null, 'a latest hour of 999');
  assert.equal(pick(parseFeed(one(ST(), POLS.replace('Max="53"', 'Max="501"') + '<Air_Quality_Index Value="" Predominant_Parameter=""/>')), stB), null, 'no AQI, but a sub-index of 501');
});

test('M-e: istStamp rejects impossible dates and times instead of rolling them over', () => {
  for (const s of ['31-02-2026 05:00:00', '30-02-2026 05:00:00', '27-09-2026 24:00:00', '27-13-2026 05:00:00', '27-09-2026 05:60:00']) assert.throws(() => istStamp(s), FeedError, s);
  assert.equal(istStamp('29-02-2028 23:59:59'), '2028-02-29T18:29:59.000Z', 'a real leap day');
});

test('M-e: an empty latitude or longitude rejects the station (Number("") is 0, not missing)', () => {
  for (const [lat, lon] of [['', '88.3638022'], ['22.5367507', ' ']]) {
    assert.throws(() => parseFeed(one(ST('Ballygunge, Kolkata - WBPCB', lat, lon), POLS + AQ38)), FeedError, `lat "${lat}" lon "${lon}"`);
  }
});

test('M-e: stations inside comments or CDATA are not stations; an unclosed one hides the rest, in linear time', () => {
  const st = (n) => ST(n).replace('BODY', POLS + AQ38);
  const xml = `<AqIndex><!-- ${st('Ghost')} --><![CDATA[${st('Ghost2')}]]>${st('Good')}</AqIndex>`;
  assert.deepEqual(parseFeed(xml).map((s) => s.name), ['Good']);
  assert.deepEqual(parseFeed(`<AqIndex>${st('Good')}<!-- ${st('Hidden')}</AqIndex>`).map((s) => s.name), ['Good'], 'an unclosed comment hides the rest');
  for (const opener of ['<!--', '<![CDATA[']) {
    const ms = timed(HEAD + fill(opener, FEED_MAX_BYTES - HEAD.length - TAIL.length) + TAIL);
    assert.ok(ms < HOSTILE_MS, `${opener}: ${ms.toFixed(0)} ms`);
  }
});

test('M-e: two stations with our exact name is ambiguous: fall back', () => {
  assert.equal(pick(parseFeed(one(ST() + ST(), POLS + AQ38)), stB), null);
});

test('M-f: a body with no content-length is cut off at the byte cap while streaming, and the stream is cancelled', async () => {
  let pulled = 0, cancelled = false;
  const chunk = new Uint8Array(64 * 1024).fill(32), total = 128; // 8 MB if read to the end
  const body = new ReadableStream({ pull(c) { if (++pulled > total) c.close(); else c.enqueue(chunk); }, cancel() { cancelled = true; } });
  await assert.rejects(fetchFeed({ fetch: async () => new Response(body) }), { name: 'FeedError', message: 'CPCB feed too large' });
  assert.ok(pulled <= Math.ceil(FEED_MAX_BYTES / chunk.length) + 2, `${pulled} of ${total} chunks read`);
  assert.ok(cancelled, 'the stream was cancelled');
});

/* ---- Audit I1 (founder: 8-h marks): CPCB's CO and O₃ sub-indices are 8-hour, the rest 24-hour. ---- */

test("I1: CPCB's CO and O₃ values cover the last 8 hours, the others do not (7 hourly captures, 27 Sep 05:00–11:00 IST)", () => {
  const caps = [FEED_XML, ...['0600', '0700', '0800', '0900', '1000', '1100'].map((h) =>
    gunzipSync(readFileSync(new URL(`../fixtures/aqi/cpcb-hourly/cpcb-feed-2026-09-27T${h}IST.xml.gz`, import.meta.url))).toString('utf8'))].map(parseFeed);
  assert.deepEqual(caps.map((c) => c[0].published_at.slice(11, 16)), ['23:30', '00:30', '01:30', '02:30', '03:30', '04:30', '05:30'], 'seven consecutive hours');
  const byName = caps.map((c) => new Map(c.map((s) => [s.name, s])));
  /* With 7 of an 8-hour window's hourly values known, the 8th (04:00 IST) is implied by the mean:
     8 × Avg − Σ known. It must sit inside CPCB's own Min–Max (±4 for Avg's rounding), and Max above
     every known value while Min is below every one is impossible with a single unknown. */
  const verdict = (param) => {
    let n = 0, fits = 0, impossible = 0;
    for (const s of caps.at(-1)) {
      const q = s.subindices.find((x) => x.parameter === param);
      const hv = byName.map((m) => m.get(s.name)?.subindices.find((x) => x.parameter === param)?.hourly);
      if (!q || q.avg === null || q.min === null || q.max === null || hv.some((v) => typeof v !== 'number')) continue;
      n++;
      const implied = 8 * q.avg - hv.reduce((a, b) => a + b, 0);
      if (implied >= q.min - 4 && implied <= q.max + 4) fits++;
      if (q.max > Math.max(...hv) && q.min < Math.min(...hv)) impossible++;
    }
    return { n, fits, impossible };
  };
  for (const p of ['co', 'o3']) {
    const v = verdict(p);
    assert.ok(v.n >= 400, `${p}: ${v.n} stations`);
    assert.deepEqual({ fits: v.fits, impossible: v.impossible }, { fits: v.n, impossible: 0 }, `${p} is an 8-hour window at every station`);
  }
  for (const p of ['pm25', 'pm10', 'no2']) {
    const v = verdict(p);
    assert.ok(v.fits / v.n < 0.7 && v.impossible > 50, `${p} is not 8-hour: ${JSON.stringify(v)} (the check discriminates)`);
  }
});

/* ---- Re-audit I-1: stripping comments and CDATA is linear too. ---- */

for (const [what, unit] of [['CDATA sections', '<![CDATA[x]]>'], ['comments', '<!--x-->']]) {
  test(`I-1: 2 MB of closed ${what} strips in under 200 ms`, () => {
    const ms = timed(HEAD + fill(unit, FEED_MAX_BYTES - HEAD.length - TAIL.length) + TAIL);
    assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms`);
  });
}

test('I-1: interleaved comments and CDATA keep every station that follows them', () => {
  const st = (n) => ST(n).replace('BODY', POLS + AQ38);
  const xml = `<AqIndex><!--a--><![CDATA[b]]><!--c-->${st('A')}<![CDATA[<Station id="Ghost">]]><!-- ]]> -->${st('B')}<![CDATA[ --> ]]></AqIndex>`;
  assert.deepEqual(parseFeed(xml).map((s) => s.name), ['A', 'B']);
});
