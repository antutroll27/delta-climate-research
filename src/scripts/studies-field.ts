// src/scripts/studies-field.ts
// Section 03's two living panels, both procedural, neither a measurement:
//
//  HEAT   a synthetic land-surface-temperature field drawn on a 2D canvas —
//         fractal noise shaped by an urban fabric (denser blocks run hotter),
//         cooled by a river corridor and two parks, drifting through a slow
//         diurnal cycle, with an "overpass" sweep that refreshes the field
//         left to right the way a thermal pass would. It stands in for the
//         ECOSTRESS product and is LABELLED procedural in the markup. Zero
//         bytes of imagery; ~64k pixels a frame at 20 fps, only while visible.
//
//  LEDGER a CBAM certificate estimate that cycles through three goods —
//         bars scale, figures count, a dot walks the route. DOM + transforms
//         only, so it composites. The numbers are ILLUSTRATIVE and say so;
//         the real engine refuses to print a figure it cannot source, and the
//         panel links to it rather than imitating it.
//
// Same lifecycle shape as about-field.ts: init is idempotent, destroy is
// view-transition safe, reduced motion gets one static frame of each.

import { motionOK } from '../utils/motion';

let cleanup: (() => void) | undefined;

/* ───────────────────────── HEAT ───────────────────────── */

const W = 320, H = 200;
const T_MIN = 29, T_MAX = 38;

// 5-stop ramp, close to the OBOS legend (Comfortable → Extreme). Not the
// climate stripes, which stay sealed.
const RAMP: [number, number, number][] = [
  [0x5f, 0xb7, 0xc1], // comfortable
  [0xa9, 0xc4, 0x6b], // warm
  [0xe4, 0xb3, 0x4a], // hot
  [0xe7, 0x7a, 0x3e], // severe
  [0xea, 0x4b, 0x4b], // extreme
];
const LUT = new Uint8ClampedArray(256 * 3);
for (let i = 0; i < 256; i++) {
  const p = (i / 255) * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(p)), f = p - k;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * f;
}

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm(x: number, y: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 5; o++) { v += amp * vnoise(x * f, y * f); amp *= 0.5; f *= 2.05; }
  return v; // ~0..1
}

// Static shape of the city, computed once: base noise, block density, cooling.
function buildCity() {
  const base = new Float32Array(W * H);
  const dens = new Float32Array(W * H);
  const cool = new Float32Array(W * H);
  const street = new Uint8Array(W * H);
  const CELL = 14;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // fractal texture with a little domain warp so it does not read as a grid
      const wx = x / 92 + fbm(x / 140 + 7.3, y / 140) * 0.6;
      const wy = y / 92 + fbm(x / 140, y / 140 + 3.1) * 0.6;
      base[i] = fbm(wx, wy);
      // blocks: each cell a density, streets on the cell edges
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      const d = 0.35 + 0.65 * hash(cx * 3.7, cy * 5.1) * (0.6 + 0.4 * fbm(cx / 6, cy / 6));
      dens[i] = d;
      if (x % CELL === 0 || y % CELL === 0) street[i] = 1;
      // river: a sinuous cool corridor; two parks: soft cool blobs
      const rx = W * 0.64 + 22 * Math.sin(y / H * 4.7) + 9 * Math.sin(y / H * 11.3 + 1.2);
      const rd = Math.abs(x - rx);
      let c = rd < 6 ? 4.6 : rd < 16 ? 4.6 * (1 - (rd - 6) / 10) : 0;
      const parks: [number, number, number][] = [[W * 0.24, H * 0.62, 26], [W * 0.46, H * 0.22, 18]];
      for (const [px, py, pr] of parks) {
        const dd = Math.hypot(x - px, (y - py) * 1.3);
        if (dd < pr) c = Math.max(c, 2.6 * (1 - (dd / pr) ** 2));
      }
      cool[i] = c;
    }
  }
  // fBM averages to mid-range, which would park every pixel in the middle of
  // the ramp. Stretch both fields to their true extent so the map uses the
  // whole scale — cool water and parks at one end, dense cores at the other.
  for (const f of [base, dens]) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    const k = hi > lo ? 1 / (hi - lo) : 1;
    for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k;
  }
  return { base, dens, cool, street };
}

function paintHeat(img: ImageData, city: ReturnType<typeof buildCity>, t: number, sweep: boolean) {
  const { base, dens, cool, street } = city;
  const px = img.data;
  const diurnal = 1.3 * Math.sin(t * 0.05);
  // the overpass: a bright line that walks across every ~9 s; pixels ahead of
  // it are the previous pass (dimmer), pixels behind it are fresh
  const sx = sweep ? ((t * 0.11) % 1.25 - 0.125) * W : -1e9;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    let T = 28.9 + 5.4 * base[i] + 3.2 * dens[i] - cool[i] * 1.35 + diurnal;
    if (street[i]) T -= 0.6;
    let u = (T - T_MIN) / (T_MAX - T_MIN);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const k = (u * 255) | 0;
    let r = LUT[k * 3], g = LUT[k * 3 + 1], b = LUT[k * 3 + 2];
    const x = i % W;
    if (sweep) {
      const dx = x - sx;
      if (dx > 1.5) {            // stale side: dimmer, a touch desaturated
        const l = (r + g + b) / 3;
        r = (r * 0.62 + l * 0.12) | 0; g = (g * 0.62 + l * 0.12) | 0; b = (b * 0.62 + l * 0.12) | 0;
      } else if (dx > -3) {      // the scan line itself, with a short glow behind it
        const glow = dx > 0 ? 1 - dx / 1.5 : 1 + dx / 3;
        r = (r + (0x9f - r) * glow * 0.9) | 0; g = (g + (0xe8 - g) * glow * 0.9) | 0; b = (b + (0xf0 - b) * glow * 0.9) | 0;
      }
    }
    px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
  }
}

