/**
 * data-source.ts — where the streaming loader reads Amsterdam's layer files from (DEV FLAG ONLY: reached by city-stream.ts and the
 * dev branch of heat-map-app.ts, so no other build contains it).
 *
 * The 31 tiled areas are 186 files (39.5 MB raw), too many to commit, so they live on Cloudflare R2 under a content-versioned prefix
 * (docs/city-data-r2.md in the city-data-r2 branch). `public/heat-map/data/ams-r2-manifest.json` names the bucket (`baseUrl`), the
 * versioned `prefix` and every file with its sha256. A file's URL is `${baseUrl}/${prefix}/${file}`.
 *
 *   - Canal Ring (E4, id `canal-ring`) stays same-origin `/heat-map/data/canal-ring*`: it is committed and is the page's own area.
 *   - A manifest whose `baseUrl` is null is the dev loop with local files: the same flat directory as before.
 *   - An area (or any one of its six files) missing from the manifest THROWS. The throw lands in the area's lod0 load, which fails
 *     into the loader's failed state with Retry; it is never a quiet 404 that leaves an empty map looking loaded.
 *   - No manifest at all (the file did not load) is the same failure for every area but Canal Ring, with the reason. It is not final: the controller
 *     calls `ensureStreamData()` before every load, which reads the manifest AGAIN while the source is `unavailable`, so a Retry can succeed (INT re-audit R4).
 *
 * PER-AREA BUNDLES ARE THE DEFAULT. `ams-r2-bundles.json` (a second, smaller manifest) names one `.obosb` object per area (streaming/area-bundle.ts), so an area
 * is ONE request instead of six. `bundleTarget(areaId)` returns its URL, or null when the loader must use the six per-file URLs above instead: the bundle
 * manifest could not be read or is malformed, the area is not in it, the source is local, or the area is Canal Ring. The two manifests are independent: a
 * broken bundle manifest never makes the per-file source `unavailable`. The loader adds the two run-time fallbacks (an unsupported format version, no crypto.subtle).
 *
 * ONE HELPER FOR BOTH CALLERS: `sheetUrls(code)` in streaming-host/city-stream.ts and `streamPaths()` in heat-map-app.ts.
 * PURE: no DOM, no window, no bundler imports.
 */
import { STREAM_BUNDLE_MANIFEST, STREAM_MANIFEST, streamedAreaPaths, type AreaPaths } from '../scope/paths.ts';

/** The part of the uploader's manifest the page reads. */
export interface R2Manifest {
  /** the public origin of the bucket, or null = serve from the local flat directory */
  readonly baseUrl: string | null;
  /** `amsterdam/<version>`: the content-versioned key prefix */
  readonly prefix: string;
  readonly files: Readonly<Record<string, unknown>>;
}

export type StreamDataSource =
  | { readonly kind: 'local' }
  | { readonly kind: 'manifest'; readonly manifest: R2Manifest }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Validate the parsed JSON of `ams-r2-manifest.json`; throws a sentence naming what is wrong. */
export function asR2Manifest(raw: unknown): R2Manifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('the data manifest is not an object');
  const o = raw as Record<string, unknown>;
  if (o.baseUrl !== null && typeof o.baseUrl !== 'string') throw new Error('the data manifest has no usable baseUrl');
  if (typeof o.prefix !== 'string' || o.prefix === '') throw new Error('the data manifest has no prefix');
  if (typeof o.files !== 'object' || o.files === null) throw new Error('the data manifest lists no files');
  return Object.freeze({ baseUrl: o.baseUrl === null ? null : o.baseUrl.replace(/\/+$/, ''), prefix: o.prefix.replace(/^\/+|\/+$/g, ''), files: o.files as Record<string, unknown> });
}

/** The part of the bundle manifest the page reads (the full one also lists every section; `trimBundleManifest` in scripts/ keeps this). */
export interface BundleManifest {
  readonly baseUrl: string;
  /** `amsterdam/<version>`: the content-versioned key prefix of the bundles */
  readonly prefix: string;
  /** area file (`ams-f4.obosb`) to its `contentHash` (null = not pinned) */
  readonly files: Readonly<Record<string, { readonly contentHash: string | null }>>;
}

export type BundleSource =
  | { readonly kind: 'manifest'; readonly manifest: BundleManifest }
  | { readonly kind: 'none'; readonly reason: string };

