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
import { assertSurfaceMatches, decodeSurfaceBlob, type SurfaceMeans, type WardSurface } from '../surface-raster.ts';
import { asTerrainField, type TerrainField } from '../terrain.ts';
import { asTreesFile, type TreesFile } from '../vegetation-layer.ts';
import { createExecutor, type ExecutorPorts, type LoadJob, type PageEvent, type SheetExecutor } from '../streaming/host-executor.ts';
import { haloAssetBytes, neighboursOf, quantiseLayers, type HaloAsset, type QuantisedLayers } from '../streaming/halo-asset.ts';
import type { NeighbourLayers } from '../streaming/halo-solve.ts';
import { gpuMB, DEFAULT_CONFIG, createSheetManager, type Level, type ManagerCommand, type ManagerState, type SheetManager } from '../streaming/sheet-manager.ts';
import type { TileStage } from '../streaming/loader-model.ts';
import { AMSTERDAM_TOPOLOGY as TOPOLOGY, DIRECTIONS, type Direction } from '../streaming/sheet-topology.ts';
import type { NetworkClass } from '../streaming/sheet-budgets.ts';
import type { AreaPaths } from '../scope/paths.ts';
import { ensureStreamData, streamedAreaUrls } from '../streaming/data-source.ts';
import { sheetByCode, type SheetCode } from '../scope/sheets.ts';
import type { Prepared, SheetWorker } from './sheet-worker-client.ts';
import type { MassingMesh } from '../streaming/prism-mesh.ts';
import { meshBytes } from '../streaming/prism-mesh.ts';
import { CLAY } from '../explore/look.ts';

export const SHEET_M = 2_800;
/** The contact-occlusion bake the renderer wants (1024 texels, the editorial look's near radius), done in the worker. */
const AO_REQUEST = { n: 1024, nearM: CLAY.aoNearM } as const;

export type SheetUrls = Pick<AreaPaths, 'ward' | 'terrain' | 'water' | 'roads' | 'trees' | 'surface'>;

/** The artefact URLs of a sheet (streaming/data-source.ts: R2 for every area but Canal Ring, which is same-origin; throws for an area the manifest lacks). */
export function sheetUrls(code: SheetCode): SheetUrls {
  return streamedAreaUrls(sheetByCode(code)!.id);
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
  /** The exporter's measured means for an area that has a surface-meta row but is not a registered page (every area but E4), or null. */
  surfaceMeans?(code: SheetCode): Promise<SurfaceMeans | null>;
  installBundle(code: SheetCode, bundle: SheetBundle): void;
  dropBundle(code: SheetCode): void;
  /** Open `code` as the page's ward. Resolves when it is committed; `afterCommit` runs in the same synchronous block.
   *  `fly` = the person chose this area (the picker, the area select, a retry of one): the camera goes there. A crossing by panning has the camera
   *  over it already. `rebuild` = `code` is the ward already on screen, given a new mesh (a tier demotion, a restored GL context): no fly, no grow.
   *  The promise may resolve LATE (the app also waits for the buildings and the first solve); `afterCommit` marks the commit itself. */
  showSheet(code: SheetCode, prepared: PreparedBuildings | null, ao: Uint8Array | null, first: boolean, afterCommit: () => void, fly?: boolean, rebuild?: boolean): Promise<void>;
  setHaloSupply(supply: (() => NeighbourLayers) | null): void;
  /** Solve the open sheet again (a halo arrived after an edge-rule solve). */
  resolve(): void;
  loader(code: SheetCode, phase: 'rise' | 'plate' | 'end'): void;
  failure(code: SheetCode, message: string): void;
  warn(message: string, error?: unknown): void;
  /** OPTIONAL page furniture (the loader view, the area picker). Every manager command the loader cares about, in order, as the manager issued it:
   *  `loader`, `failure`, `cancel`, `evict` when it is issued; `make-current` at the page's commit (so the building rise starts when the buildings do). */
  command?(command: ManagerCommand): void;
  /** Is the loader for `code` ON SCREEN now (the view's own visibility: a rise is drawn 150 ms after the manager's `rise`)? Decides whether the open is held for
   *  the loader's end. Without it the manager's phase stands in (INT re-audit R3). */
  loaderVisible?(code: SheetCode): boolean;
  /** A real stage of `code`'s load finished (the loader's progress; never invented). */
  stage?(code: SheetCode, stage: TileStage): void;
  /** What was DRAWN for `code` (its building count, its trees), once its bundle is loaded: the loader's plate and the picker print these. */
  facts?(code: SheetCode, facts: { readonly buildings: number; readonly trees?: number; readonly ward: WardData }): void;
  /** The manager's state moved (after every event it was sent). The picker redraws from it. */
  dispatched?(state: ManagerState): void;
}

