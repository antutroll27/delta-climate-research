/**
 * THE AIR PAINTERS FOR A CITY WHOSE STANDARD IS ITS OWN REGULATOR'S: Amsterdam (the LKI) and Tokyo (Japan's
 * environmental quality standards). Pure HTML per state, like air-panel.ts, and fed by the same `loadAir` door.
 *
 * THE STANDARD FOLLOWS THE REGULATOR. The big number on Amsterdam's card is Luchtmeetnet's own LKI, in
 * Luchtmeetnet's own five classes and colours; Tokyo's card has NO index, because Japan publishes none, and
 * shows each concentration beside the Ministry's standard for it. Neither card prints an Indian category word,
 * an Indian colour or an Indian AQI, and neither says another scale or another app is wrong: the explainers say
 * only that scales differ and that this card shows the regulator's own.
 *
 * NO STALE FIGURE. `judge` re-reads the payload's age on the viewer's clock: a live payload past its window
 * (the CDN may hold one for a few minutes) is painted as "Not reporting", with the TIME of the last hour and no
 * value. A body whose measured part fails `isLocalAirPayload` is the failure view (a malformed OPTIONAL modelled line is dropped instead).
 *
 * Every network string goes through `esc()`, every number through `num()`; an unknown class or pollutant falls back
 * to a dash. Pure; no DOM.
 */
import { JP_BASIS_NOTE, JP_POLLUTANTS, JP_ROADSIDE_NOTE, JP_ROW_NOTE, JP_STANDARDS } from '../../../lib/aqi/jp-standards.ts';
import { LKI_COLOUR, LKI_KEY, LKI_LABEL, LKI_MODEL_CREDIT } from '../../../lib/aqi/lki.ts';
import { localAirArea, LOCAL_LIVE_MS, LOCAL_STANDARD_TZ } from '../../../lib/aqi/local-areas.ts';
import type { JpReading, LkiBand, LocalAirPayload, LocalStation, NlModel, NlReading } from '../../../lib/aqi/local-types.ts';
import { judge } from '../../../lib/aqi/local-judge.ts';
import { readLocalAirPayload } from '../../../lib/aqi/local-valid.ts';
import type { AirIo, AirPaint } from './air-panel.ts';

type NotReporting = Extract<LocalAirPayload, { state: 'not_reporting' }>;
type Live = Exclude<LocalAirPayload, NotReporting>;

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
const km = (m: number): string => (Number.isFinite(m) ? `${(m / 1000).toFixed(1)} km` : '—');
const nowrap = (html: string): string => `<span style="white-space:nowrap">${html}</span>`;
const has = (m: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(m, k);

/** A time on the area's own clock with its zone name: "14:00 CET" (Amsterdam, summer "CEST"), "21:00 JST" (Tokyo). */
export function localTime(iso: string, standard: LocalAirPayload['standard'], withDate = false): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  if (standard === 'jp-eqs') {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_STANDARD_TZ[standard], day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
    return (withDate ? f.replace(',', '') : f.split(', ')[1] ?? f) + ' JST';
  }
  const opts: Intl.DateTimeFormatOptions = { timeZone: LOCAL_STANDARD_TZ[standard], hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' };
  return new Intl.DateTimeFormat('en-GB', withDate ? { ...opts, day: 'numeric', month: 'short' } : opts).format(new Date(ms)).replace(',', '');
}

export { judge };

const head = (title: string, chip: string): string => `<div class="k legend-head"><span>${title}</span>${chip}</div>`;
const SOURCE_NAME = { 'nl-lki': 'Luchtmeetnet', 'jp-eqs': 'the Ministry of the Environment\'s Soramame system' } as const;

/** An external link, only for an https URL; anything else is plain escaped text. */
const link = (url: string, text: string): string =>
  (url.startsWith('https://') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));

