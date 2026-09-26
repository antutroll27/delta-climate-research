/**
 * Raw OpenAQ readings -> IST clock-hour means -> CPCB window values. Pure.
 * Never use OpenAQ's /hours: it drops one quarter-hour in four and buckets by UTC
 * hours, which straddle IST hours (register AQI-R23).
 */
export interface Raw { end_utc: string; value: number }
export interface Hour { mean: number; n: number }
/** Hour keys are 'YYYY-MM-DDTHH' in IST, naming the hour's START. */
export type HourKey = string;

const IST_MS = 5.5 * 3_600_000;
const QUARTER_MS = 15 * 60_000;
/** A timestamp with an explicit zone offset (Z or ±HH:MM). Without one, Date.parse reads it as local time. */
const HAS_ZONE_OFFSET = /(Z|[+-]\d\d:\d\d)$/;

/** True when `s` carries an explicit zone offset and parses. The one gate for every consumer of `end_utc`. */
export function isStampedUtc(s: string): boolean {
  return HAS_ZONE_OFFSET.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * True when a raw row counts at all: a finite value above 0 (CPCB's calculator counts 0 as missing,
 * workbook E8) and a stamp with an offset that parses (never guess a zone). The one gate for
 * `istHours` and for the builder's freshness clock, so the two can never disagree.
 */
export function isUsable(r: Raw): boolean {
  return Number.isFinite(r.value) && r.value > 0 && isStampedUtc(r.end_utc);
}

export function istHourKey(endUtc: string): HourKey {
  const startIst = new Date(Date.parse(endUtc) + IST_MS - QUARTER_MS);
  return startIst.toISOString().slice(0, 13);
}

export function istHours(raw: readonly Raw[]): Map<HourKey, Hour> {
  const acc = new Map<HourKey, { sum: number; n: number }>();
  for (const r of raw) {
    if (!isUsable(r)) continue;
    const k = istHourKey(r.end_utc);
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += r.value; a.n += 1; acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, { mean: a.sum / a.n, n: a.n }]));
}

/** The 24 hour keys before `endKey` (exclusive), oldest first. */
export function hoursBefore(endKey: HourKey, count = 24): HourKey[] {
  const end = Date.parse(`${endKey}:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - i) * 3_600_000).toISOString().slice(0, 13));
}

export function window24(hours: ReadonlyMap<HourKey, Hour>, endKey: HourKey): { value: number | null; hours: number } {
  const vals = hoursBefore(endKey).map((k) => hours.get(k)?.mean).filter((v): v is number => v !== undefined);
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, hours: vals.length };
}

/** Minimum hours inside one 8-hour sub-window. CPCB states none (register AQI-R38); 6 of 8 is an OBOS choice, declared. */
export const MIN_8H = 6;

export function window8(hours: ReadonlyMap<HourKey, Hour>, endKey: HourKey): { value: number | null; hours: number } {
  const day = hoursBefore(endKey);
  let best: number | null = null;
  for (let s = 0; s + 8 <= day.length; s++) {
    const vals = day.slice(s, s + 8).map((k) => hours.get(k)?.mean).filter((v): v is number => v !== undefined);
    if (vals.length >= MIN_8H) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      best = best === null ? m : Math.max(best, m);
    }
  }
  return { value: best, hours: day.filter((k) => hours.has(k)).length };
}
