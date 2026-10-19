// src/pages/obos-v2/obos-v2.css.ts — FINAL audit F5. The v2 stylesheet as its own file, /obos-v2/obos-v2.css, fetched by UiSwap ONLY when the flag is on.
// `?inline` runs the same processing the page bundle gave it (imports resolved, nesting, minification) and hands back the text.
import css from '../../styles/obos-v2/index.css?inline';

export const GET = (): Response => new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
