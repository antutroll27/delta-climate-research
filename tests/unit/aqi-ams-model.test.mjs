import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AMSTERDAM_SHEETS } from '../../src/data/sheets/amsterdam.ts';
import { LKI_MODEL_HOUR_MS, lkiBand, lkiClass } from '../../src/lib/aqi/lki.ts';
import { judge, modelCurrent } from '../../src/lib/aqi/local-judge.ts';
import { isLocalAirPayload, isNlModel, readLocalAirPayload } from '../../src/lib/aqi/local-valid.ts';
import { lkiUrl, MODEL_WAIT_MS, measurementsUrl, modelUrl, parseModel, readAmsterdam } from '../../src/lib/aqi/luchtmeetnet.ts';
import { amsterdamCentre, CANAL_RING } from '../../src/lib/aqi/nl-stations.ts';
import { loadAir } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { loadLocalAir, localCardHtml, localPaneHtml } from '../../src/scripts/climate-engine/air/local-air-panel.ts';

/* Luchtmeetnet's MODELLED LKI at an area's centre, as a second line beside the measured card (2026-11-09). The model answer is a REAL capture of
   /open_api/concentrations?formula=lki&latitude=52.364&longitude=4.885 at 2026-11-08T20:36:04Z (19 hourly rows, 20:00Z today to 14:00Z tomorrow,
   tests/fixtures/aqi/nl/model-lki-canal-ring-2026-11-08T2036Z.json). */
const MODEL = readFileSync('tests/fixtures/aqi/nl/model-lki-canal-ring-2026-11-08T2036Z.json', 'utf8');
const M_NOW = new Date('2026-11-08T20:36:04Z');
const HOUR = 3_600_000;

/** A fetch that serves `bodies[url]` (or `hook(url)` when given: a string, undefined for a 503, an Error to throw, a Promise to return as is). */
function replay(bodies, hook) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const b = hook ? hook(url) : bodies[url];
    if (b === undefined) return { ok: false, status: 503, text: async () => '' };
    if (b instanceof Error) throw b;
    if (b instanceof Promise) return b;
    return { ok: true, status: 200, text: async () => b };
  };
  return { fetch, calls };
}

const lkiRow = (id, value = 3, at = '2026-11-06T13:00:00+00:00') => JSON.stringify({ data: [{ station_number: id, formula: 'LKI', value, timestamp_measured: at }] });
/** A model answer whose rows start at `startIso` (UTC, on the hour), one per hour, values v0, v0+1 …  */
const modelRows = (startIso, n, v0 = 3.25) => JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ formula: 'LKI', value: v0 + i, timestamp_measured: new Date(Date.parse(startIso) + i * HOUR).toISOString().replace('.000Z', '+00:00') })) });

/* ── the modelled LKI: which row ─────────────────────────────────────────────────────────────────── */

test('MODEL ROW: the real capture, at 20:36Z, is the row stamped 20:00Z (the hour that has begun) and never one of the 18 forecast hours', () => {
  const rows = JSON.parse(MODEL).data;
  assert.equal(rows.length, 19);
  assert.equal(rows[0].timestamp_measured, '2026-11-08T20:00:00+00:00');
  const r = parseModel(MODEL, M_NOW);
  assert.deepEqual([r.hourMs, r.value], [Date.parse('2026-11-08T20:00:00Z'), 3.549999952316284]);
  /* whatever the clock, the row used began at or before it and its hour is not over */
  for (let t = Date.parse('2026-11-08T19:00:00Z'); t <= Date.parse('2026-11-09T16:00:00Z'); t += 7 * 60_000 + 13_000) {
    const row = parseModel(MODEL, new Date(t));
    if (row !== null) { assert.ok(row.hourMs <= t, `a forecast hour was chosen at ${new Date(t).toISOString()}`); assert.ok(t - row.hourMs < HOUR); }
  }
});

