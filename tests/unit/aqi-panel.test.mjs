// tests/unit/aqi-panel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardHtml, paneHtml, unavailableHtml, barTipHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const raw = (lastEnd) => { const e = Date.parse(lastEnd), o = {}; for (const p of ['pm25','pm10','no2','so2','co','o3']) { o[p] = []; for (let t = e - 31*864e5; t <= e; t += 9e5) o[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 }); } return o; };
const K = 'in/kolkata/ballygunge', st = stationFor(K);

test('stale shows the red label with the bold age and a muted number', () => {
  const html = cardHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z')), 'Ballygunge');
  assert.match(html, /class="chip old">Not Live<span class="sep">·<\/span><b>39 h<\/b> Old/);
  assert.match(html, /class="num muted"/);
  /* IST by contract: 17:30 UTC is 23:00 IST, whatever the machine's zone. */
  assert.match(html, /No readings have reached us since <span style="white-space:nowrap"><b>24 Sept? 23:00 IST<\/b><\/span>/);
});
test('no station never prints a number', () => {
  const html = cardHtml(buildPayload('in/kolkata/baruipur', null, {}, new Date()), 'Baruipur');
  assert.doesNotMatch(html, /class="num/);
  assert.match(html, /No government air monitor within 3 km/);
});
test('units are always the sans .unit span, never raw text in mono', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')), 'Ballygunge', new Date('2026-09-24T18:00:00Z'));
  assert.match(html, /<span class="unit">µg\/m³<\/span>/);
  assert.match(html, /<span class="unit">mg\/m³<\/span>/);
});
test('a pollutant with no hours shows a dash, never 0', () => {
  const r = raw('2026-09-24T17:30:00Z'); r.so2 = [];
  const html = paneHtml(buildPayload(K, st, r, new Date('2026-09-24T18:00:00Z')), 'Ballygunge', new Date('2026-09-24T18:00:00Z'));
  assert.match(html, /SO₂[\s\S]*?—/);
  /* The row itself, not "a dash somewhere after SO₂": level and sub-index are both dashes, and no cell reads 0. */
  const row = html.match(/<tr><td>SO₂[\s\S]*?<\/tr>/)?.[0] ?? '';
  assert.ok(row, 'the SO₂ row is drawn');
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim());
  assert.match(cells[1], /^— /, `level cell: ${cells[1]}`);
  assert.match(cells[2], /^—$/, `sub-index cell: ${cells[2]}`);
  assert.doesNotMatch(cells[1] + cells[2], /\b0\b/);
});
test('every category word is printed beside its colour', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')), 'Ballygunge', new Date('2026-09-24T18:00:00Z'));
  assert.match(html, /Good/);
});

/* ── additions beyond the plan ─────────────────────────────────────────────── */

test('a cached live payload older than 2 h is demoted to stale on the client', () => {
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z'));
  assert.equal(p.current.state, 'live');
  const later = new Date('2026-09-24T20:30:00Z'); // observed + 3 h
  const card = cardHtml(p, 'Ballygunge', later);
  assert.match(card, /class="chip old">Not Live<span class="sep">·<\/span><b>3 h<\/b> Old/);
  assert.match(card, /class="num muted"/);
  assert.doesNotMatch(card, /chip live/);
  assert.match(paneHtml(p, 'Ballygunge', later), /<b>3 h<\/b> Old/);
  /* Inside the 2 h it stays live. */
  const fresh = cardHtml(p, 'Ballygunge', new Date('2026-09-24T19:00:00Z'));
  assert.match(fresh, /class="chip live">Live</);
  assert.doesNotMatch(fresh, /num muted/);
});

test('a failed request renders the not-loaded treatment with no number', () => {
  const html = unavailableHtml('Ballygunge');
  assert.match(html, /could not be loaded just now/);
  assert.match(html, /Air quality · Ballygunge/);
  assert.doesNotMatch(html, /class="num/);
  assert.doesNotMatch(html, /\d/);
  assert.match(unavailableHtml('<x>'), /&lt;x&gt;/);
});

test('every network string is escaped: station name, message, reasons', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z'));
  p.current.station.name = evil;
  for (const html of [cardHtml(p, 'Ballygunge', new Date('2026-09-24T18:00:00Z')), paneHtml(p, 'Ballygunge', new Date('2026-09-24T18:00:00Z'))]) {
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img/);
  }
  const ns = buildPayload('in/kolkata/baruipur', null, {}, new Date());
  ns.current.message = evil;
  assert.doesNotMatch(cardHtml(ns, 'Baruipur') + paneHtml(ns, 'Baruipur'), /<img/);
  const tip = barTipHtml({ date_ist: '<d>', aqi: null, category: null, dominant: null, reason: `${evil}; more` });
  assert.match(tip, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(tip, /&lt;d&gt;/);
  assert.doesNotMatch(tip, /<img|<d>/);
});

