/**
 * THE IN-PROCESS CACHES BEHIND AMSTERDAM'S AIR CARDS, and the cooldown that keeps them inside Luchtmeetnet's request budget.
 *
 * THE BUDGET. Luchtmeetnet's "Open data" page: "maximum of 100 requests per 5 minutes", under a fair-use policy that reserves the right to block
 * excessive use (read 2026-11-09; it does not say per what, so the bound below is per function instance and assumed to be shared).
 * 32 areas × (LKI + substances + model) = 96 requests per cold sweep, and an outage walked the whole ladder per area per minute: so
 * nothing is fetched per area any more.
 *
 * THREE SEPARATE MAPS, never mixed (a prefixed key in one map is how an area's number lands on another's card):
 *   stations  NL49014 → RAW parsed rows (`/lki` rows, substance rows) and when they were read. NEVER a LocalStation: the distance and the
 *             fallback label are per AREA and are built per request from `nlLadder(centre)`; one entry serves every area on that station.
 *   models    "52.364000,4.885000" (the model's own location key) → the WHOLE run (all its rows) and when it was read. The current-hour row is
 *             picked at REQUEST time, so the line does not vanish at an hour boundary and an old hour's row is never kept.
 *   the area payload is not cached for Amsterdam at all: it is cheap to assemble from the two maps above (local-handler.ts keeps its payload
 *   cache for Tokyo only), so no TTLs stack.
 *
 * FRESHNESS (all re-judged at USE time against the request's clock, never at fetch time):
 *   a station entry with a current row lives STATION_TTL_MS; one with no row, an unreadable one, and one past its stale window live NEGATIVE_MS, so an
 *   outage costs one `/lki` request per station per minute however many areas ask; and once the newest row is old enough that a new hour's row is
 *   due (the hour after it closes plus LATE_MS) the entry is looked at again every NEGATIVE_MS, so an area is not left on a fallback rung or "not
 *   reporting" for a whole TTL after the nearer station published.
 *   a model run lives MODEL_RUN_MAX_MS (a run is static for hours until the next one); an unreadable answer, or one with no row for the current
 *   hour (one answer in eight was cut short), or a run that has run out, is read again no sooner than MODEL_RETRY_MS.
 *   Concurrent requests share one in-flight read per station and per model location.
 *
 * THE COOLDOWN. A 429 (or 403) from Luchtmeetnet sets a module-level cooldown (COOLDOWN_MS) that stops EVERY further request, rungs and model alike; the
 * cards then answer from what is still current in the caches or say "not reporting / could not be read" (the existing honest source_down state,
 * never a value). Each 429 or 403 is logged (path only): a fair-use block may come back as either. 503 is not treated as a block: it is how an outage looks, and the negative entries bound it.
 *
 * PER INSTANCE ONLY: another warm instance has its own caches, so the bound is the figure below times the instances (tests/unit/aqi-ams-budget.test.mjs
 * counts fetches for the worst cases).
 */
import type { LkiRow, MeasurementRow, ModelRow } from './luchtmeetnet.ts';

export const STATION_TTL_MS = 10 * 60_000;
export const NEGATIVE_MS = 60_000;
/** The station publishes an hour's row 20-35 minutes after the hour closes; once the newest row is this far past the NEXT hour's close, a newer one is due. */
export const LATE_MS = 20 * 60_000;
export const MODEL_RUN_MAX_MS = 60 * 60_000;
export const MODEL_RETRY_MS = 5 * 60_000;
export const COOLDOWN_MS = 5 * 60_000;
/** A substance read that failed is retried no sooner than this (the LKI headline is unaffected meanwhile). */
export const MEAS_RETRY_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export interface StationRows {
  /** When the rows were read, ms (the requester's clock). */
  at: number;
  /** The `/lki` rows, newest first; null when the station could not be read. */
  lki: LkiRow[] | null;
  /** The substance rows of the same answer window; empty when none were read. */
  meas: MeasurementRow[];
  /** The hour (end, ms) the substance rows were read for; a re-read of the LKI that finds the same newest hour reuses them instead of asking again. */
  measFor?: number;
  /** A substance read that FAILED for this newest hour, and when: it is not marked as read (`measFor`), and is tried again no sooner than MEAS_RETRY_MS. */
  measFailed?: { for: number; at: number };
}

export interface ModelRun {
  at: number;
  /** Every valid row of the run (any hour); null when the answer could not be read. */
  rows: ModelRow[] | null;
}

export interface NlCache {
  stations: Map<string, StationRows>;
  stationsInflight: Map<string, Promise<StationRows>>;
  models: Map<string, ModelRun>;
  modelsInflight: Map<string, Promise<ModelRun>>;
  /** No Luchtmeetnet request is made before this instant (ms), 0 for none. */
  coolUntil: number;
}

export const newNlCache = (): NlCache => ({ stations: new Map(), stationsInflight: new Map(), models: new Map(), modelsInflight: new Map(), coolUntil: 0 });

export const cooling = (nl: NlCache, nowMs: number): boolean => nowMs < nl.coolUntil;

/** Is a cached station entry still the answer at `nowMs`? `liveMs` is the stale window (luchtmeetnet.ts LIVE_MS). */
export function stationFresh(e: StationRows, nowMs: number, liveMs: number): boolean {
  const age = nowMs - e.at;
  const top = e.lki?.[0];
  if (top === undefined) return age < NEGATIVE_MS;                         // unreadable, or no row
  if (nowMs - top.endMs > liveMs) return age < NEGATIVE_MS;                // stale: look again soon
  if (nowMs > top.endMs + HOUR_MS + LATE_MS) return age < NEGATIVE_MS;     // the next hour's row is due
  if (e.measFailed?.for === top.endMs) return age < MEAS_RETRY_MS;          // its substances failed to read: try them again soon
  return age < STATION_TTL_MS;
}

/** The current-hour row of a run, or null: the newest row with stamp <= now < stamp + 1 h. */
export function currentModelRow(rows: readonly ModelRow[], nowMs: number): ModelRow | null {
  let best: ModelRow | null = null;
  for (const r of rows) if (r.hourMs <= nowMs && nowMs - r.hourMs < HOUR_MS && (best === null || r.hourMs > best.hourMs)) best = r;
  return best;
}

/** Must a cached model run be read again at `nowMs`? */
export function modelStale(run: ModelRun, nowMs: number): boolean {
  const age = nowMs - run.at;
  if (age >= MODEL_RUN_MAX_MS) return true;
  if (run.rows === null) return age >= MODEL_RETRY_MS;
  const last = run.rows.reduce((m, r) => Math.max(m, r.hourMs), -Infinity);
  // no row for the current hour, or the run has run out: ask again, but not more than once per MODEL_RETRY_MS
  return (currentModelRow(run.rows, nowMs) === null || last <= nowMs) && age >= MODEL_RETRY_MS;
}
