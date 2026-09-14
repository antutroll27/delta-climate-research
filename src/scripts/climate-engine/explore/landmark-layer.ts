/**
 * landmark-layer.ts — the named buildings, labelled on the map and clickable.
 *
 * WHY THIS IS THE SIGNATURE FEATURE AND NOT A LABEL WIDGET. Eleven thousand
 * buildings in a ward are drawn from a height the pipeline INFERRED. A handful
 * are drawn from a height somebody PUBLISHED — CTBUH's figure for UB Tower, an
 * OSM surveyor's height tag — and those are the only buildings on the map whose
 * height the instrument asserts by name. The engine is ours and the data is the
 * disc: this layer is where the disc's quality becomes readable, one building at
 * a time, without anybody having to take it on trust.
 *
 * ── THE RULE THAT GATES THE WHOLE FEATURE ──
 *
 * A HEIGHT WITH NO STATED SOURCE IS NOT DRAWN AS A LANDMARK. It is enforced here,
 * at construction, by DROPPING such a site: it gets no label, it cannot be
 * picked, and nothing downstream can reinstate it. The alternative — label it and
 * print "source unknown" — is the failure this project has already paid for
 * twice: a rendered number that looks like a measurement because it is rendered
 * beside real ones. `refused` names what was dropped, so the rule is observable
 * rather than silent.
 *
 * The provenance reaches this module through the glTF node `extras` that
 * `blender_bangalore.py` writes (`export_extras=True` — it was missing, and all
 * 47 landmarks shipped stripped of their evidence), and through
 * `building-model.ts`, which reads them onto `LandmarkNode`.
 *
 * ── WHY PROJECTION AND NOT A RAYCASTER ──
 *
 * The city is drawn inside a MapLibre `CustomLayerInterface` whose camera is a
 * bare `THREE.Camera` with an overwritten `projectionMatrix` and no maintained
 * `matrixWorld`, so `Raycaster.setFromCamera` reads stale identity data. Picking
 * therefore projects candidate points with the SAME clip matrix the vertex shader
 * uses, and hit-tests in screen space — exactly what `building-pick.ts` does.
 *
 * `projectWard` is IMPORTED from that module rather than reimplemented. Two
 * copies of a projection is how a frame drifts: the copies agree on the day they
 * are written and diverge on the day one of them is fixed, and the symptom is
 * labels that sit a few metres off the buildings they name — which reads as a
 * rendering bug and is really a second matrix multiply nobody knew existed.
 *
 * ── WHY THIS FILE DOES NOT IMPORT THREE ──
 *
 * Same reason `building-pick.ts` does not: it is pure arithmetic over a
 * structural `ClipMatrix`, so it unit-tests under plain node with a synthetic
 * matrix and adds nothing to the vendor chunk. `LandmarkNode` from
 * `building-model.ts` satisfies `LandmarkSite` structurally, so the renderer
 * hands its landmarks straight in and no adapter exists to get out of step.
 */
import { projectWard, type ClipMatrix } from './building-pick.ts';

/**
 * One candidate landmark, in the ward frame the instrument speaks.
 *
 * Structurally a subset of `LandmarkNode` (building-model.ts) so the renderer
 * passes its array through unchanged — `object` and the rest are simply not read
 * here, which is what keeps this module free of three.
 */
export interface LandmarkSite {
  /** landmark id with the `lm.` prefix stripped, e.g. `ub-tower` */
  readonly name: string;
  /** the human name to draw — "UB Tower". Never the slug, which is an id. */
  readonly title: string;
  /** centroid, metres east of the ward centre */
  readonly x: number;
  /** centroid, metres NORTH of the ward centre */
  readonly y: number;
  /** roof height above the model datum, metres — MEASURED off the drawn geometry */
  readonly topM: number;
  /** authored height, metres — the number the citation is a citation FOR */
  readonly heightM: number;
  /** provenance, verbatim: "CTBUH 13883", "OSM height tag", "…, estimated" */
  readonly source: string;
}

/** What a click on a landmark yields: the claim, and the evidence for it. */
export interface LandmarkPick {
  readonly name: string;
  readonly title: string;
  readonly heightM: number;
  readonly source: string;
}

/**
 * A label to draw, in CSS pixels relative to the canvas.
 *
 * Carries the claim as well as the position — a superset of the `{name, x, y}`
 * the interface strictly needs. The caller writes a chip per landmark ONCE per
 * ward and only moves it afterwards; giving it the height and source here means
 * selecting a chip needs no second lookup keyed on a display string.
 */
