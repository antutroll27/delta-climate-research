/**
 * met.no locationforecast, proxied.
 *
 * WHY THIS EXISTS. api.met.no's terms require an identifying User-Agent and say
 * plainly that browsers "should not contact the API directly, but instead use a
 * local proxy (backend for frontend) server". `User-Agent` is a forbidden header
 * in browser fetch(), so the compliance gap could not be closed in place — the
 * call had to move off the client.
 *
 * The rate limit is "20 requests/second per APPLICATION (total, not per client)",
 * so a per-visitor call is also the wrong shape as traffic grows. s-maxage
 * collapses every visitor in a 10-minute window into one upstream request.
 *
 * met.no is keyless and CC BY 4.0. There is no secret here and there must not be.
 */
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth; angad@deltaclimate.earth)';
const UPSTREAM = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

/* met.no publishes hourly; 10 minutes is well inside that and keeps the freshness
   readout honest, while cutting upstream calls by however many visitors arrive. */
const SHARED_MAX_AGE = 600;

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat and lon required' });
    return;
  }
  try {
    const upstream = await fetch(
      `${UPSTREAM}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!upstream.ok) {
      res.status(502).json({ error: `met.no ${upstream.status}` });
      return;
    }
    const body = await upstream.json();
    res.setHeader('Cache-Control',
      `public, max-age=60, s-maxage=${SHARED_MAX_AGE}, stale-while-revalidate=1800`);
    /* The client reads this to age the reading against the server's clock rather
       than the visitor's — see the `served` handling in heat-map-app.ts. */
    res.setHeader('Date', new Date().toUTCString());
    res.status(200).json(body);
  } catch {
    res.status(502).json({ error: 'met.no unreachable' });
  }
}
