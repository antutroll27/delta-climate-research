/**
 * THE AIR PAINTERS: the right-panel card and the Air pane, as pure HTML per state.
 *
 * The founder-approved design of spec 2026-09-26-aqi-kolkata-design.md §5 (mono
 * version, approved 2026-09-26). Notes on the build:
 *  - the chart legend is `.aq-legend`, not `.legend`: `.legend` is the stage's heat
 *    key and its rules (a floating panel, hidden at narrow widths) would land on it;
 *  - element ids are `aq`-prefixed, because the stage is one document;
 *  - the wording never says whose fault a gap is: an outage can sit anywhere
 *    between the station and us, so the text says what reached us, not who stopped.
 *
 * Pure except `wireBarTips`. TWO LINES OF DEFENCE: `loadAir` paints only a body
 * that passes `isAirPayload` (lib/aqi/valid.ts), and the painters still print
 * every network string through `esc()`, every number through `num()`, and every
 * category, pollutant and unit through a lookup that falls back to a dash or a
 * neutral colour. Missing is a dash, never 0.
 */
import { category } from '../../../lib/aqi/cpcb.ts';
import { LIVE_H } from '../../../lib/aqi/build.ts';
import { AIR_STATES, isAirPayload } from '../../../lib/aqi/valid.ts';
import type { AirQualityPayload, AqiResult, AqiStation, CpcbCategory, HistoryDay, HistoryResponse, Pollutant, PollutantReading, Result } from '../../../lib/aqi/types.ts';

type Current = AirQualityPayload['current'];

const HOUR_MS = 3_600_000;
const MIN_HOURS = 16;
const WORD: Readonly<Record<CpcbCategory, string>> = { good: 'Good', satisfactory: 'Satisfactory', moderate: 'Moderate', poor: 'Poor', very_poor: 'Very poor', severe: 'Severe' };
const POL: Readonly<Record<Pollutant, string>> = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', co: 'CO', o3: 'O₃', nh3: 'NH₃' };
const UNIT = { ug_m3: 'µg/m³', mg_m3: 'mg/m³' } as const;
/** Owners the card abbreviates, as the preview did; any other owner prints in full. */
const OWNER_SHORT: Readonly<Record<string, string>> = { 'West Bengal Pollution Control Board': 'WBPCB' };