export interface LandmarkLabel {
  readonly name: string;
  readonly title: string;
  readonly heightM: number;
  readonly source: string;
  readonly x: number;
  readonly y: number;
  /** clip depth, nearest first — the order labels are returned in */
  readonly depth: number;
}

export interface LandmarkLayer {
  /** Admitted landmarks: those that stated a source. Never mutated after build. */
  readonly sites: readonly LandmarkSite[];
  /** Names refused for want of a height or a source, so the rule is auditable. */
  readonly refused: readonly string[];
  labelsFor(clip: ClipMatrix, width: number, height: number): LandmarkLabel[];
  pick(clip: ClipMatrix, x: number, y: number, width: number, height: number,
       radiusPx?: number): LandmarkPick | null;
  dispose(): void;
}

/**
 * Minimum gap between two labels, in CSS pixels.
 *
 * Whitefield ships 35 landmarks in a 2.8 km box. Zoomed out, every one of them
 * projects into a few hundred pixels and the result is not 35 labels but one
 * illegible smear that hides the city it is describing. Nearer labels win, which
 * is the same rule the depth buffer applies to the buildings underneath them.
 */
const LABEL_SEPARATION_PX = 54;

/** Default click tolerance. Larger than a building's 18 px because a landmark's
 *  anchor is its ROOF centre and the reader aims at the tower. */
const PICK_RADIUS_PX = 40;

/** The rule, in one predicate, so the label path and the pick path cannot
 *  disagree about what a landmark is. */
function hasStatedSource(site: LandmarkSite): boolean {
  return Number.isFinite(site.heightM) && site.heightM > 0
    && site.source.trim().length > 3;
}

/**
 * Build the landmark layer for the ward currently drawn.
 *
 * Landmarks with no stated source are dropped HERE and reported in `refused` —
 * see the rule at the top of this file.
 */
export function createLandmarkLayer(landmarks: readonly LandmarkSite[]): LandmarkLayer {
  let sites: LandmarkSite[] = [];
  const refused: string[] = [];
  for (const site of landmarks) {
    if (hasStatedSource(site)) sites.push(site);
    else refused.push(site.name);
  }

  return {
    get sites() { return sites; },
    refused,

    labelsFor(clip, width, height) {
      const kept: LandmarkLabel[] = [];
      const candidates: LandmarkLabel[] = [];
      for (const site of sites) {
        /* The label is pinned to the ROOF, not the centroid at ground level:
           these are the tall buildings, and a label at their base sits behind
           whatever is in front of them. `projectWard` takes (east, up, north). */
        const p = projectWard(clip, site.x, site.topM, site.y, width, height);
        if (p.w <= 0) continue;                  // behind the camera: never drawn
        if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
        candidates.push({
          name: site.name, title: site.title, heightM: site.heightM,
          source: site.source, x: p.x, y: p.y, depth: p.depth,
        });
      }
      /* Nearest first, so the de-overlap below keeps the landmark in front and
         drops the one behind it — never the other way round. */
      candidates.sort((a, b) => a.depth - b.depth);
      const min2 = LABEL_SEPARATION_PX * LABEL_SEPARATION_PX;
      for (const candidate of candidates) {
        let clear = true;
        for (const other of kept) {
          const dx = candidate.x - other.x, dy = candidate.y - other.y;
          if (dx * dx + dy * dy < min2) { clear = false; break; }
        }
        if (clear) kept.push(candidate);
      }
      return kept;
    },

    pick(clip, x, y, width, height, radiusPx = PICK_RADIUS_PX) {
      let best: LandmarkSite | null = null;
      let bestDepth = Infinity;
      const r2 = radiusPx * radiusPx;
      for (const site of sites) {
        const p = projectWard(clip, site.x, site.topM, site.y, width, height);
        if (p.w <= 0) continue;
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy > r2) continue;
        /* Nearest to the CAMERA among those under the pointer, matching
           pickBuilding: when two landmarks overlap on screen the reader means
           the one they can see. */
        if (p.depth < bestDepth) { best = site; bestDepth = p.depth; }
      }
      return best && {
        name: best.name, title: best.title,
        heightM: best.heightM, source: best.source,
      };
    },

    /**
     * There is nothing to free — this layer owns no GPU resource and no DOM.
     *
     * It exists so the renderer's teardown stays uniform with every other layer,
     * and because dropping the sites is what stops a ward that has been switched
     * away from labelling itself over the ward that replaced it, should a stale
     * reference outlive the rebuild.
     */
    dispose() {
      sites = [];
    },
  };
}
