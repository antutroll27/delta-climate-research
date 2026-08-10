export interface NearestImage { id: string; thumbUrl: string; capturedAt: number; }
type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const GRAPH = 'https://graph.mapillary.com/images';
const FIELDS = 'id,thumb_1024_url,captured_at,geometry';
const cache = new Map<string, Promise<NearestImage | null>>();

/** Narrow one Graph `images` row to NearestImage, string-casting the id (2^53 safety). */
export function asNearest(raw: unknown): NearestImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.id == null || typeof d.thumb_1024_url !== 'string') return null;
  const capturedAt = typeof d.captured_at === 'number' ? d.captured_at : 0;
  return { id: String(d.id), thumbUrl: d.thumb_1024_url, capturedAt };
}

async function query(url: string, fetchImpl: FetchLike): Promise<NearestImage | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: unknown[] };
    const rows = Array.isArray(j.data) ? j.data : [];
    for (const r of rows) { const n = asNearest(r); if (n) return n; }
    return null;
  } catch { return null; }
}

/**
 * Nearest Mapillary image to a lon/lat. Primary: radius search (<=50 m). Fallback: a small
 * bbox (radius param is new ~2026; bbox is the long-standing path). Cached per rounded coord.
 * Returns null when there's no nearby coverage (sparse wards) — callers show "no street photo".
 */
export function nearestImage(lon: number, lat: number, token: string, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike): Promise<NearestImage | null> {
  if (!token) return Promise.resolve(null);
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const radiusUrl = `${GRAPH}?access_token=${token}&fields=${FIELDS}&lat=${lat}&lng=${lon}&radius=50&limit=1`;
  const p = query(radiusUrl, fetchImpl).then((n) => {
    if (n) return n;
    const d = 0.0006; // ~65 m half-box fallback
    const bboxUrl = `${GRAPH}?access_token=${token}&fields=${FIELDS}&bbox=${lon - d},${lat - d},${lon + d},${lat + d}&limit=1`;
    return query(bboxUrl, fetchImpl);
  });
  cache.set(key, p);
  return p;
}
