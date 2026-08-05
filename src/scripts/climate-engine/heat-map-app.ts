/**
 * Heat-map instrument — the integrated stage + instrument + lifecycle.
 * Ports previews/heat-map/index.html faithfully into the repo. Owns: MapLibre
 * basemap, the three.js custom layer (buildings + draped heat field) sharing
 * MapLibre's GL context, the GPU sim on its OWN offscreen context (bridged via a
 * throttled readback), the DOM instrument, and disposal.
 *
 * Pure physics/economics live in ./heat-map-model. Sim engine in ./sim-gpu.
 * `mountHeatMap()` returns a dispose fn (call it on astro:before-swap).
 */
import maplibregl from 'maplibre-gl';
import { WARD_MAP, wardLatLon, formatLatLon } from '../../data/wards.ts';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GpuHeatSim } from './sim-gpu';
import { DEFAULT_PARAMS, type SimLayers, type SimParams } from './types';
import * as M from './heat-map-model';
import { ACCURACY, SPATIAL, bandLabel, unmeasuredNote, isTransitionHour, TRANSITION_RMSE_K } from './accuracy';
import { solarElevationFactor } from './sky';
import * as U from './dc-urs';
import { applyScenario } from './dc-urs-scenario';
import type { DcUrsInputs } from './dc-urs-inputs';
import { rasterWardBase } from './ward-raster';
import { loadWardSurface, type WardSurface } from './surface-raster';
import { buildRegistry, pickBuilding, projectWard, type BuildingMeta } from './explore/building-pick';
import { createWaterLayer, type WaterLayer } from './water-layer';
import { createCloudLayer, type CloudLayer } from './cloud-layer';
import { createRoadLayer, type RoadLayer } from './road-layer';
import { selectPhase } from './phase-select';
import { asTerrainField, terrainDrawAt, terrainLabel, TERRAIN_N, type TerrainField } from './terrain';
import { wardMercatorScale, type WardFrame } from './ward-frame';
import {
  LABEL_SOURCE, LABEL_LAYER, REPLACED_ROAD_GEOMETRY, isReplacedRoadLabel,
  labelLayerSpec, EMPTY_LABELS,
} from './road-labels';
import { findCoolingSurfaces, nearestCooling, type CoolingSurfaces } from './explore/cooling-surfaces';

// Ward set lives in src/data/wards.ts so widening beyond three is a data change,
// not a code change (dc-urs-spec.md §1).
const WARDS = WARD_MAP;
const { SIM_N, RESET_BURST } = M;
const STYLES = { dark: 'https://tiles.openfreemap.org/styles/dark', studio: 'https://tiles.openfreemap.org/styles/positron' };

