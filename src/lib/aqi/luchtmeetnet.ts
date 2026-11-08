/**
 * AMSTERDAM'S AIR, FROM LUCHTMEETNET: the LKI as published, and the four substances behind it.
 *
 * NOTHING IS COMPUTED OR ALTERED. CC BY-ND 4.0 governs the data ("Op de data beschikbaar gesteld via
 * www.luchtmeetnet.nl is de licentie … (CC BY-ND 4.0) van toepassing", luchtmeetnet.nl, "Open data", read
 * 2026-11-06), so OBOS prints the station's LKI and its hourly concentrations exactly as the API returns them:
 * no rounding, no averaging, no unit change, and no "US AQI" line derived from the PM2.5 (that would be an
 * adaptation of the data).
 *
 * THE FEED (no key; the "Open data" page sets a fair-use limit of 100 requests per 5 minutes, which one
 * cold answer costs 2 to 6 of):
 *   LKI           GET /open_api/lki?station_number=…&order_by=timestamp_measured&order_direction=desc&start=…&end=…
 *   substances    GET /open_api/measurements?station_number=…&order_by=…&order_direction=desc&start=…&end=…
 * with an explicit start/end window: without one the API answers 302 to a different host (iq.luchtmeetnet.nl).
 *
 * THE HOUR. `timestamp_measured` is the END of the hour averaged (`timestamp_measured_start`/`_end` say so in the
 * same row). Measured 2026-11-06: at 13:36Z the newest row was 13:00Z, covering 12:00 to 13:00Z. A substance
 * is shown only when its row is for the SAME hour as the LKI it sits beside; an hour is never mixed with another.
 *
 * NO STALE FIGURE. A rung whose newest LKI is older than LIVE_MS is not reporting, and the next rung is tried;
 * a source that cannot be read is "not reporting". The newest LKI is the only one ever shown.
 *
 * THE MODELLED LKI (an optional second line; nothing above changes because of it). `GET /open_api/concentrations?formula=lki&latitude=…&longitude=…`
 * is the endpoint behind luchtmeetnet.nl's "Mijn locatie" (the site calls it as `/ascii/concentrations`). WHAT IT IS: a FORECAST PRODUCT, not a
 * measurement and not an interpolation of stations. The API documentation (api-docs.luchtmeetnet.nl, "Concentrations (ASCII)", read 2026-11-09) calls
 * it "the current and predicted concentrations of a component at a certain location"; the site's pages (informatie/verwachting/mijn-locatie,
 * as read by the independent check of 2026-11-08, /Volumes/OBOSLab/research/ams-area-air/MODEL-ENDPOINT-CHECK.md) say RIVM calculates it at 125 m
 * with the OPS model plus TREDM for roads, on KNMI weather, about four runs a day. So the card calls it a model estimate by RIVM, published by
 * Luchtmeetnet. Its O3 was 0.0 against a measured 15.9 at the same place: it is not anchored to the stations.
 *
 * THE ROWS are a fixed run window, NOT a window that rolls with the clock: `start`/`end` are ignored, the first row can already be in the PAST
 * (a run stayed byte-identical from 21:34Z to 22:37Z with its first row at 21:00Z), rows run on ~19-21 hours, values come in 3-hour blocks, and
 * one answer in eight (22:19Z) was cut to 13 rows with no row for the current hour. So the row is CHOSEN BY THE CLOCK, never taken from the
 * top, and an answer with no row for the current hour gives NO line (tests pin all eight recorded answers).
 *
 *   WHICH ROW IS "NOW": luchtmeetnet.nl's own "Mijn locatie" script (chunk mijn-locatie-110b313d0e348113cdf2.js, read 2026-11-09) picks the
 *   headline row with `e.find(e => dayjs(e.timestamp_measured).isSame(dayjs(), "hour"))` and shows `Math.ceil(n.value)`: the row whose stamp
 *   falls in the current clock hour is "now". We do the same: the stamp is read as the START of the hour it is for, so a row is CURRENT for
 *   [stamp, stamp + 1 h). A row stamped later than `now` is a FORECAST HOUR and is never shown as current. The FUTURE_SLACK_MS above exists
 *   for END-stamped rows (an hour that has just closed); it is deliberately NOT applied here, because the same slack would put an hour that has
 *   not begun on the card. The live window is the hour itself, not LIVE_MS.
 *   WHAT IS NOT SETTLED: Luchtmeetnet does not say, for this endpoint, whether a stamp is the start or the end of its hour, and the /measurements
 *   convention (END of the hour) does not carry over by documentation. A comparison with the stations' measured hours cannot settle it (18
 *   pairs over two hours, 2026-11-08T20-22Z: the stamp read as START was closer in 10, as END in 8, MAE 9.42 vs 9.39 µg/m3, because the model
 *   is not anchored to the stations; docs/evidence/2026-11-09-ams-area-air.md). The 3-hour blocks (21,22,23 | 00,01,02 …) fit a forward hold
 *   from the stamp but prove nothing. We follow the operator's own page, and the card says the hour it prints; whichever way the stamp reads, no
 *   row is shown before its stamp and none later than one hour after it.
 *
 *   THE ROUNDING is Luchtmeetnet's, not ours (lki.ts `lkiClass`): decimal LKI values are rounded UP ("Decimale LKI-waarden worden naar
 *   bovenafgerond", the LKI page; the site's script does `Math.ceil`): 3.46 is 4. The card prints that whole number and its class; the decimal
 *   rides in the payload as published. The 'no rounding' rule at the top is about the measured values (CC BY-ND 4.0); this is the operator's
 *   own published rounding of a field the operator publishes as a decimal, applied as the operator applies it. The licence is the same as the
 *   station data's (the Open data page covers the API's calculated lat/lon values), so the same credit is used.
 */
