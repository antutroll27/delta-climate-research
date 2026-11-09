/**
 * area-bundle.ts — reads ONE per-area bundle (`ams-f4.obosb`) into the layers the streaming loader used to get from six files.
 *
 * WHY: the Worker free plan allows 100,000 requests a day and an area was six requests (ward, roads, water, trees, terrain, surface).
 * A bundle is one. The writer is scripts/build-area-bundles.mjs, which holds the byte-level layout in its header comment; in short:
 *
 *   16-byte prelude  = magic 89 'O' 'B' 'S' 'B' 0D 0A 1A | u16 version | u16 flags | u32 headerLength        (all integers LITTLE-endian)
 *   header           = UTF-8 JSON { format, version, city, areaId, contentHash, sections: [{ name, offset, length, encoding, mediaType, sha256, size }] }
 *   zero pad to a multiple of 8, then the data region; each section sits at (data start + offset), 8-aligned in the file.
 *   `length` = stored bytes, `size` and `sha256` = the DECODED bytes. `encoding` is 'gzip' (JSON: Cloudflare does not compress octet-stream) or 'identity' (the PNG).
 *
 * EXTENSIBLE: a layer is a section name. A reader IGNORES sections it does not know (it still bounds-checks them, so a truncated file is
 * caught wherever the cut falls) and ignores header fields it does not know; the version number moves only when the container layout does.
 * A REQUIRED section that is missing is a typed error, and so is every integrity failure: each section's sha256 is checked against its
 * decoded bytes, and `contentHash` (over the whole table, including the area id) against the table as read.
 *
 * Two layers: `readBundleContainer` is generic (header, bounds, decode, verify, for the sections you name); `parseAreaBundle` is the
 * Amsterdam projection that hands back what city-stream.ts's loader parses today (ward and roads as TEXT, because the worker takes text;
 * water as WaterData; trees and terrain as the raw JSON for `asTreesFile` / `asTerrainField`; the surface as an image/png Blob).
 *
 * PURE: no DOM, no window, no network, no bundler imports. DecompressionStream, TextDecoder, Blob and crypto.subtle are platform
 * globals in every browser the page runs in (crypto.subtle needs a secure context: https or localhost) and in Node 18+, which is how the tests run it.
 */
import type { WaterData } from '../heat-map-model.ts';

export const FORMAT_VERSION = 1;
const FORMAT_NAME = 'obos-area-bundle';
const MAGIC = [0x89, 0x4f, 0x42, 0x53, 0x42, 0x0d, 0x0a, 0x1a] as const;
const PRELUDE_BYTES = 16;
const ALIGN = 8;
/** A header is about 1 KB; anything past this is a corrupt length, not a header. */
const MAX_HEADER_BYTES = 1 << 20;
/** The most one section may inflate to. The biggest Amsterdam layer is 3 MB; this stops a gzip bomb, not a real layer. */
const MAX_SECTION_BYTES = 256 << 20;

export type Encoding = 'gzip' | 'identity';

export type AreaBundleErrorCode =
  | 'bad-magic' | 'unsupported-version' | 'truncated' | 'bad-header' | 'content-hash-mismatch' | 'area-mismatch'
  | 'missing-section' | 'unsupported-encoding' | 'decode-failed' | 'size-mismatch' | 'sha-mismatch' | 'unsupported-runtime';

/** Every failure of this module. `code` is the machine-readable reason; `section` names the section when one is to blame. */
export class AreaBundleError extends Error {
  constructor(readonly code: AreaBundleErrorCode, message: string, readonly section?: string) {
    super(message);
    this.name = 'AreaBundleError';
  }
}

/** One row of the header's section table. */
export interface SectionEntry {
  readonly name: string;
  /** bytes from the start of the data region */
  readonly offset: number;
  /** stored bytes (compressed, for gzip) */
  readonly length: number;
  readonly encoding: string;
  readonly mediaType: string;
  /** hex sha256 of the decoded bytes */
  readonly sha256: string;
  /** decoded byte count */
  readonly size: number;
}