test('the 24 h PM2.5 label never implies "from now" when the feed is stale', () => {
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z'));
  assert.equal(p.current.state, 'stale');
  const stale = paneHtml(p, 'Ballygunge', new Date('2026-09-26T08:30:00Z'));
  assert.match(stale, /PM2\.5 · 24 hours to the last reading/);
  assert.doesNotMatch(stale, /last 24 hours/);
  const live = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z'));
  assert.match(paneHtml(live, 'Ballygunge', new Date('2026-09-24T18:00:00Z')), /PM2\.5 · last 24 hours/);
  /* The line carries the 60 µg/m³ national limit for scale. */
  assert.match(stale, /60 · 24-h national limit/);
});

test('every state paints without throwing, and only live and stale print a number', () => {
  const now = new Date('2026-09-26T08:30:00Z');
  const short = raw('2026-09-26T08:15:00Z');
  for (const p of Object.keys(short)) short[p] = short[p].filter((r) => Date.parse(r.end_utc) > now - 10 * 36e5);
  const cases = {
    live: buildPayload(K, st, raw('2026-09-26T08:15:00Z'), now),
    stale: buildPayload(K, st, raw('2026-09-24T17:30:00Z'), now),
    unavailable: buildPayload(K, st, raw('2026-09-10T00:00:00Z'), now),
    unavailable_null: buildPayload(K, st, {}, now),
    insufficient_data: buildPayload(K, st, short, now),
    no_station: buildPayload('in/kolkata/baruipur', null, {}, now),
  };
  for (const [name, p] of Object.entries(cases)) {
    const want = name.replace('_null', '');
    assert.equal(p.current.state, want, name);
    const html = cardHtml(p, 'Ballygunge', now) + paneHtml(p, 'Ballygunge', now);
    assert.equal(/class="num/.test(html), want === 'live' || want === 'stale', name);
    assert.doesNotMatch(html, /undefined|NaN|null/, name);
  }
  assert.match(cardHtml(cases.insufficient_data, 'Ballygunge', now), /class="chip old">Too few hours</);
  assert.match(cardHtml(cases.unavailable, 'Ballygunge', now), /class="chip off">No data</);
});

test('missing days are hatched stubs; a day with no readings says so in its tip', () => {
  const now = new Date('2026-09-26T08:30:00Z');
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), now);
  const html = paneHtml(p, 'Ballygunge', now);
  assert.match(html, /fill="url\(#aqHatch\)"/);
  const gap = p.history.days.find((d) => d.aqi === null);
  assert.ok(gap, 'the day after the feed died is missing');
  assert.match(barTipHtml(gap), /No official AQI[\s\S]*no readings/);
});

test('an area with no station never names a board as measuring it', () => {
  const html = paneHtml(buildPayload('in/kolkata/baruipur', null, {}, new Date()), 'Baruipur');
  assert.doesNotMatch(html, /Measured by/);
  assert.match(html, /3 km window/);
});

/* ── the final audit's UI findings (I4, I5, I6, M1, M2, N14) ────────────────── */

const rawWith = (lastEnd, over) => { const o = raw(lastEnd); for (const [p, v] of Object.entries(over)) o[p] = o[p].map((r) => ({ ...r, value: v })); return o; };
const T = new Date('2026-09-24T18:00:00Z');

test('I4: an O₃-led AQI names the maximum 8-hour mean, a PM-led one the 24-hour mean', () => {
  const o3 = buildPayload(K, st, rawWith('2026-09-24T17:30:00Z', { o3: 150 }), T);
  assert.equal(o3.current.result.dominant, 'o3');
  const card = cardHtml(o3, 'Ballygunge', T);
  assert.match(card, /Led by <b>O₃<\/b> · AQI computed by OBOS from OpenAQ \(CPCB feed unreachable\) · <span[^>]*>maximum 8-hour mean<\/span>/);
  assert.doesNotMatch(card, /24-hour/);
  const pm = buildPayload(K, st, rawWith('2026-09-24T17:30:00Z', { pm25: 80 }), T);
  assert.equal(pm.current.result.dominant, 'pm25');
  assert.match(cardHtml(pm, 'Ballygunge', T), /Led by <b>PM2\.5<\/b> · AQI computed by OBOS from OpenAQ \(CPCB feed unreachable\) · <span[^>]*>24-hour mean<\/span>/);
  /* The table header must not call the whole table a 24-hour window while O₃ and CO rows are 8-hour. */
  assert.doesNotMatch(paneHtml(o3, 'Ballygunge', T), /Pollutants · 24-hour window/);
});

