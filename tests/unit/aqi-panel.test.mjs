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
  assert.match(html, /Readings to <b>24 Sept? 23:00 IST<\/b>/);
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

test('a failed request renders the feed-unavailable treatment with no number', () => {
  const html = unavailableHtml('Ballygunge');
  assert.match(html, /Government air-quality feed unavailable/);
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
  assert.match(cardHtml(cases.unavailable, 'Ballygunge', now), /Government air-quality feed unavailable/);
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
