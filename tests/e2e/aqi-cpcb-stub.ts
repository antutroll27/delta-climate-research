import type { Page } from '@playwright/test';

/**
 * A CPCB-origin air payload for Ballygunge, shaped like the Pi relay's live answer
 * of 2026-10-04 (headline 107 Moderate, PM10-led; PM2.5 avg sub-index 87). The
 * build has no /api/air-quality, so without this the Air card shows its failure
 * view and nothing under the headline is ever drawn. `observed_at` is "now", so the
 * client's 2 h rule keeps it live.
 */
export function cpcbBallygunge(now = new Date(), o: { nowcast?: boolean } = {}) {
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
    /* `nowcast`: the US line by EPA NowCast from the relay's hourly record (lib/aqi/hourly-history.ts). */
    ...(o.nowcast ? { us_nowcast: { aqi: 154, category: 'unhealthy', dominant: 'pm25', hours_used: 12 } } : {}),
  };
}

export async function stubAir(page: Page, o: { nowcast?: boolean } = {}): Promise<void> {
  await page.route('**/api/air-quality*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cpcbBallygunge(new Date(), o)) }));
}

/**
 * Indiranagar's answer as the handler builds it from CPCB's feed of 05-10-2026 02:00 IST
 * (tests/fixtures/aqi/cpcb-feed-2026-10-05T0200IST.xml.gz): Kasturi Nagar 68 Satisfactory,
 * PM10-led, 3.8 km away outside the ward's window; Bengaluru 612 / 7 = 87 Satisfactory.
 * No history: Bengaluru has no OpenAQ copy (stations.ts `sensors: null`).
 */
export function cpcbIndiranagar(now = new Date()) {
  const at = new Date(now.getTime() - 20 * 60_000).toISOString();
  const sub = (parameter: string, avg: number | null, min: number | null, max: number | null) => ({ parameter, avg, min, max, hourly: null });
  return {
    current: {
      schema: 2, area_id: 'in/bengaluru/indiranagar', served_at: now.toISOString(), state: 'live', observed_at: at,
      source: { owner: 'Karnataka State Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' },
      station: { id: 'cpcb:kasturi-nagar-bengaluru', name: 'Kasturi Nagar, Bengaluru', lat: 13.003872, lon: 77.664217, distance_m: 3803,
        inside: 'outside_window', placement: 'in Kasturi Nagar, north-east of Indiranagar' },
      result: { origin: 'cpcb', aqi: 68, category: 'satisfactory', dominant: 'pm10', window_h: 24,
        subindices: [sub('pm25', 52, 50, 53), sub('pm10', 68, 67, 69), sub('no2', 26, 25, 27), sub('nh3', 4, 4, 4), sub('so2', 9, 9, 9), sub('co', null, null, null), sub('o3', null, null, null)] },
    },
    history: null,
    city: {
      name: 'Bengaluru', aqi: 87, category: 'satisfactory', stations: 7, observed_at: at,
      members: ([['Jayanagar 5th Block', 'KSPCB', 119], ['Bapuji Nagar', 'KSPCB', 84], ['Peenya', 'CPCB', 37], ['BTM Layout', 'CPCB', 88],
        ['Silk Board', 'KSPCB', 126], ['Hebbal', 'KSPCB', 90], ['Kasturi Nagar', 'KSPCB', 68]] as const).map(([n, o, aqi]) => ({ name: `${n}, Bengaluru - ${o}`, aqi })),
    },
  };
}

export async function stubAirIndiranagar(page: Page): Promise<void> {
  await page.route('**/api/air-quality*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cpcbIndiranagar(new Date())) }));
}
