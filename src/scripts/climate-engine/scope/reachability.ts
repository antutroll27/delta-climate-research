/**
 * What a page may OFFER for an area, and what it must SAY when it cannot.
 *
 * Two decisions live here, and they are the same decision seen from either side of
 * a click: whether a tab switches in place or navigates, and what the instrument
 * puts on screen when it refuses to load. Both were wrong in the same way — they
 * consulted the wrong area's flag, or no flag, and then did nothing quietly.
 *
 * PURE, AND SEPARATE, FOR THE REASON `nextDistinctKey` NEXT DOOR IS: the state that
 * breaks them does not exist in today's registry. `assertRegistryLogic` check 5
 * forbids a non-shipping area inside a `validated` city and Kolkata is validated,
 * so a city with a MIXED set of areas cannot be built right now — and the Dubai
 * plan is to ship exactly that, one tile at a time, as a pure data change. A rule
 * that can only be exercised by editing the registry is a rule nobody exercises.
 */
import { paths } from './paths.ts';
import { splitKey, type AreaKey } from './registry.ts';
import { resolve } from './resolve.ts';
import { wardById } from '../../../data/wards.ts';

/**
 * What a tab in the strip has to BE.
 *
 *   'switch' — a <button>; the mounted instrument swaps areas without a page load
 *   'link'   — an <a>; the browser navigates, and a page that can serve it answers
 *
 * TWO FLAGS, AND BOTH OF THEM. `HeatMapStage.astro` branched on `scope.area.hasData`
 * alone — the flag of the area the page is ON, never the one the tab points AT. In a
 * mixed city that renders a non-shipping sibling as a button on a data-shipping page,
 * and pressing it reaches `loadWard`, which refuses. A control that does nothing and
 * says nothing.
 *
 * The naive fix — branch on the sibling's flag instead — trades the defect for its
 * mirror image. On a page that ships NOTHING no instrument is mounted at all, so a
 * shipping sibling would render as a button with no script behind it: the same dead
 * control, on the other page. The condition is a conjunction because two separate
 * things both have to be true — something here has to be listening, and something
 * there has to be loadable.
 *
 * A record rather than two positional booleans: `tabKind(a, b)` and `tabKind(b, a)`
 * both compile, differ only in a mixed city, and the mixed city is the one case
 * nothing can be tested against today.
 */
export function tabKind(
  flags: { readonly pageShipsData: boolean; readonly tabShipsData: boolean },
): 'switch' | 'link' {
  return flags.pageShipsData && flags.tabShipsData ? 'switch' : 'link';
}

/**
 * Why this area cannot be opened in place — one sentence for the READER — or null
 * when it can.
 *
 * WHAT THIS REPLACES. `loadWard` in heat-map-app.ts opened with two bare returns:
 *
 *     if (!wardOf(name)) return;
 *     const P = paths(name);
 *     if (P === null) return;
 *
 * Both are correct refusals and neither was visible. They sit BEFORE the loading
 * chip is touched, so a tab press against an unloadable area left the previous
 * ward's map on screen, the previous ward's readings in the panel, and the tab
 * highlight wherever it was — indistinguishable from a click that missed. That is
 * the same silent degradation `scope/paths.ts` was written against, arriving one
 * layer later.
 *
 * THE ORDER IS DELIBERATE and it is not the order the two checks were in. "Ships no
 * artefacts" is a DESIGNED absence — a registered area a city has not got to yet —
 * and it is what a visitor is actually looking at. "No row in the ward table" is an
 * authoring fault that `assertRegistryLogic` check 7 already refuses to ship, so it
 * can only be reached by an area that ships data and has no coordinates; putting it
 * first would have answered every ordinary Dubai tab with a sentence about an
 * internal table.
 *
 * `ward-loader.ts` keeps its own wording for the same fact, and that is not an
 * oversight: it rejects a PROMISE, and its sentence names the module and explains
 * what fetching anyway would do — a note to whoever is reading a console. This one
 * goes on a chip in the middle of a map. One fact, two audiences; the day they can
 * be said the same way, they should be.
 */
export function areaRefusal(key: AreaKey): string | null {
  /* The name is RESOLVED here rather than passed in. A caller holding the key and
     the name separately can pass a mismatched pair, and the one caller that exists
     reads its name from the ward table — which is `undefined` for exactly the areas
     this function refuses, so it would have printed "undefined ships no artefacts". */
  const areaName = resolve(key).area.name;
  if (paths(key) === null) {
    return `${areaName} ships no artefacts yet — nothing to load`;
  }
  /* `splitKey`, never a slice on "/": the key is a flat join of three slugs and the
     registry's own note records what a left-to-right split does to `al/quoz`. */
  if (wardById(splitKey(key).area) === undefined) {
    /* Unreachable while check 7 holds. Kept because the thing it guards — a flyTo
       into NaN, leaving a dead canvas under a spinner that never clears — has no
       other symptom, and because a guard that only exists while another guard holds
       is exactly the guard that gets deleted during a refactor of the other one. */
    return `${areaName} has no coordinates in the ward table — the map has nowhere to fly`;
  }
  return null;
}
