// src/scripts/climate-clock.ts
// One sessionStorage-cached (24h) fetch of the Climate Clock v2 API, shared by the
// ClimateClock widget and the descent facts. Returns the `modules` object (or
// undefined on failure) — each caller reads the fields it needs.
const CACHE_KEY = 'cc:clock';

export async function getClimateModules(): Promise<any> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) { const c = JSON.parse(cached); if (Date.now() - c.at < 86400000) return c.data?.modules; }
    const res = await fetch('https://api.climateclock.world/v2/clock.json', { signal: AbortSignal.timeout(4000) });
    const data = (await res.json())?.data;
    if (data) sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    return data?.modules;
  } catch { return undefined; }
}
