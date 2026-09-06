/**
 * Heat-map instrument — the integrated stage + instrument + lifecycle.
 * Ports previews/heat-map/index.html faithfully into the repo. Owns: MapLibre
 * basemap and analytical field. The optional relief renderer owns Three.js and
 * shares MapLibre's GL context; the GPU sim uses its OWN offscreen context (bridged via a
 * throttled readback), the DOM instrument, and disposal.
 *
 * Pure physics/economics live in ./heat-map-model. Sim engine in ./sim-gpu.
 * `mountHeatMap()` returns a dispose fn (call it on astro:before-swap).
 */
import maplibregl from 'maplibre-gl';
import { WARD_MAP, wardLatLon, formatLatLon, type Ward } from '../../data/wards.ts';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_PARAMS, greenReferenceContrastC, type ClimateConstants, type PvFile, type SimLayers, type SimParams } from './types';
import { detectHeatCaps } from './caps';
import { createGpuHost, createStaticHost, createWorkerHost } from './sim-host';
import type { HeatSimHost, HeatSimRequest, HeatSimSnapshot } from './sim-protocol';
import * as M from './heat-map-model';
import { ACCURACY, SPATIAL, HEIGHTS, bandLabel, unmeasuredNote, isTransitionHour, TRANSITION_RMSE_K } from './accuracy';
import { solarElevationFactor, solarDayHours } from './sky';
import { loadLayerManifest } from './provenance';
import * as U from './dc-urs';
import { applyScenario } from './dc-urs-scenario';
import type { DcUrsInputs } from './dc-urs-inputs';
import { rasterWardBase } from './ward-raster';
import { loadAreaSurface, loadCanopyRaster, type WardSurface, type CanopyRaster } from './surface-raster';
import { asTreesFile } from './vegetation-layer';
import { buildRegistry, type BuildingMeta } from './explore/building-pick';
import { selectPhase } from './phase-select';
import { asTerrainField, terrainLabel, TERRAIN_N, type TerrainField } from './terrain';
import { wardMercatorScale } from './ward-frame';
import {
  LABEL_SOURCE, LABEL_LAYER, REPLACED_ROAD_GEOMETRY, isReplacedRoadLabel,
  labelLayerSpec, EMPTY_LABELS, ensureLabelsOnTop,
} from './road-labels';
import { findCoolingSurfaces, nearestCooling, type CoolingSurfaces } from './explore/cooling-surfaces';
import { createWardSession } from './ward-session';
import { createExploreFrameScheduler } from './explore/frame-scheduler';
import { exploreRuntimeBudget, nextFrameDelayMs, type ExploreDeviceTier } from './explore/runtime-budget';
import {
  dayOfYearUtc, maplibreSky, representativeSolarHour, sunPlacement,
} from './explore/sun-lighting';
import { createCoreFieldLayer, CORE_FIELD_SOURCE } from './explore/core-field-layer';
import type { ReliefRenderer, ReliefWardBundle, ReliefVisualState } from './explore/relief-contract';
import {
  attachReliefCustomLayer, isReliefLayerAttached, shouldShowRelief,
} from './explore/relief-lifecycle';
import { addCoverage, removeCoverage, COVERAGE_SOURCE, IMAGE_LAYER_ID } from './streetview/coverage-layer';
import { nearestImage } from './streetview/nearest-image';
import { OPEN_AREA_EVENT, type OpenAreaDetail } from './shell/console-shell.ts';
import { SELECT_SYNC_EVENT } from './shell/select-field.ts';
import { isLayerId, type LayerId } from './scope/layers.ts';
import { resolve, requireCosts } from './scope/resolve.ts';
import { areaPageTitle, areaPageDescription } from './scope/page-meta.ts';
import { fmtMoney, fmtRate, currencyMark } from './money.ts';
import { areaPath, paths, cityPaths } from './scope/paths.ts';
import { areaRefusal } from './scope/reachability.ts';
import { isAreaKey, splitKey, type AreaKey } from './scope/registry.ts';
import { toLegacyWard } from './scope/legacy.ts';

// Ward set lives in src/data/wards.ts so widening beyond three is a data change,
// not a code change (dc-urs-spec.md §1).
const WARDS = WARD_MAP;

/**
 * The area this page opens on — READ FROM THE PAGE, never assumed here.
 *
 * This replaces `const INITIAL_AREA = 'in/kolkata/ballygunge'`. The constant was
 * correct while there was exactly one heat-map URL; there are now six, one per
 * registered area, and an instrument that picks its own ward would open Ballygunge
 * on all of them — under the right title, with the right coordinate in the static
 * markup, and Ballygunge's buildings underneath. Every readout on the page would
 * agree with every other one and the whole page would be wrong, which is the
 * failure shape this codebase keeps paying for.
 *
 * IT THROWS RATHER THAN FALLING BACK, and that is the point. A `?? DEFAULT_AREA`
 * here would rebuild exactly the defect above: a page whose `data-area` failed to
 * render, or rendered a slug the registry does not know, would open Kolkata and say
 * nothing. The throw is loud, lands in the page's own boot promise, and leaves the
 * server-rendered markup — the name, the coordinate, the tier — standing and
 * truthful rather than overwritten with another area's numbers.
 *
 * `isAreaKey` and not a cast: `data-area` is an untrusted string as far as this
 * module is concerned, whatever generated it.
 */
function bootArea(): AreaKey {
  const declared = document.querySelector('.stage')?.getAttribute('data-area');
  if (!isAreaKey(declared)) {
    throw new Error(
      `heat-map-app: the page declares data-area="${declared}", which is not a registered `
      + 'area key. The route states which area it is; the instrument must not guess one');
  }
  return declared;
}

/**
 * The ward-table row for an area key. ONE HELPER, because there are eight sites.
 *
 * `WARD_MAP` IS KEYED BY BARE ID and typed `Record<string, Ward>`, so
 * `WARDS[state.ward]` type-checks perfectly against a hierarchical key, returns
 * `undefined`, and the next property access throws at RUNTIME — a build that is
 * green and a page that is blank. That is the whole reason this exists rather than
 * eight open-coded `splitKey` calls: one place to be wrong, not eight.
 *
 * Typed `Ward` rather than `Ward | undefined`, exactly as the indexed access it
 * replaces was: every reachable call site sits downstream of `loadArea`'s guard
 * below, which refuses an area with no ward row before anything else can run.
 */
const wardOf = (key: AreaKey): Ward => WARDS[splitKey(key).area];

/**
 * The BARE area id — for the three places that address something OUTSIDE this app.
 *
 * The rule, applied per site: an `AreaKey` is right for anything internal (caches,
 * loaders, the scope), and the bare id is required by anything that already indexes
 * by file stem or slug — `dc-urs-inputs.json`'s `wards` object, the `/api/wards/:id`
 * route, and the `big-{id}` DOM ids the stage authors against `src/data/wards.ts`.
 *
 * FOUR IN TASK 6, THREE NOW. Compare's deep link was the fourth, and it is no
 * longer a bare-id site by coincidence of what its reader accepted: it goes through
 * `toLegacyWard`, which is a stated URL-compatibility alias rather than a slug that
 * happens to fit. The distinction matters the day a second city is selectable — the
 * three sites below still need a bare id and would break, loudly, while the deep
 * link starts emitting a full key on its own.
 */
const areaOf = (key: AreaKey): string => splitKey(key).area;

/**
 * The city's park-cooling radius and fallback air temperature, and the country's
 * warming pathway — FOLLOWING THE OPEN AREA, not pinned to one.
 *
 * Task 5 pinned this to `in/kolkata/ballygunge` and said Task 7 would make it
 * derive; Task 6 got there first, because `paths()` needs an `AreaKey` and so
 * `state.ward` had to become one here. `state.climate` is now re-resolved on every
 * area switch, so a second city's constants arrive with its geometry rather than
 * Kolkata's silently outliving the switch.
 */

/* COSTS used to be declared here, under a docblock this one replaces. It moved into
   `mountHeatMap` with the boot area it is resolved from; the explanation moved with
   it, rather than being left behind pointing at the next declaration down. */
const { SIM_N, RESET_BURST } = M;
/**
 * `dark` is OUR style now — OBOS Slate, built by scripts/build-map-style.mjs from
 * the OpenFreeMap dark style it replaces. Derived rather than authored on purpose:
 * `REPLACED_ROAD_GEOMETRY` hides basemap roads BY ID, and those ids are upstream
 * dark's. Recolouring a fork keeps every one of them, so the relief handoff keeps
 * working; a style written from scratch would have renamed them and silently
 * painted basemap streets underneath the 3D city.
 *
 * `studio` stays on upstream positron. Its layer ids differ from dark's — which is
 * exactly why the label side is matched by predicate rather than by id — and
 * giving the light environment its own derived style is separate work.
 *
 * Tiles, glyphs and sprites are still served by OpenFreeMap; the OSM/ODbL
 * attribution is unchanged and no Mapbox asset or service is involved.
 */
const STYLES = { dark: '/heat-map/styles/obos-slate.json', studio: 'https://tiles.openfreemap.org/styles/positron' };

/**
 * Basemap building layers the Three.js city REPLACES — hidden whenever relief is on.
 *
 * Roads were already handled here; buildings were not, and until now they did not
 * have to be. Upstream dark draws buildings as a flat near-black fill that simply
 * disappeared under the massing. OBOS Slate adds `building_3d`, a fill-extrusion,
 * and two 3D cities in one scene is not a subtle artefact: the basemap extrudes
 * OSM `render_height` while the relief renderer extrudes our measured heights, and
 * the two disagree, so every building would z-fight against its own twin.
 *
 * The flat `building` fill is hidden alongside it. It is invisible in practice,
 * but leaving one of the pair behind is how the next reader concludes the rule is
 * arbitrary and deletes the wrong half.
 */
const REPLACED_BUILDING_GEOMETRY = ['building', 'building_3d'] as const;

