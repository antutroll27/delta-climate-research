/**
 * The wall clock a city's air-quality hours are counted on.
 *
 * WHY THIS EXISTS. `IST_MS = 5.5 * 3_600_000` was typed into five files of this
 * folder. It is right for every city that reports to CPCB and a latent error for the
 * first one that does not: Amsterdam is UTC+1 or +2, and a city that is not India has
 * no business borrowing India's offset. The offset is now a property of the city's
 * registered IANA zone (`scope/registry.ts` `tz`).
 *
 * TWO CLOCKS, because two different jobs.
 *
 * `fixedClock` (below) is for the Indian hour windows. Their hour keys ('YYYY-MM-DDTHH')
 * are local wall-clock stamps that `hoursBefore`, `window24` and `window8` walk by exact
 * 3,600,000 ms steps. That is exact in a zone whose offset never changes and wrong twice
 * a year in one that has daylight saving (a 23- or 25-hour day). So `fixedClock` REFUSES a
 * zone whose offset differs between January and July instead of returning a clock that is
 * silently an hour out in half the year. Kolkata, Bengaluru and Dubai work as before; IST
 * output is byte-identical.
 *
 * `zoneClock` (further down) is for the cities that report to a local regulator
 * (Amsterdam, Tokyo). It never walks wall-clock keys. Every answer is a function of a UTC
 * INSTANT, so a 23- or 25-hour day is simply a day with that many instants in it, and a
 * wall-clock time maps back to an instant only with the nonexistent (spring) and repeated
 * (autumn) cases spelled out. It works in a fixed zone too, so one code path serves both.
 */
export interface CityClock {
  /** IANA name the offset was derived from */
  readonly tz: string;
  /** local minus UTC, ms; constant for the zone */
  readonly offsetMs: number;
  /** the ISO 8601 suffix for that offset, e.g. "+05:30" */
  readonly isoSuffix: string;
}

const MIN_MS = 60_000;

/** local-minus-UTC, ms, of `tz` at the UTC instant `atMs` (whole minutes). */
function offsetAt(tz: string, atMs: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(atMs)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const local = Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']), Number(p['second']));
  return Math.round((local - Math.floor(atMs / 1000) * 1000) / MIN_MS) * MIN_MS;
}

function suffixOf(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const mins = Math.abs(offsetMs) / MIN_MS;
  return `${sign}${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function fixedClock(tz: string): CityClock {
  const winter = offsetAt(tz, Date.UTC(2026, 0, 15, 12));
  const summer = offsetAt(tz, Date.UTC(2026, 6, 15, 12));
  if (winter !== summer) {
    throw new RangeError(`aqi/clock: ${tz} observes daylight saving (${suffixOf(winter)} / ${suffixOf(summer)}); the hour windows assume a fixed offset`);
  }
  return Object.freeze({ tz, offsetMs: winter, isoSuffix: suffixOf(winter) });
}

/** India Standard Time: CPCB's own clock. Its feed stamps and its archive hours are IST by definition, whatever city asks. */
export const IST_CLOCK: CityClock = fixedClock('Asia/Kolkata');


/* ── the zone clock: daylight saving without walking wall-clock keys ─────────────────── */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Which of two wall-clock readings to take when the clock shows the same time twice (autumn). */
export type Repeat = 'earlier' | 'later';

export interface DayBounds {
  /** UTC instant of local 00:00. */
  readonly startMs: number;
  /** UTC instant of the next local 00:00 (exclusive). */
  readonly endMs: number;
  /** Length of the local day in hours: 23, 24 or 25 where the zone changes. */
  readonly hours: number;
}

export interface ZoneClock {
  readonly tz: string;
  /** True when the zone's offset differs between January and July 2026. */
  readonly observesDst: boolean;
  /** local minus UTC, ms, at the UTC instant `utcMs`. */
  offsetAt(utcMs: number): number;
  /** The instant as local ISO 8601 with its own offset: "2027-03-28T03:00:00+02:00". */
  isoAt(utcMs: number): string;
  /** The local calendar date of the instant: "2027-03-28". */
  dateAt(utcMs: number): string;
  /** UTC instant of the start of the local clock hour containing `utcMs`. */
  hourStartMs(utcMs: number): number;
  /** The local calendar day "YYYY-MM-DD" as UTC instants; 23, 24 or 25 hours long. */
  dayBounds(date: string): DayBounds;
  /**
   * The UTC instant at which the local wall clock of `date` read `hour:minute`, or null
   * when it never did (the skipped hour of spring). When it read that twice (autumn),
   * `repeat` picks which; the choice is ignored when the time is unambiguous.
   */
  utcFromLocal(date: string, hour: number, minute: number, repeat: Repeat): number | null;
}

function parseDate(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`aqi/clock: not a YYYY-MM-DD date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  const back = new Date(Date.UTC(y, mo - 1, d));
  /* Impossible dates ("2027-02-30") are rejected, not rolled over as Date.UTC does. */
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`aqi/clock: impossible date: ${date}`);
  }
  return back.getTime();
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function finite(utcMs: number): number {
  if (!Number.isFinite(utcMs)) throw new RangeError('aqi/clock: not a finite instant');
  return utcMs;
}

export function zoneClock(tz: string): ZoneClock {
  try {
    offsetAt(tz, 0);
  } catch {
    throw new RangeError(`aqi/clock: unknown time zone ${tz}`);
  }
  const off = (utcMs: number): number => offsetAt(tz, finite(utcMs));
  const observesDst = offsetAt(tz, Date.UTC(2026, 0, 15, 12)) !== offsetAt(tz, Date.UTC(2026, 6, 15, 12));
  const utcFromLocal = (date: string, hour: number, minute: number, repeat: Repeat): number | null => {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new RangeError(`aqi/clock: not a wall-clock time: ${hour}:${minute}`);
    }
    const wall = parseDate(date) + hour * HOUR_MS + minute * 60_000;
    /* The offsets in force either side of the wall time bound every candidate: a transition
       is a single step inside this window, so a reading is real exactly when the instant it
       implies has that same offset. */
    const candidates = new Set([off(wall - DAY_MS), off(wall + DAY_MS)]);
    const real = [...candidates].map((o) => wall - o).filter((t) => off(t) === wall - t).sort((a, b) => a - b);
    if (real.length === 0) return null;
    return repeat === 'later' ? real[real.length - 1]! : real[0]!;
  };
  const isoAt = (utcMs: number): string => {
    const o = off(utcMs);
    const d = new Date(utcMs + o);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${suffixOf(o)}`;
  };
  return Object.freeze({
    tz,
    observesDst,
    offsetAt: off,
    isoAt,
    dateAt: (utcMs: number): string => isoAt(utcMs).slice(0, 10),
    hourStartMs: (utcMs: number): number => {
      const o = off(utcMs);
      return Math.floor((utcMs + o) / HOUR_MS) * HOUR_MS - o;
    },
    dayBounds: (date: string): DayBounds => {
      const next = new Date(parseDate(date) + DAY_MS).toISOString().slice(0, 10);
      const startMs = utcFromLocal(date, 0, 0, 'earlier');
      const endMs = utcFromLocal(next, 0, 0, 'earlier');
      if (startMs === null || endMs === null) throw new RangeError(`aqi/clock: ${tz} has no local midnight on ${date} or ${next}`);
      return { startMs, endMs, hours: (endMs - startMs) / HOUR_MS };
    },
    utcFromLocal,
  });
}
