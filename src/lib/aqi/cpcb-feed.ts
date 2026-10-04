/**
 * CPCB'S OWN CAAQMS FEED: the station AQI as CPCB publishes it.
 *
 * `https://airquality.cpcb.gov.in/caaqms/rss_feed` is XML, one snapshot of every
 * live station. MEASURED 2026-09-27 (register AQI-R47a): its Min/Max/Avg are
 * SUB-INDICES, not concentrations; the published AQI is the largest Avg and the
 * predominant pollutant holds it. `pick` enforces that at runtime, so a change of
 * meaning upstream falls back to OBOS's own calculation instead of painting a wrong number.
 *
 * Pure except `fetchFeed` and `readRelayFeed`. No XML library: a strict reader for exactly
 * <Station>, <Pollutant_Index/> and <Air_Quality_Index/>; a station with any
 * value that is not a whole number, "NA" or "" is dropped (never coerced).
 * IST is the fixed +05:30 offset (obos-scope forbids naming a zone).
 *
 * LINEAR BY CONSTRUCTION (audit I2): the body is up to 2 MB of untrusted text, and
 * lazy `[\s\S]*?` searches plus unanchored attribute patterns were O(n²): 22 s on a
 * 200 KB body. Elements are found with `indexOf` scans that never revisit a byte,
 * a tag longer than MAX_TAG is skipped whole, and the attribute pattern is anchored
 * on whitespace with capped name and value lengths, so it only ever runs on ≤ 1 KB.
 */
import { gunzipSync } from 'node:zlib';
import type { FeedStore } from './relay-store.ts';
import { stationPayload, type StationEntry } from './stations.ts';
import { category } from './cpcb.ts';
import { LIVE_H, STALE_DAYS } from './build.ts';
import { SCHEMA, type AirQualityResponse, type AqiStation, type CpcbResult, type CpcbSubIndex, type Pollutant } from './types.ts';

export const FEED_URL = 'https://airquality.cpcb.gov.in/caaqms/rss_feed';
export const FEED_TIMEOUT_MS = 8_000;
export const FEED_MAX_BYTES = 2_000_000;
export const MATCH_M = 100;
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth)';

export class FeedError extends Error {
  constructor(message: string) { super(message); this.name = 'FeedError'; }
}

export interface FeedStation {
  name: string;
  /** `lastupdate` as ISO UTC. Feed-wide in practice. */
  published_at: string;
  lat: number;
  lon: number;
  /** null when CPCB published no AQI (`Value=""`). */
  aqi: number | null;
  dominant: Pollutant | null;
  subindices: CpcbSubIndex[];
  /** The `<State id>` and `<City id>` the station sits in (CPCB's own grouping); null when it sits in none. */
  state: string | null;
  city: string | null;
}

const PARAM: Readonly<Record<string, Pollutant>> = { 'PM2.5': 'pm25', PM10: 'pm10', NO2: 'no2', SO2: 'so2', CO: 'co', OZONE: 'o3', NH3: 'nh3' };
const ENT: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENT[e]!);

/** The longest opening tag read, in characters; a longer one is skipped whole. The real feed's longest is under 200. */
const MAX_TAG = 1024;

/** Attributes of one tag of at most MAX_TAG characters. Anchored on whitespace and capped, so it cannot backtrack. */
function attrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/(?:^|\s)([A-Za-z_][\w.-]{0,63})="([^"]{0,512})"/g)) o[m[1]!] = decode(m[2]!);
  return o;
}

/** True when `s[i]` ends a tag name (what `\b` meant before): whitespace, `>` or `/`. */
const ends = (s: string, i: number): boolean => i >= s.length || /[\s>/]/.test(s[i]!);

/**
 * Every `<name …>` element in `s` with its body up to the first `</name>`, in one
 * forward pass: each scan starts where the last one stopped, so no byte is read
 * twice. An element with no closing tag ends the pass, because no later one can close.
 */
function* elements(s: string, name: string): Generator<{ tag: string; body: string; at: number }> {
  const open = `<${name}`, close = `</${name}>`;
  let i = s.indexOf(open);
  while (i >= 0) {
    if (!ends(s, i + open.length)) { i = s.indexOf(open, i + open.length); continue; }
    const gt = s.indexOf('>', i);
    if (gt < 0) return;
    if (gt - i > MAX_TAG) { i = s.indexOf(open, gt + 1); continue; }
    const end = s.indexOf(close, gt + 1);
    if (end < 0) return;
    yield { tag: s.slice(i + open.length, gt), body: s.slice(gt + 1, end), at: i };
    i = s.indexOf(open, end + close.length);
  }
}