function creditHtml(p: LocalAirPayload): string {
  const c = p.credit;
  /* The modelled line is RIVM's model, rounded up: its credit is said whenever the line is on the card. */
  const model = p.state === 'live' && p.standard === 'nl-lki' && p.model ? `<br>${esc(LKI_MODEL_CREDIT)}` : '';
  const edit = (c.edit === null ? '' : `<br>${esc(c.edit)}`) + model;
  /* The licence is indicated with a hyperlink to its text (CC BY-ND 4.0 §3(a)(1)(C)), and the terms page it was read on is shown. */
  const at = c.licence.indexOf(c.licence_link_text);
  const licence = at < 0 || c.licence_link_text === '' ? esc(c.licence)
    : `${esc(c.licence.slice(0, at))}${link(c.licence_url, c.licence_link_text)}${esc(c.licence.slice(at + c.licence_link_text.length))}`;
  return `<p class="meta">${esc(c.line)}${edit}<br><span style="opacity:.85">${esc(c.note)} ${licence}.</span><br><span style="opacity:.85">Terms: ${link(c.terms_url, c.terms_url)}</span></p>`;
}

/** "Amsterdam-Vondelpark · municipal monitor, GGD Amsterdam · 1.4 km from the Canal Ring centre"; a fallback says so. */
function stationLine(s: LocalStation, place: string): string {
  const name = s.name_en ? `<b>${esc(s.name)}</b> (${esc(s.name_en)})` : `<b>${esc(s.name)}</b>`;
  const kind = s.kind ? `${esc(s.kind)} monitor` : 'monitor';
  const which = s.fallback ? 'nearest reporting' : '';
  return `<p class="meta">${name} · ${which ? `${which} ` : ''}${kind}, ${esc(s.owner)} · ${km(s.distance_m)} from the ${esc(place)} centre</p>`;
}

/* ── Amsterdam ───────────────────────────────────────────────────────────────────────────────────── */

const NL_FORMULA: Readonly<Record<string, string>> = { PM25: 'PM2.5', PM10: 'PM10', NO2: 'NO₂', O3: 'O₃' };
const bandColour = (b: unknown): string => (has(LKI_COLOUR, b) ? LKI_COLOUR[b as LkiBand] : 'var(--faint)');
const bandWord = (b: unknown): string => (has(LKI_LABEL, b) ? `${LKI_LABEL[b as LkiBand].nl} <span style="font-weight:400;opacity:.8">· ${LKI_LABEL[b as LkiBand].en}</span>` : '—');

const LKI_NOTE = 'The LKI (luchtkwaliteitsindex) is the Dutch national air-quality index, published by Luchtmeetnet. Each of nitrogen dioxide, '
  + 'PM10, PM2.5 and ozone is turned into a number from 1 (little pollution) to 11 (much); the highest number is the index; if all the substances have the same number, the index is one point higher. It is sorted into five classes. '
  + 'Other indices, such as the US AQI or the European index, use other scales and other substances, so their numbers are not interchangeable with this one. '
  + 'The headline is the Dutch regulator\'s own measured figure, as published, for the nearest monitor that measures all four substances. A separate, labelled modelled line (RIVM\'s model, via Luchtmeetnet) may sit beneath it; it is a forecast calculation, not a measurement.';

function nlSubstances(readings: readonly NlReading[]): string {
  if (readings.length === 0) return '';
  const row = readings.map((r) => `${esc(NL_FORMULA[r.formula] ?? '—')} <b>${num(r.value)}</b>`).join(' · ');
  return `<p class="meta">${row} <span style="opacity:.85">µg/m³, hourly, as published</span></p>`;
}

/**
 * THE MODELLED LINE, set apart from the measurement and worded so it cannot be read as one: "Modelled at the centre of this area (RIVM model via Luchtmeetnet): 4 · Matig · Moderate",
 * then what it is (a forecast calculation by RIVM, published by Luchtmeetnet, for the current hour as Luchtmeetnet's own location page selects it, naming the stamp
 * of the row without calling it the start or the end of the hour) and that the decimal was rounded up as Luchtmeetnet does. The class dot is the LKI's, as on the measured line. No station, no distance: a model has neither.
 */
