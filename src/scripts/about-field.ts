// src/scripts/about-field.ts
// The About section's living stage: a GPU wave field (three.js Points displaced
// by layered sines in the vertex shader, adapted from the fable-3 sample) plus
// three image "rafts" that ride the SAME sea — height from the wave, tilt from
// its slope, buoyant spring lag, cursor swell, hover grow/tilt-forward — and
// the whole field calms as the section scrolls (uScroll): data → decision.
//
// three.js is imported dynamically so it only loads on pages that have the
// field (home). On success the section gets `.field-on`, hiding the static
// <img> fallbacks; reduced-motion / no-WebGL / failures keep the fallbacks.
// destroyAboutField() disposes everything (view-transition safe).
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';

gsap.registerPlugin(ScrollTrigger);

let gen = 0; // generation token — invalidates an init still awaiting three
let cleanup: (() => void) | undefined;

export async function initAboutField() {
  const my = ++gen;
  const section = document.getElementById('about');
  const canvas = section?.querySelector<HTMLCanvasElement>('[data-field]');
  if (!section || !canvas || !motionOK()) return;

  let THREE: typeof import('three');
  try {
    THREE = await import('three');
  } catch {
    return; // chunk failed to load — static fallback stays
  }
  if (my !== gen) return; // destroyed while the chunk was loading

  const isMobile = window.matchMedia('(max-width: 760px)').matches;

  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return; // no WebGL — static fallback stays
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const ac = new AbortController();
  const { signal } = ac;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const baseCam = new THREE.Vector3(0, 2.4, 7.5);
  camera.position.copy(baseCam);
  camera.lookAt(0, 0, 0);

  /* ── the sea: grid of points displaced in the vertex shader ── */
  const COLS = isMobile ? 110 : 180;
  const ROWS = isMobile ? 60 : 90;
  const W = 26;
  const H = 13;
  const count = COLS * ROWS;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let i = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      positions[i * 3 + 0] = (x / (COLS - 1) - 0.5) * W;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (y / (ROWS - 1) - 0.5) * H;
      seeds[i] = Math.random();
      i++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uScroll: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uColInk: { value: new THREE.Color('#0a1f21') },
    uColCyanLo: { value: new THREE.Color('#4fb0bc') },
    uColCyanHi: { value: new THREE.Color('#6fcad6') },
    uColBronze: { value: new THREE.Color('#b08d57') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uScroll;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vElev;
      varying float vSeed;

      void main() {
        vec3 p = position;
        float t = uTime * 0.5;
        float e = 0.0;
        e += sin(p.x * 0.55 + t) * 0.55;
        e += sin(p.z * 0.85 + t * 1.4) * 0.35;
        e += sin((p.x + p.z) * 0.35 + t * 0.8) * 0.45;

        float mDist = distance(p.xz * vec2(1.0, 2.0), uMouse * vec2(13.0, 6.5));
        e += smoothstep(5.0, 0.0, mDist) * 1.1;

        // the thesis: the field CALMS as the section resolves
        e *= (1.0 - uScroll * 0.85);

        p.y = e;
        vElev = e;
        vSeed = aSeed;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + aSeed * 1.7) * uPixelRatio * (6.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColInk;
      uniform vec3 uColCyanLo;
      uniform vec3 uColCyanHi;
      uniform vec3 uColBronze;
      varying float vElev;
      varying float vSeed;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;

        float energy = smoothstep(0.12, 1.25, abs(vElev));
        vec3 hue = mix(uColCyanLo, uColCyanHi, vSeed);
        if (vSeed > 0.93) hue = uColBronze; // sparse bronze anomalies
        vec3 col = mix(uColInk, hue, energy);

        float alpha = (0.26 + energy * 0.62) * (0.5 + vSeed * 0.5);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.rotation.x = -0.12;
  points.position.z = -0.8; // sea sits just behind the raft plane
  scene.add(points);

  /* ── image rafts — buoyant on the same sea, nearest plane in the scene ── */
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
  const disposables: { dispose(): void }[] = [geometry, material];
  const texLoader = new THREE.TextureLoader();

  const imgEls = [...section.querySelectorAll<HTMLImageElement>('[data-raft-img]')];
  imgEls.forEach((img) => {
    const geo = new THREE.PlaneGeometry(0.38, 0.253);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0e3236'), toneMapped: false });
    texLoader.load(img.currentSrc || img.src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.color = new THREE.Color('#c9d2d4'); // slight dim — sits in the scene, not on it
      mat.needsUpdate = true;
      disposables.push(tex);
    });
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

  // exact JS mirror of the GLSL wave — same sea, same physics
  function waveAt(x: number, z: number, t: number, mx: number, my2: number, scroll: number) {
    let e = 0;
    e += Math.sin(x * 0.55 + t) * 0.55;
    e += Math.sin(z * 0.85 + t * 1.4) * 0.35;
    e += Math.sin((x + z) * 0.35 + t * 0.8) * 0.45;
    const dx = x - mx * 13.0;
    const dz = z * 2.0 - my2 * 6.5;
    const mDist = Math.sqrt(dx * dx + dz * dz);
    let s = Math.min(1, Math.max(0, (5.0 - mDist) / 5.0));
    e += s * s * (3 - 2 * s) * 1.1;
    return e * (1 - scroll * 0.85);
  }

  // place each raft under its pillar column at the fixed near plane
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
  const placeTimer = setTimeout(placeCards, 600); // after fonts/layout settle

  /* ── pointer: swell, parallax, raycast hover ── */
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

  // scroll across the section calms the sea
  const st = ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    end: 'bottom 60%',
    onUpdate: (self) => {
      uniforms.uScroll.value = self.progress;
    },
  });

  // render only while on screen
  let visible = false;
  const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
  io.observe(section);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    uniforms.uTime.value = clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    uniforms.uMouse.value.set(mouse.x, mouse.y);

    // hover raycast
    if (!isMobile) {
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(cardMeshes, false);
      const next = hits.length ? cardMeshes.indexOf(hits[0].object as import('three').Mesh) : -1;
      if (next !== hoveredCard) {
        hoveredCard = next;
        document.body.style.cursor = hoveredCard >= 0 ? 'pointer' : '';
      }
    }

    // raft buoyancy
    const t = uniforms.uTime.value * 0.5;
    const scroll = uniforms.uScroll.value;
    cards.forEach((c, idx) => {
      const e = waveAt(c.x, c.z, t, mouse.x, mouse.y, scroll);
      const slopeX = (waveAt(c.x + DELTA, c.z, t, mouse.x, mouse.y, scroll) -
                      waveAt(c.x - DELTA, c.z, t, mouse.x, mouse.y, scroll)) / (2 * DELTA);
      const slopeZ = (waveAt(c.x, c.z + DELTA, t, mouse.x, mouse.y, scroll) -
                      waveAt(c.x, c.z - DELTA, t, mouse.x, mouse.y, scroll)) / (2 * DELTA);

      c.hoverT += ((idx === hoveredCard ? 1 : 0) - c.hoverT) * 0.055;
      const held = c.hoverT;
      const damp = 1 - held * 0.7;

      c.y += (c.yBase + e * 0.085 + held * 0.06 - c.y) * 0.075;
      c.rx += (-slopeZ * 0.18 * damp - c.rx) * 0.05;
      c.rz += (slopeX * 0.18 * damp - c.rz) * 0.05;

      c.mesh.position.set(c.x, c.y, c.z);
      const baseTilt = CARD_TILT + (HOVER_TILT - CARD_TILT) * held;
      c.mesh.rotation.set(baseTilt + c.rx, 0, c.rz);
      c.mesh.scale.setScalar(BASE_SCALE * (1 + held * 0.9)); // gradual growth, capped 1.9×
    });

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
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    document.body.style.cursor = '';
    section.classList.remove('field-on');
  };
}

export function destroyAboutField() {
  gen++; // invalidate any init still awaiting the three chunk
  cleanup?.();
  cleanup = undefined;
}
