// river-scene.ts — framework-agnostic three.js scene for the hero river.
// Ported from previews/hero-river-native.html (the locked native-water look):
// animates the photogrammetry scan's OWN water in-shader via a baked channel
// flow-field, with a 3-tier perf ladder. The React island (HeroRiver.tsx) owns
// the lifecycle (IntersectionObserver gate, gsap.ticker, dispose); this module
// owns the scene and exposes tick/resize/dispose/onReady/setScrollProgress.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface RiverScene {
  /** render one frame (advances time + camera). No-op until the GLB is ready. */
  tick(): void;
  /** re-read the canvas size and resize renderer/composer/camera. */
  resize(): void;
  /** 0..1 scroll progress for the dolly+splash (wired in the scroll step). */
  setScrollProgress(p: number): void;
  /** register a callback fired once when the scan has loaded. */
  onReady(cb: () => void): void;
  readonly ready: boolean;
  /** the perspective camera (for projecting data-point anchors later). */
  readonly camera: THREE.PerspectiveCamera;
  /** the loaded river mesh root (object→world for anchors), or null until ready. */
  readonly river: THREE.Object3D | null;
  dispose(): void;
}

interface Opts { reduce?: boolean }

const MODELS = '/models/';
const TEX = '/textures/';

function pickInitialTier(): number {
  const coarse = matchMedia('(pointer:coarse)').matches;
  const mem = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  let t = 0;
  if (coarse) t = 1;
  if (mem <= 2 || cores <= 4) t = 2;
  return t;
}

const TIERS = [
  { q: '4k', flow: 'river-flow.png', dpr: 1.6, bloom: true },
  { q: '2k', flow: 'river-flow-sm.png', dpr: 1.25, bloom: false },
  { q: '2k', flow: 'river-flow-sm.png', dpr: 1.0, bloom: false },
];