export interface BundleHeader {
  readonly formatVersion: number;
  readonly city: string;
  readonly areaId: string;
  readonly contentHash: string;
  readonly sections: readonly SectionEntry[];
}

/** The generic result: the header and the decoded, verified bytes of the sections that were asked for and present. */
export interface BundleContainer {
  readonly header: BundleHeader;
  readonly sections: ReadonlyMap<string, Uint8Array>;
  /** Names in the table that the caller did not ask for (unknown to this reader, or not wanted): skipped, not decoded. */
  readonly ignored: readonly string[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isString = (v: unknown): v is string => typeof v === 'string';

function bad(message: string): AreaBundleError { return new AreaBundleError('bad-header', message); }

function hex(bytes: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Can this runtime check a bundle? False without `crypto.subtle` (an insecure origin: a plain-http LAN preview). The loader then never downloads a bundle it could not verify. */
export function bundleRuntimeSupported(): boolean {
  return (globalThis as { crypto?: Crypto }).crypto?.subtle !== undefined;
}

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (s === undefined) throw new AreaBundleError('unsupported-runtime', 'This page cannot check data integrity here: crypto.subtle needs a secure context (https or localhost).');
  return s;
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  return hex(await subtle().digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

/** The content hash of a table, exactly as the writer computes it (see build-area-bundles.mjs). */
export async function contentHashOf(areaId: string, sections: readonly Pick<SectionEntry, 'name' | 'encoding' | 'mediaType' | 'size' | 'sha256'>[]): Promise<string> {
  const lines = [...sections].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((s) => `${s.name}\t${s.encoding}\t${s.mediaType}\t${s.size}\t${s.sha256}\n`);
  return sha256Of(new TextEncoder().encode(`${FORMAT_NAME}/${FORMAT_VERSION}\n${areaId}\n${lines.join('')}`));
}

function parseHeader(json: string, version: number): BundleHeader {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw bad('The header is not valid JSON.'); }
  if (typeof raw !== 'object' || raw === null) throw bad('The header is not an object.');
  const o = raw as Record<string, unknown>;
  if (o.format !== FORMAT_NAME) throw bad(`The header's format is ${JSON.stringify(o.format)}, not ${FORMAT_NAME}.`);
  if (!isString(o.areaId) || o.areaId === '') throw bad('The header has no areaId.');
  if (!isString(o.city)) throw bad('The header has no city.');
  if (!isString(o.contentHash) || !HEX64.test(o.contentHash)) throw bad('The header has no valid contentHash.');
  if (!Array.isArray(o.sections)) throw bad('The header has no section table.');
  const seen = new Set<string>();
  const sections: SectionEntry[] = o.sections.map((row: unknown, i): SectionEntry => {
    const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
    const { name, offset, length, encoding, mediaType, sha256, size } = r;
    if (!isString(name) || !NAME.test(name)) throw bad(`Section ${i} has no valid name.`);
    if (seen.has(name)) throw bad(`Section ${name} is listed twice.`);
    seen.add(name);
    if (!isCount(offset) || !isCount(length) || !isCount(size)) throw bad(`Section ${name} has a bad offset, length or size.`);
    if (!isString(encoding) || !isString(mediaType)) throw bad(`Section ${name} has no encoding or mediaType.`);
    if (!isString(sha256) || !HEX64.test(sha256)) throw bad(`Section ${name} has no valid sha256.`);
    return { name, offset, length, encoding, mediaType, sha256, size };
  });
  return { formatVersion: version, city: o.city, areaId: o.areaId, contentHash: o.contentHash, sections };
}

/** Inflate gzip with the platform's DecompressionStream, refusing to grow past `limit` bytes (a gzip bomb). */
async function gunzip(stored: Uint8Array, limit: number, section: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new AreaBundleError('unsupported-runtime', 'This browser cannot inflate gzip (no DecompressionStream).', section);
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // Write and read at the same time: the stream's queue is small, so awaiting the write first would stall on a large section. A corrupt
  // stream errors BOTH sides; the write side's rejection is the same fault and is handled here so it is never reported twice.
  const feed = writer.write(stored as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new AreaBundleError('size-mismatch', `Section ${section} inflates past its declared ${limit} bytes.`, section); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AreaBundleError) throw error;
    throw new AreaBundleError('decode-failed', `Section ${section} is not valid gzip.`, section);
  } finally { await feed; }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export interface ReadOptions {
  /** The area this bundle must be for; a different id is `area-mismatch` (a CDN serving the wrong file under the right name). */
  readonly expectAreaId?: string;
  /** The content hash the manifest pins for this bundle; a bundle with another one (a stale or swapped object under the right name) is `content-hash-mismatch`. null = not pinned. */
  readonly expectContentHash?: string | null;
  /** Sections that must be present; a missing one is `missing-section`. Names not in `wanted` are not decoded, but are still required to be listed. */
  readonly required?: readonly string[];
}

/**
 * Open a bundle: check the magic and version, parse and validate the header, bounds-check EVERY section, check the content hash, then
 * decode and sha256-verify the `wanted` sections (concurrently). Anything else in the table is reported in `ignored` and not touched.
 */
export async function readBundleContainer(input: ArrayBuffer | Uint8Array, wanted: readonly string[], options: ReadOptions = {}): Promise<BundleContainer> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const have = Math.min(bytes.length, MAGIC.length);
  for (let i = 0; i < have; i++) if (bytes[i] !== MAGIC[i]) throw new AreaBundleError('bad-magic', 'This is not an area bundle (wrong magic bytes).');
  if (bytes.length < PRELUDE_BYTES) throw new AreaBundleError('truncated', `The bundle is ${bytes.length} bytes, shorter than its ${PRELUDE_BYTES}-byte prelude.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== FORMAT_VERSION) throw new AreaBundleError('unsupported-version', `This bundle is format version ${version}; this reader understands ${FORMAT_VERSION}.`);
  const headerBytes = view.getUint32(12, true);
  if (headerBytes > MAX_HEADER_BYTES) throw bad(`The header claims ${headerBytes} bytes.`);
  if (PRELUDE_BYTES + headerBytes > bytes.length) throw new AreaBundleError('truncated', 'The bundle ends inside its header.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(PRELUDE_BYTES, PRELUDE_BYTES + headerBytes)); }
  catch { throw bad('The header is not valid UTF-8.'); }
  const header = parseHeader(text, version);
  const dataStart = Math.ceil((PRELUDE_BYTES + headerBytes) / ALIGN) * ALIGN;
  for (const s of header.sections) {
    if (dataStart + s.offset + s.length > bytes.length) throw new AreaBundleError('truncated', `The bundle ends inside section ${s.name}.`, s.name);
  }
  if (options.expectAreaId !== undefined && header.areaId !== options.expectAreaId) {
    throw new AreaBundleError('area-mismatch', `This bundle is for ${header.areaId}, not ${options.expectAreaId}.`);
  }
  if (await contentHashOf(header.areaId, header.sections) !== header.contentHash) {
    throw new AreaBundleError('content-hash-mismatch', 'The section table does not match the bundle\'s content hash.');
  }
  if (options.expectContentHash != null && header.contentHash !== options.expectContentHash) {
    throw new AreaBundleError('content-hash-mismatch', `The bundle for ${header.areaId} is not the one the manifest names (its content hash differs).`);
  }
  const byName = new Map(header.sections.map((s) => [s.name, s]));
  for (const name of options.required ?? []) {
    if (!byName.has(name)) throw new AreaBundleError('missing-section', `The bundle for ${header.areaId} has no ${name} section.`, name);
  }
  const want = wanted.filter((name) => byName.has(name));
  const decoded = await Promise.all(want.map(async (name): Promise<readonly [string, Uint8Array]> => {
    const s = byName.get(name)!;
    const stored = bytes.subarray(dataStart + s.offset, dataStart + s.offset + s.length);
    let data: Uint8Array;
    if (s.encoding === 'identity') data = stored;
    else if (s.encoding === 'gzip') data = await gunzip(stored, Math.min(s.size, MAX_SECTION_BYTES), name);
    else throw new AreaBundleError('unsupported-encoding', `Section ${name} uses the encoding ${JSON.stringify(s.encoding)}, which this reader cannot decode.`, name);
    if (data.length !== s.size) throw new AreaBundleError('size-mismatch', `Section ${name} decodes to ${data.length} bytes, the header says ${s.size}.`, name);
    if (await sha256Of(data) !== s.sha256) throw new AreaBundleError('sha-mismatch', `Section ${name} fails its sha256 check (corrupted in transit or on disk).`, name);
    return [name, data];
  }));
  const wantedSet = new Set(want);
  return { header, sections: new Map(decoded), ignored: header.sections.filter((s) => !wantedSet.has(s.name)).map((s) => s.name) };
}

// ── the Amsterdam projection ─────────────────────────────────────────────────

/** The sections an Amsterdam area bundle carries, named after the loader's fields. Order is the writer's. */
export const AREA_SECTION_NAMES = ['ward', 'roads', 'water', 'trees', 'terrain', 'surface'] as const;
export type AreaSectionName = typeof AREA_SECTION_NAMES[number];

/**
 * What the loader needs, in the shapes it parses today (streaming-host/city-stream.ts):
 *   ward, roads  TEXT      (the worker's `prepare` takes text and parses it itself; roads null = the old optional-file fallback)
 *   water        parsed    (`as WaterData`; null = absent, the loader uses `{ polys: [] }`)
 *   trees        raw JSON  (pass to `asTreesFile`; null = absent)
 *   terrain      raw JSON  (pass to `asTerrainField`; null = absent)
 *   surface      Blob      (image/png, for `decodeSurfaceBlob`)
 */
export interface AreaBundle {
  readonly areaId: string;
  readonly city: string;
  readonly formatVersion: number;
  readonly contentHash: string;
  readonly ward: string;
  readonly roads: string | null;
  readonly water: WaterData | null;
  readonly trees: unknown;
  readonly terrain: unknown;
  readonly surface: Blob;
  /** Section names in the bundle this reader does not know: ignored. A new layer shows up here until the loader learns it. */
  readonly unknownSections: readonly string[];
}

export interface ParseOptions extends ReadOptions {
  /** Default: ward and surface, which the loader treats as required (roads, water, trees and terrain have fallbacks today). */
  readonly required?: readonly AreaSectionName[];
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function jsonOf(data: Uint8Array | undefined, name: string): unknown {
  if (data === undefined) return null;
  try { return JSON.parse(utf8.decode(data)); }
  catch { throw new AreaBundleError('decode-failed', `Section ${name} is not valid JSON.`, name); }
}

function textOf(data: Uint8Array | undefined, name: string): string | null {
  if (data === undefined) return null;
  try { return utf8.decode(data); }
  catch { throw new AreaBundleError('decode-failed', `Section ${name} is not valid UTF-8.`, name); }
}

/** Read an area bundle's response body. Throws `AreaBundleError` (a typed `code`) on any fault; a bundle that parses is verified. */
export async function parseAreaBundle(bytes: ArrayBuffer | Uint8Array, options: ParseOptions = {}): Promise<AreaBundle> {
  const { header, sections } = await readBundleContainer(bytes, AREA_SECTION_NAMES, { ...options, required: options.required ?? ['ward', 'surface'] });
  const known = new Set<string>(AREA_SECTION_NAMES);
  const ward = textOf(sections.get('ward'), 'ward');
  const surface = sections.get('surface');
  if (ward === null) throw new AreaBundleError('missing-section', `The bundle for ${header.areaId} has no ward section.`, 'ward');
  if (surface === undefined) throw new AreaBundleError('missing-section', `The bundle for ${header.areaId} has no surface section.`, 'surface');
  return {
    areaId: header.areaId, city: header.city, formatVersion: header.formatVersion, contentHash: header.contentHash,
    ward, roads: textOf(sections.get('roads'), 'roads'),
    water: jsonOf(sections.get('water'), 'water') as WaterData | null,
    trees: jsonOf(sections.get('trees'), 'trees'),
    terrain: jsonOf(sections.get('terrain'), 'terrain'),
    surface: new Blob([surface as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    unknownSections: header.sections.filter((s) => !known.has(s.name)).map((s) => s.name),
  };
}
