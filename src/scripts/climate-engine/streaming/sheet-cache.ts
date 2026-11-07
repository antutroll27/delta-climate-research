/**
 * sheet-cache.ts — bounded, least-recently-used caches whose eviction FREES memory.
 *
 * Today's per-ward caches in heat-map-app.ts (`cache`, `terrainCache`, `surfaceCache`, ... and the renderer's
 * `modelCache`, "removed, NOT disposed") never evict. That is fine for three wards and a leak for thirty-two sheets.
 * This is the one bounded structure the streamed city uses instead, for two kinds of value:
 *
 *   · fetched sheet bytes   (ArrayBuffers waiting to be parsed; `release` drops the reference), and
 *   · resident sheet resources (parsed bundles, geometry, textures; `release` disposes the GPU buffer and nulls the typed
 *     arrays, the `releaseCpuCopyAfterUpload` pattern: three.js keeps a CPU copy of every vertex array after upload, 182 MB
 *     at Canal Ring, P0 section 3).
 *
 * An entry is evicted ONLY through `release()`, exactly once, and a failing release never stops the others: the
 * remaining entries are still freed and the failures are rethrown together. Pinned entries (the current sheet, the
 * outgoing sheet during a cross-fade) are never victims, so a cache can sit above its caps while pins hold it there; it
 * says so (`overBudget`) instead of freeing something in use. `lruVictims` is the same rule as a pure function, which is
 * what the sheet manager's state machine calls, so the manager and the real cache cannot disagree about who goes first.
 *
 * No DOM, no three.js: node tests it with plain objects.
 */

/** Something that holds memory and knows how to give it back. */
export interface Releasable {
  /** Bytes it holds, for the cache's byte cap. */
  readonly byteSize: number;
  /** Free it: dispose GPU buffers, drop typed arrays and references. Idempotent in practice, called once by the cache. */
  release(): void;
}

/** A `Releasable` built from the cleanup steps, run once however many times `release` is called. */
export function releasable(byteSize: number, ...steps: ReadonlyArray<() => void>): Releasable {
  let done = false;
  return {
    byteSize,
    release(): void {
      if (done) return;
      done = true;
      for (const step of steps) step();
    },
  };
}

export interface LruCaps {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export interface LruEntry {
  readonly key: string;
  readonly bytes: number;
  /** Larger = used more recently. */
  readonly usedSeq: number;
  readonly pinned: boolean;
}

/**
 * Which keys must go, least recently used first, until the entries fit `caps`. Pinned entries are skipped, so the result
 * may leave the cache above its caps. Does not mutate.
 */
export function lruVictims(entries: readonly LruEntry[], caps: LruCaps): string[] {
  let count = entries.length;
  let bytes = 0;
  for (const e of entries) bytes += e.bytes;
  const victims: string[] = [];
  const byAge = entries.filter((e) => !e.pinned).sort((a, b) => a.usedSeq - b.usedSeq);
  for (const e of byAge) {
    if (count <= caps.maxEntries && bytes <= caps.maxBytes) break;
    victims.push(e.key);
    count -= 1;
    bytes -= e.bytes;
  }
  return victims;
}

interface Slot<V extends Releasable> {
  value: V;
  usedSeq: number;
  pinned: boolean;
}

export class ResidencyCache<V extends Releasable> {
  private readonly slots = new Map<string, Slot<V>>();
  private seq = 0;

  constructor(private caps: LruCaps, private readonly onEvict?: (key: string, value: V) => void) {
    if (!(caps.maxEntries >= 1) || !(caps.maxBytes > 0)) throw new RangeError('A cache needs room for at least one entry.');
  }

  get size(): number { return this.slots.size; }

  get bytes(): number {
    let total = 0;
    for (const s of this.slots.values()) total += s.value.byteSize;
    return total;
  }

  /** True while pins keep the cache above its caps. */
  get overBudget(): boolean { return this.slots.size > this.caps.maxEntries || this.bytes > this.caps.maxBytes; }

  keys(): string[] { return [...this.slots.keys()]; }

  has(key: string): boolean { return this.slots.has(key); }

  /** The value, counted as a use. */
  get(key: string): V | undefined {
    const slot = this.slots.get(key);
    if (slot === undefined) return undefined;
    slot.usedSeq = ++this.seq;
    return slot.value;
  }

  /** The value, NOT counted as a use. */
  peek(key: string): V | undefined { return this.slots.get(key)?.value; }

  /**
   * Store a value as the most recent entry and evict what no longer fits. Replacing a key releases the old value.
   * Returns the evicted keys; a new value too big for the byte cap on its own is evicted at once (its key is in the list).
   */
  set(key: string, value: V, options: { readonly pinned?: boolean } = {}): string[] {
    const failures: unknown[] = [];
    const old = this.slots.get(key);
    if (old !== undefined && old.value !== value) this.free(key, old.value, failures);
    this.slots.set(key, { value, usedSeq: ++this.seq, pinned: options.pinned ?? old?.pinned ?? false });
    const evicted = this.enforce(failures);
    this.rethrow(failures);
    return evicted;
  }

  pin(key: string): void { const s = this.slots.get(key); if (s !== undefined) s.pinned = true; }

  /** Unpin, then evict anything the pin was holding above the caps. Returns the evicted keys. */
  unpin(key: string): string[] {
    const s = this.slots.get(key);
    if (s !== undefined) s.pinned = false;
    const failures: unknown[] = [];
    const evicted = this.enforce(failures);
    this.rethrow(failures);
    return evicted;
  }

  /** Change the caps (a device-tier change) and evict to fit. Returns the evicted keys. */
  resize(caps: LruCaps): string[] {
    if (!(caps.maxEntries >= 1) || !(caps.maxBytes > 0)) throw new RangeError('A cache needs room for at least one entry.');
    this.caps = caps;
    const failures: unknown[] = [];
    const evicted = this.enforce(failures);
    this.rethrow(failures);
    return evicted;
  }

  /** Free one entry, pinned or not. True if it was there. */
  delete(key: string): boolean {
    const slot = this.slots.get(key);
    if (slot === undefined) return false;
    const failures: unknown[] = [];
    this.free(key, slot.value, failures);
    this.rethrow(failures);
    return true;
  }

  /** Free everything, pinned or not (leaving the page, or a lost WebGL context). */
  clear(): void {
    const failures: unknown[] = [];
    for (const [key, slot] of [...this.slots]) this.free(key, slot.value, failures);
    this.rethrow(failures);
  }

  private enforce(failures: unknown[]): string[] {
    const entries: LruEntry[] = [];
    for (const [key, s] of this.slots) entries.push({ key, bytes: s.value.byteSize, usedSeq: s.usedSeq, pinned: s.pinned });
    const victims = lruVictims(entries, this.caps);
    for (const key of victims) this.free(key, this.slots.get(key)!.value, failures);
    return victims;
  }

  private free(key: string, value: V, failures: unknown[]): void {
    this.slots.delete(key);
    try { value.release(); } catch (error) { failures.push(error); }
    try { this.onEvict?.(key, value); } catch (error) { failures.push(error); }
  }

  private rethrow(failures: readonly unknown[]): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} cache releases failed`);
  }
}