/** Every self-closing `<name … />` in `s`, in one forward pass; an unterminated or over-long tag is skipped whole. */
function* selfClosing(s: string, name: string): Generator<string> {
  const open = `<${name}`;
  let i = s.indexOf(open);
  while (i >= 0) {
    if (!ends(s, i + open.length)) { i = s.indexOf(open, i + open.length); continue; }
    const gt = s.indexOf('>', i);
    if (gt < 0) return;
    if (gt - i <= MAX_TAG && s[gt - 1] === '/') yield s.slice(i + open.length, gt - 1);
    i = s.indexOf(open, gt + 1);
  }
}

/**
 * Every non-self-closing `<name id="…">` with the span up to its `</name>`, in one forward
 * pass. A self-closing `<State id="…"/>` (an empty state) opens nothing; an opening tag with
 * no close ends the pass. The CPCB grouping is flat (State > City > Station), never nested in itself.
 */
function spans(s: string, name: string): { start: number; end: number; id: string }[] {
  const open = `<${name}`, close = `</${name}>`, out: { start: number; end: number; id: string }[] = [];
  let i = s.indexOf(open);
  while (i >= 0) {
    if (!ends(s, i + open.length)) { i = s.indexOf(open, i + open.length); continue; }
    const gt = s.indexOf('>', i);
    if (gt < 0) break;
    if (gt - i > MAX_TAG || s[gt - 1] === '/') { i = s.indexOf(open, gt + 1); continue; }
    const end = s.indexOf(close, gt + 1);
    if (end < 0) break;
    out.push({ start: i, end, id: attrs(s.slice(i + open.length, gt))['id'] ?? '' });
    i = s.indexOf(open, end + close.length);
  }
  return out;
}

/** The id of the span holding position `at`. Stations arrive in document order, so `k` only moves forward. */
function holder(xs: readonly { start: number; end: number; id: string }[], k: { i: number }, at: number): string | null {
  while (k.i < xs.length && xs[k.i]!.end < at) k.i++;
  const x = xs[k.i];
  return x && x.start < at && at < x.end && x.id ? x.id : null;
}

/** "NA" and "" are missing; anything else must be a whole number. */
function whole(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === 'NA') return null;
  if (!/^\d+$/.test(v)) throw new FeedError(`not a whole number: ${v}`);
  return Number(v);
}

const IST_MS = 5.5 * 3_600_000;

/**
 * "27-09-2026 05:00:00" (IST) → ISO UTC. Impossible values ("31-02-2026", hour 24)
 * are rejected, not rolled over as Date.parse does: the parts must read back unchanged.
 */
export function istStamp(s: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new FeedError(`bad lastupdate: ${s}`);
  const [d, mo, y, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  const local = Date.UTC(y, mo - 1, d, h, mi, se), back = new Date(local);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
    || back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== se) throw new FeedError(`bad lastupdate: ${s}`);
  return new Date(local - IST_MS).toISOString();
}

/**
 * The text with every comment and CDATA section removed, in one forward pass. An
 * unclosed one runs to the end, as in XML: nothing after it is read.
 */
function stripHidden(xml: string): string {
  /* Each opener's next position is kept and re-searched only once the pass has moved past it:
     re-searching both on every step read the whole tail again per section (re-audit I-1: 78 s at 2 MB). */
  let out = '', i = 0, c = xml.indexOf('<!--'), d = xml.indexOf('<![CDATA[');
  for (;;) {
    if (c >= 0 && c < i) c = xml.indexOf('<!--', i);
    if (d >= 0 && d < i) d = xml.indexOf('<![CDATA[', i);
    const at = c < 0 ? d : d < 0 ? c : Math.min(c, d);
    if (at < 0) return out + xml.slice(i);
    out += xml.slice(i, at);
    const close = at === c ? '-->' : ']]>', end = xml.indexOf(close, at + (at === c ? 4 : 9));
    if (end < 0) return out;
    i = end + close.length;
  }
}

