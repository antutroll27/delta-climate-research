import type maplibregl from 'maplibre-gl';

type ReliefLayerMap = Pick<maplibregl.Map, 'addLayer' | 'getLayer'>;

export function isReliefLayerAttached(map: ReliefLayerMap, layerId: string): boolean {
  return !!map.getLayer(layerId);
}

/**
 * Attach against the style object rather than gating on isStyleLoaded().
 * MapLibre can report that method false while source work is still pending,
 * even though style.load has fired and addLayer is already valid.
 */
export function attachReliefCustomLayer(
  map: ReliefLayerMap,
  layer: maplibregl.CustomLayerInterface,
): boolean {
  if (isReliefLayerAttached(map, layer.id)) return true;
  try {
    map.addLayer(layer);
    return isReliefLayerAttached(map, layer.id);
  } catch {
    return false;
  }
}

/**
 * Relief visibility is a RENDERER question, never a view-mode question.
 *
 * 2D Isotherm is a camera state — pitch 0, bearing 0 over the same 3D scene —
 * not a different scene. Gating this on `mode === 'relief'` set the custom
 * layer to `visibility: 'none'` on entering isotherm, and MapLibre's painter
 * early-returns for hidden layers, so `ThreeReliefRenderer.render()` stopped
 * being called at all. That emptied the isotherm view of the city, water,
 * roads, walk rings and cooling line, and it froze `pickMatrix` at the last
 * relief-mode camera — so a click in isotherm opened the card for the wrong
 * building, and hover showed a pointer cursor over nothing.
 *
 * The layer therefore stays visible whenever it is attached. When it is not
 * attached (relief still importing, or a tier that never loads it) the caller
 * shows the core MapLibre field layer instead.
 */
export function shouldShowRelief(attached: boolean): boolean {
  return attached;
}
