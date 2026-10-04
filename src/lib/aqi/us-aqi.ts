/**
 * THE US EPA EQUIVALENT of an Indian (CPCB) reading: the same air on the scale
 * IQAir and aqi.in print, so a reader comparing sites does not think OBOS is wrong.
 * The official CPCB National AQI stays the headline; this is a footnote to it.
 *
 * CPCB's feed carries SUB-INDICES, not concentrations (register AQI-R47a), so for a
 * CPCB result the 24-hour PM2.5 and PM10 avg sub-indices are first turned back into
 * concentrations by inverting the NAQI bands in `cpcb.ts` (the same `EDGES`, so
 * the two directions can never disagree). Then the US AQI is the US EPA formula
 * with the 2024 revised PM2.5 breakpoints (89 FR 16202, effective 2024-05-06),
 * concentrations truncated as EPA does (PM2.5 to 0.1 µg/m³, PM10 to 1 µg/m³), and
 * the larger of the two pollutant indices.
 *
 * HOW EXACT. CPCB publishes integer sub-indices, so the inverted concentration is
 * good to half a sub-index step: ±0.3 µg/m³ for PM2.5 below 60, ±0.75 µg/m³ for PM10
 * between 100 and 250. Hence the "≈" the card prints. An OBOS result already carries
 * the 24-hour concentrations and is used directly, with no inversion.
 *
 * Pure: no DOM, no I/O, no clock. Missing is null, never a guess.
 */
import { EDGES } from './cpcb.ts';
import type { Result, UsNowcast } from './types.ts';

export type UsPollutant = 'pm25' | 'pm10';
export type UsCategory = 'good' | 'moderate' | 'usg' | 'unhealthy' | 'very_unhealthy' | 'hazardous';

export const US_WORD: Readonly<Record<UsCategory, string>> = {
  good: 'Good', moderate: 'Moderate', usg: 'Unhealthy for Sensitive Groups',
  unhealthy: 'Unhealthy', very_unhealthy: 'Very Unhealthy', hazardous: 'Hazardous',
};

export interface UsAqi {
  /** 0–500. Capped at 500, as AirNow caps it; `capped` says the air is beyond the scale. */
  aqi: number;
  capped: boolean;
  category: UsCategory;
  dominant: UsPollutant;
  /** The 24-hour concentrations used, µg/m³, after EPA truncation; null when the pollutant is missing. */
  pm25: number | null;
  pm10: number | null;
}

/** NAQI sub-index value at each `EDGES` concentration (cpcb.ts's INDEX_EDGES). */
const NAQI_INDEX = [0, 50, 100, 200, 300, 400] as const;

/**
 * NAQI sub-index → concentration (µg/m³), the exact inverse of `subIndex` before its
 * rounding. Above 400 it continues the Very Poor slope, as `subIndex` does.
 */
export function naqiToConcentration(p: UsPollutant, si: number): number {
  if (!Number.isFinite(si) || si < 0) throw new RangeError(`concentration needs a finite, non-negative sub-index; got ${si}`);
  const e = EDGES[p];
  for (let i = 0; i < 5; i++) {
    if (si <= NAQI_INDEX[i + 1]!) {
      return e[i]! + ((si - NAQI_INDEX[i]!) * (e[i + 1]! - e[i]!)) / (NAQI_INDEX[i + 1]! - NAQI_INDEX[i]!);
    }
  }
  return e[5] + ((si - 400) * (e[5] - e[4])) / 100;
}

/** [C_lo, C_hi, I_lo, I_hi], 24-hour, µg/m³. PM2.5 is the 2024 revision. */
type Band = readonly [number, number, number, number];
const US_BANDS: Readonly<Record<UsPollutant, readonly Band[]>> = {
  pm25: [[0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]],
  pm10: [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 604, 301, 500]],
};

/** EPA truncation, guarded against binary fractions like 52.199999999 meaning 52.2. */
export function truncate(p: UsPollutant, c: number): number {
  return p === 'pm25' ? Math.floor(c * 10 + 1e-6) / 10 : Math.floor(c + 1e-6);
}

/** One pollutant's US AQI from a (truncated) 24-hour concentration; above the top band it is 500, capped. */
export function usIndex(p: UsPollutant, c: number): { aqi: number; capped: boolean } {
  if (!Number.isFinite(c) || c < 0) throw new RangeError(`US AQI needs a finite, non-negative concentration; got ${c}`);
  const t = truncate(p, c);
  for (const [cl, ch, il, ih] of US_BANDS[p]) {
    if (t <= ch) return { aqi: Math.round(il + ((ih - il) * (Math.max(t, cl) - cl)) / (ch - cl)), capped: false };
  }
  return { aqi: 500, capped: true };
}