test('M2: the method note says OBOS computed the AQI with CPCB\'s method', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T), 'Ballygunge', T);
  assert.match(html, /AQI calculated by OBOS with CPCB's National AQI method from the station's readings \(received via CPCB and OpenAQ\); it can differ slightly from CPCB's own published figure\./);
});

test('N14: each unit sits in its own row: CO in mg/m³, PM2.5 in µg/m³', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T), 'Ballygunge', T);
  const row = (name) => html.match(new RegExp(`<tr><td>${name}[\\s\\S]*?</tr>`))?.[0] ?? '';
  assert.match(row('CO'), /<span class="unit">mg\/m³<\/span>/);
  assert.doesNotMatch(row('CO'), /µg/);
  assert.match(row('PM2\\.5'), /<span class="unit">µg\/m³<\/span>/);
  assert.doesNotMatch(row('PM2\\.5'), /mg\/m³/);
});

test('I5: esc escapes both quotes, so a network string cannot break out of an attribute', async () => {
  const { esc } = await import('../../src/scripts/climate-engine/air/air-panel.ts');
  assert.equal(esc(`a"b'c<&>`), 'a&quot;b&#39;c&lt;&amp;&gt;');
  /* A day's reason lands in the hit-rect's aria-label; it must stay one attribute. */
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T);
  p.history.days[3] = { date_ist: p.history.days[3].date_ist, aqi: null, category: null, dominant: null, reason: 'x" onmouseover="y' };
  const html = paneHtml(p, 'Ballygunge', T);
  assert.doesNotMatch(html, /" onmouseover="/);
  assert.match(html, /x&quot; onmouseover=&quot;y/);
});

test('I5: hostile numbers and categories reaching the painter directly print no markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T);
  p.current.result.aqi = evil;
  p.current.result.pollutants[0].value = evil;
  p.current.result.pollutants[0].sub_index = evil;
  p.current.result.pollutants[0].hours_present = evil;
  p.history.days[0] = { ...p.history.days.find((d) => d.aqi !== null), aqi: evil, category: `good);"><img src=x onerror=alert(2)>` };
  p.history.pm25_24h[p.history.pm25_24h.length - 1].value = evil;
  const html = cardHtml(p, 'Ballygunge', T) + paneHtml(p, 'Ballygunge', T) + barTipHtml(p.history.days[0]);
  assert.doesNotMatch(html, /<img/);
  const s = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z'));
  s.current.age_h = evil;
  s.current.result.category = `good);"><img src=x onerror=alert(2)>`;
  assert.doesNotMatch(cardHtml(s, 'Ballygunge', new Date('2026-09-26T08:30:00Z')), /<img/);
});

test('I5: an unknown state renders the failure view, never "undefined"', () => {
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T);
  p.current.state = 'bogus';
  const card = cardHtml(p, 'Ballygunge', T), pane = paneHtml(p, 'Ballygunge', T);
  assert.equal(card, unavailableHtml('Ballygunge'));
  assert.match(pane, /could not be loaded just now/);
  assert.doesNotMatch(card + pane, /undefined/);
});

test('M1: each unavailable reason says its own thing, and blames no one', () => {
  const now = new Date('2026-09-26T08:30:00Z');
  const base = buildPayload(K, st, raw('2026-09-10T00:00:00Z'), now);
  assert.equal(base.current.state, 'unavailable');
  const as = (reason, last) => ({ ...base, current: { ...base.current, reason, last_observed_at: last } });
  const quiet = cardHtml(as('feed_quiet', '2026-09-10T00:00:00Z'), 'Ballygunge', now);
  assert.match(quiet, /No readings have reached us from this station for more than 7 days\./);
  assert.match(quiet, /Last reading/);
  assert.match(quiet, /class="chip off">No data</);
  const quietNull = cardHtml(as('feed_quiet', null), 'Ballygunge', now);
  assert.match(quietNull, /more than 7 days/);
  assert.doesNotMatch(quietNull, /Last reading/);
  /* The reason decides, not the clock: a no_valid_aqi payload never says "7 days", even with an old last reading. */
  const noAqi = cardHtml(as('no_valid_aqi', '2026-09-10T00:00:00Z'), 'Ballygunge', now);
  assert.match(noAqi, /Too few recent readings for an official AQI\./);
  assert.match(noAqi, /class="chip off">No AQI</);
  assert.doesNotMatch(noAqi, /7 days/);
  const up = cardHtml(as('upstream_error', null), 'Ballygunge', now);
  assert.match(up, /Air-quality data could not be loaded just now\. Try again shortly\./);
  assert.match(up, /class="chip off">Not loaded</);
  assert.doesNotMatch(up, /7 days|Too few/);
  for (const html of [quiet, quietNull, noAqi, up, unavailableHtml('Ballygunge')]) {
    assert.doesNotMatch(html, /Government air-quality feed unavailable|Feed down/);
  }
  assert.match(unavailableHtml('Ballygunge'), /Air-quality data could not be loaded just now\. Try again shortly\./);
  assert.match(unavailableHtml('Ballygunge'), /class="chip off">Not loaded</);
});

