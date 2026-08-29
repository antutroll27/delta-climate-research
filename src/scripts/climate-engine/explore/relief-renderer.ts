/**
 * relief-renderer.ts — the 3-D city, drawn as a MapLibre custom layer.
 *
 * THE LIGHT IN HERE IS NOT PHYSICS. The key light now follows the real solar
 * bearing (see `applySun`, and `sun-lighting.ts` for the frame and the domes), and
 * the surface-temperature model still cannot see any of it: `sun` and `kRad` in
 * the solve are ward-wide SCALARS and there is no shade term. A better-lit city
 * moves no golden and changes no calibration. If a future reader wants the shadow
 * to mean something thermally, the answer is in the memory: it was tried over 87
 * ward-scenes and failed its pre-registered night placebo at p = 5.4e-07.
 *
 * The scene composites OVER the basemap and has no background of its own, which is
 * why `scene.background` is never set here and the visible sky is MapLibre's.
 */
import type maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCloudLayer, type CloudLayer } from '../cloud-layer.ts';
import * as M from '../heat-map-model.ts';
import { createRoadLayer, type RoadLayer } from '../road-layer.ts';
import { terrainDrawAt } from '../terrain.ts';
import { createVegetationLayer, type VegetationLayer } from '../vegetation-layer.ts';
import { createWaterLayer, type WaterLayer } from '../water-layer.ts';
import { buildRegistry, pickBuilding, projectWard, type BuildingMeta } from './building-pick.ts';
import {
  imageBasedLightingAllowed, skyEnvironment, sunLighting, sunPlacement,
  type SkyEnvironment, type SunPlacement,
} from './sun-lighting.ts';
import type {
  ReliefFieldUpdate,
  ReliefRenderer,
  ReliefRendererOptions,
  ReliefSelection,
  ReliefVisualState,
  ReliefWardBundle,
} from './relief-contract.ts';

const RING_RADII = [80, 400] as const;

/** How tall a "footprints, no heights" building is: a 30 m block becomes 0.45 m. */
const FLAT_BUILDING_SCALE = 0.015;

export class ThreeReliefRenderer implements ReliefRenderer {
  readonly layer: maplibregl.CustomLayerInterface;
  private scene: THREE.Scene | null = null;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  private city: THREE.Mesh | null = null;
  private overlay: THREE.Mesh | null = null;
  private facade: THREE.MeshStandardMaterial;
  private water: WaterLayer | null = null;
  private clouds: CloudLayer | null = null;
  private roads: RoadLayer | null = null;
  private veg: VegetationLayer | null = null;
  private rings: THREE.Group | null = null;
  private coolingLine: THREE.Line | null = null;
  private ward: ReliefWardBundle | null = null;
  private registry: BuildingMeta[] = [];
  private disposed = false;
  private fieldDirty = false;
  private keyBase = 2.1;
  private hemiBase = 1.05;
  /** keyBase × the sun's own extinction factor; the cloud deck multiplies it again. */
  private keyLevel = 2.1;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  /* ── image-based ambience, and the fields it takes to keep it off the critical
     path. `wantedSky` is set synchronously by applySun; the fetch and the RGBE
     parse happen off-frame; the GPU convolution happens INSIDE render(), where
     three already owns the shared MapLibre context. See ensureEnvironment.

     `convolved` holds at most two entries — one dome per phase — because the
     diurnal chip is one click and re-running a 1.1 MB RGBE parse plus a PMREM
     pass on every toggle is a hitch on a page that is already GPU-bound. */
  private wantedSky: SkyEnvironment | null = null;
  private appliedSkySlug: string | null = null;
  private pendingSky: { slug: string; texture: THREE.DataTexture } | null = null;
  private convolved = new Map<string, THREE.WebGLRenderTarget>();
  private skyFailed = new Set<string>();
  private skyLoading = false;
  private firstPaint = false;
  private modelTransform: { x: number; y: number; z: number; frame: ReliefWardBundle['frame'] } | null = null;
  private pickMatrix = new THREE.Matrix4();
  private northFlip = new THREE.Matrix4().makeScale(1, 1, -1);
  private heatData: Float32Array;
  private blur: Float32Array;
  private heatTexture: THREE.DataTexture;
  private grow = { value: 1 };
  private studio = { value: 0 };
  private size = { value: 1400 };
  private tint = { value: 1 };
  private heatMin = { value: M.RAMP_MIN };
  private heatMax = { value: M.RAMP_MAX };
  private selected = { value: new THREE.Vector2(1e9, 1e9) };
  private cooling = { value: 0 };
  private visual: ReliefVisualState = {
    mode: 'relief', environment: 'dark', tintMode: 1, grow: 1,
    overlayOpacity: 0.5, live: null, phase: 'peak',
    /* Replaced by heat-map-app's own computation on the setVisualState it makes
       immediately after construction. A real solstice-noon sun rather than a zero
       vector, so a renderer that somehow never got one is still lit from a place
       that exists rather than from nowhere. */
    sun: sunPlacement(13, 172),
  };
  /**
   * WHAT THE LAYER TREE HAS TURNED OFF, kept here rather than in the caller.
   *
   * `rebuildWard` discards the city mesh and the vegetation group and builds new
   * ones on every ward switch, and a new mesh is visible and full height. Held in
   * the caller, four switches would silently revert on the next switch — the
   * checkbox still ticked, the layer back on the map. `applyLayerState` is called
   * at the end of the rebuild, which is the one place that can be true.
   *
   * The defaults are the state the instrument boots in, which is what
   * `scope/layers.ts` declares as `defaultOn` for these four. They agree because
   * the tree renders the map's initial state; if they ever disagree the tree is
   * lying about the map on first paint, before anything has been clicked.
   */
  private layers = { trees: true, canopy: true, buildings: true, extruded: true };

