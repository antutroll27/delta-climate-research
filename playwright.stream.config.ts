import { defineConfig, devices } from '@playwright/test';

/** The streaming specs only (stream-smoke / -crossings / -walk), against `astro preview` of a build made with PUBLIC_OBOS_STREAM_DEV=1 (the dev
 *  build) or, with OBOS_STREAM_PUBLIC=1, PUBLIC_OBOS_STREAM=1 (the public build; the walk then runs without ?stream=1 and without the dev hooks).
 *  OBOS_STREAM_DIST names the dist. Headless Metal, no window. */
const PORT = process.env.OBOS_E2E_PORT ?? '4736';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /stream-(smoke|crossings|walk)\.spec\.ts/,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
  webServer: {
    command: `npx astro preview --outDir ${process.env.OBOS_STREAM_DIST ?? 'dist-stream'} --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: false, timeout: 60_000,
  },
});
