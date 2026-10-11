// tests/unit/aqi-explainer.test.mjs — the PM2.5 line and "Why do other apps show a different number?"
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardHtml, paneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

/**
 * HAND-TYPED, NOT IMPORTED. These are an independent transcript of the card's fixed prose, as
 * the other pinned sentences in this suite are. Shared constants would let a reword change the
 * expectation in the same keystroke. When the wording changes on purpose, change it here in the
 * same commit.
 *
 * THE RULE THE ANSWER KEEPS: it names other apps and never says one is wrong. The cause of the
 * gap between their PM2.5 and CPCB's is not established.
 */
const QUESTION = 'Why do other apps show a different number?';
const ANSWER = 'Apps such as IQAir and aqi.in show the American scale, which scores the same air differently from India\'s. '
  + 'The US figure above is on that scale. Apps also differ in timing: India\'s official index looks back over many hours, '
  + 'and some apps weight the most recent hours instead. '
  + 'Apps can also differ in which readings they use.';
const WITH_PM = `${ANSWER} The PM2.5 figure above is in µg/m³, a unit that means the same on every scale.`;
const WITHOUT_PM = ANSWER;

const NOW = new Date('2026-10-11T00:00:00Z');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** A live CPCB payload. `pm25` is the PM2.5 sub-index entry, or null for none at all. */
const cpcb = (pm25 = { avg: 79, hourly: 86 }, over = {}) => ({ history: null, current: {
  schema: 2, area_id: 'in/kolkata/ballygunge', served_at: '2026-10-10T23:40:00Z', state: 'live', observed_at: '2026-10-10T23:30:00Z',
  source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' },
  station: { id: 'openaq:10918', name: 'Ballygunge, Kolkata', lat: 22.5, lon: 88.4, distance_m: 1657, inside: 'outside_window', placement: 'in KMC Ward 69, outside Ward 68' },
  result: { origin: 'cpcb', aqi: 100, category: 'satisfactory', dominant: 'pm10', window_h: 24,
    subindices: [
      ...(pm25 ? [{ parameter: 'pm25', avg: pm25.avg, min: 63, max: 99, hourly: pm25.hourly }] : []),
      { parameter: 'pm10', avg: 100, min: 83, max: 113, hourly: 105 },
    ] },
  ...over } });

test('a live CPCB card prints the PM2.5 concentration under the headline and above the US line', () => {
  for (const html of [cardHtml(cpcb(), 'Ballygunge', NOW), paneHtml(cpcb(), 'Ballygunge', NOW)]) {
    // Sub-index 86 sits in CPCB's 30-60 µg/m³ band: 30 + (86 - 50) × 30 / 50 = 51.6, shown as 52.
    assert.ok(text(html).includes('Fine particles (PM2.5) · about 52 µg/m³ in the latest hour'), text(html));
    assert.ok(html.indexOf('class="num') < html.indexOf('aq-pm'), 'after the official number');
    assert.ok(html.indexOf('aq-pm') < html.indexOf('class="aq-us"'), 'before the US line');
  }
});

test('the PM2.5 figure says it is worked back from the index, because CPCB publishes no concentration', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const pm = html.match(/<details class="aq-pm">([\s\S]*?)<\/details>/);
  assert.ok(pm, 'closed by default: no open attribute');
  const note = "Worked back from CPCB's latest hourly PM2.5 sub-index (86) on CPCB's own scale. "
    + 'CPCB publishes the index, not the concentration, so this is approximate, to within about 2 µg/m³.';
  assert.equal(text(pm[1].match(/<p>([\s\S]*?)<\/p>/)[1]), note);
  // The same sentence on hover, as the US line does it.
  assert.ok(pm[1].includes(`title="${note.replace(/'/g, '&#39;')}"`));
});