export interface CityStream {
  start(code: SheetCode): void;
  /** The person chose an area (the picker, the area select). The camera follows the open. */
  select(code: string): void;
  /** The loader's Retry: load `level` of `code` again. */
  retry(code: SheetCode, level: Level): void;
  /** The fly that followed a choice has ended, or the person took the map from it: camera crossings are live again (INT audit F2). */
  flyEnded(): void;
  /** The manager's state now (the picker's). */
  managerState(): ManagerState;
  /** The map camera, from the page's own `move` / `moveend` events. */
  camera(lon: number, lat: number, gesturing: boolean, headingDeg: number | null): void;
  tierChanged(tier: ExploreDeviceTier): void;
  networkChanged(network: NetworkClass): void;
  /** The renderer exists now (or was rebuilt): send it the neighbours and the seam flags again. */
  reliefReady(): void;
  /** The WebGL context was restored: every mesh is gone. Rebuild the open sheet at the current tier and the ring, in the worker. */
  contextRestored(): void;
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
  /** Forget `code` only if it still holds `v` (a newer ask may have replaced it). */
  deleteIf(code: SheetCode, v: V): void { if (this.map.get(code) === v) this.map.delete(code); }
  clear(): void { this.map.clear(); }
}

/** One shared promise per sheet, forgotten when it REJECTS. The forgetting runs after the promise is stored: an async body that throws before its first
 *  await (a URL helper that throws, INT re-audit R4) has already settled by the time `set` runs, so a `delete` inside its own catch would find nothing. */
function memoised<V>(memo: Memo<Promise<V>>, code: SheetCode, make: () => Promise<V>): Promise<V> {
  const held = memo.get(code);
  if (held !== undefined) return held;
  const made = memo.set(code, make());
  made.catch(() => memo.deleteIf(code, made));
  return made;
}