function nlModelLine(m: NlModel, place: string): string {
  const from = nowrap(`<b>${esc(localTime(m.hour_start, 'nl-lki'))}</b>`);
  return `<p class="meta aq-model">Modelled at the centre of this area (RIVM model via Luchtmeetnet): <b>${num(m.lki)}</b> <span class="cat"><span class="dot" style="background:${bandColour(m.band)}"></span>${bandWord(m.band)}</span></p>`
    + `<p class="meta">A forecast calculation by RIVM for the centre of ${esc(place)}, not a measurement · for the current hour (row stamped ${from}) · rounded up to a whole number, as Luchtmeetnet does</p>`;
}

function nlLive(p: Extract<Live, { standard: 'nl-lki' }>, title: string, place: string): string {
  const time = nowrap(`<b>${esc(localTime(p.observed_at, 'nl-lki'))}</b>`);
  return head(title, '<span class="chip live">Live</span>')
    + `<div class="hero"><span class="num">${num(p.lki.value)}</span><span class="cat"><span class="dot" style="background:${bandColour(p.lki.band)}"></span>${bandWord(p.lki.band)}</span></div>`
    + `<p class="meta">LKI, the Dutch air-quality index · 1 to 11, five classes</p>`
    + nlSubstances(p.readings) + stationLine(p.station, place)
    + `<p class="meta">Hour to ${time} · unvalidated, indicative</p>`
    + (p.model ? nlModelLine(p.model, place) : '')
    + `<details class="aq-why"><summary>What is the LKI?</summary><p>${esc(LKI_NOTE)}</p></details>`
    + creditHtml(p);
}

function lkiKey(): string {
  return `<div class="aq-legend">${LKI_KEY.map((k) => `<span><span class="dot" style="background:${LKI_COLOUR[k.band]}"></span>${k.from === k.to ? k.from : `${k.from}–${k.to}`} ${LKI_LABEL[k.band].nl}</span>`).join('')}</div>`;
}

/* ── Tokyo ───────────────────────────────────────────────────────────────────────────────────────── */

const JP_NAME: Readonly<Record<string, string>> = { pm25: 'PM2.5', no2: 'NO₂', ox: 'Ox (photochemical oxidants)' };
const JP_UNIT: Readonly<Record<string, string>> = { ug_m3: 'µg/m³', ppm: 'ppm' };

function jpRow(r: JpReading, place: string): string {
  if (!has(JP_STANDARDS, r.pollutant)) return '';
  const std = JP_STANDARDS[r.pollutant];
  const s = r.station;
  const name = s.name_en ? `${esc(s.name)} (${esc(s.name_en)})` : esc(s.name);
  const kind = s.kind ? `${esc(s.kind)} · ` : '';
  return `<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><span><b>${esc(JP_NAME[r.pollutant] ?? '—')}</b></span>`
    + `<span><b style="font-size:20px;font-weight:300">${num(r.value)}</b> ${esc(JP_UNIT[r.unit] ?? '')}</span></div>`
    + `<p class="meta">Standard (環境基準): ${esc(std.short_term_en)}</p>`
    + `<p class="meta">${esc(JP_ROW_NOTE)}</p>`
    + (s.kind === 'roadside' ? `<p class="meta">${esc(JP_ROADSIDE_NOTE)}</p>` : '')
    + `<p class="meta">${name} · ${s.fallback ? 'nearest reporting ' : ''}${kind}${km(s.distance_m)} from the ${esc(place)} centre</p></div>`;
}

const JP_NOTE_HEAD = 'Japan publishes concentration standards, not an air-quality index, so this card shows each pollutant beside its standard.';