test('M1: stale says no readings have reached us, not that the station stopped', () => {
  const now = new Date('2026-09-26T08:30:00Z');
  const html = cardHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), now), 'Ballygunge', now);
  assert.match(html, /No readings have reached us since <span style="white-space:nowrap"><b>24 Sept? 23:00 IST<\/b><\/span>\./);
  assert.doesNotMatch(html, /has not reported/);
});

const winter = () => {
  const p = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T);
  p.history.days = p.history.days.map((d, i) => i === 4 ? { date_ist: d.date_ist, aqi: null, category: null, dominant: null, reason: 'PM2.5 had 9 of 16 required hours' }
    : { date_ist: d.date_ist, aqi: 300 + (i * 5) % 150, category: 300 + (i * 5) % 150 > 400 ? 'severe' : 'very_poor', dominant: 'pm25' });
  return p;
};

test('I6a/c: every bar is a focusable, labelled hit-rect, and a hidden list tells the 30 days', () => {
  const p = winter();
  const html = paneHtml(p, 'Ballygunge', T);
  const hits = [...html.matchAll(/<rect class="hit"[^>]*>/g)].map((m) => m[0]);
  assert.equal(hits.length, p.history.days.length);
  for (const h of hits) assert.match(h, /tabindex="0"/);
  const d0 = p.history.days[0];
  assert.ok(hits[0].includes(`aria-label="${d0.date_ist}: AQI ${d0.aqi}, Very poor"`), hits[0]);
  assert.match(hits[4], /aria-label="[^"]*No official AQI, PM2\.5 had 9 of 16 required hours"/);
  assert.match(html, /<svg[^>]*aria-describedby="aqDays"/);
  const list = html.match(/<ul class="aq-sr" id="aqDays">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  assert.equal((list.match(/<li>/g) ?? []).length, p.history.days.length);
  assert.match(list, new RegExp(`<li>${d0.date_ist}: AQI ${d0.aqi}, Very poor</li>`));
});

test('I6d: the legend names all six categories', () => {
  const html = paneHtml(winter(), 'Ballygunge', T);
  const legend = html.match(/<div class="aq-legend">([\s\S]*?)<\/div>/)?.[1] ?? '';
  for (const w of ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very poor', 'Severe']) assert.match(legend, new RegExp(`</span>${w}</span>`), w);
});

test('I6e: gridlines at 200, 300 and 400 appear once the data reaches them', () => {
  const tick = (html, t) => new RegExp(`font-family="var\\(--mono\\)">${t}</text>`).test(html.match(/aq-bars[\s\S]*?<\/svg>/)[0]);
  const hot = paneHtml(winter(), 'Ballygunge', T);
  for (const t of [50, 100, 200, 300, 400]) assert.ok(tick(hot, t), `tick ${t}`);
  const mild = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T), 'Ballygunge', T);
  for (const t of [200, 300, 400]) assert.ok(!tick(mild, t), `no tick ${t} on a mild month`);
});

test('I6f: a one-line status names the state for screen readers', async () => {
  const { statusText } = await import('../../src/scripts/climate-engine/air/air-panel.ts');
  const now = new Date('2026-09-26T08:30:00Z');
  const s = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), now);
  assert.equal(statusText(s, 'Ballygunge', now), `Air quality, Ballygunge: ${s.current.result.aqi} Good, not live, 39 hours old`);
  const l = buildPayload(K, st, raw('2026-09-24T17:30:00Z'), T);
  assert.equal(statusText(l, 'Ballygunge', T), `Air quality, Ballygunge: ${l.current.result.aqi} Good, live`);
});

import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { currentFromFeed, parseFeed, pick } from '../../src/lib/aqi/cpcb-feed.ts';