export function mountHeatMap(): () => void {
  /* The route's area, resolved once, before anything reads geometry. Everything
     below that used to name `INITIAL_AREA` names this instead. */
  const INITIAL_AREA = bootArea();
  /**
   * The boot area's whole scope, resolved once.
   *
   * THE CITY AND COUNTRY HALVES CANNOT CHANGE UNDER THIS MOUNT, which is what makes
   * one resolution honest rather than a cached guess: the tab strip is built from
   * `areaKeysInCity`, so every area reachable without a page load shares this city
   * and therefore this country. Only the AREA half moves, and the things that
   * follow the area — `state.climate`, the ward row, the artefact URLs — are
   * re-resolved per switch in `loadWard`.
   */
  const SCOPE = resolve(INITIAL_AREA);
  /**
   * The unit prices, refused ONCE here rather than defaulted deeper — see the
   * docblock above `requireCosts`. It moved inside the mount when the boot area
   * did: costs are a COUNTRY fact and every area reachable from this page's tabs
   * shares one country, so this is still resolved once per mount rather than per
   * switch. It becomes reachable — as a throw — the first time a page for a
   * country with no adopted cost basis mounts an instrument, and at that point the
   * right answer is a readout saying the cost basis is unavailable, not a zero.
   */
  const COSTS = requireCosts(SCOPE);
  const el = (id: string) => document.getElementById(id);
  // Per-layer provenance ("data receipts") panel, fetched on-demand per ward
  // (loadLayerManifest caches). null → degrade to the static credit line.
  const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  /* WHICH RENDER IS THE CURRENT ONE. It used to be called from one place, on the
     opening click, and could not overlap itself; it is now also called on a ward
     switch, and two strip clicks in quick succession start two fetches whose
     resolution order is the network's business rather than the reader's. Without
     this the SECOND ward's panel could be overwritten by the FIRST ward's manifest
     arriving late — the same wrong-ward panel this call site was added to fix,
     rebuilt out of a race. `svThumbGen` guards the building card's street photo the
     same way, for the same reason. */
  let srcGen = 0;
  const renderSources = async () => {
    const panel = el('srcPanel');
    if (!panel) return;
    const gen = ++srcGen;
    const manifest = await loadLayerManifest(state.ward);
    if (gen !== srcGen) return;
    if (!manifest) {
      panel.innerHTML = '<h4>Data receipts</h4><div class="src-row"><div class="s">Provenance manifest unavailable.</div></div>';
      return;
    }
    const rows = manifest.layers.map((layer) => {
      const meta = [layer.vintage, layer.resolution, layer.instrument].filter(Boolean).join(' · ');
      const lic = layer.licence.url
        ? `<a href="${escHtml(layer.licence.url)}" target="_blank" rel="noopener noreferrer">${escHtml(layer.licence.name)}</a>`
        : escHtml(layer.licence.name);
      return `<div class="src-row"><div class="l"><span class="nm">${escHtml(layer.label)}</span>`
        + `<span class="k ${layer.kind}">${layer.kind}</span></div>`
        + `<div class="s">${escHtml(layer.source)} · ${lic}</div>`
        + (meta ? `<div class="meta">${escHtml(meta)}</div>` : '')
        + (layer.confidence ? `<div class="meta">${escHtml(layer.confidence)}</div>` : '')
        + '</div>';
    }).join('');
    panel.innerHTML = `<h4>Data receipts · ${escHtml(manifest.ward)}</h4>${rows}`;
  };
  const mapContainer = el('mlmap');
  if (!mapContainer) return () => {};
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanup: Array<() => void> = [];

  /* ── state ── */
  interface State {
    /* AN AREA KEY, never a bare slug: it is what `paths()` and `resolve()` take,
       and typing it is what makes every loader call site compiler-checked. The
       four sites that need the bare id say so and call `areaOf`. */
    ward: AreaKey; phase: 'peak' | 'night'; path: string; iv: M.Interventions;
    /* Carried on the state so `currentParams(state)` stays one argument and the
       physics never has to be told which ward is open. See CLIMATE above. */
    climate: ClimateConstants;
    sunNow: number | null;
    /* Non-null forces the 1-in-100 air temperature in place of the observed one.
       A scenario override, not a phase — see phase-select.ts. */
    heatTairC: number | null;
    base: SimLayers | null; baselineMean: number; live: M.Ambient | null;
    spatial: M.Spatial | null; greenG: number; lastMean: Record<string, number>;
    /* Observed DC-URS inputs per ward, loaded once. null while unloaded or if the
       fetch failed — the score reports itself unavailable rather than inventing one. */
    dcurs: Record<string, DcUrsInputs> | null;
  }
  
  /* THE OPENING PATHWAY IS THE SCOPE'S, not this file's.
     `path: '2025'` was a literal here, and '2025' is a key in INDIA's table. A
     country whose adopted projection is keyed differently would have booted on a
     scenario its own table does not contain, and `pathwayDelta` — which fails
     closed, correctly — would have thrown on the first simulation rather than the
     first click. `?? ''` covers the country that has adopted no projection at all:
     an empty table answers zero to every key, so the value is never read. */
  const state: State = { ward: INITIAL_AREA, phase: 'peak', path: SCOPE.pathway.initial ?? '', iv: { trees: 0, roof: 0, parks: 0, facades: 0 }, climate: SCOPE.climate, sunNow: 0, heatTairC: null, base: null, baselineMean: 0, live: null, spatial: null, greenG: 0, lastMean: {}, dcurs: null };
  const wardSession = createWardSession();
  let appDisposed = false;
  let mode: 'relief' | 'iso' = 'relief', env: 'dark' | 'studio' = 'dark';
  /* `vegOn` and `streetOn` WERE HERE, and they are gone rather than kept in step.
     Each was a third copy of one fact — the chip's `.on` class said it, the
     renderer held it, and this variable said it again — and the layer tree would
     have made a fourth. The chip and the box are now painted from the value being
     applied, and the renderer remembers what it has been told, so there is nothing
     left for a variable to hold that is not already held somewhere that can be
     read back. */
  /* THE THERMAL FIELD'S OWN SWITCH is the exception, and it is one because the
     field has no single object to hold its state: it is drawn twice — as the
     shader overlay in relief mode and as the core canvas raster in isotherm mode —
     and both are decided in `syncRendererVisibility`/`reliefVisualState`, which
     read this rather than being pushed at. */
  let surfaceOn = true;
  /* WHETHER STREET-LEVEL COVERAGE IS ON, kept here for the same reason `surfaceOn`
     is: a basemap style swap throws the layer away and something has to know
     whether to put it back. It is written in exactly one place — `setStreetVisible`
     — so it cannot disagree with the map. */
  let streetOn = false;
  const MLY_TOKEN = (import.meta.env.PUBLIC_MAPILLARY_TOKEN as string | undefined) ?? '';

  /* ── MapLibre basemap ── */
  const map = new maplibregl.Map({
    container: mapContainer, style: STYLES.dark,
    center: [wardOf(INITIAL_AREA).lon, wardOf(INITIAL_AREA).lat], zoom: 15.3, pitch: 60, bearing: -18,
    antialias: true, attributionControl: false, pixelRatio: Math.min(devicePixelRatio, 1.75),
    /* THE DRAG HANDLER ALREADY ASKED FOR THIS AND WAS BEING IGNORED. Two hundred
       lines below, the pitch drag clamps to `Math.min(78, ...)`; MapLibre's default
       `maxPitch` is 60, so it silently clamped again and the last 18 degrees were
       unreachable. Two places disagreeing about one number, with the quieter one
       winning.

       It is also the only tilt at which the sky is ever seen. MEASURED against
       4.7.1's own sky shader: the horizon sits at `height/2 + getHorizon()` pixels,
       which at pitch 60 is 1.24 screen-heights — above the top of the frame, so
       `setSky` paints exactly zero pixels. It first appears at ~67 deg and reaches
       a fifth of the frame at 80. The DEFAULT camera is untouched at 60: every
       easeTo, flyTo and reset in this file still says 60 or 0. */
    maxPitch: 78,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  /* A distance reference. The instrument shows a 1.4 km window at a pitch that
     foreshortens it, and until now nothing on screen said how big anything was. */
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 104, unit: 'metric' }), 'bottom-left');

  /* The analytical core is intentionally Three-free. Its canvas raster remains
     available while the optional relief chunk is downloading and is the whole
     renderer on capability tier 0. */
  const coreField = createCoreFieldLayer(map, SIM_N);
  const capsReady = detectHeatCaps();
  let relief: ReliefRenderer | null = null;
  let reliefReady: Promise<void> | null = null;
  let reliefWard: ReliefWardBundle | null = null;
  let currentField: Float32Array | null = null;
  let currentWardSizeM = wardOf(INITIAL_AREA).footprintM;
  let tintMode = 1;
  let growProgress = 1;
  let registry: BuildingMeta[] = [];
  let selected: BuildingMeta | null = null;
  /* Guards the street-view thumbnail fetch in paintCard: #svThumb is a fixed
     DOM node reused across selections, so a stale nearestImage() response
     from a PREVIOUS building could otherwise overwrite the thumbnail for the
     one the visitor just picked. Each paintCard call claims the next tick;
     only the still-current tick is allowed to paint. */
  let svThumbGen = 0;

  /* One runtime admission point owns recurring visual work. MapLibre retains
     responsibility for actual draws; this only decides when a new frame is
     useful, keeping hidden tabs and active gestures out of the simulation loop. */
  let runtimeVisible = !document.hidden;
  let runtimeTier: ExploreDeviceTier = 'balanced';
  const frameScheduler = createExploreFrameScheduler((time) => runRuntimeFrame(time));
  function requestRuntimeFrame(reason: 'drag' | 'orbit' | 'grow' | 'render', delay = 0): void {
    if (appDisposed || !runtimeVisible) return;
    frameScheduler.requestAfter(reason, delay);
  }

  /* ── idle auto-orbit (pauses on any interaction, resumes after 2.5 s) ── */
  let orbit = !reduceMotion, orbitResume = 0, lastT = 0;
  const ORBIT_DEG_PER_SEC = -1.4;
  function advanceOrbit(t: number): boolean {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0; lastT = t;
    const active = Boolean(orbit && mode === 'relief' && map.isStyleLoaded());
    if (active) map.setBearing(map.getBearing() + ORBIT_DEG_PER_SEC * dt);
    return active;
  }
  function nudgeOrbit() { orbit = false; clearTimeout(orbitResume); orbitResume = window.setTimeout(() => { if (!reduceMotion && mode === 'relief') { orbit = true; requestRuntimeFrame('orbit'); } }, 2500); }

  /* ── north compass ──
     The idle orbit turns the map forever, which is pleasant to watch and
     disorienting to read: bearing drifts a full turn every ~4 minutes and
     nothing said which way you were facing. The needle answers that, and the
     click is the way out of a rotation nobody asked for — so it does NOT
     schedule the orbit to resume. The next drag re-arms it through nudgeOrbit,
     which is the point at which the reader has asked for motion again. */
  const compassEl = el('compass');
  const dialEl = el('compassDial'), nLabEl = el('compassN'), sLabEl = el('compassS');
  const sunEl = el('compassSun');
  const sunLineEl = el('sunLine'), sunTextEl = el('sunLineText'), sunNoteEl = el('sunLineNote');
  function syncCompass() {
    if (!dialEl) return;
    const b = map.getBearing();
    /* SVG transform attributes, not CSS: rotate() here takes its own origin, so
       the dial turns about the face centre and each letter turns back about its
       own anchor. The anchors are in the group's PRE-rotation coordinates, which
       is exactly where they sit before the dial moves them — so the letters end
       up at the right compass point and upright, with no trigonometry. */
    dialEl.setAttribute('transform', `rotate(${-b} 24 24)`);
    nLabEl?.setAttribute('transform', `rotate(${b} 24 6.4)`);
    sLabEl?.setAttribute('transform', `rotate(${b} 24 45.2)`);
    syncSunBearing();
  }

  /**
   * WHERE THE SUN IS — computed HERE, once, for everything that shows it.
   *
   * The compass marker, the sun line, the 3-D scene's key light and the colour of
   * the visible sky are four renderings of ONE fact, and until this existed they
   * were not: the dial read a real bearing while `relief-renderer.ts` lit the city
   * from a hard-coded `position.set(0.4, 1, 0.35)` that had never moved. A second
   * call to `sunPlacement` anywhere in this file re-opens exactly that gap, and
   * tests/unit/heat-sun-lighting.test.mjs counts them.
   */
  function currentSun() {
    const lat = wardOf(state.ward)?.lat ?? 22.55;
    const doy = dayOfYearUtc(now());
    const hour = representativeSolarHour(state.sunNow, wardSolarHour(), state.phase);
    return { hour, lat, doy, placement: sunPlacement(hour, doy, lat) };
  }

  /**
   * Put the sun on the dial, at its real bearing for the phase being shown.
   *
   * READ-ONLY, AND THAT IS THE DESIGN. The instrument is steady-state at a
   * representative phase — the freshness dial's own note says it "has no 14:32" —
   * so a draggable sun would imply a continuous time the physics does not model.
   * This reports where the sun is; it does not pretend to move it.
   *
   * The marker lives inside the rotating dial group, so it is a WORLD bearing:
   * turn the map and the sun stays over the ground it is shining on. Below the
   * horizon it is removed rather than dimmed, because a bearing for a sun that
   * has set is not a faint reading, it is a false one.
   */
  function syncSunBearing(): void {
    if (!sunEl) return;
    const sun = currentSun();
    sunEl.classList.toggle('is-below', !sun.placement.up);
    if (sun.placement.up) sunEl.setAttribute('transform', `rotate(${sun.placement.azimuthDeg} 24 24)`);
    writeSunLine(sun);
    syncSky();
  }

  /**
   * THE VISIBLE SKY, WHICH IS MAPLIBRE'S AND NOT THREE'S.
   *
   * The 3-D scene is a custom layer with no background of its own — it composites
   * over the basemap — so a three.js skybox would paint over the map tiles. The sky
   * above the horizon therefore has to come from `map.setSky`, and it is coloured
   * by the same solar elevation that aims the key light.
   *
   * THE `appliedSky` GUARD IS LOAD-BEARING, NOT AN OPTIMISATION. This is reached
   * from `syncSunBearing` <- `syncCompass` <- `placeCard`, which is bound to
   * `map.on('render')`. `setSky` writes the style and asks for a repaint, so an
   * unguarded call here would ask for a repaint from inside the repaint it was
   * called by, forever. Comparing the produced spec (not the inputs) also means a
   * palette edit still lands on the very next call.
   */
  let appliedSky = '';
  /* Whether MapLibre has fired `load`. The one thing `syncSky` is allowed to wait
     on — see the note inside it for what happens when it does not. */
  let mapHasLoaded = false;
  function syncSky(): void {
    const spec = maplibreSky(
      currentSun().placement.elevationDeg,
      (state.live?.cloud ?? 0) / 100,
      env,
    );
    const key = JSON.stringify(spec);
    if (key === appliedSky) return;

    /* NOT UNTIL THE MAP HAS FIRED `load`, AND THE try/catch HERE WAS NOT ENOUGH.

       MEASURED, and it cost an evening: calling `setSky` on a map that has not yet
       fired `load` leaves MapLibre 4.7.1 in a state where THAT EVENT NEVER FIRES.
       It does not throw — so the catch that used to sit here caught nothing and
       reported nothing. `map.once('load', …)` is what calls `loadWard`, so the
       whole instrument never started: no ward fetch, no buildings, every readout
       frozen at its server-rendered em-dash, and not one error in the console.

       The page LOOKS like it is still loading, which is why it survived review and
       a full e2e suite — eleven tests waited twenty seconds each for a reading that
       was never coming and reported it as a timeout rather than as a dead map.

       `isStyleLoaded()` IS NOT THE GATE, and that was the first fix I tried.
       `style.load` fires BEFORE `load`, so re-applying from `onStyleLoad` poisons
       it just the same. The gate has to be `load` itself.

       NOTHING IS LOST BY WAITING. `onMapLoad` calls this again, and `onStyleLoad`
       clears `appliedSky` and calls it after every style swap — so a refusal here
       is a call deferred to the first moment the map can take it, not a call
       dropped. `appliedSky` is written only when the call actually happens, or a
       refusal would mark the spec applied and the re-apply would skip it. */
    if (!mapHasLoaded) return;
    appliedSky = key;
    map.setSky(spec);
  }

  /** Local solar hours -> HH:MM, for a readout that is explicitly solar time. */
  function hhmm(h: number): string {
    const m = Math.round(((h % 24) + 24) % 24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * The line above the compass. Astronomy only, and it says so.
   *
   * WHY THE CAVEAT IS NOT OPTIONAL. A sun drawn on a heat map invites exactly one
   * inference — that the model uses it. It does not: `sun` is a single ward-wide
   * scalar (types.ts SimLayers has no shade term), and adding per-building shadow
   * was TESTED here and failed its pre-registered night placebo, p = 5.4e-07.
   * So the reading is real and the mechanism is not claimed, and both have to be
   * on screen or the honest half is the one that goes missing.
   *
   * Times are LOCAL SOLAR, not IST — the whole sky module works in solar time, and
   * relabelling them as clock time here would be a quiet 23-minute lie at Kolkata's
   * longitude.
   */
  function writeSunLine(sun: ReturnType<typeof currentSun>): void {
    if (!sunLineEl || !sunTextEl) return;
    const day = solarDayHours(sun.doy, sun.lat);
    if (!day) { sunLineEl.setAttribute('hidden', ''); return; }   // polar; never here, but honest
    sunLineEl.removeAttribute('hidden');
    /* The bearing and height are READ OFF the same placement the key light was
       aimed with, not recomputed from (hour, doy, lat) again. Identical inputs
       could not have disagreed numerically — but "the readout and the light are
       the same object" is a stronger statement than "they agree today". */
    sunTextEl.textContent = sun.placement.up
      ? `sun ${Math.round(sun.placement.azimuthDeg)}° · ${Math.round(sun.placement.elevationDeg)}° up · sets ${hhmm(day.sunset)}`
      : `sun below horizon · rises ${hhmm(day.sunrise)}`;
    sunNoteEl?.setAttribute('title',
      'Solar geometry only, in local solar time. The surface-temperature model uses a '
      + 'single ward-wide sun term, not per-building shadow: adding shade was tested over '
      + '87 ward-scenes and failed its pre-registered night placebo (p = 5.4e-07), so it is '
      + 'not in the solve.');
  }
  const onCompass = () => {
    orbit = false; clearTimeout(orbitResume);
    map.easeTo({ bearing: 0, pitch: mode === 'iso' ? 0 : 60, duration: 700 });
  };
  compassEl?.addEventListener('click', onCompass);
  cleanup.push(() => compassEl?.removeEventListener('click', onCompass));
  const cv = map.getCanvas();
  const nudgeEvents: (keyof HTMLElementEventMap)[] = ['mousedown', 'wheel', 'touchstart', 'keydown'];
  nudgeEvents.forEach(ev => cv.addEventListener(ev, nudgeOrbit, { passive: true }));

  /* ── LEFT-drag orbit / RIGHT-drag pan, frame-coalesced + inertia ── */
  map.dragRotate.disable(); map.dragPan.disable(); map.setMaxPitch(78);
  const noCtx = (e: Event) => e.preventDefault(); cv.addEventListener('contextmenu', noCtx);
  let drag: { b: number; x: number; y: number } | null = null;
  let dragAcc: { dx: number; dy: number; pan: boolean } | null = null;
  const vel = { b: 0, p: 0 };
  const onDown = (e: PointerEvent) => { if (e.button !== 0 && e.button !== 2) return; drag = { b: e.button, x: e.clientX, y: e.clientY }; vel.b = vel.p = 0; try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } nudgeOrbit(); };
  const onMove = (e: PointerEvent) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (!dragAcc) dragAcc = { dx: 0, dy: 0, pan: drag.b === 2 }; dragAcc.dx += dx; dragAcc.dy += dy; requestRuntimeFrame('drag'); };
  const onUp = () => { drag = null; requestRuntimeFrame('drag'); };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
  function advanceDrag(): boolean {
    if (dragAcc) {
      if (dragAcc.pan) map.panBy([-dragAcc.dx, -dragAcc.dy], { duration: 0 });
      else { vel.b = -dragAcc.dx * 0.4; vel.p = -dragAcc.dy * 0.35; map.jumpTo({ bearing: map.getBearing() + vel.b, pitch: Math.min(78, Math.max(0, map.getPitch() + vel.p)) }); }
      dragAcc = null;
    } else if (drag) { vel.b *= 0.5; vel.p *= 0.5; }
    else if (Math.abs(vel.b) > 0.02 || Math.abs(vel.p) > 0.02) { vel.b *= 0.88; vel.p *= 0.88; map.jumpTo({ bearing: map.getBearing() + vel.b, pitch: Math.min(78, Math.max(0, map.getPitch() + vel.p)) }); }
    return !!drag || Math.abs(vel.b) > 0.02 || Math.abs(vel.p) > 0.02;
  }

  /* ── click-to-inspect: select a building, read what is measured about it ──
     A tap and a drag start identically on this canvas (the orbit gesture owns
     pointerdown), so selection commits on pointerUP and only when the pointer
     barely moved. 6 px is the usual slop budget for "tap, not drag" and keeps a
     shaky trackpad from silently swallowing the click. */
  const bcard = el('bcard'), bsel = el('bsel');
  /* The Height row shows a metre value per building; HEIGHTS.note is the only
     place that says what was actually validated — a DISTRIBUTION along satellite
     transects, never this building. Set once: setHTML rewrites the row's
     innerHTML on every selection, which leaves the attribute intact. */
  el('bcH')?.setAttribute('title', HEIGHTS.note);
  let downAt: { x: number; y: number; t: number } | null = null;

  /* ── first-run hint ──
     Click-to-inspect is invisible until you try it. Shown once per session, and
     retired the moment the reader proves they have found it. */
  const tipEl = el('tiphint');
  const TIP_KEY = 'delta:hm-tip';
  function dismissTip() {
    if (!tipEl || tipEl.hasAttribute('hidden')) return;
    tipEl.setAttribute('hidden', '');
    try { sessionStorage.setItem(TIP_KEY, '1'); } catch { /* private mode */ }
  }
  try { if (!sessionStorage.getItem(TIP_KEY)) tipEl?.removeAttribute('hidden'); }
  catch { tipEl?.removeAttribute('hidden'); }
  el('tipX')?.addEventListener('click', dismissTip);

  /* ── hover affordance ──
     The coarse pass alone: a centroid projection per building, no polygon work.
     Throttled to ~11 fps because a cursor does not need to be frame-accurate,
     and skipped entirely mid-drag so orbiting never pays for it. */
  let hoverAt = 0;
  const onHover = (e: PointerEvent) => {
    if (drag || !relief || !registry.length || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const r = cv.getBoundingClientRect();
    const hit = relief.pick(e.clientX - r.left, e.clientY - r.top, cv.clientWidth, cv.clientHeight, 34);
    cv.style.cursor = hit >= 0 ? 'pointer' : '';
  };
  cv.addEventListener('pointermove', onHover, { passive: true });
  cleanup.push(() => { cv.removeEventListener('pointermove', onHover); cv.style.cursor = ''; });

  function cellIndexAt(cx: number, cz: number): number {
    const size = currentWardSizeM;
    const gx = Math.min(SIM_N - 1, Math.max(0, Math.floor((cx / size + 0.5) * SIM_N)));
    const gy = Math.min(SIM_N - 1, Math.max(0, Math.floor((cz / size + 0.5) * SIM_N)));
    return gy * SIM_N + gx;
  }

  function paintCard(b: BuildingMeta) {
    const i = cellIndexAt(b.cx, b.cz);
    const localC = currentField?.[i] ?? NaN;
    const veg = state.base ? state.base.veg[i] : NaN;
    const alb = state.base ? state.base.albedo[i] : NaN;
    const wardMean = state.lastMean[state.ward];

    setText('bcId', `#${b.idx}`);
    /* The building's own coordinate, recovered by inverting the transform that
       created the local frame — so this IS the Overture centroid, not a value
       re-derived from the drawn position. `cz` is the row's northward y. */
    const ll = wardLatLon(wardOf(state.ward), b.cx, b.cz);
    const svThumb = el('svThumb');
    if (svThumb && MLY_TOKEN) {
      const gen = ++svThumbGen;
      svThumb.removeAttribute('hidden');
      svThumb.innerHTML = '<span class="sv-none">Looking for a street photo…</span>';
      void nearestImage(ll.lon, ll.lat, MLY_TOKEN).then((img) => {
        if (gen !== svThumbGen) return; // a different building was selected meanwhile
        if (!img) { svThumb.innerHTML = '<span class="sv-none">No nearby street photo</span>'; return; }
        svThumb.innerHTML = '';
        const im = document.createElement('img');
        im.src = img.thumbUrl; im.alt = 'Real street view of this block (Mapillary)'; im.loading = 'lazy';
        im.addEventListener('click', () => { void openStreetView(img.id); });
        svThumb.appendChild(im);
      });
    } else if (svThumb) {
      svThumb.setAttribute('hidden', '');
    }
    setHTML('bcLL', `${formatLatLon(ll.lat, ll.lon, '<br>')}<small>centroid · WGS-84</small>`);
    /* WHO DREW THIS BUILDING. Overture conflates three sources and they are not
       equally trustworthy: OSM footprints are traced by a person against imagery,
       the other two are model output. Google publishes a confidence; the others do
       not, and -1 means "none published", never "low". */
    const prov = provCache[state.ward];
    const pk = prov?.src?.[b.idx];
    const pc = prov?.confidence?.[b.idx] ?? -1;
    /* Confidence is read from the DATA, not assumed from the source. Google
       publishes it on every row; Microsoft publishes it in Barrackpore and
       Baruipur but not in Ballygunge; OSM never does, because a hand trace has no
       model confidence to report. Hardcoding "no confidence published" against a
       source would have told 1,378 buildings that, with the number sitting right
       there in the artefact. */
    const conf = pc >= 0 ? ` · confidence ${pc.toFixed(2)}` : ' · no confidence published';
    /* PROVENANCE IS A FOOTNOTE, NOT A MEASUREMENT. Who drew the footprint and how
       well sits at the foot of the card with the other caveats, not among the
       measured rows — it describes the record, it is not a property of the
       building. One line, so the source and its confidence are never read apart. */
    const src = pk === 'osm' ? 'OpenStreetMap'
      : pk === 'google' ? 'Google Open Buildings'
      : 'Microsoft ML';
    setText('bcSrc', pk
      ? `Footprint by ${src}${pk === 'osm' ? ' · traced by hand' : ` · model${conf}`}`
      : '');
    /* 2.5 m is Google's fill value where a real height was never derived. Saying
       "2.5 m" flat would present a placeholder as a measurement. */
    setHTML('bcH', b.fill
      ? '2.5 m<small>fill value · unmeasured</small>'
      : `${b.h.toFixed(1)} m`);
    setText('bcF', b.fill ? '—' : String(Math.max(1, Math.round(b.h / 3.2))));
    setText('bcA', `${Math.round(b.areaM2).toLocaleString()} m²`);
    setHTML('bcV', Number.isFinite(veg)
      ? `${Math.round(veg * 100)}%<small>measured · 10 m</small>` : '—');
    setHTML('bcAl', Number.isFinite(alb)
      ? `${alb.toFixed(2)}<small>measured · 10 m</small>` : '—');
    setHTML('bcT', Number.isFinite(localC)
      ? `${localC.toFixed(1)} °C<small>modelled · illustrative</small>` : '—');

    /* The one honest comparison this scale supports. SPATIAL says within-ward
       pattern is not validated (r = 0.16), so the delta is offered as context,
       never as a claim about this particular roof. */
    const parts: string[] = [];
    if (Number.isFinite(localC) && Number.isFinite(wardMean)) {
      const d = localC - wardMean;
      parts.push(Math.abs(d) < 0.25
        ? 'At the ward mean'
        : `<b class="${d > 0 ? 'hot' : 'cool'}">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} K</b> vs ward mean`);
    }
    /* Say what the rings are FOR, in plain words — a circle on a map is not
       self-explanatory — and state the answer as a BAND against the rings.
       The band is the only claim this data supports: the ring radii are exact
       geometry, while the metres swing up to 5.8x on where "vegetated" is drawn
       (the sensitivity table is in cooling-surfaces.ts). So the sentence asserts
       the band, and the metres appear once, rounded and marked approximate. */
    const intro = 'The rings show how far you could walk from this building in 1 and 5 minutes.';
    if (nearestCool) {
      const d = nearestCool.distM;
      const say = (m: number) => {
        if (m < 40) return 'right beside it';
        if (m <= RINGS[0].r) return 'under a minute away';
        const mins = Math.max(1, Math.round(m / WALK_M_PER_MIN));
        return `about ${mins} minute${mins === 1 ? '' : 's'} away`;
      };
      setHTML('bcRings', `${intro} The nearest greenery is <b>${say(d)}</b>.`);
      /* Rounded to 10 m: the grid cell is 7.3 m, so a finer figure would be
         claiming precision the raster does not have. */
      const rnd = (m: number) => Math.round(m / 10) * 10;
      parts.push(`Nearest greenery ≈<b>${rnd(d)} m</b> · straight line from the building edge`);
      /* The spread across greenery definitions, stated rather than buried. It is
         usually larger than every other error in this card combined. */
      if (coolRangeM && rnd(coolRangeM[1]) - rnd(coolRangeM[0]) >= 20) {
        parts.push(`${rnd(coolRangeM[0])}–${rnd(coolRangeM[1])} m depending on how dense “green” must be`);
      }
    } else {
      setHTML('bcRings', intro);
      if (cooling) parts.push('No vegetated cooling surface of 0.77 ha or more in this ward');
    }
    parts.push('Block detail illustrative — within-ward pattern is not validated');
    setHTML('bcIns', parts.join('<br>'));
    paintSolarCard(b);
  }

  /* ── rooftop solar, per building ──
     Every figure is read from the ward's solar file by the building's index; the
     only arithmetic here is money = kWh × tariff, printed by the scope's own
     formatter so the country names the currency. The floor is the strict-mask
     cell — the mask rule is the largest lever in the estimate (spec §2.4) — and
     it prints wherever the headline does. */
  const TARIFF_KEY = 'delta:hm-tariff';
  const TARIFF_DEFAULT = 8.0;
  /* An ASSUMPTION the reader can change and the page remembers, like the clock
     format: a person's preference, not the visit's. Guarded because storage
     throws outright in some privacy modes. */
  let tariff = TARIFF_DEFAULT;
  try {
    const t = Number(localStorage.getItem(TARIFF_KEY));
    if (Number.isFinite(t) && t > 0) tariff = t;
  } catch { /* default stands */ }
  const pct = (f: number): string => (f < 0.005 ? 'none' : `−${Math.round(f * 100)}%`);
  function paintSolarCard(b: BuildingMeta) {
    const box = el('bcSol');
    if (!box) return;
    const pv = pvCache[state.ward];
    if (!pv) { box.setAttribute('hidden', ''); return; }
    const i = b.idx;
    setHTML('bcSolKwp', `${pv.kwp[i].toFixed(1)} kWp<small>${Math.round(pv.packing_factor * 100)}% of roof · floor</small>`);
    setHTML('bcSolKwh', `${Math.round(pv.kwh[i]).toLocaleString()} kWh/yr<small>${Math.round(pv.specific_yield).toLocaleString()} kWh per kWp</small>`);
    setHTML('bcSolLoss', `${pct(pv.loss[i])}<small>of which trees ${pv.loss_trees[i] < 0.005 ? 'under 1%' : `${Math.round(pv.loss_trees[i] * 100)}%`} · annual</small>`);
    setHTML('bcSolFloor', `${pct(pv.loss_strict[i])}<small>under a strict roof mask</small>`);
    setHTML('bcSolRaised', `${pct(pv.loss_raised[i])}<small>elevated mounting · what-if</small>`);
    setHTML('bcSolRs', `${fmtMoney(pv.kwh[i] * tariff, COSTS)}/yr<small>at ${fmtRate(tariff, COSTS)} per kWh · assumed</small>`);
    box.removeAttribute('hidden');
  }
  /* ── rooftop solar, whole ward ──
     The laboratory's totals and stratum, printed twice from one function: into the
     Solar pane (its home) and into the legend's folded block. The right panel no
     longer carries it — a block stacked there pushed the colour legend below the
     fold (2026-09-06). */
  function paintSolarWard() {
    const pv = pvCache[state.ward];
    const has = pv != null;
    const show = (id: string, on: boolean) => {
      const e = el(id);
      if (!e) return;
      if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', '');
    };
    /* Coming back from a ward with no screen, the block is re-seated for the pane it
       is on; a tariff keystroke repaints too, and must not touch the fold. */
    const reseat = el('solBlock')?.hasAttribute('hidden') === true && has;
    show('solPaneBlock', has);
    show('solBlock', has);
    if (!has) { setSolarOpen(false); paintSolarPane(null); return; }
    const t = pv.totals, s = pv.stratum, n = pv.kwp.length;
    for (const pre of ['sol', 'solPane'] as const) {
      setHTML(`${pre}Kwp`, `${t.capacity_mwp.toFixed(1)}<span class="u">MWp</span>`);
      setHTML(`${pre}Conf`, `Screening · <b>${t.capacity_mwp_range[0].toFixed(1)}–${t.capacity_mwp_range[1].toFixed(1)} MWp</b> · not bankable`);
      /* mean_loss is the UNWEIGHTED mean over roofs (the laboratory's "all roofs: total
         mean"); the ward's energy loses less, so the sentence says "the average roof"
         and prints the GWh for the ward. */
      setText(`${pre}Floor`, `Shading costs ${t.shading_loss_gwh_yr.toFixed(1)} GWh a year. On the average roof it takes `
        + `${(t.mean_loss * 100).toFixed(1)}% of the yield, at least ${(t.mean_loss_strict * 100).toFixed(1)}% under a strict roof mask.`);
      setHTML(`${pre}Kwh`, `${t.generation_gwh_yr.toFixed(1)}<small>GWh/yr · floor</small>`);
      setHTML(`${pre}Rs`, `${fmtMoney(t.generation_gwh_yr * 1e6 * tariff, COSTS)}<small>per yr at ${fmtRate(tariff, COSTS)} · assumed</small>`);
      setText(`${pre}BigK`, `Roofs ≥ ${s.threshold_kwp} kWp`);
      setHTML(`${pre}Big`, `${s.n.toLocaleString()}<small>${Math.round(100 * s.n / n)}% of ${n.toLocaleString()} roofs</small>`);
      setHTML(`${pre}Sh`, `${Math.round(s.share_losing_5pct * 100)}%<small>of those roofs</small>`);
    }
    paintSolarPane(pv);
    if (reseat) placeSolarBlock(true);
  }
  /* The legend's solar block: below the colour key and folded by default; on the
     Solar screen it moves above the key and unfolds (founder's call, 2026-09-06).
     The shell publishes the open pane on <html data-open-pane>; this only reads it.
     Only a CHANGE of pane acts, and a change away from Solar is the one that folds:
     the shell repaints the attribute on every rail click, and a reader who pressed
     Show must not find it folded because they opened Layers. */
  function setSolarOpen(open: boolean) {
    const body = el('solBody');
    if (!body) return;
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    el('solToggle')?.setAttribute('aria-expanded', String(open));
    setText('solToggle', open ? 'Hide ▴' : 'Show ▾');
  }
  let lastPane = document.documentElement.getAttribute('data-open-pane') ?? '';
  function placeSolarBlock(reseat = false) {
    const legend = el('legend'), block = el('solBlock');
    if (!legend || !block) return;
    const pane = document.documentElement.getAttribute('data-open-pane') ?? '';
    if (!reseat && pane === lastPane) return;
    const wasSolar = lastPane === 'solar', onSolar = pane === 'solar';
    lastPane = pane;
    /* Below the key means ABOVE the attribution line and the receipts button, not
       last: the receipts panel is anchored to the legend's bottom edge, and a block
       under the button moved that edge and put the open panel over its own button. */
    const attr = legend.querySelector(':scope > .attr');
    if (onSolar && legend.firstElementChild !== block) legend.prepend(block);
    else if (!onSolar && block.nextElementSibling !== attr) legend.insertBefore(block, attr);
    if (onSolar) setSolarOpen(true);
    else if (wasSolar || reseat) setSolarOpen(false);
  }
  const onSolToggle = () => setSolarOpen(el('solBody')?.hasAttribute('hidden') ?? false);
  el('solToggle')?.addEventListener('click', onSolToggle);
  const paneObs = new MutationObserver(() => placeSolarBlock());
  paneObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-open-pane'] });
  placeSolarBlock(true);
  cleanup.push(() => { el('solToggle')?.removeEventListener('click', onSolToggle); paneObs.disconnect(); });

  /* ── the Solar pane ──
     The ten best roofs by yield, each row a building on the map; the download is
     every roof. The CSV is built on first click and the object URL is dropped on
     the next ward load or tariff change, so a stale list can never be handed
     over under a fresh number. */
  let csvUrl: string | null = null;
  function dropCsv() { if (csvUrl) { URL.revokeObjectURL(csvUrl); csvUrl = null; } }
  function areaName(): string { return (wardOf(state.ward)?.name ?? state.ward).replace(/<[^>]+>/g, ''); }
  function paintSolarPane(pv: PvFile | null) {
    dropCsv();
    setText('solPaneArea', areaName());
    const sum = el('solPaneSum'), list = el('solList'), link = el('solCsv') as HTMLAnchorElement | null;
    if (!sum || !list || !link) return;
    if (!pv) {
      sum.textContent = `No solar screen ships for ${areaName()}. The screen needs footprints, heights and canopy, and this area ships none.`;
      list.innerHTML = '';
      link.setAttribute('hidden', '');
      return;
    }
    const t = pv.totals, s = pv.stratum, n = pv.kwp.length;
    sum.innerHTML = `<b>${t.capacity_mwp.toFixed(1)} MWp</b> installable across <b>${n.toLocaleString()}</b> real roofs, `
      + `the floor of a <b>${t.capacity_mwp_range[0].toFixed(1)}–${t.capacity_mwp_range[1].toFixed(1)} MWp</b> interval. `
      + `<b>${Math.round(s.share_losing_5pct * 100)}%</b> of the roofs that could carry ${s.threshold_kwp} kWp or more lose at least 5% of their yield to shade. `
      + `On the average roof, shading takes <b>${(t.mean_loss * 100).toFixed(1)}%</b> of the yield — <b>at least ${(t.mean_loss_strict * 100).toFixed(1)}%</b> `
      + `under a strict roof mask; trees are <b>${(t.mean_loss_trees * 100).toFixed(1)} points</b> of it. `
      + `Across the ward that is <b>${t.shading_loss_gwh_yr.toFixed(1)} GWh</b> a year.`;
    const byIdx = new Map(registry.map((b) => [b.idx, b] as const));
    const order = [...pv.kwh.keys()].sort((a, b) => pv.kwh[b] - pv.kwh[a]).slice(0, 10);
    list.innerHTML = order.map((i) => {
      const meta = byIdx.get(i);
      const area = meta ? Math.round(meta.areaM2) : 0;
      const L = pv.loss[i];
      return `<tr tabindex="0" data-idx="${i}"${area > 10_000 ? ' class="big"' : ''}>`
        + `<td class="id">#${i}</td><td>${pv.kwp[i].toFixed(0)}</td><td>${Math.round(pv.kwh[i]).toLocaleString()}</td>`
        + `<td class="sh${L < 0.005 ? ' z' : ''}">${L < 0.005 ? '—' : `−${Math.round(L * 100)}%`}</td>`
        + `<td class="a">${area.toLocaleString()}</td></tr>`;
    }).join('');
    link.removeAttribute('hidden');
    link.download = `solar-${areaOf(state.ward)}.csv`;
    link.href = '#';
  }
  function buildCsv(pv: PvFile): string {
    const w = wardOf(state.ward);
    const byIdx = new Map(registry.map((b) => [b.idx, b] as const));
    /* The receipt travels with every row: a sorted sheet keeps it. Written once
       on row 0, it survived only while the sheet stayed in this order. */
    const basis = `"${pv.basis.replace(/"/g, '""')}"`;
    const rows = ['idx,lat,lon,footprint_m2,kwp,kwh_yr,loss,loss_buildings,loss_trees,loss_strict,loss_raised,worth_per_yr,tariff_per_kwh,currency,basis'];
    for (let i = 0; i < pv.kwp.length; i += 1) {
      const b = byIdx.get(i);
      const ll = b ? wardLatLon(w, b.cx, b.cz) : null;
      rows.push([
        i, ll ? ll.lat.toFixed(5) : '', ll ? ll.lon.toFixed(5) : '', b ? Math.round(b.areaM2) : '',
        pv.kwp[i], pv.kwh[i], pv.loss[i], pv.loss_buildings[i], pv.loss_trees[i], pv.loss_strict[i], pv.loss_raised[i],
        Math.round(pv.kwh[i] * tariff), tariff.toFixed(2), COSTS.currency, basis,
      ].join(','));
    }
    return `${rows.join('\n')}\n`;
  }
  const onCsv = (e: Event) => {
    const link = e.currentTarget as HTMLAnchorElement;
    const pv = pvCache[state.ward];
    if (!pv) { e.preventDefault(); return; }
    if (!csvUrl) csvUrl = URL.createObjectURL(new Blob([buildCsv(pv)], { type: 'text/csv;charset=utf-8' }));
    link.href = csvUrl;             // the default action follows with the real URL
  };
  const onRow = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-idx]');
    if (!tr) return;
    e.preventDefault();
    const b = registry.find((x) => x.idx === Number(tr.dataset.idx));
    if (!b) return;
    select(b);
    /* The card is projected from the building, so a building outside the view is
       a card nobody sees — nine of ten rows, measured, once the reader has zoomed.
       Ease there at the current zoom, pitch and bearing; instant under reduced
       motion. */
    const ll = wardLatLon(wardOf(state.ward), b.cx, b.cz);
    map.easeTo({ center: [ll.lon, ll.lat], duration: reduceMotion ? 0 : 700, essential: true });
  };
  const tariffInput = el('solTariff') as HTMLInputElement | null;
  if (tariffInput) tariffInput.value = tariff.toFixed(2);
  setText('solCur', currencyMark(COSTS));   // the country names the currency; never typed into a template
  tariffInput?.setAttribute('aria-label', `Tariff, ${currencyMark(COSTS)} per kilowatt-hour, assumed`);
  const onTariff = () => {
    const v = Number(tariffInput?.value);
    const bad = !Number.isFinite(v) || v <= 0;
    tariffInput?.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (bad) return;          // the figures keep the last good tariff; the box says so
    tariff = v;
    try { localStorage.setItem(TARIFF_KEY, String(v)); } catch { /* preference is transient */ }
    dropCsv();
    paintSolarWard();
    if (selected) paintSolarCard(selected);
  };
  el('solCsv')?.addEventListener('click', onCsv);
  el('solList')?.addEventListener('click', onRow);
  el('solList')?.addEventListener('keydown', onRow);
  tariffInput?.addEventListener('input', onTariff);
  cleanup.push(() => {
    el('solCsv')?.removeEventListener('click', onCsv);
    el('solList')?.removeEventListener('click', onRow);
    el('solList')?.removeEventListener('keydown', onRow);
    tariffInput?.removeEventListener('input', onTariff);
    dropCsv();
  });

  /** Move the card, brackets and ring labels onto the selection, and keep the
      compass needle honest. Transform only — no layout. */
  function placeCard() {
    syncCompass();
    if (!selected || !bcard || !bsel) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    /* Park each ring's label at whichever compass point of that ring is highest
       on screen. Four projections per ring, so the label follows the bearing as
       the map orbits instead of sliding under the city. */
    /* The card is the biggest thing on the map and it always sits beside the
       selection, so "topmost on screen" walked the labels straight underneath
       it. Score candidates that clear the card first and only fall back to a
       covered one if the ring has nowhere else to put its label. */
    const cardBox = bcard.hasAttribute('hidden') ? null : bcard.getBoundingClientRect();
    const cvBox = cv.getBoundingClientRect();
    const clearsCard = (x: number, y: number) => {
      if (!cardBox) return true;
      const px = x + cvBox.left, py = y + cvBox.top;
      /* Half the chip's rendered box (104×22 now — these shrank with the
         contour-label restyle; stale margins left the 1-min label half-under
         the card). */
      return px < cardBox.left - 56 || px > cardBox.right + 56
        || py < cardBox.top - 15 || py > cardBox.bottom + 15;
    };
    /* Nearest-greenery tag rides its cooling cell. The majority of buildings
       sit within ~40 m of greenery, which parks the patch — and therefore the
       tag — right where the card is. Hiding it for the majority case would
       re-create the very complaint this tag exists to fix ("nothing on the map
       changes"), so it climbs a ladder instead: at the patch, then lifted
       above it (the dashed line still points at the true spot), and only if
       both land under the card does it hide — the card carries the same fact
       in prose, so nothing is lost. Exact rectangles, no slop margins: a
       near-miss is not a collision. */
    if (nearestCool) {
      const tag = el('coolTag');
      if (tag) {
        const q = relief?.project(nearestCool.x, 1.2, nearestCool.z, w, h) ?? { x: 0, y: 0, w: -1 };
        if (q.w <= 0) tag.style.visibility = 'hidden';
        else {
          const cvB = cv.getBoundingClientRect();
          const cardB = bcard.hasAttribute('hidden') ? null : bcard.getBoundingClientRect();
          /* .cooltag box, kept in step with the CSS: margin -16px 0 0 -73px,
             146 wide, ~41 tall. These are the chip's real dimensions — a stale
             width here silently tests a rectangle the tag no longer occupies. */
          const TAG_W = 146, TAG_H = 41, TAG_DX = 73, TAG_DY = 16;
          const fits = (y: number) => {
            if (!cardB) return true;
            const L = q.x + cvB.left - TAG_DX, T = y + cvB.top - TAG_DY;
            return L + TAG_W < cardB.left || L > cardB.right
              || T + TAG_H < cardB.top || T > cardB.bottom;
          };
          const lifted = q.y - 72;
          let tx = q.x, ty: number | null = null;
          if (fits(q.y)) ty = q.y;
          else if (lifted > 40 && fits(lifted)) ty = lifted;
          else if (cardB) {
            /* Final rung: dock to the card's top edge as a badge. At close range
               the patch lives exactly where the card does, and no offset from
               the true anchor stays honest — so stop pretending. The dashed
               line still points at the real spot; the docked tag reads as the
               dialog's own finding, and it is visible for the majority case
               instead of vanishing. Below the card if the top is offscreen. */
            tx = (cardB.left + cardB.right) / 2 - cvB.left;
            /* Sit the chip's BOTTOM ~9px clear of the card: its box runs from
               ty - TAG_DY to ty - TAG_DY + TAG_H. */
            ty = cardB.top - cvB.top - (TAG_H - TAG_DY) - 9;
            if (ty < 44) ty = cardB.bottom - cvB.top + TAG_DY + 9;
          }
          tag.style.visibility = ty === null ? 'hidden' : 'visible';
          if (ty !== null) tag.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
        }
      }
    }
    for (const { r, el: id } of RINGS) {
      const lab = el(id); if (!lab) continue;
      /* Gather every on-screen candidate, then choose in two passes: topmost
         among those clear of the card, else topmost overall. Two cheap loops
         beat one clever one nobody can read six months from now. */
      const cands: { x: number; y: number; free: boolean }[] = [];
      for (const [dx, dz] of [[0, r], [0, -r], [r, 0], [-r, 0]] as const) {
        const q = relief?.project(selected.cx + dx, 1, selected.cz + dz, w, h) ?? { x: 0, y: 0, w: -1 };
        /* The chip is taller now, so it needs more headroom before it would be
           clipped by the top edge or buried under the footer strip. */
        if (q.w <= 0 || q.y > h - 46 || q.y < 44) continue;
        cands.push({ x: q.x, y: q.y, free: clearsCard(q.x, q.y) });
      }
      const pool = cands.filter(c => c.free);
      const pick = (pool.length ? pool : cands).reduce<typeof cands[0] | null>(
        (best, c) => (!best || c.y < best.y ? c : best), null);
      const ok = !!pick, bx = pick?.x ?? 0, by = pick?.y ?? 0;
      if (!ok) { lab.setAttribute('hidden', ''); continue; }
      lab.removeAttribute('hidden');
      /* Transform only. The label text is static markup — rewriting the same
         string on every repaint was work with no output. */
      lab.style.transform = `translate3d(${Math.round(bx)}px, ${Math.round(by)}px, 0)`;
    }
    const p = relief?.project(selected.cx, selected.h, selected.cz, w, h) ?? { x: 0, y: 0, w: -1 };
    if (p.w <= 0) { bcard.style.opacity = '0'; bsel.style.opacity = '0'; return; }
    bcard.style.opacity = '1'; bsel.style.opacity = '1';
    bsel.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    /* Flip to the near side rather than let the card leave the viewport. */
    const side = p.x > w - 268 ? 'left' : 'right';
    bcard.dataset.side = side;
    const dx = side === 'right' ? p.x + 30 : p.x - 260;
    /* KEEP THE CARD ON SCREEN. The card is centred on the building's apex, and
       with the solar block it stands 730-773 px tall (measured), so an apex in the top or bottom
       third would put the Close button past the edge. Clamp the centre so the box
       stays inside the canvas with a margin, and move the leader line by the same
       amount in the other direction so it still points at the building. */
    const EDGE = 12;
    /* The card may not be taller than the canvas minus its margins — beyond that it
       scrolls (.bcard-in has overflow-y:auto) rather than hangs past the edges. The
       CSS max-height is viewport-relative, which overshoots a canvas that starts
       below the top bar; the canvas height is known here, so it is set here, and
       only when it changes. Measured 2026-09-06: with the solar block the card is
       730-773 px against a 764 px canvas. */
    const inner = bcard.querySelector<HTMLElement>('.bcard-in');
    const maxH = `${Math.max(h - 2 * EDGE, 240)}px`;
    if (inner && inner.style.maxHeight !== maxH) inner.style.maxHeight = maxH;
    // measured once with the rest of the frame's reads; the height only changes on selection or theme
    const cardH = Math.min(cardBox ? cardBox.height : bcard.offsetHeight, h - 2 * EDGE);
    const lo = Math.min(cardH / 2 + EDGE, h / 2), hi = Math.max(h - cardH / 2 - EDGE, h / 2);
    const cy = Math.min(Math.max(p.y, lo), hi);
    const shift = cy - p.y;
    bcard.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(cy)}px, 0) translateY(-50%)`;
    const lead = bcard.querySelector<HTMLElement>('.lead');
    if (lead) {
      /* The leader lives at the card's vertical middle; after a shift it would
         point `shift` px away from the apex, so it slides back — within the card,
         never past its corners. */
      const leadY = Math.min(Math.max(cardH / 2 - shift, 8), Math.max(cardH - 8, 8));
      lead.style.top = shift === 0 ? '' : `${Math.round(leadY)}px`;
    }
  }

  /* ── the tag's entrance ──
     Two things at once, both cheap: the chip scales up with a small overshoot,
     and the metres count from zero to the answer. It fires on every selection,
     which is what makes the tag legible as THE thing that changed — a static
     number in a corner is what let two fixed radii pass for a measurement.
     The scale lives on the inner node so the render loop can keep owning the
     outer transform. Count-up writes into a fixed-width, tabular-nums element,
     so twenty-odd text changes cannot reflow anything around them. */
  let coolPop: Animation | null = null;
  let coolCount = 0;
  function popCoolTag(metres: number) {
    if (!el('coolTagM')) return;
    cancelAnimationFrame(coolCount);
    /* Reduced motion gets the answer, not a performance. */
    if (reduceMotion) { setText('coolTagM', `≈${metres} m`); return; }
    /* Park the value at zero now so the pending frame never shows the previous
       building's distance under the new selection. */
    setText('coolTagM', '≈0 m');

    coolPop?.cancel();
    const inner = el('coolTagIn'), value = el('coolTagM')!;
    coolPop = inner?.animate?.([
      { transform: 'scale(.72)', opacity: 0 },
      { transform: 'scale(1.06)', opacity: 1, offset: 0.62 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.42,0,.58,1)', fill: 'both' }) ?? null;

    /* Count up on the same curve, landing a beat before the scale settles so the
       number is readable while the chip is still arriving. */
    const t0 = performance.now(), dur = 380;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      const shown = Math.round(metres * eased / 5) * 5;
      value.textContent = `≈${k >= 1 ? metres : shown} m`;
      if (k < 1) coolCount = requestAnimationFrame(step);
    };
    coolCount = requestAnimationFrame(step);
  }
  cleanup.push(() => { cancelAnimationFrame(coolCount); coolPop?.cancel(); });

  function select(b: BuildingMeta | null) {
    selected = b;
    if (b) {
      /* b.ring so the walk is measured from the building's nearest corner, not
         from a point inside it — nobody sets off from the middle of a block. */
      nearestCool = cooling ? nearestCooling(cooling, b.cx, b.cz, SIM_N, currentWardSizeM, b.ring) : null;
      const lo = coolingLo ? nearestCooling(coolingLo, b.cx, b.cz, SIM_N, currentWardSizeM, b.ring) : null;
      const hi = coolingHi ? nearestCooling(coolingHi, b.cx, b.cz, SIM_N, currentWardSizeM, b.ring) : null;
      coolRangeM = lo && hi ? [Math.min(lo.distM, hi.distM), Math.max(lo.distM, hi.distM)] : null;
      /* The tag's value is written HERE, once per selection — placeCard only
         moves it. Rounded to 10 m because the grid cell is 7.3 m. */
      if (nearestCool) {
        el('coolTag')?.removeAttribute('hidden');
        popCoolTag(Math.round(nearestCool.distM / 10) * 10 || 10);
      } else {
        el('coolTag')?.setAttribute('hidden', '');
      }
      relief?.setSelection({ building: b, nearestCooling: nearestCool });
      paintCard(b);
      bcard?.removeAttribute('hidden'); bsel?.removeAttribute('hidden');
      placeCard();
    } else {
      nearestCool = null; coolRangeM = null;
      el('coolTag')?.setAttribute('hidden', '');
      relief?.setSelection({ building: null, nearestCooling: null });
      bcard?.setAttribute('hidden', ''); bsel?.setAttribute('hidden', '');
      for (const { el: id } of RINGS) el(id)?.setAttribute('hidden', '');
    }
    map.triggerRepaint();
  }

  const onPickDown = (e: PointerEvent) => { if (e.button === 0) downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onPickUp = (e: PointerEvent) => {
    if (!downAt || e.button !== 0) { downAt = null; return; }
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6 || !relief || !registry.length) return;
    const r = cv.getBoundingClientRect();
    const hit = relief.pick(e.clientX - r.left, e.clientY - r.top, cv.clientWidth, cv.clientHeight);
    if (hit >= 0) dismissTip();
    select(hit >= 0 ? registry.find(b => b.idx === hit) ?? null : null);
  };
  cv.addEventListener('pointerdown', onPickDown);
  cv.addEventListener('pointerup', onPickUp);
  const onPickKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (selected) select(null);
    closeStreetView();
  };
  window.addEventListener('keydown', onPickKey);
  el('bcX')?.addEventListener('click', () => select(null));
  /* MapLibre fires `render` only when a repaint actually happened, so this is the
     cheapest possible hook for keeping the card glued to the building. */
  map.on('render', placeCard);
  cleanup.push(() => {
    cv.removeEventListener('pointerdown', onPickDown);
    cv.removeEventListener('pointerup', onPickUp);
    window.removeEventListener('keydown', onPickKey);
    map.off('render', placeCard);
  });

  /* ── capability-selected heat sim + field bridge (R=blur ground · G=raw buildings) ── */
  let simHost: HeatSimHost | null = null;
  let simReady: Promise<void> | null = null;
  let simGeneration = 0;
  let simAnimate = !reduceMotion;
  let latestSimRequest: HeatSimRequest | null = null;
  let latestSnapshot: HeatSimSnapshot | null = null;
  const setSimBackend = (label: string) => setText('simBackend', label);
  const makeCpuHost = (): HeatSimHost => {
    try { return createWorkerHost(); }
    catch { return createStaticHost(); }
  };
  function initSimHost(): Promise<void> {
    if (simReady) return simReady;
    simReady = capsReady.then((caps) => {
      simAnimate = caps.animate;
      runtimeTier = caps.tier === 2 ? 'full' : caps.tier === 1 ? 'balanced' : 'low';
      map.setPixelRatio(Math.min(devicePixelRatio, exploreRuntimeBudget({ visible: runtimeVisible, interacting: false, reducedMotion: reduceMotion, deviceTier: runtimeTier }).pixelRatioCap));
      mode = caps.mode === 'isotherm' ? 'iso' : mode;
      document.querySelectorAll('#modechip button').forEach((button) => {
        const buttonMode = (button as HTMLElement).dataset.m === 'iso' ? 'iso' : 'relief';
        button.classList.toggle('on', buttonMode === mode);
      });
      if (caps.tier > 0 && mode === 'relief') void ensureRelief();
      syncRendererVisibility();
      if (caps.backend === 'gpu') {
        try {
          simHost = createGpuHost(document.createElement('canvas'));
          setSimBackend('GPU SIM');
        } catch {
          simHost = makeCpuHost();
          setSimBackend(simHost.backend === 'ts-worker' ? 'CPU SIM' : 'CPU STATIC');
        }
      } else {
        simHost = makeCpuHost();
        setSimBackend(simHost.backend === 'ts-worker' ? 'CPU SIM' : 'CPU STATIC');
      }
    }).catch(() => {
      simHost = createStaticHost();
      simAnimate = false;
      setSimBackend('CPU STATIC');
    });
    return simReady;
  }
  function demoteSimHost(): boolean {
    if (!simHost || simHost.backend === 'ts-main') return false;
    const previous = simHost.backend;
    simHost.dispose();
    simHost = previous === 'gpu-webgl2' ? makeCpuHost() : createStaticHost();
    if (simHost.backend === 'ts-main') simAnimate = false;
    setSimBackend(simHost.backend === 'ts-worker' ? 'CPU SIM' : 'CPU STATIC');
    return true;
  }
  /* Colour-ramp bounds for the CURRENT forcing. Recomputed whenever the phase,
     pathway or live ambient changes, and shared by the ground overlay, the
     facades and the histogram so all three always speak the same scale.
     Ward-independent by construction — see rampBounds() in heat-map-model. */
  let ramp: [number, number] = [M.RAMP_MIN, M.RAMP_MAX];
  function bridgeField(t: Float32Array) {
    currentField = t;
    coreField.update(t, ramp[0], ramp[1]);
    relief?.updateField({ field: t, coolingMask: cooling?.mask ?? null, ramp });
    syncReliefVisual();
  }

  /* ── walk-time rings + cooling surfaces ──
     Both are SELECTION-SCOPED: they appear when a building is picked and vanish
     with it. The resting map is unchanged, and each one answers a question the
     reader has actually just asked by clicking — how far is that, and where is
     the nearest relief. */
  /* 4.8 km/h, the usual planning figure for a healthy adult on the flat. The
     ring radii are DERIVED from it rather than written as 400/800, so the
     geometry and the minutes on the label can never drift apart — and so that
     anyone revisiting the walk speed (heat slows people down; 60–70 m/min is
     the realistic figure for an older adult at 40 °C) moves both together. */
  const WALK_M_PER_MIN = 80;
  /* 1 and 5 minutes, NOT 5 and 10.
     Measured across all three wards, distance from a building to the nearest
     greenery runs: median 29–76 m, p90 122–319 m, max 527 m. So a 10-minute
     ring (800 m) could never contain information — 100% of buildings sat inside
     it — and it always ran past the 700 m study boundary, which is why it
     needed a caveat nobody should have had to read. A 5-minute ring swallowed
     96–100% on its own.
     The 1-minute ring sits at 80 m, right around the median, so roughly half
     the buildings have greenery inside it and half do not. That is the ring
     that actually tells you something about the building you clicked. */
  /* ids are radius-agnostic on purpose — they were ring5/ring10 when the radii
     were 400/800 m, and the names survived a rescale they no longer described. */
  const RINGS = [
    { min: 1, r: 1 * WALK_M_PER_MIN, el: 'ringNear' },
    { min: 5, r: 5 * WALK_M_PER_MIN, el: 'ringFar' },
  ] as const;
  /* Thresholds bracketing VEG_THRESHOLD, so the reported distance can carry the
     uncertainty from the one constant that dominates it instead of hiding it. */
  const VEG_BRACKET = [0.45, 0.55] as const;
  let cooling: CoolingSurfaces | null = null;
  let coolingLo: CoolingSurfaces | null = null;   // veg >= 0.45, the generous reading
  let coolingHi: CoolingSurfaces | null = null;   // veg >= 0.55, the strict one
  let nearestCool: { x: number; z: number; distM: number } | null = null;
  let coolRangeM: [number, number] | null = null;

  /* ── ward artefact caches shared by the analytical core and relief renderer ── */
  const cache: Record<string, M.WardData> = {}, roadsCache: Record<string, M.RoadsData> = {};
  const waterCache: Record<string, M.WaterData> = {};
  /* Render-only ground. `undefined` means unfetched, `null` means fetched-and-absent —
     the distinction stops a failed fetch retrying on every ward switch. */
  const terrainCache: Record<string, TerrainField | null> = {};
  /* Measured canopy-height texture, one per ward. Same absence idiom as terrain:
     a miss (or the not-yet-baked GLBs the trees depend on) degrades to no
     vegetation layer rather than retrying every ward switch. */
  const canopyCache: Record<string, CanopyRaster | null> = {};
  /* Street names, in lon/lat. Cached per ward like the other artefacts; absence
     is normal and draws nothing, the loader idiom water and roads already use. */
  const labelCache: Record<string, unknown> = {};
  /* Footprint provenance, row-indexed parallel to the ward's `b` array. Two thirds
     of Ballygunge is hand-traced OSM and 99 % of Baruipur is model output — a
     difference nothing on screen showed until this shipped. */
  const provCache: Record<string, { src: string[]; confidence: number[] } | null> = {};
  /* THE ROOFTOP-SOLAR SCREEN, one file per ward, fetched with the bundle and
     cached like provenance. `null` is "no screen ships here", and everything
     solar stays hidden; `undefined` is "not fetched yet". A file whose arrays
     disagree with the ward's building count is refused, because the join is by
     index with no id: a wrong-ward file would hand every roof a stranger's
     figures without a single error, and the card would print them in good faith. */
  const pvCache: Record<string, PvFile | null> = {};
  function asPvFile(raw: unknown, buildings: number, area: string): PvFile | null {
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as PvFile;
    const arrays = [f.kwp, f.kwh, f.loss, f.loss_buildings, f.loss_trees, f.loss_raised, f.loss_strict];
    /* Three refusals, all loud. The name, because the three wards happen to have
       distinct building counts today and a regenerated ward could land on a
       neighbour's; the lengths, because the join is by index; the element type,
       because the painters call number methods on these and a file of strings
       would throw in paintCard rather than here. The ward totals the panel prints
       are probed for the same reason: an empty totals object would pass a
       truthiness check and throw in paintSolarWard. */
    const ok = f.ward === area
      && arrays.every((a) => Array.isArray(a) && a.length === buildings && (a.length === 0 || typeof a[0] === 'number'))
      && typeof f.totals?.capacity_mwp === 'number' && Array.isArray(f.totals?.capacity_mwp_range)
      && typeof f.totals?.mean_loss_strict === 'number'
      && typeof f.stratum?.n === 'number' && typeof f.stratum?.share_losing_5pct === 'number';
    if (!ok) {
      console.warn(`solar screen "${String(f.ward ?? '?')}" does not match ${area} (${buildings} buildings) — ignored`);
      return null;
    }
    return f;
  }
  /* Measured Sentinel-2 surface, one per ward, fetched once. A miss is non-fatal
     and falls back to a flat field at the measured ward mean — never to
     synthesised structure. */
  const surfaceCache: Record<string, WardSurface> = {};
  let growStart = 0; const GROW_MS = 1900; let opBase = 0.5;

  function reliefVisualState(): ReliefVisualState {
    return {
      mode, environment: env, tintMode, grow: growProgress,
      /* THE SURFACE LAYER'S OFF STATE, expressed through the knob that was already
         here rather than through a second one beside it. `uOp` is the overlay
         shader's only alpha term, so zero is genuinely nothing drawn — and the
         grow animation keeps running underneath, so ticking the box back on
         restores the field at whatever opacity it should be at rather than
         replaying the entrance. */
      overlayOpacity: surfaceOn ? opBase * Math.min(1, growProgress * 1.6) : 0,
      live: state.live, phase: state.phase,
      /* The same computation the compass dial reads, handed to the renderer rather
         than recomputed there — see currentSun. It aims the key light and nothing
         else: the solve has never had a shade term and still does not. */
      sun: currentSun().placement,
    };
  }

  function syncReliefVisual(): void {
    relief?.setVisualState(reliefVisualState());
  }

  function reliefIsAttached(): boolean {
    return !!(relief && isReliefLayerAttached(map, relief.layer.id));
  }

  function attachReliefLayer(): boolean {
    if (!relief) return false;
    const attached = attachReliefCustomLayer(map, relief.layer);
    /* The 3D layer paints above whatever was already in the layer stack, so
       every time it attaches the road-name labels must be re-lifted back to
       the top — otherwise the first-load race (labels added during
       style.load, relief added later once the async three.js import
       resolves) leaves street names painted UNDER the 3D roads/buildings. */
    if (attached) ensureLabelsOnTop(map);
    return attached;
  }

  function syncRendererVisibility(): void {
    const showRelief = shouldShowRelief(reliefIsAttached());
    /* Two conditions, and they answer different questions: `showRelief` decides
       WHICH renderer draws the thermal field, `surfaceOn` decides WHETHER it is
       drawn at all. Folding them together — hiding the core field whenever the
       layer is off and forgetting the mode — would leave the 2-D raster painted
       under the 3-D scene in relief mode. */
    coreField.setVisible(!showRelief && surfaceOn);
    if (relief && map.getLayer(relief.layer.id)) {
      map.setLayoutProperty(relief.layer.id, 'visibility', showRelief ? 'visible' : 'none');
    }
    const basemapVisibility = showRelief ? 'none' : 'visible';
    for (const id of [...REPLACED_ROAD_GEOMETRY, ...REPLACED_BUILDING_GEOMETRY]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', basemapVisibility);
    }
    for (const layer of map.getStyle()?.layers ?? []) {
      if (isReplacedRoadLabel(layer as never) && map.getLayer(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', basemapVisibility);
      }
    }
  }

  /** Load the entire Three.js renderer at the single optional boundary. Neither
      the route bootstrap nor this core module statically references Three. */
  async function ensureRelief(): Promise<void> {
    if (relief || appDisposed) return;
    if (reliefReady) return reliefReady;
    reliefReady = import('./explore/relief-renderer').then(({ createReliefRenderer }) => {
      if (appDisposed) return;
      const instance = createReliefRenderer({
        map, reducedMotion: reduceMotion,
        simulationGridSize: SIM_N, terrainGridSize: TERRAIN_N,
        /* READ LATE, not captured. `runtimeTier` is still 'balanced' at this point
           on every boot — it is promoted inside `initSimHost`, which runs from
           `resetSim` after the ward loads, while this runs off `capsReady` directly.
           Passing the value measured ZERO `.hdr` requests on a tier-2 machine. */
        deviceTier: () => runtimeTier,
      });
      relief = instance;
      attachReliefLayer();
      if (reliefWard) instance.setWard(reliefWard);
      if (currentField) instance.updateField({ field: currentField, coolingMask: cooling?.mask ?? null, ramp });
      instance.setVisualState(reliefVisualState());
      instance.setSelection({ building: selected, nearestCooling: nearestCool });
      /* The renderer boots with every layer on, because a mesh it has just built
         is visible. Three.js is a deferred import and the tree is interactive
         while it downloads, so anything unticked in the meantime has to be
         re-stated the moment there is something to state it to. */
      syncLayersToRenderer();
      syncRendererVisibility();
      map.triggerRepaint();
    }).catch((error) => {
      reliefReady = null;
      console.warn('Optional relief renderer unavailable:', error);
    });
    return reliefReady;
  }

  /** Street-view viewer — mapillary-js is heavy (its own WebGL context), so it
      loads only at this one dynamic boundary, mirroring ensureRelief's Three.js
      boundary above. Never imported statically. */
  async function openStreetView(imageId: string): Promise<void> {
    if (!MLY_TOKEN || !imageId) return;
    const panel = el('svViewer'); const modal = el('svModal');
    if (!panel || !modal) return;
    modal.removeAttribute('hidden');
    const { openViewer } = await import('./streetview/street-view-panel');
    await openViewer(panel, imageId, MLY_TOKEN);
  }
  function closeStreetView(): void {
    el('svModal')?.setAttribute('hidden', '');
    void import('./streetview/street-view-panel').then(({ closeViewer }) => closeViewer());
  }

  /* DC-URS baseline inputs — observed, loaded once and shared by every ward.
     Failure is non-fatal: the heat field still works, the score reports itself
     unavailable rather than inventing one. */
  /* The heatwave scenario's air temperature: p99 of 74 years of IMD daily maxima.
     A miss leaves it null, which makes the Heatwave button inert rather than
     pushing undefined into the physics — the swallow-to-empty posture the roads
     and water loaders take. */
  let heatwaveP99: number | null = null;
  /* WHICH CITY'S FILE the percentile above came from. `heatwave-percentiles.json`
     sits beside the ward artefacts under a name that reads as global, and it is
     not: it carries a `city` key saying "Kolkata". Memoising on the value alone —
     which is what `if (heatwaveP99 != null) return;` did — would carry one city's
     1-in-100 day across a switch into another, where it would compute cleanly and
     read as that city's own extreme. */
  let heatwaveFrom: string | null = null;
  async function loadHeatwave(key: AreaKey) {
    const url = cityPaths(key).heatwave;
    /* A CITY THAT DECLARES NO FILE GETS NO PERCENTILE, never Kolkata's. Null is
       already the "Heatwave button is inert" signal — `selectPhase` refuses the
       phase rather than pushing undefined into the physics — so the scenario
       disables itself instead of inheriting somebody else's heat. */
    if (url === null) { heatwaveP99 = null; heatwaveFrom = null; return; }
    if (heatwaveFrom === url && heatwaveP99 != null) return;
    try {
      const r = await fetch(url);
      if (r.ok) { heatwaveP99 = (await r.json())?.tmaxC?.p99 ?? null; heatwaveFrom = url; }
    } catch { heatwaveP99 = null; heatwaveFrom = null; }
  }

  /* Same story, same fix: dc-urs-inputs.json's `wards` object lists exactly
     ballygunge, baruipur and barrackpore, so it is a CITY artefact wearing a
     global name. A city declaring none leaves `state.dcurs` null, which the score
     already renders as "resilience inputs unavailable". */
  let dcursFrom: string | null = null;
  async function loadDcUrs(key: AreaKey) {
    const url = cityPaths(key).dcUrs;
    if (url === null) { state.dcurs = null; dcursFrom = null; return; }
    if (dcursFrom === url && state.dcurs) return;
    try {
      const r = await fetch(url);
      state.dcurs = (await r.json()).wards as Record<string, DcUrsInputs>;
      dcursFrom = url;
    } catch { state.dcurs = null; dcursFrom = null; }
  }

  async function loadWard(name: AreaKey) {
    /* The refusal comes BEFORE the session is opened and before the chip says
       "Loading …", so an unreachable area cannot leave a spinner running for a
       fetch that was never going to happen — and it now SPEAKS.

       Two bare `return`s stood here: one for an area with no row in
       src/data/wards.ts (the flyTo below would take the map to NaN), one for an
       area the registry says ships no artefacts (ten guaranteed 404s, nine of
       which swallow their own failure (eight wrapped in `optional`, and the
       surface loader swallows its own), leaving an empty map that looks loaded).
       Both were right to refuse and neither said so, so a tab press against such an
       area was indistinguishable from a click that missed: same map, same readings,
       same highlight. `areaRefusal` holds both tests and the sentence for each. */
    const refusal = areaRefusal(name);
    if (refusal !== null) {
      const chip = el('loadchip');
      if (chip) { chip.textContent = refusal; chip.classList.add('on'); }
      return;
    }
    const P = paths(name);
    /* Null here is unreachable — `areaRefusal` returns a sentence for exactly that
       case — and the check is what narrows `AreaPaths | null` for the eleven uses
       below without a `!`, which would be a promise to the compiler with nothing
       keeping it. */
    if (P === null) return;
    const w = wardOf(name);
    const token = wardSession.begin(name);
    if (!token) return;
    const load = el('loadchip');
    if (load) { load.textContent = `Loading ${w.name}…`; load.classList.add('on'); }
    await new Promise(r => setTimeout(r, 30));
    if (!wardSession.isCurrent(token)) return;
    const optional = async <T>(task: Promise<T>, fallback: T): Promise<T> => {
      try { return await task; }
      catch (error) {
        if (token.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        return fallback;
      }
    };
    try {
      /* Fetch the complete immutable ward bundle before changing shared state. A
         superseded request therefore cannot replace geometry, labels, or metrics
         part way through a newer ward selection. */
      const [d, terrain, water, wardSurface, roads, labels, provenance, canopy, trees, pvRaw] = await Promise.all([
        cache[name]
          ? Promise.resolve(cache[name])
          : fetch(P.ward, { signal: token.signal }).then(async (r) => {
            if (!r.ok) throw new Error(`Ward data unavailable (${r.status}).`);
            return r.json() as Promise<M.WardData>;
          }),
        terrainCache[name] !== undefined
          ? Promise.resolve(terrainCache[name])
          : optional(fetch(P.terrain, { signal: token.signal })
            .then(async (r) => r.ok ? asTerrainField(await r.json()) : null), null),
        waterCache[name]
          ? Promise.resolve(waterCache[name])
          : optional(fetch(P.water, { signal: token.signal })
            .then(async (r) => r.ok ? await r.json() as M.WaterData : { polys: [] }), { polys: [] }),
        surfaceCache[name]
          ? Promise.resolve(surfaceCache[name])
          : loadAreaSurface(name, token.signal),
        roadsCache[name]
          ? Promise.resolve(roadsCache[name])
          : optional(fetch(P.roads, { signal: token.signal })
            .then(async (r) => r.ok ? await r.json() as M.RoadsData : { ways: [] }), { ways: [] }),
        labelCache[name]
          ? Promise.resolve(labelCache[name])
          : optional(fetch(P.labels, { signal: token.signal })
            .then(async (r) => r.ok ? await r.json() : EMPTY_LABELS), EMPTY_LABELS),
        provCache[name] !== undefined
          ? Promise.resolve(provCache[name])
          : optional(fetch(P.provenance, { signal: token.signal })
            .then(async (r) => r.ok ? await r.json() as { src: string[]; confidence: number[] } : null), null),
        canopyCache[name] !== undefined
          ? Promise.resolve(canopyCache[name])
          : optional(loadCanopyRaster(name, token.signal).then((c) => { canopyCache[name] = c; return c; }), null),
        optional(fetch(P.trees, { signal: token.signal })
          .then(async (r) => (r.ok ? asTreesFile(await r.json()) : null)), null),
        pvCache[name] !== undefined
          ? Promise.resolve(pvCache[name] as unknown)
          : optional(fetch(P.pv, { signal: token.signal })
            .then(async (r) => (r.ok ? await r.json() as unknown : null)), null as unknown),
      ]);
      if (!wardSession.isCurrent(token)) return;
      cache[name] = d; terrainCache[name] = terrain; waterCache[name] = water;
      surfaceCache[name] = wardSurface; roadsCache[name] = roads; labelCache[name] = labels; provCache[name] = provenance;
      canopyCache[name] = canopy;
      pvCache[name] = asPvFile(pvRaw, d.b.length, areaOf(name));
      void loadDcUrs(name); void loadHeatwave(name);
      /* The scope moves WITH the area. `state.climate` is what `currentParams`
         and `applyInterventions` read, so leaving it behind would run the new
         city's geometry through the old city's fallback temperature and
         park-cooling radius — cleanly, and with a plausible number out. */
      state.ward = name; state.climate = resolve(name).climate;
      projectWard();

    /* Rebuild the pick registry from the SAME rows the extrusions come from, and
       drop any selection: building #1759 in Ballygunge is a different building in
       Baruipur, so carrying the index across a ward switch would lie. */
    select(null);
    closeStreetView();
    registry = buildRegistry(d.b);

    currentWardSizeM = d.sizeM;
    paintSolarWard();
    const mc = maplibregl.MercatorCoordinate.fromLngLat([w.lon, w.lat], 0);
    /* The scale comes from ward-frame.ts, not from mc.meterInMercatorCoordinateUnits()
       alone: that number is MapLibre's sphere, and our data's metres are not its
       metres. Using it for both axes stretched north by 0.593 % — ~4 m at the rim,
       growing with |y|. Only the ALTITUDE term is still MapLibre's own, because
       building heights never pass through the ward frame. */
    reliefWard = {
      wardData: d, roads, water, terrain,
      mercatorOrigin: { x: mc.x, y: mc.y, z: mc.z ?? 0 },
      frame: wardMercatorScale(w.lat),
      veg: trees,
    };
    coreField.attach(w, d.sizeM, relief && map.getLayer(relief.layer.id) ? relief.layer.id : undefined);
    relief?.setWard(reliefWard);
    /* `setWard` has just rebuilt the city mesh and the tree group, both of them
       new and therefore fully on. This was one line — the trees — for as long as
       the trees were the only layer with a switch; it is now every row of the
       tree, read back off the checkboxes. */
    syncLayersToRenderer();
    syncRendererVisibility();
    /* The exaggeration is stated wherever the optional ground relief is drawn. */
    const terrLab = el('terrLab');
    if (terrLab) terrLab.textContent = terrainLabel(terrain) || 'unavailable';

    /* Vegetation and albedo are MEASURED per cell, from Sentinel-2, and pinned to
       the same ward means the resilience score reads. loadWardSurface verifies
       that pairing before either reaches the model, so the map and the score
       cannot end up drawn from different vintages of the same measurement. */
    surfaceCache[name] ??= await loadAreaSurface(name);
    const { means, surface } = surfaceCache[name];
    state.base = rasterWardBase(d, means, surface, canopy, water);
    /* The reveal belongs on this line and not on a later await: everything below
       is optional artefacts, and a roads or labels fetch that hangs must not hold
       back a control whose data is already in hand. */
    paintWardTools();
    if (!roadsCache[name]) { try { roadsCache[name] = await (await fetch(P.roads)).json(); } catch { roadsCache[name] = { ways: [] }; } }
    /* Street names for this ward. Separate artefact, separate frame: these are
       lon/lat and go to MapLibre directly, so they never pass through our metre
       frame and act as a standing check on the geometry that does. */
    if (!labelCache[name]) {
      labelCache[name] = await fetch(P.labels)
        .then(r => (r.ok ? r.json() : EMPTY_LABELS))
        .catch(() => EMPTY_LABELS);
    }
    (map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined)
      ?.setData(labelCache[name] as never);
    if (provCache[name] === undefined) {
      provCache[name] = await fetch(P.provenance)
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    state.spatial = M.buildSpatial(d, state.base, roadsCache[name]);
    /* Cooling surfaces are a property of the MEASURED vegetation, so they are
       computed from the ward's base layers and never move when a scenario does —
       planting trees in the model must not invent a park that is not there. */
    const cellM2 = (d.sizeM / SIM_N) * (d.sizeM / SIM_N);
    cooling = findCoolingSurfaces(state.base.veg, SIM_N, cellM2);
    /* Two more passes at the bracketing thresholds. Three flood fills over 37k
       cells is a few milliseconds once per ward, and it buys the only honest
       way to show a figure this parameter-sensitive: as a range. */
    coolingLo = findCoolingSurfaces(state.base.veg, SIM_N, cellM2, VEG_BRACKET[0]);
    coolingHi = findCoolingSurfaces(state.base.veg, SIM_N, cellM2, VEG_BRACKET[1]);
    if (currentField) relief?.updateField({ field: currentField, coolingMask: cooling.mask, ramp });
    state.live = liveCache[name] ?? null; paintLive();
    resetSim();

    setHTML('pname', w.name); setText('pzone', w.zone); setText('coord', w.coord);
    setText('bcount', `${d.count.toLocaleString()} real buildings`);
    /* `data-w` IS A BARE WARD ID in HeatMapStage.astro, so it is compared against
       the bare id and never against the key. Comparing it to `name` would match
       nothing at all: the strip would lose its highlight on the first switch and
       the page would look like it had failed to change ward.
       The header tabs used to be synced here too, from the same `activeId`. They
       were a third area switcher beside the scope switcher's Area select and this
       strip, and they are gone; the strip stays because it is the only control
       that puts the wards side by side — though see `refreshStats`, which fills
       `big-{id}` for the OPEN ward only, so the other tiles hold an em-dash until
       they have been visited. */
    const activeId = areaOf(name);
    document.querySelectorAll('#strip .ward').forEach(t => t.classList.toggle('on', (t as HTMLElement).dataset.w === activeId));
    if (load) { load.textContent = 'Building ward…'; load.classList.remove('on'); }

    const dur = relief ? 1400 : 0;
    orbit = false; clearTimeout(orbitResume);
    map.flyTo({ center: [w.lon, w.lat], zoom: 15.3, pitch: mode === 'iso' ? 0 : 60, bearing: mode === 'iso' ? 0 : -18, duration: dur });
    orbitResume = window.setTimeout(() => { if (!reduceMotion && mode === 'relief') { orbit = true; requestRuntimeFrame('orbit'); } }, dur + 600);
    if (reduceMotion) { growProgress = 1; syncReliefVisual(); }
    else {
      growProgress = 0;
      growStart = performance.now() + dur * 0.45;
      syncReliefVisual();
      requestRuntimeFrame('grow', dur * 0.45);
    }
      wardSession.commit(token);
      fetchLive(name);
    } catch (error) {
      if (!wardSession.isCurrent(token)) return;
      wardSession.fail(token);
      console.warn(`Ward ${name} could not load:`, error);
      if (load) load.textContent = `${w.name} could not load.`;
    }
  }

  async function resetSim() {
    if (appDisposed || !state.base) return;
    await initSimHost();
    if (appDisposed || !simHost || !state.base) return;
    /* Re-read the sun before every reset, so the FIRST simulation of the session
       is already at the right elevation. `sunNow` starts at 0 purely as a "live
       mode is on" sentinel; without this the opening frame would run night
       physics at noon and then visibly flip when the stats tick corrected it. */
    refreshNowSun();
    const p = M.currentParams(state);
    state.baselineMean = M.eqMean(state.base, { ...p, Q: DEFAULT_PARAMS.Q });
    const layers = M.applyInterventions(state.base, state.iv, state.spatial, state.climate.parkRadiusM);
    state.greenG = M.computeGreenG(layers);
    const request: HeatSimRequest = {
      generation: ++simGeneration,
      grid: { n: SIM_N, cellMeters: cache[state.ward].sizeM / SIM_N },
      layers, params: p, settleSteps: RESET_BURST, thresholdC: 40,
    };
    latestSimRequest = request;
    try {
      const snapshot = await simHost.reset(request);
      if (appDisposed || latestSimRequest?.generation !== snapshot.generation) return;
      latestSnapshot = snapshot;
      refreshStats(snapshot); bridgeField(snapshot.field);
      lastSimulationAt = performance.now();
      requestRuntimeFrame('render');
    } catch (error) {
      if (latestSimRequest?.generation !== request.generation) return;
      if (demoteSimHost()) void resetSim();
      else console.warn('Heat simulation unavailable:', error);
    }
  }

  /* ── live ambient (Met Norway direct; production proxies via /api/ambient) ── */
  const liveCache: Record<string, M.Ambient> = {};
  /* ── live-reading freshness dial ──
     met.no publishes hourly, so a reading is at worst an hour behind reality by
     construction: FRESH covers that. Past two hours the sim is running on
     weather that has had time to change, and past six it is a different day's
     shape — the ring goes red and says so rather than pulsing green forever. */
  const AGE_FRESH_MIN = 90, AGE_STALE_MIN = 360;

  /* THE CITY'S ZONE, FROM THE SCOPE — not a constant here.
     This line used to read `const WARD_TZ = 'Asia/Kolkata'` under a comment
     arguing that a fixed +5:30 offset "is the first thing that breaks when a
     European or East Asian ward is added". The argument was right and the fix was
     half-done: a hardcoded ZONE breaks one city sooner than a hardcoded offset
     does, and it breaks quietly — Dubai would have shown Kolkata's hour, weekday
     and meridiem under a tooltip claiming the live reading was valid at an IST
     time, with nothing anywhere to disagree with it.
     `SCOPE`, not `resolve(state.ward)`: the zone is a CITY fact and the tab strip
     never leaves the city, so re-reading it per switch would only add a second
     place for it to be wrong. */
  const WARD_TZ = SCOPE.city.tz;
  const wardClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: WARD_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  /* TWELVE-HOUR FOR THE DIAL, TWENTY-FOUR EVERYWHERE ELSE.
     The face carries a stacked AM/PM pair, which only means anything against a
     12-hour reading — and for a heat instrument "is it the middle of the night
     there" is the most load-bearing fact about a temperature, which 24-hour
     buries in a leading digit. `wardClock` stays 24-hour because the tooltip and
     the validity hour are records, not glanceable state.
     `hourCycle: 'h12'` and not `hour12: true`: the latter emits "24" for
     midnight under some ICU builds, which would render a 24:07 clock face. */
  const wardFaceFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: WARD_TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h12',
  });
  /* Digits only. A 12-hour format emits "1:39 PM", and the stacked pair beside
     the digits already says PM — printing it twice is the one thing the stacked
     indicator exists to avoid. formatToParts drops the dayPeriod without
     string-slicing a locale-dependent suffix. */
  const wardFace = (d: Date) => wardFaceFmt.formatToParts(d)
    .filter(p => p.type === 'hour' || p.type === 'minute' || p.type === 'literal')
    .map(p => p.value).join('').trim();
  /* CLOCK FORMAT IS THE READER'S, AND IT PERSISTS.
     Twelve-hour is the default because the stacked meridiem is what makes the
     face glanceable, but half the world reads 24-hour and a scientist reading a
     thermal instrument may well prefer it. localStorage rather than session:
     this is a preference about the person, not about the visit, and having to
     re-set it every time would make the toggle feel broken. Both accesses are
     guarded — storage throws outright in some privacy modes, and a clock is not
     worth taking the page down for. */
  const H12_KEY = 'delta:heat-clock-h12';
  let hour12 = true;
  try { hour12 = localStorage.getItem(H12_KEY) !== '0'; } catch { /* default stands */ }

  /* The ward's weekday, three letters, uppercased at the call site rather than
     by CSS so screen readers get the real word and not a styled abbreviation. */
  const wardDay = new Intl.DateTimeFormat('en-US', { timeZone: WARD_TZ, weekday: 'short' });
  const wardHour24 = new Intl.DateTimeFormat('en-GB', {
    timeZone: WARD_TZ, hour: '2-digit', hourCycle: 'h23',
  });

  /* CLOCK SKEW, MEASURED FROM THE SAME REQUEST.
     The reading's age is (now - validAt), and `now` comes from the visitor's
     machine — so a device with a wrong clock reports a wrong age and gets the
     wrong freshness colour. Rather than add a time API (a second network
     dependency, its own failure mode, to learn something the browser already
     believes), take it from the `Date` header met.no already sends with the
     forecast. Same request, no extra byte, and it is the authority on when the
     reading was served. */
  let clockSkewMs = 0;
  const now = () => Date.now() + clockSkewMs;

  function ageMinutes(iso: string | undefined): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.max(0, (now() - t) / 60000) : null;
  }

  /**
   * THE WARD'S OWN CONTROLS, REVEALED BY THE WARD.
   *
   * These used to hang off `state.live` inside `paintClock`, under a comment
   * saying both are "meaningless until a ward has actually loaded" — which is
   * true, and is not the condition that was written. A ward loads from its own
   * artefacts; the live reading is a separate fetch to met.no that supplies the
   * boundary conditions and nothing else. So met.no being down, rate-limiting, or
   * answering through a proxy that 500s took away two features that never
   * depended on it: the canopy the ward already shipped, and ground-truth
   * photography already downloaded. The map drew the trees; the control that
   * toggles them was hidden.
   *
   * `state.base` IS the ward: it is assigned once the ward's rasters resolve, and
   * a refused or failed load leaves it null, which is exactly when these should
   * stay hidden. The Mapillary token stays ANDed in for street view, so the
   * feature still disappears cleanly when it has tree-shaken out of the build.
   */
  function paintWardTools(): void {
    const ready = state.base !== null;
    const vegw = el('vegw');
    if (vegw) vegw.hidden = !ready;
    const svw = el('svw');
    if (svw) svw.hidden = !(ready && MLY_TOKEN);
  }

  function paintClock() {
    /* The shell is a <div> since the tile split into two buttons; casting it to
       HTMLButtonElement compiled fine and would have been a lie the day someone
       reached for .disabled on it. */
    const btn = el('clockw');
    if (!btn) return;
    const L = state.live;
    btn.hidden = !L;
    if (!L) return;

    const mins = ageMinutes(L.validAt);
    const bar = el('clockBar');

    /* THE BIG DIGITS ARE THE WARD'S CLOCK, NOT THE READING'S HOUR.
       They used to be the reading's validity hour, which was arithmetically
       right and read as a broken clock: it showed 00:30 while Kolkata said
       01:29, because a 19:00Z reading IS 00:30 IST. Nobody reads a large time
       as "the hour of the observation" — they read it as "the time". So the
       clock says the time, and the reading's age qualifies it underneath. */
    const at = new Date(now());
    /* One switch, two formatters already built — the 24-hour one is `wardClock`,
       which the tooltip has always used, so no third Intl instance is created. */
    setText('clockTime', hour12 ? wardFace(at) : wardClock.format(at));
    btn.dataset.h12 = String(hour12);
    /* Uppercased here, not by CSS: text-transform styles the glyphs but leaves
       the accessible name as "Mon", and this string also lands in the title. */
    const dayLabel = wardDay.format(at).toUpperCase();
    setText('clockDay', dayLabel);
    /* Meridiem from an explicit h23 read rather than parsing the 12-hour string
       — no locale surprises, and midnight is 00 rather than 12 or 24. */
    const pm = Number(wardHour24.format(at)) >= 12;
    el('clockAm')?.classList.toggle('on', !pm);
    el('clockPm')?.classList.toggle('on', pm);
    const face = el('clockFace');
    /* aria-pressed on the FACE, not the tile: the button is "24-hour clock",
       pressed when 24-hour is showing. The label names the destination so a
       screen-reader user is told what activating it will do, not what it is. */
    face?.setAttribute('aria-pressed', String(!hour12));
    face?.setAttribute('aria-label', hour12
      ? `Ward clock, ${dayLabel} ${wardFace(at)} ${pm ? 'PM' : 'AM'}. Switch to 24-hour.`
      : `Ward clock, ${dayLabel} ${wardClock.format(at)}, 24-hour. Switch to 12-hour.`);

    if (mins === null) {
      /* Unknown age must not render as fresh: empty bar, nothing claimed. */
      btn.dataset.age = 'unknown';
      setText('clockAgeLab', 'age —');
      el('clockAge')?.setAttribute('aria-label',
        'Live reading age unknown. Activate to fetch current conditions.');
      bar?.setAttribute('style', 'transform:scaleX(0)');
      btn.title = `Ward clock (${WARD_TZ}) — ${dayLabel} ${wardClock.format(at)}. Live reading age unknown. Activate to re-read.`;
      return;
    }

    /* The bar empties as the reading ages: full at zero, gone at stale. */
    bar?.setAttribute('style', `transform:scaleX(${Math.max(0, 1 - mins / AGE_STALE_MIN).toFixed(3)})`);
    btn.dataset.age = mins <= AGE_FRESH_MIN ? 'fresh'
      : mins <= AGE_STALE_MIN ? 'aging' : 'stale';

    const label = mins < 60 ? `${Math.round(mins)}m` : `${Math.floor(mins / 60)}h`;
    setText('clockAgeLab', `read ${label} ago`);
    /* The visible text is "read 11m ago", which states a fact and not an
       action. The button needs to say what activating it DOES. */
    el('clockAge')?.setAttribute('aria-label',
      `Live reading is ${label} old. Activate to fetch current conditions.`);
    const validLocal = wardClock.format(new Date(Date.parse(L.validAt!)));
    /* The DAY is in the name because the digits are the ward's, not the
       reader's: at 18:30 in London this face says 12:00 AM, and only the
       weekday reveals that Kolkata is already on the next day. */
    btn.title = `Ward clock (${WARD_TZ}) — ${dayLabel} ${wardClock.format(at)}. `
      + `The live reading driving this simulation `
      + `is valid for ${validLocal} and is ${label} old. `
      + 'The map itself shows a modelled phase, not a time of day. Activate to re-read.';
  }

  function paintLive() {
    const L = state.live;
    setText('liveT', L ? L.tAir.toFixed(1) : '—'); setText('liveFeel', L ? L.feels.toFixed(1) : '—');
    setText('liveRH', L ? String(Math.round(L.rh)) : '—'); setText('liveWind', L ? L.wind.toFixed(1) : '—');
    /* The dot claims "live"; it may only do so while the reading still is.

       AN UNKNOWN AGE IS NOT A FRESH ONE, and this line used to say it was:
       `mins === null || mins <= AGE_STALE_MIN` lit the dot when `ageMinutes`
       could not date the reading at all. `paintClock` had already settled the
       question thirty lines above — grey tile, "age —", bar emptied, under the
       comment "Unknown age must not render as fresh: empty bar, nothing
       claimed" — so the one element whose whole job is the word LIVE was the
       one element exempt from the rule the rest of the tile follows. On screen
       that read as a grey tile saying "age —" beside a pulsing green light.

       `validAt` is `ts.time` copied verbatim out of the upstream body and is
       optional in our own type, so a reshaped or truncated met.no response
       reaches here as a COMPLETE reading whose age is unknowable. That is the
       moment the page most needs to stop claiming currency, and it was the
       moment it started. */
    const mins = ageMinutes(L?.validAt);
    el('livedot')?.classList.toggle('on', !!L && mins !== null && mins <= AGE_STALE_MIN);
    paintClock();
  }

  const onClock = async () => {
    const btn = el('clockAge') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try { await fetchLive(state.ward, true); } finally { btn.disabled = false; paintClock(); }
  };
  const onFormat = () => {
    hour12 = !hour12;
    try { localStorage.setItem(H12_KEY, hour12 ? '1' : '0'); } catch { /* preference is transient */ }
    paintClock();
  };
  el('clockAge')?.addEventListener('click', onClock);
  cleanup.push(() => el('clockAge')?.removeEventListener('click', onClock));
  el('clockFace')?.addEventListener('click', onFormat);
  cleanup.push(() => el('clockFace')?.removeEventListener('click', onFormat));
  /* Age advances with the wall clock, not with any event, so it needs its own
     slow tick. One minute is far below the resolution of the thing being shown
     and costs nothing next to the sim. */
  const clockTick = window.setInterval(paintClock, 60_000);
  cleanup.push(() => clearInterval(clockTick));
  /* `force` bypasses the session cache. Without it this fetched once per ward
     per session and never again: a tab left open overnight kept a pulsing green
     "live" dot over yesterday evening's weather, while that same reading went on
     setting the simulation's boundary conditions. The freshness dial exposes the
     age; this is how a reader acts on it. */
  async function fetchLive(name: AreaKey, force = false) {
    const w = wardOf(name);
    try {
      if (force || !liveCache[name]) {
        /* Through our own function, never api.met.no directly: their terms require
           an identifying User-Agent, which a browser fetch cannot set. See api/live.js. */
        const r = await fetch(`/api/live?lat=${w.lat}&lon=${w.lon}`);
        if (!r.ok) throw new Error('met.no ' + r.status);
        /* Trust the server's clock over the visitor's for the AGE arithmetic.
           Measured before the body is read so transfer time is not counted as
           skew; a wrong device clock would otherwise silently mis-colour the
           freshness bar. Ignored unless it is large enough to matter.

           `Age` IS NOT OPTIONAL HERE. Since the reading comes through our own
           function (api/live.js) it is CDN-cached for s-maxage=600, and on a hit
           the stored `Date` is whenever the ORIGIN generated it — up to ten
           minutes old — while `Age` carries how long it has sat there. Reading
           `Date` alone would charge that cache age to the visitor's clock and
           mis-colour the very freshness bar this arithmetic exists to keep
           honest. `Date + Age` reconstructs "now" at the edge. Same-origin, so
           the header is readable without a CORS expose list. */
        const dateHdr = Date.parse(r.headers.get('date') ?? '');
        const ageSec = Number(r.headers.get('age')) || 0;
        const served = dateHdr + ageSec * 1000;
        if (Number.isFinite(served)) {
          const skew = served - Date.now();
          clockSkewMs = Math.abs(skew) > 120_000 ? skew : 0;
        }
        /* PARSED, NOT DESTRUCTURED. This used to read the three numbers straight
           off the body; all three are optional in met.no's schema, so a whole-but-
           short response arrived as a complete reading holding `undefined` — which
           made the heat field NaN and threw out of `paintLive`, costing the whole
           ward. `asAmbient` refuses such a body, and a refusal lands on the same
           path as an outage: `state.live` stays null, the dial says unknown rather
           than fresh, and the ward's own controls stay up.

           It also carries `validAt` — met.no's `timeseries[0].time`, the hour the
           reading is VALID FOR rather than the moment we fetched it. Those differ
           by up to an hour and only the first is a property of the data. */
        const reading = M.asAmbient(await r.json());
        if (!reading) throw new Error('met.no returned a reading with no usable numbers');
        liveCache[name] = reading;
      }
      if (appDisposed || state.ward !== name) return;
      state.live = liveCache[name]; paintLive(); resetSim();
    } catch (e) { console.warn('live ambient unavailable, using fallback:', (e as Error).message); }
  }

  /* ── readouts ── */
  const lstColor = (t: number) => t >= 40 ? 'var(--red)' : t >= 37 ? '#d46b4a' : t >= 33 ? 'var(--bronze)' : 'var(--cyan)';

  /**
   * Show how much to trust the number on screen. Night is calibratable against
   * ECOSTRESS (data ceiling 2.18 K); daytime is not (3.33 K), because noon
   * surface temperature depends on local insolation, cloud timing and soil
   * moisture that 50 km reanalysis forcing cannot resolve. Presenting the
   * daytime figure as decision-grade would be the real inaccuracy, so it is
   * labelled indicative and carries its measured band.
   */
  function applyConfidence() {
    const a = ACCURACY[state.phase];
    /* THE ERROR BAR MOVES WITH THE SUN, because the measurement does.
       In "now" mode the reader can land on an hour no published figure covers:
       sunrise to mid-morning scored 7.54 K out-of-sample against a 4.5 K daytime
       band, since a steady-state solution cannot represent a surface that is
       shedding stored heat while the sun is already loading it. Reporting ±4.5
       there would be the one dishonest thing this page does. */
    const live = state.sunNow != null;
    const transition = live && isTransitionHour(wardSolarHour());
    /* Phase label: the clock made its absence a contradiction — a reader saw
       03:00 beside 39.4 °C and had no way to know that was the 13:00 scenario. */
    /* A scenario forcing must name itself. Without this the reader sees 39 °C
       under "modelled at 13:00" with nothing saying the air was replaced — the
       same contradiction the clock work fixed for Now. */
    setText('lstPhase', live ? 'modelled now'
      : state.heatTairC != null ? 'modelled at 13:00 · 1-in-100 heat'
      : state.phase === 'night' ? 'modelled at 22:00' : 'modelled at 13:00');
    const tag = el('conf');
    if (tag) {
      /* innerHTML, not textContent, so the FIGURES can be mono inside sans prose
         — the card's type rule (labels sans, data mono) applied to a string that
         is both. Safe by construction: every interpolated value is a number put
         through toFixed, never user or network text.
         Sentence case because .conf no longer uppercases in CSS. */
      const fig = (t: string) => `<b>${t}</b>`;
      tag.innerHTML = transition
        ? `Outside validation · ${fig(`~±${TRANSITION_RMSE_K.toFixed(1)} °C`)} at this hour`
        : a.confidence === 'quantitative'
          ? `Calibrated · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}`
          : `Indicative only · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}`;
      tag.className = `conf ${transition ? 'indicative' : a.confidence}`;
      if (transition) {
        (tag as HTMLElement).title =
          'Sunrise to mid-morning is the one window neither published figure '
          + `covers. Scored out-of-sample it reaches ${TRANSITION_RMSE_K.toFixed(2)} K — the surface is `
          + 'still releasing stored heat while the sun is already loading it, and a '
          + 'steady-state model cannot represent a system that far from equilibrium.'
          + `\n\n${SPATIAL.note}`;
        return;
      }
      // Both figures on one tooltip. The phase note covers ward-LEVEL error; the
      // spatial note covers whether the pattern inside the ward means anything.
      // A reader who sees only the first will read the hot blocks as measured —
      // they are not (SPATIAL.rModel 0.22, below a plain vegetation map's 0.24,
      // and coarsening the comparison does not close that gap at any scale).
      (tag as HTMLElement).title = `${a.note}\n\n${SPATIAL.note}`;
    }
    const lstEl = el('lst');
    if (lstEl) (lstEl as HTMLElement).title = `${a.note}\n\n${SPATIAL.note}`;
  }
  /* The legend states the limit of what its own colours mean. Written from the
     measured constant so it cannot drift from the number in accuracy.ts — the
     same reason unmeasuredNote() stopped being a hardcoded string. */
  {
    const pn = el('patternNote');
    // Deliberately ONE line. The legend sits directly above the ward strip with
    // ~27 px of slack; a two-line note pushed the OpenStreetMap attribution
    // underneath the strip, and that line is a licence obligation, not decoration.
    // The full sentence — and n — is on the tooltip and in SPATIAL.note.
    if (pn) pn.textContent = `Block pattern illustrative · r ${SPATIAL.rModel.toFixed(2)}`;
    (pn as HTMLElement | null)?.setAttribute('title', SPATIAL.note);
  }
  /* Push the bounds to every consumer AND to the legend, so the printed numbers
     can never disagree with the colours above them. */
  function syncRamp(p: SimParams) {
    ramp = M.rampBounds(p);
    const sc = el('rampSc');
    // A narrow span needs a decimal: the retained phase can be 3 K wide, where
    // whole degrees print "24 · 24 · 25 · 26 · 27" — a repeated label reads as a
    // rendering bug and tells the reader nothing about the gradient.
    const dp = ramp[1] - ramp[0] < 8 ? 1 : 0;
    if (sc) sc.innerHTML = [0, .25, .5, .75, 1]
      .map(f => `<span>${(ramp[0] + (ramp[1] - ramp[0]) * f).toFixed(dp)}</span>`).join('');
  }

  const histo = el('histo'); if (histo) for (let i = 0; i < 12; i++) histo.appendChild(document.createElement('i'));
  function refreshStats(snapshot: HeatSimSnapshot | null = latestSnapshot) {
    if (!snapshot) return;
    const st = snapshot.stats, t = snapshot.field;
    const lst = el('lst');
    if (lst) {
      // The band is measured, not decorative: it is this model's out-of-sample
      // error against ECOSTRESS for the phase on screen. See accuracy.ts.
      lst.innerHTML = `${st.meanC.toFixed(1)}<span class="u">°C</span>`
        + `<span class="band">${bandLabel(state.phase)}</span>`;
      (lst as HTMLElement).style.color = lstColor(st.meanC);
    }
    applyConfidence();
    const p = M.currentParams(state);
    syncRamp(p);
    const uhi = greenReferenceContrastC(st.meanC, p);
    setText('uhi', `${uhi >= 0 ? '+' : ''}${uhi.toFixed(1)}°`);
    setText('area', `${(st.fracAbove * 100).toFixed(0)}%`);
    const bins = new Array(12).fill(0);
    for (let i = 0; i < t.length; i++) { const b = Math.min(11, Math.max(0, ((t[i] - ramp[0]) / (ramp[1] - ramp[0]) * 12) | 0)); bins[b]++; }
    const mx = Math.max(...bins, 1);
    /* AN EMPTY BIN DRAWS NOTHING, AND THAT IS THE POINT OF A DISTRIBUTION.
       This was `Math.max(4, …)`, which gave every bin a floor whether or not any
       cell fell in it — so a band containing NO cells and a band containing a
       handful rendered identically. On a chart whose whole job is to show where
       the ward's temperatures sit, "nothing here" and "a little here" being the
       same picture is the one thing it must not do. The CSS baseline underneath
       is what keeps an empty bin legible as a bin rather than as a gap.

       The floor for a NON-empty bin stays, and is now big enough to see: one cell
       out of thousands is still a fact, and rounding it to nothing would be the
       opposite error. */
    histo?.childNodes.forEach((elm, i) => {
      const share = bins[i] / mx * 100;
      (elm as HTMLElement).style.height = bins[i] === 0 ? '0%' : `${Math.max(7, share)}%`;
    });
    const iv = state.iv;
    const cost = M.computeCost(iv, state.spatial, COSTS);
    const anyIv = iv.trees || iv.roof || iv.parks || iv.facades;

    /* ── DC-URS ────────────────────────────────────────────────────────────
       One score, evaluated twice: the observed baseline, and the same ward with
       the sliders' modelled changes applied. The ward-mean surface temperature
       the heat field just produced feeds the thermal pillar, so the physics and
       the index describe the same scenario. */
    /* BY THE BARE ID. `dc-urs-inputs.json`'s `wards` object is keyed by file-stem
       ids — ballygunge, baruipur, barrackpore — so indexing it with the area key
       returns undefined. And this lookup is OPTIONAL-CHAINED: there would be no
       error, no warning and no 404, just a resilience panel reading "—" for ever
       on a page whose inputs are sitting right there in the fetched object. */
    const base = state.dcurs?.[areaOf(state.ward)];
    if (base) {
      const phaseLst = state.phase === 'night' ? { nightC: st.meanC } : { dayC: st.meanC };
      const scen = applyScenario(base, iv, anyIv ? phaseLst : undefined);
      const now = U.dcUrs(anyIv ? scen.inputs : base);
      const p = U.pillars(anyIv ? scen.inputs : base);
      const tier = U.tierFor(now);
      const floor = U.structuralFloor(base);

      setText('scoreNum', String(Math.round(now)));
      // The three pillars raw, as the Green Score's components were: a composite
      // is only auditable if you can see which part produced the number.
      setText('sGreen', `${Math.round(p.aci * 100)}`);
      setText('sCool', `${Math.round((1 - p.evi) * 100)}`);
      setText('sEff', `${Math.round((1 - p.thi) * 100)}`);
      el('scoreArc')?.setAttribute('stroke-dashoffset', String(97 - now * 0.97));
      el('scoreArc')?.setAttribute('stroke', tier.colour);
      const tierEl = el('scoreTier');
      if (tierEl) { tierEl.textContent = tier.label; (tierEl as HTMLElement).style.color = tier.colour; }
      // Headroom vs structural floor: what greening can still win, against what
      // no intervention can touch. This is the tool's sharpest statement.
      /* What the score does not know. Read from the data file's own provenance,
         never from a constant here: the day socio.json lands the build stamps
         `measured`, points falls to zero, and this disappears by itself. */
      const gap = U.unmeasured(base);
      const chip = el('scoreConf');
      if (chip) {
        chip.toggleAttribute('hidden', gap.points < 0.05);
        /* Shares the .conf pill with the confidence banner, so it follows the
           same rule: sentence case (CSS no longer uppercases) and the figure in
           mono. Leaving this one mono-caps beside a sans sibling looked broken. */
        chip.innerHTML = `Best case · up to <b>${gap.points.toFixed(1)} pts</b> lower`;
        (chip as HTMLElement).title = unmeasuredNote(gap.fields, gap.points);
      }
      // The error sits entirely inside exposure. Mark where it lives, in the
      // colour this instrument already uses for "not decision-grade".
      el('sCool')?.classList.toggle('soft', gap.fields.includes('socioVuln'));

      setHTML('scoreTxt', anyIv
        /* The symbol comes from COSTS, not from this template. It used to be a ₹
           typed in beside the number, which meant the country half of the scope
           knew the currency and the readout ignored it. */
        ? `${(now - U.dcUrs(base)).toFixed(1)} pts from this plan · ${fmtMoney(cost, COSTS)}<br>${tier.guidance}`
        // `headroom` is exactly invariant to the missing input — it shifts ceiling
        // and current equally — so it needs no hedge. `withheld` only ever RISES,
        // so one word makes it true instead of understated by a quarter.
        : `${floor.headroom.toFixed(0)} pts reachable · <b>${gap.points > 0.05 ? 'at least ' : ''}`
          + `${floor.withheld.toFixed(0)} withheld</b> by exposure`);
    } else {
      setText('scoreNum', '—');
      setHTML('scoreTxt', 'resilience inputs unavailable');
    }
    /* `lastMean` is OURS, so it is keyed by the area key like every other cache
       here — written and read under the one shape. The DOM id beside it is NOT:
       `big-ballygunge` is authored in HeatMapStage.astro against
       src/data/wards.ts, so it takes the bare id. */
    state.lastMean[state.ward] = st.meanC;
    setHTML(`big-${areaOf(state.ward)}`, meanTile(st.meanC.toFixed(1)));
    /* Repaint the open building card from the SAME snapshot these stats came
       from. Without this it keeps whatever it read at selection time: move a
       slider or flip to night and the map recolours, the ward mean moves, and
       the card sits there quoting a temperature that is no longer true — and
       its "vs ward mean" line silently becomes wrong as well. */
    if (selected) paintCard(selected);
    /* Keep "now" actually now. The solar factor drifts continuously, so a view
       left open through sunset must follow it rather than freeze at whatever the
       sun was when the button was pressed. Cheap: trigonometry, once per stats
       tick, and resetSim only when the day/night branch actually flips. */
    if (state.sunNow != null) {
      const wasNight = state.phase === 'night';
      refreshNowSun();
      if ((state.phase === 'night') !== wasNight) resetSim();
    }
  }

  /**
   * ONE SPELLING OF A STRIP TILE — for the reading and for the blank alike.
   *
   * The unit `<span>` is markup HeatMapStage.astro authors, and the em-dash below
   * is the exact state it renders a tile in before any ward has been solved. That
   * identity is the whole claim `blankStaleWardTiles` makes: a tile this code
   * blanks must be indistinguishable from one that was never filled, or "not
   * computed" would read as some third state the reader has to interpret. Two
   * literals in two places would drift the first time either is touched.
   */
  function meanTile(value: string) { return `${value}<span>°C mean</span>`; }

  /**
   * A SCENARIO MOVED: blank every tile it just falsified, then re-solve.
   *
   * WHAT THIS FIXES, MEASURED ON THE SHIPPED BUILD. `refreshStats` writes
   * `big-{id}` for the OPEN ward only, and nothing invalidated the others when the
   * scenario changed under them. Ballygunge at 13:00 with no trees read 40.6; plant
   * 50 trees (39.3), open Baruipur, take the trees back out, flip to 22:00 — and
   * the strip read `ballygunge 39.3 · baruipur 29.9`, asserting a 9.4 K gap whose
   * honest like-for-like value was 2.4 K. The label is `°C mean` and nothing else:
   * no hour, no intervention set, so the page never says the two numbers came from
   * different worlds. A wrong number presented plausibly, in the one control that
   * exists to compare wards.
   *
   * THE IRONY IS ONE LINE ABOVE the write, in `refreshStats`: the comment there
   * describes fixing this exact staleness for the building card. The fix stopped
   * short of the tiles beside it.
   *
   * AN EM-DASH, NOT A RECOMPUTE. Re-solving all three wards would be three solves
   * on every slider drag. A tile reading "—" says "not computed under this
   * scenario", which is true, and is the state the stage already renders.
   *
   * ON SCENARIO, NEVER ON WARD. A tile computed under the CURRENT scenario is
   * still valid when you switch wards, and holding those two numbers beside each
   * other is the strip's entire value — so `loadWard` must not call this.
   *
   * THE OPEN TILE IS SPARED AND ITS CACHE ENTRY IS NOT, which looks asymmetric and
   * is deliberate. The tile is about to be overwritten by the solve this function
   * ends with, so blanking it would only flicker on every drag; `state.lastMean` is
   * read by `paintCard` for the building card's "vs ward mean" line, and a delta
   * against a mean the scenario has just falsified is wrong in exactly the way this
   * function exists to stop. An absent entry degrades that line to nothing —
   * `Number.isFinite(undefined)` is false — until the solve returns.
   */
  function applyScenarioChange() {
    state.lastMean = {};
    /* The bare id, because `big-ballygunge` is authored against src/data/wards.ts
       — the same asymmetry `refreshStats` writes the tile under. */
    const open = `big-${areaOf(state.ward)}`;
    document.querySelectorAll('#strip .ward .big').forEach((tile) => {
      if (tile.id !== open) tile.innerHTML = meanTile('—');
    });
    resetSim();
  }

  /* ── DOM helpers ── */
  function setText(id: string, v: string) { const e = el(id); if (e) e.textContent = v; }
  function setHTML(id: string, v: string) { const e = el(id); if (e) e.innerHTML = v; }
  /**
   * PROJECT `state.ward` ONTO EVERYTHING THAT RESTATES IT.
   *
   * THIS IS AN ENROLMENT LIST, and it is a function because the list got long
   * enough that a call chain stopped being one. `updateAddressBar` and
   * `updateStageArea` each describe themselves as "the same obligation"; so are the
   * other four, and every one of them was added to a growing chain at a single call
   * site inside `loadWard`. The chain's failure mode is not that it breaks — it is
   * that a new projection gets written, checked by hand once, and never joined to
   * it, which is how the breadcrumb and the document title came to be the only two
   * statements of the open ward on this page that nobody had ever updated.
   *
   * THE MEMBERS KEEP THEIR OWN NAMES on their own lines, so `grep updateCrumb`
   * still lands on the writer and a diff that adds a projection is one line that
   * reads as one. One function body doing all six jobs would have saved nothing and
   * hidden the list.
   *
   * `updateCompareHref` is here AND in the scenario handlers, which is right rather
   * than duplicated: the Compare deep link restates the ward and the interventions
   * both, so it is a member of two obligations.
   */
  function projectWard() {
    updateCompareHref();
    updateReportHref();
    updateAddressBar();
    updateStageArea();
    updateScopeSwitcher();
    updateCrumb();
    updateDocumentMeta();
    updateSourcesPanel();
  }

  /* The card's primary action used to be a <button> with no handler anywhere in
     src/ — it had shipped to production doing nothing at all. It now points at
     the ward's own record, which is the one per-ward artefact we can actually
     hand someone today, and the label says exactly that rather than promising a
     "report" we do not generate. */
  function updateReportHref() {
    const link = el('report-link') as HTMLAnchorElement | null;
    /* `/api/wards/[id]` is generated from src/data/wards.ts, one route per bare
       id, so the key would produce a 404 the page has no way to notice. */
    if (link) link.href = `/api/wards/${areaOf(state.ward)}/metadata.json`;
  }

  /**
   * Keep the URL describing the view.
   *
   * Every area has its own page now, which is the whole point of the route change —
   * a Baruipur reading can be bookmarked, sent, and cited. Switching wards by tab
   * does NOT navigate (the map, the caches and the GPU host are reused), so without
   * this the address bar would go on saying Ballygunge over Baruipur's buildings,
   * and copying the URL would hand someone a different ward than the one on screen.
   * That is precisely the failure `scope/legacy.ts` describes for Compare's deep
   * link, one level up.
   *
   * `replaceState`, not `pushState`, so the history behaviour is exactly what it was
   * before this line existed: a tab press is not a navigation and Back still leaves
   * the tool rather than walking the wards. `paired-controller.ts:241` writes the
   * Compare URL the same way, for the same reason.
   */
  function updateAddressBar() {
    history.replaceState(null, '', `${areaPath(state.ward)}${window.location.search}${window.location.hash}`);
  }

  /**
   * Keep `.stage[data-area]` naming the area that is actually open.
   *
   * IT IS NOT DECORATION — IT IS THE SEAM. shell/console-shell.ts cannot see this
   * closure, so the attribute is how it learns which area the instrument is
   * standing on: it decides from that whether a switch is an in-place swap or a
   * page load, and refuses a selection equal to it as a no-op.
   *
   * LEFT UNWRITTEN IT FROZE AT THE SERVER-RENDERED VALUE, and the consequence was
   * reproducible rather than rare: after switching away from the area the page
   * loaded with, THAT AREA COULD NEVER BE SELECTED AGAIN. The handler compared the
   * new value against a boot-time snapshot, matched, and returned silently — a
   * dropdown naming one ward over a map showing another, with nothing said. Two
   * hops out and back reproduced it every time.
   *
   * The neighbouring `updateScopeSwitcher` already names this failure — "its Area
   * select goes on naming the ward the page was opened at" — and repaired the
   * select's DISPLAYED value. The attribute driving the handler's LOGIC was left
   * on the same stale footing, one layer down, where it was invisible.
   *
   * WRITTEN BESIDE `updateAddressBar` BECAUSE THEY ARE THE SAME OBLIGATION: both
   * project `state.ward` outward for something that cannot read it directly, and a
   * ward switch that updates one but not the other leaves the page disagreeing
   * with itself about where it is.
   */
  function updateStageArea() {
    document.querySelector('.stage')?.setAttribute('data-area', state.ward);
  }

  /**
   * Keep the breadcrumb naming the area that is actually open.
   *
   * IT HAD NO WRITER AT ALL. `grep -rn crumb src/scripts/` found none: the crumb is
   * rendered once by HeatMapStage.astro and an in-place switch reloads nothing, so
   * after switching to Baruipur the page carried a bold "Ballygunge" in its top bar
   * about two hundred pixels from a `#pname` reading "Baruipur", with the URL
   * agreeing with the second one. Both are statements of where you are; only one of
   * them was ever updated.
   *
   * `textContent`, NOT `innerHTML`. The scope registry's area name is the
   * markup-stripped form — `#pname` is the readout that takes the ward table's
   * `<em>`-stressed wordmark, and the crumb deliberately does not — so there is
   * nothing here to parse and no reason to hand a registry string to the HTML
   * parser.
   *
   * THE COUNTRY AND CITY CELLS ARE NOT WRITTEN, and that is a fact about the switch
   * rather than an omission: `console-shell.ts` navigates rather than switching in
   * place whenever a selection would cross a city or a country, so neither cell can
   * go stale without a page load that re-renders all three.
   */
  function updateCrumb() {
    const cell = el('crumbArea');
    if (cell) cell.textContent = resolve(state.ward).area.name;
  }

  /**
   * Keep an OPEN Data-receipts panel describing the ward that is actually open.
   *
   * `renderSources` had exactly one caller — the `#srcBtn` click handler, and only
   * on its opening edge. So opening the panel and then switching ward left the
   * heading reading "Data receipts · ballygunge" over Ballygunge's rows, on a page
   * whose name, URL, breadcrumb and strip had all moved to Baruipur. It is
   * self-labelled, which is the only reason it failed semi-loudly rather than
   * silently — and a panel that names the wrong ward is worse than one that names
   * none, because it reads as an answer.
   *
   * ONLY WHILE IT IS OPEN, and that is a rule rather than an optimisation: the
   * manifest is fetched per area, so re-rendering a panel nobody is looking at would
   * spend a request on every strip click for a view that is not on screen. A closed
   * panel is re-rendered by the click that opens it, which is where it always was.
   */
  function updateSourcesPanel() {
    const panel = el('srcPanel');
    if (panel && !panel.hasAttribute('hidden')) void renderSources();
  }

  /**
   * EVERY HEAD TAG THAT RESTATES THE AREA, and which of the three values it carries.
   *
   * A LIST RATHER THAN SEVEN ASSIGNMENTS, because the set is Base.astro's to decide
   * and it grows: the layout already prints the title three times and the canonical
   * URL twice, and the next social card added there would be one more stale
   * statement nobody thought to enrol. The guard in
   * tests/unit/heat-map-console-coherence.test.mjs reads Base.astro for every tag
   * whose value is `{title}`, `{description}` or `{canonical}` and fails if this
   * list does not cover it — so the enrolment is checked against the layout rather
   * than against someone's memory of it.
   *
   * `document.title` is not in here because it is a property rather than an
   * attribute; it is written beside the loop, from the same string.
   */
  const WARD_META: ReadonlyArray<{ sel: string; attr: string; of: 'title' | 'description' | 'url' }> = [
    { sel: 'meta[name="description"]', attr: 'content', of: 'description' },
    { sel: 'link[rel="canonical"]', attr: 'href', of: 'url' },
    { sel: 'meta[property="og:title"]', attr: 'content', of: 'title' },
    { sel: 'meta[property="og:description"]', attr: 'content', of: 'description' },
    { sel: 'meta[property="og:url"]', attr: 'content', of: 'url' },
    { sel: 'meta[name="twitter:title"]', attr: 'content', of: 'title' },
    { sel: 'meta[name="twitter:description"]', attr: 'content', of: 'description' },
  ];

  /**
   * Keep what the DOCUMENT calls itself naming the area that is actually open.
   *
   * NOTHING IN src/ WROTE `document.title` BEFORE THIS. Meanwhile `updateAddressBar`
   * rewrites the URL on every switch — so `replaceState` was pairing the NEW url
   * with the OLD title, and a bookmark taken after a switch was filed under a ward
   * that is not on screen. The tab said Ballygunge over Baruipur's buildings, and
   * the canonical link — the one statement in this document addressed to a crawler
   * rather than a reader — pointed at a different page than the one rendered.
   *
   * THE TITLE AND DESCRIPTION COME FROM scope/page-meta.ts, which is also what the
   * route renders at build time. Re-spelling them here would put two writers on one
   * sentence, each correct on its own terms, and only a reader who had switched
   * ward would ever see them disagree.
   *
   * THE URL IS RESOLVED AGAINST THE TAG'S OWN VALUE, never rebuilt from
   * `location.origin`. `Astro.site` renders these absolute against the production
   * host, and a preview or a local build served from somewhere else must keep
   * saying what the server said — swapping only the path is what preserves that.
   *
   * A MISSING TAG IS SKIPPED RATHER THAN CREATED. `link[rel=canonical]` is absent
   * on a `noindex` page by design, and an in-place switch can only ever land on an
   * area that ships data — `tabKind` refuses the rest — so a tag that is not here
   * is one this document is deliberately without.
   */
  function updateDocumentMeta() {
    const scope = resolve(state.ward);
    const title = areaPageTitle(scope);
    const description = areaPageDescription(scope);
    const path = areaPath(state.ward);
    document.title = title;
    for (const { sel, attr, of } of WARD_META) {
      const node = document.head.querySelector(sel);
      if (!node) continue;
      if (of === 'url') {
        const was = node.getAttribute(attr);
        if (was) node.setAttribute(attr, new URL(path, was).toString());
        continue;
      }
      node.setAttribute(attr, of === 'title' ? title : description);
    }
  }

  /**
   * Keep the scope switcher naming the area that is actually open.
   *
   * WITHOUT THIS THE CONSOLE STATES TWO WARDS AT ONCE. A click on the ward strip
   * swaps the area in place — no page load, so nothing re-renders the switcher —
   * and its Area select goes on naming the ward the page was opened at. That is
   * the same wrong-record failure `updateReportHref` and `updateAddressBar` guard
   * against, one control over, and it is worse here because the switcher is the
   * control a reader would use to change area next.
   *
   * THE COUNTRY AND CITY SELECTS NEED THE OTHER HALF OF IT, and this is the part
   * that is not obvious. ScopeSwitcher gives the option for the group you are
   * ALREADY IN the value `current` — the whole page key, not the group's first
   * area — precisely so that choosing "Kolkata" while standing in Barrackpore does
   * not quietly move you to Ballygunge. That value is baked at render time, so
   * after an in-place switch it names the previous ward: picking your own city
   * would have walked you back to where you started. Rewriting the SELECTED
   * option's value is what keeps that promise across a switch, and the selected
   * option is the right one because switching in place never crosses a city — see
   * console-shell.ts, which navigates when it would.
   */
  function updateScopeSwitcher() {
    const key = state.ward;
    document.querySelectorAll<HTMLSelectElement>('select[data-scope]').forEach((select) => {
      if (select.dataset.scope === 'area') {
        /* Assigned only when the option EXISTS. Setting `value` to something no
           option carries silently clears the select to "", which reads as a
           control that has lost its place rather than as one naming a ward. */
        if (select.querySelector(`option[value="${key}"]`)) select.value = key;
        return;
      }
      const option = select.selectedOptions[0];
      if (option) option.value = key;
    });
    /* AND THEN SAY SO, because assigning `select.value` raises nothing.
       shell/SelectField.astro draws the words the reader actually sees over the
       top of these selects; it repaints on the select's own `change`, and there
       is no `change` here — this is a projection of `state.ward`, not a reader
       choosing something. Left unsaid, the switcher's VALUE would follow the ward
       and its VISIBLE LABEL would not: the exact two-wards-at-once failure the
       header above describes, one layer up, where it is the only part anybody can
       see. NOT a synthetic `change`: console-shell.ts answers that one by
       travelling, and it would be asked to travel to where it already is. */
    document.dispatchEvent(new Event(SELECT_SYNC_EVENT));
  }

  function updateCompareHref() {
    /* THE RAIL'S ANALYSIS SECTION, found by `data-rail` — the attribute the rail
       declares for exactly this. It used to be `#compare-mode-link` on the Compare
       tab in the stage header, and that tab is gone along with the rest of the
       second navigation. A `querySelector` for `a[data-rail]` rather than an id
       keeps the id contract from spreading into a shared component: the rail is
       rendered by every console page, and a hard-coded id in it would be a
       stage-shaped assumption living in a file the stage does not own.
       `a`, not `button`: the rail takes the href away from the section you are
       standing on, so on the compare page itself there is deliberately no link
       here to deep-link — and there is no instrument there either. */
    const link = document.querySelector<HTMLAnchorElement>('a[data-rail="analysis"]');
    if (!link) return;
    const params = new URLSearchParams({
      /* ONE function decides this spelling, for the writer here and the reader in
         scenario-url.ts alike. It used to be `areaOf` plus a comment asserting what
         Compare would accept — two places agreeing by hand, and Compare's reader
         failed SOFT, so the day they disagreed the deep link would have opened the
         default pair under this ward's name with nothing raised. */
      a: toLegacyWard(state.ward),
      trees: String(Math.round(state.iv.trees / 50 * 100)),
      roof: String(Math.round(state.iv.roof / 5) * 5),
      parks: String(Math.round(state.iv.parks * M.PARK_HA / 196 * 1000) / 10),
      facades: String(Math.round(state.iv.facades / 15 * 1000) / 10),
      phase: state.phase === 'night' ? 'retained' : 'peak',
    });
    link.href = `/heat-map/compare/?${params}`;
  }

  /* ── instrument wiring ── */
  const onEl = (node: Element | null, ev: string, fn: EventListenerOrEventListenerObject) => { if (node) { node.addEventListener(ev, fn); cleanup.push(() => node.removeEventListener(ev, fn)); } };
  /**
   * `data-w="ballygunge"` → `in/kolkata/ballygunge`, or null.
   *
   * The strip's markup is authored against src/data/wards.ts and carries BARE ids,
   * which is the right shape for it — this page opens one city, so a tile only has
   * to say which area. This is the seam that turns that into a key, and it goes
   * through `isAreaKey` rather than casting: `dataset.w` is an untrusted string, and
   * a typo in the markup must be refused here rather than becoming a fetch for a
   * file that does not exist. The city prefix comes from `splitKey`, never from
   * slicing the key — registry.ts's own note explains why re-parsing on "/" cannot
   * be right in general.
   */
  const { country: CO, city: CY } = splitKey(INITIAL_AREA);
  const areaKeyFromTab = (id: string | undefined): AreaKey | null => {
    const key = `${CO}/${CY}/${id ?? ''}`;
    return isAreaKey(key) ? key : null;
  };
  document.querySelectorAll('#strip .ward').forEach(t => onEl(t, 'click', () => {
    nudgeOrbit();
    const key = areaKeyFromTab((t as HTMLElement).dataset.w);
    if (key) void loadWard(key);
  }));

  /* THE SCOPE SWITCHER ASKS; THIS ANSWERS.
     The three selects are wired by shell/console-shell.ts, which boots on every
     area page — including the ones with no instrument, where getting OFF the page
     is the only thing a scope control can do. It decides whether a key can be
     opened without a page load (`tabKind`, plus "same city"), and when it can, it
     says so here rather than reaching into this closure for `loadWard`. */
  const onOpenArea = (event: Event) => {
    const key = (event as CustomEvent<OpenAreaDetail>).detail?.key;
    /* Re-validated on arrival. A CustomEvent is a public seam — anything on the
       page can dispatch one — and this is the door into a fetch. */
    if (!isAreaKey(key)) return;
    nudgeOrbit();
    void loadWard(key);
  };
  document.addEventListener(OPEN_AREA_EVENT, onOpenArea);
  cleanup.push(() => document.removeEventListener(OPEN_AREA_EVENT, onOpenArea));
  onEl(el('srcBtn'), 'click', () => {
    const panel = el('srcPanel'); const btn = el('srcBtn'); if (!panel || !btn) return;
    const opening = panel.hasAttribute('hidden');
    if (opening) { renderSources(); panel.removeAttribute('hidden'); } else panel.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', String(opening));
  });
  const bindSlider = (id: string, label: string, kk: keyof M.Interventions, fmt: (v: string) => string) => {
    const s = el(id) as HTMLInputElement | null; if (!s) return;
    onEl(s, 'input', () => { setText(label, fmt(s.value)); nudgeOrbit(); });
    /* `applyScenarioChange`, not `resetSim`: a slider falsifies the OTHER wards'
       tiles as surely as it does this one's, and only this door blanks them. */
    onEl(s, 'change', () => { state.iv[kk] = +s.value; updateCompareHref(); applyScenarioChange(); });
  };
  bindSlider('ivTrees', 'v1', 'trees', v => v); bindSlider('ivRoof', 'v2', 'roof', v => v + '%');
  bindSlider('ivFacades', 'v4', 'facades', v => v);
  /* ── diurnal phase, now with a live option ──
     "Now" is not a third value of `state.phase` — every downstream consumer
     (ACCURACY lookup, bandLabel, the DC-URS day/night split, the Compare
     deep-link) is written against the binary, and widening it would mean four
     edits to say one thing. Instead it sets `state.sunNow`, and the binary phase
     is DERIVED from whether the sun is actually up. One flag, no fan-out. */
  function wardSolarHour(): number {
    /* Local SOLAR time, not clock time. The wards sit at ~88.37°E while IST is
       drawn on 82.5°E, so solar noon in Kolkata falls ~23 minutes before 12:00
       IST. Using the clock hour would put the modelled sun peak in the wrong
       place by that much, every day. */
    const lon = wardOf(state.ward)?.lon ?? 88.3659;
    const utcH = (now() / 3_600_000) % 24;
    return ((utcH + lon / 15) % 24 + 24) % 24;
  }
  function refreshNowSun() {
    if (state.sunNow === undefined || state.sunNow === null) return;
    const h = wardSolarHour();
    const doy = dayOfYearUtc(now());
    state.sunNow = solarElevationFactor(h, doy, wardOf(state.ward)?.lat ?? 22.55);
    state.phase = state.sunNow > M.SUN_LIT ? 'peak' : 'night';
  }
  document.querySelectorAll('#segPhase button').forEach(b => onEl(b, 'click', () => {
    /* selectPhase decides; this only applies. An unrecognised data-p returns
       null and nothing moves — not the physics, and not even the highlight,
       which is why the guard sits above the class toggle. It replaces a blind
       `as 'peak' | 'night'` cast on a raw string. */
    const sel = selectPhase((b as HTMLElement).dataset.p ?? '', heatwaveP99);
    if (!sel) return;
    state.phase = sel.phase; state.sunNow = sel.sunNow; state.heatTairC = sel.heatTairC;
    if (sel.sunNow != null) refreshNowSun();
    document.querySelectorAll('#segPhase button').forEach(x => x.classList.toggle('on', x === b));
    updateCompareHref(); applyScenarioChange();
  }));
  document.querySelectorAll('#segPath button').forEach(b => onEl(b, 'click', () => { state.path = (b as HTMLElement).dataset.p!; document.querySelectorAll('#segPath button').forEach(x => x.classList.toggle('on', x === b)); applyScenarioChange(); }));
  /* 2D Isotherm is a CAMERA state over the same 3D scene, not a different scene:
     it flattens pitch and bearing and lets the ground overlay read as a plan.
     The relief layer keeps rendering (see shouldShowRelief), which is what keeps
     the city visible from above AND keeps the renderer's pick matrix — written
     once per rendered frame — in step with the camera, so a click in isotherm
     still selects the building under the cursor and the card stays glued to it. */
  document.querySelectorAll('#modechip button').forEach(b => onEl(b, 'click', () => {
    mode = (b as HTMLElement).dataset.m === 'iso' ? 'iso' : 'relief';
    document.querySelectorAll('#modechip button').forEach(x => x.classList.toggle('on', x === b));
    if (mode === 'relief') void ensureRelief();
    syncReliefVisual(); syncRendererVisibility();
    if (mode === 'iso') { orbit = false; map.easeTo({ pitch: 0, bearing: 0, duration: 900 }); }
    else { map.easeTo({ pitch: 60, duration: 900 }); if (!reduceMotion) orbitResume = window.setTimeout(() => { orbit = true; requestRuntimeFrame('orbit'); }, 1100); }
  }));
  document.querySelectorAll('#tintchip button').forEach(b => onEl(b, 'click', () => { tintMode = +((b as HTMLElement).dataset.t!); document.querySelectorAll('#tintchip button').forEach(x => x.classList.toggle('on', x === b)); syncReliefVisual(); map.triggerRepaint(); }));
  function setEnv(e: string) {
    if ((e !== 'dark' && e !== 'studio') || e === env) return; env = e; const s = e === 'studio';
    document.body.classList.toggle('studio', s); opBase = s ? 0.42 : 0.5;
    syncReliefVisual();
    document.querySelectorAll('#envchip button').forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.e === e));
    /* `diff: false`, AND WITHOUT IT NONE OF THE RESTORATION EVER RUNS.
       MapLibre's default `setStyle` DIFFS the two styles and applies the result to
       the live Style object. Our two basemaps are diffable — measured: identical
       `sprite`, identical `glyphs`, and both drawn on `openmaptiles` + `ne2_shaded`
       — so the diff succeeds, and a successful diff never re-creates the Style and
       therefore never re-fires `style.load`. What the diff DOES do is drop every
       source and layer present in the old style and absent from the new one, which
       is precisely everything this app added.
       MEASURED ON THE SHIPPED BUILD: switching Dark to Clay left `getSource` and
       `getLayer` answering false for the analytical field, the road-name labels, the
       3-D relief scene AND the Mapillary coverage, with `onStyleLoad` never firing
       once. Not one layer lost — all of them, silently, from a button whose only job
       is to restyle the basemap. The handler's own comment claimed the opposite.
       A full reload is the honest cost of a control that replaces the whole basemap,
       and it is what makes `style.load` mean what this file has always assumed. */
    map.setStyle(STYLES[e as 'dark' | 'studio'], { diff: false });
  }
  document.querySelectorAll('#envchip button').forEach(b => onEl(b, 'click', () => setEnv((b as HTMLElement).dataset.e!)));
  /* ── THE SIX LAYERS, AND THE TWO CONTROLS THAT REACH TWO OF THEM ──────────────
     Trees and Street-level imagery each have a chip over the map as well as a row
     in the layer tree, and two controls over one fact is how the two come to
     disagree — the chip saying On beside an unticked box. So each is applied by
     ONE function that moves the state, the renderer, the chip AND the box, and
     both controls call it. The chips stay because they are the on-map hand: a
     reader orbiting the city should not have to open a pane to hide the trees. */

  /** Paint a `.modechip`'s two buttons from the value its `data-` attribute holds. */
  const paintChip = (chip: string, key: string, value: string): void => {
    document.querySelectorAll(`#${chip} button`).forEach((x) => {
      x.classList.toggle('on', (x as HTMLElement).dataset[key] === value);
    });
  };

  /**
   * Put a layer row's checkbox back in step with the layer.
   *
   * The checkbox is the SOURCE OF TRUTH for visibility — a click reads it and
   * nothing else — but it is not the only way a layer moves, and a box left
   * ticked over a hidden layer is the quiet lie the tree exists to prevent.
   */
  const paintLayerBox = (id: LayerId, on: boolean): void => {
    const box = document.querySelector<HTMLInputElement>(`input[data-layer="${id}"]`);
    if (box) box.checked = on;
  };

  function setTreesVisible(on: boolean): void {
    relief?.setVegetationVisible(on);
    paintChip('vegchip', 'v', on ? '1' : '0');
    paintLayerBox('green/trees', on);
    map.triggerRepaint();
  }

  function setStreetVisible(on: boolean): void {
    /* The token is checked HERE and not at the caller, because there are two
       callers: without it `addCoverage` would add a source that can never answer,
       and the tree already refuses the row on the same capability. */
    streetOn = on;
    if (on && MLY_TOKEN) addCoverage(map, MLY_TOKEN); else removeCoverage(map);
    paintChip('streetchip', 's', on ? '1' : '0');
    paintLayerBox('ground/street', on);
    map.triggerRepaint();
  }

  document.querySelectorAll('#vegchip button').forEach(b => onEl(b, 'click', () => {
    setTreesVisible((b as HTMLElement).dataset.v === '1');
  }));

  /* ── street-view: coverage overlay + click-to-view ──
     The #svw wrapper stays hidden (see paintClock) unless a Mapillary token is
     actually configured — no point offering a toggle that can never do anything. */
  document.querySelectorAll('#streetchip button').forEach((b) => onEl(b, 'click', () => {
    setStreetVisible((b as HTMLElement).dataset.s === '1');
  }));

  /**
   * ONE LAYER ID → ONE VISIBILITY CALL, and the `switch` is the point.
   *
   * `LayerId` is DERIVED from the registry in scope/layers.ts, so this switch is
   * exhaustive over it by construction: add a seventh layer there and this stops
   * compiling, HERE, naming the id it has no renderer for. The alternative — a
   * `Record<string, () => void>` lookup, or an if-chain with a shrug at the end —
   * would accept the new id, do nothing, and ship a checkbox that ticks against a
   * map that never changes. That is the exact defect the tree was built to make
   * impossible one layer up, and it would have walked straight back in here.
   *
   * FOUR OF THE SIX END ON THE RENDERER and two do not, which is a fact about what
   * they are rather than an inconsistency: the thermal field is drawn twice (a
   * shader overlay in relief, a canvas raster in isotherm) so its switch is read by
   * both, and street-level coverage is a MapLibre source rather than anything in
   * the 3-D scene.
   */
  function setLayerVisible(id: LayerId, on: boolean): void {
    switch (id) {
      case 'thermal/surface':
        surfaceOn = on;
        syncRendererVisibility(); syncReliefVisual(); map.triggerRepaint();
        break;
      case 'green/canopy':
        relief?.setCanopyVisible(on);
        break;
      case 'green/trees':
        setTreesVisible(on);
        break;
      case 'built/footprints':
        relief?.setBuildingsVisible(on);
        break;
      case 'built/heights':
        relief?.setBuildingsExtruded(on);
        break;
      case 'ground/street':
        setStreetVisible(on);
        break;
    }
  }

  /**
   * ONE HANDLER FOR ALL SIX ROWS, delegated from the tree's own container.
   *
   * THE CHECKBOX IS THE SOURCE OF TRUTH. `checked` is read off the element the
   * browser has already toggled, rather than from a variable this file keeps
   * beside it — so the two cannot drift, and a box the user has just clicked twice
   * ends where it looks like it ends. That also makes the disabled rows safe by
   * construction: a disabled input fires no `change`, cannot be focused and cannot
   * be toggled by script through a click, so a layer whose artefact does not ship
   * here can never be switched on. No second check is written for it, because a
   * second check is a second opinion.
   */
  const layerTree = document.querySelector('.tree');
  onEl(layerTree, 'change', (event) => {
    const box = (event.target as HTMLElement | null)?.closest?.('input[data-layer]');
    if (!(box instanceof HTMLInputElement)) return;
    const id = box.dataset.layer;
    /* `isLayerId`, never a cast: `dataset.layer` is a string off the DOM, and an
       id the registry has never heard of must be refused here rather than fall
       through the switch and silently do nothing. */
    if (!isLayerId(id)) return;
    nudgeOrbit();
    setLayerVisible(id, box.checked);
  });

  /**
   * Push every row's state at the renderer, in one pass.
   *
   * WHY THIS EXISTS RATHER THAN INITIAL FLAGS. The relief renderer arrives LATE —
   * `ensureRelief` imports Three at the first optional boundary — and it arrives
   * again, in effect, on every ward switch, because `rebuildWard` throws the city
   * and the trees away and builds new ones. Both times the new objects are visible
   * and full height. A visitor who unticked Building heights during the download,
   * or before switching ward, would watch the layer come back on its own.
   *
   * It reads the CHECKBOXES, not a set of variables kept beside them, for the
   * reason the change handler gives: they are the source of truth, and reading
   * them here is what keeps that true across the two moments the map is rebuilt
   * under them.
   */
  function syncLayersToRenderer(): void {
    document.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((box) => {
      const id = box.dataset.layer;
      if (isLayerId(id)) setLayerVisible(id, box.checked);
    });
  }
  map.on('click', IMAGE_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id != null) void openStreetView(String(id));
  });
  map.on('mouseenter', IMAGE_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', IMAGE_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
  onEl(el('svClose'), 'click', closeStreetView);
  onEl(el('svModal'), 'click', (e) => { if (e.target === el('svModal')) closeStreetView(); });

  /* ── budgeted simulation + grow timeline ── */
  let lastSimulationAt = 0;
  let simulationInFlight = false;
  function runRuntimeFrame(time: number): void {
    if (appDisposed || !runtimeVisible) return;
    const budget = exploreRuntimeBudget({
      visible: runtimeVisible,
      interacting: !!drag,
      reducedMotion: reduceMotion,
      deviceTier: runtimeTier,
    });
    const dragging = advanceDrag();
    const orbiting = advanceOrbit(time);
    let growing = false;
    if (!reduceMotion && growProgress < 1 && growStart) {
      growProgress = Math.min(1, Math.max(0, (time - growStart) / GROW_MS));
      growing = growProgress < 1;
      syncReliefVisual();
    }
    const cloudMotion = budget.allowCloudMotion && !!relief && mode !== 'iso' && (state.live?.wind ?? 0) > 0;
    const simEligible = budget.simulate && !!simHost && !!latestSimRequest && simAnimate;
    if (simEligible && !simulationInFlight && time - lastSimulationAt >= budget.simulationIntervalMs) {
      simulationInFlight = true;
      lastSimulationAt = time;
      const request = latestSimRequest!;
      void simHost!.advance(request.generation, 80).then((snapshot) => {
        if (!snapshot || latestSimRequest?.generation !== snapshot.generation) return;
        latestSnapshot = snapshot;
        refreshStats(snapshot);
        bridgeField(snapshot.field);
      }).catch(() => { if (demoteSimHost()) void resetSim(); }).finally(() => {
        simulationInFlight = false;
        requestRuntimeFrame('render', budget.simulationIntervalMs);
      });
    }
    if (dragging || orbiting || growing || cloudMotion) map.triggerRepaint();
    /* One policy call decides the cadence — see nextFrameDelayMs for why an
       animating frame must ask for 0 and not a nominal "60 fps" 16 ms. */
    const delay = nextFrameDelayMs({
      animating: dragging || orbiting || growing,
      cloudMotion,
      /* `&& !simulationInFlight` matters on slow hardware. Once an advance
         outlives its own interval, msUntilNextSim goes negative, clamps to 0,
         and a RESTING page asks for an immediate frame every frame — measured
         at 27/s against 1.4/s when a 900 ms advance meets a 720 ms interval,
         and pinned at the refresh rate if one never settles. No visual artefact,
         because an idle frame triggers no repaint; it is pure battery. The
         advance's own `.finally` re-arms the cadence, so nothing is lost. */
      simEligible: simEligible && !simulationInFlight,
      msUntilNextSim: budget.simulationIntervalMs - (time - lastSimulationAt),
    });
    if (delay !== null) requestRuntimeFrame('render', delay);
  }

  /* ── style rehydration + boot ── */
  /* This handler is `on`, not `once` — setEnv's setStyle re-fires it, which is
     what keeps the basemap's road layers hidden across an environment switch.
     It deliberately restores render state only: a style change must never fetch
     or replace the selected ward. */
  /**
   * EVERYTHING THIS APP PUT INTO SOMEONE ELSE'S STYLE, AND HOW TO PUT IT BACK.
   *
   * `setEnv` calls `map.setStyle(...)`, which replaces the whole style object and
   * discards every source and layer added to the old one. This handler already knew
   * that — it re-added the road-name labels and re-attached relief for exactly that
   * reason — and it did not re-add the Mapillary coverage source. So ticking
   * Street-level imagery and then switching Dark to Clay dropped the layer while
   * the chip and the checkbox both went on reading On. `addCoverage` has one caller
   * and this handler was not it.
   *
   * A LIST RATHER THAN A SEQUENCE OF RE-ADDS, so the next source added anywhere in
   * the engine is covered by enrolling it here rather than by remembering that this
   * function exists. The guard in tests/unit/heat-map-console-coherence.test.mjs
   * finds every `map.addSource(...)` in the engine tree and fails naming any that
   * this list does not.
   *
   * ORDERED, AND THE ORDER IS LOAD-BEARING. The analytical field is added before
   * relief so the 3-D scene paints over the 2-D raster rather than under it — which
   * is the same stacking `loadWard` gets by passing relief's id as `beforeId` — and
   * the labels after it so street names are never eaten by a tower.
   *
   * ONE ENTRY NAMES NO SOURCE, and that is honest rather than a gap: the relief
   * custom layer draws from the renderer's own WebGL context and adds nothing to
   * the style but itself. It is in the list because its POSITION in this sequence
   * is what the two entries around it are ordered against.
   */
  const STYLE_ADDITIONS: ReadonlyArray<{ source: string | null; restore: () => void }> = [
    {
      source: CORE_FIELD_SOURCE,
      restore: () => {
        const wardData = cache[state.ward];
        if (wardData) coreField.rehydrate(wardOf(state.ward), wardData.sizeM);
      },
    },
    { source: null, restore: () => { attachReliefLayer(); syncRendererVisibility(); } },
    {
      /* Our own street names, in the BASEMAP's frame. */
      source: LABEL_SOURCE,
      restore: () => {
        if (!map.getSource(LABEL_SOURCE)) {
          map.addSource(LABEL_SOURCE, { type: 'geojson', data: EMPTY_LABELS as never });
        }
        if (!map.getLayer(LABEL_LAYER)) {
          map.addLayer(labelLayerSpec(env === 'studio' ? 'studio' : 'dark') as never);
        }
        const cached = labelCache[state.ward];
        if (cached) (map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource)?.setData(cached as never);
      },
    },
    {
      /* THROUGH `setStreetVisible`, NOT `addCoverage`, so the token check and the
         two chips that report the layer's state are the same ones the user's own
         click goes through. Off is a real restore too: `removeCoverage` on a style
         that never had it is a no-op, and calling it keeps the chip in step. */
      source: COVERAGE_SOURCE,
      restore: () => setStreetVisible(streetOn),
    },
  ];

  const onStyleLoad = () => {
    for (const { restore } of STYLE_ADDITIONS) restore();
    /* NOT IN THE LIST ABOVE, because that list is about sources and layers this app
       ADDED — `setStyle({diff:false})` drops those. The sky is a property OF the
       style object, so a replaced style arrives with the spec's own defaults rather
       than with ours dropped. `appliedSky` is cleared first or the guard would
       recognise our last value and skip re-applying it to a style that no longer
       has it. */
    appliedSky = '';
    syncSky();
    /* Relief supplies metre-scaled roads, so its mode hides the corresponding
       pixel-scaled basemap geometry. Core mode restores the basemap roads. */
    syncRendererVisibility();
    map.triggerRepaint();
  };
  map.on('style.load', onStyleLoad);
  /* THE WARD FIRST, THEN THE SKY. `mapHasLoaded` unlocks `syncSky`, which refuses
     to touch the style before this moment because doing so stops this very event
     from firing — see the note in `syncSky`. Ordered so the instrument starts
     even if the sky call misbehaves again on a future MapLibre. */
  const onMapLoad = () => { mapHasLoaded = true; void loadWard(INITIAL_AREA); syncSky(); };
  map.once('load', onMapLoad);
  void capsReady.then((caps) => {
    if (!appDisposed && caps.tier > 0 && caps.mode !== 'isotherm') void ensureRelief();
  }).catch(() => { /* initSimHost owns the documented CPU fallback */ });
  const onVis = () => {
    runtimeVisible = !document.hidden;
    if (runtimeVisible) requestRuntimeFrame('render');
    else frameScheduler.cancelPending();
  };
  document.addEventListener('visibilitychange', onVis);

  /* ── dispose ── */
  return function dispose() {
    appDisposed = true;
    wardSession.dispose();
    frameScheduler.dispose();
    clearTimeout(orbitResume);
    nudgeEvents.forEach(ev => cv.removeEventListener(ev, nudgeOrbit));
    cv.removeEventListener('contextmenu', noCtx);
    cv.removeEventListener('pointerdown', onDown as EventListener); cv.removeEventListener('pointermove', onMove as EventListener);
    cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
    document.removeEventListener('visibilitychange', onVis);
    map.off('style.load', onStyleLoad); map.off('load', onMapLoad);
    cleanup.forEach(fn => fn());
    closeStreetView();
    relief?.dispose();
    coreField.dispose();
    simHost?.dispose();
    try { map.remove(); } catch { /* ignore */ }
    document.body.classList.remove('studio');
  };
}
