/**
 * cloud-layer.ts — the ward's measured cloud cover, drawn as sky.
 *
 * RENDER ONLY, in the sense water-layer.ts and road-layer.ts mean it.
 *
 * NOT DRAPED ON THE GROUND, and that is the whole design. A Himawari pixel is
 * ~2 km at Kolkata against a 1,400 m ward — one cloud pixel is wider than the ward
 * — so satellite cloud cannot be a map layer here. This draws COVER, a scalar
 * met.no measures, as sprites at altitude. It never claims structure inside the ward.
 *
 * The deck sits at CLOUD.DECK_M (320 m) against a real base nearer 700 m. That
 * compression is labelled on screen, the same contract terrain.ts keeps for its ×4.
 *
 * Sprites are baked ONCE per session — they are weather, not geography — and drift
 * and opacity are transform writes only. No geometry is rebuilt after boot.
 */
import * as THREE from 'three';
import {
  CLOUD, cloudFuse, fitLobes, layoutCumulus, layoutVeil,
  paintCumulus, paintVeil, paintShadow, CUMULUS_ASPECT, VEIL_ASPECT,
} from './cloud-sprites';

export interface CloudLayer {
  readonly group: THREE.Group;
  /** advance drift and cross-fade; seconds, cover 0..1, wind m/s, direction wind comes FROM */
  update(seconds: number, cover: number, windMs: number, fromDeg: number): void;
  /** key-light multiplier for this cover — the SAME scalar the physics reads, so
   *  what the eye infers about sunlight cannot drift from what the model computes */
  sunFactor(cover: number): number;
  dispose(): void;
}

/** Deterministic, so every session bakes the same sky and a screenshot is reproducible. */
function seeded(s: number): () => number {
  let v = s >>> 0;
  return () => (v = (v * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function bake(
  W: number, H: number, paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Drift field, metres. Wide enough that a cloud leaves the frame before it wraps. */
const FIELD = 2600;

export function createCloudLayer(
  groundAt: (x: number, y: number) => number,
): CloudLayer {
  const rnd = seeded(7723117);
  const CUM: THREE.CanvasTexture[] = [], VEI: THREE.CanvasTexture[] = [];
  for (let i = 0; i < 4; i++) {
    const W = 512, H = Math.round(W * CUMULUS_ASPECT);
    const lobes = layoutCumulus(rnd, CLOUD.OVAL);
    fitLobes(lobes, W, H, CLOUD.PAD);
    CUM.push(bake(W, H, ctx => paintCumulus(ctx, lobes, W, H, CLOUD.ROUND)));
  }
  for (let i = 0; i < 3; i++) {
    const W = 768, H = Math.round(W * VEIL_ASPECT);
    const lobes = layoutVeil(rnd);
    fitLobes(lobes, W, H, CLOUD.PAD);
    VEI.push(bake(W, H, ctx => paintVeil(ctx, lobes, W, H, CLOUD.ROUND)));
  }
  const SHA = bake(256, 256, ctx => paintShadow(ctx, 256));

  const group = new THREE.Group();
  const clouds: {
    cu: THREE.Sprite; ve: THREE.Sprite; sh: THREE.Mesh;
    x: number; z: number; y: number; sc: number; a: number; rank: number;
  }[] = [];
  for (let i = 0; i < CLOUD.COUNT; i++) {
    const cu = new THREE.Sprite(new THREE.SpriteMaterial({
      map: CUM[(rnd() * CUM.length) | 0], transparent: true, depthWrite: false, opacity: 0 }));
    const ve = new THREE.Sprite(new THREE.SpriteMaterial({
      map: VEI[(rnd() * VEI.length) | 0], transparent: true, depthWrite: false, opacity: 0 }));
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: SHA, transparent: true, depthWrite: false, opacity: 0 }));
    sh.rotation.x = -Math.PI / 2;
    group.add(cu, ve, sh);
    clouds.push({
      cu, ve, sh,
      x: -FIELD + rnd() * FIELD * 2, z: -FIELD + rnd() * FIELD * 2,
      y: CLOUD.DECK_M + (rnd() - 0.5) * 110,
      sc: (300 + rnd() * 380) * CLOUD.SIZE,
      a: 0.55 + rnd() * 0.45, rank: rnd(),
    });
  }

  return {
    group,
    sunFactor: (cover) => 1 - cover * 0.62,
    update(seconds, cover, windMs, fromDeg) {
      const fuse = cloudFuse(cover);
      /* met.no reports the direction wind comes FROM; cloud travels the opposite way. */
      const bear = (fromDeg + 180) * Math.PI / 180;
      const vx = Math.sin(bear), vz = Math.cos(bear);
      for (const c of clouds) {
        const wx = (((c.x + vx * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        const wz = (((c.z + vz * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        /* Which clouds exist at all is set by cover — at 10 % the sky is nearly
           empty, not 26 faint ghosts. */
        const on = cover > 0.02 && c.rank < Math.min(1, 0.18 + cover * 0.95);
        const base = on ? Math.min(1, cover * 1.5) * c.a : 0;
        c.cu.position.set(wx, c.y, wz);
        c.cu.scale.set(c.sc, c.sc * CUMULUS_ASPECT, 1);
        c.cu.material.opacity = base * (1 - fuse) * 0.96;
        c.ve.position.set(wx, c.y - c.sc * 0.03, wz);
        const vw = c.sc * 1.7 * (0.9 + fuse * 0.4);
        c.ve.scale.set(vw, vw * VEIL_ASPECT, 1);
        c.ve.material.opacity = base * fuse * 0.9;
        const sr = c.sc * (1.1 + fuse * 0.8);
        /* Offset along the light, and seated on the drawn ground so it follows relief. */
        c.sh.position.set(wx - 130, groundAt(wx - 130, wz + 95) + 1.2, wz + 95);
        c.sh.scale.set(sr, sr, 1);
        (c.sh.material as THREE.MeshBasicMaterial).opacity = base * (0.55 - fuse * 0.22);
      }
    },
    dispose() {
      for (const c of clouds) {
        c.cu.material.dispose(); c.ve.material.dispose();
        (c.sh.material as THREE.MeshBasicMaterial).dispose(); c.sh.geometry.dispose();
      }
      [...CUM, ...VEI, SHA].forEach(t => t.dispose());
    },
  };
}
