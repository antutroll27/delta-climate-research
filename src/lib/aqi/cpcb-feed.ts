/**
 * CPCB'S OWN CAAQMS FEED: the station AQI as CPCB publishes it.
 *
 * `https://airquality.cpcb.gov.in/caaqms/rss_feed` is XML, one snapshot of every
 * live station. MEASURED 2026-09-27 (register AQI-R47a): its Min/Max/Avg are
 * SUB-INDICES, not concentrations; the published AQI is the largest Avg and the
 * predominant pollutant holds it. `pick` enforces that at runtime, so a change of
 * meaning upstream falls back to OBOS's own calculation instead of painting a wrong number.
 *
 * Pure except `fetchFeed`. No XML library: a strict reader for exactly
 * <Station>, <Pollutant_Index/> and <Air_Quality_Index/>; a station with any
 * value that is not a whole number, "NA" or "" is dropped (never coerced).
 * IST is the fixed +05:30 offset (obos-scope forbids naming a zone).
 */
import type { StationEntry } from './stations.ts';
import type { CpcbSubIndex, Pollutant } from './types.ts';

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
}

const PARAM: Readonly<Record<string, Pollutant>> = { 'PM2.5': 'pm25', PM10: 'pm10', NO2: 'no2', SO2: 'so2', CO: 'co', OZONE: 'o3', NH3: 'nh3' };
const ENT: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENT[e]!);

function attrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) o[m[1]!] = decode(m[2]!);
  return o;
}

/** "NA" and "" are missing; anything else must be a whole number. */
function whole(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === 'NA') return null;
  if (!/^\d+$/.test(v)) throw new FeedError(`not a whole number: ${v}`);
  return Number(v);
}

/** "27-09-2026 05:00:00" (IST) → ISO UTC. */
export function istStamp(s: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const t = m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : NaN;
  if (!Number.isFinite(t)) throw new FeedError(`bad lastupdate: ${s}`);
  return new Date(t).toISOString();
}

export function parseFeed(xml: string): FeedStation[] {
  if (!xml.includes('<AqIndex')) throw new FeedError('not a CPCB AQI feed');
  const out: FeedStation[] = [];
  for (const m of xml.matchAll(/<Station\b([^>]*)>([\s\S]*?)<\/Station>/g)) {
    try {
      const a = attrs(m[1]!), body = m[2]!;
      const lat = Number(a['latitude']), lon = Number(a['longitude']);
      if (!a['id'] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const subindices: CpcbSubIndex[] = [];
      for (const p of body.matchAll(/<Pollutant_Index\b([^>]*)\/>/g)) {
        const q = attrs(p[1]!), parameter = PARAM[q['id'] ?? ''];
        if (parameter) subindices.push({ parameter, avg: whole(q['Avg']), min: whole(q['Min']), max: whole(q['Max']), hourly: whole(q['Hourly_sub_index']) });
      }
      const aq = /<Air_Quality_Index\b([^>]*)\/>/.exec(body), aa = aq ? attrs(aq[1]!) : {};
      const aqi = whole(aa['Value']), dominant = PARAM[aa['Predominant_Parameter'] ?? ''] ?? null;
      out.push({ name: a['id'], published_at: istStamp(a['lastupdate'] ?? ''), lat, lon,
        aqi: aqi !== null && dominant ? aqi : null, dominant: aqi !== null ? dominant : null, subindices });
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

/**
 * Our station in the feed: exact name, within 100 m, and CPCB's AQI must be the
 * largest Avg held by the named pollutant (AQI-R47a). Otherwise null → fallback.
 */
export function pick(feed: readonly FeedStation[], st: StationEntry): FeedStation | null {
  const f = feed.find((s) => s.name === st.cpcb_name);
  if (!f || havM(st.lat, st.lon, f.lat, f.lon) > MATCH_M) return null;
  if (f.aqi === null) return f;
  const avgs = f.subindices.map((q) => q.avg).filter((v): v is number => v !== null);
  const max = avgs.length ? Math.max(...avgs) : -1;
  const held = f.subindices.some((q) => q.parameter === f.dominant && q.avg === max);
  return f.aqi === max && held ? f : null;
}

/** One request, 8 s, 2 MB cap, identifying User-Agent. Every failure is a FeedError (its message carries no secret). */
export async function fetchFeed(o: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<FeedStation[]> {
  const f = o.fetch ?? fetch;
  const timeout = AbortSignal.timeout(FEED_TIMEOUT_MS);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  let text: string;
  try {
    const res = await f(FEED_URL, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal });
    if (!res.ok) throw new FeedError(`CPCB feed ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > FEED_MAX_BYTES) throw new FeedError('CPCB feed too large');
    const buf = await res.arrayBuffer(); // ponytail: read then measure; streaming cap only if CPCB ever lies about length
    if (buf.byteLength > FEED_MAX_BYTES) throw new FeedError('CPCB feed too large');
    text = new TextDecoder().decode(buf);
  } catch (e) {
    if (e instanceof FeedError) throw e;
    throw new FeedError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'CPCB feed timed out' : 'CPCB feed unreachable');
  }
  return parseFeed(text);
}
