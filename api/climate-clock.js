/**
 * Climate Clock's public v2 feed, proxied for visitors.
 *
 * Keeping this request server-side means Climate Clock receives the deployment
 * server's request metadata rather than each visitor's IP address and browser
 * metadata. The response contains global public data and is safe to share at the
 * edge; the CDN cache also prevents one upstream request per visitor.
 */
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth; management@deltaclimate.earth)';
const UPSTREAM = 'https://api.climateclock.world/v2/clock.json';
const SHARED_MAX_AGE = 3600;
const REQUEST_TIMEOUT_MS = 5000;

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Climate Clock ${upstream.status}` });
      return;
    }

    const body = await upstream.json();
    res.setHeader(
      'Cache-Control',
      `public, max-age=300, s-maxage=${SHARED_MAX_AGE}, stale-while-revalidate=86400`,
    );
    res.status(200).json(body);
  } catch {
    res.status(502).json({ error: 'Climate Clock unreachable' });
  } finally {
    clearTimeout(timeout);
  }
}
