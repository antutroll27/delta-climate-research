/**
 * city-stream.ts — the page side of whole-city streaming: the ports that carry out the sheet manager's commands.
 *
 *   map camera --> executor --> manager --> commands --> THESE PORTS --> fetch, the sheet worker, the renderer, the app
 *
 * It owns the fetches (one artefact set per sheet, priority-hinted and abortable), the pre-spawned worker that parses,
 * rasterises and extrudes off the main thread, the bounded memo of what was fetched, and the three kinds of thing a sheet
 * can be on screen: the OPEN sheet (the app's own ward, full detail, heat), a grey MASSING neighbour (renderer
 * `setNeighbours`), or nothing.
 *
 * THE APP IS NOT REWRITTEN. The open sheet goes through the page's own `loadWard` (hooks.showSheet), fed from the page's
 * own per-ward caches (hooks.installBundle), so the staging, the atomic commit and the rollback are the ones every other
 * city uses. What differs is that nothing is parsed, rasterised or extruded on the main thread: the worker did it.
 *
 * ARTEFACTS TODAY. The pipeline ships one set of files per sheet and no `-lod1.bin` or `-halo.bin` yet (P2c). So a
 * neighbour's massing and a sheet's halo are DERIVED here from the neighbour's own ward JSON and surface PNG, in the worker.
 * That fetches about 0.7 MB per neighbour instead of the 50-100 KB a baked file would; the file format is the same
 * (`halo-asset.ts`), so baking later replaces the derivation and nothing else.
 */
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';
import type { NeighbourSheet, PreparedBuildings, ReliefRenderer } from '../explore/relief-contract.ts';
import type { RoadsData, WardData, WaterData } from '../heat-map-model.ts';
import { decodeSurfaceBlob, type WardSurface } from '../surface-raster.ts';
import { asTerrainField, type TerrainField } from '../terrain.ts';
import { asTreesFile, type TreesFile } from '../vegetation-layer.ts';
import { createExecutor, type ExecutorPorts, type LoadJob, type PageEvent, type SheetExecutor } from '../streaming/host-executor.ts';
import { haloAssetBytes, neighboursOf, quantiseLayers, type HaloAsset, type QuantisedLayers } from '../streaming/halo-asset.ts';
import type { NeighbourLayers } from '../streaming/halo-solve.ts';
import { gpuMB, DEFAULT_CONFIG, createSheetManager, type ManagerState, type SheetManager } from '../streaming/sheet-manager.ts';
import { AMSTERDAM_TOPOLOGY as TOPOLOGY, DIRECTIONS, type Direction } from '../streaming/sheet-topology.ts';
import type { NetworkClass } from '../streaming/sheet-budgets.ts';
import { sheetByCode, type SheetCode } from '../scope/sheets.ts';
import type { Prepared, SheetWorker } from './sheet-worker-client.ts';
import type { MassingMesh } from '../streaming/prism-mesh.ts';
import { meshBytes } from '../streaming/prism-mesh.ts';
import { CLAY } from '../explore/look.ts';

export const SHEET_M = 2_800;
/** The contact-occlusion bake the renderer wants (1024 texels, the editorial look's near radius), done in the worker. */
const AO_REQUEST = { n: 1024, nearM: CLAY.aoNearM } as const;
const DATA = '/heat-map/data/';

export interface SheetUrls { ward: string; terrain: string; water: string; roads: string; trees: string; surface: string }

/** The artefact URLs of a sheet (the flat directory, by area id). Not `scope/paths.ts`: a sheet other than E4 is not `drawable`. */
export function sheetUrls(code: SheetCode): SheetUrls {
  const id = sheetByCode(code)!.id;
  return {
    ward: `${DATA}${id}.json`, terrain: `${DATA}${id}-terrain.json`, water: `${DATA}${id}-water.json`,
    roads: `${DATA}${id}-roads.json`, trees: `${DATA}${id}-trees.json`, surface: `${DATA}${id}-surface.png`,
  };
}

/** Everything the page's own `loadWard` needs for a sheet, so it can open it from cache. */
export interface SheetBundle {
  readonly ward: WardData;
  readonly terrain: TerrainField | null;
  readonly water: WaterData;
  readonly roads: RoadsData;
  readonly trees: TreesFile | null;
  readonly surface: WardSurface;
  readonly prepared: Prepared;
}