test('MODEL ROW: hour boundaries are exact - 20:59:59 is still the 20:00 hour, 21:00:00 is the 21:00 row, 19:59:59 has none (the first row is still the future)', () => {
  assert.equal(parseModel(MODEL, new Date('2026-11-08T20:59:59.999Z')).hourMs, Date.parse('2026-11-08T20:00:00Z'));
  const next = parseModel(MODEL, new Date('2026-11-08T21:00:00Z'));
  assert.deepEqual([next.hourMs, next.value], [Date.parse('2026-11-08T21:00:00Z'), 3.2300000190734863]);
  assert.equal(parseModel(MODEL, new Date('2026-11-08T19:59:59.999Z')), null, 'the 20:00 row is a forecast hour at 19:59:59');
  assert.equal(parseModel(MODEL, new Date('2026-11-08T19:00:00Z')), null);
});

test('MODEL ROW: no future slack - a row stamped 15 minutes ahead is a forecast hour, not "current" (the measured rows\' end-stamp slack does not apply)', () => {
  const body = modelRows('2026-11-08T21:00:00Z', 3);
  assert.equal(parseModel(body, new Date('2026-11-08T20:45:00Z')), null);
  assert.equal(parseModel(body, new Date('2026-11-08T20:59:59Z')), null);
  assert.equal(parseModel(body, new Date('2026-11-08T21:00:00Z')).hourMs, Date.parse('2026-11-08T21:00:00Z'));
});

test('MODEL ROW: stale rows are ignored - an answer whose hours are all over has no current row', () => {
  const body = modelRows('2026-11-08T10:00:00Z', 5); // 10:00 … 14:00Z
  assert.equal(parseModel(body, new Date('2026-11-08T14:59:59Z')).hourMs, Date.parse('2026-11-08T14:00:00Z'));
  assert.equal(parseModel(body, new Date('2026-11-08T15:00:00Z')), null, 'the 14:00 hour is over at 15:00:00');
  assert.equal(parseModel(body, new Date('2026-11-08T20:36:00Z')), null);
  assert.equal(parseModel(MODEL, new Date('2026-11-09T15:00:00Z')), null, 'the capture\'s last row (14:00Z) is over at 15:00Z');
  assert.equal(parseModel(MODEL, new Date('2026-11-09T14:59:59Z')).value, 3.299999952316284);
});

test('MODEL ROW: the newest row of the current hour wins whatever the order; malformed rows are skipped, not trusted', () => {
  const at = '2026-11-08T20:00:00+00:00';
  const j = (rows) => JSON.stringify({ data: rows });
  const good = { formula: 'LKI', value: 4.2, timestamp_measured: at };
  assert.equal(parseModel(j([{ ...good, timestamp_measured: '2026-11-08T21:00:00+00:00' }, good, { ...good, timestamp_measured: '2026-11-08T19:00:00+00:00' }]), M_NOW).value, 4.2);
  for (const bad of [{ formula: 'NO2' }, { formula: 'lki' }, { value: 0 }, { value: -1 }, { value: 11.01 }, { value: 12 }, { value: '4.2' }, { value: null }, { value: NaN },
    { timestamp_measured: '2026-11-08T20:30:00+00:00' }, { timestamp_measured: '2026-11-08T20:00:00' }, { timestamp_measured: 'soon' }, { timestamp_measured: 1 }]) {
    assert.equal(parseModel(j([{ ...good, ...bad }]), M_NOW), null, JSON.stringify(bad));
  }
  assert.equal(parseModel(j([]), M_NOW), null);
  assert.equal(parseModel(j([{ ...good, timestamp_measured: '2026-11-08T21:00:00+01:00' }]), M_NOW)?.hourMs, Date.parse('2026-11-08T20:00:00Z'), 'an offset stamp is the instant it says');
  assert.throws(() => parseModel('not json', M_NOW));
  assert.throws(() => parseModel('{"data":null}', M_NOW));
});

test('MODEL URL: the area centre, 6 decimals, the documented endpoint', () => {
  assert.equal(modelUrl({ lat: 52.364, lon: 4.885 }), 'https://api.luchtmeetnet.nl/open_api/concentrations?formula=lki&latitude=52.364000&longitude=4.885000');
  const c = amsterdamCentre('ams-d2');
  assert.equal(modelUrl(c), `https://api.luchtmeetnet.nl/open_api/concentrations?formula=lki&latitude=${c.lat.toFixed(6)}&longitude=${c.lon.toFixed(6)}`);
  assert.match(modelUrl(c), /latitude=52\.414660&longitude=4\.843809$/);
});

/* ── the modelled LKI: rounding and bands, Luchtmeetnet's rule ───────────────────────────────────── */

