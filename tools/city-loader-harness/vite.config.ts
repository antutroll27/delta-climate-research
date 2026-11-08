/* DEV ONLY. A standalone Vite root for the city-loader harness (city-streaming P4). It lives outside src/pages, so the Astro
   production build never sees it: `npm run build` neither compiles nor ships it. Run it with
     npx vite --config tools/city-loader-harness/vite.config.ts --port 4738 --host 127.0.0.1
   (see tools/city-loader-harness/README-free comment in main.ts). */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root: here,
  publicDir: false,
  server: {
    fs: { allow: [repo] },
    // the Canal Ring footprints come from the repo's own public data, served through a tiny middleware below
  },
  plugins: [{
    name: 'harness-data',
    configureServer(server) {
      server.middlewares.use('/data/canal-ring.json', async (_req, res) => {
        const { readFile } = await import('node:fs/promises');
        res.setHeader('content-type', 'application/json');
        res.end(await readFile(`${repo}public/heat-map/data/canal-ring.json`));
      });
    },
  }],
});
