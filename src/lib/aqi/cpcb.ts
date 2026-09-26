/**
 * CPCB National AQI arithmetic, as CPCB's official AQI calculator computes it
 * (cpcb.nic.in AQI-Calculator.xls, Sheet1 D8–D20; register AQI-R33–R40):
 * continuous bands, an open-ended uncapped Severe band continuing the Very Poor
 * slope, rounding only at the end. Ozone uses 100/540 throughout its Very Poor
 * band and beyond, instead of the workbook's 100/539, and above 748 it continues
 * that slope instead of the workbook's `400+(C-400)*100/539`.
 * Pure: no I/O, no clocks. Changing a number here is an algorithm change.
 */
import { MIN_8H } from './hours.ts';
import type { CpcbCategory, Pollutant, PollutantReading } from './types.ts';

export const ALGORITHM = 'cpcb-aqi-1' as const;
/** Valid IST hours a pollutant needs in its window (CPCB: "a minimum of 16 hours' data"). */
export const MIN_HOURS = 16;

/** Sub-index value at each concentration edge below. */
const INDEX_EDGES = [0, 50, 100, 200, 300, 400] as const;

/** Concentration edges: 0, then the tops of Good, Satisfactory, Moderate, Poor, Very Poor. µg/m³; CO in mg/m³. */
export const EDGES: Readonly<Record<Pollutant, readonly [number, number, number, number, number, number]>> = {
  pm10: [0, 50, 100, 250, 350, 430],
  pm25: [0, 30, 60, 90, 120, 250],
  no2: [0, 40, 80, 180, 280, 400],
  so2: [0, 40, 80, 380, 800, 1600],
  co: [0, 1, 2, 10, 17, 34],
  o3: [0, 50, 100, 168, 208, 748],
  nh3: [0, 200, 400, 800, 1200, 1800],
};

const CATEGORIES: readonly CpcbCategory[] = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'];

export function subIndex(p: Pollutant, c: number): number {
  if (!Number.isFinite(c) || c < 0) {
    throw new RangeError(`sub-index needs a finite, non-negative concentration; got ${c}`);
  }
  const e = EDGES[p];
  for (let i = 0; i < 5; i++) {
    if (c <= e[i + 1]!) {
      const x = Math.max(c, e[i]!);
      return Math.round(INDEX_EDGES[i]! + ((INDEX_EDGES[i + 1]! - INDEX_EDGES[i]!) * (x - e[i]!)) / (e[i + 1]! - e[i]!));
    }
  }
  // Severe: open-ended, the Very Poor slope continues with no cap.
  return Math.round(400 + ((c - e[5]) * 100) / (e[5] - e[4]));
}

export function category(aqi: number): CpcbCategory {
  const i = [50, 100, 200, 300, 400].findIndex((hi) => aqi <= hi);
  return CATEGORIES[i === -1 ? 5 : i]!;
}

export type Combined =
  | { ok: true; aqi: number; category: CpcbCategory; dominant: Pollutant }
  | { ok: false; reasons: string[] };

const LABEL: Readonly<Record<Pollutant, string>> = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO2', so2: 'SO2', co: 'CO', o3: 'O3', nh3: 'NH3' };

/** True when a reading's sub-index can be trusted: present, finite, and over enough hours. */
function isValidReading(q: PollutantReading): q is PollutantReading & { sub_index: number } {
  return q.sub_index !== null && Number.isFinite(q.sub_index) && q.hours_present >= MIN_HOURS;
}

/** The CPCB publish rule (workbook G11/A21): at least three valid pollutants including PM2.5 or PM10; AQI = maximum sub-index. */
export function combine(readings: readonly PollutantReading[]): Combined {
  const reasons = readings
    .filter((q) => q.hours_present < MIN_HOURS)
    .map((q) => `${LABEL[q.parameter]} had ${q.hours_present} of ${MIN_HOURS} required hours`);
  /* Enough hours but still no sub-index: say why, or the reasons list would be silent about it. */
  for (const q of readings) {
    if (q.sub_index !== null || q.hours_present < MIN_HOURS) continue;
    reasons.push(q.parameter === 'co' || q.parameter === 'o3'
      ? `${LABEL[q.parameter]} had no 8-hour window with ${MIN_8H} of 8 hours`
      : `${LABEL[q.parameter]} had no valid value`);
  }
  const valid = readings.filter(isValidReading);
  const hasPm = valid.some((q) => q.parameter === 'pm25' || q.parameter === 'pm10');
  if (!hasPm) reasons.push('no valid PM2.5 or PM10');
  if (valid.length < 3) reasons.push(`${valid.length} valid pollutants; CPCB needs 3`);
  if (!hasPm || valid.length < 3) return { ok: false, reasons };
  const top = valid.reduce((a, b) => (b.sub_index > a.sub_index ? b : a));
  const aqi = top.sub_index;
  return { ok: true, aqi, category: category(aqi), dominant: top.parameter };
}