test('BAND ROUNDING: decimal LKI values are rounded UP ("naar bovenafgerond"): the page\'s own examples, the class edges, and what has no class', () => {
  assert.equal(lkiClass(0.9), 1, 'the page: 0,9 is number 1');
  assert.equal(lkiClass(3.1), 4, 'the page: 3,1 is number 4');
  for (const [v, n, band] of [[0.0001, 1, 'good'], [1, 1, 'good'], [3, 3, 'good'], [3.0001, 4, 'moderate'], [3.549999952316284, 4, 'moderate'], [4, 4, 'moderate'], [6, 6, 'moderate'], [6.01, 7, 'insufficient'],
    [8, 8, 'insufficient'], [8.2, 9, 'bad'], [10, 10, 'bad'], [10.01, 11, 'very_bad'], [11, 11, 'very_bad']]) {
    assert.equal(lkiClass(v), n, String(v));
    assert.equal(lkiBand(lkiClass(v)), band, String(v));
  }
  for (const none of [0, -0.5, 11.01, 12, NaN, Infinity, -Infinity, '3', null, undefined, {}]) assert.equal(lkiClass(none), null, String(none));
  assert.equal(LKI_MODEL_HOUR_MS, HOUR);
});

test('BAND ROUNDING: the captured model value 3.5499… is printed as 4, "Matig", and the published decimal rides along unrounded', async () => {
  const live = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ [modelUrl(CANAL_RING)]: MODEL, ...bothAt(M_NOW) }).fetch, now: M_NOW });
  assert.equal(live.state, 'live');
  assert.deepEqual(live.model, { value: 3.549999952316284, lki: 4, band: 'moderate', hour_start: '2026-11-08T20:00:00.000Z' });
  assert.deepEqual(live.lki, { value: 3, band: 'good' }, 'the measured LKI is untouched by the model');
});

/** Vondelpark's feed at an arbitrary `now` (an LKI for the hour ending at the latest full hour). */
function bothAt(now) {
  const end = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString().replace('.000Z', '+00:00');
  return { [lkiUrl('NL49014', now)]: lkiRow('NL49014', 3, end), [measurementsUrl('NL49014', now)]: '{"data":[]}' };
}

/* ── the model never changes the measured card ───────────────────────────────────────────────────── */

test('A MODEL FAILURE LEAVES THE MEASURED PAYLOAD IDENTICAL: 404, 500, network error, garbage, empty, only-future rows, only-stale rows, bad values', async () => {
  const feed = bothAt(M_NOW);
  const withModel = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...feed, [modelUrl(CANAL_RING)]: MODEL }).fetch, now: M_NOW });
  assert.equal(withModel.state, 'live');
  assert.ok(withModel.model);
  const { model: _m, ...measured } = withModel;
  const failures = {
    '404': undefined,
    '500': (u) => (u.includes('/concentrations?') ? undefined : feed[u]),
    network: (u) => (u.includes('/concentrations?') ? new Error('offline') : feed[u]),
    garbage: (u) => (u.includes('/concentrations?') ? '<html>maintenance</html>' : feed[u]),
    'no data': (u) => (u.includes('/concentrations?') ? '{"data":[]}' : feed[u]),
    'wrong shape': (u) => (u.includes('/concentrations?') ? '{"data":{"a":1}}' : feed[u]),
    'future only': (u) => (u.includes('/concentrations?') ? modelRows('2026-11-08T21:00:00Z', 5) : feed[u]),
    'stale only': (u) => (u.includes('/concentrations?') ? modelRows('2026-11-08T10:00:00Z', 5) : feed[u]),
    'bad value': (u) => (u.includes('/concentrations?') ? modelRows('2026-11-08T20:00:00Z', 5, 99) : feed[u]),
  };
  for (const [name, hook] of Object.entries(failures)) {
    const p = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay(feed, hook ?? ((u) => feed[u])).fetch, now: M_NOW });
    assert.deepEqual(p, measured, name);
    assert.equal('model' in p, false, `${name}: the key is absent, not null`);
  }
});

