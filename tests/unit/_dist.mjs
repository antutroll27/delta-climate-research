/**
 * Read a file from the BUILD OUTPUT.
 *
 * Several standards tests assert on what the build actually emitted, not on what
 * a module returns in isolation — that is the point of them: a route can compile
 * and still not be written. They therefore need `dist/` to exist.
 *
 * `npm run verify` builds BEFORE running unit tests for exactly this reason. It
 * did not always: for eight commits `test:unit` ran first, and because a local
 * checkout usually has a stale `dist/` lying around, every one of these tests
 * passed on my machine and failed in CI with a bare ENOENT. Hence this helper —
 * a missing build says so in one line instead of a stack trace.
 */
import { existsSync, readFileSync } from 'node:fs';

export function readDist(path) {
  const file = `dist${path}`;
  if (!existsSync(file)) {
    if (!existsSync('dist')) {
      throw new Error(`No build output. These tests assert on what the build EMITS — run \`npm run build\` first (\`npm run verify\` does it for you). Missing: ${file}`);
    }
    throw new Error(`Build output exists but ${file} was not emitted — the route is missing or renamed.`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}
