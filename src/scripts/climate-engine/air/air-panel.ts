/**
 * THE AIR PAINTERS: the right-panel card and the Air pane, as pure HTML per state.
 *
 * A port of the founder-approved preview (previews/aqi-kolkata/template.html, mono
 * version, 2026-09-26; spec 2026-09-26-aqi-kolkata-design.md §5). Every string,
 * class and colour is the preview's, with three deliberate differences:
 *  - the fixture lookups are the payload's fields, and the preview-only warning box is gone;
 *  - the chart legend is `.aq-legend`, not `.legend`: `.legend` is the stage's heat
 *    key and its rules (a floating panel, hidden at narrow widths) would land on it;
 *  - element ids are `aq`-prefixed, because the stage is one document.
 *
 * Pure except `wireBarTips`. Every string that came over the network goes through
 * `esc()`. Missing is a dash, never 0.
 */
import { category } from '../../../lib/aqi/cpcb.ts';
import { LIVE_H } from '../../../lib/aqi/build.ts';
import type { AirQualityPayload, AqiResult, AqiStation, CpcbCategory, HistoryDay, HistoryResponse, Pollutant, PollutantReading } from '../../../lib/aqi/types.ts';

type Current = AirQualityPayload['current'];

const HOUR_MS = 3_600_000;
const MIN_HOURS = 16;
const WORD: Readonly<Record<CpcbCategory, string>> = { good: 'Good', satisfactory: 'Satisfactory', moderate: 'Moderate', poor: 'Poor', very_poor: 'Very poor', severe: 'Severe' };
const POL: Readonly<Record<Pollutant, string>> = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', co: 'CO', o3: 'O₃', nh3: 'NH₃' };
const UNIT = { ug_m3: 'µg/m³', mg_m3: 'mg/m³' } as const;
/** Owners the card abbreviates, as the preview did; any other owner prints in full. */
const OWNER_SHORT: Readonly<Record<string, string>> = { 'West Bengal Pollution Control Board': 'WBPCB' };

export const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const col = (c: CpcbCategory): string => `var(--c-${c})`;
const km = (m: number): string => `${(m / 1000).toFixed(1)} km`;
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

function stationLine(s: AqiStation, owner: string, place: string): string {
  return `<p class="meta"><b>${esc(s.name.replace(' – WBPCB', ''))}</b> · ${esc(OWNER_SHORT[owner] ?? owner)} monitor · ${km(s.distance_m)} from the ${esc(place)} centre</p>`;
}

function hero(r: AqiResult, muted: boolean): string {
  return `<div class="hero"><span class="num${muted ? ' muted' : ''}" style="color:${col(r.category)}">${r.aqi}</span>
    <span class="cat"><span class="dot" style="background:${col(r.category)}"></span>${WORD[r.category]}</span></div>
    <p class="meta">Led by <b>${POL[r.dominant]}</b> · CPCB National AQI · 24-hour window</p>`;
}

const feedDown = (title: string, why: string): string => head(title, '<span class="chip off">Feed down</span>') +
  `<p class="empty">Government air-quality feed unavailable.</p>
     <p class="meta">${why}</p>`;

