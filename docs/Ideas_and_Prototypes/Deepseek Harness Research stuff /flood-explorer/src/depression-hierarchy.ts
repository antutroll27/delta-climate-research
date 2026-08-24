// Depression hierarchy + Fill-Spill-Merge water routing.
//
// Barnes, Callaghan & Wickert 2021, "Computing water flow through complex
// landscapes, Part 2: Finding hierarchies in depressions and morphological
// segmentations", Earth Surface Dynamics 9:105-131, doi:10.5194/esurf-9-105-2021.
//
// WHY A HIERARCHY AND NOT A SPILL GRAPH. Two basins that fill to a shared saddle
// stop being two basins: they become ONE water body at ONE level. A pairwise
// "spill into the neighbour" graph cannot express that -- it keeps two levels
// where physics has one, and it can contain cycles (A spills to B spills to A)
// that a tree cannot. The merge IS the algorithm; routing is the easy half.
//
// Units: elevations in metres, volumes in cubic metres. Callers pass cell area.

export const OCEAN = 0;

/** A depression tree over the DEM. Node 0 is OCEAN and swallows anything. */
export interface DepHier {
  nNodes: number;
  parent: Int32Array;
  lchild: Int32Array;
  rchild: Int32Array;
  /** Spill elevation, m. The level at which this node overflows into its parent. */
  outElev: Float64Array;
  /** Saddle cell where this node's two children met. -1 for leaves and OCEAN. */
  outCell: Int32Array;
  /** Per-DEM-cell node label. Cells reaching the open boundary carry OCEAN. */
  label: Int32Array;
  /** Cells labelled at exactly this node (not its descendants). */
  ownCells: Int32Array[];
  /** Subtree cell elevations, ascending, with prefix sums — the stage-volume curve. */
  sortedH: Float64Array[];
  prefixH: Float64Array[];
}

/**
 * Deterministic tie-break so flats do not fragment into spurious pits.
 *
 * Applied to ORDERING ONLY. Every volume below is integrated against the raw
 * elevations, so this never leaks into a depth the reader is shown.
 */
