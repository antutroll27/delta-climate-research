import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isAirCity } from '../../src/lib/aqi/stations.ts';
import { isLocalAirArea, localAirReady, LOCAL_AIR_AREAS, LOCAL_STANDARD_TZ } from '../../src/lib/aqi/local-areas.ts';
import { lkiUrl, measurementsUrl, readAmsterdam } from '../../src/lib/aqi/luchtmeetnet.ts';
import { METADATA_URL, readTokyo, SORAMAME_BASE } from '../../src/lib/aqi/soramame.ts';
import { loadAir } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { judge, loadLocalAir, localCardHtml, localPaneHtml, localStatusText, localTime } from '../../src/scripts/climate-engine/air/local-air-panel.ts';
import { isDrawable } from '../../src/scripts/climate-engine/scope/registry.ts';

const read = (p) => readFileSync(p, 'utf8');
const NL = 'tests/fixtures/aqi/nl/', JP = 'tests/fixtures/aqi/jp/';
const NL_NOW = new Date('2026-11-06T13:43:52Z'), JP_NOW = new Date('2026-11-06T13:28:00Z');
const reply = (map) => async (url) => (map[url] === undefined ? { ok: false, status: 503, text: async () => '' } : { ok: true, status: 200, text: async () => map[url] });
const nlLive = await readAmsterdam('nl/amsterdam/canal-ring', { now: NL_NOW, fetch: reply({
  [lkiUrl('NL49014', NL_NOW)]: read(NL + 'lki-NL49014.json'), [measurementsUrl('NL49014', NL_NOW)]: read(NL + 'measurements-NL49014.json') }) });
const jpLive = await readTokyo('jp/tokyo/marunouchi', { now: JP_NOW, fetch: reply({
  [METADATA_URL]: read(JP + 'noudoAll-metadata.json'), [`${SORAMAME_BASE}/2026/11/06/21.csv`]: read(JP + 'noudoAll-2026-11-06-21.csv') }) });
const nlDown = await readAmsterdam('nl/amsterdam/canal-ring', { now: NL_NOW, fetch: reply({}) });