/* ───────────────────────── LEDGER ───────────────────────── */

// ILLUSTRATIVE. Order-of-magnitude figures for three CBAM goods so the panel
// has something to animate. They are not the engine's defaults, which are
// versioned by CN code and refuse to print when unpublished — the panel's
// mono tag says "illustrative" and the link goes to the calculator.
const GOODS = [
  { name: 'Steel (BF–BOF)',      direct: 1.9, elec: 0.3, prec: 0.4 },
  { name: 'Cement (clinker)',    direct: 0.6, elec: 0.1, prec: 0.1 },
  { name: 'Aluminium (primary)', direct: 1.6, elec: 6.0, prec: 0.6 },
];
const PRICE_EUR = 75;   // illustrative € per t CO₂e
const BAR_MAX = 6.4;    // the tallest component in the set, so scaleY stays ≤ 1

/* ───────────────────────── lifecycle ───────────────────────── */

export function initStudiesField() {
  const section = document.getElementById('studies');
  if (!section) return;
  destroyStudiesField();

  const ac = new AbortController();
  const { signal } = ac;
  const motion = motionOK();

  /* heat */
  const canvas = section.querySelector<HTMLCanvasElement>('[data-heat]');
  let heatRaf = 0, heatVisible = false, heatLast = 0;
  const city = buildCity();
  const ctx = canvas?.getContext('2d', { alpha: false }) ?? null;
  const img = ctx ? ctx.createImageData(W, H) : null;
  const t0 = performance.now();
  const drawHeat = (now: number) => {
    heatRaf = 0;
    if (!ctx || !img) return;
    if (now - heatLast < 50) { heatRaf = requestAnimationFrame(drawHeat); return; } // ~20 fps
    heatLast = now;
    paintHeat(img, city, (now - t0) / 1000, true);
    ctx.putImageData(img, 0, 0);
    if (heatVisible) heatRaf = requestAnimationFrame(drawHeat);
  };
  if (ctx && img) {
    canvas!.width = W; canvas!.height = H;
    if (!motion) { paintHeat(img, city, 0, false); ctx.putImageData(img, 0, 0); }
  }

  /* ledger */
  const ledger = section.querySelector<HTMLElement>('[data-ledger]');
  const bars = ledger ? [...ledger.querySelectorAll<HTMLElement>('[data-bar]')] : [];
  const nameEl = ledger?.querySelector<HTMLElement>('[data-good]') ?? null;
  const tabs = ledger ? [...ledger.querySelectorAll<HTMLElement>('[data-tab]')] : [];
  const totEl = ledger?.querySelector<HTMLElement>('[data-total]') ?? null;
  const eurEl = ledger?.querySelector<HTMLElement>('[data-eur]') ?? null;
  const dot = ledger?.querySelector<HTMLElement>('[data-dot]') ?? null;
  let gi = 0, ledgerTimer = 0, countRaf = 0;
  const showGood = (idx: number, animate: boolean) => {
    const g = GOODS[idx];
    const vals = [g.direct, g.elec, g.prec];
    bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.min(1, Math.pow(vals[i] / BAR_MAX, 0.6)).toFixed(3)})`; });
    if (nameEl) nameEl.textContent = g.name;
    tabs.forEach((t, i) => t.classList.toggle('is-on', i === idx));
    const total = g.direct + g.elec + g.prec, eur = total * PRICE_EUR;
    if (!animate || !totEl || !eurEl) { if (totEl) totEl.textContent = total.toFixed(1); if (eurEl) eurEl.textContent = Math.round(eur).toLocaleString('en-GB'); return; }
    // count the two figures up from their current values
    const from = [parseFloat(totEl.textContent || '0') || 0, parseFloat((eurEl.textContent || '0').replace(/,/g, '')) || 0];
    const start = performance.now();
    cancelAnimationFrame(countRaf);
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / 900), e = 1 - Math.pow(1 - u, 3);
      totEl.textContent = (from[0] + (total - from[0]) * e).toFixed(1);
      eurEl.textContent = Math.round(from[1] + (eur - from[1]) * e).toLocaleString('en-GB');
      if (u < 1) countRaf = requestAnimationFrame(step);
    };
    countRaf = requestAnimationFrame(step);
    // the dot walks the route once per good
    if (dot) { dot.style.transition = 'none'; dot.style.transform = 'translateX(0)'; void dot.offsetWidth; dot.style.transition = 'transform 3.2s cubic-bezier(0.16, 1, 0.3, 1)'; dot.style.transform = 'translateX(var(--route-w))'; }
  };
  showGood(0, false);

  /* visibility drives both */
  const io = new IntersectionObserver(([e]) => {
    const on = e.isIntersecting && document.visibilityState !== 'hidden';
    heatVisible = on && motion;
    if (heatVisible && !heatRaf) heatRaf = requestAnimationFrame(drawHeat);
    if (motion) {
      clearInterval(ledgerTimer);
      if (on) { showGood(gi, true); ledgerTimer = window.setInterval(() => { gi = (gi + 1) % GOODS.length; showGood(gi, true); }, 4600); }
    }
  }, { threshold: 0.15 });
  io.observe(section);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { heatVisible = false; clearInterval(ledgerTimer); } }, { signal });

  cleanup = () => {
    ac.abort();
    io.disconnect();
    cancelAnimationFrame(heatRaf); heatRaf = 0;
    cancelAnimationFrame(countRaf);
    clearInterval(ledgerTimer);
  };
}

export function destroyStudiesField() {
  cleanup?.();
  cleanup = undefined;
}
