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
 * Sprites are baked ONCE PER WARD and never again after that: within a ward, drift
 * and opacity are transform writes only and no geometry is rebuilt.
 *
 * It used to be once per SESSION, on the argument that clouds are weather rather
 * than geography. True of the sprites; false of the layer, because `groundAt` is
 * geography — each shadow is seated on the drawn ground every frame — and a deck
 * that outlived its ward went on seating them on the terrain of the ward the reader
 * had left, by a mean of 10.7 m and a maximum of 35.3 m against a drawn relief range
 * of about 55 m. `relief-renderer.ts` now tears the deck down with the rest of the
 * ward's layers. The sky does not visibly change across a rebuild: the seed is
 * fixed, so the same sprites come back, and drift reads `performance.now()` rather
 * than an accumulator, so every cloud reappears where the old one was.
 */
import * as THREE from 'three';
import {
  CLOUD, cloudFuse, fitLobes, layoutCumulus, layoutVeil,
  paintCumulus, paintVeil, paintShadow, CUMULUS_ASPECT, VEIL_ASPECT,
} from './cloud-sprites';

export interface CloudLayer {
  readonly group: THREE.Group;
  /**
   * advance drift and cross-fade; seconds, cover 0..1, wind m/s, direction wind
   * comes FROM, and whether the scene is on its night phase.
   *
   * `night` is not cosmetic. Without it the deck draws sunlit white cumulus and
   * casts hard ground shadows at 22:00, which is a lie about where the light is
   * coming from — and this page already distinguishes the two phases everywhere
   * else it reports anything.
   */
  update(seconds: number, cover: number, windMs: number, fromDeg: number, night: boolean): void;
  /** key-light multiplier for this cover. Returns the SAME 0.6 coefficient the
   *  physics applies at heat-map-model.ts:371 and :394 (`sun: 1 * (1 - 0.6 * cloud)`),
   *  so what the eye infers about sunlight cannot drift from what the model computes.
   *  The caller multiplies its ENVIRONMENT's own key intensity by this — never a
   *  literal, or the studio environment's dimmer key is silently overwritten. */
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
    /* 0.6, matching heat-map-model.ts exactly. It was 0.62 and nobody would have
       seen the difference — but the docstring claims this tracks the physics, and a
       claim that is 97 % true is the kind that rots. */
    sunFactor: (cover) => 1 - cover * 0.6,
    update(seconds, cover, windMs, fromDeg, night) {
      const fuse = cloudFuse(cover);
      /* At night there is no sun to light a cloud top or cast its shadow. The deck
         stays visible — overcast nights are a real and thermally important thing,
         which is exactly why cloud raises T_sky — but it reads as dim mass, and the
         ground shadow goes to zero rather than drawing a sunlit shape at 22:00. */
      const lit = night ? 0.42 : 1;
      const shadowLit = night ? 0 : 1;
      /* met.no reports the direction wind comes FROM; cloud travels the opposite way. */
      const bear = (fromDeg + 180) * Math.PI / 180;
      const vx = Math.sin(bear), vz = Math.cos(bear);
      for (const c of clouds) {
        const wx = (((c.x + vx * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        const wz = (((c.z + vz * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        /* Which clouds exist at all is set by cover — at 10 % the sky is nearly
           empty, not 26 faint ghosts. */
        const on = cover > 0.02 && c.rank < Math.min(1, 0.18 + cover * 0.95);
        /* Clamped: without it OPACITY would push a fully-covered sky past opaque,
           which draws no brighter but flattens the cumulus->veil cross-fade into a
           plateau — the one transition the cover scalar is supposed to show. */
        const base = on ? Math.min(1, Math.min(1, cover * 1.5) * c.a * CLOUD.OPACITY) : 0;
        c.cu.position.set(wx, c.y, wz);
        c.cu.scale.set(c.sc, c.sc * CUMULUS_ASPECT, 1);
        /* A sprite at zero opacity still submits a draw call and still pays its
           fill. The cost here is fill rate on 52 large alpha-blended billboards,
           not geometry (the shadow planes measured at +0.03 ms), so skipping the
           invisible ones is the cheapest real saving available. */
        c.cu.material.opacity = base * (1 - fuse) * 0.96 * lit;
        c.cu.visible = c.cu.material.opacity > 0.004;
        c.ve.position.set(wx, c.y - c.sc * 0.03, wz);
        const vw = c.sc * 1.7 * (0.9 + fuse * 0.4);
        c.ve.scale.set(vw, vw * VEIL_ASPECT, 1);
        c.ve.material.opacity = base * fuse * 0.9 * lit;
        c.ve.visible = c.ve.material.opacity > 0.004;
        const sr = c.sc * (1.1 + fuse * 0.8);
        /* Offset along the light, and seated on the drawn ground so it follows relief. */
        c.sh.position.set(wx - 130, groundAt(wx - 130, wz + 95) + 1.2, wz + 95);
        c.sh.scale.set(sr, sr, 1);
        (c.sh.material as THREE.MeshBasicMaterial).opacity =
          base * (0.55 - fuse * 0.22) * shadowLit;
        c.sh.visible = (c.sh.material as THREE.MeshBasicMaterial).opacity > 0.004;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const c of clouds) {
        c.cu.material.dispose(); c.ve.material.dispose();
        (c.sh.material as THREE.MeshBasicMaterial).dispose(); c.sh.geometry.dispose();
      }
      [...CUM, ...VEI, SHA].forEach(t => t.dispose());
    },
  };
}
