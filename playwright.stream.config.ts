import { defineConfig, devices } from '@playwright/test';

/** The dev streaming smoke only (tests/e2e/stream-smoke.spec.ts), against `astro preview` of a build made with
 *  PUBLIC_OBOS_STREAM_DEV=1 (OBOS_STREAM_DIST) with the sheet data copied into it. Headless Metal, no window. */
const PORT = process.env.OBOS_E2E_PORT ?? '4736';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /stream-(smoke|crossings)\.spec\.ts/,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
  webServer: {
    command: `npx astro preview --outDir ${process.env.OBOS_STREAM_DIST ?? 'dist-stream'} --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: false, timeout: 60_000,
  },
});
