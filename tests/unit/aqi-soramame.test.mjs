import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { distanceM } from '../../src/lib/aqi/geo.ts';
import { USER_AGENT } from '../../src/lib/aqi/http.ts';
import { isNationalStation, jpLadder, JP_NATIONAL_STATIONS, MARUNOUCHI, MAX_JP_SERVE_M } from '../../src/lib/aqi/jp-stations.ts';
import {
  LIVE_MS, METADATA_URL, nationalRows, parseCsv, parseHourly, parseLatest, pickReadings, readTokyo, SORAMAME_BASE, SORAMAME_CREDIT, SoramameFormatError,
} from '../../src/lib/aqi/soramame.ts';

/* REAL RESPONSES, fetched 2026-11-06 22:28 JST with the generic UA: metadata.json (latest 21:00), the 21.csv
   hour (1,594 stations, 256 KB), the 22.csv placeholder the site served while that hour did not yet exist
   (HTTP 200, HTML, 2,593 bytes), and the Ministry's station master (trimmed to the national stations and
   Chiyoda/Chuo, header and rows untouched). */
const F = 'tests/fixtures/aqi/jp/';
const META = readFileSync(F + 'noudoAll-metadata.json', 'utf8');
const HOUR21 = readFileSync(F + 'noudoAll-2026-11-06-21.csv', 'utf8');
const PLACEHOLDER = readFileSync(F + 'noudoAll-2026-11-06-22-placeholder.html', 'utf8');
const MASTER = readFileSync(F + 'kyokuNoudo-master-2026-11-06-trimmed.csv', 'utf8');
const NOW = new Date('2026-11-06T13:28:00Z'); // 22:28 JST, as captured

/** A fetch that replays recordings by URL and records every call. */
function replay(map) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => '' };
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}
const LIVE_MAP = { [METADATA_URL]: META, [`${SORAMAME_BASE}/2026/11/06/21.csv`]: HOUR21 };

test('metadata.latest names the hour-ending instant and the file that holds it', () => {
  const l = parseLatest(META);
  assert.equal(l.endMs, Date.parse('2026-11-06T12:00:00Z'), '21:00 JST');
  assert.equal(l.path, '2026/11/06/21.csv');
  const midnight = parseLatest('{"latest":"2026/11/07 00:00:00"}');
  assert.equal(midnight.endMs, Date.parse('2026-11-06T15:00:00Z'));
  assert.equal(midnight.path, '2026/11/07/00.csv', 'the file of the new day, as the site serves it');
  for (const bad of ['{"latest":"2026/11/06 21:30:00"}', '{"latest":"2026-11-06 21:00:00"}', '{"latest":null}', '{}', 'not json', '{"latest":"2026/13/06 21:00:00"}', '{"latest":"2026/02/30 21:00:00"}']) {
    assert.throws(() => parseLatest(bad), SoramameFormatError, bad);
  }
});

test('the hourly CSV parses by header name; blank and "-" are missing, 0 is a reading', () => {
  const rows = parseHourly(HOUR21);
  assert.equal(rows.length, 1594);
  const shinjuku = rows.find((r) => r.code === '13104010');
  assert.deepEqual({ ...shinjuku }, { code: '13104010', name: '国設東京（新宿）', contact: '環境省', kind: '一般局', prefecture: '13', pm25: 7, no2: 0.008, ox: 0.035 });
  const kasumi = rows.find((r) => r.code === '13101520');
  assert.equal(kasumi.pm25, null, 'Kasumigaseki publishes no PM2.5');
  assert.equal(kasumi.no2, 0.013);
  const t = parseHourly('測定局コード,NO2,OX,PM2.5,測定局名称,問い合わせ先,局種別,都道府県コード\n13101520,0,-,  ,国設霞が関,環境省,自排局,13\n');
  assert.deepEqual([t[0].no2, t[0].ox, t[0].pm25], [0, null, null]);
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n1,2,3\n'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);
});

test('the site\'s HTML placeholder for a missing hour is refused, not parsed as an empty feed', () => {
  assert.throws(() => parseHourly(PLACEHOLDER), SoramameFormatError);
  assert.throws(() => parseHourly(''), SoramameFormatError);
});