/** The card's content for one state; `title` is the head's label (empty in the pane, which has its own heading). */
function block(c: Current, title: string, place: string, now: Date): string {
  switch (c.state) {
    case 'no_station':
      return head(title, '<span class="chip off">No station</span>') +
        `<p class="empty">${esc(c.message)}</p>
     <p class="meta">${esc(place)} has no continuous station, so OBOS shows no air-quality figure here rather than borrow one from elsewhere.</p>`;
    case 'unavailable': {
      const last = c.last_observed_at;
      /* build.ts also lands here for a feed 2 h–7 d old whose window holds no valid AQI, so "more than 7 days" is said only when true. */
      const why = last === null ? 'No reading from this station for more than 7 days.'
        : now.getTime() - Date.parse(last) > 7 * 24 * HOUR_MS ? `No reading from this station for more than 7 days. Last reading ${esc(istFmt(last))}.`
          : `Too few recent readings from this station for an official AQI. Last reading ${esc(istFmt(last))}.`;
      return feedDown(title, why) + stationLine(c.station, c.source.owner, place);
    }
    case 'insufficient_data': {
      const short = c.pollutants.filter((q) => q.hours_present < MIN_HOURS);
      const worst = short.find((q) => q.parameter === 'pm25') ?? short[0];
      const sent = worst ? `the station sent <b>${worst.hours_present} of 16</b>${worst.parameter === 'pm25' ? '' : ` for ${POL[worst.parameter]}`}` : esc(c.reasons[0] ?? '');
      return head(title, '<span class="chip old">Too few hours</span>') +
        `<p class="empty">No official AQI for ${esc(istDay(c.observed_at))}.</p>
     <p class="meta">CPCB needs 16 hours of readings in 24 hours; ${sent}.</p>` + stationLine(c.station, c.source.owner, place);
    }
    case 'live':
    case 'stale': {
      const stale = c.state === 'stale';
      const chip = stale ? `<span class="chip old">Not Live<span class="sep">·</span><b>${c.age_h} h</b> Old</span>` : '<span class="chip live">Live</span>';
      return head(title, chip) + hero(c.result, stale) + stationLine(c.station, c.source.owner, place) +
        `<p class="meta">Readings to <b>${esc(istFmt(c.observed_at))}</b>${stale ? '. This station has not reported since.' : ''}</p>`;
    }
  }
}

/** The right-panel block. `now` re-judges a cached live payload (see `demote`). */
export function cardHtml(p: AirQualityPayload, placeName: string, now: Date = new Date()): string {
  return block(demote(p.current, now), `Air quality · ${esc(placeName)}`, placeName, now);
}

const FAILED = 'Air quality could not be loaded: the government feed or our service is not responding.';
/** What the card and the pane show when the request itself failed: network, 5xx or not JSON. No number. */
export function unavailableHtml(placeName: string): string {
  return feedDown(`Air quality · ${esc(placeName)}`, FAILED);
}

