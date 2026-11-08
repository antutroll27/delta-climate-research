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
 *   - No manifest at all (the file did not load) is the same failure for every area but Canal Ring, with the reason.
 *
 * ONE HELPER FOR BOTH CALLERS: `sheetUrls(code)` in streaming-host/city-stream.ts and `streamPaths()` in heat-map-app.ts.
 * PURE: no DOM, no window, no bundler imports.
 */
import { STREAM_MANIFEST, streamedAreaPaths, type AreaPaths } from '../scope/paths.ts';

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

/** Where the page reads the manifest from: the same flat directory as the layer files. */
export const MANIFEST_URL = STREAM_MANIFEST;

/** The area that is committed and served by the page itself. */
const SAME_ORIGIN_AREA = 'canal-ring';
const FIELDS = ['ward', 'terrain', 'water', 'roads', 'trees', 'surface'] as const;

let source: StreamDataSource = { kind: 'local' };

/** Set once by `startStream` (after it has read the manifest), before the first open. Tests set it back to `local`. */
export function configureStreamData(next: StreamDataSource): void { source = next; }

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
