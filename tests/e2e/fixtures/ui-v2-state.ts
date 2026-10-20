// tests/e2e/fixtures/ui-v2-state.ts — the origin the e2e server runs on, for any port.
// (v2 is the default UI since the flip, so the sticky-flag storageState that used to live here is gone.)
/* OBOS_E2E_PORT is the variable plan amendment A1's e2e-run.sh sets; OBOS_PW_PORT (S1) still works. */
export const PW_PORT = process.env.OBOS_E2E_PORT ?? process.env.OBOS_PW_PORT ?? '4322';
export const PW_ORIGIN = `http://127.0.0.1:${PW_PORT}`;
