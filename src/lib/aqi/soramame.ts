/**
 * TOKYO'S AIR, FROM THE MINISTRY OF THE ENVIRONMENT'S SORAMAME (そらまめくん), national stations only.
 *
 * THE FEED. Two static files behind the Soramame map (found in the site's own script, app.*.js; the JSON API
 * is a day behind and slow, so it is not used):
 *   metadata   https://soramame.env.go.jp/data/sokutei/noudoAll/metadata.json   {"latest":"2026/11/06 21:00:00",…}
 *   hourly     https://soramame.env.go.jp/data/sokutei/noudoAll/{YYYY}/{MM}/{DD}/{HH}.csv   one row per station
 * Columns are read by header name, never by position.
 *
 * THE HOUR CONVENTION (measured 2026-11-06, not assumed): file …/{DD}/{HH}.csv is the one-hour mean ENDING at
 * HH:00 Japan time, and `metadata.latest` names the same HH:00. Three independent signals agree:
 *  1. the API manual's own records number hours 01 to 24 (the first record of a day is SKT_TIME "01");
 *  2. file 21.csv appeared at 22:01 JST and 04.csv at 05:01 JST (Last-Modified), i.e. about an hour after the
 *     hour it names has closed, and 22.csv at 22:28 was still the site's 2,593-byte placeholder page;
 *  3. against JMA AMeDAS Tokyo (44132, 10-minute air temperature), the Tokyo-prefecture mean TEMP of the 22
 *     files of 2026-11-06 fitted the AMeDAS mean of the hour ENDING at HH:00 with a spread of 0.46 °C, and the
 *     hour STARTING at HH:00 with 0.77 °C. Hour-ending it is.
 *
 * NO STALE FIGURE. The newest hour is the only one read. If `latest` is older than LIVE_MS, or its file is not
 * a CSV with the expected header (the site answers a missing hour with a 200 HTML placeholder), or no national
 * station on the ladder has a value in it, the answer is "not reporting"; an older hour is never substituted.
 *
 * The values are 速報値 (provisional) and may be revised later (API manual §2-3). Units: PM2.5 µg/m³; NO2 and
 * Ox ppm. A blank or "-" is missing; 0 is a reading. Nothing is rounded, averaged or converted.
 */
import { zoneClock } from './clock.ts';
import { getText, type Fetch } from './http.ts';
import { isNationalStation, jpLadder, jpStation, MARUNOUCHI, type JpStationRef } from './jp-stations.ts';
import { JP_POLLUTANTS } from './jp-standards.ts';
import { LOCAL_LIVE_MS } from './local-areas.ts';
import type { JpPollutant, JpReading, LocalCredit, LocalAirPayload, LocalStation, NotReportingReason } from './local-types.ts';
import { LOCAL_SCHEMA } from './local-types.ts';

export const SORAMAME_BASE = 'https://soramame.env.go.jp/data/sokutei/noudoAll';
export const METADATA_URL = `${SORAMAME_BASE}/metadata.json`;
/**
 * The newest hour is normally 60 to 120 minutes old when read (file HH appears about an hour after HH:00);
 * three hours is the longest a "current" hour may be, so one missed publication does not blank the card and
 * two do.
 */
export const LIVE_MS = LOCAL_LIVE_MS['jp-eqs'];

const JST = zoneClock('Asia/Tokyo');

/** The credit the Ministry's terms ask for (https://www.env.go.jp/mail.html §1.1), and the edit statement they require. */
export const SORAMAME_CREDIT: LocalCredit = {
  line: '出典：環境省大気汚染物質広域監視システム（そらまめくん）（https://soramame.env.go.jp/）（速報値）',
  edit: '「環境省大気汚染物質広域監視システム（そらまめくん）」（環境省）（https://soramame.env.go.jp/）をもとにDelta Climate Research作成（国設局の測定値を選んで表示）',
  licence: '公共データ利用規約（第1.0版）PDL 1.0（CC BY 4.0 互換）。国設局のデータのみ。',
  terms_url: 'https://www.env.go.jp/mail.html',
  note: '速報値であり、確定値ではありません。環境省が作成した情報ではありません。 Provisional values, which may be revised; not a Ministry of the Environment publication.',
};

export class SoramameFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoramameFormatError';
  }
}

/** One station-hour as the CSV carries it, for the columns the card reads. */
export interface SoramameRow {
  code: string;
  name: string;
  contact: string;
  /** 一般局 / 自排局 as published, or whatever else the file says. */
  kind: string;
  prefecture: string;
  pm25: number | null;
  no2: number | null;
  ox: number | null;
}

/** The hour `metadata.json` names, and the hourly file that holds it. */
export interface LatestHour {
  /** The hour-ending instant, ms. */
  endMs: number;
  /** "2026/11/06/21.csv" relative to SORAMAME_BASE. */
  path: string;
}

const LATEST_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):00:00$/;

/** Parse `metadata.json`. Anything but a whole-hour JST stamp is a format error, not a guess. */
export function parseLatest(text: string): LatestHour {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new SoramameFormatError('metadata is not JSON'); }
  const latest = typeof j === 'object' && j !== null ? (j as Record<string, unknown>)['latest'] : undefined;
  const m = typeof latest === 'string' ? LATEST_RE.exec(latest) : null;
  if (!m) throw new SoramameFormatError('metadata.latest is not a whole-hour stamp');
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  let endMs: number | null;
  try { endMs = JST.utcFromLocal(date, Number(m[4]), 0, 'earlier'); } catch { throw new SoramameFormatError('metadata.latest is not a real date'); }
  if (endMs === null) throw new SoramameFormatError('metadata.latest is not a real Tokyo time');
  return { endMs, path: `${m[1]}/${m[2]}/${m[3]}/${m[4]}.csv` };
}