export function createCityStream(hooks: CityStreamHooks, worker: SheetWorker, options: { now?: () => number } = {}): CityStream {
  const now = options.now ?? ((): number => performance.now());
  const inner: SheetManager = createSheetManager(hooks.tier(), hooks.network());
  /* The manager seen through a tap: the page furniture gets each command at the moment it is issued (before the ports carry it
     out) and the new state after every event. `make-current` is held back to the commit (see `makeCurrent`). */
  const manager: SheetManager = {
    ...inner,
    dispatch(event) {
      const commands = inner.dispatch(event);
      for (const c of commands) if (c.type !== 'make-current') tap(c);
      if (!disposed) { try { hooks.dispatched?.(inner.state()); } catch (error) { hooks.warn('page furniture failed', error); } }   // a throwing view must not lose this event's commands (F5)
      return commands;
    },
  };
  const tap = (c: ManagerCommand): void => { try { hooks.command?.(c); } catch (error) { hooks.warn('page furniture failed', error); } };
  const stage = (code: SheetCode, s: TileStage): void => { try { hooks.stage?.(code, s); } catch (error) { hooks.warn('page furniture failed', error); } };
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
  /** Whose halo the page's sim host is using right now (null = the edge rule), so an unchanged supply is not sent again. */
  let supplied: { sheet: SheetCode; halo: boolean } | null = null;
  const supply = (sheet: SheetCode, halo: HaloAsset | undefined): boolean => {
    const has = halo !== undefined;
    if (supplied?.sheet === sheet && supplied.halo === has) return false;
    supplied = { sheet, halo: has };
    hooks.setHaloSupply(has ? () => neighboursOf(halo) : null);
    return true;
  };
  let switches = 0;
  let switchToken = 0;
  let disposed = false;
  /** The area the person chose last, until it opens: the camera flies there, once. */
  let chosen: SheetCode | null = null;

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
    memoised(texts, code, async () => {
      const urls = sheetUrls(code);                                   // throws while the data manifest is unavailable: a rejection is not remembered (R4)
      const [ward, roads] = await Promise.all([
        get(urls.ward, job).then((r) => r.text()),
        optional<string | null>(urls.roads, job, null, (r) => r.text()),
      ]);
      return { ward, roads };
    });                                                               // a failed or aborted fetch is not remembered either

  const getSurface = (code: SheetCode, job: { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<WardSurface> =>
    memoised(surfaces, code, async () => {
      const registered = hooks.registeredSurface(code);
      if (registered !== null) return registered;
      const blob = await (await get(sheetUrls(code).surface, job)).blob();
      const raster = await decodeSurfaceBlob(blob, code);
      if (raster === null) return { means: { fvc: 0.25, albedo: 0.2 }, surface: null };
      /* THE EXPORTER'S MEANS, from the area's surface-meta row (P2c), checked against the texture exactly as a registered area's are
         (`assertSurfaceMatches`); a texture that disagrees is dropped and the area is flat at the mean, as everywhere else. A row that
         is missing (or no hook) falls back to the raster's own mean, which holds the invariant by construction and claims nothing. */
      const recorded = (await hooks.surfaceMeans?.(code)) ?? null;
      if (recorded !== null) {
        try { assertSurfaceMatches(raster, recorded.fvc, recorded.albedo, 0.01, null); }
        catch (error) { hooks.warn(`surface of ${code} disagrees with its record`, error); return { means: recorded, surface: null }; }
        return { means: recorded, surface: raster };
      }
      let veg = 0, albedo = 0;
      for (let i = 0; i < raster.veg.length; i++) { veg += raster.veg[i]!; albedo += raster.albedo[i]!; }
      return { means: { fvc: veg / raster.veg.length, albedo: albedo / raster.albedo.length }, surface: raster };
    });

  const getPrepared = (code: SheetCode, job: { signal?: AbortSignal; priority: 'high' | 'low' }): Promise<Prepared> =>
    memoised(prepares, code, async () => {
      const [t, s] = await Promise.all([getTexts(code, job), getSurface(code, job)]);
      const prepared = await worker.prepare(code, t.ward, t.roads, s.means, s.surface, undefined);
      timings.prepare.push(Math.round(prepared.ms));
      return prepared;
    });

  // ── the three levels ────────────────────────────────────────────────────────

  async function loadLod0(job: LoadJob): Promise<void> {
    const urls = sheetUrls(job.sheet);
    const done = <T>(s: TileStage) => (v: T): T => { if (!job.signal.aborted) stage(job.sheet, s); return v; };      // the loader's stages are the real ones, as each lands
    const [prepared, surface, t, terrain, water, trees] = await Promise.all([
      getPrepared(job.sheet, job).then(done('ward')), getSurface(job.sheet, job).then(done('surface')), getTexts(job.sheet, job),
      ...(() => {
        const vector = [
          optional<TerrainField | null>(urls.terrain, job, null, async (r) => asTerrainField(await r.json())),
          optional<WaterData>(urls.water, job, { polys: [] }, async (r) => (await r.json()) as WaterData),
          optional<TreesFile | null>(urls.trees, job, null, async (r) => asTreesFile(await r.json())),
        ] as const;
        void Promise.all(vector).then(done('vector'), () => undefined);
        return vector;
      })(),
    ]);
    if (job.signal.aborted) throw new DOMException('aborted', 'AbortError');
    terrains.set(job.sheet, terrain);
    const ward = JSON.parse(t.ward) as WardData;
    const roads = t.roads === null ? { ways: [] } : (JSON.parse(t.roads) as RoadsData);
    hooks.installBundle(job.sheet, { ward, terrain, water, roads, trees, surface, prepared });
    bundles.add(job.sheet);
    try { hooks.facts?.(job.sheet, { buildings: ward.count, ward, ...(trees === null ? {} : { trees: trees.trees.length }) }); } catch (error) { hooks.warn('page furniture failed', error); }
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
    stage(job.sheet, 'massing');
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

  /** Build the open sheet's mesh again in the worker at `tier` and show it through the page's own commit.
   *  A RESULT WHOSE TIER IS NO LONGER THE DEVICE'S IS DROPPED (INT re-audit R6, public audit S3): two demotions in quick succession start two rebuilds, and the
   *  slower, higher-tier one used to commit last, leaving more mesh on screen than the tier allows while the manager recorded the lower one. */
  function rebuildOpen(code: SheetCode, tier: ExploreDeviceTier): void {
    void (async () => {
      const t = await getTexts(code, { priority: 'high' });
      const built = await worker.mesh(code, t.ward, tier, await loadedTerrain(code), AO_REQUEST);
      if (disposed || open !== code || hooks.tier() !== tier) return;
      await hooks.showSheet(code, built.mesh, built.ao, false, () => { syncNeighbours(); syncSeams(); }, false, true);
    })().catch((error) => hooks.warn(`could not rebuild sheet ${code}`, error));
  }

  const ports: ExecutorPorts = {
    now,
    schedule: (ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
    load: async (job) => {
      await ensureStreamData((url, init) => fetch(url, init));                         // a manifest that could not be read at page load is read again: a Retry can work (R4)
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
        const fly = chosen === c.sheet;
        chosen = null;                                    // one fly per choice: any other open ends it
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
        /* The halo supply swaps INSIDE the page's synchronous commit, so the sim never sees one sheet's ring on another's
           ward, and a failed open leaves the old supply with the old sheet (audit S3). */
        /* THE AREA IS "OPENED" FOR THE MANAGER AT THE COMMIT when no loader was ever shown for it. The page's open also waits (up to 4 s) for the
           buildings and the first heat solve; if the manager is told only after that, its loader clock keeps running over an area that is
           already drawn and "Entering…" and the plate come up on top of it (INT audit F1). A loader that WAS shown holds until that wait
           ends, so its end is the true end. */
        let committed = false, opened = false, shownAtCommit = false;
        const finish = (): void => {
          if (opened) return;
          opened = true;
          if (token === switchToken && !disposed) executor.send({ type: 'opened', sheet: c.sheet });
        };
        /* "Shown" is what the VIEW has on screen, not the manager's phase: the manager's `rise` comes at 400 ms and the view draws it 150 ms later, and an area that
           commits inside that gap is a fast open (nothing was drawn, nothing should be held for), INT re-audit R3. */
        const loaderShown = (): boolean => {
          const l = inner.state().loader;
          if (l === null || l.sheet !== c.sheet || l.phase === 'quiet') return false;
          return hooks.loaderVisible === undefined ? true : hooks.loaderVisible(c.sheet);
        };
        const openThis = hooks.showSheet(c.sheet, built.mesh, built.ao, first, () => {
          open = c.sheet; switches++;
          supply(c.sheet, halos.get(c.sheet));
          syncNeighbours(); syncSeams();
          tap(c);                                          // the building rise is planned HERE, in the commit's own block: it starts with the buildings
          committed = true;
          shownAtCommit = loaderShown();
          if (!shownAtCommit) queueMicrotask(finish);      // after the page's own commit block has finished
        }, fly);
        try { await openThis; }
        catch (error) {
          if (!committed) throw error;                     // never drawn: the open failed
          hooks.warn(`sheet ${c.sheet} opened, but its hold failed`, error);      // drawn: a late failure (the heat-solve stage, the wait) reverts nothing (F5)
        }
        if (shownAtCommit) stage(c.sheet, 'sim');         // the first solve burst landed (or the wait ended): the plate's last real stage (nothing to tick if none was shown)
        finish();
      })().catch((error) => {
        hooks.warn(`could not open sheet ${c.sheet}`, error);
        if (token === switchToken && !disposed) { executor.send({ type: 'open-failed', sheet: c.sheet }); hooks.failure(c.sheet, error instanceof Error ? error.message : String(error)); }
      });
    },
    disposeMesh: () => undefined,                        // the renderer replaces its city inside setWard; there is no kept mesh (cross-fade is off)
    rebuildMesh: (c) => rebuildOpen(c.sheet, c.tier),
    loader: (c) => hooks.loader(c.sheet, c.phase),
    solve: (c) => {
      if (open !== c.sheet) return;                      // the page has not opened it (yet): nothing to solve, no supply to swap
      const asset = c.haloLoaded ? halos.get(c.sheet) : undefined;
      if (supply(c.sheet, asset) && c.upgrade) hooks.resolve();
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
    select(code) {
      const target = sheetByCode(code)?.code ?? null;
      chosen = target !== open ? target : null;
      send({ type: 'select', sheet: code });
    },
    retry: (code, level) => send({ type: 'retry', sheet: code, level }),
    flyEnded: () => send({ type: 'fly-ended' }),
    managerState: () => inner.state(),
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
    contextRestored() {
      if (open !== null) rebuildOpen(open, hooks.tier());
      for (const code of [...massingResident]) {                 // the grey neighbours were GPU-only too: build each again
        void getTexts(code, { priority: 'low' }).then((t) => worker.massing(code, t.ward)).then(({ mesh }) => {
          if (disposed || !massingResident.has(code)) return;
          pendingMesh.set(code, mesh); massingBytes.set(code, meshBytes(mesh)); syncNeighbours();
        }).catch((error) => hooks.warn(`could not rebuild the massing of ${code}`, error));
      }
    },
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