const INDIAN_WORDS = /Satisfactory|Very poor|Severe|CPCB|NAQI|National AQI|\bIST\b|OpenAQ|NowCast/;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('Amsterdam card: the LKI numeral with Luchtmeetnet\'s own class word and colour, the station, the hour in CET', () => {
  assert.equal(nlLive.state, 'live');
  const h = localCardHtml(nlLive, 'Canal Ring', NL_NOW);
  assert.match(h, /<span class="num">3<\/span>/);
  assert.match(h, /Goed/);
  assert.match(h, /· Good/);
  assert.match(h, /background:#3077CE/, 'Luchtmeetnet\'s own blue for class 1-3');
  assert.match(h, /Amsterdam-Vondelpark/);
  assert.match(h, /municipal monitor, GGD Amsterdam/);
  assert.match(h, /1\.4 km from the Canal Ring centre/);
  assert.match(h, /Hour to <span[^>]*><b>14:00 CET<\/b>/);
  assert.match(h, /PM2\.5 <b>16\.2<\/b> · PM10 <b>22\.9<\/b> · NO₂ <b>15\.5<\/b> · O₃ <b>25\.1<\/b>/);
  assert.match(h, /LKI, the Dutch air-quality index/);
  assert.ok(!INDIAN_WORDS.test(text(h)), `no Indian category word, scale or source: ${text(h).match(INDIAN_WORDS)}`);
  assert.ok(!/var\(--c-/.test(h), 'no India colour token');
});

test('Amsterdam card credits the source in the wording its terms ask for, says the data is unvalidated, and disclaims endorsement', () => {
  const t = text(localCardHtml(nlLive, 'Canal Ring', NL_NOW));
  assert.ok(t.includes('Source: www.luchtmeetnet.nl'));
  assert.ok(t.includes('Unvalidated hourly values'));
  assert.ok(t.includes('Luchtmeetnet does not endorse this page'));
  assert.ok(t.includes('CC BY-ND 4.0'));
});

test('the explainer says scales differ and names no other app as wrong', () => {
  const t = text(localCardHtml(nlLive, 'Canal Ring', NL_NOW));
  assert.ok(t.includes('use other scales and other substances, so their numbers are not interchangeable'));
  assert.ok(!/wrong|incorrect|inaccurate|mistake|misleading|better than|more accurate/i.test(t));
});

test('summer time is told as CEST', () => {
  assert.equal(localTime('2027-07-01T10:00:00Z', 'nl-lki'), '12:00 CEST');
  assert.equal(localTime('2026-11-06T13:00:00Z', 'nl-lki'), '14:00 CET');
  assert.equal(localTime('2026-11-06T12:00:00Z', 'jp-eqs'), '21:00 JST');
  assert.equal(localTime('2026-11-06T12:00:00Z', 'jp-eqs', true), '6 Nov 21:00 JST');
  assert.equal(localTime('2026-11-06T13:00:00Z', 'nl-lki', true), '6 Nov 14:00 CET');
  assert.equal(localTime('garbage', 'nl-lki'), '—');
});

test('NOT REPORTING: no numeral, no value, the time of the last hour only, and the reason in words', () => {
  assert.equal(nlDown.state, 'not_reporting');
  const h = localCardHtml(nlDown, 'Canal Ring', NL_NOW);
  assert.match(h, /Not reporting/);
  assert.match(h, /No current reading could be loaded from Luchtmeetnet just now/);
  assert.ok(!/class="num"|class="hero"/.test(h));
  assert.match(h, /Amsterdam-Vondelpark/, 'the nearest monitor is still named');
  assert.match(h, /Source: www\.luchtmeetnet\.nl/);
});

test('NO STALE NUMBER ON THE VIEWER\'S CLOCK: a live payload painted past its window becomes "Not reporting" with the hour but no value', () => {
  const later = new Date(Date.parse(nlLive.observed_at) + 2 * 3_600_000 + 1000);
  const j = judge(nlLive, later);
  assert.equal(j.state, 'not_reporting');
  assert.equal(j.last_observed_at, nlLive.observed_at);
  const card = localCardHtml(nlLive, 'Canal Ring', later), pane = localPaneHtml(nlLive, 'Canal Ring', later);
  for (const h of [card, pane]) {
    assert.match(h, /Not reporting/);
    assert.match(h, /Last hour reported: <span[^>]*><b>6 Nov 14:00 CET<\/b>/);
    assert.match(h, /no longer current/);
    assert.ok(!/class="num"/.test(h) && !h.includes('16.2') && !h.includes('22.9') && !h.includes('25.1'), 'no value anywhere in the markup');
  }
  const exactly = new Date(Date.parse(nlLive.observed_at) + 2 * 3_600_000);
  assert.equal(judge(nlLive, exactly).state, 'live', 'exactly at the window is still current');
  const jp = judge(jpLive, new Date(Date.parse(jpLive.observed_at) + 3 * 3_600_000 + 1));
  assert.equal(jp.state, 'not_reporting');
  assert.equal(jp.station.id, '13101520');
  assert.match(localStatusText(nlLive, 'Canal Ring', later), /not reporting/);
});

test('Tokyo card: no index and no hero numeral; each pollutant beside the Ministry\'s standard; provisional; national stations named with distances', () => {
  assert.equal(jpLive.state, 'live');
  const h = localCardHtml(jpLive, 'Marunouchi', JP_NOW);
  const t = text(h);
  assert.ok(!/class="num"|class="hero"/.test(h));
  assert.ok(t.includes('Japan publishes concentration standards, not an air-quality index'));
  assert.ok(t.includes('PM2.5') && t.includes('NO₂') && t.includes('Ox (photochemical oxidants)'));
  assert.ok(t.includes('µg/m³') && t.includes('ppm'));
  assert.ok(t.includes('Standard (環境基準): Daily mean 35 µg/m³ or less'));
  assert.ok(t.includes('within 0.04 to 0.06 ppm, or below'));
  assert.ok(t.includes('8-hour value 0.07 ppm or less'));
  assert.ok(t.includes('国設霞が関 (Kasumigaseki national station)') && t.includes('1.5 km from the Marunouchi centre'));
  assert.ok(t.includes('国設新宿 (Shinjuku national roadside station)') && t.includes('nearest reporting roadside'));
  assert.ok(t.includes('Hour to 21:00 JST') && t.includes('provisional (速報値), national stations only'));
  assert.ok(!INDIAN_WORDS.test(t.replace(/Source: 環境省[^.]*/g, '')), 'no Indian scale words');
});

test('Tokyo card never turns an hour into a verdict: no "meets", "exceeds", "complies", "safe" or "unsafe"', () => {
  const t = text(localCardHtml(jpLive, 'Marunouchi', JP_NOW)) + text(localPaneHtml(jpLive, 'Marunouchi', JP_NOW));
  assert.ok(!/\b(meets?|exceeds?|exceeded|complies|compliant|passes|fails|safe|unsafe|healthy|unhealthy|good|bad|poor)\b/i.test(t.replace(/Standard \(環境基準\)/g, '')), t.match(/\b(meets?|exceeds?|complies|safe|unsafe|good|bad|poor)\b/i)?.[0]);
  assert.ok(t.includes('Each standard is judged on an average (a daily mean, or an 8-hour value), not on one hour'));
});

test('Tokyo card carries the Ministry\'s credit and its edit statement, verbatim, and the standards verbatim', () => {
  const h = localCardHtml(jpLive, 'Marunouchi', JP_NOW);
  assert.ok(h.includes('出典：環境省大気汚染物質広域監視システム（そらまめくん）（https://soramame.env.go.jp/）（速報値）'));
  assert.ok(h.includes('をもとにDelta Climate Research作成'));
  assert.ok(h.includes('オゾンとして、８時間値が0.07ppm以下であり、かつ、日最高８時間値の１年平均値が0.04ppm以下であること。'));
  assert.ok(h.includes('（R8.1.30告示）'));
  assert.ok(h.includes('１年平均値が15μg/m3以下であり、かつ、１日平均値が35μg/m3以下であること。'));
  assert.ok(h.includes('１時間値の１日平均値が0.04ppmから0.06ppmまでのゾーン内又はそれ以下であること。'));
});

test('everything from the network is escaped', () => {
  const evil = structuredClone(nlLive);
  evil.station.name = '<script>alert(1)</script>';
  evil.station.owner = '"><img src=x onerror=1>';
  for (const h of [localCardHtml(evil, 'Canal Ring', NL_NOW), localPaneHtml(evil, 'Canal Ring', NL_NOW)]) {
    assert.ok(!h.includes('<script>') && !h.includes('<img'), 'escaped');
  }
});

test('the pane adds the substances table and the five classes with their numbers (Amsterdam)', () => {
  const h = localPaneHtml(nlLive, 'Canal Ring', NL_NOW);
  assert.match(h, /<table class="pol">/);
  assert.match(h, /1–3 Goed/);
  assert.match(h, /4–6 Matig/);
  assert.match(h, /7–8 Onvoldoende/);
  assert.match(h, /9–10 Slecht/);
  assert.match(h, /11 Zeer slecht/);
  assert.match(h, /unaltered/);
});

test('loadAir routes a local area to its own painter, and refuses a body that is not this area\'s', async () => {
  const urls = [];
  const io = (body, ok = true) => ({ fetch: async (u) => { urls.push(u); return { ok, json: async () => body }; }, signal: new AbortController().signal, isCurrent: () => true, now: NL_NOW });
  const good = await loadAir('nl/amsterdam/canal-ring', 'Canal Ring', io(nlLive));
  assert.deepEqual(urls, ['/api/air-quality?area=nl%2Famsterdam%2Fcanal-ring']);
  assert.match(good.block, /class="num">3</);
  assert.deepEqual(good.days, []);
  assert.match(good.status, /LKI 3, Good, live/);
  const wrongArea = await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', io({ ...nlLive, area_id: 'jp/tokyo/marunouchi' }));
  assert.match(wrongArea.block, /could not be loaded just now/);
  const notOk = await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', io(nlLive, false));
  assert.match(notOk.pane, /could not be loaded just now/);
  const junk = await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', io({ state: 'live' }));
  assert.ok(!/class="num"/.test(junk.block));
  const ctl = new AbortController(); ctl.abort();
  assert.equal(await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', { ...io(nlLive), signal: ctl.signal }), null);
  assert.equal(await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', { ...io(nlLive), isCurrent: () => false }), null);
});

test('THE CARD FOLLOWS THE MAP: isAirCity for a local city is exactly "drawable", whichever way that stands', () => {
  for (const [key, c, a] of [['nl/amsterdam/canal-ring', 'amsterdam', 'canal-ring'], ['jp/tokyo/marunouchi', 'tokyo', 'marunouchi']]) {
    assert.equal(isAirCity(key), isDrawable(key.split('/')[0], c, a), key);
    assert.equal(localAirReady(key, () => false), false);
    assert.equal(localAirReady(key, () => true), true);
  }
  assert.equal(localAirReady('ae/dubai/creek', () => true), false, 'a city with no local card never gets one');
  assert.equal(isAirCity('in/kolkata/ballygunge'), true);
  assert.equal(isAirCity('in/bengaluru/indiranagar'), true);
  assert.equal(isAirCity('ae/dubai/creek'), false);
});

test('the zone each standard\'s card tells time in is the zone every area using it declares', () => {
  for (const a of Object.values(LOCAL_AIR_AREAS)) assert.equal(LOCAL_STANDARD_TZ[a.standard], a.tz);
});

/* F2 (audit): a single hour must not read as a pass/fail against an averaged standard, and a roadside monitor is not on ground the standard covers. */
test('F2: every Tokyo row says, in view, that one hour is not a test of the standard; roadside rows say the standard does not apply on roadways; no scale bar', () => {
  const h = localCardHtml(jpLive, 'Marunouchi', JP_NOW);
  const outside = h.replace(/<details[\s\S]*?<\/details>/g, '').replace(/&#39;/g, "'");
  const ONE = "Latest single hour (provisional). Japan's standard is judged on a daily mean (Ox: 8-hour value), so one hour is not a test of it.";
  const ROAD = 'Roadside monitor: the standard does not apply on roadways.';
  assert.equal(jpLive.readings.length, 3);
  assert.equal(outside.split(ONE).length - 1, 3, 'one line under each of the three rows, outside any <details>');
  const roadside = jpLive.readings.filter((r) => r.station.kind === 'roadside').length;
  assert.ok(roadside >= 2);
  assert.equal(outside.split(ROAD).length - 1, roadside, 'under every roadside row, and only those');
  assert.ok(!/<svg/.test(h), 'the bar with the standard\'s mark is dropped');
  const general = structuredClone(jpLive);
  general.readings = general.readings.map((r) => ({ ...r, station: { ...r.station, kind: 'general' } }));
  assert.ok(!localCardHtml(general, 'Marunouchi', JP_NOW).includes(ROAD), 'a general station gets no roadway line');
});

/* F3 (audit): CC BY-ND 4.0 §3(a)(1)(C) wants the licence indicated with its text or a URI/hyperlink. */
test('F3: the credit links the licence and shows the terms URL', () => {
  const nl = localCardHtml(nlLive, 'Canal Ring', NL_NOW);
  assert.match(nl, /<a href="https:\/\/creativecommons\.org\/licenses\/by-nd\/4\.0\/"[^>]*>CC BY-ND 4\.0<\/a>/);
  assert.match(nl, /<a href="https:\/\/www\.luchtmeetnet\.nl\/informatie\/download-data\/open-data"[^>]*>https:\/\/www\.luchtmeetnet\.nl\/informatie\/download-data\/open-data<\/a>/);
  assert.match(nl, /rel="noopener noreferrer"/);
  assert.equal(nlLive.credit.licence_url, 'https://creativecommons.org/licenses/by-nd/4.0/');
  const jp = localCardHtml(jpLive, 'Marunouchi', JP_NOW);
  assert.match(jp, /<a href="https:\/\/www\.env\.go\.jp\/mail\.html"[^>]*>https:\/\/www\.env\.go\.jp\/mail\.html<\/a>/);
  assert.match(jp, /<a href="https:\/\/www\.digital\.go\.jp\/resources\/open_data\/public_data_license_v1\.0"[^>]*>PDL 1\.0<\/a>/);
  const evil = structuredClone(nlLive);
  evil.credit.licence_url = 'javascript:alert(1)';
  assert.ok(!localCardHtml(evil, 'Canal Ring', NL_NOW).includes('javascript:'), 'only https links are drawn');
});

/* F4 (audit): an unreadable newest file is not an old hour. */
test('F4: a Tokyo placeholder hour says it could not be read right now, never "no longer current"', async () => {
  const placeholder = await readTokyo('jp/tokyo/marunouchi', { now: JP_NOW, fetch: reply({
    [METADATA_URL]: read(JP + 'noudoAll-metadata.json'), [`${SORAMAME_BASE}/2026/11/06/21.csv`]: read(JP + 'noudoAll-2026-11-06-22-placeholder.html') }) });
  assert.equal(placeholder.reason, 'source_down');
  const t = text(localCardHtml(placeholder, 'Marunouchi', JP_NOW)).replace(/\( /g, '(').replace(/ \)/g, ')');
  assert.ok(t.includes('The newest hour (6 Nov 21:00 JST) could not be read right now.'), t);
  assert.ok(!t.includes('no longer current'));
  assert.ok(!t.includes('Last hour reported'));
  const old = judge(jpLive, new Date(Date.parse(jpLive.observed_at) + 3 * 3_600_000 + 1));
  assert.ok(text(localCardHtml(old, 'Marunouchi', new Date(Date.parse(jpLive.observed_at) + 3 * 3_600_000 + 1))).includes('no longer current'), 'a genuinely old hour still says so');
});

/* F6 (audit): Luchtmeetnet's tie rule, "Als alle stoffen hetzelfde indexgetal hebben dan wordt de totale index één punt hoger". */
test('F6: the LKI explainer and the station-rule comment carry the tie rule', () => {
  const t = text(localCardHtml(nlLive, 'Canal Ring', NL_NOW));
  assert.ok(t.includes('the highest number is the index; if all the substances have the same number, the index is one point higher'), t.slice(0, 200));
  assert.match(read('src/lib/aqi/nl-stations.ts'), /same\s+index\s+number[\s\S]{0,120}one\s+point/i);
  assert.match(read('src/lib/aqi/nl-stations.ts'), /not strictly/i);
});

/* F7 (audit) */
test('F7: a load failure says "Not loaded" (as the Indian card does), not "Not reporting"', async () => {
  const io = { fetch: async () => ({ ok: false, json: async () => null }), signal: new AbortController().signal, isCurrent: () => true, now: NL_NOW };
  const p = await loadLocalAir('nl/amsterdam/canal-ring', 'Canal Ring', io);
  assert.match(p.block, /chip off">Not loaded</);
  assert.ok(!/Not reporting/.test(p.block + p.pane));
});

test('F7: the gate and the dispatch are one question, asked per area', () => {
  /* An area of a local city with no LOCAL_AIR_AREAS entry is neither gated in nor dispatched to the local painter. */
  const other = 'nl/amsterdam/jordaan';
  for (const ready of [() => false, () => true]) {
    assert.equal(localAirReady(other, ready), false);
    assert.equal(localAirReady('nl/amsterdam/canal-ring', ready), ready());
  }
  assert.equal(isAirCity(other), false, 'the gate is per area: no card is offered where the dispatch would send it to the CPCB path');
  assert.equal(isLocalAirArea(other), false);
  for (const k of Object.keys(LOCAL_AIR_AREAS)) assert.equal(isAirCity(k), localAirReady(k), k);
});

test('F7: the evidence file records that Soramame is read from the map\'s static files (Q6b) and why the US AQI line stays dropped', () => {
  const e = read('docs/evidence/2026-11-06-lki-and-soramame.md');
  assert.match(e, /static files behind the Soramame \*map\*/);
  assert.match(e, /Q6b should be asked with that in view/);
  assert.match(e, /Why the US AQI line stays dropped/);
  assert.match(e, /standard follows the regulator/);
  assert.match(e, /Do not describe the omission as "required by ND"/);
});