export interface CityStreamHooks {
  tier(): ExploreDeviceTier;
  network(): NetworkClass;
  relief(): ReliefRenderer | null;
  /** The page's own surface loader for the sheet it already knows how to load (E4), or null for the others. */
  registeredSurface(code: SheetCode): Promise<WardSurface> | null;
  installBundle(code: SheetCode, bundle: SheetBundle): void;
  dropBundle(code: SheetCode): void;
  /** Open `code` as the page's ward. Resolves when it is committed; `afterCommit` runs in the same synchronous block. */
  showSheet(code: SheetCode, prepared: PreparedBuildings | null, ao: Uint8Array | null, first: boolean, afterCommit: () => void): Promise<void>;
  setHaloSupply(supply: (() => NeighbourLayers) | null): void;
  /** Solve the open sheet again (a halo arrived after an edge-rule solve). */
  resolve(): void;
  loader(code: SheetCode, phase: 'rise' | 'plate' | 'end'): void;
  failure(code: SheetCode, message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface CityStream {
  start(code: SheetCode): void;
  select(code: string): void;
  /** The map camera, from the page's own `move` / `moveend` events. */
  camera(lon: number, lat: number, gesturing: boolean, headingDeg: number | null): void;
  tierChanged(tier: ExploreDeviceTier): void;
  networkChanged(network: NetworkClass): void;
  /** The renderer exists now (or was rebuilt): send it the neighbours and the seam flags again. */
  reliefReady(): void;
  /** Dev read-out for the smoke test and the status line. */
  report(): StreamReport;
  dispose(): void;
}

export interface StreamReport {
  readonly tier: ExploreDeviceTier;
  readonly current: string | null;
  readonly displayed: string | null;
  readonly open: string | null;
  readonly modelMB: number;
  readonly ceilingMB: number;
  readonly massing: readonly string[];
  readonly massingMB: number;
  readonly haloKB: number;
  readonly resident: readonly string[];
  readonly switches: number;
  readonly workerMs: { prepare: number[]; mesh: number[]; massing: number[] };
}

/** A small insertion-ordered memo; the oldest entries go when it is full. Promises are kept, so concurrent askers share work. */
class Memo<V> {
  private readonly map = new Map<SheetCode, V>();
  constructor(private readonly max: number) {}
  get(code: SheetCode): V | undefined {
    const v = this.map.get(code);
    if (v !== undefined) { this.map.delete(code); this.map.set(code, v); }
    return v;
  }
  set(code: SheetCode, v: V): V {
    this.map.delete(code); this.map.set(code, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as SheetCode);
    return v;
  }
  delete(code: SheetCode): void { this.map.delete(code); }
  clear(): void { this.map.clear(); }
}

export function createCityStream(hooks: CityStreamHooks, worker: SheetWorker, options: { now?: () => number } = {}): CityStream {
  const now = options.now ?? ((): number => performance.now());
  const manager: SheetManager = createSheetManager(hooks.tier(), hooks.network());
  const texts = new Memo<Promise<{ ward: string; roads: string | null }>>(14);
  const surfaces = new Memo<Promise<WardSurface>>(14);
  const prepares = new Memo<Promise<Prepared>>(4);
  const bundles = new Set<SheetCode>();
  const terrains = new Map<SheetCode, TerrainField | null>();
  const rims = new Memo<QuantisedLayers>(12);
  const halos = new Map<SheetCode, HaloAsset>();
  const massingResident = new Set<SheetCode>();
  const pendingMesh = new Map<SheetCode, MassingMesh>();
  const massingBytes = new Map<SheetCode, number>();
  const timings = { prepare: [] as number[], mesh: [] as number[], massing: [] as number[] };
  let open: SheetCode | null = null;
  let switches = 0;
  let switchToken = 0;
  let disposed = false;

  // ── fetch helpers ───────────────────────────────────────────────────────────

  const get = async (url: string, job: { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<Response> => {
    const response = await fetch(url, { signal: job.signal, priority: job.priority } as RequestInit);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response;
  };
  const optional = async <T>(url: string, job: { signal?: AbortSignal; priority: 'high' | 'low' }, fallback: T, read: (r: Response) => Promise<T>): Promise<T> => {
    try { return await read(await get(url, job)); }
    catch (error) { if (job.signal?.aborted) throw error; return fallback; }
  };

  const getTexts = (code: SheetCode, job: LoadJob | { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<{ ward: string; roads: string | null }> =>
    texts.get(code) ?? texts.set(code, (async () => {
      const urls = sheetUrls(code);
      try {
        const [ward, roads] = await Promise.all([
          get(urls.ward, job).then((r) => r.text()),
          optional<string | null>(urls.roads, job, null, (r) => r.text()),
        ]);
        return { ward, roads };
      } catch (error) { texts.delete(code); throw error; }       // a failed or aborted fetch is not remembered
    })());

  const getSurface = (code: SheetCode, job: { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<WardSurface> =>
    surfaces.get(code) ?? surfaces.set(code, (async () => {
      const registered = hooks.registeredSurface(code);
      if (registered !== null) return registered;
      try {
        const blob = await (await get(sheetUrls(code).surface, job)).blob();
        const raster = await decodeSurfaceBlob(blob, code);
        if (raster === null) return { means: { fvc: 0.25, albedo: 0.2 }, surface: null };
        let veg = 0, albedo = 0;
        for (let i = 0; i < raster.veg.length; i++) { veg += raster.veg[i]!; albedo += raster.albedo[i]!; }
        /* No surface-meta row for a sheet yet (P2c), so the means are the raster's own: the invariant `assertSurfaceMatches`
           checks between a raster and its scalar holds by construction, and is not claimed as a validation. */
        return { means: { fvc: veg / raster.veg.length, albedo: albedo / raster.albedo.length }, surface: raster };
      } catch (error) { surfaces.delete(code); throw error; }
    })());

  const getPrepared = (code: SheetCode, job: { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<Prepared> =>
    prepares.get(code) ?? prepares.set(code, (async () => {
      try {
        const [t, s] = await Promise.all([getTexts(code, job), getSurface(code, job)]);
        const prepared = await worker.prepare(code, t.ward, t.roads, s.means, s.surface, undefined);
        timings.prepare.push(Math.round(prepared.ms));
        return prepared;
      } catch (error) { prepares.delete(code); throw error; }
    })());

  // ── the three levels ────────────────────────────────────────────────────────

  async function loadLod0(job: LoadJob): Promise<void> {
    const urls = sheetUrls(job.sheet);
    const [prepared, surface, t, terrain, water, trees] = await Promise.all([
      getPrepared(job.sheet, job), getSurface(job.sheet, job), getTexts(job.sheet, job),
      optional<TerrainField | null>(urls.terrain, job, null, async (r) => asTerrainField(await r.json())),
      optional<WaterData>(urls.water, job, { polys: [] }, async (r) => (await r.json()) as WaterData),
      optional<TreesFile | null>(urls.trees, job, null, async (r) => asTreesFile(await r.json())),
    ]);
    if (job.signal.aborted) throw new DOMException('aborted', 'AbortError');
    terrains.set(job.sheet, terrain);
    const ward = JSON.parse(t.ward) as WardData;
    const roads = t.roads === null ? { ways: [] } : (JSON.parse(t.roads) as RoadsData);
    hooks.installBundle(job.sheet, { ward, terrain, water, roads, trees, surface, prepared });
    bundles.add(job.sheet);
  }

  async function loadHalo(job: LoadJob): Promise<void> {
    const around: Array<[Direction, SheetCode]> = [];
    for (const dir of DIRECTIONS) { const n = TOPOLOGY.neighbour(job.sheet, dir); if (n !== null) around.push([dir, n]); }
    await Promise.all(around.map(async ([, n]) => {
      if (rims.get(n) !== undefined) return;
      const p = await getPrepared(n, job);
      rims.set(n, quantiseLayers(p.base));
    }));
    if (job.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const asset: Partial<Record<Direction, QuantisedLayers>> = {};
    for (const [dir, n] of around) { const q = rims.get(n); if (q !== undefined) asset[dir] = q; }
    halos.set(job.sheet, asset);
  }

  async function loadLod1(job: LoadJob): Promise<void> {
    if (massingResident.has(job.sheet)) return;
    const t = await getTexts(job.sheet, job);
    const { mesh, ms } = await worker.massing(job.sheet, t.ward, job.signal);
    timings.massing.push(Math.round(ms));
    pendingMesh.set(job.sheet, mesh);
    massingBytes.set(job.sheet, meshBytes(mesh));
    massingResident.add(job.sheet);
    syncNeighbours();
  }

  // ── neighbours and seams ────────────────────────────────────────────────────

  function syncNeighbours(): void {
    const relief = hooks.relief();
    if (relief?.setNeighbours === undefined || open === null) return;
    const here = TOPOLOGY.cell(open);
    const list: NeighbourSheet[] = [];
    for (const code of massingResident) {
      if (code === open) continue;
      const cell = TOPOLOGY.cell(code);
      if (Math.abs(cell.i - here.i) > 1 || Math.abs(cell.j - here.j) > 1) continue;
      const mesh = pendingMesh.get(code) ?? null;
      list.push({ key: code, offsetX: SHEET_M * (cell.i - here.i), offsetZ: SHEET_M * (cell.j - here.j), mesh });
    }
    relief.setNeighbours(list);
    for (const sheet of list) pendingMesh.delete(sheet.key as SheetCode);      // the renderer holds it now
  }

  function syncSeams(): void {
    const relief = hooks.relief();
    if (relief?.setSeamFade === undefined || open === null) return;
    const edge = (dir: Direction): number => (TOPOLOGY.neighbour(open!, dir) === null ? 1 : 0);
    relief.setSeamFade(edge('w'), edge('e'), edge('n'), edge('s'));
  }

  // ── the ports ───────────────────────────────────────────────────────────────

  const ports: ExecutorPorts = {
    now,
    schedule: (ms, fn) => { const id = window.setTimeout(fn, ms); return () => window.clearTimeout(id); },
    load: (job) => {
      switch (job.level) {
        case 'lod0': return loadLod0(job);
        case 'halo': return loadHalo(job);
        case 'lod1': return loadLod1(job);
      }
    },
    reprioritise: () => undefined,                      // fetch priority cannot change in flight; the next request takes the new one
    evict: (c) => {
      if (c.level === 'lod0') {
        bundles.delete(c.sheet); terrains.delete(c.sheet); hooks.dropBundle(c.sheet); prepares.delete(c.sheet); worker.forget(c.sheet);
      } else if (c.level === 'halo') {
        halos.delete(c.sheet);
      } else {
        massingResident.delete(c.sheet); pendingMesh.delete(c.sheet); massingBytes.delete(c.sheet); syncNeighbours();
      }
    },
    makeCurrent: (c) => {
      const token = ++switchToken;
      void (async () => {
        const t = await getTexts(c.sheet, { priority: 'high' });
        const tier = hooks.tier();
        const meshTier = tier;
        const previous = c.outgoing;
        /* The sheet being left becomes its grey massing in the SAME frame the new one appears, so there is no frame with a
           hole where the old city was. Only worth building if it is next door and not already a neighbour. */
        const wantMassing = previous !== null && previous !== c.sheet && !massingResident.has(previous)
          && Math.abs(TOPOLOGY.cell(previous).i - TOPOLOGY.cell(c.sheet).i) <= 1 && Math.abs(TOPOLOGY.cell(previous).j - TOPOLOGY.cell(c.sheet).j) <= 1;
        const first = open === null;
        const bundleTerrain = (await loadedTerrain(c.sheet));
        const [built, massed] = await Promise.all([
          worker.mesh(c.sheet, t.ward, meshTier, bundleTerrain, AO_REQUEST),
          wantMassing ? getTexts(previous!, { priority: 'high' }).then((p) => worker.massing(previous!, p.ward)) : Promise.resolve(null),
        ]);
        if (token !== switchToken || disposed) return;
        timings.mesh.push(Math.round(built.ms));
        if (massed !== null && previous !== null) {
          timings.massing.push(Math.round(massed.ms));
          pendingMesh.set(previous, massed.mesh); massingBytes.set(previous, meshBytes(massed.mesh)); massingResident.add(previous);
        }
        const asset = halos.get(c.sheet);
        hooks.setHaloSupply(asset === undefined ? null : () => neighboursOf(asset));
        await hooks.showSheet(c.sheet, built.mesh, built.ao, first, () => { open = c.sheet; switches++; syncNeighbours(); syncSeams(); });
      })().catch((error) => {
        hooks.warn(`could not open sheet ${c.sheet}`, error);
        if (token === switchToken) hooks.failure(c.sheet, error instanceof Error ? error.message : String(error));
      });
    },
    disposeMesh: () => undefined,                        // the renderer replaces its city inside setWard; there is no kept mesh (cross-fade is off)
    rebuildMesh: (c) => {
      void (async () => {
        const t = await getTexts(c.sheet, { priority: 'high' });
        const built = await worker.mesh(c.sheet, t.ward, c.tier, await loadedTerrain(c.sheet), AO_REQUEST);
        if (disposed || open !== c.sheet) return;
        await hooks.showSheet(c.sheet, built.mesh, built.ao, false, () => { syncNeighbours(); syncSeams(); });
      })().catch((error) => hooks.warn(`could not rebuild sheet ${c.sheet}`, error));
    },
    loader: (c) => hooks.loader(c.sheet, c.phase),
    solve: (c) => {
      const asset = halos.get(c.sheet);
      hooks.setHaloSupply(c.haloLoaded && asset !== undefined ? () => neighboursOf(asset) : null);
      if (c.upgrade) hooks.resolve();
    },
    failure: (c) => hooks.failure(c.sheet, `${c.level} failed after ${c.attempts} attempts`),
    refuse: (c) => hooks.warn(`refused ${c.sheet}: ${c.reason}`),
    onError: (error, command) => hooks.warn(`${command.type} failed`, error),
  };

  /** The terrain of a sheet that has been loaded (the worker needs it for ground heights); null where it has none. */
  async function loadedTerrain(code: SheetCode): Promise<TerrainField | null> {
    if (terrains.has(code)) return terrains.get(code) ?? null;
    const t = await optional<TerrainField | null>(sheetUrls(code).terrain, { priority: 'high' }, null, async (r) => asTerrainField(await r.json()));
    terrains.set(code, t);
    return t;
  }

  const executor: SheetExecutor = createExecutor(manager, ports);
  const send = (event: PageEvent): void => { if (!disposed) executor.send(event); };

  // The camera arrives at animation rate; the manager needs it about ten times a second, and always at a gesture's end.
  let lastCameraAt = 0;
  let lastCenter: { lon: number; lat: number } | null = null;

  return {
    start: (code) => send({ type: 'start', sheet: code }),
    select: (code) => send({ type: 'select', sheet: code }),
    camera(lon, lat, gesturing, headingDeg) {
      const t = now();
      if (gesturing && t - lastCameraAt < 100) return;
      lastCameraAt = t;
      let heading = headingDeg;
      if (heading === null && lastCenter !== null && TOPOLOGY.distanceM(lastCenter.lon, lastCenter.lat, lon, lat) > 5) {
        heading = (Math.atan2((lon - lastCenter.lon) * 67_977, (lat - lastCenter.lat) * 110_540) * 180) / Math.PI;
      }
      lastCenter = { lon, lat };
      send({ type: 'camera', lon, lat, gesturing, headingDeg: heading });
    },
    tierChanged: (tier) => send({ type: 'tier-changed', tier }),
    networkChanged: (network) => send({ type: 'network-changed', network }),
    reliefReady() { syncNeighbours(); syncSeams(); },
    report(): StreamReport {
      const state: ManagerState = manager.state();
      let halo = 0;
      for (const asset of halos.values()) halo += haloAssetBytes(asset);
      let massing = 0;
      for (const bytes of massingBytes.values()) massing += bytes;
      return {
        tier: state.tier, current: state.current, displayed: state.displayed, open,
        modelMB: gpuMB(DEFAULT_CONFIG, state), ceilingMB: DEFAULT_CONFIG.budgets[state.tier].gpuCeilingMB,
        massing: [...massingResident].sort(), massingMB: massing / 1e6, haloKB: halo / 1e3,
        resident: [...bundles].sort(), switches, workerMs: timings,
      };
    },
    dispose() {
      disposed = true;
      executor.dispose();
      worker.dispose();
      hooks.relief()?.setNeighbours?.([]);
      texts.clear(); surfaces.clear(); prepares.clear(); rims.clear(); halos.clear();
    },
  };
}
