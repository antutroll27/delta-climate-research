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
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GpuHeatSim } from './sim-gpu';
import { DEFAULT_PARAMS, type SimLayers } from './types';
import * as M from './heat-map-model';
import { ACCURACY, bandLabel } from './accuracy';
import { rasterWardBase } from './ward-raster';

interface WardMeta { name: string; zone: string; coord: string; lat: number; lon: number; veg: number; }
const WARDS: Record<string, WardMeta> = {
  ballygunge:  { name: 'Bally<em>gunge</em>', zone: 'Urban Core · Ward 68', coord: '22.528° N · 88.366° E', lat: 22.528, lon: 88.3659, veg: 0.12 },
  baruipur:    { name: 'Baru<em>ipur</em>', zone: 'Peri-Urban Fringe', coord: '22.365° N · 88.432° E', lat: 22.3654, lon: 88.4319, veg: 0.62 },
  barrackpore: { name: 'Barrack<em>pore</em>', zone: 'Industrial River Corridor', coord: '22.762° N · 88.371° E', lat: 22.7621, lon: 88.3713, veg: 0.28 },
};
const { SIM_N, RAMP_MIN, RAMP_MAX, RESET_BURST } = M;
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
  }
  
  const state: State = { ward: 'ballygunge', phase: 'peak', path: '2025', iv: { trees: 0, roof: 0, parks: 0, facades: 0 }, base: null, baselineMean: 0, live: null, spatial: null, greenG: 0, lastMean: {} };
  let mode: 'relief' | 'iso' = 'relief', env = 'dark';

  /* ── MapLibre basemap ── */
  const map = new maplibregl.Map({
    container: mapContainer, style: STYLES.dark,
    center: [WARDS.ballygunge.lon, WARDS.ballygunge.lat], zoom: 15.3, pitch: 60, bearing: -18,
    antialias: true, attributionControl: false, pixelRatio: Math.min(devicePixelRatio, 1.75),
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

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

  /* ── offscreen GPU heat sim + field bridge (R=blur ground · G=raw buildings) ── */
  const simRenderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  let sim: GpuHeatSim | null = null;
  try { sim = new GpuHeatSim(simRenderer); } catch (e) { console.warn('GPU sim unavailable:', (e as Error).message); }
  const heatData = new Float32Array(SIM_N * SIM_N * 4);
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

  /* ── facade material (grow-in · live tint · line-art · tint modes) ── */
  function makeFacade() {
    const m = new THREE.MeshStandardMaterial({ roughness: .84, metalness: .05 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGrow = growU; sh.uniforms.uStudio = studioU; sh.uniforms.uSize = sizeU; sh.uniforms.uTintMode = tintU;
      sh.uniforms.tField = { value: heatTex };
      sh.uniforms.uHeatMin = { value: RAMP_MIN }; sh.uniforms.uHeatMax = { value: RAMP_MAX };
      sh.vertexShader = 'attribute float aDelay; attribute float aH; attribute vec2 aCtr;\n'
        + 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT;\n'
        + 'uniform float uGrow; uniform float uSize; uniform sampler2D tField;\n'
        + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float gT = clamp((uGrow - aDelay*0.55)/0.45, 0.0, 1.0);
          float gE = 1.0 + 2.70158*pow(gT-1.0,3.0) + 1.70158*pow(gT-1.0,2.0);
          transformed.y *= gE; vFp = transformed; vFn = normal;
          vTop = position.y / max(aH, 0.001);
          vT = texture2D(tField, clamp(aCtr/uSize + 0.5, 0.0, 1.0)).g;`);
      sh.fragmentShader = 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT;\n'
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
          diffuseColor.rgb = body * ao;`);
    };
    return m;
  }
  const facade = makeFacade();

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
        uniforms: { tT: { value: heatTex }, uMin: { value: RAMP_MIN }, uMax: { value: RAMP_MAX }, uOp: { value: 0.5 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform sampler2D tT; uniform float uMin,uMax,uOp;
          vec3 ramp(float t){ vec3 cA=vec3(.204,.412,.529),cB=vec3(.318,.635,.729),c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);
            if(t<0.0) return t<-.20 ? mix(cB,cA,clamp((-t-.20)/.30,0.,1.)) : mix(c0,cB,-t/.20);
            return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.)); }
          void main(){ float T=texture2D(tT, vec2(vUv.x, 1.0-vUv.y)).r; float t=clamp((T-uMin)/(uMax-uMin),-0.5,1.);
            float edge=smoothstep(0.0,0.16, min(min(vUv.x,1.0-vUv.x), min(vUv.y,1.0-vUv.y)));
            gl_FragColor=vec4(ramp(t), uOp*edge); }`,
      }));
      overlay.rotation.x = -Math.PI / 2; overlay.position.y = 0.6; overlay.renderOrder = -1; threeScene.add(overlay);
    },
    render(_gl, matrix) {
      if (!modelTransform || !threeScene) return;
      const s = modelTransform.scale;
      const l = new THREE.Matrix4()
        .makeTranslation(modelTransform.x, modelTransform.y, modelTransform.z)
        .scale(new THREE.Vector3(s, -s, s))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      threeCam.projectionMatrix = new THREE.Matrix4().fromArray(matrix as unknown as number[]).multiply(l);
      threeRenderer.resetState();
      threeRenderer.render(threeScene, threeCam);
      if (growU.value < 1 || fieldDirty) { fieldDirty = false; map.triggerRepaint(); }
    },
  };

  /* ── heat ramp for building extrusion vertex jitter (grow) — via aCtr sample ── */
  const cache: Record<string, M.WardData> = {}, roadsCache: Record<string, M.RoadsData> = {};
  let growStart = 0; const GROW_MS = 1900; let opBase = 0.5;

  async function loadWard(name: string) {
    const load = el('loadchip'); load?.classList.add('on');
    await new Promise(r => setTimeout(r, 30));
    if (!cache[name]) cache[name] = await (await fetch(`/heat-map/data/${name}.json`)).json();
    const d = cache[name], w = WARDS[name]; state.ward = name; updateCompareHref();

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

    state.base = rasterWardBase(d, w.veg);
    if (!roadsCache[name]) { try { roadsCache[name] = await (await fetch(`/heat-map/data/${name}-roads.json`)).json(); } catch { roadsCache[name] = { ways: [] }; } }
    state.spatial = M.buildSpatial(d, state.base, roadsCache[name]);
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
      (tag as HTMLElement).title = a.note;
    }
    const lstEl = el('lst');
    if (lstEl) (lstEl as HTMLElement).title = a.note;
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
    const ruralRef = (p.S * 0.75 * p.sun - p.L + p.kRad * p.tSky + p.h * p.wind * p.tAir) / kk, uhi = st.meanC - ruralRef;
    setText('uhi', `${uhi >= 0 ? '+' : ''}${uhi.toFixed(1)}°`);
    setText('area', `${(st.fracAbove * 100).toFixed(0)}%`);
    const bins = new Array(12).fill(0);
    for (let i = 0; i < t.length; i++) { const b = Math.min(11, Math.max(0, ((t[i] - RAMP_MIN) / (RAMP_MAX - RAMP_MIN) * 12) | 0)); bins[b]++; }
    const mx = Math.max(...bins, 1);
    histo?.childNodes.forEach((elm, i) => { (elm as HTMLElement).style.height = `${Math.max(4, bins[i] / mx * 100)}%`; });
    const cooling = Math.max(0, state.baselineMean - st.meanC), iv = state.iv;
    const cost = M.computeCost(iv, state.spatial);
    // Show the sub-scores raw alongside the total — a composite index is only
    // auditable if you can see which component produced the number.
    const parts = M.greenScoreParts(state.greenG, cooling, cost);
    const score = parts.total;
    setText('scoreNum', String(score));
    setText('sGreen', `${Math.round(parts.greening * 100)}`);
    setText('sCool', `${Math.round(parts.cooling * 100)}`);
    setText('sEff', `${Math.round(parts.efficiency * 100)}`);
    el('scoreArc')?.setAttribute('stroke-dashoffset', String(97 - score * 0.97));
    const anyIv = iv.trees || iv.roof || iv.parks || iv.facades;
    setHTML('scoreTxt', anyIv ? `−${cooling.toFixed(2)}°C · ${(state.greenG * 100).toFixed(0)}% green<br>₹${M.fmtCr(cost)} capital cost` : 'move a slider to intervene');
    state.lastMean[state.ward] = st.meanC;
    setHTML(`big-${state.ward}`, `${st.meanC.toFixed(1)}<span>°C mean</span>`);
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