test('A HUNG MODEL REQUEST does not hold the measured card past MODEL_WAIT_MS, and the card is the same', async () => {
  const feed = bothAt(M_NOW);
  const never = new Promise(() => {});
  const t0 = Date.now();
  const p = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay(feed, (u) => (u.includes('/concentrations?') ? never : feed[u])).fetch, now: M_NOW });
  const took = Date.now() - t0;
  assert.equal(p.state, 'live');
  assert.equal('model' in p, false);
  assert.ok(took >= MODEL_WAIT_MS - 50 && took < MODEL_WAIT_MS + 2000, `waited ${took} ms`);
});

test('THE MEASURED STATE MACHINE DOES NOT MOVE: a good model never turns a not-reporting card live, and rides a fallback rung unchanged', async () => {
  const feed = bothAt(M_NOW);
  const model = { [modelUrl(CANAL_RING)]: MODEL };
  const down = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...model }).fetch, now: M_NOW });
  assert.deepEqual([down.state, down.reason], ['not_reporting', 'source_down']);
  assert.equal('model' in down, false);
  const old = new Date(M_NOW.getTime() + 3 * HOUR);
  const stale = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...model, ...bothAt(M_NOW), [lkiUrl('NL49014', old)]: lkiRow('NL49014', 3, '2026-11-08T20:00:00+00:00') }).fetch, now: old });
  assert.equal(stale.state, 'not_reporting');
  assert.equal('model' in stale, false);
  /* nearest rung down, second serves as a fallback, and the model line is the same either way */
  const fb = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...model, [lkiUrl('NL49012', M_NOW)]: lkiRow('NL49012', 5, '2026-11-08T20:00:00+00:00'), [measurementsUrl('NL49012', M_NOW)]: '{"data":[]}' }).fetch, now: M_NOW });
  assert.deepEqual([fb.state, fb.station.id, fb.station.fallback, fb.lki.value, fb.model.lki], ['live', 'NL49012', true, 5, 4]);
  const ok = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...model, ...feed }).fetch, now: M_NOW });
  assert.deepEqual(Object.keys(ok).sort(), ['area_id', 'credit', 'lki', 'model', 'observed_at', 'observed_at_local', 'readings', 'schema', 'served_at', 'standard', 'state', 'station']);
});

test('THE MODEL APPLIES TO EVERY AREA: asked at that area\'s own centre', async () => {
  for (const s of AMSTERDAM_SHEETS) {
    const f = replay({ [modelUrl(s.centre)]: MODEL, ...bothAt(M_NOW) });
    const p = await readAmsterdam(`nl/amsterdam/${s.id}`, { fetch: f.fetch, now: M_NOW, from: s.centre });
    assert.ok(f.calls.includes(modelUrl(s.centre)), s.id);
    assert.equal(p.model?.lki, 4, s.id);
  }
});

/* ── validation ──────────────────────────────────────────────────────────────────────────────────── */

const GOOD_MODEL = { value: 3.549999952316284, lki: 4, band: 'moderate', hour_start: '2026-11-08T20:00:00.000Z' };
const livePayload = async (extra = {}) => {
  const p = await readAmsterdam('nl/amsterdam/canal-ring', { fetch: replay({ ...bothAt(M_NOW), [modelUrl(CANAL_RING)]: MODEL }).fetch, now: M_NOW });
  return { ...p, ...extra };
};

test('VALIDATOR: a good model block passes; every malformed one is rejected by isNlModel and by the strict payload check', async () => {
  assert.ok(isNlModel(GOOD_MODEL));
  assert.ok(isLocalAirPayload(await livePayload()));
  const bad = [
    { lki: 3 }, { lki: 5 }, { lki: 4.5 }, { lki: '4' }, { band: 'good' }, { band: 'bad' }, { band: 'nope' }, { band: undefined },
    { value: 4.1 }, { value: 0 }, { value: -2 }, { value: 11.5 }, { value: NaN }, { value: '3.55' }, { value: null }, { value: undefined },
    { hour_start: '2026-11-08T20:30:00.000Z' }, { hour_start: 'soon' }, { hour_start: '' }, { hour_start: 5 }, { hour_start: undefined },
  ];
  for (const b of bad) {
    const m = { ...GOOD_MODEL, ...b };
    assert.equal(isNlModel(m), false, JSON.stringify(b));
    assert.equal(isLocalAirPayload(await livePayload({ model: m })), false, `payload with ${JSON.stringify(b)}`);
  }
  for (const m of [null, 'x', 4, [], [GOOD_MODEL]]) {
    assert.equal(isNlModel(m), false, JSON.stringify(m));
    assert.equal(isLocalAirPayload(await livePayload({ model: m })), false);
  }
  assert.equal(isLocalAirPayload(await livePayload({ model: undefined })), true, 'absent is fine: the line is optional');
});