export function parseFeed(xml: string): FeedStation[] {
  if (!xml.includes('<AqIndex')) throw new FeedError('not a CPCB AQI feed');
  const out: FeedStation[] = [];
  const doc = stripHidden(xml);
  const states = spans(doc, 'State'), cities = spans(doc, 'City'), ks = { i: 0 }, kc = { i: 0 };
  for (const el of elements(doc, 'Station')) {
    try {
      const a = attrs(el.tag), body = el.body;
      /* Number('') and Number(' ') are 0, a real place: a blank coordinate is missing, not zero. */
      const la = (a['latitude'] ?? '').trim(), lo = (a['longitude'] ?? '').trim();
      const lat = Number(la), lon = Number(lo);
      if (!a['id'] || !la || !lo || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const subindices: CpcbSubIndex[] = [];
      for (const tag of selfClosing(body, 'Pollutant_Index')) {
        const q = attrs(tag), parameter = PARAM[q['id'] ?? ''];
        if (parameter) subindices.push({ parameter, avg: whole(q['Avg']), min: whole(q['Min']), max: whole(q['Max']), hourly: whole(q['Hourly_sub_index']) });
      }
      const aq = selfClosing(body, 'Air_Quality_Index').next(), aa = aq.done ? {} : attrs(aq.value);
      const aqi = whole(aa['Value']), dominant = PARAM[aa['Predominant_Parameter'] ?? ''] ?? null;
      /* A published AQI led by a pollutant we cannot name is not "no AQI": drop the station, so ours falls back (re-audit M-1). */
      if (aqi !== null && !dominant) continue;
      out.push({ name: a['id'], published_at: istStamp(a['lastupdate'] ?? ''), lat, lon,
        aqi: aqi !== null && dominant ? aqi : null, dominant: aqi !== null ? dominant : null, subindices,
        state: holder(states, ks, el.at), city: holder(cities, kc, el.at) });
    } catch {
      continue; // ponytail: one malformed station never poisons the rest; ours then falls back to OBOS's calculation
    }
  }
  if (out.length === 0) throw new FeedError('no stations parsed');
  return out;
}

const havM = (a: number, b: number, c: number, d: number): number => {
  const R = 6_371_008.8, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** CPCB's AQI scale ends at 500; a larger AQI or sub-index is not a CPCB value. */
export const AQI_MAX = 500;

/**
 * Our station in the feed: exactly one station with its exact name, within 100 m,
 * every value on CPCB's 0–500 scale, and CPCB's AQI the largest Avg held by the
 * named pollutant (AQI-R47a). Otherwise null → fallback.
 */
export function pick(feed: readonly FeedStation[], st: StationEntry): FeedStation | null {
  const same = feed.filter((s) => s.name === st.cpcb_name);
  if (same.length !== 1) return null; // two stations with our name: we cannot say which is ours
  const f = same[0]!;
  if (havM(st.lat, st.lon, f.lat, f.lon) > MATCH_M) return null;
  const vals = [f.aqi, ...f.subindices.flatMap((q) => [q.avg, q.min, q.max, q.hourly])];
  if (vals.some((v) => v !== null && v > AQI_MAX)) return null;
  if (f.aqi === null) return f;
  const avgs = f.subindices.map((q) => q.avg).filter((v): v is number => v !== null);
  const max = avgs.length ? Math.max(...avgs) : -1;
  const held = f.subindices.some((q) => q.parameter === f.dominant && q.avg === max);
  return f.aqi === max && held ? f : null;
}

/** The body, read chunk by chunk and abandoned the moment it passes FEED_MAX_BYTES: nothing unbounded is ever buffered. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > FEED_MAX_BYTES) { await reader.cancel().catch(() => {}); throw new FeedError('CPCB feed too large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** One request, 8 s, 2 MB cap, identifying User-Agent. Every failure is a FeedError (its message carries no secret). */
export async function fetchFeed(o: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<FeedStation[]> {
  const f = o.fetch ?? fetch;
  const timeout = AbortSignal.timeout(FEED_TIMEOUT_MS);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  let text: string;
  try {
    const res = await f(FEED_URL, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal });
    /* A refused answer's body is cancelled, never left streaming (re-audit M-6). */
    const refuse = async (why: string): Promise<never> => { await res.body?.cancel().catch(() => {}); throw new FeedError(why); };
    if (!res.ok) await refuse(`CPCB feed ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > FEED_MAX_BYTES) await refuse('CPCB feed too large');
    text = await readCapped(res);
  } catch (e) {
    if (e instanceof FeedError) throw e;
    if (o.signal?.aborted) throw new FeedError('CPCB feed aborted');
    throw new FeedError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'CPCB feed timed out' : 'CPCB feed unreachable');
  }
  return parseFeed(text);
}

/**
 * CPCB's feed as the Pi relayed it (spec 2026-09-29 §5): the stored gzip, inflated
 * under the same 2 MB cap as a direct fetch, then the same parser. Every failure is
 * a FeedError, so the caller falls back exactly as when CPCB itself is down.
 */
export async function readRelayFeed(store: FeedStore): Promise<FeedStation[]> {
  let gz: Uint8Array | null;
  try {
    gz = await store.getLatest();
  } catch {
    throw new FeedError('relay store unreachable'); // the store's own error may name the store: not logged
  }
  if (!gz) throw new FeedError('relay feed missing');
  let xml: string;
  try {
    xml = gunzipSync(gz, { maxOutputLength: FEED_MAX_BYTES }).toString('utf8');
  } catch (e) {
    throw new FeedError(e instanceof RangeError ? 'relay feed too large' : 'relay feed corrupt');
  }
  return parseFeed(xml);
}

/**
 * A relayed feed must be live: older than LIVE_H, it is a failure, so the card falls
 * back to OBOS's own OpenAQ reading instead of showing CPCB's value as stale (founder,
 * 2026-09-29: a dead relay hands over after a few hours, not after 7 days).
 */
export function requireLive(stations: FeedStation[], now: Date): FeedStation[] {
  const age = now.getTime() - Date.parse(stations[0]?.published_at ?? '');
  if (!(age <= LIVE_H * HOUR_MS)) throw new FeedError('relay feed not live');
  return stations;
}

const HOUR_MS = 3_600_000, DAY_MS = 86_400_000, FUTURE_SLACK_MS = 15 * 60_000;

/** Why CPCB published no AQI, from what its own fields show. Plain sentences: the card prints the first. */
function cpcbReasons(f: FeedStation): string[] {
  const has = (p: Pollutant): boolean => f.subindices.some((q) => q.parameter === p && q.avg !== null);
  const valid = f.subindices.filter((q) => q.avg !== null).length;
  const out: string[] = [];
  if (!has('pm25') && !has('pm10')) out.push('No valid PM2.5 or PM10 reading');
  if (valid < 3) out.push(`${valid} valid pollutants; CPCB needs 3`);
  return out.length ? out : ['No cause is visible'];
}

/**
 * The current state from CPCB's published values, or null when CPCB's answer
 * cannot be used (published more than 7 days ago, or stamped in the future):
 * the caller then falls back to OBOS's own calculation from OpenAQ.
 */
export function currentFromFeed(f: FeedStation, areaKey: string, st: StationEntry, now: Date): AirQualityResponse | null {
  const ageMs = now.getTime() - Date.parse(f.published_at);
  if (ageMs < -FUTURE_SLACK_MS || ageMs > STALE_DAYS * DAY_MS) return null;
  const fresh = ageMs <= LIVE_H * HOUR_MS;
  const station: AqiStation = stationPayload(st);
  const common = { schema: SCHEMA, area_id: areaKey, served_at: now.toISOString(),
    source: { owner: st.owner, via: 'CPCB', standard: 'CPCB National AQI' as const } };
  if (f.aqi === null || f.dominant === null) {
    return fresh
      ? { ...common, state: 'insufficient_data', origin: 'cpcb', station, subindices: f.subindices, reasons: cpcbReasons(f), observed_at: f.published_at }
      : { ...common, state: 'unavailable', station, last_observed_at: f.published_at, reason: 'no_valid_aqi' };
  }
  const result: CpcbResult = { origin: 'cpcb', aqi: f.aqi, category: category(f.aqi), dominant: f.dominant,
    window_h: f.dominant === 'co' || f.dominant === 'o3' ? 8 : 24, subindices: f.subindices };
  return fresh
    ? { ...common, state: 'live', station, result, observed_at: f.published_at }
    : { ...common, state: 'stale', station, result, observed_at: f.published_at, age_h: Math.floor(ageMs / HOUR_MS) };
}