function polTable(c: Current): string {
  if (c.state === 'insufficient_data') {
    return `<p class="pane-h">Pollutants · 24-hour window</p><table class="pol"><thead><tr><th>Pollutant</th><th>Hours of 16</th></tr></thead><tbody>` +
      c.pollutants.filter((q) => q.hours_present < MIN_HOURS).map((q) => `<tr><td>${POL[q.parameter]}</td><td class="n">${q.hours_present} of 16</td></tr>`).join('') + '</tbody></table>';
  }
  if (c.state !== 'live' && c.state !== 'stale') return '';
  const rows = c.result.pollutants.map((q: PollutantReading) => {
    const w = q.sub_index === null ? 0 : Math.min(100, q.sub_index / 2);
    const bar = q.sub_index === null ? 'transparent' : col(category(q.sub_index));
    return `<tr><td>${POL[q.parameter]}${q.window_h === 8 ? '<br><span style="color:var(--faint);font-size:.5rem">8-h</span>' : ''}</td>
      <td>${q.value === null ? '—' : q.value}<br><span class="unit">${UNIT[q.unit]}</span></td>
      <td><span class="si"><i style="width:${w}%;background:${bar}"></i>${q.sub_index ?? '—'}</span></td>
      <td class="n">${q.hours_present}</td></tr>`;
  }).join('');
  return `<p class="pane-h">Pollutants · 24-hour window</p><table class="pol"><thead><tr><th>Pollutant</th><th>Level</th><th>Sub-index</th><th>Hours</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function barChart(days: HistoryDay[]): string {
  const W = 272, H = 120, top = 8, left = 22, bw = (W - left) / days.length, max = Math.max(100, ...days.map((d) => d.aqi ?? 0));
  const y = (a: number): number => top + (H - top) * (1 - a / max);
  let g = [50, 100].filter((t) => t <= max).map((t) => `<line x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="0" y="${y(t) + 3}" fill="var(--faint)" font-size="7" font-family="var(--mono)">${t}</text>`).join('');
  g += `<line x1="${left}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line-hi)"/>`;
  days.forEach((d, i) => {
    const x = left + i * bw + 1, w = bw - 2;
    if (d.aqi === null || d.category === null) g += `<rect data-i="${i}" x="${x}" y="${H - 10}" width="${w}" height="10" rx="2" fill="url(#aqHatch)" stroke="var(--faint)" stroke-width=".6"/>`;
    else g += `<path data-i="${i}" d="M${x},${H} V${y(d.aqi) + 2} q0,-2 2,-2 h${w - 4} q2,0 2,2 V${H} Z" fill="${col(d.category)}"/>`;
    g += `<rect data-i="${i}" x="${left + i * bw}" y="${top}" width="${bw}" height="${H - top}" fill="transparent"/>`;
  });
  for (const i of [0, 7, 14, 21, days.length - 1]) {
    const d = days[i];
    if (d) g += `<text x="${left + i * bw + bw / 2}" y="${H + 11}" text-anchor="middle" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(d.date_ist.slice(8))}/${esc(d.date_ist.slice(5, 7))}</text>`;
  }
  return `<div class="chart aq-bars"><svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Daily CPCB AQI for the last 30 days">
    <defs><pattern id="aqHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--faint)" stroke-width="1.2"/></pattern></defs>${g}</svg><div class="tip"></div></div>`;
}

/** `h` holds at least one non-null value (the caller checks). */
function line24(h: HistoryResponse['pm25_24h'], label: string): string {
  const W = 272, H = 70, top = 6, left = 22, vals = h.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(60, ...vals) * 1.1, x = (i: number): number => left + (W - left) * i / (h.length - 1), y = (v: number): number => top + (H - top) * (1 - v / max);
  let d = '', pen = false;
  h.forEach((p, i) => { if (p.value === null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.value).toFixed(1); pen = true; });
  let last = h.length - 1;
  while (h[last]!.value === null) last--;
  const lv = h[last]!.value!;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="PM2.5, ${label}">
    <line x1="${left}" x2="${W}" y1="${y(60)}" y2="${y(60)}" stroke="var(--c-moderate)" stroke-dasharray="3 3" stroke-width="1" opacity=".7"/>
    <text x="${W}" y="${y(60) - 3}" text-anchor="end" fill="var(--faint)" font-size="7" font-family="var(--mono)">60 · 24-h national limit</text>
    <text x="0" y="${y(0)}" fill="var(--faint)" font-size="7" font-family="var(--mono)">0</text>
    <line x1="${left}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line-hi)"/>
    <path d="${d}" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(lv)}" r="4" fill="var(--cyan)" stroke="var(--rail-ground)" stroke-width="2"/>
    <text x="${x(last) - 6}" y="${y(lv) - 8}" text-anchor="end" fill="var(--paper)" font-size="8" font-family="var(--mono)">${lv}<tspan font-family="var(--sans)" fill="var(--faint)"> µg/m³</tspan></text>
    <text x="${left}" y="${H + 11}" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(h[0]!.hour_ist.slice(11, 16))}</text>
    <text x="${W}" y="${H + 11}" text-anchor="end" fill="var(--faint)" font-size="7" font-family="var(--mono)">${esc(h[h.length - 1]!.hour_ist.slice(11, 16))} IST</text></svg></div>`;
}

const HATCH_KEY = '<svg width="10" height="10" aria-hidden="true"><defs><pattern id="aqHatchKey" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="var(--faint)" stroke-width="1.2"/></pattern></defs><rect width="10" height="10" rx="2" fill="url(#aqHatchKey)" stroke="var(--faint)" stroke-width=".6"/></svg>';

function method(owner: string): string {
  return `<p class="pane-note">CPCB National AQI, the highest of the pollutant sub-indices. Measured by the ${esc(owner)}, received via CPCB and OpenAQ. A monitor counts for a place when it stands inside the 3 km window around the OBOS centre. Air quality is a separate layer: it does not enter the heat model.</p>`;
}

