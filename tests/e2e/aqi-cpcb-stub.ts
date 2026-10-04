import type { Page } from '@playwright/test';

/**
 * A CPCB-origin air payload for Ballygunge, shaped like the Pi relay's live answer
 * of 2026-10-04 (headline 107 Moderate, PM10-led; PM2.5 avg sub-index 87). The
 * build has no /api/air-quality, so without this the Air card shows its failure
 * view and nothing under the headline is ever drawn. `observed_at` is "now", so the
 * client's 2 h rule keeps it live.
 */
export function cpcbBallygunge(now = new Date()) {
  const sub = (parameter: string, avg: number) => ({ parameter, avg, min: avg - 10, max: avg + 12, hourly: avg + 3 });
  return {
    current: {
      schema: 2, area_id: 'in/kolkata/ballygunge', served_at: now.toISOString(), state: 'live',
      observed_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
      source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB (Pi relay)', standard: 'CPCB National AQI' },
      station: { id: 'openaq:10918', name: 'Ballygunge, Kolkata', lat: 22.5367507, lon: 88.3638022, distance_m: 1657,
        inside: 'outside_window', placement: 'in KMC Ward 69, outside Ward 68' },
      result: { origin: 'cpcb', aqi: 107, category: 'moderate', dominant: 'pm10', window_h: 24,
        subindices: [sub('pm25', 87), sub('pm10', 107), sub('no2', 21), sub('so2', 9), sub('co', 38), sub('o3', 27)] },
    },
    history: null,
    /* The city-wide mean (lib/aqi/city.ts): 757 / 7 = 108.1 → 108 Moderate. */
    city: {
      name: 'Kolkata', aqi: 108, category: 'moderate', stations: 7, observed_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
      members: ([['Rabindra Bharati University', 118], ['Fort William', 96], ['Jadavpur', 104], ['Ballygunge', 107],
        ['Victoria', 121], ['Rabindra Sarobar', 99], ['Bidhannagar', 112]] as const).map(([n, aqi]) => ({ name: `${n}, Kolkata - WBPCB`, aqi })),
    },
  };
}

export async function stubAir(page: Page): Promise<void> {
  await page.route('**/api/air-quality*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cpcbBallygunge()) }));
}
