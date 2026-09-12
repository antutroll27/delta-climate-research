import type maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCloudLayer, type CloudLayer } from '../cloud-layer.ts';
import * as M from '../heat-map-model.ts';
import { createRoadLayer, type RoadLayer } from '../road-layer.ts';
import { terrainDrawAt } from '../terrain.ts';
import { requireGrid } from '../types.ts';
import { createVegetationLayer, type VegetationLayer } from '../vegetation-layer.ts';
import { createWaterLayer, type WaterLayer } from '../water-layer.ts';
import { hasBuildingModel, loadBuildingModel, type LandmarkNode } from './building-model.ts';
import { buildRegistry, pickBuilding, projectWard, type BuildingMeta } from './building-pick.ts';
import type {
  ReliefFieldUpdate,
  ReliefRenderer,
  ReliefRendererOptions,
  ReliefSelection,
  ReliefVisualState,
  ReliefWardBundle,
} from './relief-contract.ts';

const RING_RADII = [80, 400] as const;

export class ThreeReliefRenderer implements ReliefRenderer {
  readonly layer: maplibregl.CustomLayerInterface;
  private scene: THREE.Scene | null = null;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  /** the EXTRUDED city — Kolkata's only path, and the fallback everywhere */
  private city: THREE.Mesh | null = null;
  /** the authored glTF city, for wards that ship one. Never both at once. */
  private model: THREE.Group | null = null;
  /** compiled lazily: a ward with no model never builds this shader variant */
  private modelFacade: THREE.MeshStandardMaterial | null = null;
  /** landmark nodes of the ward currently drawn; empty on the extrusion path */
  landmarks: readonly LandmarkNode[] = [];
  /** bumped on every ward rebuild, so a model that finishes loading after a ward
      switch or a teardown is dropped instead of added to the wrong city */
  private wardToken = 0;
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
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private modelTransform: { x: number; y: number; z: number; frame: ReliefWardBundle['frame'] } | null = null;
  private pickMatrix = new THREE.Matrix4();
  private northFlip = new THREE.Matrix4().makeScale(1, 1, -1);
  private heatData: Float32Array;
  private blur: Float32Array;
  private heatTexture: THREE.DataTexture;
  /** Cells per side of the CURRENTLY ALLOCATED field buffers — not
      `options.simulationGridSize`, which is only ever the grid of whichever ward
      happened to be open when this chunk resolved. */
  private fieldN: number;
  /** One shared holder for the heat texture, in the same style as every other
      uniform in this class. A DataTexture's dimensions are fixed at
      construction, so a ward of a different size REPLACES it; both the overlay
      shader and the facade's injected `tField` read through this object, so
      re-pointing it once re-points every material that draws the field. */
  private heatUniform: { value: THREE.DataTexture };
  private grow = { value: 1 };
  private studio = { value: 0 };
  private size = { value: 1400 };
  private tint = { value: 1 };
  private heatMin = { value: M.RAMP_MIN };
  private heatMax = { value: M.RAMP_MAX };
  private selected = { value: new THREE.Vector2(1e9, 1e9) };
  private selRadius = { value: 0 };
  private cooling = { value: 0 };
  private visual: ReliefVisualState = {
    mode: 'relief', environment: 'dark', tintMode: 1, grow: 1,
    overlayOpacity: 0.5, live: null, phase: 'peak',
  };

