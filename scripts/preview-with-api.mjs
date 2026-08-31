/**
 * `astro preview`, PLUS THE VERCEL FUNCTIONS IT CANNOT RUN.
 *
 * WHY THIS EXISTS. `api/live.js` and `api/climate-clock.js` are Vercel serverless
 * functions at the repo root, not Astro routes — they are not part of `dist/`, so
 * `astro preview` answers 404 for them. The client treats that exactly as it
 * treats a met.no outage, which is correct behaviour and looks like a bug:
 * `state.live` stays null, and `paintClock` hides the clock, the vegetation
 * widget and the street-view toggle behind `hidden = !L`. The live-ambient row
 * shows em-dashes for the same reason. Nothing is broken; the feed is simply not
 * being served locally, and a founder checking the console on localhost sees a
 * console missing three controls with no explanation.
 *
 * WHAT IT DOES. Serves the real function modules for `/api/live` and
 * `/api/climate-clock`, and forwards everything else to a plain `astro preview`
 * running on an internal port. The static half is therefore byte-identical to
 * what `astro preview` serves — this adds routes, it does not reimplement any.
 *
 * IT IMPORTS THE FUNCTIONS RATHER THAN REIMPLEMENTING THEM. A local stub that
 * returned plausible weather would be a second copy of the endpoint's contract,
 * free to drift from the real one and certain to eventually disagree with it —
 * the defect this codebase keeps deleting. What runs here is the deployed file.
 *
 * DEVELOPMENT ONLY. Nothing in `src/` imports this and no build step runs it. The
 * production path is Vercel's own function runtime; this only makes the same code
 * reachable from a local preview.
 *
 *   node scripts/preview-with-api.mjs [--port 4330] [--canned]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `--canned`: THE SAME ROUTES, WITHOUT THE NETWORK. For the browser suite.
 *
 * WHAT IT FIXES. playwright.config.ts used to run a plain `astro preview`, which
 * answers 404 for /api/live. `paintClock` hides the ward clock behind
 * `btn.hidden = !L` (heat-map-app.ts), so on that server #clockw is 0x0 — MEASURED,
 * against 122x75 here. EVERY spec that opens a ward console therefore ran against
 * one with no clock on it, the single exception being
 * heat-map-live-freshness.spec.ts, which stubs the route itself and is the only
 * reason the widget was tested at all. console-contrast.spec.ts is the sharpest
 * case: it walks every text node and asserts a contrast floor, over a console this
 * widget was missing from. The collision that hid in that gap is now pinned by
 * tests/e2e/heat-map-overlap.spec.ts.
 *
 * WHY CANNED RATHER THAN THE REAL FUNCTION. The suite must not depend on Norwegian
 * weather or on being online, and running it must not put ten met.no calls through
 * an endpoint whose terms cap the whole APPLICATION at 20 requests a second.
 *
 * ONLY /api/live IS CANNED. /api/climate-clock is the landing page's, not the
 * console's, and leaving it to 404 exactly as `astro preview` does keeps the
 * landing-page specs looking at the server they were written against.
 *
 * A SPEC'S OWN `page.route` STILL WINS — interception happens in the browser,
 * before the request reaches this process — so heat-map-live-freshness.spec.ts
 * keeps driving age with its own payloads and is unaffected by any of this.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const argPort = process.argv.indexOf('--port');
const PORT = argPort === -1 ? 4330 : Number(process.argv[argPort + 1]);
/* The static half lives on its own port and is never spoken to directly. */
const INNER = PORT + 1;
const CANNED = process.argv.includes('--canned');

/**
 * A met.no body, minus met.no.
 *
 * The reading is stamped at the top of the CURRENT hour on every request rather
 * than at a fixed instant: `ageMinutes` colours the freshness dial from it, and a
 * hardcoded timestamp would age past AGE_STALE_MIN and quietly turn the dot off
 * partway through a suite run. Deterministic in shape, current in age — which is
 * what "the console as a reader finds it" means here.
 *
 * The numbers match tests/e2e/heat-map-live-freshness.spec.ts's own CANNED. That
 * spec keeps its copy deliberately: it varies temperature and timestamp per test
 * to drive the age arithmetic, so it needs a payload it can reshape, not a
 * constant. This one only has to make the console look alive.
 */
function cannedLive(res) {
  const time = `${new Date().toISOString().slice(0, 14)}00:00Z`;
  res.setHeader('date', new Date().toUTCString());
  res.setHeader('age', '0');
  res.status(200).json({
    properties: {
      timeseries: [{
        time,
        data: {
          instant: {
            details: {
              air_temperature: 29.4, relative_humidity: 71,
              wind_speed: 2.4, cloud_area_fraction: 38, wind_from_direction: 190,
            },
          },
        },
      }],
    },
  });
}