export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** A number as text, or a dash for anything that is not a finite number. */
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
const has = (m: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(m, k);
/** A CPCB colour only for a known category; anything else is the neutral faint token. */
const col = (c: unknown): string => (has(WORD, c) ? `var(--c-${c})` : 'var(--faint)');
const word = (c: unknown): string => (has(WORD, c) ? WORD[c as CpcbCategory] : '—');
const pol = (p: unknown): string => (has(POL, p) ? POL[p as Pollutant] : '—');
const unit = (u: unknown): string => (has(UNIT, u) ? UNIT[u as keyof typeof UNIT] : '—');
const km = (m: number): string => (Number.isFinite(m) ? `${(m / 1000).toFixed(1)} km` : '—');
/* IST BY CONTRACT, NOT BY SCOPE: CPCB's windows and the payload's `*_ist` fields are
   Indian Standard Time whatever city the viewer is in, and IST has no DST, so the
   fixed offset is exact and no zone is named (obos-scope's clock-zone guard). */
const IST_MS = 5.5 * 3_600_000;
const ist = (iso: string): Date => new Date(Date.parse(iso) + IST_MS);
const istFmt = (iso: string): string => ist(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12: false }).replace(',', '') + ' IST';
const istDay = (iso: string): string => ist(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/**
 * THE CDN CAN SERVE A LIVE PAYLOAD ~40 MIN OLD (s-maxage 600 + swr 1800), so "live"
 * is re-judged against the viewer's clock with the server's own 2 h rule.
 */
function demote(c: Current, now: Date): Current {
  if (c.state !== 'live') return c;
  const ageMs = now.getTime() - Date.parse(c.observed_at);
  if (!(ageMs > LIVE_H * HOUR_MS)) return c;
  return { ...c, state: 'stale', age_h: Math.floor(ageMs / HOUR_MS) };
}

const head = (title: string, chip: string): string => `<div class="k legend-head"><span>${title}</span>${chip}</div>`;

function stationLine(s: AqiStation, owner: string | null, place: string): string {
  return `<p class="meta"><b>${esc(s.name.replace(' – WBPCB', ''))}</b> · ${esc((owner && OWNER_SHORT[owner]) ?? owner ?? '')} monitor · ${km(s.distance_m)} from the ${esc(place)} centre</p>`;
}

/** O₃ and CO are the maximum rolling 8-hour mean; every other pollutant the 24-hour mean. Read from the dominant reading itself. */
const windowOf = (r: AqiResult): string => (r.pollutants.find((q) => q.parameter === r.dominant)?.window_h === 8 ? 'maximum 8-hour mean' : '24-hour mean');

function hero(r: Result, muted: boolean): string {
  if (r.origin === 'cpcb') return ''; // Task 7 paints origin cpcb
  return `<div class="hero"><span class="num${muted ? ' muted' : ''}" style="color:${col(r.category)}">${num(r.aqi)}</span>
    <span class="cat"><span class="dot" style="background:${col(r.category)}"></span>${word(r.category)}</span></div>
    <p class="meta">Led by <b>${pol(r.dominant)}</b> · AQI by CPCB's method · <span style="white-space:nowrap">${windowOf(r)}</span></p>`;
}

/* NEUTRAL ABOUT WHOSE FAULT A GAP IS: a quiet feed may be the station, CPCB, OpenAQ
   or us, so each sentence says what reached us and makes no claim about who stopped. */
const FAILED = 'Air-quality data could not be loaded just now. Try again shortly.';
const noFigure = (title: string, chip: string, say: string, meta = ''): string =>
  head(title, `<span class="chip off">${chip}</span>`) + `<p class="empty">${say}</p>` + (meta ? `\n     <p class="meta">${meta}</p>` : '');
const lastReading = (iso: string | null): string => (iso === null ? '' : `Last reading <b>${esc(istFmt(iso))}</b>.`);

/** The card's content for one state; `title` is the head's label (empty in the pane, which has its own heading). */
function block(c: Current, title: string, place: string): string {
  switch (c.state) {
    case 'no_station':
      return head(title, '<span class="chip off">No station</span>') +
        `<p class="empty">${esc(c.message)}</p>
     <p class="meta">${esc(place)} has no continuous station, so OBOS shows no air-quality figure here rather than borrow one from elsewhere.</p>`;
    case 'unavailable': {
      /* The server's reason decides the sentence; the viewer's clock never guesses it. */
      const text = c.reason === 'feed_quiet' ? noFigure(title, 'No data', 'No readings have reached us from this station for more than 7 days.', lastReading(c.last_observed_at))
        : c.reason === 'no_valid_aqi' ? noFigure(title, 'No AQI', 'Too few recent readings for an official AQI.', lastReading(c.last_observed_at))
          : noFigure(title, 'Not loaded', FAILED);
      return text + stationLine(c.station, c.source.owner, place);
    }
    case 'insufficient_data': {
      if (c.origin === 'cpcb') return ''; // Task 7 paints origin cpcb
      const short = c.pollutants.filter((q) => q.hours_present < MIN_HOURS);
      const worst = short.find((q) => q.parameter === 'pm25') ?? short[0];
      const sent = worst ? `the station sent <b>${num(worst.hours_present)} of 16</b>${worst.parameter === 'pm25' ? '' : ` for ${pol(worst.parameter)}`}` : esc(c.reasons[0] ?? '');
      return head(title, '<span class="chip old">Too few hours</span>') +
        `<p class="empty">No official AQI for ${esc(istDay(c.observed_at))}.</p>
     <p class="meta">CPCB needs 16 hours of readings in 24 hours; ${sent}.</p>` + stationLine(c.station, c.source.owner, place);
    }
    case 'live':
    case 'stale': {
      const stale = c.state === 'stale';
      const chip = stale ? `<span class="chip old">Not Live<span class="sep">·</span><b>${num(c.age_h)} h</b> Old</span>` : '<span class="chip live">Live</span>';
      /* Stale: the station may still be reporting to CPCB; the outage can be in the relay. */
      return head(title, chip) + hero(c.result, stale) + stationLine(c.station, c.source.owner, place) +
        `<p class="meta">${stale ? 'No readings have reached us since' : 'Readings to'} <b>${esc(istFmt(c.observed_at))}</b>${stale ? '.' : ''}</p>`;
    }
    default:
      return noFigure(title, 'Not loaded', FAILED);
  }
}

/** A state this build does not know is painted as a failure, never as "undefined". */
const knownState = (c: Current): boolean => AIR_STATES.includes(c.state);

/** The right-panel block. `now` re-judges a cached live payload (see `demote`). */
export function cardHtml(p: AirQualityPayload, placeName: string, now: Date = new Date()): string {
  if (!knownState(p.current)) return unavailableHtml(placeName);
  return block(demote(p.current, now), `Air quality · ${esc(placeName)}`, placeName);
}

/** What the card shows when the request itself failed (network, 5xx, not JSON, or a malformed body). No number, no blame. */
export function unavailableHtml(placeName: string): string {
  return noFigure(`Air quality · ${esc(placeName)}`, 'Not loaded', FAILED);
}
/** The pane's failure view: the same words under the pane's own heading. */
const failedPaneHtml = (place: string): string => paneHead(place) + `<div class="aqblock">${noFigure('', 'Not loaded', FAILED)}</div>`;

function polTable(c: Current): string {
  if (c.state === 'insufficient_data') {
    if (c.origin === 'cpcb') return ''; // Task 7 paints origin cpcb
    return `<p class="pane-h">Pollutants · 24-hour window</p><table class="pol"><thead><tr><th>Pollutant</th><th>Hours of 16</th></tr></thead><tbody>` +
      c.pollutants.filter((q) => q.hours_present < MIN_HOURS).map((q) => `<tr><td>${pol(q.parameter)}</td><td class="n">${num(q.hours_present)} of 16</td></tr>`).join('') + '</tbody></table>';
  }
  if (c.state !== 'live' && c.state !== 'stale') return '';
  if (c.result.origin === 'cpcb') return ''; // Task 7 paints origin cpcb
  const rows = c.result.pollutants.map((q: PollutantReading) => {
    const si = typeof q.sub_index === 'number' && Number.isFinite(q.sub_index) && q.sub_index >= 0 ? q.sub_index : null;
    const w = si === null ? 0 : Math.min(100, si / 2);
    const bar = si === null ? 'transparent' : col(category(si));
    return `<tr><td>${pol(q.parameter)}${q.window_h === 8 ? '<br><span style="color:var(--faint);font-size:.5rem">8-h</span>' : ''}</td>
      <td><span class="lv">${num(q.value)}</span><br><span class="unit">${unit(q.unit)}</span></td>
      <td><span class="si"><i style="width:${w}%;background:${bar}"></i>${num(q.sub_index)}</span></td>
      <td class="n">${num(q.hours_present)}</td></tr>`;
  }).join('');
  /* O₃ and CO rows are marked 8-h: their level is the maximum 8-hour mean, so the header must not call the table a 24-hour window. */
  return `<p class="pane-h">Pollutants · 24-h mean · 8-h max</p><table class="pol"><thead><tr><th>Pollutant</th><th>Level</th><th>Sub-index</th><th>Hours</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const aqiOf = (d: HistoryDay): number | null => (typeof d.aqi === 'number' && Number.isFinite(d.aqi) && d.aqi >= 0 && has(WORD, d.category) ? d.aqi : null);

/** One day as plain text: the hit-rect's aria-label and the hidden list's item. Escape before putting it in markup. */
export function dayLabel(d: HistoryDay): string {
  const a = aqiOf(d);
  if (a !== null) return `${d.date_ist}: AQI ${a}, ${word(d.category)}`;
  const why = (d.reason ?? '').split(';')[0]!.trim();
  return `${d.date_ist}: No official AQI${why ? `, ${why}` : ''}`;
}

function barChart(days: HistoryDay[]): string {
  const W = 272, H = 120, top = 8, left = 22, bw = (W - left) / days.length, max = Math.max(100, ...days.map((d) => aqiOf(d) ?? 0));
  const y = (a: number): number => top + (H - top) * (1 - a / max);
  /* 200, 300 and 400 only once the month reaches them, so a Kolkata winter reads against its own scale. */
  let g = [50, 100, 200, 300, 400].filter((t) => t <= max).map((t) => `<line x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="0" y="${y(t) + 3}" fill="var(--faint)" font-size="7" font-family="var(--mono)">${t}</text>`).join('');
  g += `<line x1="${left}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line-hi)"/>`;
  days.forEach((d, i) => {
    const x = left + i * bw + 1, w = bw - 2, a = aqiOf(d);
    if (a === null) g += `<rect x="${x}" y="${H - 10}" width="${w}" height="10" rx="2" fill="url(#aqHatch)" stroke="var(--faint)" stroke-width=".6"/>`;
    else g += `<path d="M${x},${H} V${y(a) + 2} q0,-2 2,-2 h${w - 4} q2,0 2,2 V${H} Z" fill="${col(d.category)}"/>`;
    /* The hit-rect is the bar for pointer AND keyboard: focusable, and labelled with the tooltip's words. */
    g += `<rect class="hit" data-i="${i}" tabindex="0" role="img" aria-label="${esc(dayLabel(d))}" x="${left + i * bw}" y="${top}" width="${bw}" height="${H - top}" fill="transparent"/>`;
  });
  for (const i of [0, 7, 14, 21, days.length - 1]) {
    const d = days[i];
    if (d) g += `<text x="${left + i * bw + bw / 2}" y="${H + 11}" text-anchor="middle" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(d.date_ist.slice(8))}/${esc(d.date_ist.slice(5, 7))}</text>`;
  }
  /* A group, not role="img": an img's children are presentational, and each bar must reach a screen reader on its own. */
  return `<div class="chart aq-bars"><svg viewBox="0 0 ${W} ${H + 16}" role="group" aria-label="Daily AQI for the last 30 days" aria-describedby="aqDays">
    <defs><pattern id="aqHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--faint)" stroke-width="1.2"/></pattern></defs>${g}</svg><div class="tip" aria-hidden="true"></div></div>
    <ul class="aq-sr" id="aqDays">${days.map((d) => `<li>${esc(dayLabel(d))}</li>`).join('')}</ul>`;
}

/** `h` holds at least one non-null value (the caller checks). */
function line24(h: HistoryResponse['pm25_24h'], label: string): string {
  const W = 272, H = 70, top = 6, left = 22, vals = h.map((p) => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const max = Math.max(60, ...vals) * 1.1, x = (i: number): number => left + (W - left) * i / (h.length - 1), y = (v: number): number => top + (H - top) * (1 - v / max);
  let d = '', pen = false;
  h.forEach((p, i) => { if (typeof p.value !== 'number' || !Number.isFinite(p.value)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.value).toFixed(1); pen = true; });
  let last = h.length - 1;
  while (last > 0 && !(typeof h[last]!.value === 'number' && Number.isFinite(h[last]!.value))) last--;
  const lv = num(h[last]!.value);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="PM2.5, ${label}">
    <line x1="${left}" x2="${W}" y1="${y(60)}" y2="${y(60)}" stroke="var(--c-moderate)" stroke-dasharray="3 3" stroke-width="1" opacity=".7"/>
    <text x="${W}" y="${y(60) - 3}" text-anchor="end" fill="var(--faint)" font-size="7" font-family="var(--mono)">60 · 24-h national limit</text>
    <text x="0" y="${y(0)}" fill="var(--faint)" font-size="7" font-family="var(--mono)">0</text>
    <line x1="${left}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line-hi)"/>
    <path d="${d}" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(h[last]!.value ?? 0)}" r="4" fill="var(--cyan)" stroke="var(--rail-ground)" stroke-width="2"/>
    <text x="${x(last) - 6}" y="${y(h[last]!.value ?? 0) - 8}" text-anchor="end" fill="var(--paper)" font-size="8" font-family="var(--mono)">${lv}<tspan font-family="var(--sans)" fill="var(--faint)"> µg/m³</tspan></text>
    <text x="${left}" y="${H + 11}" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(h[0]!.hour_ist.slice(11, 16))}</text>
    <text x="${W}" y="${H + 11}" text-anchor="end" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(h[h.length - 1]!.hour_ist.slice(11, 16))} IST</text></svg></div>`;
}

