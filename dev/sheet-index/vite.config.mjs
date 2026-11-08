import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/* Dev-only harness for the sheet index UI. Root is this folder; the repo's src/ is reachable through fs.allow. */
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: here,
  cacheDir: process.env.SI_VITE_CACHE ?? '/Volumes/OBOSLab/tmp/p5/vite-cache',
  server: { host: '127.0.0.1', port: Number(process.env.OBOS_E2E_PORT ?? 4739), strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  preview: { host: '127.0.0.1' },
});