test('LOCAL-GOVERNMENT STATIONS ARE EXCLUDED: only the Ministry\'s national stations survive, in the real file', () => {
  const rows = parseHourly(HOUR21);
  const kept = nationalRows(rows);
  assert.ok(kept.length >= 20 && kept.length < 30, `26 national stations nationwide, ${kept.length} in this hour`);
  for (const r of kept) {
    assert.ok(r.name.startsWith('国設') && r.contact === '環境省', `${r.code} ${r.name} ${r.contact}`);
  }
  const code = (c) => rows.find((r) => r.code === c);
  /* Tokyo-to and ward stations: real rows in the file, not national. */
  for (const c of ['13101010', '13102010', '13103010', '13104020']) {
    const r = code(c);
    if (r === undefined) continue;
    assert.ok(!kept.includes(r), `${c} ${r.name} (${r.contact}) must be excluded`);
  }
  assert.equal(code('13101010').contact, '東京都');
  assert.ok(!kept.includes(code('13101010')), '千代田区神田司町 is Tokyo-to\'s');
  /* 国設 in the name is not enough: these three name a prefecture as contact, and 筑後小郡 names the Ministry without 国設. */
  for (const [c, name, contact] of [['04501010', '国設箟岳', '宮城県'], ['23101010', '国設名古屋大気環境測定所', '愛知県'], ['10201510', '国設前橋自動車交通環境測定所', '群馬県'], ['40216010', '筑後小郡', '環境省']]) {
    const r = code(c);
    if (r === undefined) continue; // a station can be absent from one hour's file; the rule is tested below on literal rows
    assert.equal([r.name, r.contact].join('|'), [name, contact].join('|'));
    assert.ok(!kept.includes(r), `${name} must be excluded`);
  }
  assert.equal(isNationalStation({ name: '国設前橋自動車交通環境測定所', contact: '群馬県' }), false);
  assert.equal(isNationalStation({ name: '筑後小郡', contact: '環境省' }), false);
  assert.equal(isNationalStation({ name: '国設霞が関', contact: '環境省' }), true);
  assert.equal(isNationalStation({ name: '千代田区神田司町', contact: '東京都' }), false);
});

test('a local-government station can never reach a reading, even if it is put on the ladder by mistake', () => {
  const rows = parseHourly(HOUR21);
  const chiyoda = rows.find((r) => r.code === '13101010');
  assert.ok(chiyoda.pm25 !== null && chiyoda.no2 !== null, 'the local station has real values in this hour');
  const rogue = [{ ref: { id: '13101010', name: chiyoda.name, name_en: '', lat: 35.69, lon: 139.77, kind: 'general' }, station: { id: '13101010', name: chiyoda.name, lat: 35.69, lon: 139.77, distance_m: 1000, owner: '東京都', kind: null, name_en: null } }];
  assert.deepEqual(pickReadings(rows, rogue), []);
});

test('the ladder is complete: every national station within 20 km of Marunouchi in the Ministry\'s master, and no other', () => {
  const master = parseCsv(MASTER);
  const h = master[0];
  const ix = (n) => h.indexOf(n);
  const national = master.slice(1).filter((r) => isNationalStation({ name: r[ix('測定局名称')], contact: r[ix('問い合わせ先')] }));
  const within = national
    .map((r) => ({ id: r[ix('測定局コード')], lat: Number(r[ix('緯度')]), lon: Number(r[ix('経度')]), d: distanceM(MARUNOUCHI.lat, MARUNOUCHI.lon, Number(r[ix('緯度')]), Number(r[ix('経度')])) }))
    .filter((s) => s.d <= MAX_JP_SERVE_M).sort((a, b) => a.d - b.d);
  assert.deepEqual(jpLadder().map((x) => x.station.id), within.map((s) => s.id));
  for (const s of within) {
    const ref = JP_NATIONAL_STATIONS.find((r) => r.id === s.id);
    assert.equal(ref.lat, s.lat, `${s.id} latitude is the master's`);
    assert.equal(ref.lon, s.lon, `${s.id} longitude is the master's`);
  }
  assert.deepEqual(jpLadder().map((x) => [x.station.id, x.station.distance_m]), [['13101520', 1529], ['13104540', 3858], ['13104010', 4067], ['14131030', 19157]]);
});

test('each pollutant comes from the nearest national station that has it: NO2 and Ox at Kasumigaseki, PM2.5 one rung out, labelled', () => {
  const r = pickReadings(parseHourly(HOUR21), jpLadder());
  const by = Object.fromEntries(r.map((x) => [x.pollutant, x]));
  assert.deepEqual([by.no2.value, by.no2.unit, by.no2.station.id, by.no2.station.fallback], [0.013, 'ppm', '13101520', undefined]);
  assert.deepEqual([by.ox.value, by.ox.unit, by.ox.station.id], [0.021, 'ppm', '13101520']);
  assert.deepEqual([by.pm25.value, by.pm25.unit, by.pm25.station.id, by.pm25.station.fallback], [8, 'ug_m3', '13104540', true]);
  assert.equal(by.pm25.station.distance_m, 3858);
  assert.equal(by.pm25.station.owner, '環境省');
});

