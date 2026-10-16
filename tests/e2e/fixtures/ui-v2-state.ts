// tests/e2e/fixtures/ui-v2-state.ts — the sticky v2 flag as a Playwright storageState, for any port.
// (The static JSON it replaces hard-wired http://127.0.0.1:4322; OBOS_PW_PORT lets two worktrees test at once.)
export const PW_PORT = process.env.OBOS_PW_PORT ?? '4322';
export const PW_ORIGIN = `http://127.0.0.1:${PW_PORT}`;
export const V2_STORAGE_STATE = {
  cookies: [],
  origins: [{ origin: PW_ORIGIN, localStorage: [{ name: 'obos:ui', value: 'v2' }] }],
};
