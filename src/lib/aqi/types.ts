/**
 * The air-quality contract, shared by `api/air-quality.ts` and the OBOS UI.
 *
 * Spec: docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md §3.
 *
 * EVERY RESPONSE IS EXACTLY ONE STATE, and absence is a state, not a missing
 * number. The UI switches on `state`; TypeScript then refuses any branch that
 * reads an AQI where the state carries none. Missing values are `null`, never 0.
 */

import type { UsCategory, UsPollutant } from './us-aqi.ts';

export const SCHEMA = 2 as const;

/** CPCB National AQI categories, in order. The UI always prints the word; colour is never the only signal. */
export type CpcbCategory = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very_poor' | 'severe';

export type Pollutant = 'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3' | 'nh3';

export interface SourceNote {
  /** Who measured it, e.g. "West Bengal Pollution Control Board"; null when no station covers the area. */
  owner: string | null;
  /** How it reached us, e.g. "CPCB via OpenAQ". */
  via: string;
  standard: 'CPCB National AQI';
}

export interface AqiStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Geodesic distance from the OBOS area centre, metres. Always shown. */
  distance_m: number;
  /**
   * Where the monitor stands against the OBOS area, as tested from its coordinates
   * (tests/unit/aqi-stations.test.mjs). `window_3km`: inside the 3 km window around
   * the area centre. `outside_window`: not inside it — shown only as the area's
   * NEAREST OFFICIAL MONITOR, with its true distance and `placement` saying where it
   * is, so nothing claims it stands in the area (Ballygunge, founder 2026-10-03).
   */
  inside: 'window_3km' | 'outside_window';
  /** Where an `outside_window` monitor stands, in words (e.g. "in KMC Ward 69, outside Ward 68"). Absent when inside. */
  placement?: string;
  /**
   * Present (true) only when this is NOT the area's nearest monitor: every nearer one on the
   * area's ladder (stations.ts FALLBACKS) published no valid AQI this hour, so this is the
   * nearest monitor REPORTING one, and the card says so. Absent on every Kolkata answer.
   */
  fallback?: true;
}

export interface PollutantReading {
  parameter: Pollutant;
  /**
   * Concentration over the CPCB window: 24 h mean, or 8 h for CO and O3.
   * `null` when the window holds no readings; missing is null, never 0.
   */
  value: number | null;
  unit: 'ug_m3' | 'mg_m3';
  window_h: 24 | 8;
  /** Valid IST hours in the window; CPCB needs at least 16. */
  hours_present: number;
  sub_index: number | null;
}

export interface AqiResult {
  /** Computed by OBOS from OpenAQ's copy of the readings (the fallback since 2026-09-27). */
  origin: 'obos';
  aqi: number;
  category: CpcbCategory;
  dominant: Pollutant;
  pollutants: PollutantReading[];
  /** End of the IST clock hour that contains the last reading; may be up to 45 min after `observed_at`. IST, ISO 8601 with +05:30. */
  window_end_ist: string;
  algorithm: 'cpcb-aqi-1';
}

/**
 * One pollutant's sub-indices as CPCB publishes them (not concentrations: register AQI-R47a).
 * The window is 8 hours for CO and O₃ and 24 hours for every other pollutant (measured, AQI-R47a).
 */
export interface CpcbSubIndex {
  parameter: Pollutant;
  /** The window's mean sub-index; the largest across pollutants IS the AQI. */
  avg: number | null;
  /** The smallest and largest hourly sub-index in the window. */
  min: number | null;
  max: number | null;
  /** The latest hour's sub-index. */
  hourly: number | null;
}

/** CPCB's own published station AQI, read from its CAAQMS feed. */
export interface CpcbResult {
  origin: 'cpcb';
  aqi: number;
  category: CpcbCategory;
  dominant: Pollutant;
  /** The leading pollutant's window: 8 when CO or O₃ leads (CPCB's value is then the 8-hour mean), else 24. */
  window_h: 24 | 8;
  subindices: CpcbSubIndex[];
}

