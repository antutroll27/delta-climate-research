/** Great-circle distance in whole metres (haversine, mean Earth radius 6,371,008.8 m). The one distance the local-air cards print. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a))));
}