test('readTokyo: a current hour is live, carries the credit and edit statement verbatim, and is marked provisional', async () => {
  const { fetch, calls } = replay(LIVE_MAP);
  const p = await readTokyo('jp/tokyo/marunouchi', { fetch, now: NOW });
  assert.equal(p.state, 'live');
  assert.equal(p.standard, 'jp-eqs');
  assert.equal(p.observed_at, '2026-11-06T12:00:00.000Z');
  assert.equal(p.observed_at_local, '2026-11-06T21:00:00+09:00');
  assert.equal(p.provisional, true);
  assert.equal(p.credit.line, '出典：環境省大気汚染物質広域監視システム（そらまめくん）（https://soramame.env.go.jp/）（速報値）');
  assert.match(p.credit.edit, /をもとにDelta Climate Research作成/);
  assert.equal(p.credit, SORAMAME_CREDIT);
  assert.equal(p.readings.length, 3);
  assert.ok(p.readings.every((x) => x.station.owner === '環境省'));
  assert.equal(calls.length, 2, 'metadata, then exactly one hourly file');
  assert.deepEqual(calls.map((c) => c.url), [METADATA_URL, `${SORAMAME_BASE}/2026/11/06/21.csv`]);
  for (const c of calls) {
    assert.equal(c.headers['User-Agent'], USER_AGENT);
    assert.ok(!/@/.test(JSON.stringify(c.headers)), 'no address in any header');
  }
});

test('NO STALE NUMBER: an hour older than 3 h, a missing file, a down source and an unreadable body are all "not reporting" with no value', async () => {
  const hasValue = (p) => /"value"|"readings"/.test(JSON.stringify(p));
  const old = await readTokyo('jp/tokyo/marunouchi', { fetch: replay(LIVE_MAP).fetch, now: new Date(Date.parse('2026-11-06T12:00:00Z') + LIVE_MS + 60_000) });
  assert.deepEqual([old.state, old.reason, old.last_observed_at], ['not_reporting', 'no_current_hour', '2026-11-06T12:00:00.000Z']);
  assert.equal(old.station.id, '13101520', 'the area\'s nearest station is still named');
  assert.ok(!hasValue(old));
  const edge = await readTokyo('jp/tokyo/marunouchi', { fetch: replay(LIVE_MAP).fetch, now: new Date(Date.parse('2026-11-06T12:00:00Z') + LIVE_MS) });
  assert.equal(edge.state, 'live', 'exactly 3 h is still current');

  const noMeta = await readTokyo('jp/tokyo/marunouchi', { fetch: replay({}).fetch, now: NOW });
  assert.deepEqual([noMeta.state, noMeta.reason, noMeta.last_observed_at], ['not_reporting', 'source_down', null]);
  const timeout = await readTokyo('jp/tokyo/marunouchi', { fetch: replay({ [METADATA_URL]: new Error('aborted') }).fetch, now: NOW });
  assert.equal(timeout.reason, 'source_down');
  const placeholder = await readTokyo('jp/tokyo/marunouchi', { fetch: replay({ [METADATA_URL]: META, [`${SORAMAME_BASE}/2026/11/06/21.csv`]: PLACEHOLDER }).fetch, now: NOW });
  assert.deepEqual([placeholder.state, placeholder.reason, placeholder.last_observed_at], ['not_reporting', 'source_down', '2026-11-06T12:00:00.000Z']);
  assert.ok(!hasValue(placeholder) && !hasValue(noMeta) && !hasValue(timeout));
  const future = await readTokyo('jp/tokyo/marunouchi', { fetch: replay(LIVE_MAP).fetch, now: new Date('2026-11-06T11:00:00Z') });
  assert.equal(future.reason, 'source_down', 'a stamp in the future is a feed error');
});

test('a feed in which no national station has a value this hour is "no current hour", never another hour\'s figure', async () => {
  const header = HOUR21.split('\n')[0];
  const blank = `${header}\n13101520,,,,,,,,,,,,,,,,,国設霞が関,千代田区霞が関,環境省,自排局,3,13,千代田区\n13101010,0.001,0,0.014,0.014,,0.033,,,,0.020,15,,,,,,千代田区神田司町,千代田区,東京都,一般局,3,13,千代田区\n`;
  const p = await readTokyo('jp/tokyo/marunouchi', { fetch: replay({ [METADATA_URL]: META, [`${SORAMAME_BASE}/2026/11/06/21.csv`]: blank }).fetch, now: NOW });
  assert.deepEqual([p.state, p.reason], ['not_reporting', 'no_current_hour']);
});

test('the credit is the Ministry\'s wording: 出典, the system name, the URL, and an edit statement naming Delta Climate Research', () => {
  assert.ok(SORAMAME_CREDIT.line.startsWith('出典：環境省大気汚染物質広域監視システム（そらまめくん）'));
  assert.ok(SORAMAME_CREDIT.edit.includes('Delta Climate Research作成'));
  assert.ok(SORAMAME_CREDIT.edit.includes('（環境省）（https://soramame.env.go.jp/）'));
});