import { zoneClock } from './clock.ts';
import { getText, type Fetch } from './http.ts';
import { LKI_MODEL_HOUR_MS, lkiBand, lkiClass } from './lki.ts';
import type { LocalAirPayload, LocalCredit, LocalStation, NlComponent, NlModel, NlReading, NotReportingReason } from './local-types.ts';
import { LOCAL_SCHEMA } from './local-types.ts';
import { LOCAL_LIVE_MS } from './local-areas.ts';
import { CANAL_RING, nlLadder } from './nl-stations.ts';

export const LM_BASE = 'https://api.luchtmeetnet.nl/open_api';
/** Rows are hourly and appear about 35 minutes after the hour closes; two hours leaves room for one missed publication. */
export const LIVE_MS = LOCAL_LIVE_MS['nl-lki'];
const WINDOW_MS = 6 * 3_600_000;
const FUTURE_SLACK_MS = 15 * 60_000;
const AMS = zoneClock('Europe/Amsterdam');

/** The credit Luchtmeetnet's terms ask for: "bronvermelding (www.luchtmeetnet.nl) is verplicht". */
export const LUCHTMEETNET_CREDIT: LocalCredit = {
  line: 'Source: www.luchtmeetnet.nl',
  edit: null,
  licence: 'CC BY-ND 4.0 International (Naamsvermelding-GeenAfgeleideWerken), as stated for data provided through www.luchtmeetnet.nl',
  licence_url: 'https://creativecommons.org/licenses/by-nd/4.0/',
  licence_link_text: 'CC BY-ND 4.0',
  terms_url: 'https://www.luchtmeetnet.nl/informatie/download-data/open-data',
  note: 'Unvalidated hourly values from the Dutch air quality monitoring networks, shown as published; they are indicative and may be corrected. Luchtmeetnet does not endorse this page.',
};

const COMPONENTS: readonly NlComponent[] = ['PM25', 'PM10', 'NO2', 'O3'];
const COMPONENT_SET: ReadonlySet<string> = new Set(COMPONENTS);
const isComponent = (f: unknown): f is NlComponent => typeof f === 'string' && COMPONENT_SET.has(f);

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

export function lkiUrl(station: string, now: Date): string {
  const end = Math.floor(now.getTime() / 1000) * 1000;
  return `${LM_BASE}/lki?station_number=${station}&order_by=timestamp_measured&order_direction=desc&start=${iso(end - WINDOW_MS)}&end=${iso(end)}`;
}
export function measurementsUrl(station: string, now: Date): string {
  const end = Math.floor(now.getTime() / 1000) * 1000;
  return `${LM_BASE}/measurements?station_number=${station}&order_by=timestamp_measured&order_direction=desc&start=${iso(end - WINDOW_MS)}&end=${iso(end)}`;
}