  constructor(private options: ReliefRendererOptions) {
    const n = options.simulationGridSize;
    this.heatData = new Float32Array(n * n * 4);
    this.blur = new Float32Array(n * n);
    this.heatTexture = new THREE.DataTexture(this.heatData, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.heatTexture.minFilter = this.heatTexture.magFilter = THREE.LinearFilter;
    this.heatTexture.needsUpdate = true;
    this.facade = this.makeFacade();
    this.layer = {
      id: 'delta-city', type: 'custom', renderingMode: '3d',
      onAdd: (map, gl) => this.onAdd(map, gl),
      render: (_gl, matrix) => this.render(Array.from(matrix)),
    };
  }

  setWard(bundle: ReliefWardBundle): void {
    this.ward = bundle;
    this.registry = buildRegistry(bundle.wardData.b);
    this.modelTransform = { ...bundle.mercatorOrigin, frame: bundle.frame };
    this.size.value = bundle.wardData.sizeM;
    if (!this.scene) return;
    this.rebuildWard(bundle);
    this.options.map.triggerRepaint();
  }

  updateField(update: ReliefFieldUpdate): void {
    const n = this.options.simulationGridSize;
    if (update.field.length !== n * n) throw new RangeError('Relief field dimensions do not match the canonical grid.');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= n) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= n) continue;
          sum += update.field[yy * n + xx]; count++;
        }
      }
      this.blur[y * n + x] = sum / count;
    }
    for (let index = 0; index < this.blur.length; index++) {
      this.heatData[index * 4] = this.blur[index];
      this.heatData[index * 4 + 1] = update.field[index];
      this.heatData[index * 4 + 2] = update.coolingMask?.[index] ?? 0;
    }
    this.heatMin.value = update.ramp[0];
    this.heatMax.value = update.ramp[1];
    this.heatTexture.needsUpdate = true;
    this.fieldDirty = true;
    this.options.map.triggerRepaint();
  }

  setVisualState(state: ReliefVisualState): void {
    const environmentChanged = state.environment !== this.visual.environment;
    this.visual = state;
    this.grow.value = state.grow;
    this.tint.value = state.tintMode;
    if (this.overlay) (this.overlay.material as THREE.ShaderMaterial).uniforms.uOp.value = state.overlayOpacity;
    if (environmentChanged || this.studio.value !== (state.environment === 'studio' ? 1 : 0)) this.applyEnvironment(state.environment);
    else this.applySun(state.sun);
  }

  setVegetationVisible(v: boolean): void {
    this.layers.trees = v;
    this.veg?.setVisible(v);
    this.options.map.triggerRepaint();
  }

  setCanopyVisible(v: boolean): void {
    this.layers.canopy = v;
    this.veg?.setCanopyVisible(v);
    this.options.map.triggerRepaint();
  }

  setBuildingsVisible(v: boolean): void {
    this.layers.buildings = v;
    if (this.city) this.city.visible = v;
    this.options.map.triggerRepaint();
  }

  setBuildingsExtruded(v: boolean): void {
    this.layers.extruded = v;
    this.applyExtrusion();
    this.options.map.triggerRepaint();
  }

  /**
   * Flat is a SCALE, not a rebuild.
   *
   * The extrusion depth is baked into the merged geometry — one `ExtrudeGeometry`
   * per building, welded into a single mesh — so "draw these as footprints" cannot
   * be a cheaper geometry without rebuilding all of it on every toggle. Scaling the
   * mesh's y is the same operation the grow animation already performs in the
   * vertex shader (`transformed.y *= gE`), about the same origin, so a flattened
   * city sits exactly where a mid-grow city does.
   *
   * Not zero: a zero-height extrusion collapses the side walls onto the roof and
   * the merged normals go degenerate, which reads as z-fighting rather than as a
   * plan. A thin slab keeps the outline lit and legible.
   */
  private applyExtrusion(): void {
    if (this.city) this.city.scale.y = this.layers.extruded ? 1 : FLAT_BUILDING_SCALE;
  }

  setSelection(selection: ReliefSelection): void {
    const building = selection.building;
    this.selected.value.set(building?.cx ?? 1e9, building?.cz ?? 1e9);
    if (this.coolingLine && building && selection.nearestCooling) {
      const position = this.coolingLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, building.cx, 1.2, building.cz);
      position.setXYZ(1, selection.nearestCooling.x, 1.2, selection.nearestCooling.z);
      position.needsUpdate = true;
      this.coolingLine.computeLineDistances();
      this.coolingLine.visible = true;
    } else if (this.coolingLine) this.coolingLine.visible = false;
    if (this.rings) {
      this.rings.visible = !!building;
      if (building) for (const ring of this.rings.children) ring.position.set(building.cx, 0.75, building.cz);
    }
    this.cooling.value = building ? 1 : 0;
    this.options.map.triggerRepaint();
  }

  pick(x: number, y: number, width: number, height: number, radiusPx = 18): number {
    return pickBuilding(this.pickMatrix, this.registry, x, y, width, height, radiusPx);
  }

  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; w: number } {
    return projectWard(this.pickMatrix, x, y, z, width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.city?.geometry.dispose();
    this.overlay?.geometry.dispose();
    (this.overlay?.material as THREE.Material | undefined)?.dispose();
    this.water?.dispose(); this.clouds?.dispose(); this.roads?.dispose(); this.veg?.dispose();
    this.rings?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
    this.coolingLine?.geometry.dispose();
    (this.coolingLine?.material as THREE.Material | undefined)?.dispose?.();
    this.facade.dispose(); this.heatTexture.dispose();
    this.pendingSky?.texture.dispose(); this.pendingSky = null;
    for (const target of this.convolved.values()) target.dispose();
    this.convolved.clear();
    if (this.scene) this.scene.environment = null;
    this.renderer?.dispose();
    this.scene?.clear();
    this.scene = null;
  }

  private onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.disposed || this.scene) return;
    this.scene = new THREE.Scene();
    this.scene.scale.set(1, 1, -1);
    this.hemi = new THREE.HemisphereLight(0xbfe2e8, 0x0a1518, this.hemiBase); this.scene.add(this.hemi);
    /* No position and no intensity here on purpose. `applyEnvironment` at the end
       of this method sets both, through `applySun`, from the computed solar
       bearing — and the constant that used to sit here, `position.set(0.4, 1,
       0.35)`, was the bug: a 64°-high sun in the north-east that never moved,
       while the compass dial reported the real one in the south-west. */
    this.key = new THREE.DirectionalLight(0xffffff, this.keyBase); this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x6fcad6, 0.5); this.rim.position.set(-0.5, 0.4, -0.5); this.scene.add(this.rim);
    this.camera = new THREE.Camera();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, this.options.terrainGridSize - 1, this.options.terrainGridSize - 1),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { tT: { value: this.heatTexture }, uMin: this.heatMin, uMax: this.heatMax, uOp: { value: 0.5 }, uCool: this.cooling },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform sampler2D tT; uniform float uMin,uMax,uOp,uCool;
          vec3 ramp(float t){ vec3 cA=vec3(.204,.412,.529),cB=vec3(.318,.635,.729),c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);
            if(t<0.0) return t<-.20 ? mix(cB,cA,clamp((-t-.20)/.30,0.,1.)) : mix(c0,cB,-t/.20);
            return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.)); }
          void main(){ vec4 F=texture2D(tT, vec2(vUv.x, 1.0-vUv.y)); float t=clamp((F.r-uMin)/(uMax-uMin),-0.5,1.);
            float edge=smoothstep(0.0,0.16,min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)));
            float cool=F.b*uCool; vec3 col=mix(ramp(t),vec3(.353,.722,.541),cool*.62);
            gl_FragColor=vec4(col,(uOp+cool*.16)*edge); }`,
      }),
    );
    this.overlay.rotation.x = -Math.PI / 2; this.overlay.position.y = 0.6; this.overlay.renderOrder = -1;
    this.scene.add(this.overlay);
    this.buildRings(); this.buildCoolingLine(); this.applyEnvironment(this.visual.environment);
    if (this.ward) this.rebuildWard(this.ward);
  }

  private render(matrix: number[] | Float32Array): void {
    if (!this.scene || !this.modelTransform || this.disposed) return;
    const transform = this.modelTransform;
    const frame = transform.frame;
    const local = new THREE.Matrix4()
      .makeTranslation(transform.x, transform.y, transform.z)
      .scale(new THREE.Vector3(frame.east, -frame.north, frame.up))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix as number[]).multiply(local);
    this.pickMatrix.copy(this.camera.projectionMatrix).multiply(this.northFlip);
    if (this.water) {
      this.water.setView(this.options.map.getBearing(), this.options.map.getPitch());
      if (!this.options.reducedMotion) this.water.setTime(performance.now() / 1000);
    }
    if (this.veg && !this.options.reducedMotion) {
      const w = this.visual.live;
      this.veg.setTime(performance.now() / 1000, w ? w.wind : 0, w ? (w.windFrom ?? 0) : 0);
    }
    if (this.clouds) this.clouds.group.visible = this.visual.mode !== 'iso';
    if (this.clouds && this.visual.mode !== 'iso' && this.visual.live) {
      this.clouds.update(
        this.options.reducedMotion ? 0 : performance.now() / 1000,
        this.visual.live.cloud / 100, this.visual.live.wind, this.visual.live.windFrom ?? 0,
        this.visual.phase === 'night',
      );
      /* keyLevel already carries the sun's height; cloud attenuates what is left.
         It was `keyBase` here, which threw away the elevation term every frame the
         live ambient existed — i.e. every frame — and would have left the 22:00
         phase lit by a sun that had set. */
      this.key.intensity = this.keyLevel * this.clouds.sunFactor(this.visual.live.cloud / 100);
    }
    this.renderer.resetState();
    this.consumePendingSky();
    this.renderer.render(this.scene, this.camera);
    if (!this.firstPaint) { this.firstPaint = true; this.ensureEnvironment(); }
    if (this.grow.value < 1 || this.fieldDirty) { this.fieldDirty = false; this.options.map.triggerRepaint(); }
  }

  private rebuildWard(bundle: ReliefWardBundle): void {
    if (!this.scene || !this.overlay) return;
    const geometries: THREE.BufferGeometry[] = [];
    const half = bundle.wardData.sizeM / 2;
    for (const building of bundle.wardData.b) {
      const shape = new THREE.Shape(); shape.moveTo(building[1], -building[2]);
      for (let index = 3; index < building.length; index += 2) shape.lineTo(building[index], -building[index + 1]);
      let geometry: THREE.ExtrudeGeometry;
      try { geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.6, building[0] - 1.4), bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.55, bevelSegments: 1 }); }
      catch { try { geometry = new THREE.ExtrudeGeometry(shape, { depth: building[0], bevelEnabled: false }); } catch { continue; } }
      geometry.rotateX(-Math.PI / 2);
      const delay = Math.min(1, Math.hypot(building[1], building[2]) / half) * 0.72 + M.noise01(building[2], building[1]) * 0.28;
      let cx = 0, cz = 0; const points = (building.length - 1) / 2;
      for (let index = 1; index < building.length; index += 2) { cx += building[index]; cz += building[index + 1]; }
      cx /= points; cz /= points;
      const elevation = terrainDrawAt(bundle.terrain, cx, cz);
      if (elevation) geometry.translate(0, elevation, 0);
      const vertices = geometry.attributes.position.count;
      const delays = new Float32Array(vertices); delays.fill(delay);
      const heights = new Float32Array(vertices); heights.fill(building[0]);
      const centres = new Float32Array(vertices * 2);
      for (let vertex = 0; vertex < vertices; vertex++) { centres[vertex * 2] = cx; centres[vertex * 2 + 1] = cz; }
      geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
      geometry.setAttribute('aH', new THREE.BufferAttribute(heights, 1));
      geometry.setAttribute('aCtr', new THREE.BufferAttribute(centres, 2));
      geometries.push(geometry);
    }
    const merged = mergeGeometries(geometries, false); geometries.forEach((geometry) => geometry.dispose());
    if (this.city) { this.scene.remove(this.city); this.city.geometry.dispose(); }
    if (merged) { this.city = new THREE.Mesh(merged, this.facade); this.scene.add(this.city); }
    this.overlay.scale.set(bundle.wardData.sizeM, bundle.wardData.sizeM, 1);
    this.displaceGround(bundle.terrain, bundle.wardData.sizeM);
    if (this.water) { this.scene.remove(this.water.mesh); this.water.dispose(); this.water = null; }
    const water = createWaterLayer(bundle.water, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (water) { this.water = water; this.scene.add(water.mesh); }
    /* REBUILT LIKE EVERY OTHER LAYER HERE, and it used to be the one exception.
       `if (!this.clouds)` built the deck once, on the first ward, and never again —
       but the deck closes over `terrainDrawAt(bundle.terrain, …)` and calls it every
       frame to seat each shadow on the ground, so after any ward switch the shadows
       sat on the PREVIOUS ward's terrain. Between the shipped terrains that is a
       mean |Δ| of 10.7 m and a maximum of 35.3 m, against a drawn relief range of
       about 55 m: an error the same size as the thing it is drawn on, and silent.

       THE RE-BAKE IS THE PRICE AND IT IS THE RIGHT ONE. Seven canvas textures are
       painted per ward instead of per session, beside a rebuild that already
       re-extrudes several thousand buildings and waits on a network fetch. Nothing
       moves on screen: the seed is fixed, so the same sky is baked, and drift is a
       function of `performance.now()` rather than of an accumulator, so every cloud
       reappears exactly where the old one was. */
    if (this.clouds) { this.scene.remove(this.clouds.group); this.clouds.dispose(); this.clouds = null; }
    const clouds = createCloudLayer((x, y) => terrainDrawAt(bundle.terrain, x, y));
    this.clouds = clouds; this.scene.add(clouds.group);
    if (this.roads) { this.scene.remove(this.roads.mesh); this.roads.dispose(); this.roads = null; }
    const roads = createRoadLayer(bundle.roads, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (roads) { this.roads = roads; this.scene.add(roads.mesh); }
    if (this.veg) { this.scene.remove(this.veg.group); this.veg.dispose(); this.veg = null; }
    const veg = createVegetationLayer(bundle.veg, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (veg) { this.veg = veg; this.scene.add(veg.group); }
    /* LAST, AND IT HAS TO BE LAST. Everything above is newly constructed and
       therefore visible and full height; this is where the four switches the layer
       tree owns are put back on. */
    this.applyLayerState();
  }

  /** Re-apply the layer switches to whatever `rebuildWard` has just constructed. */
  private applyLayerState(): void {
    if (this.city) this.city.visible = this.layers.buildings;
    this.applyExtrusion();
    this.veg?.setVisible(this.layers.trees);
    this.veg?.setCanopyVisible(this.layers.canopy);
  }

  private displaceGround(field: ReliefWardBundle['terrain'], sizeM: number): void {
    if (!this.overlay) return;
    const position = this.overlay.geometry.attributes.position as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index++) {
      position.setZ(index, terrainDrawAt(field, position.getX(index) * sizeM, -position.getY(index) * sizeM));
    }
    position.needsUpdate = true; this.overlay.geometry.computeVertexNormals();
  }

  private buildCoolingLine(): void {
    if (!this.scene || this.coolingLine) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.coolingLine = new THREE.Line(geometry, new THREE.LineDashedMaterial({
      color: 0x59b489, transparent: true, opacity: 0.85, dashSize: 7, gapSize: 6, depthWrite: false,
    }));
    this.coolingLine.visible = false; this.coolingLine.renderOrder = -1; this.scene.add(this.coolingLine);
  }

  private buildRings(): void {
    if (!this.scene || this.rings) return;
    this.rings = new THREE.Group(); this.rings.visible = false;
    for (const radius of RING_RADII) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uCol: { value: new THREE.Color(0x6fcad6) }, uOp: { value: 0.85 }, uDash: { value: 0 } },
        vertexShader: `varying vec3 vW; varying float vA; void main(){vW=(modelMatrix*vec4(position,1.)).xyz;vA=atan(position.y,position.x);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec3 vW; varying float vA; uniform vec3 uCol; uniform float uOp,uDash; void main(){float edge=1.-smoothstep(600.,700.,max(abs(vW.x),abs(vW.z)));float dash=uDash>.5?step(.42,fract(vA*7.)):1.;float a=uOp*edge*dash;if(a<.01)discard;gl_FragColor=vec4(uCol,a);}`,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 2.4, radius + 2.4, 128), material);
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = -1; this.rings.add(ring);
    }
    this.scene.add(this.rings);
  }

  /**
   * The two basemaps' light. Colours and BASE levels only — the sun scales them.
   *
   * Split from `applySun` deliberately: this answers "which map am I on", that
   * answers "what time is it", and folding them together is how a phase change
   * would quietly reset the Clay palette (or an environment switch would relight
   * a night scene as noon).
   */
  private applyEnvironment(environment: ReliefVisualState['environment']): void {
    const studio = environment === 'studio'; this.studio.value = studio ? 1 : 0;
    if (!this.scene) return;
    if (studio) {
      this.hemi.color.set(0xffffff); this.hemi.groundColor.set(0xd8d2c8);
      this.hemiBase = 1.45; this.keyBase = 1.7; this.rim.intensity = 0.12;
    } else {
      this.hemi.color.set(0xbfe2e8); this.hemi.groundColor.set(0x0a1518);
      this.hemiBase = 1.05; this.keyBase = 2.1; this.rim.intensity = 0.5;
    }
    this.applySun(this.visual.sun);
  }

  /**
   * POINT THE KEY LIGHT AT THE SUN THE CONSOLE IS ALREADY REPORTING.
   *
   * This is the whole point of the change. The key was created at a fixed
   * `position.set(0.4, 1, 0.35)` and never moved — a 64°-high sun in the NORTH-EAST
   * — while the compass dial two hundred pixels away read 231° / 71° up, the
   * SOUTH-WEST. The vector arrives already in this scene's axes (+x east, +y up,
   * +z north); `sun-lighting.ts` derives that frame from this file's own geometry
   * builder, and a unit test reads the bearing back out of it.
   *
   * A directional light's `position` is a DIRECTION here, not a place: the target
   * defaults to the origin, and only the direction from position to target is used.
   * So a unit vector is exactly right and its magnitude is free.
   *
   * NO SHADOWS ARE CAST, and that is not an oversight. `castShadow` stays off
   * because a shadow on this scene would be read as the model's shade term, and
   * there is none — per-building shadow was tested over 87 ward-scenes and failed
   * its pre-registered night placebo (p = 5.4e-07). The light says where the sun
   * is. It does not claim the simulation knows.
   */
  private applySun(sun: SunPlacement): void {
    if (!this.scene) return;
    const lighting = sunLighting(sun.elevationDeg);
    this.key.position.set(sun.x, sun.y, sun.z);
    this.keyLevel = this.keyBase * lighting.keyFactor;
    this.key.intensity = this.keyLevel;
    /* Below the horizon the key is zero and the hemisphere takes over, which is
       both what happens outdoors and what stops the 22:00 phase going black. */
    this.hemi.intensity = this.hemiBase * lighting.fillFactor;
    this.scene.environmentIntensity = lighting.environmentIntensity;
    this.wantedSky = skyEnvironment(sun.elevationDeg);
    this.ensureEnvironment();
  }

  /**
   * Fetch the ambience dome — late, optionally, and never on the critical path.
   *
   * THE GATES, each for its own reason:
   *  · `firstPaint` — 1.1 MB must not compete with the city's own first frame.
   *  · `imageBasedLightingAllowed` — tier `full` only. A coarse pointer, <= 4 GB or
   *    <= 6 cores lands at tier 1 and renders the same scene without it.
   *  · `convolved` — the phase chip is one click, so a dome already convolved is
   *    re-applied rather than re-fetched and re-filtered.
   *  · `skyFailed` — a miss is remembered, so a 404 costs one request and not one
   *    per frame. Ambience is optional by construction; the scene is already lit.
   *
   * The GPU half does NOT happen here. `PMREMGenerator` runs a render pass, and
   * this three.js renderer shares MapLibre's GL context — doing that outside the
   * custom layer's own render callback leaves MapLibre's state where it did not
   * put it. So this stops at a parsed `DataTexture` and `render()` converts it.
   */
  private ensureEnvironment(): void {
    if (!this.firstPaint || this.disposed || !this.scene) return;
    if (!imageBasedLightingAllowed(this.options.deviceTier())) return;
    const want = this.wantedSky;
    if (!want || want.slug === this.appliedSkySlug || this.skyFailed.has(want.slug)) return;
    /* Already parsed and waiting for the next frame to convolve it. Without this
       the `finally` below re-entered before `consumePendingSky` had run and
       fetched the same 1.1 MB a second time — measured, two requests per dome. */
    if (this.pendingSky?.slug === want.slug) return;
    const held = this.convolved.get(want.slug);
    if (held) { this.applyEnvironmentMap(want.slug, held); return; }
    if (this.skyLoading) return;
    this.skyLoading = true;
    void (async () => {
      try {
        /* HDRLoader, not RGBELoader: the latter is a deprecated alias of it as of
           three r180 and warns on construction. Same Radiance parser. */
        const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
        const texture = await new HDRLoader().loadAsync(want.url);
        if (this.disposed) { texture.dispose(); return; }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.pendingSky?.texture.dispose();
        this.pendingSky = { slug: want.slug, texture };
        this.options.map.triggerRepaint();
      } catch (error) {
        this.skyFailed.add(want.slug);
        console.warn('Optional sky ambience unavailable:', error);
      } finally {
        this.skyLoading = false;
        this.ensureEnvironment();
      }
    })();
  }

  /** The GPU half of the above, inside the frame where three owns the context. */
  private consumePendingSky(): void {
    const pending = this.pendingSky;
    if (!pending || !this.scene) return;
    this.pendingSky = null;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromEquirectangular(pending.texture);
    pmrem.dispose();
    pending.texture.dispose();
    this.convolved.get(pending.slug)?.dispose();
    this.convolved.set(pending.slug, target);
    /* Only if it is STILL the one wanted: a fast phase toggle can land a dome the
       reader has already switched away from, and applying it would put a night sky
       on a noon scene until the next chip click. */
    if (this.wantedSky?.slug === pending.slug) this.applyEnvironmentMap(pending.slug, target);
  }

  /**
   * `environment`, NEVER `background`. The scene composites over the basemap as a
   * MapLibre custom layer, so a background would paint the dome over the map tiles
   * and the sky above the horizon would stop being MapLibre's — see `maplibreSky`.
   */
  private applyEnvironmentMap(slug: string, target: THREE.WebGLRenderTarget): void {
    if (!this.scene) return;
    this.scene.environment = target.texture;
    this.appliedSkySlug = slug;
    this.options.map.triggerRepaint();
  }

  private makeFacade(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.05 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrow = this.grow; shader.uniforms.uStudio = this.studio; shader.uniforms.uSize = this.size; shader.uniforms.uTintMode = this.tint;
      shader.uniforms.tField = { value: this.heatTexture }; shader.uniforms.uHeatMin = this.heatMin; shader.uniforms.uHeatMax = this.heatMax; shader.uniforms.uSelCtr = this.selected;
      shader.vertexShader = 'attribute float aDelay; attribute float aH; attribute vec2 aCtr;\nvarying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\nuniform float uGrow; uniform float uSize; uniform sampler2D tField; uniform vec2 uSelCtr;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float gT=clamp((uGrow-aDelay*.55)/.45,0.,1.); float gE=1.+2.70158*pow(gT-1.,3.)+1.70158*pow(gT-1.,2.);
          transformed.y*=gE;vFp=transformed;vFn=normal;vTop=position.y/max(aH,.001);
          vT=texture2D(tField,clamp(aCtr/uSize+.5,0.,1.)).g;vSel=1.-step(.5,distance(aCtr,uSelCtr));`);
      shader.fragmentShader = 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\nuniform float uStudio,uSize,uHeatMin,uHeatMax,uTintMode; uniform sampler2D tField;\nfloat dh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nvec3 rampc(float t){vec3 c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.));}\n'
        + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec3 fn=normalize(vFn);bool wall=abs(fn.y)<.5;bool stu=uStudio>.5;vec2 fuv=clamp(vFp.xz/uSize+.5,0.,1.);
          float T=uTintMode<.5?texture2D(tField,fuv).r:vT;float t=clamp((T-uHeatMin)/(uHeatMax-uHeatMin),0.,1.);
          if(uTintMode>1.5)t=t<.35?.17:t<.6?.48:t<.8?.70:t<.9?.85:.97;float heatW=smoothstep(.10,.52,t);
          vec3 clay=stu?vec3(.925,.916,.902):vec3(.30,.325,.335);vec3 body=mix(clay,rampc(t),heatW*(stu?.92:1.));
          body*=mix(.95,1.05,dh(floor(vFp.xz*.05)));if(wall){float fy=fract(vFp.y/3.3);float floorLine=1.-smoothstep(.05,.11,min(fy,1.-fy));float colAxis=abs(fn.x)>abs(fn.z)?vFp.z:vFp.x;float fx=fract(colAxis/3.4);float mull=1.-smoothstep(.035,.075,min(fx,1.-fx));float stroke=max(floorLine,mull*.55);vec3 lineCol=stu?body*.70:body*1.7+vec3(.015);body=mix(body,lineCol,stroke*.8);body=mix(body,stu?clay*1.05:body*1.55,smoothstep(.945,.985,vTop));}else{body*=stu?.97:.90;float spk=uTintMode<.5?1.:.35;body*=mix(1.,mix(.93,1.05,dh(floor(vFp.xz*.7))),spk);}body*=mix(stu?.76:.58,1.,smoothstep(0.,14.,vFp.y));if(vSel>.5){body=mix(body,vec3(.027,.788,.992),.42);body+=vec3(.10,.16,.18)*smoothstep(.90,.99,vTop);}diffuseColor.rgb=body;`);
    };
    return material;
  }
}

export function createReliefRenderer(options: ReliefRendererOptions): ReliefRenderer {
  return new ThreeReliefRenderer(options);
}