export function mountHeatMap(): () => void {
  const el = (id: string) => document.getElementById(id);
  const mapContainer = el('mlmap');
  if (!mapContainer) return () => {};
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanup: Array<() => void> = [];
  const raf = (fn: FrameRequestCallback) => { const id = requestAnimationFrame(fn); return id; };

  /* ── state ── */
  interface State {
    ward: string; phase: 'peak' | 'night'; path: string; iv: M.Interventions;
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
  
  const state: State = { ward: 'ballygunge', phase: 'peak', path: '2025', iv: { trees: 0, roof: 0, parks: 0, facades: 0 }, sunNow: 0, heatTairC: null, base: null, baselineMean: 0, live: null, spatial: null, greenG: 0, lastMean: {}, dcurs: null };
  let mode: 'relief' | 'iso' = 'relief', env = 'dark';

  /* ── MapLibre basemap ── */
  const map = new maplibregl.Map({
    container: mapContainer, style: STYLES.dark,
    center: [WARDS.ballygunge.lon, WARDS.ballygunge.lat], zoom: 15.3, pitch: 60, bearing: -18,
    antialias: true, attributionControl: false, pixelRatio: Math.min(devicePixelRatio, 1.75),
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  /* A distance reference. The instrument shows a 1.4 km window at a pitch that
     foreshortens it, and until now nothing on screen said how big anything was. */
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 104, unit: 'metric' }), 'bottom-left');

  /* ── idle auto-orbit (pauses on any interaction, resumes after 2.5 s) ── */
  let orbit = !reduceMotion, orbitResume = 0, lastT = 0;
  const ORBIT_DEG_PER_SEC = -1.4;
  function orbitFrame(t: number) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0; lastT = t;
    if (orbit && mode === 'relief' && map.isStyleLoaded()) map.setBearing(map.getBearing() + ORBIT_DEG_PER_SEC * dt);
    orbitId = raf(orbitFrame);
  }
  let orbitId = raf(orbitFrame);
  function nudgeOrbit() { orbit = false; clearTimeout(orbitResume); orbitResume = window.setTimeout(() => { if (!reduceMotion && mode === 'relief') orbit = true; }, 2500); }

  /* ── north compass ──
     The idle orbit turns the map forever, which is pleasant to watch and
     disorienting to read: bearing drifts a full turn every ~4 minutes and
     nothing said which way you were facing. The needle answers that, and the
     click is the way out of a rotation nobody asked for — so it does NOT
     schedule the orbit to resume. The next drag re-arms it through nudgeOrbit,
     which is the point at which the reader has asked for motion again. */
  const compassEl = el('compass');
  const dialEl = el('compassDial'), nLabEl = el('compassN'), sLabEl = el('compassS');
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
  const onMove = (e: PointerEvent) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (!dragAcc) dragAcc = { dx: 0, dy: 0, pan: drag.b === 2 }; dragAcc.dx += dx; dragAcc.dy += dy; };
  const onUp = () => { drag = null; };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
  function dragFrame() {
    if (dragAcc) {
      if (dragAcc.pan) map.panBy([-dragAcc.dx, -dragAcc.dy], { duration: 0 });
      else { vel.b = -dragAcc.dx * 0.4; vel.p = -dragAcc.dy * 0.35; map.jumpTo({ bearing: map.getBearing() + vel.b, pitch: Math.min(78, Math.max(0, map.getPitch() + vel.p)) }); }
      dragAcc = null;
    } else if (drag) { vel.b *= 0.5; vel.p *= 0.5; }
    else if (Math.abs(vel.b) > 0.02 || Math.abs(vel.p) > 0.02) { vel.b *= 0.88; vel.p *= 0.88; map.jumpTo({ bearing: map.getBearing() + vel.b, pitch: Math.min(78, Math.max(0, map.getPitch() + vel.p)) }); }
    dragId = raf(dragFrame);
  }
  let dragId = raf(dragFrame);

  /* ── click-to-inspect: select a building, read what is measured about it ──
     A tap and a drag start identically on this canvas (the orbit gesture owns
     pointerdown), so selection commits on pointerUP and only when the pointer
     barely moved. 6 px is the usual slop budget for "tap, not drag" and keeps a
     shaky trackpad from silently swallowing the click. */
  const bcard = el('bcard'), bsel = el('bsel');
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
    if (drag || !registry.length || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const r = cv.getBoundingClientRect();
    const hit = pickBuilding(pickMatrix, registry, e.clientX - r.left, e.clientY - r.top, cv.clientWidth, cv.clientHeight, 34);
    cv.style.cursor = hit >= 0 ? 'pointer' : '';
  };
  cv.addEventListener('pointermove', onHover, { passive: true });
  cleanup.push(() => { cv.removeEventListener('pointermove', onHover); cv.style.cursor = ''; });

  function cellIndexAt(cx: number, cz: number): number {
    const size = sizeU.value;
    const gx = Math.min(SIM_N - 1, Math.max(0, Math.floor((cx / size + 0.5) * SIM_N)));
    const gy = Math.min(SIM_N - 1, Math.max(0, Math.floor((cz / size + 0.5) * SIM_N)));
    return gy * SIM_N + gx;
  }

  function paintCard(b: BuildingMeta) {
    const i = cellIndexAt(b.cx, b.cz);
    const localC = heatData[i * 4 + 1];            // G = raw field, the same sample the facade tints from
    const veg = state.base ? state.base.veg[i] : NaN;
    const alb = state.base ? state.base.albedo[i] : NaN;
    const wardMean = state.lastMean[state.ward];

    setText('bcId', `#${b.idx}`);
    /* The building's own coordinate, recovered by inverting the transform that
       created the local frame — so this IS the Overture centroid, not a value
       re-derived from the drawn position. `cz` is the row's northward y. */
    const ll = wardLatLon(WARDS[state.ward], b.cx, b.cz);
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
    setHTML('bcSrc', pk
      ? (pk === 'osm'
          ? 'OpenStreetMap<small>traced by hand</small>'
          : pk === 'google'
            ? `Google Open Buildings<small>model${conf}</small>`
            : `Microsoft ML<small>model${conf}</small>`)
      : '—');
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
  }

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
        const q = projectWard(pickMatrix, nearestCool.x, 1.2, nearestCool.z, w, h);
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
        const q = projectWard(pickMatrix, selected.cx + dx, 1, selected.cz + dz, w, h);
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
    const p = projectWard(pickMatrix, selected.cx, selected.h, selected.cz, w, h);
    if (p.w <= 0) { bcard.style.opacity = '0'; bsel.style.opacity = '0'; return; }
    bcard.style.opacity = '1'; bsel.style.opacity = '1';
    bsel.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    /* Flip to the near side rather than let the card leave the viewport. */
    const side = p.x > w - 268 ? 'left' : 'right';
    bcard.dataset.side = side;
    const dx = side === 'right' ? p.x + 30 : p.x - 260;
    bcard.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(p.y)}px, 0) translateY(-50%)`;
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
      selCtrU.value.set(b.cx, b.cz);
      /* b.ring so the walk is measured from the building's nearest corner, not
         from a point inside it — nobody sets off from the middle of a block. */
      nearestCool = cooling ? nearestCooling(cooling, b.cx, b.cz, SIM_N, sizeU.value, b.ring) : null;
      const lo = coolingLo ? nearestCooling(coolingLo, b.cx, b.cz, SIM_N, sizeU.value, b.ring) : null;
      const hi = coolingHi ? nearestCooling(coolingHi, b.cx, b.cz, SIM_N, sizeU.value, b.ring) : null;
      coolRangeM = lo && hi ? [Math.min(lo.distM, hi.distM), Math.max(lo.distM, hi.distM)] : null;
      /* The tag's value is written HERE, once per selection — placeCard only
         moves it. Rounded to 10 m because the grid cell is 7.3 m. */
      if (nearestCool) {
        el('coolTag')?.removeAttribute('hidden');
        popCoolTag(Math.round(nearestCool.distM / 10) * 10 || 10);
      } else {
        el('coolTag')?.setAttribute('hidden', '');
      }
      if (coolLine && nearestCool) {
        const pos = coolLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, b.cx, 1.2, b.cz);
        pos.setXYZ(1, nearestCool.x, 1.2, nearestCool.z);
        pos.needsUpdate = true;
        coolLine.computeLineDistances();
        coolLine.visible = true;
      } else if (coolLine) coolLine.visible = false;
      if (ringGroup) {
        ringGroup.visible = true;
        for (const m of ringGroup.children) m.position.set(b.cx, 0.75, b.cz);
      }
      coolU.value = 1;
      paintCard(b);
      bcard?.removeAttribute('hidden'); bsel?.removeAttribute('hidden');
      placeCard();
    } else {
      selCtrU.value.set(1e9, 1e9);
      nearestCool = null; coolRangeM = null;
      el('coolTag')?.setAttribute('hidden', '');
      if (coolLine) coolLine.visible = false;
      if (ringGroup) ringGroup.visible = false;
      coolU.value = 0;
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
    if (moved > 6 || !registry.length) return;
    const r = cv.getBoundingClientRect();
    const hit = pickBuilding(pickMatrix, registry, e.clientX - r.left, e.clientY - r.top, cv.clientWidth, cv.clientHeight);
    if (hit >= 0) dismissTip();
    select(hit >= 0 ? registry.find(b => b.idx === hit) ?? null : null);
  };
  cv.addEventListener('pointerdown', onPickDown);
  cv.addEventListener('pointerup', onPickUp);
  const onPickKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && selected) select(null); };
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

  /* ── offscreen GPU heat sim + field bridge (R=blur ground · G=raw buildings) ── */
  const simRenderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  let sim: GpuHeatSim | null = null;
  try { sim = new GpuHeatSim(simRenderer); } catch (e) { console.warn('GPU sim unavailable:', (e as Error).message); }
  const heatData = new Float32Array(SIM_N * SIM_N * 4);
  /* Colour-ramp bounds for the CURRENT forcing. Recomputed whenever the phase,
     pathway or live ambient changes, and shared by the ground overlay, the
     facades and the histogram so all three always speak the same scale.
     Ward-independent by construction — see rampBounds() in heat-map-model. */
  let ramp: [number, number] = [M.RAMP_MIN, M.RAMP_MAX];
  const heatTex = new THREE.DataTexture(heatData, SIM_N, SIM_N, THREE.RGBAFormat, THREE.FloatType);
  heatTex.minFilter = heatTex.magFilter = THREE.LinearFilter; heatTex.needsUpdate = true;
  const blurTmp = new Float32Array(SIM_N * SIM_N);
  let fieldDirty = false;
  function bridgeField() {
    if (!sim || !sim.gridN) return;
    const t = sim.temperature(), n = SIM_N;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= n) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= n) continue; s += t[yy * n + xx]; c++; } } blurTmp[y * n + x] = s / c; }
    for (let i = 0; i < blurTmp.length; i++) { heatData[i * 4] = blurTmp[i]; heatData[i * 4 + 1] = t[i]; }
    heatTex.needsUpdate = true; fieldDirty = true; map.triggerRepaint();
  }

  /* ── shared shader uniforms ── */
  const growU = { value: 1 }, studioU = { value: 0 }, sizeU = { value: 1400 }, tintU = { value: 1 };
  const noise01 = M.noise01;

  /* Shared uniform objects so the facade shader tracks the ramp without being
     recompiled — assigning a new {value:…} each frame would not reach the GPU. */
  const heatMinU = { value: M.RAMP_MIN }, heatMaxU = { value: M.RAMP_MAX };

  /* Selected-building highlight. Keyed on the CENTROID, not a new id attribute:
     every vertex already carries `aCtr`, so one vec2 uniform lights exactly one
     building with no extra buffer and no geometry rebuild. Parked far outside any
     ward (half-extent is 700 m) so nothing matches while nothing is selected. */
  const selCtrU = { value: new THREE.Vector2(1e9, 1e9) };

  /* ── facade material (grow-in · live tint · line-art · tint modes) ── */
  function makeFacade() {
    const m = new THREE.MeshStandardMaterial({ roughness: .84, metalness: .05 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGrow = growU; sh.uniforms.uStudio = studioU; sh.uniforms.uSize = sizeU; sh.uniforms.uTintMode = tintU;
      sh.uniforms.tField = { value: heatTex };
      sh.uniforms.uHeatMin = heatMinU; sh.uniforms.uHeatMax = heatMaxU;
      sh.uniforms.uSelCtr = selCtrU;
      sh.vertexShader = 'attribute float aDelay; attribute float aH; attribute vec2 aCtr;\n'
        + 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\n'
        + 'uniform float uGrow; uniform float uSize; uniform sampler2D tField; uniform vec2 uSelCtr;\n'
        + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float gT = clamp((uGrow - aDelay*0.55)/0.45, 0.0, 1.0);
          float gE = 1.0 + 2.70158*pow(gT-1.0,3.0) + 1.70158*pow(gT-1.0,2.0);
          transformed.y *= gE; vFp = transformed; vFn = normal;
          vTop = position.y / max(aH, 0.001);
          vT = texture2D(tField, clamp(aCtr/uSize + 0.5, 0.0, 1.0)).g;
          vSel = 1.0 - step(0.5, distance(aCtr, uSelCtr));`);
      sh.fragmentShader = 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\n'
        + 'uniform float uStudio, uSize, uHeatMin, uHeatMax, uTintMode; uniform sampler2D tField;\n'
        + 'float dh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
        + 'vec3 rampc(float t){ vec3 c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);\n'
        + '  return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.)); }\n'
        + sh.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          vec3 fn=normalize(vFn); bool wall=abs(fn.y)<0.5; bool studio = uStudio > 0.5;
          vec2 fuv = clamp(vFp.xz/uSize + 0.5, 0.0, 1.0);
          float T = uTintMode < 0.5 ? texture2D(tField, fuv).r : vT;
          float t = clamp((T-uHeatMin)/(uHeatMax-uHeatMin), 0.0, 1.0);
          if (uTintMode > 1.5) t = t<.35 ? 0.17 : t<.6 ? 0.48 : t<.8 ? 0.70 : t<.9 ? 0.85 : 0.97;
          float heatW = smoothstep(0.10, 0.52, t);
          vec3 clay = studio ? vec3(0.925,0.916,0.902) : vec3(0.30,0.325,0.335);
          vec3 body = mix(clay, rampc(t), heatW * (studio ? 0.92 : 1.0));
          body *= mix(0.95, 1.05, dh(floor(vFp.xz*0.05)));
          if (wall){
            float fy = fract(vFp.y/3.3);
            float floorLine = 1.0 - smoothstep(0.05, 0.11, min(fy, 1.0-fy));
            float colAxis = abs(fn.x)>abs(fn.z)? vFp.z : vFp.x;
            float fx = fract(colAxis/3.4);
            float mull = 1.0 - smoothstep(0.035, 0.075, min(fx, 1.0-fx));
            float stroke = max(floorLine, mull*0.55);
            vec3 lineCol = studio ? body*0.70 : body*1.7 + vec3(0.015);
            body = mix(body, lineCol, stroke*0.8);
            body = mix(body, studio ? clay*1.05 : body*1.55, smoothstep(0.945, 0.985, vTop));
          } else {
            body *= studio ? 0.97 : 0.90;
            float spk = uTintMode < 0.5 ? 1.0 : 0.35;
            body *= mix(1.0, mix(0.93, 1.05, dh(floor(vFp.xz*0.7))), spk);
          }
          float ao = mix(studio ? 0.76 : 0.58, 1.0, smoothstep(0.0, 14.0, vFp.y));
          body *= ao;
          /* Selected building: lift toward the brand cyan and brighten its top
             edge, so it reads as picked without hiding the heat tint that is the
             whole point of the surface. Everything else is untouched — no clay
             recede, no dimming pass. */
          if (vSel > 0.5) {
            body = mix(body, vec3(0.027, 0.788, 0.992), 0.42);
            body += vec3(0.10, 0.16, 0.18) * smoothstep(0.90, 0.99, vTop);
          }
          diffuseColor.rgb = body;`);
    };
    return m;
  }
  const facade = makeFacade();

  /* ── click-to-inspect state (see explore/building-pick.ts for why it is not a raycast) ── */
  const pickMatrix = new THREE.Matrix4();
  let registry: BuildingMeta[] = [];
  let selected: BuildingMeta | null = null;

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
  const coolU = { value: 0 };
  let ringGroup: THREE.Group | null = null;
  let cooling: CoolingSurfaces | null = null;
  let coolingLo: CoolingSurfaces | null = null;   // veg >= 0.45, the generous reading
  let coolingHi: CoolingSurfaces | null = null;   // veg >= 0.55, the strict one
  let nearestCool: { x: number; z: number; distM: number } | null = null;
  let coolRangeM: [number, number] | null = null;

  /* Dashed line from the selected building to its nearest cooling cell — shows
     WHICH patch won, and the dashes say "straight line, not a route" without a
     word of copy. Two vertices, repositioned per selection, transparent-pass so
     buildings occlude it correctly. */
  let coolLine: THREE.Line | null = null;
  function buildCoolLine() {
    if (coolLine || !threeScene) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    coolLine = new THREE.Line(g, new THREE.LineDashedMaterial({
      color: 0x59b489, transparent: true, opacity: 0.85, dashSize: 7, gapSize: 6, depthWrite: false,
    }));
    coolLine.visible = false;
    coolLine.renderOrder = -1;
    threeScene.add(coolLine);
  }

  function buildRings() {
    if (ringGroup || !threeScene) return;
    ringGroup = new THREE.Group();
    ringGroup.visible = false;
    for (const { r } of RINGS) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uCol: { value: new THREE.Color(0x6fcad6) }, uOp: { value: 0.85 }, uDash: { value: r > 500 ? 1 : 0 } },
        vertexShader: `varying vec3 vW; varying float vA;
          void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; vA=atan(position.y, position.x);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        /* The 10-minute ring is 800 m from a point inside a 1,400 m window, so it
           necessarily leaves the study area. Rather than draw a confident circle
           over ground we have no data for, it fades out at the boundary — and
           its label says so in words. */
        fragmentShader: `varying vec3 vW; varying float vA; uniform vec3 uCol; uniform float uOp,uDash;
          void main(){ float edge = 1.0 - smoothstep(600.0, 700.0, max(abs(vW.x), abs(vW.z)));
            float dash = uDash > 0.5 ? step(0.42, fract(vA*7.0)) : 1.0;
            float a = uOp*edge*dash; if(a < 0.01) discard; gl_FragColor=vec4(uCol, a); }`,
      });
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 2.4, r + 2.4, 128), mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = -1;                          // with the ground overlay, under the city
      ringGroup.add(m);
    }
    threeScene.add(ringGroup);
  }

  /* ── three.js custom layer (shares MapLibre's GL context) ── */
  let threeScene: THREE.Scene | null = null, threeCam: THREE.Camera, threeRenderer: THREE.WebGLRenderer;
  let cityMesh: THREE.Mesh | null = null, overlay: THREE.Mesh;
  /* The scene's north flip, as a matrix, for pickMatrix. Kept as a constant rather
     than read from `threeScene.matrixWorld` so it cannot be a frame stale — the
     pick matrix is built inside render(), before three has necessarily refreshed
     the scene graph. */
  const NORTH_FLIP = new THREE.Matrix4().makeScale(1, 1, -1);
  /* `frame` carries the ANISOTROPIC metre→mercator scale (ward-frame.ts): east and
     north differ by 0.7 %, which is ~4 m at the rim of a 1,400 m window. It used to
     be one `scale` for both axes. */
  let modelTransform:
    { x: number; y: number; z: number; frame: WardFrame } | null = null;
  let hemiL: THREE.HemisphereLight, keyL: THREE.DirectionalLight, rimL: THREE.DirectionalLight;
  /* The ENVIRONMENT's own key intensity, kept separately because the cloud deck
     scales it every frame. Writing `2.1 * sunFactor` directly would clobber the
     studio environment's dimmer 1.7 on the very next repaint — the deck would
     silently drag clay studio back to the dark map's lighting. */
  let keyBase = 2.1;
  const customLayer: maplibregl.CustomLayerInterface = {
    id: 'delta-city', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      if (threeRenderer) return;
      threeScene = new THREE.Scene();
      /* THE MIRROR FIX. MapLibre's mercator y grows SOUTHWARD; every producer in
         this engine puts the data's northing into world +z (buildings via
         `Shape(x,−y)` + rotateX, roads directly). Composed, that drew each ward
         reflected about its own east–west centre line — every building on the
         wrong side of its street. It read as "buildings on roads" and was
         misdiagnosed three times as basemap road-casing width.

         The reflection lives HERE, on the scene node, and not in the projection
         matrix, for one reason: WebGLRenderer picks `gl.frontFace` from
         `matrixWorld.determinant()`. It never inspects `threeCam.projectionMatrix`.
         Flip the sign in the matrix instead and the composite silently becomes
         orientation-reversing, culling every FrontSide material in the scene — the
         facades, the heat overlay, the water sheets and the cloud shadows. Only
         the rings and roads are DoubleSide and would survive.
         Put it here and three flips winding and the normal matrix for us.

         `NORTH_FLIP` mirrors this for pickMatrix, which must agree exactly. */
      threeScene.scale.set(1, 1, -1);
      hemiL = new THREE.HemisphereLight(0xbfe2e8, 0x0a1518, 1.05); threeScene.add(hemiL);
      keyL = new THREE.DirectionalLight(0xffffff, 2.1); keyL.position.set(0.4, 1, 0.35); threeScene.add(keyL);
      rimL = new THREE.DirectionalLight(0x6fcad6, 0.5); rimL.position.set(-0.5, 0.4, -0.5); threeScene.add(rimL);
      threeCam = new THREE.Camera();
      threeRenderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      threeRenderer.autoClear = false;
      /* Segmented, so the ground can carry relief. A flat quad cannot bend, and
         128² matches the terrain field exactly — one vertex per texel, no
         resampling. The plane stays 1×1 in local space and is scaled to the ward
         in metres, so displacement is applied in the same units as the field. */
      overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, TERRAIN_N - 1, TERRAIN_N - 1), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { tT: { value: heatTex }, uMin: heatMinU, uMax: heatMaxU, uOp: { value: 0.5 }, uCool: coolU },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform sampler2D tT; uniform float uMin,uMax,uOp,uCool;
          vec3 ramp(float t){ vec3 cA=vec3(.204,.412,.529),cB=vec3(.318,.635,.729),c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);
            if(t<0.0) return t<-.20 ? mix(cB,cA,clamp((-t-.20)/.30,0.,1.)) : mix(c0,cB,-t/.20);
            return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.)); }
          void main(){ vec4 F=texture2D(tT, vec2(vUv.x, 1.0-vUv.y)); float t=clamp((F.r-uMin)/(uMax-uMin),-0.5,1.);
            float edge=smoothstep(0.0,0.16, min(min(vUv.x,1.0-vUv.x), min(vUv.y,1.0-vUv.y)));
            /* B carries the cooling-surface mask (see explore/cooling-surfaces.ts).
               It rides the field texture's spare channel, so showing it costs no
               second plane, no second texture and no extra overdraw. */
            float cool = F.b * uCool;
            vec3 col = mix(ramp(t), vec3(.353,.722,.541), cool*0.62);
            gl_FragColor=vec4(col, (uOp + cool*0.16)*edge); }`,
      }));
      overlay.rotation.x = -Math.PI / 2; overlay.position.y = 0.6; overlay.renderOrder = -1; threeScene.add(overlay);
      buildRings();
      buildCoolLine();
    },
    render(_gl, matrix) {
      if (!modelTransform || !threeScene) return;
      const f = modelTransform.frame;
      /* Sign structure UNCHANGED from the version that shipped mirrored — the fix
         is NORTH_FLIP on the scene, not here. What changed is that the three axes
         now carry three different scales (ward-frame.ts). */
      const l = new THREE.Matrix4()
        .makeTranslation(modelTransform.x, modelTransform.y, modelTransform.z)
        .scale(new THREE.Vector3(f.east, -f.north, f.up))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      threeCam.projectionMatrix = new THREE.Matrix4().fromArray(matrix as unknown as number[]).multiply(l);
      /* Keep the exact matrix the vertex shader is about to use, INCLUDING the
         scene's north flip — building-pick projects raw ward metres with this, and
         without the flip a hit test would land on the mirror image of the building
         under the cursor. Silent, and only visible as "clicking picks the wrong
         building", which is how this class of bug hides. */
      pickMatrix.copy(threeCam.projectionMatrix).multiply(NORTH_FLIP);
      /* The water shimmer advances only here — it rides whatever repaints the
         map already does (orbit, drags, the sim bridge). Reduced motion means
         still water, by never advancing the clock. */
      if (waterLayer) {
        /* The specular streak needs the map's own view direction — the three
           camera here carries a hand-assigned projection matrix and no usable
           world transform, so it is taken from MapLibre each frame. */
        waterLayer.setView(map.getBearing(), map.getPitch());
        if (!reduceMotion) waterLayer.setTime(performance.now() / 1000);
      }
      /* The deck rides the same repaints the water does. Reduced motion holds it
         at a still frame on the measured cover rather than animating slower.
         A null reading draws nothing — an invented sky is the loader's deleted
         land dust all over again. */
      if (cloudLayer && state.live) {
        cloudLayer.update(
          reduceMotion ? 0 : performance.now() / 1000,
          state.live.cloud / 100, state.live.wind, state.live.windFrom ?? 0,
          state.phase === 'night',
        );
        keyL.intensity = keyBase * cloudLayer.sunFactor(state.live.cloud / 100);
      }
      threeRenderer.resetState();
      threeRenderer.render(threeScene, threeCam);
      /* The deck drifts when nothing else is changing, so it needs its own repaint
         reason — but only when there is wind to drift on, and never under reduced
         motion. This is the one new source of continuous repaint. */
      const drifting = !reduceMotion && !!cloudLayer && (state.live?.wind ?? 0) > 0;
      if (growU.value < 1 || fieldDirty || drifting) { fieldDirty = false; map.triggerRepaint(); }
    },
  };

  /**
   * Bend the heat overlay onto the ward's ground.
   *
   * THE FRAME. The plane is rotated −90° about X, which sends local (x, y, z) to
   * world (x, z, −y). So local Z displacement IS world height, and the terrain is
   * sampled at world (x, z) = (localX·sizeM, −localY·sizeM). Local scale Z stays 1,
   * so metres in the field are metres on screen — no unit conversion anywhere.
   *
   * A null field flattens the plane rather than leaving the previous ward's
   * relief behind, which is what makes a failed fetch look like the old flat map
   * instead of a wrong one.
   */
  function displaceGround(field: TerrainField | null, sizeM: number): void {
    if (!overlay) return;
    const pos = overlay.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, terrainDrawAt(field, pos.getX(i) * sizeM, -pos.getY(i) * sizeM));
    }
    pos.needsUpdate = true;
    overlay.geometry.computeVertexNormals();
  }

  /* ── heat ramp for building extrusion vertex jitter (grow) — via aCtr sample ── */
  const cache: Record<string, M.WardData> = {}, roadsCache: Record<string, M.RoadsData> = {};
  const waterCache: Record<string, M.WaterData> = {};
  /* Render-only ground. `undefined` means unfetched, `null` means fetched-and-absent —
     the distinction stops a failed fetch retrying on every ward switch. */
  const terrainCache: Record<string, TerrainField | null> = {};
  let waterLayer: WaterLayer | null = null;
  let cloudLayer: CloudLayer | null = null;
  /* Street names, in lon/lat. Cached per ward like the other artefacts; absence
     is normal and draws nothing, the loader idiom water and roads already use. */
  const labelCache: Record<string, unknown> = {};
  /* Footprint provenance, row-indexed parallel to the ward's `b` array. Two thirds
     of Ballygunge is hand-traced OSM and 99 % of Baruipur is model output — a
     difference nothing on screen showed until this shipped. */
  const provCache: Record<string, { src: string[]; confidence: number[] } | null> = {};
  let roadLayer: RoadLayer | null = null;
  /* Measured Sentinel-2 surface, one per ward, fetched once. A miss is non-fatal
     and falls back to a flat field at the measured ward mean — never to
     synthesised structure. */
  const surfaceCache: Record<string, WardSurface> = {};
  let growStart = 0; const GROW_MS = 1900; let opBase = 0.5;

  /* DC-URS baseline inputs — observed, loaded once and shared by every ward.
     Failure is non-fatal: the heat field still works, the score reports itself
     unavailable rather than inventing one. */
  /* The heatwave scenario's air temperature: p99 of 74 years of IMD daily maxima.
     A miss leaves it null, which makes the Heatwave button inert rather than
     pushing undefined into the physics — the swallow-to-empty posture the roads
     and water loaders take. */
  let heatwaveP99: number | null = null;
  async function loadHeatwave() {
    if (heatwaveP99 != null) return;
    try {
      const r = await fetch('/heat-map/data/heatwave-percentiles.json');
      if (r.ok) heatwaveP99 = (await r.json())?.tmaxC?.p99 ?? null;
    } catch { heatwaveP99 = null; }
  }

  async function loadDcUrs() {
    if (state.dcurs) return;
    try {
      const r = await fetch('/heat-map/data/dc-urs-inputs.json');
      state.dcurs = (await r.json()).wards as Record<string, DcUrsInputs>;
    } catch { state.dcurs = null; }
  }

  async function loadWard(name: string) {
    const load = el('loadchip'); load?.classList.add('on');
    await new Promise(r => setTimeout(r, 30));
    await loadDcUrs();
    await loadHeatwave();
    if (!cache[name]) cache[name] = await (await fetch(`/heat-map/data/${name}.json`)).json();
    const d = cache[name], w = WARDS[name]; state.ward = name; updateCompareHref();

    /* Rebuild the pick registry from the SAME rows the extrusions come from, and
       drop any selection: building #1759 in Ballygunge is a different building in
       Baruipur, so carrying the index across a ward switch would lie. */
    select(null);
    registry = buildRegistry(d.b);

    /* Terrain must land BEFORE any geometry is built: the buildings, the ground
       plane and the water bodies all seat themselves on it, so a late fetch would
       leave three layers at three different vintages of the same ward. It is
       RENDER-ONLY — never passed to rasterWardBase, never in SimLayers — and a
       miss leaves the ward flat, which is exactly how the map looked before
       terrain existed. */
    if (terrainCache[name] === undefined) {
      try { terrainCache[name] = asTerrainField(await (await fetch(`/heat-map/data/${name}-terrain.json`)).json()); }
      catch { terrainCache[name] = null; }
    }

    const geos: THREE.BufferGeometry[] = [], halfM = d.sizeM / 2;
    for (const b of d.b) {
      const shape = new THREE.Shape(); shape.moveTo(b[1], -b[2]);
      for (let i = 3; i < b.length; i += 2) shape.lineTo(b[i], -b[i + 1]);
      let g: THREE.ExtrudeGeometry;
      try { g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.6, b[0] - 1.4), bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.55, bevelSegments: 1 }); }
      catch { try { g = new THREE.ExtrudeGeometry(shape, { depth: b[0], bevelEnabled: false }); } catch { continue; } }
      g.rotateX(-Math.PI / 2);
      const delay = Math.min(1, Math.hypot(b[1], b[2]) / halfM) * 0.72 + noise01(b[2], b[1]) * 0.28;
      let cxm = 0, czm = 0; const np = (b.length - 1) / 2;
      for (let k = 1; k < b.length; k += 2) { cxm += b[k]; czm += b[k + 1]; } cxm /= np; czm /= np;
      /* Seat the building on the ground at its own centroid. BASE ONLY — the
         extrusion depth above is the measured height and is never exaggerated,
         so the one quantity a reader might measure off the screen stays true
         while the ground beneath it is admittedly stretched. Applied before the
         merge, so the draw-call structure is unchanged. */
      const ty = terrainDrawAt(terrainCache[name] ?? null, cxm, czm);
      if (ty !== 0) g.translate(0, ty, 0);
      const nv = g.attributes.position.count, dls = new Float32Array(nv), hts = new Float32Array(nv), ctr = new Float32Array(nv * 2);
      dls.fill(delay); hts.fill(b[0]); for (let k = 0; k < nv; k++) { ctr[k * 2] = cxm; ctr[k * 2 + 1] = czm; }
      g.setAttribute('aDelay', new THREE.BufferAttribute(dls, 1));
      g.setAttribute('aH', new THREE.BufferAttribute(hts, 1));
      g.setAttribute('aCtr', new THREE.BufferAttribute(ctr, 2));
      geos.push(g);
    }
    sizeU.value = d.sizeM;
    const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
    if (threeScene) {
      if (cityMesh) { threeScene.remove(cityMesh); cityMesh.geometry.dispose(); }
      cityMesh = new THREE.Mesh(merged, facade); threeScene.add(cityMesh);
      overlay.scale.set(d.sizeM, d.sizeM, 1);
    displaceGround(terrainCache[name] ?? null, d.sizeM);
    /* The exaggeration is stated wherever the ground is drawn. Two independent
       DEMs disagree about this relief by roughly a quarter of it, so an
       unlabelled ×4 would be a claim we cannot support — and a claim about slope
       that nobody made out loud is the easiest kind to be caught by. */
    const terrLab = el('terrLab');
    if (terrLab) terrLab.textContent = terrainLabel(terrainCache[name] ?? null) || 'unavailable';

      /* OSM water for this ward — render only, absence is normal (the loader
         idiom roads already use). The layer shares uGrow, so water fades in
         with the same reconstruction the buildings play. */
      if (!waterCache[name]) {
        waterCache[name] = await fetch(`/heat-map/data/${name}-water.json`)
          .then(r => (r.ok ? r.json() : { polys: [] }))
          .catch(() => ({ polys: [] }));
      }
      if (waterLayer) { threeScene.remove(waterLayer.mesh); waterLayer.dispose(); waterLayer = null; }
      const wl = createWaterLayer(waterCache[name], growU,
        (x, y) => terrainDrawAt(terrainCache[name] ?? null, x, y));
      if (wl) { waterLayer = wl; threeScene.add(wl.mesh); }
      /* Baked once and kept across ward switches — cloud is weather, not geography.
         Only the drape reference changes, and the deck is far enough above the
         ground for that to be immaterial. */
      if (!cloudLayer) {
        cloudLayer = createCloudLayer((x, y) => terrainDrawAt(terrainCache[name] ?? null, x, y));
        threeScene.add(cloudLayer.group);
      }
    }
    const mc = maplibregl.MercatorCoordinate.fromLngLat([w.lon, w.lat], 0);
    /* The scale comes from ward-frame.ts, not from mc.meterInMercatorCoordinateUnits()
       alone: that number is MapLibre's sphere, and our data's metres are not its
       metres. Using it for both axes stretched north by 0.593 % — ~4 m at the rim,
       growing with |y|. Only the ALTITUDE term is still MapLibre's own, because
       building heights never pass through the ward frame. */
    modelTransform = { x: mc.x, y: mc.y, z: mc.z ?? 0, frame: wardMercatorScale(w.lat) };

    /* Vegetation and albedo are MEASURED per cell, from Sentinel-2, and pinned to
       the same ward means the resilience score reads. loadWardSurface verifies
       that pairing before either reaches the model, so the map and the score
       cannot end up drawn from different vintages of the same measurement. */
    surfaceCache[name] ??= await loadWardSurface(name);
    const { means, surface } = surfaceCache[name];
    state.base = rasterWardBase(d, means, surface);
    if (!roadsCache[name]) { try { roadsCache[name] = await (await fetch(`/heat-map/data/${name}-roads.json`)).json(); } catch { roadsCache[name] = { ways: [] }; } }
    /* Street names for this ward. Separate artefact, separate frame: these are
       lon/lat and go to MapLibre directly, so they never pass through our metre
       frame and act as a standing check on the geometry that does. */
    if (!labelCache[name]) {
      labelCache[name] = await fetch(`/heat-map/data/${name}-road-labels.geojson`)
        .then(r => (r.ok ? r.json() : EMPTY_LABELS))
        .catch(() => EMPTY_LABELS);
    }
    (map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined)
      ?.setData(labelCache[name] as never);
    if (provCache[name] === undefined) {
      provCache[name] = await fetch(`/heat-map/data/${name}-provenance.json`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    state.spatial = M.buildSpatial(d, state.base, roadsCache[name]);
    /* The same artefact, drawn. RENDER ONLY: buildSpatial above owns the sim's
       road corridor and keeps its own, much wider, tree-planting radius — see
       road-ribbon.ts. Rebuilt per ward because the ribbons are draped on that
       ward's ground. */
    if (threeScene) {
      if (roadLayer) { threeScene.remove(roadLayer.mesh); roadLayer.dispose(); roadLayer = null; }
      const rl = createRoadLayer(roadsCache[name], growU,
        (x, y) => terrainDrawAt(terrainCache[name] ?? null, x, y));
      if (rl) { roadLayer = rl; threeScene.add(rl.mesh); }
    }
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
    for (let i = 0; i < SIM_N * SIM_N; i++) heatData[i * 4 + 2] = cooling.mask[i];
    heatTex.needsUpdate = true;
    state.live = liveCache[name] ?? null; paintLive();
    resetSim();

    setHTML('pname', w.name); setText('pzone', w.zone); setText('coord', w.coord);
    setText('bcount', `${d.count.toLocaleString()} real buildings`);
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('on', (t as HTMLElement).dataset.w === name));
    document.querySelectorAll('#strip .ward').forEach(t => t.classList.toggle('on', (t as HTMLElement).dataset.w === name));
    load?.classList.remove('on');

    const dur = cityMesh ? 1400 : 0;
    orbit = false; clearTimeout(orbitResume);
    map.flyTo({ center: [w.lon, w.lat], zoom: 15.3, pitch: mode === 'iso' ? 0 : 60, bearing: mode === 'iso' ? 0 : -18, duration: dur });
    orbitResume = window.setTimeout(() => { if (!reduceMotion && mode === 'relief') orbit = true; }, dur + 600);
    if (reduceMotion) growU.value = 1; else { growU.value = 0; growStart = performance.now() + dur * 0.45; }
    fetchLive(name);
  }

  function resetSim() {
    if (!sim || !state.base) return;
    /* Re-read the sun before every reset, so the FIRST simulation of the session
       is already at the right elevation. `sunNow` starts at 0 purely as a "live
       mode is on" sentinel; without this the opening frame would run night
       physics at noon and then visibly flip when the stats tick corrected it. */
    refreshNowSun();
    const p = M.currentParams(state);
    state.baselineMean = M.eqMean(state.base, { ...p, Q: DEFAULT_PARAMS.Q });
    const layers = M.applyInterventions(state.base, state.iv, state.spatial);
    state.greenG = M.computeGreenG(layers);
    sim.reset({ n: SIM_N, cellMeters: cache[state.ward].sizeM / SIM_N }, layers, p);
    sim.step(1, RESET_BURST); bridgeField(); refreshStats();
  }

  /* ── live ambient (Met Norway direct; production proxies via /api/ambient) ── */
  const liveCache: Record<string, M.Ambient> = {};
  /* ── live-reading freshness dial ──
     met.no publishes hourly, so a reading is at worst an hour behind reality by
     construction: FRESH covers that. Past two hours the sim is running on
     weather that has had time to change, and past six it is a different day's
     shape — the ring goes red and says so rather than pulsing green forever. */
  const AGE_FRESH_MIN = 90, AGE_STALE_MIN = 360;

  /* IANA zone, not a fixed offset. A hardcoded +5:30 happens to be right for
     India, which observes no DST — but it is right by luck, and it is the first
     thing that breaks when a European or East Asian ward is added. Intl reads
     the zone database and handles the transitions we do not have yet. */
  const WARD_TZ = 'Asia/Kolkata';
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
    /* The dot claims "live"; it may only do so while the reading still is. */
    const mins = ageMinutes(L?.validAt);
    el('livedot')?.classList.toggle('on', !!L && (mins === null || mins <= AGE_STALE_MIN));
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
  async function fetchLive(name: string, force = false) {
    const w = WARDS[name];
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
        const ts = (await r.json()).properties.timeseries[0];
        const dd = ts.data.instant.details;
        /* `ts.time` is the hour this reading is VALID FOR, which is what the
           dial must show — not the moment we happened to fetch it. They differ
           by up to an hour and only the former is a property of the data. */
        liveCache[name] = { tAir: dd.air_temperature, rh: dd.relative_humidity, wind: dd.wind_speed, cloud: dd.cloud_area_fraction ?? 0, windFrom: dd.wind_from_direction, feels: M.heatIndexC(dd.air_temperature, dd.relative_humidity), validAt: ts.time };
      }
      if (state.ward !== name) return;
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
      tag.textContent = transition
        ? `outside validation · ~±${TRANSITION_RMSE_K.toFixed(1)} °C at this hour`
        : a.confidence === 'quantitative'
          ? `calibrated · ±${a.bandK.toFixed(1)} °C (n=${a.n})`
          : `indicative only · ±${a.bandK.toFixed(1)} °C (n=${a.n})`;
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
    heatMinU.value = ramp[0]; heatMaxU.value = ramp[1];
    const sc = el('rampSc');
    // A narrow span needs a decimal: the retained phase can be 3 K wide, where
    // whole degrees print "24 · 24 · 25 · 26 · 27" — a repeated label reads as a
    // rendering bug and tells the reader nothing about the gradient.
    const dp = ramp[1] - ramp[0] < 8 ? 1 : 0;
    if (sc) sc.innerHTML = [0, .25, .5, .75, 1]
      .map(f => `<span>${(ramp[0] + (ramp[1] - ramp[0]) * f).toFixed(dp)}</span>`).join('');
  }

  const histo = el('histo'); if (histo) for (let i = 0; i < 12; i++) histo.appendChild(document.createElement('i'));
  function refreshStats() {
    if (!sim || !sim.gridN) return;
    const st = sim.stats(40), t = sim.temperature();
    const lst = el('lst');
    if (lst) {
      // The band is measured, not decorative: it is this model's out-of-sample
      // error against ECOSTRESS for the phase on screen. See accuracy.ts.
      lst.innerHTML = `${st.meanC.toFixed(1)}<span class="u">°C</span>`
        + `<span class="band">${bandLabel(state.phase)}</span>`;
      (lst as HTMLElement).style.color = lstColor(st.meanC);
    }
    applyConfidence();
    const p = M.currentParams(state), kk = p.kRad + p.h * p.wind;
    syncRamp(p);
    const ruralRef = (p.S * 0.75 * p.sun - p.L + p.kRad * p.tSky + p.h * p.wind * p.tAir) / kk, uhi = st.meanC - ruralRef;
    setText('uhi', `${uhi >= 0 ? '+' : ''}${uhi.toFixed(1)}°`);
    setText('area', `${(st.fracAbove * 100).toFixed(0)}%`);
    const bins = new Array(12).fill(0);
    for (let i = 0; i < t.length; i++) { const b = Math.min(11, Math.max(0, ((t[i] - ramp[0]) / (ramp[1] - ramp[0]) * 12) | 0)); bins[b]++; }
    const mx = Math.max(...bins, 1);
    histo?.childNodes.forEach((elm, i) => { (elm as HTMLElement).style.height = `${Math.max(4, bins[i] / mx * 100)}%`; });
    const iv = state.iv;
    const cost = M.computeCost(iv, state.spatial);
    const anyIv = iv.trees || iv.roof || iv.parks || iv.facades;

    /* ── DC-URS ────────────────────────────────────────────────────────────
       One score, evaluated twice: the observed baseline, and the same ward with
       the sliders' modelled changes applied. The ward-mean surface temperature
       the heat field just produced feeds the thermal pillar, so the physics and
       the index describe the same scenario. */
    const base = state.dcurs?.[state.ward];
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
        chip.textContent = `best case · up to ${gap.points.toFixed(1)} pts lower`;
        (chip as HTMLElement).title = unmeasuredNote(gap.fields, gap.points);
      }
      // The error sits entirely inside exposure. Mark where it lives, in the
      // colour this instrument already uses for "not decision-grade".
      el('sCool')?.classList.toggle('soft', gap.fields.includes('socioVuln'));

      setHTML('scoreTxt', anyIv
        ? `${(now - U.dcUrs(base)).toFixed(1)} pts from this plan · ₹${M.fmtCr(cost)}<br>${tier.guidance}`
        // `headroom` is exactly invariant to the missing input — it shifts ceiling
        // and current equally — so it needs no hedge. `withheld` only ever RISES,
        // so one word makes it true instead of understated by a quarter.
        : `${floor.headroom.toFixed(0)} pts reachable · <b>${gap.points > 0.05 ? 'at least ' : ''}`
          + `${floor.withheld.toFixed(0)} withheld</b> by exposure`);
    } else {
      setText('scoreNum', '—');
      setHTML('scoreTxt', 'resilience inputs unavailable');
    }
    state.lastMean[state.ward] = st.meanC;
    setHTML(`big-${state.ward}`, `${st.meanC.toFixed(1)}<span>°C mean</span>`);
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

  /* ── DOM helpers ── */
  function setText(id: string, v: string) { const e = el(id); if (e) e.textContent = v; }
  function setHTML(id: string, v: string) { const e = el(id); if (e) e.innerHTML = v; }
  function updateCompareHref() {
    const link = el('compare-mode-link') as HTMLAnchorElement | null;
    if (!link) return;
    const params = new URLSearchParams({
      a: state.ward,
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
  document.querySelectorAll('#tabs .tab, #strip .ward').forEach(t => onEl(t, 'click', () => { nudgeOrbit(); loadWard((t as HTMLElement).dataset.w!); }));
  const bindSlider = (id: string, label: string, kk: keyof M.Interventions, fmt: (v: string) => string) => {
    const s = el(id) as HTMLInputElement | null; if (!s) return;
    onEl(s, 'input', () => { setText(label, fmt(s.value)); nudgeOrbit(); });
    onEl(s, 'change', () => { state.iv[kk] = +s.value; updateCompareHref(); resetSim(); });
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
    const lon = WARDS[state.ward]?.lon ?? 88.3659;
    const utcH = (now() / 3_600_000) % 24;
    return ((utcH + lon / 15) % 24 + 24) % 24;
  }
  function refreshNowSun() {
    if (state.sunNow === undefined || state.sunNow === null) return;
    const h = wardSolarHour();
    const doy = Math.floor((now() - Date.UTC(new Date(now()).getUTCFullYear(), 0, 0)) / 86_400_000);
    state.sunNow = solarElevationFactor(h, doy, WARDS[state.ward]?.lat ?? 22.55);
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
    updateCompareHref(); resetSim();
  }));
  document.querySelectorAll('#segPath button').forEach(b => onEl(b, 'click', () => { state.path = (b as HTMLElement).dataset.p!; document.querySelectorAll('#segPath button').forEach(x => x.classList.toggle('on', x === b)); resetSim(); }));
  document.querySelectorAll('#modechip button').forEach(b => onEl(b, 'click', () => {
    mode = (b as HTMLElement).dataset.m === 'iso' ? 'iso' : 'relief';
    document.querySelectorAll('#modechip button').forEach(x => x.classList.toggle('on', x === b));
    if (mode === 'iso') { orbit = false; map.easeTo({ pitch: 0, bearing: 0, duration: 900 }); }
    else { map.easeTo({ pitch: 60, duration: 900 }); if (!reduceMotion) orbitResume = window.setTimeout(() => { orbit = true; }, 1100); }
  }));
  document.querySelectorAll('#tintchip button').forEach(b => onEl(b, 'click', () => { tintU.value = +((b as HTMLElement).dataset.t!); document.querySelectorAll('#tintchip button').forEach(x => x.classList.toggle('on', x === b)); map.triggerRepaint(); }));
  function setEnv(e: string) {
    if (e === env) return; env = e; const s = e === 'studio';
    document.body.classList.toggle('studio', s); studioU.value = s ? 1 : 0; opBase = s ? 0.42 : 0.5;
    if (hemiL) { if (s) { hemiL.color.set(0xffffff); hemiL.groundColor.set(0xd8d2c8); hemiL.intensity = 1.45; keyBase = 1.7; keyL.intensity = keyBase; rimL.intensity = 0.12; } else { hemiL.color.set(0xbfe2e8); hemiL.groundColor.set(0x0a1518); hemiL.intensity = 1.05; keyBase = 2.1; keyL.intensity = keyBase; rimL.intensity = 0.5; } }
    document.querySelectorAll('#envchip button').forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.e === e));
    map.setStyle(STYLES[e as 'dark' | 'studio']); map.once('style.load', () => { map.addLayer(customLayer); map.triggerRepaint(); });
  }
  document.querySelectorAll('#envchip button').forEach(b => onEl(b, 'click', () => setEnv((b as HTMLElement).dataset.e!)));

  /* ── sim loop (offscreen) + grow timeline ── */
  let frame = 0;
  function simFrame() {
    if (!reduceMotion && growU.value < 1 && growStart) { growU.value = Math.min(1, Math.max(0, (performance.now() - growStart) / GROW_MS)); map.triggerRepaint(); }
    if (overlay) (overlay.material as THREE.ShaderMaterial).uniforms.uOp.value = opBase * Math.min(1, growU.value * 1.6);
    if (sim && sim.gridN && !reduceMotion && !drag) { sim.step(1, 2); if (++frame % 40 === 0) { bridgeField(); refreshStats(); } }
    simId = raf(simFrame);
  }
  let simId = raf(simFrame);

  /* ── boot ── */
  /* This handler is `on`, not `once` — setEnv's setStyle re-fires it, which is
     what keeps the basemap's road layers hidden across an environment switch. */
  map.on('style.load', () => {
    map.addLayer(customLayer);
    /* Our own street names, in the BASEMAP's frame. Added after customLayer so
       symbols draw above the 3D scene and are never eaten by a tower. */
    if (!map.getSource(LABEL_SOURCE)) {
      map.addSource(LABEL_SOURCE, { type: 'geojson', data: EMPTY_LABELS as never });
    }
    if (!map.getLayer(LABEL_LAYER)) {
      map.addLayer(labelLayerSpec(env === 'studio' ? 'studio' : 'dark') as never);
    }
    const cached = labelCache[state.ward];
    if (cached) (map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource)?.setData(cached as never);
    /* The basemap paints these in SCREEN PIXELS — a cartographic stroke that
       matches no width on the ground and does not narrow as you zoom in. We
       redraw the same classes in metres (road-layer.ts), so leaving both would
       show every building overlapping a road that is not the road we drew.
       Deliberately NOT hidden: highway_path and highway_motorway_* — classes we
       do not draw, and hiding an unreplaced road deletes it rather than redraws it. */
    for (const id of REPLACED_ROAD_GEOMETRY) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    }
    /* And their LABELS. Hiding the asphalt but not the street names left text and
       one-way arrows floating over roads the basemap no longer draws. Matched by
       predicate rather than by id because the two styles we ship use DIFFERENT
       label ids — an id list here is one already known to be incomplete. */
    for (const l of map.getStyle().layers ?? []) {
      if (isReplacedRoadLabel(l as never) && map.getLayer(l.id)) {
        map.setLayoutProperty(l.id, 'visibility', 'none');
      }
    }
    loadWard('ballygunge');
  });
  const onVis = () => { /* browser pauses rAF when hidden; nothing extra needed */ };
  document.addEventListener('visibilitychange', onVis);

  /* ── dispose ── */
  return function dispose() {
    cancelAnimationFrame(orbitId); cancelAnimationFrame(dragId); cancelAnimationFrame(simId);
    clearTimeout(orbitResume);
    nudgeEvents.forEach(ev => cv.removeEventListener(ev, nudgeOrbit));
    cv.removeEventListener('contextmenu', noCtx);
    cv.removeEventListener('pointerdown', onDown as EventListener); cv.removeEventListener('pointermove', onMove as EventListener);
    cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
    document.removeEventListener('visibilitychange', onVis);
    cleanup.forEach(fn => fn());
    cityMesh?.geometry.dispose(); (overlay?.material as THREE.Material)?.dispose(); overlay?.geometry.dispose();
    waterLayer?.dispose();
    cloudLayer?.dispose();
    roadLayer?.dispose();
    facade.dispose(); heatTex.dispose(); sim?.dispose(); simRenderer.dispose();
    try { map.remove(); } catch { /* ignore */ }
    document.body.classList.remove('studio');
  };
}
