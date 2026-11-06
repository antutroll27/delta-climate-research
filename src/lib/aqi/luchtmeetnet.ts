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
 */
import { zoneClock } from './clock.ts';
import { getText, type Fetch } from './http.ts';
import { lkiBand } from './lki.ts';
import type { LocalAirPayload, LocalCredit, LocalStation, NlComponent, NlReading, NotReportingReason } from './local-types.ts';
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
  const ladder = nlLadder(d.from ?? CANAL_RING);
  const nearest = ladder[0]?.station ?? null;
  if (!nearest) return notReporting(area, d.now, 'no_station', null, null);
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
    return { schema: LOCAL_SCHEMA, area_id: area, served_at: d.now.toISOString(), credit: LUCHTMEETNET_CREDIT, standard: 'nl-lki', state: 'live',
      station: i === 0 ? station : { ...station, fallback: true }, observed_at: new Date(top.endMs).toISOString(), observed_at_local: AMS.isoAt(top.endMs),
      lki: { value: top.value, band }, readings };
  }
  return notReporting(area, d.now, answered ? 'no_current_hour' : 'source_down', nearest, newestSeen);
}
