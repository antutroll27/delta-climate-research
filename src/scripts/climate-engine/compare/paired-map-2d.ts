import { RAMP_MAX, RAMP_MIN, type RoadsData, type WardData } from '../heat-map-model.ts';

const STOPS: Array<[number, [number, number, number]]> = [
  [0, [111, 202, 214]],
  [0.35, [159, 185, 138]],
  [0.6, [176, 141, 87]],
  [0.8, [212, 107, 74]],
  [1, [229, 72, 77]],
];

interface MapView {
  /** A zero bearing keeps north at the top of the field. */
  bearing: number;
  /** Vertical compression of the heat terrain. */
  pitch: number;
  zoom: number;
}

interface Scene {
  field: Float32Array;
  ward: WardData;
  roads: RoadsData;
  view: MapView;
  frame: number | null;
  dispose?: () => void;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface Point2 {
  x: number;
  y: number;
}

const scenes = new WeakMap<HTMLCanvasElement, Scene>();
const DEFAULT_VIEW: MapView = { bearing: 0, pitch: 0.62, zoom: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ramp(value: number): [number, number, number] {
  const t = clamp((value - RAMP_MIN) / (RAMP_MAX - RAMP_MIN), 0, 1);
  for (let index = 1; index < STOPS.length; index += 1) {
    const [upperT, upper] = STOPS[index];
    const [lowerT, lower] = STOPS[index - 1];
    if (t <= upperT) {
      const fraction = (t - lowerT) / (upperT - lowerT);
      return [
        Math.round(lower[0] + (upper[0] - lower[0]) * fraction),
        Math.round(lower[1] + (upper[1] - lower[1]) * fraction),
        Math.round(lower[2] + (upper[2] - lower[2]) * fraction),
      ];
    }
  }
  return STOPS.at(-1)![1];
}

function shade(color: [number, number, number], amount: number): string {
  const [red, green, blue] = color.map((channel) => Math.round(clamp(channel * amount, 0, 255))) as [number, number, number];
  return `rgb(${red} ${green} ${blue})`;
}

function fieldAt(field: Float32Array, ward: WardData, x: number, y: number): number {
  const n = Math.round(Math.sqrt(field.length));
  const half = ward.sizeM / 2;
  const gx = clamp(Math.round((x + half) / ward.sizeM * (n - 1)), 0, n - 1);
  const gy = clamp(Math.round((y + half) / ward.sizeM * (n - 1)), 0, n - 1);
  return field[gy * n + gx];
}

function thermalHeight(value: number): number {
  return 8 + clamp((value - RAMP_MIN) / (RAMP_MAX - RAMP_MIN), 0, 1) * 82;
}

function drawPolygon(context: CanvasRenderingContext2D, points: Point2[], fill: string, stroke?: string): void {
  if (points.length < 3) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.stroke();
  }
}

function paintScene(canvas: HTMLCanvasElement, scene: Scene): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;

  const { field, ward, roads, view } = scene;
  const n = Math.round(Math.sqrt(field.length));
  const half = ward.sizeM / 2;
  const cosine = Math.cos(view.bearing);
  const sine = Math.sin(view.bearing);
  const visibleSpan = Math.max(1, Math.abs(cosine) + Math.abs(sine));
  const baseScale = Math.min(width / (ward.sizeM * visibleSpan * 1.12), height / (ward.sizeM * visibleSpan * view.pitch + 160));
  const scale = baseScale * view.zoom;
  const centerX = width / 2;
  const centerY = height * 0.6;
  const project = (point: Point3): Point2 => {
    const rx = point.x * cosine - point.y * sine;
    const ry = point.x * sine + point.y * cosine;
    return { x: centerX + rx * scale, y: centerY - ry * scale * view.pitch - point.z * scale * 0.72 };
  };
  const depth = (x: number, y: number) => x * sine + y * cosine;

  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgb(7 24 27)';
  context.fillRect(0, 0, width, height);