test('VALIDATOR: a malformed model block is DROPPED by readLocalAirPayload and the measured payload survives; a malformed measured part is still a refusal', async () => {
  const full = await livePayload();
  const { model: _m, ...measured } = full;
  for (const m of [{ ...GOOD_MODEL, lki: 9 }, { ...GOOD_MODEL, hour_start: 'x' }, null, 'junk', []]) {
    const got = readLocalAirPayload({ ...measured, model: m });
    assert.deepEqual(got, measured, JSON.stringify(m));
    assert.equal('model' in got, false);
  }
  assert.deepEqual(readLocalAirPayload(full), full, 'a good model is kept');
  assert.equal(readLocalAirPayload({ ...measured, model: GOOD_MODEL, lki: { value: 3, band: 'bad' } }), null, 'bad measured part + good model');
  assert.equal(readLocalAirPayload({ ...measured, model: { ...GOOD_MODEL, lki: 9 }, lki: { value: 3, band: 'bad' } }), null, 'bad measured part + bad model');
  assert.equal(readLocalAirPayload({ ...measured, schema: 2, model: GOOD_MODEL }), null);
  assert.equal(readLocalAirPayload(null), null);
  assert.equal(readLocalAirPayload('x'), null);
  assert.equal(readLocalAirPayload({}), null);
});

/* ── the judge: the model has its own one-hour life ──────────────────────────────────────────────── */

test('JUDGE: the modelled line lives for its own clock hour only; the measured card is judged exactly as before', async () => {
  const p = await livePayload();
  assert.equal(modelCurrent(p.model, new Date('2026-11-08T20:00:00Z')), true);
  assert.equal(modelCurrent(p.model, new Date('2026-11-08T20:59:59.999Z')), true);
  assert.equal(modelCurrent(p.model, new Date('2026-11-08T21:00:00Z')), false);
  assert.equal(modelCurrent(p.model, new Date('2026-11-08T19:59:59Z')), false, 'a client clock behind the hour does not show it early');
  assert.equal(judge(p, new Date('2026-11-08T20:50:00Z')), p, 'inside the hour: the same object');
  const later = judge(p, new Date('2026-11-08T21:05:00Z'));
  assert.equal(later.state, 'live', 'the measured figure is still current (observed 20:00Z + 2 h)');
  assert.equal('model' in later, false);
  const { model: _m, ...measured } = p;
  assert.deepEqual(later, measured);
  const gone = judge(p, new Date('2026-11-08T22:30:00Z'));
  assert.equal(gone.state, 'not_reporting');
  assert.equal('model' in gone, false);
});

/* ── the card ────────────────────────────────────────────────────────────────────────────────────── */

test('CARD WORDING: "Modelled for this area by Luchtmeetnet: N", the class, "a calculation … not a measurement"; it names the area; it never reads as a measurement', async () => {
  const p = await livePayload();
  const html = localCardHtml(p, 'Havens-West', new Date('2026-11-08T20:40:00Z'));
  assert.match(html, /Modelled for this area by Luchtmeetnet: <b>4<\/b>/);
  assert.match(html, /Matig/);
  assert.match(html, /A calculation for the centre of Havens-West, not a measurement/);
  assert.match(html, /for the hour from <span style="white-space:nowrap"><b>21:00 CET<\/b>/);
  assert.match(html, /rounded up to a whole number, as Luchtmeetnet does/);
  assert.match(html, /Air quality · Havens-West/);
  /* the measured line is still first and still the headline */
  assert.ok(html.indexOf('class="num">3<') < html.indexOf('Modelled for this area'));
  assert.equal((html.match(/class="num"/g) ?? []).length, 1, 'exactly one hero number: the measured one');
  assert.ok(!/3\.54|3\.55/.test(html), 'the decimal is not printed');
  const pane = localPaneHtml(p, 'Havens-West', new Date('2026-11-08T20:40:00Z'));
  assert.match(pane, /Modelled for this area by Luchtmeetnet/);
  assert.match(pane, /not a measurement and no monitor stands behind it/);
});