const HATCH_KEY = '<svg width="10" height="10" aria-hidden="true"><defs><pattern id="aqHatchKey" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="var(--faint)" stroke-width="1.2"/></pattern></defs><rect width="10" height="10" rx="2" fill="url(#aqHatchKey)" stroke="var(--faint)" stroke-width=".6"/></svg>';

function method(owner: string | null): string {
  /* OBOS computes the AQI; CPCB publishes its own figure, which can differ slightly. */
  const who = owner ? `AQI calculated by OBOS with CPCB's National AQI method from the station's readings (received via CPCB and OpenAQ); it can differ slightly from CPCB's own published figure. Measured by the ${esc(owner)}. ` : '';
  return `<p class="pane-note">${who}A monitor counts for a place when it stands inside the 3 km window around the OBOS centre. Air quality is a separate layer: it does not enter the heat model.</p>`;
}

/** The Air pane: the card's state again, then pollutants, 30 days, the 24 h PM2.5 line and the method note. */
export function paneHtml(p: AirQualityPayload, placeName: string, now: Date = new Date()): string {
  if (!knownState(p.current)) return failedPaneHtml(placeName);
  const c = demote(p.current, now);
  let s = `<p class="pane-h" id="pane-air-h">Air · ${esc(placeName)}</p><div class="aqblock">${block(c, '', placeName)}</div>`;
  if (c.state === 'no_station') return s + method(null);
  s += polTable(c);
  const h = p.history;
  if (h && h.days.length) {
    s += `<p class="pane-h">Last 30 days · daily AQI</p>` + barChart(h.days) +
      `<div class="aq-legend">${(['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'] as const).map((k) => `<span><span class="dot" style="background:${col(k)}"></span>${WORD[k]}</span>`).join('')}<span>${HATCH_KEY}No AQI: too few hours</span></div>`;
  }
  if (h && c.state !== 'unavailable' && h.pm25_24h.length > 1 && h.pm25_24h.some((q) => q.value !== null)) {
    /* The line is the station's last 24 REPORTED hours, anchored to its last reading; stale, that is not "the last 24 hours". */
    const label = c.state === 'stale' ? '24 hours to the last reading' : 'last 24 hours';
    s += `<p class="pane-h">PM2.5 · ${label}</p>` + line24(h.pm25_24h, label);
  }
  return s + method(c.source.owner);
}

