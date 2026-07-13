// river-scene.ts — framework-agnostic three.js scene for the hero river.
// Ported from previews/hero-river-native.html (the locked native-water look):
// animates the photogrammetry scan's OWN water in-shader via a baked channel
// flow-field, with a 3-tier perf ladder. The React island (HeroRiver.tsx) owns
// the lifecycle (IntersectionObserver gate, gsap.ticker, dispose); this module
// owns the scene and exposes tick/resize/dispose/onReady/setScrollProgress.
import * as THREE from './three-runtime';
import type { IUniform, Material, WebGLProgramParametersWithUniforms } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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

interface NavigatorWithDeviceMemory extends Navigator {
  readonly deviceMemory?: number;
}

interface SplashUniforms extends Record<string, { value: unknown }> {
  uProgress: { value: number };
  uTime: { value: number };
  uRes: { value: THREE.Vector2 };
}

const MODELS = '/models/';
const TEX = '/textures/';

function pickInitialTier(): number {
  const coarse = matchMedia('(pointer:coarse)').matches;
  const mem = (navigator as NavigatorWithDeviceMemory).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  let t = 0;
  if (coarse) t = 1;
  if (mem <= 2 || cores <= 4) t = 2;
  return t;
}

const TIERS = [
  // The Draco 1k recut keeps precise 12-bit octahedral normals at 1.9MB. The
  // shader, full-resolution flow map, DPR and bloom still distinguish the high
  // tier without making first-view visitors download the former 12.6MB model.
  { q: '1k', flow: 'river-flow.png', dpr: 1.6, bloom: true },
  { q: '1k', flow: 'river-flow-sm.png', dpr: 1.25, bloom: false },
  { q: '1k', flow: 'river-flow-sm.png', dpr: 1.0, bloom: false },
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
  const DEEP = new THREE.Color('#062028');   // engulf deep-sea tint (darker than FOG; user-locked 2026-06-19)
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
  const UG = { value: 0.55 }, UTIME = { value: 0 }, UWGAIN = { value: 2.6 }, UWFLOW = { value: 0.36 }, UWAMP = { value: 1.0 };
  const UFFIELD = { value: 1 }, USCALEN = { value: 7.5 }, UFOAM = { value: 0.45 }, UEDGE = { value: 0.56 };
  // finer/faster 2nd normal octave — micro-detail borrowed from the Mancini water study (preview-approved 2026-06-23)
  const UNOCT = { value: 1.2 }, UNTILE = { value: 3.8 }, UNSPD = { value: 3.0 };
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
    // Anisotropic filtering on the scan's textures — the drone camera views the
    // bed at a grazing angle, where the three.js default (anisotropy=1) blurs
    // everything past mid-distance regardless of texture resolution. The flow
    // map is exempt (no mips → anisotropy is inert there).
    const aniso = Math.min(TIER === 0 ? 16 : 8, renderer.capabilities.getMaxAnisotropy());
    [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap].forEach((t) => {
      if (t) t.anisotropy = aniso;
    });
    const u: Record<string, IUniform<unknown>> = {
      uTime: UTIME, uGrade: UG, uWGain: UWGAIN, uWFlow: UWFLOW, uWAmp: UWAMP,
      uShadow: { value: new THREE.Color('#05080a') }, uMid: { value: new THREE.Color('#6b4f2e') }, uHigh: { value: new THREE.Color('#6fcad6') },
      uRim: { value: new THREE.Color('#6fcad6') }, uWaterDeep: { value: new THREE.Color('#08323a') }, uWaterNorm: { value: waterNorm },
      uFlowMap: { value: flowTex }, uStripMin: { value: STRIP_MIN }, uStripMax: { value: STRIP_MAX },
      uScaleN: USCALEN, uFField: UFFIELD, uFoam: { value: new THREE.Color('#9fe6ee') }, uFoamAmt: UFOAM,
      uEdgeFade: UEDGE, uTier: UTIER, uFogCol: { value: FOG },
      uGrassAmt: UGRASS, uRippleAmp: URIPPLE, uRipples: { value: rippleArr },
      uNoiseOct: UNOCT, uNoiseTile: UNTILE, uNoiseSpd: UNSPD,
    };
    mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = `varying vec3 vWPos; varying vec3 vLocalXZ3;\n` + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
        vLocalXZ3 = transformed;`);
      sh.fragmentShader = `
        uniform float uTime,uGrade,uWGain,uWFlow,uWAmp,uScaleN,uFField,uFoamAmt,uEdgeFade,uTier,uGrassAmt,uRippleAmp,uNoiseOct,uNoiseTile,uNoiseSpd;
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
          // ── finer/faster 2nd normal octave (preview-approved micro-detail); desktop/tablet tiers only ──
          if(uNoiseOct > 0.001 && uTier < 1.5){
            mat2 rotE = mat2(dirN.y,dirN.x,-dirN.x,dirN.y);
            vec2 ruvE = (uTier < 0.5) ? rotE*(gFuv*uScaleN*uNoiseTile) : (gFuv*uScaleN*uNoiseTile);
            ruvE.y *= 0.45;
            vec3 nE = texture2D(uWaterNorm, ruvE - dirN*fract(gTj*uNoiseSpd)).xyz*2.0-1.0;
            if(uTier < 0.5) nE.xy = transpose(rotE)*nE.xy;
            normal = normalize(normal + vec3(nE.xy,0.0)*gChan*uWAmp*uNoiseOct);
          }
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
  const renderPass = new RenderPass(scene, camera);
  comp.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(sizeW(), sizeH()), 1.1, 0.8, 0.78);   // slightly more bloom (user, 2026-06-18)
  comp.addPass(bloom);
  const outputPass = new OutputPass();
  comp.addPass(outputPass);
  // ── splash: radial water-engulf driven by scroll progress (river → sea, "The Plunge") ──
  // Dark water irises in from every edge, refracting the frame via an FBM-normal (Ashima snoise, MIT),
  // caustics + deep tint, then settles to DEEP → hands off to 01. Ported from previews/plunge.html.
  const splashPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uProgress: { value: 0 }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(sizeW(), sizeH()) },
      uDeep: { value: DEEP }, uCyan: { value: new THREE.Color('#6fcad6') },
      uAmp: { value: 0.12 }, uFoam: { value: 0.60 }, uSpeed: { value: 1.8 },   // Phase-2 locked: rougher ripple, foam back on, slower window
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uProgress,uTime,uAmp,uFoam,uSpeed; uniform vec2 uRes;
      uniform vec3 uDeep,uCyan; varying vec2 vUv;
      vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
      float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
        vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
        vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
        vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;
        vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
        m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
        vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}
      float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.0;a*=0.5;}return s*0.5+0.5;}
      // caustics: joltz0r/Hoskins iterative-trig (Maxon Redshift FakeCaustics.osl, Apache-2.0)
      float caustic(vec2 uv,float time){
        vec2 p=mod(uv*6.28318530718,6.28318530718)-250.0; vec2 i=p; float c=1.0; const float inten=0.005;
        for(int n=0;n<4;n++){ float tt=time*(1.0-3.5/float(n+1));
          i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
          c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten))); }
        c/=4.0; c=1.17-pow(c,1.4); return pow(abs(c),8.0);
      }
      // subtle volumetric light from the surface above (not god-rays); hand-written
      vec3 depthGlow(vec2 uv){ float v=smoothstep(1.25,-0.35,uv.y); float sh=0.7+0.3*fbm(uv*4.0+vec2(0.0,uTime*0.25));
        return uCyan*pow(v,2.0)*sh*0.6; }
      void main(){
        float winEnd = clamp(0.58 + 0.34/uSpeed, 0.66, 0.96);
        float sp = smoothstep(0.56, winEnd, uProgress);
        vec2 uv=vUv; float t=uTime;
        vec2 q=(uv-0.5); q.x*=uRes.x/uRes.y; float dist=length(q);
        float dry = mix(1.22, -0.06, sp);
        float feather=0.22;
        float water = smoothstep(dry, dry+feather, dist);
        float crest = smoothstep(feather, 0.0, abs(dist-dry));
        float e=1.6/uRes.y;
        float h0=fbm(uv*6.0+vec2(0.0,t*0.35));
        float hx=fbm((uv+vec2(e,0.0))*6.0+vec2(0.0,t*0.35));
        float hy=fbm((uv+vec2(0.0,e))*6.0+vec2(0.0,t*0.35));
        vec2 n=vec2(h0-hx,h0-hy)*8.0;
        float amp=uAmp*water + uAmp*1.8*crest;
        vec3 scene=texture2D(tDiffuse, uv+n*amp).rgb;
        float ca=caustic(uv*vec2(uRes.x/uRes.y,1.0)*7.0, t*0.8);
        ca*=(1.0-smoothstep(0.0,0.55,uv.y));            // perspective floor fade
        vec3 uw=scene + uCyan*ca*0.42*water;            // additive, masked by water
        uw=mix(uw, uDeep, water*(0.42+0.45*sp));
        vec3 col=mix(texture2D(tDiffuse,uv).rgb, uw, water);
        float foam=crest*smoothstep(0.45,0.8, fbm(uv*20.0+t*0.85));
        col+=foam*vec3(0.8,0.92,1.0)*uFoam*(0.5+0.6*sp);
        float gGate=smoothstep(0.55,0.95,uProgress);
        if(gGate>0.001) col+=depthGlow(uv)*gGate*0.2;   // 0.2 = locked subtle amount
        col=mix(col, uDeep, smoothstep(winEnd, min(winEnd+0.18,1.0), uProgress)*0.94);
        gl_FragColor=vec4(col,1.0);
      }`,
  });
  const splashUniforms = splashPass.uniforms as unknown as SplashUniforms;
  comp.addPass(splashPass);
  comp.setSize(sizeW(), sizeH());

  function applyTier(t: number) {
    TIER = t; const cfg = TIERS[t];
    renderer.setPixelRatio(Math.min(cfg.dpr, window.devicePixelRatio || 1));
    comp.setSize(sizeW(), sizeH()); bloom.setSize(sizeW(), sizeH());
    bloom.enabled = cfg.bloom;
    splashPass.enabled = t < 2;            // skip the extra fullscreen pass on the minimal tier
    UTIER.value = t;
  }

  // load scan
  let river: THREE.Object3D | null = null;
  let pivot: THREE.Group | null = null; // wraps `river` so the model spins about its own centre
  let ready = false;
  let disposed = false; // dropped late GLB resolutions after teardown (Astro nav mid-fetch)
  const readyCbs: (() => void)[] = [];
  const timer = new THREE.Timer();
  timer.connect(document);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  // Every tier uses the Draco-compressed recut. The decoder remains a separate,
  // cacheable asset and is fetched only when the model is decoded.
  const dracoLoader = new DRACOLoader(); dracoLoader.setDecoderPath('/draco/'); loader.setDRACOLoader(dracoLoader);

  const disposeObject = (root: THREE.Object3D) => {
    const materials = new Set<Material>();
    const textures = new Set<THREE.Texture>();

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => materials.add(material));
    });

    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
  };

  loader.load(MODELS + `river-${TIERS[TIER].q}.glb`, (g) => {
    if (disposed) {
      disposeObject(g.scene);
      return;
    }
    river = g.scene;
    let scanMesh: THREE.Mesh | null = null;
    let scanAlbedo: THREE.Texture | null = null;
    river.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          gradeMaterial(material);
          if (!scanMesh) { scanMesh = object; scanAlbedo = material.map; }
        }
      });
      object.frustumCulled = false;
    });
    const box = new THREE.Box3().setFromObject(river);
    const cc = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    const scl = 120 / s.x; river.scale.setScalar(scl);
    // centre the model at the pivot origin so pivot.rotation spins it in place (not orbiting the GLB origin)
    river.position.set(-cc.x * scl, -cc.y * scl, -cc.z * scl);
    pivot = new THREE.Group();
    pivot.position.set(0, -3.5, -5);          // same world centre as before → identical framing
    pivot.add(river);
    pivot.updateMatrixWorld(true);
    scene.add(pivot);
    applyTier(TIER);
    if (scanMesh) void buildSkirt(scanMesh, scanAlbedo);
    timer.reset();
    ready = true;
    readyCbs.forEach(cb => cb());
    scheduleTextureUpgrade();
  }, undefined, (e) => { console.error('[river] load error', e); });

  // ── the skirt: extruded side walls that give the scan mass ────────────────
  // The photogrammetry scan is an open shell — a thin crust you can see through
  // at the rim. scripts/build-river-skirt.mjs bakes its boundary edges into a
  // compact vertex buffer (offline: ~1.5M edge lookups is far too slow here);
  // this streams it, shares the scan's own albedo so the rim seam is invisible,
  // and fades the wall into the void colour so the slab dissolves into black
  // rather than ending in a hard cut. Fetched in parallel with the GLB.
  const SKIRT_ON = new URLSearchParams(location.hash.replace(/^#/, '')).get('thick') !== 'off';
  const skirtBuf: Promise<ArrayBuffer | null> = SKIRT_ON
    ? fetch(MODELS + 'river-skirt.bin').then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    : Promise.resolve(null);
  let skirtMat: THREE.MeshStandardMaterial | null = null;

  async function buildSkirt(scanMesh: THREE.Mesh, albedo: THREE.Texture | null) {
    const buf = await skirtBuf;
    if (!buf || disposed || !albedo) return;

    const [vertCount, idxCount, idxBytes] = new Uint32Array(buf, 0, 3);
    const frame = new Float32Array(buf.slice(12, 36));      // origin xyz + extent xyz
    let o = 36;
    const qPos = new Uint16Array(buf.slice(o, o + vertCount * 3 * 2)); o += vertCount * 3 * 2;
    const qUv = new Uint16Array(buf.slice(o, o + vertCount * 2 * 2)); o += vertCount * 2 * 2;
    const idx = idxBytes === 2
      ? new Uint16Array(buf.slice(o, o + idxCount * 2))
      : new Uint32Array(buf.slice(o, o + idxCount * 4));

    // dequantize (u16 → local space); ~20k verts, sub-millisecond
    const pos = new Float32Array(vertCount * 3);
    const uv = new Float32Array(vertCount * 2);
    for (let i = 0; i < vertCount; i++) {
      for (let c = 0; c < 3; c++) pos[i * 3 + c] = frame[c] + (qPos[i * 3 + c] / 65535) * frame[3 + c];
      for (let c = 0; c < 2; c++) uv[i * 2 + c] = qUv[i * 2 + c] / 65535;
    }

    // first half of the verts is the rim (fade 0), second half the extruded
    // bottom (fade 1) — derived, never stored.
    const half = vertCount / 2;
    const down = new Float32Array(vertCount);
    for (let i = half; i < vertCount; i++) down[i] = 1;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aDown', new THREE.BufferAttribute(down, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    skirtMat = new THREE.MeshStandardMaterial({
      map: albedo, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, fog: true,
    });
    skirtMat.envMapIntensity = 0.35;             // match the scan, else the room env blows it out
    skirtMat.onBeforeCompile = (sh) => {
      sh.uniforms.uVoid = { value: FOG };
      sh.vertexShader = `attribute float aDown; varying float vDown;\n` +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDown = aDown;');
      sh.fragmentShader = `uniform vec3 uVoid; varying float vDown;\n` +
        sh.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          // strata: the rim UVs are smeared down the wall, so darken with depth
          // and dissolve into the void — the slab reads as mass, not a cut edge.
          diffuseColor.rgb *= mix(0.72, 0.16, vDown);
          diffuseColor.rgb = mix(diffuseColor.rgb, uVoid, smoothstep(0.12, 0.92, vDown) * 0.94);`);
    };

    const skirt = new THREE.Mesh(geo, skirtMat);
    skirt.frustumCulled = false;
    scanMesh.add(skirt);                          // child of the mesh → shares its local space exactly
  }

  // ── desktop-only progressive texture upgrade ─────────────────────────────
  // The shipped GLB carries 1k textures so first paint stays ~2MB; once the
  // scene is rendering and the main thread is idle, fetch the original scan's
  // 2k albedo + normal (~2MB, immutable-cached) and hot-swap them in. Failure
  // or a mid-session tier downgrade silently keeps the 1k set.
  function scheduleTextureUpgrade() {
    if (TIER !== 0) return;
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { void upgradeTextures(); }, { timeout: 4000 });
    } else {
      window.setTimeout(() => { void upgradeTextures(); }, 2000);
    }
  }

  async function upgradeTextures() {
    if (disposed || TIER !== 0 || !river) return;
    const mats: THREE.MeshStandardMaterial[] = [];
    river.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => {
        if (m instanceof THREE.MeshStandardMaterial && m.map) mats.push(m);
      });
    });
    if (!mats.length) return;

    // ImageBitmapLoader decodes off the main thread; 'none' matches GLTF's
    // flipY=false convention so the UVs line up with the 1k set.
    const bmLoader = new THREE.ImageBitmapLoader();
    bmLoader.setOptions({ imageOrientation: 'none' });
    let albedoBm: ImageBitmap, normalBm: ImageBitmap;
    try {
      [albedoBm, normalBm] = await Promise.all([
        bmLoader.loadAsync(TEX + 'river-albedo-2k.webp'),
        bmLoader.loadAsync(TEX + 'river-normal-2k.webp'),
      ]);
    } catch { return; } // offline / blocked — the 1k textures stay
    if (disposed || TIER !== 0) { albedoBm.close(); normalBm.close(); return; }

    const albedo = adoptTexture(albedoBm, mats[0].map!, THREE.SRGBColorSpace);
    const normal = mats[0].normalMap ? adoptTexture(normalBm, mats[0].normalMap, THREE.NoColorSpace) : null;
    const retired = new Set<THREE.Texture>();
    mats.forEach((m) => {
      if (m.map) { retired.add(m.map); m.map = albedo; }
      if (normal && m.normalMap) { retired.add(m.normalMap); m.normalMap = normal; }
    });
    // the skirt shares the scan's albedo — repoint it before the old one is
    // disposed, else the side walls would sample a freed texture.
    if (skirtMat) { skirtMat.map = albedo; skirtMat.needsUpdate = true; }
    retired.forEach((t) => t.dispose());
  }

  // Wrap a decoded bitmap in a Texture that inherits the outgoing texture's
  // sampling params, and upload it NOW (idle) so the swap never hitches a frame.
  function adoptTexture(bitmap: ImageBitmap, prev: THREE.Texture, colorSpace: string) {
    const tex = new THREE.Texture(bitmap);
    tex.flipY = false;
    tex.colorSpace = colorSpace;
    tex.wrapS = prev.wrapS; tex.wrapT = prev.wrapT;
    tex.anisotropy = prev.anisotropy;
    tex.needsUpdate = true;
    renderer.initTexture(tex);
    return tex;
  }

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
  let fpsWarm = 0, fpsAcc = 0, fpsN = 0;
  let scrollP = 0; // 0..1 — wired by the scroll step; static frame at 0

  function tick() {
    if (!ready) return;
    timer.update();
    const dt = timer.getDelta();
    if (!reduce) { UTIME.value += dt; if (UTIME.value > 3600) UTIME.value -= 3600; }
    // ── "The Plunge": phase 1 (0→0.55) rotate Y+Z 90° CW + dolly; phase 2 (0.56→~0.68) radial water engulf ──
    const sm = THREE.MathUtils.smoothstep;
    const p1 = sm(scrollP, 0.0, 0.55);     // rotate + dolly amount
    const par = 1 - p1;                    // fade the idle drone parallax as the move commits
    camO.x += (camT.x - camO.x) * 0.04; camO.y += (camT.y - camO.y) * 0.04;
    if (pivot) { pivot.rotation.set(0, 0, 0); pivot.rotation.y = -p1 * (Math.PI / 2); pivot.rotation.z = -p1 * (Math.PI / 4); }
    camera.position.x = camO.x * 4.0 * par;
    camera.position.y = (camBaseY - camO.y * 1.6 * par) - p1 * 1.5;
    camera.position.z = camBaseZ - p1 * 8.5;
    look.set(0, -3.2, -7); camera.lookAt(look);
    renderer.toneMappingExposure = 1.0 + sm(scrollP, 0.55, 0.92) * 0.35;   // bloom catches the surface
    splashUniforms.uProgress.value = scrollP;
    splashUniforms.uTime.value = UTIME.value;
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
    splashUniforms.uRes.value.set(w, h);
  }

  function dispose() {
    disposed = true;
    readyCbs.length = 0;
    window.removeEventListener('pointermove', onPointer);
    timer.dispose();
    dracoLoader.dispose();
    disposeObject(scene);
    disposables.forEach(d => d.dispose());
    envRT.dispose(); pmrem.dispose();
    renderPass.dispose(); bloom.dispose(); outputPass.dispose(); splashPass.dispose(); comp.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return {
    tick, resize, dispose,
    setScrollProgress(p: number) { scrollP = Math.max(0, Math.min(1, p)); },
    onReady(cb) { if (ready) cb(); else readyCbs.push(cb); },
    get ready() { return ready; },
    camera,
    get river() { return river; },
  };
}