test('CARD: without a model, or once its hour is over, the card is exactly the measured card', async () => {
  const p = await livePayload();
  const { model: _m, ...measured } = p;
  const at = new Date('2026-11-08T20:40:00Z');
  assert.ok(!/Modelled/.test(localCardHtml(measured, 'Canal Ring', at)));
  assert.ok(!/Modelled/.test(localPaneHtml(measured, 'Canal Ring', at)));
  const later = new Date('2026-11-08T21:20:00Z');
  assert.equal(localCardHtml(p, 'Canal Ring', later), localCardHtml(measured, 'Canal Ring', later));
  assert.equal(localPaneHtml(p, 'Canal Ring', later), localPaneHtml(measured, 'Canal Ring', later));
});

test('THE CARD FOLLOWS THE OPEN AREA: loadAir for any streamed id asks the API for exactly that area, names the place, and drops a late answer for another', async () => {
  for (const s of AMSTERDAM_SHEETS) {
    const key = `nl/amsterdam/${s.id}`;
    const asked = [];
    const body = { ...(await livePayload()), area_id: key };
    const io = { fetch: async (url) => { asked.push(url); return { ok: true, json: async () => body }; }, signal: new AbortController().signal, isCurrent: () => true, now: new Date('2026-11-08T20:40:00Z') };
    const paint = await loadAir(key, `Area ${s.code}`, io);
    assert.deepEqual(asked, [`/api/air-quality?area=${encodeURIComponent(key)}`]);
    assert.equal(decodeURIComponent(asked[0].split('area=')[1]), key);
    assert.match(paint.block, new RegExp(`Air quality · Area ${s.code}`));
    assert.match(paint.block, /Modelled for this area by Luchtmeetnet/);
    /* an answer for another area is the failure view, never painted as this one's */
    const wrong = key === 'nl/amsterdam/canal-ring' ? 'nl/amsterdam/ams-f4' : 'nl/amsterdam/canal-ring';
    const other = await loadLocalAir(key, 'X', { ...io, fetch: async () => ({ ok: true, json: async () => ({ ...body, area_id: wrong }) }) });
    assert.match(other.block, /Not loaded/);
  }
  assert.equal(await loadAir('nl/amsterdam/ams-f4', 'X', { fetch: async () => ({ ok: true, json: async () => ({}) }), signal: new AbortController().signal, isCurrent: () => false }), null);
});

test('CARD: a malformed model block in the API answer costs only the modelled line; the measured card is painted', async () => {
  const p = await livePayload();
  const key = 'nl/amsterdam/canal-ring';
  const paintWith = async (m) => loadLocalAir(key, 'Canal Ring', { fetch: async () => ({ ok: true, json: async () => ({ ...p, model: m }) }), signal: new AbortController().signal, isCurrent: () => true, now: new Date('2026-11-08T20:40:00Z') });
  const good = await paintWith(GOOD_MODEL);
  const junk = await paintWith({ ...GOOD_MODEL, lki: 9 });
  const none = await paintWith(undefined);
  assert.match(good.block, /Modelled for this area/);
  assert.ok(!/Modelled/.test(junk.block) && !/Not loaded/.test(junk.block));
  assert.equal(junk.block, none.block);
  assert.equal(junk.pane, none.pane);
  assert.equal(junk.status, none.status);
});

test('THE SEAM: the page repaints the Air card for the area the stream opens - paintAir() runs in the area commit of loadWard, off state.ward, and the stream opens areas through loadWard', () => {
  const text = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.match(text, /state\.ward = name; state\.climate = resolve\(name\)\.climate;/);
  assert.match(text, /registry = buildRegistry\(d\.b\);\s*paintSolarWard\(\);\s*paintAir\(\);/);
  assert.match(text, /const area = state\.ward, place = areaName\(\);/);
  assert.match(text, /showSheet: async \(code, prepared, ao, first, afterCommit, fly = false, rebuild = false\) => \{\s*await loadWard\(keyOf\(code\)/);
  assert.match(text, /isCurrent: \(\) => state\.ward === area/);
});