/** One bar's tooltip. Exported so the escaping is testable without a DOM. */
export function barTipHtml(d: HistoryDay): string {
  const a = aqiOf(d);
  return a === null
    ? `${esc(d.date_ist)}<br>No official AQI<br><span style="color:var(--faint)">${esc((d.reason ?? '').split(';')[0])}</span>`
    : `${esc(d.date_ist)}<br><b style="font-weight:400;color:${col(d.category)}">${num(a)}</b> · ${word(d.category)}<br><span style="color:var(--faint)">led by ${pol(d.dominant)}</span>`;
}

/* ── the pane's two holding states, and the request itself ─────────────────── */

const paneHead = (place: string): string => `<p class="pane-h" id="pane-air-h">Air · ${esc(place)}</p>`;

/** While the request is in flight. The card stays hidden meanwhile: it appears once, with an answer. */
export function loadingPaneHtml(place: string): string {
  return paneHead(place) + '<p class="pane-note">Loading air quality…</p>';
}

/** A city the first release does not cover. Painted by script too, since the console switches areas in place. */
export function uncoveredPaneHtml(place: string): string {
  return paneHead(place) + '<p class="pane-note">Air quality covers Kolkata first; this city is not yet covered.</p>';
}

/**
 * The one-line state for the pane's polite live region (plain text: set it with
 * `textContent`). The pane itself is not live, so a repaint is never read out whole.
 */