  // A sampled, height-coded surface keeps the terrain readable at 60 fps on
  // ordinary laptops. The source model remains the canonical 192² field.
  const step = n >= 160 ? 4 : 2;
  const tiles: Array<{ points: Point3[]; temperature: number; order: number }> = [];
  for (let gy = 0; gy < n; gy += step) {
    for (let gx = 0; gx < n; gx += step) {
      const gx1 = Math.min(n - 1, gx + step);
      const gy1 = Math.min(n - 1, gy + step);
      const x0 = -half + gx / (n - 1) * ward.sizeM;
      const x1 = -half + gx1 / (n - 1) * ward.sizeM;
      const y0 = -half + gy / (n - 1) * ward.sizeM;
      const y1 = -half + gy1 / (n - 1) * ward.sizeM;
      const samples = [field[gy * n + gx], field[gy * n + gx1], field[gy1 * n + gx1], field[gy1 * n + gx]];
      const temperature = samples.reduce((total, value) => total + value, 0) / samples.length;
      tiles.push({
        points: [
          { x: x0, y: y0, z: thermalHeight(samples[0]) },
          { x: x1, y: y0, z: thermalHeight(samples[1]) },
          { x: x1, y: y1, z: thermalHeight(samples[2]) },
          { x: x0, y: y1, z: thermalHeight(samples[3]) },
        ],
        temperature,
        order: depth((x0 + x1) / 2, (y0 + y1) / 2),
      });
    }
  }
  tiles.sort((a, b) => b.order - a.order);
  context.lineJoin = 'round';
  for (const tile of tiles) {
    const color = ramp(tile.temperature);
    drawPolygon(context, tile.points.map(project), shade(color, 0.98));
  }