/** Split CSV text into records of fields. Handles quoted fields, "" escapes, CRLF and LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const NUMBER_RE = /^\d+(\.\d+)?$/;
/** A reading: a plain non-negative decimal, or null for blank, "-", "NA" and anything else. 0 is a reading. */
function reading(v: string | undefined, max: number): number | null {
  const t = (v ?? '').trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null; // a value past the physical ceiling is a corrupt cell, not a reading
}
/* Ceilings far above anything real (PM2.5 1,000 µg/m³; NO2 and Ox 1 ppm) so only corruption is refused. */
const MAX_PM25 = 1000, MAX_PPM = 1;

const REQUIRED = ['測定局コード', '測定局名称', '問い合わせ先', '局種別', '都道府県コード', 'PM2.5', 'NO2', 'OX'] as const;

/** Parse one hourly file. A body that is not this CSV (the 200 HTML placeholder) throws SoramameFormatError. */
export function parseHourly(text: string): SoramameRow[] {
  const recs = parseCsv(text);
  const header = recs[0];
  if (!header) throw new SoramameFormatError('empty hourly file');
  const at = new Map(header.map((h, i) => [h.trim(), i] as const));
  for (const col of REQUIRED) if (!at.has(col)) throw new SoramameFormatError(`hourly file lacks column ${col}`);
  const get = (r: string[], col: (typeof REQUIRED)[number]): string => (r[at.get(col)!] ?? '').trim();
  return recs.slice(1).map((r) => ({
    code: get(r, '測定局コード'), name: get(r, '測定局名称'), contact: get(r, '問い合わせ先'), kind: get(r, '局種別'),
    prefecture: get(r, '都道府県コード'),
    pm25: reading(get(r, 'PM2.5'), MAX_PM25), no2: reading(get(r, 'NO2'), MAX_PPM), ox: reading(get(r, 'OX'), MAX_PPM),
  })).filter((r) => /^\d{8}$/.test(r.code));
}

/** Keep the Ministry's national stations and nothing else. The consent gate: see jp-stations.ts. */
export function nationalRows(rows: readonly SoramameRow[]): SoramameRow[] {
  return rows.filter((r) => isNationalStation({ name: r.name, contact: r.contact }));
}

const UNIT: Readonly<Record<JpPollutant, JpReading['unit']>> = { pm25: 'ug_m3', no2: 'ppm', ox: 'ppm' };

/**
 * For each pollutant, the value at the NEAREST ladder station that has one this hour, with that station.
 * Only national rows are considered, and only those on the ladder (a national station beyond the ceiling is
 * not served). The first rung that lacks a pollutant does not hide it: Kasumigaseki publishes NO2 and Ox but
 * no PM2.5, so PM2.5 comes from the next rung, labelled with its own station and distance.
 */
export function pickReadings(rows: readonly SoramameRow[], ladder: readonly { ref: JpStationRef; station: LocalStation }[]): JpReading[] {
  const national = new Map(nationalRows(rows).map((r) => [r.code, r] as const));
  const out: JpReading[] = [];
  for (const p of JP_POLLUTANTS) {
    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i]!;
      const v = national.get(rung.ref.id)?.[p] ?? null;
      if (v === null) continue;
      /* `fallback` only when this pollutant's nearest rung was NOT the area's nearest station. */
      out.push({ pollutant: p, value: v, unit: UNIT[p], station: i === 0 ? rung.station : { ...rung.station, fallback: true } });
      break;
    }
  }
  return out;
}

export interface TokyoDeps { fetch: Fetch; now: Date; signal?: AbortSignal; from?: { lat: number; lon: number } }

function notReporting(area: string, now: Date, reason: NotReportingReason, station: LocalStation | null, last: number | null): LocalAirPayload {
  return { schema: LOCAL_SCHEMA, area_id: area, served_at: now.toISOString(), credit: SORAMAME_CREDIT, standard: 'jp-eqs',
    state: 'not_reporting', reason, station, last_observed_at: last === null ? null : new Date(last).toISOString() };
}

/** Read Tokyo's current hour for `area`. Never throws: a source that cannot be read is the "not reporting" payload. */
export async function readTokyo(area: string, d: TokyoDeps): Promise<LocalAirPayload> {
  const from = d.from ?? MARUNOUCHI;
  const ladder = jpLadder(from);
  const nearest = ladder[0]?.station ?? null;
  if (!nearest) return notReporting(area, d.now, 'no_station', null, null);
  let latest: LatestHour;
  try {
    latest = parseLatest(await getText(METADATA_URL, d.fetch, d.signal));
  } catch {
    return notReporting(area, d.now, 'source_down', nearest, null);
  }
  const age = d.now.getTime() - latest.endMs;
  /* A stamp in the future is a clock or feed error, never an observation. */
  if (age < -15 * 60_000) return notReporting(area, d.now, 'source_down', nearest, null);
  if (age > LIVE_MS) return notReporting(area, d.now, 'no_current_hour', nearest, latest.endMs);
  let rows: SoramameRow[];
  try {
    rows = parseHourly(await getText(`${SORAMAME_BASE}/${latest.path}`, d.fetch, d.signal));
  } catch {
    return notReporting(area, d.now, 'source_down', nearest, latest.endMs);
  }
  const readings = pickReadings(rows, ladder);
  if (readings.length === 0) return notReporting(area, d.now, 'no_current_hour', nearest, latest.endMs);
  return { schema: LOCAL_SCHEMA, area_id: area, served_at: d.now.toISOString(), credit: SORAMAME_CREDIT, standard: 'jp-eqs', state: 'live',
    observed_at: new Date(latest.endMs).toISOString(), observed_at_local: JST.isoAt(latest.endMs), provisional: true, readings };
}

export { jpStation };
