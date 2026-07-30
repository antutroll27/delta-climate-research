/* Hero river hologram — the loading state for the photogrammetry scan.
 *
 * Runs in a Web Worker driving an OffscreenCanvas wherever supported, falling
 * back to the main thread as the same file. The worker is the point, not a
 * nicety: the GLB parse this covers blocks the MAIN thread (measured up to
 * ~2s), and an inline canvas loader freezes mid-twinkle at precisely the
 * moment it exists for. A worker's requestAnimationFrame animates straight
 * through the stall — verified: 85 worker frames across a 600ms main-thread
 * busy-loop, i.e. uninterrupted 60fps.
 *
 * WHY NOT WEBGL. The river boot is GPU-bound (shader compile dominates its
 * 600ms first frame, worst on iGPUs). A WebGL hologram would compile its own
 * shaders inside that window as this page's sixth context. Canvas2D spends
 * the idle resource (CPU, on another thread) and leaves the contended one
 * alone; the GPU still composites the finished canvas.
 *
 * Progress is REAL: the page forwards GLTFLoader byte progress, and the
 * reconstruction stages (points → surface → mesh) advance with it. With no
 * usable content-length it degrades to a slow time-based drift capped at 80%,
 * so the bar never claims completion it cannot know about.
 *
 * The preview/design-iteration copy of this engine lives in
 * previews/hologram/ (gitignored); this file is the shipped one.
 */
'use strict';

const IS_WORKER = typeof document === 'undefined';

/* ── deterministic heightfield: a river valley, shaped to read as the same
      subject as the scan it stands in for ── */
const hash = (x, y) => { const h = Math.sin(x*127.1 + y*311.7) * 43758.5453; return h - Math.floor(h); };
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => t*t*(3-2*t);
const noise2 = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x-xi, yf = y-yi;
  return lerp(lerp(hash(xi,yi),hash(xi+1,yi),sstep(xf)),
              lerp(hash(xi,yi+1),hash(xi+1,yi+1),sstep(xf)), sstep(yf));
};
const fbm = (x, y) => 0.6*noise2(x,y) + 0.28*noise2(x*2.1,y*2.1) + 0.12*noise2(x*4.3,y*4.3);
const channelV = u => 0.5 + 0.14*Math.sin(u*5.1+0.6) + 0.05*Math.sin(u*11.0+2.0);
const WATER_W = 0.12;
function height(u, v) {
  const d = Math.abs(v - channelV(u));
  // continuous at the waterline — a cut here renders as staircase terraces
  const bank = sstep(Math.max(0, Math.min(1, (d - WATER_W) / 0.30)));
  const rock = fbm(u*4.2, v*4.2);
  if (d < WATER_W) return 0.065 + rock*0.012;
  return 0.065 + bank*0.52 + rock*0.16*bank;
}
const inWater = (u, v) => Math.abs(v - channelV(u)) < WATER_W;

/* dense field for particle sampling — 40k particles against the coarse line
   grid would visibly snap to its vertices */
const HW = 160, HH = 96;
const HF = new Float32Array((HW+1)*(HH+1));
for (let j = 0; j <= HH; j++) for (let i = 0; i <= HW; i++) HF[j*(HW+1)+i] = height(i/HW, j/HH);
function sampleH(u, v) {
  const x = Math.max(0, Math.min(HW-0.001, u*HW)), y = Math.max(0, Math.min(HH-0.001, v*HH));
  const xi = x|0, yi = y|0, xf = x-xi, yf = y-yi, r = HW+1;
  return (HF[yi*r+xi]*(1-xf)+HF[yi*r+xi+1]*xf)*(1-yf)
       + (HF[(yi+1)*r+xi]*(1-xf)+HF[(yi+1)*r+xi+1]*xf)*yf;
}

/* ── camera: pitched-down drone view ── */
const GU = 96, GV = 60;
const P = [];
let CAM = null;
const _o = [0, 0, 0];
function computeCamera(t) {
  const pitch = 0.42, sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const yaw = 0.05*Math.sin(t*0.11);
  const bob = 0.03*Math.sin(t*0.23);
  CAM = { f: cvs.height*0.92, sinP, cosP, s: Math.sin(yaw), co: Math.cos(yaw),
          camH: 1.6 + bob, cx: cvs.width/2, cy: cvs.height*0.44 };
}
function projWorld(u, v, z) {
  const wx0 = (u - 0.5) * 6.4, wy0 = 1.15 + v*3.9, wz = z - CAM.camH;
  const wx = wx0*CAM.co - wy0*CAM.s, wy = wx0*CAM.s + wy0*CAM.co;
  const d  = wy*CAM.cosP - wz*CAM.sinP;
  _o[0] = CAM.cx + wx*CAM.f/d;
  _o[1] = CAM.cy - (wy*CAM.sinP + wz*CAM.cosP)*CAM.f/d;
  _o[2] = d;
}
function project() {
  P.length = 0;
  for (let j = 0; j <= GV; j++) for (let i = 0; i <= GU; i++) {
    projWorld(i/GU, j/GV, height(i/GU, j/GV)*0.85);
    P.push(_o[0], _o[1], _o[2]);
  }
}