/** Validate the parsed JSON of `ams-r2-bundles.json`; throws a sentence naming what is wrong. */
export function asBundleManifest(raw: unknown): BundleManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('the bundle manifest is not an object');
  const o = raw as Record<string, unknown>;
  if (o.schema !== 2 || o.kind !== 'area-bundles') throw new Error('the bundle manifest is not an area-bundles manifest (schema 2)');
  if (typeof o.baseUrl !== 'string' || o.baseUrl === '') throw new Error('the bundle manifest has no baseUrl');
  if (typeof o.prefix !== 'string' || o.prefix === '') throw new Error('the bundle manifest has no prefix');
  if (typeof o.files !== 'object' || o.files === null) throw new Error('the bundle manifest lists no files');
  const files: Record<string, { readonly contentHash: string | null }> = {};
  for (const [name, entry] of Object.entries(o.files as Record<string, unknown>)) {
    const hash = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).contentHash : undefined;
    files[name] = { contentHash: typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) ? hash : null };
  }
  return Object.freeze({ baseUrl: o.baseUrl.replace(/\/+$/, ''), prefix: o.prefix.replace(/^\/+|\/+$/g, ''), files: Object.freeze(files) });
}

/** Where the page reads the manifest from: the same flat directory as the layer files. */
export const MANIFEST_URL = STREAM_MANIFEST;

/** The area that is committed and served by the page itself. */
const SAME_ORIGIN_AREA = 'canal-ring';
const FIELDS = ['ward', 'terrain', 'water', 'roads', 'trees', 'surface'] as const;

let source: StreamDataSource = { kind: 'local' };
let bundleSource: BundleSource = { kind: 'none', reason: 'not read' };

/** The page's `fetch`, passed in: this module stays free of the network (streaming-dormant.test.mjs). */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function readPerFile(fetcher: Fetcher): Promise<void> {
  try {
    const response = await fetcher(MANIFEST_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    source = { kind: 'manifest', manifest: asR2Manifest(await response.json()) };
  } catch (error) {
    source = { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function readBundles(fetcher: Fetcher): Promise<void> {
  try {
    const response = await fetcher(STREAM_BUNDLE_MANIFEST, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bundleSource = { kind: 'manifest', manifest: asBundleManifest(await response.json()) };
  } catch (error) {
    bundleSource = { kind: 'none', reason: error instanceof Error ? error.message : String(error) };      // not an error: the loader uses the six per-file URLs
  }
}

/** Read both manifests and make them the source; a read that fails makes the per-file source `unavailable` (with the reason) and the bundle source `none`. Never throws. */
export async function readStreamManifest(fetcher: Fetcher): Promise<void> {
  await Promise.all([readPerFile(fetcher), readBundles(fetcher)]);
}

let rereading: Promise<void> | null = null;
/** Called before a load: while the per-file manifest could not be read, read both again (one read at a time). A no-op once it is in hand, and for the local source.
 *  A bundle manifest that failed alone is not read again this session: the area loads from the per-file URLs, which is the fallback, not a fault. */
export function ensureStreamData(fetcher: Fetcher): Promise<void> {
  if (source.kind !== 'unavailable') return Promise.resolve();
  rereading ??= readStreamManifest(fetcher).finally(() => { rereading = null; });
  return rereading;
}

/** Set once by `startStream` (after it has read the manifest), before the first open. Tests set it back to `local`. */
export function configureStreamData(next: StreamDataSource, bundles: BundleSource = { kind: 'none', reason: 'not configured' }): void { source = next; bundleSource = bundles; }

/** Where one area's bundle is, or null = use the six per-file URLs (`streamedAreaUrls`): Canal Ring, a local source, no readable bundle manifest, or an area it does not list.
 *  `contentHash` is the manifest's pin for the bundle (the parser checks the bundle's own header against it), or null where the manifest carries none. */
export function bundleTarget(areaId: string): { readonly url: string; readonly contentHash: string | null } | null {
  if (areaId === SAME_ORIGIN_AREA || source.kind === 'local' || bundleSource.kind !== 'manifest') return null;
  if (source.kind === 'manifest' && source.manifest.baseUrl === null) return null;      // the dev loop with local files
  const { manifest } = bundleSource;
  const file = `${areaId}.obosb`;
  if (!Object.hasOwn(manifest.files, file)) return null;
  return { url: `${manifest.baseUrl}/${manifest.prefix}/${file}`, contentHash: manifest.files[file]!.contentHash };
}

/** The artefact URLs of one streamed area, by area id (`ams-f4`, `canal-ring`). */
export function streamedAreaUrls(areaId: string): AreaPaths {
  const local = streamedAreaPaths(areaId);
  if (areaId === SAME_ORIGIN_AREA || source.kind === 'local') return local;
  if (source.kind === 'unavailable') throw new Error(`The area data manifest could not be read (${source.reason}), so ${areaId} cannot be loaded.`);
  const { manifest } = source;
  if (manifest.baseUrl === null) return local;
  const out: Record<string, string> = { ...local };
  for (const field of FIELDS) {
    const file = local[field].slice(local[field].lastIndexOf('/') + 1);
    if (!Object.hasOwn(manifest.files, file)) throw new Error(`${areaId} is not in the data manifest (${file} is missing), so it cannot be loaded.`);
    out[field] = `${manifest.baseUrl}/${manifest.prefix}/${file}`;
  }
  return out as unknown as AreaPaths;
}
