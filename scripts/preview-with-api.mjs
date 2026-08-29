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
 *   node scripts/preview-with-api.mjs [--port 4330]
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const argPort = process.argv.indexOf('--port');
const PORT = argPort === -1 ? 4330 : Number(process.argv[argPort + 1]);
/* The static half lives on its own port and is never spoken to directly. */
const INNER = PORT + 1;

/** The functions this shim can answer, by the path the client actually calls. */
const FUNCTIONS = {
  '/api/live': () => import('../api/live.js'),
  '/api/climate-clock': () => import('../api/climate-clock.js'),
};

const preview = spawn('npx', ['astro', 'preview', '--port', String(INNER)], {
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

  if (fn) {
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
    const upstream = await fetch(`http://localhost:${INNER}${req.url}`, {
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
  console.log(`  /api/live and /api/climate-clock run the real function modules`);
  console.log(`  everything else proxies to astro preview on :${INNER}`);
});