export function statusText(p: AirQualityPayload, place: string, now: Date = new Date()): string {
  const c = demote(p.current, now), at = `Air quality, ${place}: `;
  switch (c.state) {
    case 'live': return `${at}${num(c.result.aqi)} ${word(c.result.category)}, live`;
    case 'stale': return `${at}${num(c.result.aqi)} ${word(c.result.category)}, not live, ${num(c.age_h)} hours old`;
    case 'unavailable': return at + (c.reason === 'feed_quiet' ? 'no readings for more than 7 days.' : c.reason === 'no_valid_aqi' ? 'too few recent readings for an official AQI.' : 'could not be loaded just now.');
    case 'insufficient_data': return `${at}no official AQI, too few hours of readings.`;
    case 'no_station': return `${at}no government monitor within 3 km.`;
    default: return `${at}could not be loaded just now.`;
  }
}

/** What `loadAir` hands the app: the card (null = keep it hidden), the whole pane, the bars' days for `wireBarTips`, and the live-region line. */
export interface AirPaint { block: string | null; pane: string; days: readonly HistoryDay[]; status: string }

export interface AirIo {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'json'>>;
  signal: AbortSignal;
  /** Asked AFTER the await: false once the reader has moved to another area. */
  isCurrent: () => boolean;
  now?: Date;
}