test('the concentration is the inverse of the HOURLY sub-index, rounded to a whole number', () => {
  const at = (hourly) => text(cardHtml(cpcb({ avg: 79, hourly }), 'Ballygunge', NOW)).match(/about (\S+) µg\/m³/)?.[1];
  assert.equal(at(50), '30');
  assert.equal(at(100), '60');
  assert.equal(at(86), '52');
  // 52.2: rounded, not rounded up.
  assert.equal(at(87), '52');
  assert.equal(at(250), '105');
  // 400 is the last sub-index CPCB's bands pin to a concentration (250 µg/m³).
  assert.equal(at(400), '250');
  // The 24-hour average is a different number and is not what the line shows.
  assert.equal(text(cardHtml(cpcb({ avg: 250, hourly: 86 }), 'Ballygunge', NOW)).match(/about (\S+) µg\/m³/)?.[1], '52');
});

test('no PM2.5 line without a live CPCB hourly figure: never a guess', () => {
  const none = (p, now = NOW) => assert.doesNotMatch(cardHtml(p, 'Ballygunge', now), /aq-pm|Fine particles/);
  none(cpcb({ avg: 79, hourly: null }));
  none(cpcb({ avg: 79, hourly: Number.NaN }));
  none(cpcb({ avg: 79, hourly: -1 }));
  // CPCB's own calculator treats 0 as a missing reading.
  none(cpcb({ avg: 79, hourly: 0 }));
  // Above 400 CPCB's top band is open-ended: the inverse would be an extrapolation.
  none(cpcb({ avg: 79, hourly: 401 }));
  none(cpcb({ avg: 79, hourly: 500 }));
  none(cpcb({ avg: 79, hourly: '86' }));
  none(cpcb(null));
  // Stale: the same payload read three hours after it was observed.
  const later = new Date('2026-10-11T02:40:00Z');
  assert.match(cardHtml(cpcb(), 'Ballygunge', later), /Not Live/);
  none(cpcb(), later);
});

test('an OBOS-calculated figure gets no PM2.5 line, and its answer does not point at one', () => {
  const st = stationFor('in/kolkata/ballygunge');
  const end = Date.parse('2026-09-24T17:30:00Z'); const raw = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3']) { raw[p] = []; for (let t = end - 31 * 864e5; t <= end; t += 9e5) raw[p].push({ end_utc: new Date(t).toISOString(), value: 40 }); }
  const at = new Date('2026-09-24T18:00:00Z');
  const html = cardHtml(buildPayload('in/kolkata/ballygunge', st, raw, at), 'Ballygunge', at);
  assert.match(html, /US AQI/, 'sanity: the OBOS path still prints a US line');
  assert.doesNotMatch(html, /aq-pm/);
  assert.ok(text(html).includes(WITHOUT_PM));
  assert.ok(!text(html).includes('PM2.5 figure above'));
});

test('the question is last in the block, closed, and carries the exact answer', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const why = html.match(/<details class="aq-why">([\s\S]*?)<\/details>/);
  assert.ok(why, 'closed by default: no open attribute');
  assert.ok(html.trimEnd().endsWith('</details>'), 'nothing follows it in the block');
  assert.ok(html.indexOf('Published by CPCB') < html.indexOf('aq-why'), 'after the publication line');
  assert.equal(text(why[1].match(/<summary>([\s\S]*?)<\/summary>/)[1]), QUESTION);
  assert.equal(text(why[1].match(/<p>([\s\S]*?)<\/p>/)[1]), WITH_PM);
});

test('the answer drops its last clause when there is no PM2.5 line to point at', () => {
  const html = cardHtml(cpcb({ avg: 79, hourly: null }), 'Ballygunge', NOW);
  assert.match(html, /US AQI/, 'sanity: the 24-hour US line is still there');
  assert.equal(text(html.match(/<details class="aq-why">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1]), WITHOUT_PM);
});