export class LuchtmeetnetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LuchtmeetnetFormatError';
  }
}

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** An ISO instant with an explicit offset, in ms; null for anything else (never guess a zone). */
function stampMs(v: unknown): number | null {
  if (typeof v !== 'string' || !STAMP_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function dataArray(text: string): Record<string, unknown>[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new LuchtmeetnetFormatError('body is not JSON'); }
  const data = typeof j === 'object' && j !== null ? (j as Record<string, unknown>)['data'] : undefined;
  if (!Array.isArray(data)) throw new LuchtmeetnetFormatError('no data array');
  return data.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
}

export interface LkiRow { value: number; endMs: number }

/** The rows of an `/lki` answer that are this station's, LKI, a whole number 1-11, and not stamped in the future. Newest first. */
export function parseLki(text: string, station: string, now: Date): LkiRow[] {
  const horizon = now.getTime() + FUTURE_SLACK_MS;
  return dataArray(text)
    .filter((r) => r['station_number'] === station && r['formula'] === 'LKI' && lkiBand(r['value']) !== null)
    .map((r) => ({ value: r['value'] as number, endMs: stampMs(r['timestamp_measured']) }))
    .filter((r): r is LkiRow => r.endMs !== null && r.endMs <= horizon)
    .sort((a, b) => b.endMs - a.endMs);
}

export interface MeasurementRow { formula: NlComponent; value: number; endMs: number }

/**
 * The rows of a `/measurements` answer for the four substances: this station's, a finite number, stamped with an
 * offset, and (where the row says so) with `timestamp_measured_end` equal to `timestamp_measured`, which is the
 * convention this module reads. A row that contradicts it is dropped, not reinterpreted. Negative values are legal
 * in the unvalidated feed ("Negatieve waarden") and are kept.
 */
export function parseMeasurements(text: string, station: string, now: Date): MeasurementRow[] {
  const horizon = now.getTime() + FUTURE_SLACK_MS;
  const out: MeasurementRow[] = [];
  for (const r of dataArray(text)) {
    const f = r['formula'];
    const v = r['value'];
    if (r['station_number'] !== station || !isComponent(f) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const end = stampMs(r['timestamp_measured']);
    if (end === null || end > horizon) continue;
    if (r['timestamp_measured_end'] !== undefined && stampMs(r['timestamp_measured_end']) !== end) continue;
    out.push({ formula: f, value: v, endMs: end });
  }
  return out;
}

const MODEL_HOUR_MS = LKI_MODEL_HOUR_MS;
/** How long a finished measured card waits for a model request still in flight, ms; past it the card goes out without the line. */
export const MODEL_WAIT_MS = 3_000;

/** The URL of the modelled LKI at a point. Coordinates to 6 decimals (about 0.1 m; the model is a km-scale field). */
export function modelUrl(at: { lat: number; lon: number }): string {
  return `${LM_BASE}/concentrations?formula=lki&latitude=${at.lat.toFixed(6)}&longitude=${at.lon.toFixed(6)}`;
}

export interface ModelRow { value: number; hourMs: number }

/**
 * The model row that is CURRENT at `now`, or null: the newest row whose hour has begun (stamp <= now, no slack: see the header) and not
 * ended (now < stamp + 1 h), formula LKI, a value that has a class (above 0, up to 11), stamped on the hour with an explicit offset.
 * Rows from the future (forecast hours) and rows from hours already over are ignored. Throws LuchtmeetnetFormatError on a body that is not
 * the `{data: […]}` shape, like its siblings.
 */
export function parseModel(text: string, now: Date): ModelRow | null {
  let best: ModelRow | null = null;
  for (const r of dataArray(text)) {
    const ms = stampMs(r['timestamp_measured']);
    const v = r['value'];
    if (r['formula'] !== 'LKI' || ms === null || ms % MODEL_HOUR_MS !== 0 || lkiClass(v) === null) continue;
    if (ms > now.getTime() || now.getTime() - ms >= MODEL_HOUR_MS) continue;
    if (best === null || ms > best.hourMs) best = { value: v as number, hourMs: ms };
  }
  return best;
}

/** The `model` block for a row, or null; the class and band are derived here by the operator's rule (lki.ts). */
function modelBlock(row: ModelRow | null): NlModel | null {
  if (row === null) return null;
  const lki = lkiClass(row.value);
  const band = lkiBand(lki);
  return lki === null || band === null ? null : { value: row.value, lki, band, hour_start: new Date(row.hourMs).toISOString() };
}

/** Read the modelled LKI at `at` for the current hour. Never rejects: any failure is null (the line is simply absent). */
async function readModel(at: { lat: number; lon: number }, d: AmsterdamDeps): Promise<NlModel | null> {
  try {
    return modelBlock(parseModel(await getText(modelUrl(at), d.fetch, d.signal), d.now));
  } catch {
    return null;
  }
}

/** A promise that gives up after `ms` with null, so a hung optional request cannot hold the measured card. */
function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export interface AmsterdamDeps { fetch: Fetch; now: Date; signal?: AbortSignal; from?: { lat: number; lon: number } }

function notReporting(area: string, now: Date, reason: NotReportingReason, station: LocalStation | null, last: number | null): LocalAirPayload {
  return { schema: LOCAL_SCHEMA, area_id: area, served_at: now.toISOString(), credit: LUCHTMEETNET_CREDIT, standard: 'nl-lki',
    state: 'not_reporting', reason, station, last_observed_at: last === null ? null : new Date(last).toISOString() };
}

/** The substances at exactly the LKI's hour, in the card's order. */
export function readingsAt(rows: readonly MeasurementRow[], hourEndMs: number): NlReading[] {
  return COMPONENTS.flatMap((c) => {
    const r = rows.find((m) => m.formula === c && m.endMs === hourEndMs);
    return r ? [{ formula: c, value: r.value, observed_at: new Date(r.endMs).toISOString() }] : [];
  });
}

/** Read Amsterdam's current LKI for `area`. Never throws: an unreadable source is the "not reporting" payload. */
export async function readAmsterdam(area: string, d: AmsterdamDeps): Promise<LocalAirPayload> {
  const centre = d.from ?? CANAL_RING;
  const ladder = nlLadder(centre);
  const nearest = ladder[0]?.station ?? null;
  if (!nearest) return notReporting(area, d.now, 'no_station', null, null);
  /* The model is asked at once, beside the ladder, and only waited for when a measured figure is ready to carry it. It never reaches a not-reporting answer. */
  const modelP = readModel(centre, d);
  let answered = false;
  let newestSeen: number | null = null;
  for (let i = 0; i < ladder.length; i++) {
    const { ref, station } = ladder[i]!;
    let lki: LkiRow[];
    try {
      lki = parseLki(await getText(lkiUrl(ref.id, d.now), d.fetch, d.signal), ref.id, d.now);
    } catch {
      continue; // this rung could not be read; the next one may
    }
    answered = true;
    const top = lki[0];
    if (!top) continue;
    newestSeen = newestSeen === null ? top.endMs : Math.max(newestSeen, top.endMs);
    if (d.now.getTime() - top.endMs > LIVE_MS) continue;
    let readings: NlReading[] = [];
    try {
      readings = readingsAt(parseMeasurements(await getText(measurementsUrl(ref.id, d.now), d.fetch, d.signal), ref.id, d.now), top.endMs);
    } catch { /* the LKI stands without the substances beside it */ }
    const band = lkiBand(top.value);
    if (band === null) continue; // unreachable: parseLki kept only classed values
    const model = await within(modelP, MODEL_WAIT_MS);
    return { schema: LOCAL_SCHEMA, area_id: area, served_at: d.now.toISOString(), credit: LUCHTMEETNET_CREDIT, standard: 'nl-lki', state: 'live',
      station: i === 0 ? station : { ...station, fallback: true }, observed_at: new Date(top.endMs).toISOString(), observed_at_local: AMS.isoAt(top.endMs),
      lki: { value: top.value, band }, readings, ...(model ? { model } : {}) };
  }
  return notReporting(area, d.now, answered ? 'no_current_hour' : 'source_down', nearest, newestSeen);
}
