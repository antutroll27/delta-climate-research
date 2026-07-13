// src/scripts/about-field.ts
// The About section's living stage: a NIGHT OCEAN — three.js examples Water
// (planar reflections + normal-map ripples) in Delta deep-teal under a
// twinkling star dome (with sparse bronze anomalies), moonlit low-poly
// icebergs riding a long swell, and three image "rafts" with buoyant physics
// (heave with spring lag, pitch/roll from the swell slope, 56° recline,
// hover grows 1.9× and tips forward). The sea CALMS as the section scrolls:
// data → decision.
//
// three.js + the Water addon are imported dynamically so they only load on
// pages that have the field (home). On success the section gets `.field-on`,
// hiding the static <img> fallbacks; reduced-motion / no-WebGL / failures
// keep the fallbacks and never fetch the chunks. destroyAboutField()
// disposes everything (view-transition safe).

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';

gsap.registerPlugin(ScrollTrigger);

let gen = 0; // generation token — invalidates an init still awaiting chunks
let cleanup: (() => void) | undefined;
let disarm: (() => void) | undefined;


// Cheap sync entry: the heavy boot (three + Water + textures, ~1MB) is
// deferred past the critical path — it fires on the user's first scroll
// intent, or once the main thread goes idle, whichever comes first. (The
// section sits directly under the 100dvh hero, so an IntersectionObserver
// would fire at load and defer nothing.)
export function initAboutField() {
  const section = document.getElementById('about');
  const canvas = section?.querySelector<HTMLCanvasElement>('[data-field]');
  if (!section || !canvas || !motionOK()) return;

  const my = ++gen;
  let idleId: number | undefined;
  let fallbackId: number | undefined;

  // the deferred trigger — runs boot() once, whichever signal lands first
  const fire = () => {
    cancelTrigger();
    if (disarm === cancelTrigger) disarm = undefined;
    if (my !== gen) return;
    boot(section, canvas, my);
  };

  // tears the trigger down again (used by fire() and by destroyAboutField)
  const cancelTrigger = () => {
    window.removeEventListener('scroll', fire);
    window.removeEventListener('pointerdown', fire);
    if (idleId !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    if (fallbackId !== undefined) window.clearTimeout(fallbackId);
  };
  disarm = cancelTrigger;

  window.addEventListener('scroll', fire, { once: true, passive: true });
  window.addEventListener('pointerdown', fire, { once: true, passive: true });

  if (typeof window.requestIdleCallback === 'function') {
    idleId = window.requestIdleCallback(fire, { timeout: 3500 });
  } else {
    fallbackId = window.setTimeout(fire, 1500); // Safari < 17 fallback
  }
}


async function boot(section: HTMLElement, canvas: HTMLCanvasElement, my: number) {
  // ── dynamic import: three + the Water addon (only fetched on the home page) ──
  type AboutThree = Pick<typeof import('./three-runtime'),
    | 'ACESFilmicToneMapping'
    | 'AmbientLight'
    | 'BufferAttribute'
    | 'BufferGeometry'
    | 'Color'
    | 'DirectionalLight'
    | 'EdgesGeometry'
    | 'FogExp2'
    | 'IcosahedronGeometry'
    | 'LineBasicMaterial'
    | 'LineSegments'
    | 'Mesh'
    | 'MeshBasicMaterial'
    | 'MeshStandardMaterial'
    | 'PerspectiveCamera'
    | 'PlaneGeometry'
    | 'Points'
    | 'PointsMaterial'
    | 'Raycaster'
    | 'RepeatWrapping'
    | 'Scene'
    | 'SRGBColorSpace'
    | 'Texture'
    | 'TextureLoader'
    | 'Timer'
    | 'Vector2'
    | 'Vector3'
    | 'WebGLRenderer'
  >;
  let THREE: AboutThree;
  let Water: typeof import('three/examples/jsm/objects/Water.js').Water;
  try {
    const loadThree = import('./three-runtime').then(({
      ACESFilmicToneMapping, AmbientLight, BufferAttribute, BufferGeometry,
      Color, DirectionalLight, EdgesGeometry, FogExp2, IcosahedronGeometry,
      LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
      MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points,
      PointsMaterial, Raycaster, RepeatWrapping, Scene, SRGBColorSpace,
      Texture, TextureLoader, Timer, Vector2, Vector3, WebGLRenderer,
    }) => ({
      ACESFilmicToneMapping, AmbientLight, BufferAttribute, BufferGeometry,
      Color, DirectionalLight, EdgesGeometry, FogExp2, IcosahedronGeometry,
      LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
      MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points,
      PointsMaterial, Raycaster, RepeatWrapping, Scene, SRGBColorSpace,
      Texture, TextureLoader, Timer, Vector2, Vector3, WebGLRenderer,
    }));
    [THREE, { Water }] = await Promise.all([
      loadThree,
      import('three/examples/jsm/objects/Water.js'),
    ]);
  } catch {
    return; // chunks failed — static fallback stays
  }
  if (my !== gen) return; // destroyed while chunks were loading

  const isMobile = window.matchMedia('(max-width: 760px)').matches;

  // ── renderer ──
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return; // no WebGL — static fallback stays
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;

  // teardown bookkeeping — one AbortController for listeners, one list for GPU resources
  const ac = new AbortController();
  const { signal } = ac;
  const disposables: { dispose(): void }[] = [];

  // ── scene + camera ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050606);   // night for reflections to sample
  scene.fog = new THREE.FogExp2(0x050606, 0.006); // horizon melts into the base

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  const baseCam = new THREE.Vector3(0, 2.4, 7.5);
  camera.position.copy(baseCam);
  camera.lookAt(0, 0, 0);

  /* ── moonlight ── */
  const moon = new THREE.DirectionalLight(0xbfdfe4, 1.15);
  moon.position.set(30, 60, -80);
  scene.add(moon);
  scene.add(new THREE.AmbientLight(0x22383b, 0.8));


  /* ── the water (planar reflection + normal-map ripples) ── */
  const waterGeo = new THREE.PlaneGeometry(1600, 1600);
  const waterNormals = new THREE.TextureLoader().load('/textures/waternormals.webp', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });

  const water = new Water(waterGeo, {
    textureWidth: isMobile ? 256 : 512,
    textureHeight: isMobile ? 256 : 512,
    waterNormals,
    sunDirection: new THREE.Vector3(0.25, 0.4, -0.7).normalize(),
    sunColor: 0x7fb6bd,   // cool moon glints
    waterColor: 0x05201d, // Delta deep teal, near-black
    distortionScale: 3.2,
    fog: true,
    alpha: 1.0,
  });
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  disposables.push(waterGeo, water.material, waterNormals);


  /* ── the stars — two clouds, counter-phased twinkle, bronze anomalies ── */
  function makeStars(n: number, size: number) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);

    const cyan = new THREE.Color(0xd9f2f5);
    const dim = new THREE.Color(0x7fa6ab);
    const bronze = new THREE.Color(0xc9a36a);

    for (let i = 0; i < n; i++) {
      // scatter on a dome shell (radius 700–900, elevation 3–75°)
      const r = 700 + Math.random() * 200;
      const el = (3 + Math.random() * 72) * (Math.PI / 180);
      const az = Math.random() * Math.PI * 2;
      pos[i * 3 + 0] = r * Math.cos(el) * Math.sin(az);
      pos[i * 3 + 1] = r * Math.sin(el);
      pos[i * 3 + 2] = r * Math.cos(el) * Math.cos(az);

      // mostly cyan/dim, rare bronze anomaly
      const c = Math.random() < 0.04 ? bronze : Math.random() < 0.5 ? cyan : dim;
      col[i * 3 + 0] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const m = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      fog: false,
      depthWrite: false,
    });

    const p = new THREE.Points(g, m);
    scene.add(p);

    disposables.push(g, m);
    return p;
  }

  const stars1 = makeStars(isMobile ? 500 : 950, 1.9);
  const stars2 = makeStars(isMobile ? 300 : 600, 2.8);


  /* ── icebergs — jittered icosahedra on a long slow swell ── */
  const seeded = (n: number) => (((Math.sin(n * 127.1) * 43758.5453) % 1) + 1) % 1;

  const bergMat = new THREE.MeshStandardMaterial({
    color: 0xdfeef0,
    flatShading: true,
    roughness: 0.82,
    metalness: 0.02,
    emissive: 0x0a2022,
    emissiveIntensity: 0.35,
  });
  disposables.push(bergMat);

  const BERG_DEFS = [
    { x: -55, z: -110, s: 16, seed: 1 },
    { x: 38, z: -85, s: 10, seed: 2 },
    { x: -18, z: -150, s: 22, seed: 3 },
    { x: 85, z: -160, s: 14, seed: 4 },
    { x: -95, z: -190, s: 26, seed: 5 },
  ];

  const bergs: { mesh: import('three').Mesh; baseY: number; phase: number; amp: number }[] = [];
  BERG_DEFS.forEach((d) => {
    const geo = new THREE.IcosahedronGeometry(d.s, 1);

    // jitter each vertex for a rough, flat-bottomed berg
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const jit = 0.66 + seeded(d.seed * 100 + i) * 0.6;
      p.setXYZ(i, p.getX(i) * jit, Math.max(p.getY(i) * jit * 0.62, -d.s * 0.18), p.getZ(i) * jit);
    }
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, bergMat);
    mesh.position.set(d.x, -d.s * 0.12, d.z);
    mesh.rotation.y = seeded(d.seed) * Math.PI * 2;
    scene.add(mesh);

    disposables.push(geo);
    bergs.push({ mesh, baseY: -d.s * 0.12, phase: seeded(d.seed) * Math.PI * 2, amp: 0.35 + seeded(d.seed * 7) * 0.3 });
  });


  /* ── image rafts — buoyant on the swell, nearest plane in the scene ── */
  const CARD_Z = 6.2;
  const BASE_SCALE = isMobile ? 0.38 : 1; // three-across must fit a phone
  const CARD_TILT = (-56 * Math.PI) / 180;
  const HOVER_TILT = (-12 * Math.PI) / 180;
  const DELTA = 0.35;

  type Card = {
    mesh: import('three').Mesh;
    x: number; z: number; y: number; yBase: number;
    rx: number; rz: number; hoverT: number;
  };
  const cards: Card[] = [];
  const cardMeshes: import('three').Mesh[] = [];

  const imgEls = [...section.querySelectorAll<HTMLImageElement>('[data-raft-img]')];
  imgEls.forEach((img) => {
    const geo = new THREE.PlaneGeometry(0.38, 0.253);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0e3236'), toneMapped: false });

    // texture from the DOM image itself — one network fetch, not two
    // (img.decode() forces the lazy fetch if it hasn't started yet)
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    disposables.push(tex);

    const applyTex = () => {
      if (!img.naturalWidth) return;
      tex.needsUpdate = true;
      mat.map = tex;
      mat.color = new THREE.Color('#c9d2d4');
      mat.needsUpdate = true;
    };
    if (img.complete && img.naturalWidth) applyTex();
    else img.decode().then(applyTex).catch(() => {});

    // the raft plane + its cyan wireframe edge
    const mesh = new THREE.Mesh(geo, mat);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x6fcad6, transparent: true, opacity: 0.35 });
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    mesh.add(edge);
    scene.add(mesh);

    disposables.push(geo, mat, edgeGeo, edgeMat);
    cards.push({ mesh, x: 0, z: CARD_Z, y: 0, yBase: 0, rx: 0, rz: 0, hoverT: 0 });
    cardMeshes.push(mesh);
  });


  // gentle analytic swell for raft physics (the Water's visual waves are
  // shader-only; this keeps the rafts' motion consistent with the scene)
  function waveAt(x: number, z: number, t: number, scroll: number) {
    let e = 0;
    e += Math.sin(x * 0.55 + t) * 0.45;
    e += Math.sin(z * 0.85 + t * 1.35) * 0.3;
    e += Math.sin((x + z) * 0.35 + t * 0.8) * 0.35;
    return e * (1 - scroll * 0.85);
  }

  const uState = { scroll: 0 };

  // project each raft from its DOM pillar (or a fixed mobile spread) onto the CARD_Z plane
  function placeCards() {
    const pillarEls = section!.querySelectorAll<HTMLElement>('.pillar');
    const deck = section!.querySelector<HTMLElement>('[data-deck]');
    if (!deck || pillarEls.length < cards.length) return;

    camera.position.copy(baseCam);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const secR = section!.getBoundingClientRect();
    const dR = deck.getBoundingClientRect();
    const ndcY = -((((dR.top + dR.height * 0.5) - secR.top) / secR.height) * 2 - 1);

    cards.forEach((c, idx) => {
      let ndcX: number;
      if (isMobile) {
        ndcX = [-0.55, 0, 0.55][idx] ?? 0;
      } else {
        const r = pillarEls[idx].getBoundingClientRect();
        ndcX = (((r.left + r.width / 2) - secR.left) / secR.width) * 2 - 1;
      }

      // shoot a ray through that screen point and intersect the CARD_Z plane
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      const dir = v.sub(baseCam).normalize();
      const s = (CARD_Z - baseCam.z) / dir.z;
      const hit = baseCam.clone().add(dir.multiplyScalar(s));

      c.x = hit.x;
      c.z = CARD_Z;
      c.yBase = hit.y;
    });
  }

  function resize() {
    const w = section!.clientWidth;
    const h = section!.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCards();
  }
  resize();
  window.addEventListener('resize', resize, { signal });
  const placeTimer = setTimeout(placeCards, 600);


  /* ── pointer: parallax + raycast hover ── */
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(-2, -2);
  let hoveredCard = -1;

  if (!isMobile) {
    window.addEventListener(
      'pointermove',
      (e) => {
        mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);

        const r = canvas.getBoundingClientRect();
        pointerNdc.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -(((e.clientY - r.top) / r.height) * 2 - 1)
        );
      },
      { signal }
    );
  }

  // scroll calms the sea: ripple distortion + raft swell ease together
  const st = ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    end: 'bottom 60%',
    onUpdate: (self) => {
      uState.scroll = self.progress;
      water.material.uniforms.distortionScale.value = 3.2 * (1 - self.progress * 0.8);
    },
  });

  // only run the render loop while the section is on screen
  let visible = false;
  const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
  io.observe(section);


  /* ── the render loop ── */
  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(() => {
    if (!visible) return;

    timer.update();
    const elapsed = timer.getElapsed();

    // water
    water.material.uniforms.time.value = elapsed * 0.55;

    // stars — counter-phased twinkle
    (stars1.material as import('three').PointsMaterial).opacity = 0.58 + Math.sin(elapsed * 0.55) * 0.12;
    (stars2.material as import('three').PointsMaterial).opacity = 0.62 + Math.cos(elapsed * 0.42) * 0.1;

    // icebergs — bob + gentle roll
    bergs.forEach((b) => {
      b.mesh.position.y = b.baseY + Math.sin(elapsed * 0.18 + b.phase) * b.amp;
      b.mesh.rotation.z = Math.sin(elapsed * 0.12 + b.phase) * 0.018;
      b.mesh.rotation.x = Math.cos(elapsed * 0.1 + b.phase * 2) * 0.014;
    });

    // ease the parallax target
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    // hover pick (desktop only)
    if (!isMobile) {
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(cardMeshes, false);
      const next = hits.length ? cardMeshes.indexOf(hits[0].object as import('three').Mesh) : -1;
      if (next !== hoveredCard) {
        hoveredCard = next;
        document.body.style.cursor = hoveredCard >= 0 ? 'pointer' : '';
      }
    }

    // rafts — buoyant physics on the analytic swell
    const t = elapsed * 0.5;
    cards.forEach((c, idx) => {
      // sample the swell height + its slope (central differences) under the raft
      const e = waveAt(c.x, c.z, t, uState.scroll);
      const sx = (waveAt(c.x + DELTA, c.z, t, uState.scroll) - waveAt(c.x - DELTA, c.z, t, uState.scroll)) / (2 * DELTA);
      const sz = (waveAt(c.x, c.z + DELTA, t, uState.scroll) - waveAt(c.x, c.z - DELTA, t, uState.scroll)) / (2 * DELTA);

      // ease the hover weight; hovering dampens the tilt
      c.hoverT += ((idx === hoveredCard ? 1 : 0) - c.hoverT) * 0.055;
      const held = c.hoverT;
      const damp = 1 - held * 0.7;

      // integrate heave (y) + pitch/roll (rx/rz) toward their targets
      c.y += (c.yBase + e * 0.085 + held * 0.06 - c.y) * 0.075;
      c.rx += (-sz * 0.18 * damp - c.rx) * 0.05;
      c.rz += (sx * 0.18 * damp - c.rz) * 0.05;

      // apply — position, recline-that-lifts-on-hover, grow-on-hover
      c.mesh.position.set(c.x, c.y, c.z);
      const baseTilt = CARD_TILT + (HOVER_TILT - CARD_TILT) * held;
      c.mesh.rotation.set(baseTilt + c.rx, 0, c.rz);
      c.mesh.scale.setScalar(BASE_SCALE * (1 + held * 0.9));
    });

    // camera parallax drift
    camera.position.x = mouse.x * 0.45;
    camera.position.y = 2.4 + mouse.y * 0.22;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  });

  // WebGL is live — hide the static fallbacks
  section.classList.add('field-on');

  cleanup = () => {
    clearTimeout(placeTimer);
    ac.abort();
    io.disconnect();
    st.kill();
    renderer.setAnimationLoop(null);
    timer.dispose();
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    document.body.style.cursor = '';
    section.classList.remove('field-on');
  };
}


export function destroyAboutField() {
  gen++; // invalidate any init still awaiting chunks
  disarm?.();
  disarm = undefined;
  cleanup?.();
  cleanup = undefined;
}