export function createRiverScene(canvas: HTMLCanvasElement, opts: Opts = {}): RiverScene {
  const reduce = !!opts.reduce;
  let TIER = pickInitialTier();

  const sizeW = () => canvas.clientWidth || window.innerWidth;
  const sizeH = () => canvas.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(TIERS[TIER].dpr, window.devicePixelRatio || 1));
  renderer.setSize(sizeW(), sizeH(), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050606');
  const FOG = new THREE.Color('#050606');
  scene.fog = new THREE.FogExp2(FOG.getHex(), 0.015);   // slightly less fog (user, 2026-06-18)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.03);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(40, sizeW() / sizeH(), 0.1, 400);
  const camBaseY = 6, camBaseZ = 16;          // LOCKED start frame (user-selected cam≈6 drone shot)
  const look = new THREE.Vector3(0, -3.2, -7);
  camera.position.set(0, camBaseY, camBaseZ);
  camera.lookAt(look);

  const key = new THREE.DirectionalLight(0xbfe2e8, 1.1); key.position.set(30, 40, 25); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fcad6, 0.5); rim.position.set(-40, 18, -30); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x7d9aa0, 0x04070a, 0.35));

  // shared uniforms (locked defaults from the preview's signed-off look)
  // user-tuned riverbed values (editor dump 2026-06-18): grade 0.55, detect 2.6,
  // flow 0.36, ripple 0.45, tile 7.5, foam 0.45, edge 0.56. Camera kept at the
  // frozen cam-6 framing (the dump's cam=14 was the editor default, not a choice).
  const UG = { value: 0.55 }, UTIME = { value: 0 }, UWGAIN = { value: 2.6 }, UWFLOW = { value: 0.36 }, UWAMP = { value: 0.45 };
  const UFFIELD = { value: 1 }, USCALEN = { value: 7.5 }, UFOAM = { value: 0.45 }, UEDGE = { value: 0.56 };
  const UTIER = { value: TIER };
  const UGRASS = { value: 0.6 }, URIPPLE = { value: 0.7 };   // grass-green boost; hover-ripple strength
  const RIPPLE_MAX = 12;
  const rippleArr = Array.from({ length: RIPPLE_MAX }, () => new THREE.Vector3(0, 0, -1e9)); // (worldX, worldZ, birthTime)

  const disposables: { dispose(): void }[] = [];
  const waterNorm = new THREE.TextureLoader().load(TEX + 'waternormals.webp', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; });
  disposables.push(waterNorm);
  const flowTex = new THREE.TextureLoader().load(TEX + TIERS[TIER].flow, undefined, undefined, () => {
    if (TIERS[TIER].flow !== 'river-flow.png') new THREE.TextureLoader().load(TEX + 'river-flow.png', t => {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; flowTex.image = t.image; flowTex.needsUpdate = true;
    });
  });
  flowTex.wrapS = flowTex.wrapT = THREE.ClampToEdgeWrapping; flowTex.flipY = false; flowTex.generateMipmaps = false;
  flowTex.minFilter = flowTex.magFilter = THREE.LinearFilter; flowTex.colorSpace = THREE.NoColorSpace;
  disposables.push(flowTex);
  const STRIP_MIN = new THREE.Vector2(-117.416, -26.216), STRIP_MAX = new THREE.Vector2(103.660, 36.553);

  function gradeMaterial(mat: THREE.MeshStandardMaterial) {
    mat.fog = true; mat.envMapIntensity = 0.35;
    const u: Record<string, { value: any }> = {
      uTime: UTIME, uGrade: UG, uWGain: UWGAIN, uWFlow: UWFLOW, uWAmp: UWAMP,
      uShadow: { value: new THREE.Color('#05080a') }, uMid: { value: new THREE.Color('#6b4f2e') }, uHigh: { value: new THREE.Color('#6fcad6') },
      uRim: { value: new THREE.Color('#6fcad6') }, uWaterDeep: { value: new THREE.Color('#08323a') }, uWaterNorm: { value: waterNorm },
      uFlowMap: { value: flowTex }, uStripMin: { value: STRIP_MIN }, uStripMax: { value: STRIP_MAX },
      uScaleN: USCALEN, uFField: UFFIELD, uFoam: { value: new THREE.Color('#9fe6ee') }, uFoamAmt: UFOAM,
      uEdgeFade: UEDGE, uTier: UTIER, uFogCol: { value: FOG },
      uGrassAmt: UGRASS, uRippleAmp: URIPPLE, uRipples: { value: rippleArr },
    };
    mat.onBeforeCompile = (sh: any) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = `varying vec3 vWPos; varying vec3 vLocalXZ3;\n` + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
        vLocalXZ3 = transformed;`);
      sh.fragmentShader = `
        uniform float uTime,uGrade,uWGain,uWFlow,uWAmp,uScaleN,uFField,uFoamAmt,uEdgeFade,uTier,uGrassAmt,uRippleAmp;
        uniform vec3 uShadow,uMid,uHigh,uRim,uWaterDeep,uFoam,uFogCol,uRipples[12]; uniform sampler2D uWaterNorm,uFlowMap; uniform vec2 uStripMin,uStripMax;
        varying vec3 vWPos; varying vec3 vLocalXZ3;
        float gWater=0.0, gGlint=0.0, gSpd=0.0, gChan=0.0, gTj=0.0, gFoam=0.0; vec2 gFuv=vec2(0.0), gDir=vec2(1.0,0.0);
      ` + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.299,0.587,0.114));
          float maxc=max(max(c.r,c.g),c.b), minc=min(min(c.r,c.g),c.b);
          float sat = maxc-minc;
          float teal = clamp((c.b - max(c.r,c.g))*8.0, 0.0, 1.0);
          float grey = clamp((0.16 - sat)*4.0,0.0,1.0)*smoothstep(0.42,0.75,lum);
          gWater = clamp(max(teal, grey)*uWGain, 0.0, 1.0);
          gFuv = (vLocalXZ3.xz - uStripMin) / (uStripMax - uStripMin);
          if(uFField>0.5){ vec4 fm = texture2D(uFlowMap, gFuv); gDir = normalize(fm.rg*2.0-1.0 + 1e-5); gSpd = fm.b; gChan = fm.a; }
          else           { gDir = vec2(1.0,0.0); gSpd = 0.45; gChan = smoothstep(0.02,0.25,gWater); }
          float wmask = max(gWater, gChan*0.9);
          float L = pow(clamp(lum*1.15,0.0,1.0), 1.25);
          vec3 gBank = mix(uShadow, uMid, smoothstep(0.04,0.5,L));
          gBank = mix(gBank, uHigh, smoothstep(0.5,0.92,L));
          vec3 gWat = mix(uWaterDeep, uHigh, smoothstep(0.25,0.8,L));
          vec3 g = mix(gBank, gWat, wmask);
          float amt = max(clamp(uGrade,0.0,1.4), wmask*0.7);
          diffuseColor.rgb = mix(diffuseColor.rgb, g, amt);
          // greener grass: push green-dominant bank texels (the moss) toward a richer, more saturated green — never the water
          float grassM = clamp((c.g - max(c.r,c.b))*4.0, 0.0, 1.0) * (1.0 - gChan);
          vec3 greener = clamp(diffuseColor.rgb * vec3(0.80,1.22,0.70), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, greener, grassM*uGrassAmt);
          if(gChan>0.001 && uWFlow>0.0001){
            gTj = uTime*uWFlow*(0.5+gSpd*0.55) + texture2D(uWaterNorm, gFuv*3.1).r;
            vec2 dirT = (uTier < 1.5) ? gDir : vec2(1.0,0.0);
            float sAlong = dot(vLocalXZ3.xz, dirT);
            float streaks = sin(sAlong*0.5 - gTj*6.0)*0.5 + sin(sAlong*1.05 - gTj*9.5 + 1.7)*0.5;
            float glint = smoothstep(0.5, 1.0, streaks*0.5 + 0.5);
            gGlint = glint * gChan;
            diffuseColor.rgb += uHigh * gGlint * 0.24;
            diffuseColor.rgb = mix(diffuseColor.rgb, uWaterDeep, gChan*0.14*(1.0-glint));
            if(uTier < 1.5){
              mat2 frot = mat2(dirT.y,dirT.x,-dirT.x,dirT.y); vec2 ruvF = frot*(gFuv*uScaleN); ruvF.y*=0.45;
              float shore = smoothstep(0.06,0.4,gChan)*(1.0-smoothstep(0.4,0.85,gChan));
              float rapids = (uTier < 0.5) ? smoothstep(0.74,1.0,gSpd)*gChan*0.55 : 0.0;
              float fn = texture2D(uWaterNorm, ruvF*1.7 - vec2(0.0,fract(gTj))).g;
              gFoam = smoothstep(0.5,0.8,fn)*max(shore,rapids);
              diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, gFoam*uFoamAmt);
            }
          }
        }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        if(gChan>0.001 && uWFlow>0.0001){
          vec2 dirN = (uTier < 1.5) ? gDir : vec2(1.0,0.0);
          float p0=fract(gTj), p1=fract(gTj+0.5);
          vec3 wn;
          if(uTier < 0.5){
            mat2 rot = mat2(dirN.y,dirN.x,-dirN.x,dirN.y);
            vec2 ruv = rot*(gFuv*uScaleN); ruv.y*=0.45;
            vec3 n0 = texture2D(uWaterNorm, ruv - vec2(0.0,p0)).xyz*2.0-1.0;
            vec3 n1 = texture2D(uWaterNorm, ruv - vec2(0.0,p1)).xyz*2.0-1.0;
            wn = mix(n0, n1, 1.0-abs(1.0-2.0*fract(gTj)));
            wn.xy = transpose(rot)*wn.xy;
          } else {
            vec2 ruv = gFuv*uScaleN;
            vec3 n0 = texture2D(uWaterNorm, ruv - dirN*p0).xyz*2.0-1.0;
            vec3 n1 = texture2D(uWaterNorm, ruv - dirN*p1).xyz*2.0-1.0;
            wn = mix(n0, n1, 1.0-abs(1.0-2.0*fract(gTj)));
          }
          normal = normalize(normal + vec3(wn.xy,0.0)*gChan*uWAmp);
          // ── hover ripples: radial rings expanding from recent cursor positions (desktop tiers only) ──
          if(uTier < 1.5 && uRippleAmp > 0.001){
            vec2 rn = vec2(0.0);
            for(int i=0;i<12;i++){
              vec3 rp = uRipples[i];
              float age = uTime - rp.z;
              float alive = step(-0.5, rp.z) * step(0.0, age) * step(age, 2.2);
              vec2 toC = vWPos.xz - rp.xy; float d = length(toC) + 1e-4;
              float ring = sin(d*2.4 - age*7.0) * exp(-d*0.5) * exp(-age*1.7) * smoothstep(2.2,0.0,age) * alive;
              rn += (toC/d) * ring;
            }
            normal = normalize(normal + vec3(rn,0.0)*gChan*uRippleAmp);
          }
        }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        {
          vec3 V = normalize(vViewPosition);
          float fr = pow(1.0 - clamp(dot(normalize(normal), V),0.0,1.0), 3.0);
          totalEmissiveRadiance += uRim * fr * (0.5*clamp(uGrade,0.0,1.2) + gWater*0.6);
          totalEmissiveRadiance += uHigh * gGlint * 0.3;
          totalEmissiveRadiance += uFoam * gFoam * 0.15;
        }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        { float graze = abs(dot(normalize(normal), normalize(vViewPosition)));
          float ef = smoothstep(0.0, max(uEdgeFade,0.001), graze);
          gl_FragColor.rgb = mix(uFogCol, gl_FragColor.rgb, ef); }
      `);
    };
    mat.needsUpdate = true;
  }

  // post
  const comp = new EffectComposer(renderer);
  comp.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(sizeW(), sizeH()), 1.1, 0.8, 0.78);   // slightly more bloom (user, 2026-06-18)
  comp.addPass(bloom);
  comp.addPass(new OutputPass());
  comp.setSize(sizeW(), sizeH());

  function applyTier(t: number) {
    TIER = t; const cfg = TIERS[t];
    renderer.setPixelRatio(Math.min(cfg.dpr, window.devicePixelRatio || 1));
    comp.setSize(sizeW(), sizeH()); bloom.setSize(sizeW(), sizeH());
    bloom.enabled = cfg.bloom;
    UTIER.value = t;
  }

  // load scan
  let river: THREE.Object3D | null = null;
  let ready = false;
  const readyCbs: (() => void)[] = [];
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(MODELS + `river-${TIERS[TIER].q}.glb`, (g) => {
    river = g.scene;
    river.traverse((o: any) => { if (o.isMesh) { gradeMaterial(o.material); o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(river);
    const cc = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const scl = 120 / s.x; river.scale.setScalar(scl);
    river.position.set(-cc.x * scl, -cc.y * scl - 3.5, -cc.z * scl - 5);
    river.updateMatrixWorld(true);
    scene.add(river);
    applyTier(TIER);
    ready = true;
    readyCbs.forEach(cb => cb());
  }, undefined, (e) => { console.error('[river] load error', e); });

  // subtle drone parallax + hover-ripple injection
  const camT = { x: 0, y: 0 }, camO = { x: 0, y: 0 };
  const raycaster = new THREE.Raycaster();
  const WATER_Y = -3.6;                                          // approx world Y of the channel surface
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
  const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  let rippleIdx = 0, lastRipple = 0;
  const onPointer = (e: PointerEvent) => {
    camT.x = e.clientX / window.innerWidth - 0.5; camT.y = e.clientY / window.innerHeight - 0.5;
    if (reduce) return;
    const now = performance.now();
    if (now - lastRipple < 70) return;                          // throttle ripple spawns
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(waterPlane, hit)) {        // cursor → water surface → spawn a ripple ring
      rippleArr[rippleIdx].set(hit.x, hit.z, UTIME.value);
      rippleIdx = (rippleIdx + 1) % RIPPLE_MAX;
      lastRipple = now;
    }
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // FPS-adaptive downgrade
  const clock = new THREE.Clock();
  let fpsWarm = 0, fpsAcc = 0, fpsN = 0;
  let scrollP = 0; // 0..1 — wired by the scroll step; static frame at 0

  function tick() {
    if (!ready) return;
    const dt = clock.getDelta();
    if (!reduce) { UTIME.value += dt; if (UTIME.value > 3600) UTIME.value -= 3600; }
    camO.x += (camT.x - camO.x) * 0.04; camO.y += (camT.y - camO.y) * 0.04;
    camera.position.x = camO.x * 4.0;
    camera.position.y = camBaseY - camO.y * 1.6;
    camera.position.z = camBaseZ;
    camera.lookAt(look);
    comp.render();
    if (!reduce && TIER < 2) {
      if (fpsWarm < 30) fpsWarm++;
      else { fpsAcc += dt > 0 ? 1 / dt : 60; fpsN++; if (fpsN >= 60) { if (fpsAcc / fpsN < 45) applyTier(TIER + 1); fpsAcc = 0; fpsN = 0; } }
    }
  }

  function resize() {
    const w = sizeW(), h = sizeH();
    renderer.setSize(w, h, false); comp.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function dispose() {
    window.removeEventListener('pointermove', onPointer);
    scene.traverse((o: any) => {
      if (o.isMesh) { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : [m]).forEach((mm: any) => mm?.dispose?.()); }
    });
    disposables.forEach(d => d.dispose());
    envRT.dispose?.(); pmrem.dispose();
    (comp as any).dispose?.(); bloom.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return {
    tick, resize, dispose,
    setScrollProgress(p: number) { scrollP = Math.max(0, Math.min(1, p)); void scrollP; /* applied in the scroll step */ },
    onReady(cb) { if (ready) cb(); else readyCbs.push(cb); },
    get ready() { return ready; },
    camera,
    get river() { return river; },
  };
}