  // Road lines inherit their local terrain height so they remain anchored while
  // the user orbits the view.
  context.lineCap = 'round';
  for (const road of roads.ways) {
    if (road.p.length < 4) continue;
    context.beginPath();
    for (let index = 0; index < road.p.length; index += 2) {
      const x = road.p[index];
      const y = road.p[index + 1];
      const point = project({ x, y, z: thermalHeight(fieldAt(field, ward, x, y)) + 2.5 });
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.strokeStyle = road.w > 1 ? 'rgb(12 38 40 / 0.58)' : 'rgb(12 38 40 / 0.34)';
    context.lineWidth = Math.max(0.8 * dpr, road.w > 1 ? 1.45 * dpr : dpr);
    context.stroke();
  }

  // The real footprint data gains a controlled, illustrative vertical lift.
  // Sampling bounds work on dense wards while preserving their morphology.
  const stride = Math.max(1, Math.ceil(ward.b.length / 850));
  const buildings = ward.b
    .filter((_, index) => index % stride === 0)
    .map((building) => {
      const vertices: Array<[number, number]> = [];
      for (let index = 1; index < building.length; index += 2) vertices.push([building[index], building[index + 1]]);
      const centroid = vertices.reduce(([x, y], [vx, vy]) => [x + vx, y + vy], [0, 0] as [number, number]);
      const count = Math.max(1, vertices.length);
      return { building, vertices, x: centroid[0] / count, y: centroid[1] / count };
    })
    .filter(({ vertices }) => vertices.length >= 3)
    .sort((a, b) => depth(b.x, b.y) - depth(a.x, a.y));
  context.lineWidth = Math.max(0.55 * dpr, 0.8);
  for (const item of buildings) {
    const baseZ = thermalHeight(fieldAt(field, ward, item.x, item.y)) + 1;
    const lift = clamp(Number(item.building[0]) || 8, 5, 32) * 1.65;
    const base = item.vertices.map(([x, y]) => project({ x, y, z: baseZ }));
    const top = item.vertices.map(([x, y]) => project({ x, y, z: baseZ + lift }));
    for (let index = 0; index < base.length; index += 1) {
      const next = (index + 1) % base.length;
      const light = 0.36 + ((index % 3) * 0.08);
      drawPolygon(context, [base[index], base[next], top[next], top[index]], `rgb(14 44 46 / ${light})`);
    }
    drawPolygon(context, top, 'rgb(53 83 79 / 0.88)', 'rgb(193 218 204 / 0.20)');
  }

  // A north marker keeps the oblique display accountable to the fixed north-up
  // interpretation available through the reset control.
  const markerX = 18 * dpr;
  const markerY = 20 * dpr;
  context.save();
  context.translate(markerX, markerY);
  context.rotate(view.bearing);
  context.strokeStyle = 'rgb(229 240 241 / 0.85)';
  context.fillStyle = 'rgb(103 207 218 / 0.94)';
  context.lineWidth = 1.25 * dpr;
  context.beginPath();
  context.moveTo(0, -8 * dpr);
  context.lineTo(4.5 * dpr, 6 * dpr);
  context.lineTo(0, 3.5 * dpr);
  context.lineTo(-4.5 * dpr, 6 * dpr);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
  context.fillStyle = 'rgb(229 240 241 / 0.86)';
  context.font = `${Math.round(9 * dpr)}px ui-monospace, monospace`;
  context.fillText('N', markerX - 3 * dpr, markerY + 18 * dpr);
  canvas.dataset.mapView = `${view.bearing.toFixed(3)},${view.pitch.toFixed(3)},${view.zoom.toFixed(2)}`;
}

function schedulePaint(canvas: HTMLCanvasElement): void {
  const scene = scenes.get(canvas);
  if (!scene || scene.frame !== null) return;
  scene.frame = requestAnimationFrame(() => {
    scene.frame = null;
    paintScene(canvas, scene);
  });
}

export function renderPairedMap(
  canvas: HTMLCanvasElement,
  field: Float32Array,
  ward: WardData,
  roads: RoadsData,
): void {
  const existing = scenes.get(canvas);
  const scene: Scene = existing ?? { field, ward, roads, view: { ...DEFAULT_VIEW }, frame: null };
  scene.field = field;
  scene.ward = ward;
  scene.roads = roads;
  scenes.set(canvas, scene);
  paintScene(canvas, scene);
}

export function enablePairedMapInteraction(canvas: HTMLCanvasElement): () => void {
  const scene = scenes.get(canvas);
  if (!scene?.dispose) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.interacting = 'true';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const current = scenes.get(canvas);
      if (!current) return;
      current.view.bearing = clamp(current.view.bearing + (event.clientX - lastX) * 0.006, -0.78, 0.78);
      current.view.pitch = clamp(current.view.pitch + (event.clientY - lastY) * 0.003, 0.44, 0.8);
      lastX = event.clientX;
      lastY = event.clientY;
      schedulePaint(canvas);
    };
    const onPointerEnd = (event: PointerEvent) => {
      dragging = false;
      canvas.dataset.interacting = 'false';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      const current = scenes.get(canvas);
      if (!current) return;
      event.preventDefault();
      current.view.zoom = clamp(current.view.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.76, 3.2);
      schedulePaint(canvas);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const current = scenes.get(canvas);
    if (current) {
      current.dispose = () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerEnd);
        canvas.removeEventListener('pointercancel', onPointerEnd);
        canvas.removeEventListener('wheel', onWheel);
        if (current.frame !== null) cancelAnimationFrame(current.frame);
        scenes.delete(canvas);
      };
    }
  }
  return () => scenes.get(canvas)?.dispose?.();
}

export function resetPairedMapView(canvas: HTMLCanvasElement): void {
  const scene = scenes.get(canvas);
  if (!scene) return;
  scene.view = { ...DEFAULT_VIEW };
  schedulePaint(canvas);
}

export function thermalPatternSummary(field: Float32Array): string {
  let hot = 0;
  let cool = 0;
  for (const value of field) {
    if (value >= 40) hot += 1;
    if (value < 32) cool += 1;
  }
  const hotPct = hot / field.length * 100;
  const coolPct = cool / field.length * 100;
  if (hotPct > 35) return 'Heat is widespread across the modelled study window.';
  if (coolPct > 35) return 'Cooler surface conditions form a substantial share of the modelled study window.';
  return 'The modelled field contains mixed warm and hot surface conditions.';
}