/**
 * FETCH AND CHOOSE, with no DOM: what the reader should see after asking
 * `/api/air-quality` about `area`. Null means PAINT NOTHING: the request was
 * aborted, or its answer (success or failure alike) is for an area the reader has
 * already left. Every failure (network, non-OK status, non-JSON, a body with no
 * malformed body that fails `isAirPayload`) is the designed failure view in both places, never a silent hide.
 */
export async function loadAir(area: string, place: string, io: AirIo): Promise<AirPaint | null> {
  let body: unknown = null, ok = false;
  try {
    const r = await io.fetch(`/api/air-quality?area=${encodeURIComponent(area)}`, { signal: io.signal });
    /* A non-OK body is not trusted even when it parses. */
    if (r.ok) { body = await r.json(); ok = true; }
  } catch { ok = false; }
  if (io.signal.aborted || !io.isCurrent()) return null;
  if (!ok || !isAirPayload(body)) {
    return { block: unavailableHtml(place), pane: failedPaneHtml(place), days: [], status: `Air quality, ${place}: could not be loaded just now.` };
  }
  const now = io.now ?? new Date();
  return { block: cardHtml(body, place, now), pane: paneHtml(body, place, now), days: body.history?.days ?? [], status: statusText(body, place, now) };
}

/** The only DOM-touching export: tooltips on the 30-day chart painted by `paneHtml` into `root`, by pointer and by keyboard focus. */
export function wireBarTips(root: HTMLElement, days: readonly HistoryDay[]): void {
  const bars = root.querySelector<HTMLElement>('.aq-bars');
  const tip = bars?.querySelector<HTMLElement>('.tip');
  if (!bars || !tip) return;
  bars.querySelectorAll<SVGElement>('[data-i]').forEach((el) => {
    const show = (): void => {
      const d = days[Number(el.dataset['i'])];
      if (!d) return;
      const r = bars.getBoundingClientRect(), b = el.getBoundingClientRect();
      tip.innerHTML = barTipHtml(d);
      /* Clamped inside the chart: the pane clips, and the preview's first bars cut their tooltip in half. */
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(Math.max(b.left - r.left + b.width / 2, half), r.width - half)}px`;
      tip.style.top = `${b.top - r.top}px`;
      tip.classList.add('on');
    };
    const hide = (): void => tip.classList.remove('on');
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
  });
}