export function usCategory(aqi: number): UsCategory {
  return aqi <= 50 ? 'good' : aqi <= 100 ? 'moderate' : aqi <= 150 ? 'usg' : aqi <= 200 ? 'unhealthy' : aqi <= 300 ? 'very_unhealthy' : 'hazardous';
}

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The US AQI from 24-hour PM2.5 and PM10 concentrations (µg/m³); null when neither is usable. */
export function usAqiFromConcentrations(pm25: number | null, pm10: number | null): UsAqi | null {
  const a = ok(pm25) ? usIndex('pm25', pm25) : null;
  const b = ok(pm10) ? usIndex('pm10', pm10) : null;
  if (!a && !b) return null;
  /* A tie goes to PM2.5, the pollutant the US scale was revised for. */
  const lead: UsPollutant = a && (!b || a.aqi >= b.aqi) ? 'pm25' : 'pm10';
  const top = lead === 'pm25' ? a! : b!;
  return {
    aqi: top.aqi, capped: top.capped, category: usCategory(top.aqi), dominant: lead,
    pm25: ok(pm25) ? truncate('pm25', pm25) : null, pm10: ok(pm10) ? truncate('pm10', pm10) : null,
  };
}

/**
 * The US equivalent of a headline result, or null when it carries no usable 24-hour
 * PM2.5 or PM10. CPCB: the avg sub-indices, inverted. OBOS: the 24-hour concentrations
 * of pollutants with a valid sub-index (the same validity the headline used).
 */
export function usAqiOf(r: Result): UsAqi | null {
  if (r.origin === 'cpcb') {
    const si = (p: UsPollutant): number | null => {
      const v = r.subindices.find((q) => q.parameter === p)?.avg;
      return ok(v) ? naqiToConcentration(p, v) : null;
    };
    return usAqiFromConcentrations(si('pm25'), si('pm10'));
  }
  const c = (p: UsPollutant): number | null => {
    const q = r.pollutants.find((x) => x.parameter === p);
    return q && q.window_h === 24 && q.unit === 'ug_m3' && ok(q.sub_index) && ok(q.value) ? q.value : null;
  };
  return usAqiFromConcentrations(c('pm25'), c('pm10'));
}

/**
 * EPA NOWCAST (the AirNow real-time PM method): a weighted mean of the last 12 hourly
 * concentrations, recent hours weighted more when the air is changing.
 *
 * `hours[0]` is the latest hour, `hours[k]` the hour k hours before it; a missing hour is
 * null (the slot is kept, so a gap never shifts older hours forward). Only the first 12 are read.
 *   w = min / max over the valid hours (1 when max is 0), floored at 0.5 for PM;
 *   NowCast = Σ wᵏ·cₖ / Σ wᵏ over the valid hours, then EPA truncation.
 * At least 2 of the latest 3 hours must be valid, else null (AirNow's only rule:
 * forum.airnowtech.org/t/the-nowcast-for-pm2-5-and-pm10/172).
 */
export const NOWCAST_HOURS = 12;

export function nowcast(p: UsPollutant, hours: readonly (number | null)[]): number | null {
  const h = Array.from({ length: NOWCAST_HOURS }, (_, k) => (ok(hours[k]) ? hours[k]! : null));
  if (h.slice(0, 3).filter((x) => x !== null).length < 2) return null;
  const vals = h.filter((x): x is number => x !== null);
  const max = Math.max(...vals), min = Math.min(...vals);
  const w = Math.max(max > 0 ? min / max : 1, 0.5);
  let num = 0, den = 0;
  h.forEach((c, k) => { if (c !== null) { num += c * w ** k; den += w ** k; } });
  return truncate(p, num / den);
}

/**
 * The US NowCast AQI from hourly PM2.5 and PM10 concentrations (µg/m³, latest first):
 * the larger of the two pollutant indices, a tie to PM2.5. `hours_used` counts the valid
 * hours of the leading pollutant in its 12-hour window. Null when neither has a NowCast.
 */
export function usNowcast(pm25: readonly (number | null)[], pm10: readonly (number | null)[]): UsNowcast | null {
  const a = nowcast('pm25', pm25), b = nowcast('pm10', pm10);
  const u = usAqiFromConcentrations(a, b);
  if (!u) return null;
  const used = (u.dominant === 'pm25' ? pm25 : pm10).slice(0, NOWCAST_HOURS).filter(ok).length;
  return { aqi: u.aqi, category: u.category, dominant: u.dominant, hours_used: used };
}