  constructor(private options: ReliefRendererOptions) {
    const n = options.simulationGridSize;
    this.fieldN = n;
    this.heatData = new Float32Array(n * n * 4);
    this.blur = new Float32Array(n * n);
    this.heatTexture = new THREE.DataTexture(this.heatData, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.heatTexture.minFilter = this.heatTexture.magFilter = THREE.LinearFilter;
    this.heatTexture.needsUpdate = true;
    this.heatUniform = { value: this.heatTexture };
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
    /* THE FIELD BUFFERS FOLLOW THE WARD, not the chunk-load order. They were
       sized once in the constructor, from whichever ward was open when the Three
       chunk resolved, so opening a 2800 m Bengaluru ward after a 1400 m Kolkata
       one poured a 384² field into 192² buffers. `requireGrid` refuses a ward
       size with no admitted pair rather than guessing one. Deliberately BEFORE
       the early return below: the buffers are not scene-dependent. */
    this.resizeField(requireGrid(bundle.wardData.sizeM).n);
    if (!this.scene) return;
    this.rebuildWard(bundle);
    this.options.map.triggerRepaint();
  }

  updateField(update: ReliefFieldUpdate): void {
    const n = this.fieldN;
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

  /** Re-allocate the field buffers for a ward of `n` cells per side. */
  private resizeField(n: number): void {
    if (n === this.fieldN) return;
    this.fieldN = n;
    this.heatData = new Float32Array(n * n * 4);
    this.blur = new Float32Array(n * n);
    /* A DataTexture's width and height are fixed at construction — there is no
       resize — so the old one is disposed and replaced. Every material reads it
       through `heatUniform`, so this single assignment re-points all of them;
       missing one would leave that material sampling a freed texture. */
    this.heatTexture.dispose();
    this.heatTexture = new THREE.DataTexture(this.heatData, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.heatTexture.minFilter = this.heatTexture.magFilter = THREE.LinearFilter;
    this.heatTexture.needsUpdate = true;
    this.heatUniform.value = this.heatTexture;
  }

  setVisualState(state: ReliefVisualState): void {
    const environmentChanged = state.environment !== this.visual.environment;
    this.visual = state;
    this.grow.value = state.grow;
    this.tint.value = state.tintMode;
    if (this.overlay) (this.overlay.material as THREE.ShaderMaterial).uniforms.uOp.value = state.overlayOpacity;
    if (environmentChanged || this.studio.value !== (state.environment === 'studio' ? 1 : 0)) this.applyEnvironment(state.environment);
  }

  setVegetationVisible(v: boolean): void { this.veg?.setVisible(v); this.options.map.triggerRepaint(); }

  setSelection(selection: ReliefSelection): void {
    const building = selection.building;
    this.selected.value.set(building?.cx ?? 1e9, building?.cz ?? 1e9);
    /* The merged glTF carries no per-building id, so the model facade highlights
       a disc of the picked building's own footprint area. The extrusion path
       matches its `aCtr` attribute exactly and ignores this. */
    this.selRadius.value = building ? Math.sqrt(building.areaM2 / Math.PI) : 0;
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
    this.clearBuildings();
    this.modelFacade?.dispose();
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
    this.renderer?.dispose();
    this.scene?.clear();
    this.scene = null;
  }

  private onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.disposed || this.scene) return;
    this.scene = new THREE.Scene();
    this.scene.scale.set(1, 1, -1);
    this.hemi = new THREE.HemisphereLight(0xbfe2e8, 0x0a1518, 1.05); this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 2.1); this.key.position.set(0.4, 1, 0.35); this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x6fcad6, 0.5); this.rim.position.set(-0.5, 0.4, -0.5); this.scene.add(this.rim);
    this.camera = new THREE.Camera();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, this.options.terrainGridSize - 1, this.options.terrainGridSize - 1),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { tT: this.heatUniform, uMin: this.heatMin, uMax: this.heatMax, uOp: { value: 0.5 }, uCool: this.cooling },
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
      this.key.intensity = this.keyBase * this.clouds.sunFactor(this.visual.live.cloud / 100);
    }
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.grow.value < 1 || this.fieldDirty) { this.fieldDirty = false; this.options.map.triggerRepaint(); }
  }

  private rebuildWard(bundle: ReliefWardBundle): void {
    if (!this.scene || !this.overlay) return;
    /* THE BUILDINGS ARE DRAWN ONE OF TWO WAYS, AND THE RINGS SHIP EITHER WAY.
       The solver rasterises `wardData.b` into `built` and building-pick.ts
       projects those same rings to hit-test a click, so the mesh was never the
       source of identity — which is exactly what makes this fallback free. A
       ward with no authored model, or one whose model fails to load, ends up
       rendering precisely what Kolkata renders today. */
    const token = ++this.wardToken;
    this.clearBuildings();
    if (hasBuildingModel(bundle.wardId)) void this.installModel(bundle, token);
    else this.installExtrusion(bundle);
    this.overlay.scale.set(bundle.wardData.sizeM, bundle.wardData.sizeM, 1);
    this.displaceGround(bundle.terrain, bundle.wardData.sizeM);
    if (this.water) { this.scene.remove(this.water.mesh); this.water.dispose(); this.water = null; }
    const water = createWaterLayer(bundle.water, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (water) { this.water = water; this.scene.add(water.mesh); }
    if (!this.clouds) {
      this.clouds = createCloudLayer((x, y) => terrainDrawAt(bundle.terrain, x, y));
      this.scene.add(this.clouds.group);
    }
    if (this.roads) { this.scene.remove(this.roads.mesh); this.roads.dispose(); this.roads = null; }
    const roads = createRoadLayer(bundle.roads, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (roads) { this.roads = roads; this.scene.add(roads.mesh); }
    if (this.veg) { this.scene.remove(this.veg.group); this.veg.dispose(); this.veg = null; }
    const veg = createVegetationLayer(bundle.veg, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
    if (veg) { this.veg = veg; this.scene.add(veg.group); }
  }

  /** Drop whatever city is on screen, by either path. */
  private clearBuildings(): void {
    if (this.city) { this.scene?.remove(this.city); this.city.geometry.dispose(); this.city = null; }
    if (this.model) {
      this.scene?.remove(this.model);
      this.model.traverse((object) => { (object as THREE.Mesh).geometry?.dispose?.(); });
      this.model = null;
    }
    this.landmarks = [];
  }

  /**
   * Draw the ward's authored glTF, falling back to extrusion if it does not load.
   *
   * THE FALLBACK IS INSIDE THE AWAIT DELIBERATELY. A ward that is supposed to
   * have a model but cannot fetch one — offline, a bad deploy, a decoder that
   * will not start — must still end with a city on screen, not an empty map.
   */
  private async installModel(bundle: ReliefWardBundle, token: number): Promise<void> {
    const model = await loadBuildingModel(bundle.wardId);
    /* A ward switch or a teardown during the fetch must not add a city nobody is
       looking at any more, nor repopulate a disposed scene. */
    if (this.disposed || token !== this.wardToken || !this.scene) {
      model?.buildings.traverse((object) => { (object as THREE.Mesh).geometry?.dispose?.(); });
      return;
    }
    if (!model) { this.installExtrusion(bundle); return; }
    const facade = (this.modelFacade ??= this.makeFacade('model'));
    model.buildings.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      /* The GLB declares no materials, so GLTFLoader handed each mesh a default
         MeshStandardMaterial. Dispose them rather than leak one per ward switch. */
      (object.material as THREE.Material | undefined)?.dispose?.();
      object.material = facade;
    });
    this.model = model.buildings;
    this.landmarks = model.landmarks;
    this.scene.add(model.buildings);
    this.options.map.triggerRepaint();
  }

  /** The extrusion path, unchanged — the only city Kolkata has ever drawn. */
  private installExtrusion(bundle: ReliefWardBundle): void {
    const merged = this.extrudeBuildings(bundle);
    if (!merged || !this.scene) return;
    this.city = new THREE.Mesh(merged, this.facade);
    this.scene.add(this.city);
  }

  /** One merged BufferGeometry from the ward's footprint rings, with the three
   *  per-building attributes the facade shader reads. */
  private extrudeBuildings(bundle: ReliefWardBundle): THREE.BufferGeometry | null {
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
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    return merged;
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

  private applyEnvironment(environment: ReliefVisualState['environment']): void {
    const studio = environment === 'studio'; this.studio.value = studio ? 1 : 0;
    if (!this.scene) return;
    if (studio) {
      this.hemi.color.set(0xffffff); this.hemi.groundColor.set(0xd8d2c8); this.hemi.intensity = 1.45;
      this.keyBase = 1.7; this.key.intensity = this.keyBase; this.rim.intensity = 0.12;
    } else {
      this.hemi.color.set(0xbfe2e8); this.hemi.groundColor.set(0x0a1518); this.hemi.intensity = 1.05;
      this.keyBase = 2.1; this.key.intensity = this.keyBase; this.rim.intensity = 0.5;
    }
  }

  private makeFacade(kind: 'extruded' | 'model' = 'extruded'): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.05 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrow = this.grow; shader.uniforms.uStudio = this.studio; shader.uniforms.uSize = this.size; shader.uniforms.uTintMode = this.tint;
      shader.uniforms.tField = this.heatUniform; shader.uniforms.uHeatMin = this.heatMin; shader.uniforms.uHeatMax = this.heatMax; shader.uniforms.uSelCtr = this.selected;
      /* THE MODEL CARRIES POSITION AND NORMAL AND NOTHING ELSE. The extrusion
         path feeds this shader three per-building attributes; a merged glTF has
         no per-building anything, so the model variant derives what it can from
         the vertex itself — grow delay from the radius, heat from the vertex's
         own cell (finer than per-building, not coarser), selection from a disc
         of the picked footprint's area — and drops `vTop`, whose roof-line
         highlight genuinely needs a building height this geometry lacks.
         `position.xz` is already ward metres because building-model.ts BAKES the
         glTF→ward axis flip into the geometry rather than into a node scale. */
      if (kind === 'model') shader.uniforms.uSelR = this.selRadius;
      const declare = kind === 'model'
        ? 'varying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\nuniform float uGrow; uniform float uSize; uniform sampler2D tField; uniform vec2 uSelCtr; uniform float uSelR;\nfloat mdh(vec2 p){float h=sin(p.x*127.1+p.y*311.7)*43758.5453;return h-floor(h);}\n'
        : 'attribute float aDelay; attribute float aH; attribute vec2 aCtr;\nvarying vec3 vFp; varying vec3 vFn; varying float vTop; varying float vT; varying float vSel;\nuniform float uGrow; uniform float uSize; uniform sampler2D tField; uniform vec2 uSelCtr;\n';
      const place = kind === 'model'
        ? `#include <begin_vertex>
          float aDelay=min(1.,length(position.xz)/max(uSize*.5,1.))*.72+mdh(floor(position.xz))*.28;
          float gT=clamp((uGrow-aDelay*.55)/.45,0.,1.); float gE=1.+2.70158*pow(gT-1.,3.)+1.70158*pow(gT-1.,2.);
          transformed.y*=gE;vFp=transformed;vFn=normal;vTop=0.;
          vT=texture2D(tField,clamp(position.xz/uSize+.5,0.,1.)).g;
          vSel=uSelR>0.?1.-step(uSelR,distance(position.xz,uSelCtr)):0.;`
        : `#include <begin_vertex>
          float gT=clamp((uGrow-aDelay*.55)/.45,0.,1.); float gE=1.+2.70158*pow(gT-1.,3.)+1.70158*pow(gT-1.,2.);
          transformed.y*=gE;vFp=transformed;vFn=normal;vTop=position.y/max(aH,.001);
          vT=texture2D(tField,clamp(aCtr/uSize+.5,0.,1.)).g;vSel=1.-step(.5,distance(aCtr,uSelCtr));`;
      shader.vertexShader = declare + shader.vertexShader.replace('#include <begin_vertex>', place);
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