test('the question rides with the US line: both forms have it, a card with no US line does not', () => {
  const nowcast = { ...cpcb(), us_nowcast: { aqi: 137, category: 'usg', dominant: 'pm25', hours_used: 12 } };
  assert.match(cardHtml(nowcast, 'Ballygunge', NOW), /NowCast[\s\S]*aq-why/);
  assert.match(cardHtml(cpcb(), 'Ballygunge', NOW), /24-h[\s\S]*aq-why/);
  // No PM sub-index at all: no US line, so nothing to explain.
  const gases = cpcb(); gases.current.result.subindices = [{ parameter: 'no2', avg: 65, min: 34, max: 130, hourly: 74 }];
  const html = cardHtml(gases, 'Ballygunge', NOW);
  assert.doesNotMatch(html, /US AQI/);
  assert.doesNotMatch(html, /aq-why/);
});

test('a PM2.5 line with no US line carries no question: the answer would point at a figure that is not there', () => {
  // Latest hour published, 24-hour averages not: a concentration, but nothing to put on the US scale.
  const p = cpcb({ avg: null, hourly: 86 }); p.current.result.subindices = p.current.result.subindices.filter((q) => q.parameter === 'pm25');
  const html = cardHtml(p, 'Ballygunge', NOW);
  assert.match(html, /aq-pm/);
  assert.doesNotMatch(html, /US AQI/);
  assert.doesNotMatch(html, /aq-why/);
});

test('a stale card keeps the question with its 24-hour US line', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', new Date('2026-10-11T02:40:00Z'));
  assert.match(html, /Not Live/);
  assert.match(html, /US AQI/);
  assert.match(html, /aq-why/);
  assert.ok(text(html).includes(WITHOUT_PM));
});

test('states with no figure carry no question', () => {
  const base = cpcb().current;
  const shell = { schema: 2, area_id: base.area_id, served_at: base.served_at, source: base.source, station: base.station };
  const states = [
    buildPayload('in/kolkata/baruipur', null, {}, NOW),
    { history: null, current: { ...shell, state: 'unavailable', reason: 'feed_quiet', last_observed_at: null } },
    { history: null, current: { ...shell, state: 'unavailable', reason: 'station_not_reporting', last_observed_at: null } },
    { history: null, current: { ...shell, state: 'insufficient_data', origin: 'cpcb', observed_at: base.observed_at, reasons: ['no AQI'], subindices: [] } },
  ];
  for (const p of states) {
    const html = cardHtml(p, 'Ballygunge', NOW);
    assert.doesNotMatch(html, /class="num/, `sanity: ${p.current.state} prints no number`);
    assert.doesNotMatch(html, /aq-why|aq-pm/, p.current.state);
  }
});

test('the answer claims nothing that depends on the day: no direction, no timing of this card, no rank', () => {
  // PM2.5-led at 320: the US figure (about 221) is the LOWER one. A stale card and a NowCast card read the same answer.
  const high = cpcb({ avg: 320, hourly: 330 }); high.current.result.aqi = 320; high.current.result.dominant = 'pm25';
  const nowcast = { ...cpcb(), us_nowcast: { aqi: 137, category: 'usg', dominant: 'pm25', hours_used: 12 } };
  for (const html of [cardHtml(high, 'Ballygunge', NOW), cardHtml(nowcast, 'Ballygunge', NOW), cardHtml(cpcb(), 'Ballygunge', new Date('2026-10-11T02:40:00Z'))]) {
    const answer = text(html.match(/<details class="aq-why">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1]);
    assert.doesNotMatch(answer, /higher|lower|US figure here|every number|official monitor|own monitor|one to compare|wrong|accurate/i);
  }
  // Escaped where it is interpolated: the apostrophe reaches the page as an entity.
  assert.match(cardHtml(cpcb(), 'Ballygunge', NOW), /from India&#39;s\. The US figure above/);
});

test('a fallback station keeps the PM2.5 line: the figure is that monitor\'s, wherever it stands', () => {
  const far = cpcb(); far.current.station.fallback = true;
  assert.match(cardHtml(far, 'Ballygunge', NOW), /aq-pm/);
});

test('the 24-hour notes no longer name other apps beside a figure that differs from theirs', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const note = html.match(/<details class="aq-us">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
  assert.match(note, /Same air, US EPA scale: converted from CPCB&#39;s 24-hour PM2.5\/PM10\./);
  assert.doesNotMatch(note, /IQAir|aqi\.in/);
});