function jitterField(H: Float32Array, grid: number): Float64Array {
  const E = new Float64Array(H.length);
  for (let k = 0; k < H.length; k++) {
    let h = Math.imul(k & 1023, 374761393) ^ Math.imul(k >> 10, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    E[k] = H[k] + (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 1e-6;
  }
  return E;
}

/** Binary min-heap keyed by elevation. Same shape as the one sim.ts already uses. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  get size(): number { return this.n; }
  push(k: number, v: number): void {
    let i = this.n++;
    this.keys[i] = k; this.vals[i] = v;
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= this.keys[i]) break; this.swap(p, i); i = p; }
  }
  pop(): number {
    const top = this.vals[0];
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n]; this.vals[0] = this.vals[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.keys[l] < this.keys[m]) m = l;
        if (r < this.n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v;
  }
}

/**
 * Build the depression hierarchy.
 *
 * `oceanCells` are the open boundary (here the south edge). Everything that can
 * reach them without climbing is OCEAN and never ponds.
 *
 * The flood pops cells in ascending elevation. When a popped cell touches a cell
 * belonging to a DIFFERENT current root, the two water bodies have just met:
 * that is the saddle, and a meta-depression is created above both. Because cells
 * are popped low-to-high, the first meeting is necessarily the lowest connection
 * between them, which is what makes it the spill point.
 */
export function buildHierarchy(H: Float32Array, grid: number, oceanCells: Int32Array): DepHier {
  const N = H.length;
  const E = jitterField(H, grid);

  // A pit is a cell with no lower neighbour. E is all-distinct, so each closed
  // basin yields exactly one pit and flats cannot spawn a crowd of them.
  const isOcean = new Uint8Array(N);
  for (const c of oceanCells) isOcean[c] = 1;

  const label = new Int32Array(N).fill(-1);
  // Node arrays grow as merges happen; 2*leaves is the exact ceiling for a
  // binary tree, +1 for OCEAN.
  const cap = 2 * N + 2;
  const parent = new Int32Array(cap).fill(-1);
  const lchild = new Int32Array(cap).fill(-1);
  const rchild = new Int32Array(cap).fill(-1);
  const outElev = new Float64Array(cap).fill(Infinity);
  const outCell = new Int32Array(cap).fill(-1);
  let nNodes = 1; // node 0 = OCEAN
  outElev[OCEAN] = Infinity;

  const heap = new MinHeap(N + 8);
  for (const c of oceanCells) { label[c] = OCEAN; heap.push(E[c], c); }

  const nbrs = (c: number, out: Int32Array): number => {
    const i = c % grid, j = (c / grid) | 0;
    let n = 0;
    if (i > 0) out[n++] = c - 1;
    if (i < grid - 1) out[n++] = c + 1;
    if (j > 0) out[n++] = c - grid;
    if (j < grid - 1) out[n++] = c + grid;
    return n;
  };

  const scratch = new Int32Array(4);
  for (let c = 0; c < N; c++) {
    if (isOcean[c]) continue;
    const n = nbrs(c, scratch);
    let lowest = true;
    for (let q = 0; q < n; q++) if (E[scratch[q]] < E[c]) { lowest = false; break; }
    if (lowest) { label[c] = nNodes++; heap.push(E[c], c); }
  }

  // Union-find over nodes: which meta-depression currently owns a label.
  const uf = new Int32Array(cap);
  for (let k = 0; k < cap; k++) uf[k] = k;
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };

  while (heap.size > 0) {
    const c = heap.pop();
    const myRoot = find(label[c]);
    const n = nbrs(c, scratch);
    for (let q = 0; q < n; q++) {
      const m = scratch[q];
      if (label[m] === -1) { label[m] = label[c]; heap.push(E[m], m); continue; }
      const otherRoot = find(label[m]);
      if (otherRoot === find(label[c])) continue;
      // Two distinct water bodies just touched -> merge them under a new node.
      // OCEAN absorbs rather than merging: it has no rim to overflow.
      const a = find(label[c]), b = otherRoot;
      if (a === OCEAN || b === OCEAN) {
        const inland = a === OCEAN ? b : a;
        parent[inland] = OCEAN;
        outElev[inland] = Math.max(H[c], H[m]);
        outCell[inland] = c;
        uf[inland] = OCEAN;
        continue;
      }
      const meta = nNodes++;
      parent[a] = meta; parent[b] = meta;
      lchild[meta] = a; rchild[meta] = b;
      outElev[a] = outElev[a] === Infinity ? Math.max(H[c], H[m]) : outElev[a];
      outElev[b] = outElev[b] === Infinity ? Math.max(H[c], H[m]) : outElev[b];
      uf[a] = meta; uf[b] = meta;
    }
  }
  // Anything still unattached spills straight to sea at its own rim.
  for (let k = 1; k < nNodes; k++) if (parent[k] === -1) { parent[k] = OCEAN; uf[k] = OCEAN; }

  // Own cells per node, then subtree stage-volume curves (ascending + prefix sums).
  const counts = new Int32Array(nNodes);
  for (let c = 0; c < N; c++) if (label[c] >= 0) counts[label[c]]++;
  const ownCells: Int32Array[] = [];
  for (let k = 0; k < nNodes; k++) ownCells.push(new Int32Array(counts[k]));
  const fill = new Int32Array(nNodes);
  for (let c = 0; c < N; c++) { const L = label[c]; if (L >= 0) ownCells[L][fill[L]++] = c; }

  const kids: number[][] = Array.from({ length: nNodes }, () => []);
  for (let k = 1; k < nNodes; k++) if (parent[k] >= 0) kids[parent[k]].push(k);

  const sortedH: Float64Array[] = new Array(nNodes);
  const prefixH: Float64Array[] = new Array(nNodes);
  const order: number[] = [];
  const stack = [OCEAN];
  while (stack.length) { const k = stack.pop()!; order.push(k); for (const ch of kids[k]) stack.push(ch); }
  for (let idx = order.length - 1; idx >= 0; idx--) {  // post-order: children first
    const k = order[idx];
    let total = ownCells[k].length;
    for (const ch of kids[k]) total += sortedH[ch].length;
    const arr = new Float64Array(total);
    let w = 0;
    for (const c of ownCells[k]) arr[w++] = H[c];
    for (const ch of kids[k]) { const s = sortedH[ch]; for (let q = 0; q < s.length; q++) arr[w++] = s[q]; }
    arr.sort();
    const pre = new Float64Array(total + 1);
    for (let q = 0; q < total; q++) pre[q + 1] = pre[q] + arr[q];
    sortedH[k] = arr; prefixH[k] = pre;
  }

  return {
    nNodes,
    parent: parent.slice(0, nNodes),
    lchild: lchild.slice(0, nNodes),
    rchild: rchild.slice(0, nNodes),
    outElev: outElev.slice(0, nNodes),
    outCell: outCell.slice(0, nNodes),
    label, ownCells, sortedH, prefixH,
  };
}

/** Volume, m3, held below level `w` across a node's whole subtree. */
export function volumeBelow(hier: DepHier, node: number, w: number, cellArea: number): number {
  const hh = hier.sortedH[node], p = hier.prefixH[node];
  let lo = 0, hi = hh.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hh[mid] < w) lo = mid + 1; else hi = mid; }
  return (lo * w - p[lo]) * cellArea;
}