const FEED = parseFeed(gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8'));
const KB = 'in/kolkata/ballygunge', SB = stationFor(KB);
const cp = (now, hist = null) => ({ current: currentFromFeed(pick(FEED, SB), KB, SB, now), history: hist });
const C1 = new Date('2026-09-27T00:30:00Z');

test('CPCB live: published line, 24-hour average, published time, no concentration anywhere', () => {
  const card = cardHtml(cp(C1), 'Ballygunge', C1), pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(card, /Led by <b>PM10<\/b> · CPCB published AQI · <span[^>]*>24-hour average<\/span>/);
  assert.match(card, /Published by CPCB at <span style="white-space:nowrap"><b>27 Sept 05:00 IST<\/b><\/span>/);
  assert.match(pane, /Pollutants · CPCB sub-indices/);
  assert.match(pane, /<th>24-h sub-index<\/th><th>24-h range<\/th><th>Latest hour<\/th>/);
  assert.doesNotMatch(pane, /µg\/m³|mg\/m³/);
  assert.match(pane, /The largest is the AQI/);
});

test('CPCB table rows: PM10 38 with range 18–53 and latest 45; a null hourly is a dash', () => {
  const pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(pane, /<td>PM10<\/td><td><span class="si">[^]*?38<\/span><\/td><td class="n">18–53<\/td><td class="n">45<\/td>/);
  const p = cp(C1); p.current.result.subindices = p.current.result.subindices.map((q) => ({ ...q, hourly: null }));
  assert.match(paneHtml(p, 'Ballygunge', C1), /<td class="n">—<\/td>/);
});

test('CPCB stale: red chip, muted number, "No update has reached us since"', () => {
  const T = new Date('2026-09-27T04:40:00Z');
  const card = cardHtml(cp(T), 'Ballygunge', T);
  assert.match(card, /Not Live<span class="sep">·<\/span><b>5 h<\/b> Old/);
  assert.match(card, /class="num muted"/);
  assert.match(card, /No update has reached us since\./);
});

test('O3-led CPCB value reads 8-hour maximum', () => {
  const p = cp(C1); p.current.result.dominant = 'o3'; p.current.result.window_h = 8;
  assert.match(cardHtml(p, 'Ballygunge', C1), /CPCB published AQI · <span[^>]*>8-hour maximum<\/span>/);
});

test('CPCB insufficient: No AQI chip, the reason, the sub-index table', () => {
  const f = { ...pick(FEED, SB), aqi: null, dominant: null };
  const p = { current: currentFromFeed(f, KB, SB, C1), history: null };
  const card = cardHtml(p, 'Ballygunge', C1), pane = paneHtml(p, 'Ballygunge', C1);
  assert.match(card, /chip old">No AQI</);
  assert.match(card, /CPCB published no AQI at/);
  assert.match(pane, /Pollutants · CPCB sub-indices/);
});

test('method note names CPCB as the source of the AQI and OpenAQ as the source of the chart', () => {
  const pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(pane, /The AQI is CPCB's own published figure for this station/);
  assert.match(pane, /calculated by OBOS with CPCB's method from OpenAQ's copy/);
});

test('no history with a CPCB current says so instead of an empty chart', () => {
  assert.match(paneHtml(cp(C1), 'Ballygunge', C1), /History is loading or unavailable; it comes from OpenAQ\./);
});

test('OBOS fallback is labelled as ours', () => {
  const p = buildPayload(KB, SB, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z'));
  assert.match(cardHtml(p, 'Ballygunge', new Date('2026-09-24T18:00:00Z')), /AQI computed by OBOS from OpenAQ \(CPCB feed unreachable\)/);
});

// Addition beyond the plan: the approved preview (previews/aqi-cpcb) marks the row holding the AQI.
test('the sub-index row that holds the AQI is marked, and only when CPCB published one', () => {
  const pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.equal(pane.match(/<tr class="top">/g)?.length, 1);
  assert.match(pane, /<tr class="top"><td>PM10<\/td>/);
  const f = { ...pick(FEED, SB), aqi: null, dominant: null };
  assert.doesNotMatch(paneHtml({ current: currentFromFeed(f, KB, SB, C1), history: null }, 'Ballygunge', C1), /class="top"/);
});

test('an IST time never breaks across lines: the CPCB live card holds its time in a nowrap span', () => {
  assert.match(cardHtml(cp(C1), 'Ballygunge', C1), /Published by CPCB at <span style="white-space:nowrap"><b>27 Sept 05:00 IST<\/b><\/span>/);
});
