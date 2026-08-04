/**
 * cloud-sprites.ts — the cloud's shape, as pure geometry plus a painter.
 *
 * RENDER ONLY. Nothing here reaches SimLayers or Spatial. The cover this draws is
 * `state.live.cloud`, which heat-map-model.ts already feeds to skyTemperatureC and
 * to the direct-sun term — so this is the model's own input made visible, not a
 * second opinion about the sky.
 *
 * TWO BUGS ARE ENCODED AS STRUCTURE HERE, because both shipped in the preview and
 * both looked like styling problems rather than defects:
 *
 *   1. Lobes were positioned in canvas pixels and the outer ones ran past the
 *      bitmap bounds, so the texture's RECTANGLE became the cloud's silhouette.
 *      Layout is now abstract and `fitLobes` scales it in with a margin. Guarded.
 *   2. A gradient that fades from the centre reads as haze, not as a bump. Alpha
 *      holds near-full to a PLATEAU and only then falls — that plateau is what
 *      draws a curved edge.
 *
 * Lobes are ellipses, squashed hardest at the base and near-round at the crown,
 * which is what gives a cumulus its flat bottom and domed top.
 */

/** Approved from a live preview over the real ward, 2026-08-05. */
export const CLOUD = Object.freeze({
  ROUND: 0.62,
  OVAL: 0.72,
  SIZE: 0.72,
  /** metres. Real cloud base is nearer 700 m; compressed for legibility and labelled. */
  DECK_M: 320,
  COUNT: 26,
  /** fraction of the sprite kept clear on every side */
  PAD: 0.13,
  /** cover at which cumulus start fusing into veils, and the width of that fuse */
  FUSE_AT: 0.42,
  FUSE_SPAN: 0.44,
});

export interface Lobe {
  cx: number; cy: number; rx: number; ry: number; main?: boolean;
}

/** 0 = discrete cumulus, 1 = merged veil. Continuous and monotonic in cover. */
export function cloudFuse(cover: number): number {
  return Math.max(0, Math.min(1, (cover - CLOUD.FUSE_AT) / CLOUD.FUSE_SPAN));
}

/** Scale an abstract lobe cluster into a canvas, leaving `pad` clear on every side. */
export function fitLobes(lobes: Lobe[], W: number, H: number, pad: number): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lobes) {
    minX = Math.min(minX, L.cx - L.rx); maxX = Math.max(maxX, L.cx + L.rx);
    minY = Math.min(minY, L.cy - L.ry); maxY = Math.max(maxY, L.cy + L.ry);
  }
  const availW = W * (1 - 2 * pad), availH = H * (1 - 2 * pad);
  const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const offX = W * pad + (availW - (maxX - minX) * s) / 2;
  const offY = H * pad + (availH - (maxY - minY) * s) / 2;
  for (const L of lobes) {
    L.cx = offX + (L.cx - minX) * s;
    L.cy = offY + (L.cy - minY) * s;
    L.rx *= s; L.ry *= s;
  }
}

const ROWS = [
  { n: 6, y: 0.52, r: [0.125, 0.165], s: 1.52, sq: 0.60 },
  { n: 5, y: 0.36, r: [0.130, 0.175], s: 1.26, sq: 0.70 },
  { n: 3, y: 0.22, r: [0.115, 0.155], s: 0.80, sq: 0.80 },
  { n: 2, y: 0.11, r: [0.088, 0.120], s: 0.40, sq: 0.86 },
];

export function layoutCumulus(rnd: () => number, oval: number): Lobe[] {
  const SPREAD = 0.70 + oval * 0.62, SQUASH = 1.24 - oval * 0.46;
  const lobes: Lobe[] = [];
  for (const row of ROWS)
    for (let i = 0; i < row.n; i++) {
      const u = row.n === 1 ? 0.5 : i / (row.n - 1);
      const rx = row.r[0] + rnd() * (row.r[1] - row.r[0]);
      lobes.push({
        cx: 0.9 + (u - 0.5) * row.s * SPREAD + (rnd() - 0.5) * 0.06,
        cy: row.y + (rnd() - 0.5) * 0.035,
        rx, ry: rx * Math.min(0.94, row.sq * SQUASH + (rnd() - 0.5) * 0.07),
        main: true,
      });
    }
  /* Second octave. A handful of big shapes reads as a cartoon; real cumulus
     outlines are fractal, so smaller bumps ride the silhouette. */
  const mains = lobes.slice();
  for (let i = 0; i < 26; i++) {
    const L = mains[(rnd() * mains.length) | 0];
    const a = L.cy < 0.30 ? Math.PI * (1.02 + rnd() * 0.96)
      : (rnd() < 0.5 ? Math.PI * (0.70 + rnd() * 0.55) : Math.PI * (1.02 + rnd() * 0.96));
    const rx = L.rx * (0.24 + rnd() * 0.26);
    lobes.push({
      cx: L.cx + Math.cos(a) * L.rx * (0.70 + rnd() * 0.24),
      cy: L.cy + Math.sin(a) * L.ry * (0.66 + rnd() * 0.26),
      rx, ry: rx * (0.66 + rnd() * 0.22),
    });
  }
  return lobes;
}

