/**
 * The wall clock a city's air-quality hours are counted on.
 *
 * WHY THIS EXISTS. `IST_MS = 5.5 * 3_600_000` was typed into five files of this
 * folder. It is right for every city that reports to CPCB and a latent error for the
 * first one that does not: Amsterdam is UTC+1 or +2, and a city that is not India has
 * no business borrowing India's offset. The offset is now a property of the city's
 * registered IANA zone (`scope/registry.ts` `tz`), read through `fixedClock`.
 *
 * FIXED OFFSETS ONLY, AND LOUD ABOUT IT. The hour keys ('YYYY-MM-DDTHH') are local
 * wall-clock stamps that the windows (`hoursBefore`, `window24`, `window8`) walk by
 * exact 3,600,000 ms steps. That is exact in a zone whose offset never changes and
 * wrong twice a year in one that has daylight saving (a 23- or 25-hour day). So
 * `fixedClock` REFUSES a zone whose offset differs between January and July instead
 * of returning a clock that is silently an hour out in half the year. Amsterdam's
 * air card (plan Phase C3) must make the windows DST-aware before it can have one.
 *
 * Kolkata, Bengaluru and Dubai (no DST) work as before; IST output is byte-identical.
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
