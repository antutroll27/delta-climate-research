// tests/unit/pi-scaffold.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('pi/ is its own standard-library Go module (spec D1): no require, no go.sum', () => {
  const mod = read('pi/go.mod');
  assert.match(mod, /^module deltaclimate\.earth\/obos-india$/m);
  assert.match(mod, /^go 1\.26$/m);
  assert.doesNotMatch(mod, /\brequire\b/, 'a third-party module entered pi/go.mod');
  assert.equal(existsSync(new URL('../../pi/go.sum', import.meta.url)), false, 'go.sum means a dependency');
});

test('the Pi binary is built static for linux/arm64, stripped and version-stamped', () => {
  const mk = read('pi/Makefile');
  // Only pi-v* tags name a release; any other repo tag (such as bangalore-before-merge) must not.
  assert.match(mk, /^VERSION \?= \$\(shell git describe --tags --match 'pi-v\*' --always --dirty 2>\/dev\/null \|\| echo dev\)$/m);
  assert.match(mk, /CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w -X main\.version=\$\(VERSION\)" -o bin\/obos-india \.\/cmd\/obos-india/);
  for (const target of ['build:', 'test:', 'vet:', 'fmt-check:']) assert.match(mk, new RegExp(`^${target}`, 'm'), target);
  assert.match(read('pi/.gitignore'), /^\/bin\/$/m, 'the built binary is never committed');
});

test('CLI deploys never upload pi/: it is not part of the site', () => {
  assert.ok(read('.vercelignore').split('\n').map((l) => l.trim()).includes('/pi'), 'anchored: an unanchored "pi" would also drop tests/fixtures/pi');
});