export function layoutVeil(rnd: () => number): Lobe[] {
  const lobes: Lobe[] = [];
  for (let i = 0; i < 15; i++) {
    const rx = 0.11 + rnd() * 0.15;
    lobes.push({
      cx: rnd() * 1.9, cy: 0.5 + (rnd() - 0.5) * 0.34,
      rx, ry: rx * (0.30 + rnd() * 0.18),
    });
  }
  return lobes;
}

/** Alpha holds to this fraction of the radius, then falls. THE plateau — a gradient
 *  that fades from the centre reads as haze rather than as a curved bump. */
const plateau = (round: number) => 0.46 + round * 0.40;

export function paintCumulus(
  ctx: CanvasRenderingContext2D, lobes: Lobe[], W: number, H: number, round: number,
): void {
  let top = Infinity, bot = -Infinity;
  for (const L of lobes) { top = Math.min(top, L.cy - L.ry); bot = Math.max(bot, L.cy + L.ry); }
  const span = bot - top, P = plateau(round);

  ctx.save(); ctx.filter = `blur(${W * 0.022}px)`;
  const bg = ctx.createLinearGradient(0, bot - span * 0.38, 0, bot);
  bg.addColorStop(0, 'rgba(118,142,164,.46)'); bg.addColorStop(1, 'rgba(106,130,152,0)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(W * 0.5, bot - span * 0.12, W * 0.36, span * 0.16, 0, 0, 7);
  ctx.fill(); ctx.restore();

  for (const L of [...lobes].sort((a, b) => b.cy - a.cy)) {
    const hf = 1 - (L.cy - top) / span;                 // 0 base -> 1 crown
    const lum = 236 + hf * 19, mid = 196 + hf * 46;
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(1, L.ry / L.rx);
    const gr = ctx.createRadialGradient(-L.rx * 0.20, -L.rx * 0.34, L.rx * 0.05, 0, 0, L.rx);
    gr.addColorStop(0.00, 'rgba(255,255,255,.97)');
    gr.addColorStop(P * 0.62, `rgba(${lum | 0},${(lum + 2) | 0},255,.95)`);
    gr.addColorStop(P, `rgba(${mid | 0},${(mid + 8) | 0},${(mid + 20) | 0},.90)`);
    gr.addColorStop(P + (1 - P) * 0.40,
      `rgba(${(156 + hf * 48) | 0},${(172 + hf * 46) | 0},${(192 + hf * 40) | 0},.40)`);
    gr.addColorStop(P + (1 - P) * 0.72,
      `rgba(${(128 + hf * 42) | 0},${(146 + hf * 40) | 0},${(168 + hf * 34) | 0},.11)`);
    gr.addColorStop(1.00, 'rgba(116,136,160,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, L.rx, 0, 7); ctx.fill();
    if (L.main) {                                        // rim light, big bumps only
      ctx.filter = `blur(${L.rx * 0.10}px)`;
      ctx.strokeStyle = `rgba(255,255,255,${0.13 + hf * 0.23})`;
      ctx.lineWidth = L.rx * 0.14;
      ctx.beginPath(); ctx.arc(0, 0, L.rx * P * 0.90, Math.PI * 1.16, Math.PI * 1.90);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function paintVeil(
  ctx: CanvasRenderingContext2D, lobes: Lobe[], W: number, H: number, round: number,
): void {
  const P = 0.38 + round * 0.34;
  ctx.filter = `blur(${W * (0.030 - round * 0.014)}px)`;
  for (const L of [...lobes].sort((a, b) => b.cy - a.cy)) {
    const hf = 1 - L.cy / H;
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(1, L.ry / L.rx);
    const gr = ctx.createRadialGradient(0, -L.rx * 0.20, 0, 0, 0, L.rx);
    gr.addColorStop(0, `rgba(255,255,255,${0.30 + hf * 0.20})`);
    gr.addColorStop(P,
      `rgba(${(226 + hf * 24) | 0},${(234 + hf * 18) | 0},${(242 + hf * 12) | 0},${0.23 + hf * 0.12})`);
    gr.addColorStop(P + (1 - P) * 0.5, 'rgba(202,216,230,.09)');
    gr.addColorStop(1, 'rgba(186,202,216,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, L.rx, 0, 7); ctx.fill(); ctx.restore();
  }
}

export function paintShadow(ctx: CanvasRenderingContext2D, px: number): void {
  const gr = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  gr.addColorStop(0, 'rgba(6,14,18,.62)');
  gr.addColorStop(0.55, 'rgba(6,14,18,.30)');
  gr.addColorStop(1, 'rgba(6,14,18,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, px, px);
}

/** Canvas aspects the layouts are designed for. The billboard MUST use these — a
 *  hardcoded aspect stretches the ovals back into circles and the fix looks inert. */
export const CUMULUS_ASPECT = 0.74 - CLOUD.OVAL * 0.32;   // 0.51
export const VEIL_ASPECT = 0.58 - CLOUD.OVAL * 0.22;      // 0.42
