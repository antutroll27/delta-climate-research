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
import { WARD_MAP } from '../../data/wards.ts';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GpuHeatSim } from './sim-gpu';
import { DEFAULT_PARAMS, type SimLayers, type SimParams } from './types';
import * as M from './heat-map-model';
import { ACCURACY, SPATIAL, bandLabel, unmeasuredNote } from './accuracy';
import * as U from './dc-urs';
import { applyScenario } from './dc-urs-scenario';
import type { DcUrsInputs } from './dc-urs-inputs';
import { rasterWardBase } from './ward-raster';
import { loadWardSurface, type WardSurface } from './surface-raster';
import { buildRegistry, pickBuilding, projectWard, type BuildingMeta } from './explore/building-pick';
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
    base: SimLayers | null; baselineMean: number; live: M.Ambient | null;
    spatial: M.Spatial | null; greenG: number; lastMean: Record<string, number>;
    /* Observed DC-URS inputs per ward, loaded once. null while unloaded or if the
       fetch failed — the score reports itself unavailable rather than inventing one. */
    dcurs: Record<string, DcUrsInputs> | null;
  }
  
  const state: State = { ward: 'ballygunge', phase: 'peak', path: '2025', iv: { trees: 0, roof: 0, parks: 0, facades: 0 }, base: null, baselineMean: 0, live: null, spatial: null, greenG: 0, lastMean: {}, dcurs: null };
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
  const compassEl = el('compass'), needleEl = el('compassNeedle');
  function syncCompass() {
    if (needleEl) needleEl.style.transform = `rotate(${-map.getBearing()}deg)`;
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
    /* Say what the rings are FOR, in a sentence, in plain words. A circle drawn
       on a map is not self-explanatory — and the reader who commissioned it had
       to ask, which is the only usability test that matters. Written from the
       live distance so the sentence and the ring can never disagree. */
    const mins = nearestCool ? Math.max(1, Math.round(nearestCool.distM / WALK_M_PER_MIN)) : 0;
    setHTML('bcRings', nearestCool
      ? `The rings show how far you could walk from this building in 5 and 10 minutes. `
        + `The nearest greenery is <b>about ${mins} minute${mins === 1 ? '' : 's'} away</b>.`
      : 'The rings show how far you could walk from this building in 5 and 10 minutes.');

    /* Straight-line distance to the nearest measured cooling surface, in the
       same minutes the rings are labelled in. Never called a refuge: the client
       has no water mask and no notion of public access (see cooling-surfaces.ts),
       so a gated lawn and a public park look identical from here. */
    if (nearestCool) {
      parts.push(`Nearest cooling surface <b>${Math.round(nearestCool.distM)} m</b> · straight line, vegetation only`);
    } else if (cooling) {
      parts.push('No vegetated cooling surface of 0.77 ha or more in this ward');
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
      return px < cardBox.left - 88 || px > cardBox.right + 88
        || py < cardBox.top - 26 || py > cardBox.bottom + 26;
    };
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

  function select(b: BuildingMeta | null) {
    selected = b;
    if (b) {
      selCtrU.value.set(b.cx, b.cz);
      nearestCool = cooling ? nearestCooling(cooling, b.cx, b.cz, SIM_N, sizeU.value) : null;
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
      nearestCool = null;
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
  const WALK_M_PER_MIN = 80;                       // 4.8 km/h, the usual planning figure
  const RINGS = [{ min: 5, r: 400, el: 'ring5' }, { min: 10, r: 800, el: 'ring10' }] as const;
  const coolU = { value: 0 };
  let ringGroup: THREE.Group | null = null;
  let cooling: CoolingSurfaces | null = null;
  let nearestCool: { x: number; z: number; distM: number } | null = null;

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
  let modelTransform: { x: number; y: number; z: number; scale: number } | null = null;
  let hemiL: THREE.HemisphereLight, keyL: THREE.DirectionalLight, rimL: THREE.DirectionalLight;
  const customLayer: maplibregl.CustomLayerInterface = {
    id: 'delta-city', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      if (threeRenderer) return;
      threeScene = new THREE.Scene();
      hemiL = new THREE.HemisphereLight(0xbfe2e8, 0x0a1518, 1.05); threeScene.add(hemiL);
      keyL = new THREE.DirectionalLight(0xffffff, 2.1); keyL.position.set(0.4, 1, 0.35); threeScene.add(keyL);
      rimL = new THREE.DirectionalLight(0x6fcad6, 0.5); rimL.position.set(-0.5, 0.4, -0.5); threeScene.add(rimL);
      threeCam = new THREE.Camera();
      threeRenderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      threeRenderer.autoClear = false;
      overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
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
    },
    render(_gl, matrix) {
      if (!modelTransform || !threeScene) return;
      const s = modelTransform.scale;
      const l = new THREE.Matrix4()
        .makeTranslation(modelTransform.x, modelTransform.y, modelTransform.z)
        .scale(new THREE.Vector3(s, -s, s))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      threeCam.projectionMatrix = new THREE.Matrix4().fromArray(matrix as unknown as number[]).multiply(l);
      /* Keep the exact matrix the vertex shader is about to use. building-pick
         projects footprints with THIS, so a hit test can never disagree with what
         was drawn — including mid-flyTo, where a matrix rebuilt from map state
         would be a frame out. */
      pickMatrix.copy(threeCam.projectionMatrix);
      threeRenderer.resetState();
      threeRenderer.render(threeScene, threeCam);
      if (growU.value < 1 || fieldDirty) { fieldDirty = false; map.triggerRepaint(); }
    },
  };

  /* ── heat ramp for building extrusion vertex jitter (grow) — via aCtr sample ── */
  const cache: Record<string, M.WardData> = {}, roadsCache: Record<string, M.RoadsData> = {};
  /* Measured Sentinel-2 surface, one per ward, fetched once. A miss is non-fatal
     and falls back to a flat field at the measured ward mean — never to
     synthesised structure. */
  const surfaceCache: Record<string, WardSurface> = {};
  let growStart = 0; const GROW_MS = 1900; let opBase = 0.5;

  /* DC-URS baseline inputs — observed, loaded once and shared by every ward.
     Failure is non-fatal: the heat field still works, the score reports itself
     unavailable rather than inventing one. */
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
    if (!cache[name]) cache[name] = await (await fetch(`/heat-map/data/${name}.json`)).json();
    const d = cache[name], w = WARDS[name]; state.ward = name; updateCompareHref();

    /* Rebuild the pick registry from the SAME rows the extrusions come from, and
       drop any selection: building #1759 in Ballygunge is a different building in
       Baruipur, so carrying the index across a ward switch would lie. */
    select(null);
    registry = buildRegistry(d.b);

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
    }
    const mc = maplibregl.MercatorCoordinate.fromLngLat([w.lon, w.lat], 0);
    modelTransform = { x: mc.x, y: mc.y, z: mc.z ?? 0, scale: mc.meterInMercatorCoordinateUnits() };

    /* Vegetation and albedo are MEASURED per cell, from Sentinel-2, and pinned to
       the same ward means the resilience score reads. loadWardSurface verifies
       that pairing before either reaches the model, so the map and the score
       cannot end up drawn from different vintages of the same measurement. */
    surfaceCache[name] ??= await loadWardSurface(name);
    const { means, surface } = surfaceCache[name];
    state.base = rasterWardBase(d, means, surface);
    if (!roadsCache[name]) { try { roadsCache[name] = await (await fetch(`/heat-map/data/${name}-roads.json`)).json(); } catch { roadsCache[name] = { ways: [] }; } }
    state.spatial = M.buildSpatial(d, state.base, roadsCache[name]);
    /* Cooling surfaces are a property of the MEASURED vegetation, so they are
       computed from the ward's base layers and never move when a scenario does —
       planting trees in the model must not invent a park that is not there. */
    const cellM2 = (d.sizeM / SIM_N) * (d.sizeM / SIM_N);
    cooling = findCoolingSurfaces(state.base.veg, SIM_N, cellM2);
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
    const p = M.currentParams(state);
    state.baselineMean = M.eqMean(state.base, { ...p, Q: DEFAULT_PARAMS.Q });
    const layers = M.applyInterventions(state.base, state.iv, state.spatial);
    state.greenG = M.computeGreenG(layers);
    sim.reset({ n: SIM_N, cellMeters: cache[state.ward].sizeM / SIM_N }, layers, p);
    sim.step(1, RESET_BURST); bridgeField(); refreshStats();
  }

  /* ── live ambient (Met Norway direct; production proxies via /api/ambient) ── */
  const liveCache: Record<string, M.Ambient> = {};
  function paintLive() {
    const L = state.live;
    setText('liveT', L ? L.tAir.toFixed(1) : '—'); setText('liveFeel', L ? L.feels.toFixed(1) : '—');
    setText('liveRH', L ? String(Math.round(L.rh)) : '—'); setText('liveWind', L ? L.wind.toFixed(1) : '—');
    el('livedot')?.classList.toggle('on', !!L);
  }
  async function fetchLive(name: string) {
    const w = WARDS[name];
    try {
      if (!liveCache[name]) {
        const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${w.lat}&lon=${w.lon}`);
        if (!r.ok) throw new Error('met.no ' + r.status);
        const dd = (await r.json()).properties.timeseries[0].data.instant.details;
        liveCache[name] = { tAir: dd.air_temperature, rh: dd.relative_humidity, wind: dd.wind_speed, cloud: dd.cloud_area_fraction ?? 0, feels: M.heatIndexC(dd.air_temperature, dd.relative_humidity) };
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
    const tag = el('conf');
    if (tag) {
      tag.textContent = a.confidence === 'quantitative'
        ? `calibrated · ±${a.bandK.toFixed(1)} °C (n=${a.n})`
        : `indicative only · ±${a.bandK.toFixed(1)} °C (n=${a.n})`;
      tag.className = `conf ${a.confidence}`;
      // Both figures on one tooltip. The phase note covers ward-LEVEL error; the
      // spatial note covers whether the pattern inside the ward means anything.
      // A reader who sees only the first will read the hot blocks as measured —
      // they are not (SPATIAL.rModel 0.11, below a plain vegetation map's 0.23).
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
  document.querySelectorAll('#segPhase button').forEach(b => onEl(b, 'click', () => { state.phase = (b as HTMLElement).dataset.p as 'peak' | 'night'; document.querySelectorAll('#segPhase button').forEach(x => x.classList.toggle('on', x === b)); updateCompareHref(); resetSim(); }));
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
    if (hemiL) { if (s) { hemiL.color.set(0xffffff); hemiL.groundColor.set(0xd8d2c8); hemiL.intensity = 1.45; keyL.intensity = 1.7; rimL.intensity = 0.12; } else { hemiL.color.set(0xbfe2e8); hemiL.groundColor.set(0x0a1518); hemiL.intensity = 1.05; keyL.intensity = 2.1; rimL.intensity = 0.5; } }
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
  map.on('style.load', () => { map.addLayer(customLayer); loadWard('ballygunge'); });
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
    facade.dispose(); heatTex.dispose(); sim?.dispose(); simRenderer.dispose();
    try { map.remove(); } catch { /* ignore */ }
    document.body.classList.remove('studio');
  };
}
