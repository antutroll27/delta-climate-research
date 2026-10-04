// tests/unit/pi-deploy.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../../pi/deploy/${p}`, import.meta.url), 'utf8');
/** The directives of a systemd unit as [key, value] pairs, comments dropped. */
const directives = (unit) => unit.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('['))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; });
const has = (unit, k, v) => directives(unit).some(([a, b]) => a === k && b === v);

test('the service unit: notify + watchdog, always restarted, runs as obos from the env file (spec §6)', () => {
  const u = read('obos-india.service');
  for (const [k, v] of [['Type', 'notify'], ['WatchdogSec', '120'], ['Restart', 'always'], ['RestartSec', '10'],
    ['EnvironmentFile', '/etc/obos-india/env'], ['User', 'obos'], ['ExecStart', '/usr/local/bin/obos-india serve'],
    ['After', 'network-online.target'], ['StartLimitIntervalSec', '0']]) {
    assert.ok(has(u, k, v), `${k}=${v}`);
  }
});

test('the unit never waits on time-sync.target: blocked NTP would hold it forever; the Go wait is bounded', () => {
  const u = read('obos-india.service');
  assert.ok(!directives(u).some(([, v]) => v.includes('time-sync')), 'no directive names time-sync.target');
  assert.doesNotMatch(read('setup.sh'), /time-wait-sync/);
});

test('the service unit is hardened', () => {
  const u = read('obos-india.service');
  for (const [k, v] of [['NoNewPrivileges', 'yes'], ['ProtectSystem', 'strict'], ['ProtectHome', 'yes'], ['PrivateTmp', 'yes'],
    ['ReadOnlyPaths', '/etc/obos-india'], ['CapabilityBoundingSet', '']]) {
    assert.ok(has(u, k, v), `${k}=${v}`);
  }
});

test('the weekly reboot is Sunday 03:37 IST, written in UTC, not on the IST hour', () => {
  assert.ok(has(read('obos-india-reboot.timer'), 'OnCalendar', 'Sat *-*-* 22:07:00 UTC'));
  assert.ok(has(read('obos-india-reboot.service'), 'ExecStart', '/usr/bin/systemctl --no-block reboot'));
});

test('setup.sh follows spec §7: strict bash, hidden key prompt, watchdog once, overlay offered last and off by default', () => {
  const s = read('setup.sh');
  assert.match(s, /^#!\/usr\/bin\/env bash\n/);
  assert.match(s, /^set -euo pipefail$/m);
  assert.match(s, /useradd --system .*--shell \/usr\/sbin\/nologin obos/);
  assert.match(s, /install -d -m 0750 -o root -g obos "\$ETC"/);
  assert.match(s, /read -r -s -p "RELAY_HMAC_KEY/, 'the key is read hidden');
  assert.match(s, /chmod 0640 "\$ENV_FILE"/);
  assert.match(s, /grep -qx 'dtparam=watchdog=on'/, 'added once');
  assert.match(s, /install -m 0644 -o root -g root "\$HERE\/obos-india-watchdog\.conf" "\$WATCHDOG_CONF"/, 'the watchdog is a drop-in');
  assert.doesNotMatch(s, /\/etc\/systemd\/system\.conf\b(?!\.d)/, 'system.conf itself is never edited (newer images ship none)');
  assert.match(s, /findmnt -no FSTYPE \/.*\n.*die "the read-only overlay is on/, 'refuses to install onto the overlay');
  assert.ok(s.indexOf('findmnt') < s.indexOf('useradd'), 'the overlay check comes before any change');
  assert.match(s, /\[\[ -z \$hc \|\| \$hc =~ \^https:\/\//, 'the ping URL is checked as it is typed');
  assert.match(s, /^systemctl enable obos-india\.service$/m);
  assert.match(s, /read -r -s -p "HEALTHCHECK_URL/, 'the ping URL is a credential: read hidden');
  assert.ok(s.indexOf('apt-get update') < s.indexOf('apt-get install'), 'package lists refreshed before any install');
  assert.doesNotMatch(s.replace(/^append_line\(\) \{[\s\S]*?^\}$/m, ''), />>"\$/, 'every append goes through append_line');
  assert.match(s, /append_line "\$BOOT_CONFIG" "\[all\]"/, 'the watchdog line lands in the [all] section');
  assert.match(s, /elif \[\[ ! -f \$AUTO_UPGRADES \]\]; then\n\s+printf .*>"\$AUTO_UPGRADES"/, '20auto-upgrades written only when absent');
  assert.match(s, /unattended-upgrades/);
  assert.match(s, /"\$BIN" doctor/);
  assert.match(s, /\[\[ \$\{ans:-N\} =~ \^\[Yy\]\$ \]\]/, 'the overlay defaults to No');
  assert.ok(s.indexOf('enable_overlayfs') > s.indexOf('"$BIN" doctor'), 'the overlay is offered after the doctor');
  assert.doesNotMatch(s, /echo "\$key"|printf '%s\\n' "\$key"|set -x/, 'the key is never echoed');
});

test('the watchdog drop-in sets RuntimeWatchdogSec=15 inside [Manager]', () => {
  const lines = read('obos-india-watchdog.conf').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['[Manager]', 'RuntimeWatchdogSec=15']);
});

/** The reboot guard's shell, unescaped as systemd would ($$ → $, %% → %), reading uptime from `file`. */
const rebootGuard = (file) => {
  const line = read('obos-india-reboot.service').split('\n').find((l) => l.startsWith('ExecCondition='));
  const m = /^ExecCondition=\/bin\/sh -c '(.*)'$/.exec(line ?? '');
  assert.ok(m, 'ExecCondition=/bin/sh -c \'…\'');
  return m[1].replaceAll('$$', '$').replaceAll('%%', '%').replace('/proc/uptime', file);
};

test('the weekly reboot never fires within 12 h of boot: no reboot loop on a corrected clock', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'up-')), 'uptime');
  const runs = (uptime) => {
    writeFileSync(file, `${uptime} 1234.56\n`);
    try { execFileSync('/bin/sh', ['-c', rebootGuard(file)]); return true; } catch { return false; }
  };
  assert.equal(runs('95.12'), false, 'just booted: skipped');
  assert.equal(runs('43199.99'), false);
  assert.equal(runs('43200.00'), true);
  assert.equal(runs('604800.50'), true, 'a week up: reboots');
});