function jpStandardsDetails(): string {
  const items = JP_POLLUTANTS.map((k) => {
    const s = JP_STANDARDS[k];
    return `<li><b>${esc(s.name_ja)}</b> ${esc(s.text_ja)} ${esc(s.notice)}<br><span style="opacity:.85">${esc(s.gloss_en)}</span></li>`;
  }).join('');
  return `<details class="aq-why"><summary>The standards, as the Ministry states them</summary><p>${esc(JP_BASIS_NOTE)}</p>`
    + `<ul style="margin:6px 0 0;padding-left:16px;font-size:11.5px;line-height:1.5">${items}</ul>`
    + `<p>Source: 環境省「大気汚染に係る環境基準」 https://www.env.go.jp/kijun/taiki.html. The Ministry sets a standard for each pollutant separately; OBOS shows the three it has data for.</p></details>`;
}

function jpLive(p: Extract<Live, { standard: 'jp-eqs' }>, title: string, place: string): string {
  const time = nowrap(`<b>${esc(localTime(p.observed_at, 'jp-eqs'))}</b>`);
  return head(title, '<span class="chip live">Live</span>')
    + `<p class="meta">${esc(JP_NOTE_HEAD)}</p>`
    + p.readings.map((r) => jpRow(r, place)).join('')
    + `<p class="meta" style="margin-top:10px">Hour to ${time} · provisional (速報値), national stations only</p>`
    + jpStandardsDetails() + creditHtml(p);
}

/* ── not reporting ───────────────────────────────────────────────────────────────────────────────── */

function notReportingSay(p: NotReporting): string {
  const src = SOURCE_NAME[p.standard];
  switch (p.reason) {
    case 'source_down': return `No current reading could be loaded from ${src} just now.`;
    case 'no_current_hour': return `${src.charAt(0).toUpperCase()}${src.slice(1)} has no current hour for the nearby monitors.`;
    case 'no_station': return 'No monitor stands near this area.';
    default: return 'No current reading is available.';
  }
}

function notReporting(p: NotReporting, title: string, place: string): string {
  /* Only an hour that is genuinely old "is no longer current". When the newest file could not be read (source_down), the hour is not old: say that. */
  const when = p.last_observed_at === null ? null : nowrap(`<b>${esc(localTime(p.last_observed_at, p.standard, true))}</b>`);
  const last = when === null ? ''
    : p.reason === 'no_current_hour' ? `<p class="meta">Last hour reported: ${when}. It is not shown, because it is no longer current.</p>`
      : p.reason === 'source_down' ? `<p class="meta">The newest hour (${when}) could not be read right now.</p>` : '';
  return head(title, '<span class="chip off">Not reporting</span>')
    + `<p class="empty">${esc(notReportingSay(p))}</p>`
    + last + (p.station ? stationLine(p.station, place) : '') + creditHtml(p);
}

/** The card's content for one judged payload. */
function block(p: LocalAirPayload, title: string, place: string): string {
  if (p.state === 'not_reporting') return notReporting(p, title, place);
  return p.standard === 'nl-lki' ? nlLive(p, title, place) : jpLive(p, title, place);
}

const FAILED = 'Air-quality data could not be loaded just now. Try again shortly.';
const failedBlock = (title: string): string => head(title, '<span class="chip off">Not loaded</span>') + `<p class="empty">${FAILED}</p>`;

/** The right-panel block. */
export function localCardHtml(p: LocalAirPayload, place: string, now: Date = new Date()): string {
  return block(judge(p, now), `Air quality · ${esc(place)}`, place);
}

export function localUnavailableHtml(place: string): string {
  return failedBlock(`Air quality · ${esc(place)}`);
}

const paneHead = (place: string): string => `<p class="pane-h" id="pane-air-h">Air · ${esc(place)}</p>`;
const failedPane = (place: string): string => paneHead(place) + `<div class="aqblock">${failedBlock('')}</div>`;