/** The Air pane: the card's state again, then pollutants, 30 days, the 24 h PM2.5 line and the method note. */
export function paneHtml(p: AirQualityPayload, placeName: string, now: Date = new Date()): string {
  const c = demote(p.current, now);
  let s = `<p class="pane-h" id="pane-air-h">Air · ${esc(placeName)}</p><div class="aqblock">${block(c, '', placeName, now)}</div>`;
  if (c.state === 'no_station') return s + method(c.source.owner);
  s += polTable(c);
  const h = p.history;
  if (h && h.days.length) {
    s += `<p class="pane-h">Last 30 days · daily AQI</p>` + barChart(h.days) +
      `<div class="aq-legend">${(['good', 'satisfactory', 'moderate', 'poor'] as const).map((k) => `<span><span class="dot" style="background:${col(k)}"></span>${WORD[k]}</span>`).join('')}<span>${HATCH_KEY}No AQI: too few hours</span></div>`;
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
  return d.aqi === null || d.category === null || d.dominant === null
    ? `${esc(d.date_ist)}<br>No official AQI<br><span style="color:var(--faint)">${esc((d.reason ?? '').split(';')[0])}</span>`
    : `${esc(d.date_ist)}<br><b style="font-weight:400;color:${col(d.category)}">${d.aqi}</b> · ${WORD[d.category]}<br><span style="color:var(--faint)">led by ${POL[d.dominant]}</span>`;
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

/** What `loadAir` hands the app: the card (null = keep it hidden), the whole pane, and the bars' days for `wireBarTips`. */
export interface AirPaint { block: string | null; pane: string; days: readonly HistoryDay[] }

export interface AirIo {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'json'>>;
  signal: AbortSignal;
  /** Asked AFTER the await: false once the reader has moved to another area. */
  isCurrent: () => boolean;
  now?: Date;
}

const isPayload = (b: unknown): b is AirQualityPayload => {
  const c = typeof b === 'object' && b !== null ? (b as { current?: unknown }).current : null;
  return typeof c === 'object' && c !== null && typeof (c as { state?: unknown }).state === 'string';
};

/**
 * FETCH AND CHOOSE, with no DOM: what the reader should see after asking
 * `/api/air-quality` about `area`. Null means PAINT NOTHING: the request was
 * aborted, or its answer (success or failure alike) is for an area the reader has
 * already left. Every failure (network, non-OK status, non-JSON, a body with no
 * `current`) is the designed feed-down view in both places, never a silent hide.
 */
export async function loadAir(area: string, place: string, io: AirIo): Promise<AirPaint | null> {
  let body: unknown = null, ok = false;
  try {
    const r = await io.fetch(`/api/air-quality?area=${encodeURIComponent(area)}`, { signal: io.signal });
    /* A non-OK body is not trusted even when it parses. */
    if (r.ok) { body = await r.json(); ok = true; }
  } catch { ok = false; }
  if (io.signal.aborted || !io.isCurrent()) return null;
  if (!ok || !isPayload(body)) {
    return { block: unavailableHtml(place), pane: paneHead(place) + `<div class="aqblock">${feedDown('', FAILED)}</div>`, days: [] };
  }
  const now = io.now ?? new Date();
  return { block: cardHtml(body, place, now), pane: paneHtml(body, place, now), days: body.history?.days ?? [] };
}

/** The only DOM-touching export: hover tooltips on the 30-day chart painted by `paneHtml` into `root`. */
export function wireBarTips(root: HTMLElement, days: readonly HistoryDay[]): void {
  const bars = root.querySelector<HTMLElement>('.aq-bars');
  const tip = bars?.querySelector<HTMLElement>('.tip');
  if (!bars || !tip) return;
  bars.querySelectorAll<SVGElement>('[data-i]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      const d = days[Number(el.dataset['i'])];
      if (!d) return;
      const r = bars.getBoundingClientRect(), b = el.getBoundingClientRect();
      tip.innerHTML = barTipHtml(d);
      /* Clamped inside the chart: the pane clips, and the preview's first bars cut their tooltip in half. */
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(Math.max(b.left - r.left + b.width / 2, half), r.width - half)}px`;
      tip.style.top = `${b.top - r.top}px`;
      tip.classList.add('on');
    });
    el.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}