/* ── engine state ── */
let cvs = null, ctx = null, img = null, buf = null;
let running = false, t0 = 0, lastT = 0;
let pTarget = 0, pShown = 0, gotProgress = false;
let resolveAt = Infinity;
let post = () => {};

const CYAN = [111,202,214], PAPER = [244,246,248];
const col = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0,Math.min(1,a))})`;
const idx = (i, j) => 3*(j*(GU+1)+i);
const fog = d => Math.max(0, Math.min(1, 2.6/d - 0.12));
const sweepV = t => 1 - ((t*0.42) % 1.3);
const boost = (v, sv) => { const d = Math.abs(v - sv); return d < 0.06 ? (1 - d/0.06) : 0; };

function resolveF(t) {
  if (t < resolveAt) return { a: 1, lift: 0, pulse: 0, done: false };
  const k = (t - resolveAt) / 0.95;
  if (k >= 1) return { a: 0, lift: 1, pulse: 0, done: true };
  const e = 1 - Math.pow(1-k, 3);
  return { a: 1 - e*0.9, lift: e, pulse: k < 0.15 ? (1 - k/0.15) : 0, done: false };
}

/* ── particles: shades-of-white dust, flowing cyan water ── */
let N_TARGET = 40000;
let pu, pv, ph, phse, spd, kind;
(function seed() {
  pu = new Float32Array(N_TARGET); pv = new Float32Array(N_TARGET);
  ph = new Float32Array(N_TARGET); phse = new Float32Array(N_TARGET);
  spd = new Float32Array(N_TARGET); kind = new Uint8Array(N_TARGET);
  for (let n = 0; n < N_TARGET; n++) {
    const r1 = hash(n*1.7, 3.1), r2 = hash(n*2.3, 7.7), r3 = hash(n*3.1, 1.3), r4 = hash(n*4.7, 9.2);
    if (r1 < 0.30)      { pu[n] = r2; ph[n] = (r3-0.5)*2*WATER_W*0.8; kind[n] = 1; spd[n] = 0.010 + r4*0.022; }
    else if (r1 < 0.42) { pu[n] = r2; pv[n] = r3; ph[n] = 0.05 + r4*0.30; kind[n] = 2; spd[n] = 0.008 + r4*0.02; }
    else                { pu[n] = r2; pv[n] = r3; ph[n] = (r4*r4)*0.035; kind[n] = 0; spd[n] = 0; }
    phse[n] = r3*6.283;
  }
})();

/* self-throttle — honest degradation on weak machines; the count it reports is
   the count it draws */
let emaDt = 16;
function throttle(dtMs) {
  emaDt = emaDt*0.9 + dtMs*0.1;
  if (emaDt > 26 && N_TARGET > 8000) { N_TARGET = Math.floor(N_TARGET*0.7); emaDt = 16; }
}

const RAMP = [[236,240,241],[190,204,207],[122,140,143],[64,78,81]];
function drawParticles(t, dt, sv, R) {
  const active = Math.floor(N_TARGET * Math.max(0.06, Math.min(1, pShown/0.30)));
  const bw = cvs.width, bh = cvs.height;
  const liftPx = R.lift * bh * 0.06;
  for (let n = 0; n < active; n++) {
    let u = pu[n], v, z;
    const k = kind[n];
    if (k === 1) { u = (u + spd[n]*dt) % 1; pu[n] = u; v = channelV(u) + ph[n]; z = 0.07; }
    else {
      v = pv[n];
      if (k === 2) { ph[n] += spd[n]*dt*0.25; if (ph[n] > 0.38) ph[n] = 0.05; }
      z = sampleH(u, v) + ph[n];
    }
    projWorld(u, v, z*0.85);
    const x = _o[0]|0, y = (_o[1] - liftPx*(0.6 + 0.8*hash(n,1)))|0, d = _o[2];
    if (x < 1 || x >= bw-1 || y < 1 || y >= bh-1) continue;

    const hh = k===1 ? 0 : Math.min(1, (z-0.065)/0.55);
    let I = fog(d) * R.a;
    if (k === 1) I *= 0.85 + 0.35*Math.sin(t*3.2 + u*40 + phse[n]);
    else I *= (0.30 + 0.70*Math.pow(hh, 1.4))
            * (k===2 ? 0.45 : 1 - Math.min(0.7, ph[n]*14))
            * (0.72 + 0.28*Math.sin(t*(3+2*hash(n,2)) + phse[n]));
    I *= 1 + 1.3*boost(v, sv) + R.pulse*0.8;
    if (I <= 0.03) continue;
    if (I > 1) I = 1;

    let r, g, b;
    if (k === 1) { r = CYAN[0]*I; g = CYAN[1]*I; b = CYAN[2]*I; }
    else {
      const cc = RAMP[I > 0.75 ? 0 : I > 0.5 ? 1 : I > 0.25 ? 2 : 3];
      const sc = 0.55 + 0.45*I;
      r = cc[0]*sc; g = cc[1]*sc; b = cc[2]*sc;
    }
    const o = y*bw + x;
    buf[o] = (255<<24) | ((b&255)<<16) | ((g&255)<<8) | (r&255);
    if (I > 0.8) {
      const dim = (255<<24) | (((b*0.4)&255)<<16) | (((g*0.4)&255)<<8) | ((r*0.4)&255);
      buf[o-1] = dim; buf[o+1] = dim; buf[o-bw] = dim; buf[o+bw] = dim;
    }
  }
  return active;
}

/* ── line stages over the dust ── */
function strokeRowPath(j, lift, dy) {
  ctx.beginPath();
  for (let i = 0; i <= GU; i++) { const k = idx(i,j); const y = P[k+1]-lift-(dy||0); i?ctx.lineTo(P[k],y):ctx.moveTo(P[k],y); }
}
function strokeSeg(seg, j, base, lift, t) {
  const to = seg.to ?? seg.from + 1;
  ctx.beginPath();
  for (let i = seg.from; i <= to; i++) { const k = idx(i,j); const y = P[k+1]-lift; i===seg.from?ctx.moveTo(P[k],y):ctx.lineTo(P[k],y); }
  const shimmer = seg.w ? 0.25*Math.sin(t*2.4 + j*0.7) : 0;
  ctx.strokeStyle = col(seg.w ? CYAN : PAPER, seg.w ? Math.min(1, base*1.5)+shimmer : base*0.5);
  ctx.lineWidth = seg.w ? 1.7 : 0.85; ctx.stroke();
}
function segmentedRow(j, base, lift, t) {
  let run = null;
  const v = j/GV;
  for (let i = 0; i < GU; i++) {
    const w = inWater(i/GU, v);
    if (!run || run.w !== w) { if (run) strokeSeg({...run, to:i}, j, base, lift, t); run = { w, from: i }; }
  }
  if (run) strokeSeg({ ...run, to: GU }, j, base, lift, t);
}
function rowsAndCols(t, sv, A, lift, pulse, rowsIn, colsIn) {
  if (rowsIn > 0) {
    const front = rowsIn * 1.08;
    for (let j = GV; j >= 0; j--) {
      const v = j/GV, rel = front - (1 - v);
      if (rel <= 0) continue;
      const soft = Math.min(1, rel / 0.10);
      const d = P[idx(1,j)+2];
      const base = A * fog(d) * soft * (0.30 + 0.5*boost(v,sv) + pulse);
      strokeRowPath(j, lift, 0);
      ctx.strokeStyle = col(PAPER, base*0.10); ctx.lineWidth = 3.5; ctx.stroke();
      strokeRowPath(j, lift, 6*(cvs.height/1200));
      ctx.strokeStyle = col(PAPER, base*0.10); ctx.lineWidth = 0.8; ctx.stroke();
      segmentedRow(j, base, lift, t);
    }
  }
  if (colsIn > 0) {
    for (let i = 0; i <= GU; i += 2) {
      ctx.beginPath();
      for (let j = 0; j <= GV; j++) { const k = idx(i,j); const y = P[k+1]-lift; j?ctx.lineTo(P[k],y):ctx.moveTo(P[k],y); }
      ctx.strokeStyle = col(PAPER, A*0.07*colsIn); ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
}
function ringAndPins(t, A, lift) {
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  for (let a = 0; a <= 64; a++) {
    const th = a/64*6.283;
    projWorld(0.5 + Math.cos(th)*0.52, 0.5 + Math.sin(th)*0.52, 0.02);
    a?ctx.lineTo(_o[0], _o[1]-lift):ctx.moveTo(_o[0], _o[1]-lift);
  }
  ctx.strokeStyle = col(PAPER, A*0.14); ctx.lineWidth = 1;
  ctx.lineDashOffset = -t*14; ctx.stroke();
  ctx.setLineDash([]);

  const fpx = Math.round(10*(cvs.height/900));
  ctx.font = `${fpx}px 'Noplato Mono', monospace`;
  for (const pin of [
    { u: 0.72, v: 0.13, z: sampleH(0.72, 0.13)*0.85, label: 'RIDGE +0.61' },
    { u: 0.30, v: channelV(0.30), z: 0.06, label: 'CHANNEL −0.02' },
  ]) {
    projWorld(pin.u, pin.v, pin.z);
    const x = _o[0], y = _o[1]-lift;
    ctx.strokeStyle = col(PAPER, A*0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
    ctx.fillStyle = col(PAPER, A*0.55); ctx.fillRect(x-1.5, y-1.5, 3, 3);
    ctx.fillStyle = col([201,212,214], A*0.85);
    ctx.fillText(pin.label, x + 6, y - 38);
  }
}

/* ── status: the words agree with what the eye sees happening ── */
const MSGS = [
  [0.00, 'Acquiring point cloud'],
  [0.30, 'Fitting surface'],
  [0.60, 'Closing mesh'],
  [0.85, 'Compiling water shader'],
];
function statusFor() {
  let m = MSGS[0][1];
  for (const [at, s] of MSGS) if (pShown >= at) m = s;
  return m;
}

/* ── frame loop ── */
let telemAt = 0;
function frame(now) {
  if (!running) return;
  const t = (now - t0) / 1000;
  const dt = Math.min(0.1, t - lastT); lastT = t;
  throttle(dt*1000);

  // progress: real bytes when available, a capped drift when not — the drift
  // never exceeds 80%, so the bar cannot claim knowledge it lacks
  if (!gotProgress) pTarget = Math.max(pTarget, Math.min(0.8, t/6*0.8));
  pShown = Math.min(pTarget, pShown + dt*0.5);

  const R = resolveF(t);
  computeCamera(t);
  project();
  const sv = sweepV(t);

  buf.fill(0xFF060605);
  const active = drawParticles(t, dt, sv, R);
  ctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const rowsIn = Math.max(0, Math.min(1, (pShown - 0.22) / 0.40));
  const colsIn = Math.max(0, Math.min(1, (pShown - 0.55) / 0.30));
  const lift = R.lift * cvs.height * 0.05;
  rowsAndCols(t, sv, R.a, lift, R.pulse, rowsIn, colsIn);
  ringAndPins(t, R.a, lift);
  ctx.globalCompositeOperation = 'source-over';

  if (now - telemAt > 250) {
    telemAt = now;
    post({ telem: { msg: t >= resolveAt ? 'Scan resolved · rendering' : statusFor(),
                    p: t >= resolveAt ? 1 : pShown, pts: active } });
  }
  if (R.done) { running = false; post({ done: true }); return; }
  requestAnimationFrame(frame);
}

/* ── control surface ── */
const engine = {
  init(canvas, opts) {
    cvs = canvas; ctx = cvs.getContext('2d');
    this.resize(opts.width, opts.height, opts.dpr || 1);
    try {
      const f = new FontFace('Noplato Mono', "url('/fonts/noplato-mono-condensed.woff2')");
      f.load().then(() => { (IS_WORKER ? self.fonts : document.fonts).add(f); }).catch(() => {});
    } catch {}
    t0 = performance.now(); lastT = 0; running = true;
    requestAnimationFrame(frame);
  },
  resize(w, h, dpr) {
    // dust does not need retina; the cap keeps fill + putImageData cheap
    const d = Math.min(dpr || 1, 1.5);
    cvs.width = Math.floor(w * d); cvs.height = Math.floor(h * d);
    img = ctx.createImageData(cvs.width, cvs.height);
    buf = new Uint32Array(img.data.buffer);
  },
  progress(loaded, total) {
    if (total > 0) { gotProgress = true; pTarget = Math.max(pTarget, Math.min(1, 0.9 * loaded / total)); }
  },
  resolve() {
    pTarget = 1; pShown = Math.max(pShown, 0.86);   // stages close as it dissolves
    if (resolveAt === Infinity) resolveAt = (performance.now() - t0) / 1000;
  },
  stop() { running = false; },
};

if (IS_WORKER) {
  post = (m) => self.postMessage(m);
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init')     engine.init(m.canvas, m);
    if (m.type === 'resize')   engine.resize(m.width, m.height, m.dpr);
    if (m.type === 'progress') engine.progress(m.loaded, m.total);
    if (m.type === 'resolve')  engine.resolve();
    if (m.type === 'stop')     engine.stop();
  };
} else {
  self.HoloEngine = engine;
  self.HoloEnginePostHook = (fn) => { post = fn; };
}