function nlTable(readings: readonly NlReading[]): string {
  if (readings.length === 0) return '';
  const rows = readings.map((r) => `<tr><td>${esc(NL_FORMULA[r.formula] ?? '—')}</td><td><span class="lv">${num(r.value)}</span> <span class="unit">µg/m³</span></td></tr>`).join('');
  return `<p class="pane-h">Substances behind the index · latest hour</p><table class="pol"><thead><tr><th>Substance</th><th>Hourly value</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The Air pane: the card's state again, then the table and the method note. */
export function localPaneHtml(p: LocalAirPayload, place: string, now: Date = new Date()): string {
  const c = judge(p, now);
  let s = `${paneHead(place)}<div class="aqblock">${block(c, '', place)}</div>`;
  if (c.state === 'live' && c.standard === 'nl-lki') {
    s += nlTable(c.readings) + `<p class="pane-h">The five LKI classes</p>${lkiKey()}`
      + `<p class="pane-note">The LKI is Luchtmeetnet's own published figure for this monitor and hour, shown unaltered. It is the highest of the four substances' index numbers (NO₂, PM10, PM2.5, O₃). When some but not all of the substances tie for the highest, the index is that number. Luchtmeetnet adds one point only when all the substances share the same number. `
      + `Values are unvalidated hourly data and may be corrected later. Air quality is a separate layer: it does not enter the heat model.</p>`
      + (c.model ? `<p class="pane-note">The modelled line is a forecast calculation by RIVM (published by Luchtmeetnet) for the centre of this area, for the current hour, the row Luchtmeetnet's own location page would pick; it is not a measurement and no monitor stands behind it. `
        + `Luchtmeetnet publishes it as a decimal and rounds decimal LKI values up to the whole number, as this card does. It never replaces, and is not mixed into, the measured figure above.</p>` : '');
  } else if (c.state === 'live') {
    s += `<p class="pane-note">Values are the latest provisional hour from the Ministry of the Environment's national stations (国設局) only; other stations belong to local governments and are not shown. `
      + `A standard is judged on its own average, not on one hour. Air quality is a separate layer: it does not enter the heat model.</p>`;
  } else {
    s += `<p class="pane-note">A figure appears here only while the source's newest hour is current. Air quality is a separate layer: it does not enter the heat model.</p>`;
  }
  return s;
}

/** One line for the pane's polite live region (plain text). */
export function localStatusText(p: LocalAirPayload, place: string, now: Date = new Date()): string {
  const c = judge(p, now), at = `Air quality, ${place}: `;
  if (c.state === 'not_reporting') return `${at}not reporting.`;
  if (c.standard === 'nl-lki') return `${at}LKI ${num(c.lki.value)}, ${has(LKI_LABEL, c.lki.band) ? LKI_LABEL[c.lki.band].en : 'unclassed'}, live.`;
  return `${at}${c.readings.length} pollutants from national stations, provisional, live.`;
}

/**
 * FETCH AND CHOOSE for a local-regulator area (the door `loadAir` hands these areas to). Null means paint nothing: the
 * request was aborted or its answer is for an area the reader has already left. Any failure, or a body that fails
 * `isLocalAirPayload` (bar a malformed modelled line, which is dropped), is the designed failure view.
 */
export async function loadLocalAir(area: string, place: string, io: AirIo): Promise<AirPaint | null> {
  let body: unknown = null, ok = false;
  try {
    const r = await io.fetch(`/api/air-quality?area=${encodeURIComponent(area)}`, { signal: io.signal });
    if (r.ok) { body = await r.json(); ok = true; }
  } catch { ok = false; }
  if (io.signal.aborted || !io.isCurrent()) return null;
  /* `readLocalAirPayload` drops a malformed OPTIONAL modelled line and keeps the measured card; any other fault is the failure view. */
  const parsed = ok ? readLocalAirPayload(body) : null;
  if (parsed === null || localAirArea(area) === null || parsed.area_id !== area) {
    return { block: localUnavailableHtml(place), pane: failedPane(place), days: [], status: `Air quality, ${place}: could not be loaded just now.` };
  }
  const now = io.now ?? new Date();
  /* `refresh` re-judges the payload the app KEPT on the viewer's clock, so a tab left open flips to "Not reporting" when the window passes. */
  const paint = (at: Date) => ({ block: localCardHtml(parsed, place, at), pane: localPaneHtml(parsed, place, at), status: localStatusText(parsed, place, at) });
  return { ...paint(now), days: [], refresh: paint };
}
