// One session-cached Climate Clock v2 request, shared by the visible clock and
// the descent facts. Concurrent callers reuse the same in-flight promise, so a
// first page load never sends duplicate requests.
const CACHE_KEY = 'cc:clock';
const CACHE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

export interface ClimateModule {
  timestamp?: string;
  initial?: number | string;
  rate?: number | string;
}

export type ClimateModules = Record<string, ClimateModule | undefined>;

interface ClimateResponse {
  data?: { modules?: ClimateModules };
}

interface ClimateCache {
  at: number;
  data?: { modules?: ClimateModules };
}

let inFlight: Promise<ClimateModules | undefined> | undefined;

function readCache(): ClimateModules | undefined {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as ClimateCache;
    if (!Number.isFinite(cached.at) || Date.now() - cached.at >= CACHE_MS) {
      sessionStorage.removeItem(CACHE_KEY);
      return;
    }
    return cached.data?.modules;
  } catch {
    return;
  }
}

async function fetchModules(): Promise<ClimateModules | undefined> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/climate-clock', {
      signal: controller.signal,
    });
    if (!response.ok) return;
    const payload = await response.json() as unknown;
    if (!payload || typeof payload !== 'object') return;
    const modules = (payload as ClimateResponse).data?.modules;
    if (!modules || typeof modules !== 'object') return;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        at: Date.now(),
        data: { modules },
      } satisfies ClimateCache));
    } catch {
      // Storage can be disabled; the live result is still usable this session.
    }
    return modules;
  } catch {
    return;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getClimateModules(): Promise<ClimateModules | undefined> {
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetchModules().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}