/**
 * Inverse of volumeBelow: the level, m, at which the node's subtree holds `v`.
 *
 * THE CELL COUNT IS `found`, NOT `found + 1`. `found` is the lowest index whose
 * elevation the water does not reach, so the submerged set is [0, found) and
 * hh[found] sits ABOVE the waterline. Including it inflates the level: on
 * hh = [0, 10] holding 5 m3 the answer is 5 m, and the off-by-one returns 7.5 m.
 * The original stage-volume solver carried this error, which is why it is
 * spelled out here rather than left to be re-derived.
 */
export function levelFor(hier: DepHier, node: number, v: number, cellArea: number): number {
  const hh = hier.sortedH[node], p = hier.prefixH[node];
  if (v <= 0 || hh.length === 0) return hh.length ? hh[0] : 0;
  let found = -1, lo = 0, hi = hh.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((mid * hh[mid] - p[mid]) * cellArea >= v) { found = mid; hi = mid - 1; } else lo = mid + 1;
  }
  // Above every cell the node owns. Legitimate: a node's rim is the SADDLE, which
  // belongs to the neighbouring node, so the water surface can stand higher than
  // anything in this node's own cell set. Returning Infinity here stranded the
  // volume and left the budget 1.15 m3 light.
  if (found === -1) return (v / cellArea + p[hh.length]) / hh.length;
  return (v / cellArea + p[found]) / found;
}

export interface RouteResult {
  /** Per-cell water depth, m. */
  depth: Float32Array;
  /** Volume that left the domain over the open boundary, m3. */
  toSea: number;
  /** Volume standing on the terrain, m3 — integrated from `depth`, not assumed. */
  ponded: number;
}

/**
 * Fill-Spill-Merge: route `directInflow` (m3 per node) through the hierarchy.
 *
 * Each node stores what its subtree's water can hold below its own rim; the
 * remainder has spilled past it. A node is an ACTIVE water body only when it
 * holds MORE than its children hold separately -- that is the test for whether
 * the merge has actually happened. Two basins that have not yet filled to their
 * shared saddle keep two levels; once either spills, the parent becomes active
 * and one level covers both. A cell is rendered at the level of the HIGHEST
 * active body above it, so nested bodies never double-count.
 *
 * Getting this wrong is not subtle but it is silent: an earlier revision here
 * let a perched basin keep its own level while an ancestor also pooled its
 * water, and the budget came out 674 m3 heavy at 30 mm. `assertSolverLogic`
 * caught it. Keep the budget assertion in front of any change to this function.
 */
export function routeWater(
  hier: DepHier, H: Float32Array, cellArea: number, directInflow: Float64Array,
): RouteResult {
  const { nNodes, parent } = hier;
  const kids: number[][] = Array.from({ length: nNodes }, () => []);
  for (let k = 1; k < nNodes; k++) if (parent[k] >= 0) kids[parent[k]].push(k);

  const order: number[] = [];
  const stack = [OCEAN];
  while (stack.length) { const k = stack.pop()!; order.push(k); for (const ch of kids[k]) stack.push(ch); }

  // Subtree inflow, then what each node can actually hold below its own rim.
  const subtree = new Float64Array(nNodes);
  for (let idx = order.length - 1; idx >= 0; idx--) {
    const k = order[idx];
    let s = directInflow[k];
    for (const ch of kids[k]) s += subtree[ch];
    subtree[k] = s;
  }

  const capacity = new Float64Array(nNodes);
  const stored = new Float64Array(nNodes);
  const active = new Uint8Array(nNodes);
  for (let idx = order.length - 1; idx >= 0; idx--) {
    const k = order[idx];
    if (k === OCEAN) { capacity[k] = Infinity; continue; }
    capacity[k] = volumeBelow(hier, k, hier.outElev[k], cellArea);
    stored[k] = Math.min(subtree[k], capacity[k]);
    let childStore = 0;
    for (const ch of kids[k]) childStore += stored[ch];
    // Strictly more than the children hold on their own => the bodies merged.
    active[k] = stored[k] > childStore + 1e-9 ? 1 : 0;
  }

  // Top-down: the first active node on the way down owns every cell beneath it.
  const depth = new Float32Array(H.length);
  const walk = (k: number, level: number): void => {
    let lvl = level;
    if (!Number.isFinite(lvl) && k !== OCEAN && active[k]) lvl = levelFor(hier, k, stored[k], cellArea);
    if (Number.isFinite(lvl)) {
      for (const c of hier.ownCells[k]) { const d = lvl - H[c]; if (d > 0) depth[c] = d; }
    }
    for (const ch of kids[k]) walk(ch, lvl);
  };
  walk(OCEAN, NaN);

  let ponded = 0;
  for (let c = 0; c < depth.length; c++) ponded += depth[c] * cellArea;

  // Whatever the outermost inland bodies could not hold, plus rain that landed
  // on ocean-draining terrain, has left the domain.
  let toSea = directInflow[OCEAN];
  for (const t of kids[OCEAN]) toSea += Math.max(0, subtree[t] - capacity[t]);

  return { depth, toSea, ponded };
}