export type Result = AqiResult | CpcbResult;

/**
 * Why there is no AQI. Each says something different about the station, so the UI must not collapse them:
 * - `feed_quiet`: no reading for more than 7 days (or none at all in the 31-day window);
 * - `no_valid_aqi`: the feed is stale (2 h to 7 d) and its window fails the CPCB validity rule;
 * - `upstream_error`: we could not reach the source (OpenAQ, or CPCB's feed via the relay). This says nothing about the station, so `last_observed_at` is null.
 * - `station_not_reporting`: CPCB's feed was read and is current, but none of the area's monitors (its whole ladder) is in it
 *   with a usable answer. The station given is the area's nearest; `last_observed_at` is null.
 */
export type UnavailableReason = 'feed_quiet' | 'no_valid_aqi' | 'upstream_error' | 'station_not_reporting';

interface Common {
  schema: typeof SCHEMA;
  area_id: string;
  served_at: string;
  source: SourceNote;
}

export type AirQualityResponse = Common & (
  | { state: 'live'; station: AqiStation; result: Result; observed_at: string }
  | { state: 'stale'; station: AqiStation; result: Result; observed_at: string; age_h: number }
  | { state: 'unavailable'; station: AqiStation; last_observed_at: string | null; reason: UnavailableReason }
  | ({ state: 'insufficient_data'; station: AqiStation; reasons: string[]; observed_at: string }
      & ({ origin: 'obos'; pollutants: PollutantReading[] } | { origin: 'cpcb'; subindices: CpcbSubIndex[] }))
  | { state: 'no_station'; message: string }
);

export type AqiState = AirQualityResponse['state'];

export interface HistoryDay {
  date_ist: string;
  aqi: number | null;
  category: CpcbCategory | null;
  dominant: Pollutant | null;
  /** Why a day has no AQI, e.g. "PM2.5 had 11 of 16 required hours". */
  reason?: string;
}

export interface HistoryResponse {
  schema: typeof SCHEMA;
  area_id: string;
  station: AqiStation | null;
  days: HistoryDay[];
  pm25_24h: { hour_ist: string; value: number | null }[];
}

/**
 * The city-wide AQI by CPCB's city method (lib/aqi/city.ts): the mean of every valid
 * station CPCB groups under the city, in the same feed snapshot as the ward's figure.
 */
export interface CityAqi {
  /** The OBOS city, e.g. "Kolkata". */
  name: string;
  aqi: number;
  category: CpcbCategory;
  /** How many stations the mean is over (at least 2); equals `members.length`. */
  stations: number;
  /** Each station averaged, with CPCB's exact name and its published AQI. */
  members: { name: string; aqi: number }[];
  /** The snapshot's `lastupdate`, ISO UTC. */
  observed_at: string;
}

/**
 * The same air on the US EPA scale by NowCast (lib/aqi/us-aqi.ts `usNowcast`), from the
 * station's last 12 CPCB hourly PM2.5/PM10 sub-indices turned back into µg/m³.
 */
export interface UsNowcast {
  /** 0–500, whole. */
  aqi: number;
  category: UsCategory;
  dominant: UsPollutant;
  /** Valid hours of the leading pollutant in its 12-hour window (2–12). */
  hours_used: number;
}

/** What `GET /api/air-quality?area=in/kolkata/ballygunge` returns. */
export interface AirQualityPayload {
  current: AirQualityResponse;
  /** null when the area has no station or no usable readings at all. */
  history: HistoryResponse | null;
  /**
   * Present only when `current` is a live CPCB figure from the feed and the city has
   * at least 2 valid stations. Absent on the OpenAQ fallback: sources are never mixed.
   */
  city?: CityAqi;
  /**
   * Present only with a live CPCB figure from the Pi relay whose station has at least 2 of
   * its latest 3 hours on record. Absent on the OpenAQ fallback, which keeps the 24-hour line.
   */
  us_nowcast?: UsNowcast;
}
