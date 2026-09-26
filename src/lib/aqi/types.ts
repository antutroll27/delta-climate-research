/**
 * The air-quality contract, shared by `api/air-quality.ts` and the OBOS UI.
 *
 * Spec: docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md §3.
 *
 * EVERY RESPONSE IS EXACTLY ONE STATE, and absence is a state, not a missing
 * number. The UI switches on `state`; TypeScript then refuses any branch that
 * reads an AQI where the state carries none. Missing values are `null`, never 0.
 */

export const SCHEMA = 1 as const;

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
  /** The geometry the station was tested against. First release: the 3 km window. */
  inside: 'window_3km';
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
  aqi: number;
  category: CpcbCategory;
  dominant: Pollutant;
  pollutants: PollutantReading[];
  /** End of the IST clock hour that contains the last reading; may be up to 45 min after `observed_at`. IST, ISO 8601 with +05:30. */
  window_end_ist: string;
  algorithm: 'cpcb-aqi-1';
}

/**
 * Why there is no AQI. Each says something different about the station, so the UI must not collapse them:
 * - `feed_quiet`: no reading for more than 7 days (or none at all in the 31-day window);
 * - `no_valid_aqi`: the feed is stale (2 h to 7 d) and its window fails the CPCB validity rule;
 * - `upstream_error`: we could not reach OpenAQ. This says nothing about the station, so `last_observed_at` is null.
 */
export type UnavailableReason = 'feed_quiet' | 'no_valid_aqi' | 'upstream_error';

interface Common {
  schema: typeof SCHEMA;
  area_id: string;
  served_at: string;
  source: SourceNote;
}

export type AirQualityResponse = Common & (
  | { state: 'live'; station: AqiStation; result: AqiResult; observed_at: string }
  | { state: 'stale'; station: AqiStation; result: AqiResult; observed_at: string; age_h: number }
  | { state: 'unavailable'; station: AqiStation; last_observed_at: string | null; reason: UnavailableReason }
  | { state: 'insufficient_data'; station: AqiStation; pollutants: PollutantReading[]; reasons: string[]; observed_at: string }
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

/** What `GET /api/air-quality?area=in/kolkata/ballygunge` returns. */
export interface AirQualityPayload {
  current: AirQualityResponse;
  /** null when the area has no station or no usable readings at all. */
  history: HistoryResponse | null;
}