/** The functions this shim can answer, by the path the client actually calls. */
const FUNCTIONS = {
  '/api/live': () => import('../api/live.js'),
  '/api/climate-clock': () => import('../api/climate-clock.js'),
};

/* 127.0.0.1 ON BOTH SIDES OF THE PROXY, SPELLED OUT RATHER THAN LEFT TO DNS.
   `localhost` is not one address: since Node 17 the resolver no longer prefers
   IPv4, so `fetch('http://localhost:PORT')` may be answered by ::1 while a server
   bound to 127.0.0.1 never hears it — an ECONNREFUSED that depends on the host's
   resolver order rather than on anything in this repo. It never bit on macOS,
   which is the only place this shim used to run; playwright.config.ts now runs it
   on a Linux CI runner too, and the old `npm run preview -- --host 127.0.0.1`
   pinned the interface explicitly. Keep that guarantee rather than inherit a
   difference between two operating systems' DNS. */
const preview = spawn('npx', ['astro', 'preview', '--host', '127.0.0.1', '--port', String(INNER)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.on('exit', () => preview.kill());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { preview.kill(); process.exit(0); });

/* DIE WITH THE CHILD, because outliving it is worse than crashing.
   The static half is a spawned process and it can exit on its own — a rebuild
   replacing dist/ underneath it, a port taken, an OOM. Without this the shim kept
   listening and answered every page with its own "still starting" fallback,
   for ever: a server that is up, returning 503, and telling you to refresh. That
   is a harder thing to diagnose than a dead port, and it cost a founder a
   confusing minute before this line existed. */
preview.on('exit', (code, signal) => {
  console.error(`[preview-with-api] astro preview exited (${signal ?? code}); shutting down`);
  process.exit(code ?? 1);
});

/**
 * The minimum of Vercel's `res` that these two functions touch.
 *
 * Written against what they CALL, not against the platform's full surface: both
 * use `status().json()` / `status().send()` and `setHeader`. A fuller fake would
 * be inventing a contract nobody here relies on.
 */
function vercelRes(res) {
  const wrapper = {
    status(code) { res.statusCode = code; return wrapper; },
    setHeader(k, v) { res.setHeader(k, v); return wrapper; },
    json(body) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); },
    send(body) { res.end(body); },
    end(body) { res.end(body); },
  };
  return wrapper;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const fn = FUNCTIONS[url.pathname];

  /* CANNED MODE ANSWERS ONE ROUTE AND DELIBERATELY REFUSES THE OTHER.
     /api/live is served from the fixed reading above. Every other function path —
     /api/climate-clock — falls through to the static proxy and 404s, which is
     precisely what `astro preview` did before the suite moved to this server, so
     the landing-page specs keep looking at the server they were written against.
     Serving it would also put a climateclock.world request into every suite run
     for a widget no console spec looks at. */
  if (CANNED) {
    if (url.pathname === '/api/live') { cannedLive(vercelRes(res)); return; }
  } else if (fn) {
    try {
      const mod = await fn();
      /* Vercel hands the handler a `query` object; these functions read lat/lon
         off it rather than parsing the URL themselves. */
      const query = Object.fromEntries(url.searchParams);
      await mod.default({ ...req, query, url: req.url, method: req.method }, vercelRes(res));
    } catch (error) {
      /* LOUD, because a shim that silently 500s is indistinguishable from the
         404 it exists to fix, and would send the next reader hunting the client. */
      console.error(`[preview-with-api] ${url.pathname} threw:`, error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
    return;
  }

  /* Everything else is the static build, untouched. */
  try {
    const upstream = await fetch(`http://127.0.0.1:${INNER}${req.url}`, {
      method: req.method,
      headers: req.headers,
      redirect: 'manual',
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((v, k) => {
      if (k !== 'content-encoding' && k !== 'content-length') res.setHeader(k, v);
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    /* The inner preview takes a moment to bind; a refresh is the whole fix. */
    res.statusCode = 503;
    res.end('astro preview is still starting — refresh in a second');
  }
}).listen(PORT, () => {
  console.log(`preview + api  →  http://localhost:${PORT}`);
  console.log(CANNED
    ? '  /api/live is CANNED (--canned): no met.no call, deterministic reading'
    : '  /api/live and /api/climate-clock run the real function modules');
  console.log(`  everything else proxies to astro preview on :${INNER}`);
});
