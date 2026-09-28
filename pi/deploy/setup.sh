#!/usr/bin/env bash
# obos-india setup (spec 2026-09-29 §7). Idempotent: safe to re-run; each step
# says what it did or that nothing needed doing. Run as root on the Pi, from the
# folder holding this script, the unit files and the binary:
#
#   sudo bash setup.sh [path/to/obos-india]
#
# Secrets are read from the keyboard (the key hidden) and written only to
# /etc/obos-india/env (0640 root:obos). Nothing is echoed or logged.
set -euo pipefail

BIN_SRC="${1:-./obos-india}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN=/usr/local/bin/obos-india
ETC=/etc/obos-india
ENV_FILE="$ETC/env"
UNITS=/etc/systemd/system
BOOT_CONFIG=/boot/firmware/config.txt
SYSTEM_CONF=/etc/systemd/system.conf
AUTO_UPGRADES=/etc/apt/apt.conf.d/20auto-upgrades

say() { printf '==> %s\n' "$*"; }
die() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo bash setup.sh"
[[ -f $BIN_SRC ]] || die "binary not found: $BIN_SRC"

# install_file SRC DST MODE: copies only when different; reports either way.
install_file() {
  if [[ -f $2 ]] && cmp -s "$1" "$2"; then
    say "$2 unchanged"
  else
    install -m "$3" -o root -g root "$1" "$2"
    say "installed $2"
  fi
}

# 1. The system user and directories.
if id obos >/dev/null 2>&1; then
  say "user obos exists"
else
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin obos
  say "created system user obos (no login)"
fi
install -d -m 0750 -o root -g obos "$ETC"
install -d -m 0755 /usr/local/bin
say "$ETC is 0750 root:obos"

# 2. The binary.
install_file "$BIN_SRC" "$BIN" 0755
say "obos-india version: $("$BIN" version)"

# 3. The env file: prompt only for what is missing; keep what is there.
touch "$ENV_FILE"
chown root:obos "$ENV_FILE"
chmod 0640 "$ENV_FILE"
has() { grep -q "^$1=" "$ENV_FILE"; }
if has RELAY_HMAC_KEY; then
  say "RELAY_HMAC_KEY kept"
else
  while :; do
    read -r -s -p "RELAY_HMAC_KEY (at least 64 hex characters; input hidden): " key
    echo
    [[ $key =~ ^([0-9a-fA-F]{2}){32,}$ ]] && break
    echo "That is not 32 or more bytes of hex. Try again." >&2
  done
  printf 'RELAY_HMAC_KEY=%s\n' "$key" >>"$ENV_FILE"
  unset key
  say "RELAY_HMAC_KEY written"
fi
if has HEALTHCHECK_URL; then
  say "HEALTHCHECK_URL kept"
else
  read -r -p "HEALTHCHECK_URL (the healthchecks.io ping URL; empty for none): " hc
  printf 'HEALTHCHECK_URL=%s\n' "$hc" >>"$ENV_FILE"
  say "HEALTHCHECK_URL written"
fi

# 4. The service, and the wait for a synchronised clock (a Pi has no clock battery).
if dpkg -s systemd-timesyncd >/dev/null 2>&1; then
  say "systemd-timesyncd present"
else
  apt-get install -y systemd-timesyncd
  say "installed systemd-timesyncd"
fi
install_file "$HERE/obos-india.service" "$UNITS/obos-india.service" 0644
install_file "$HERE/obos-india-reboot.service" "$UNITS/obos-india-reboot.service" 0644
install_file "$HERE/obos-india-reboot.timer" "$UNITS/obos-india-reboot.timer" 0644
install -d -m 0755 /usr/local/share/doc/obos-india
install_file "$HERE/README.md" /usr/local/share/doc/obos-india/README.md 0644
systemctl daemon-reload
systemctl enable obos-india.service systemd-time-wait-sync.service
say "enabled obos-india.service and systemd-time-wait-sync.service"

# 5. The hardware watchdog: a hung Pi reboots itself. Pi only.
if [[ -f $BOOT_CONFIG ]]; then
  if grep -qx 'dtparam=watchdog=on' "$BOOT_CONFIG"; then
    say "dtparam=watchdog=on already in $BOOT_CONFIG"
  else
    printf 'dtparam=watchdog=on\n' >>"$BOOT_CONFIG"
    say "added dtparam=watchdog=on to $BOOT_CONFIG (applies at the next boot)"
  fi
  if grep -qx 'RuntimeWatchdogSec=15' "$SYSTEM_CONF"; then
    say "RuntimeWatchdogSec=15 already set"
  else
    if grep -qE '^#?RuntimeWatchdogSec=' "$SYSTEM_CONF"; then
      sed -i -E 's/^#?RuntimeWatchdogSec=.*/RuntimeWatchdogSec=15/' "$SYSTEM_CONF"
    else
      printf 'RuntimeWatchdogSec=15\n' >>"$SYSTEM_CONF"
    fi
    systemctl daemon-reexec
    say "set RuntimeWatchdogSec=15 in $SYSTEM_CONF"
  fi
else
  say "no $BOOT_CONFIG: not a Raspberry Pi, hardware watchdog skipped"
fi

# 6. Security updates, and a weekly reboot at a quiet hour.
if dpkg -s unattended-upgrades >/dev/null 2>&1; then
  say "unattended-upgrades present"
else
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades
  say "installed unattended-upgrades"
fi
want='APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
if [[ -f $AUTO_UPGRADES ]] && [[ "$(cat "$AUTO_UPGRADES")" == "$want" ]]; then
  say "unattended-upgrades already enabled"
else
  printf '%s\n' "$want" >"$AUTO_UPGRADES"
  say "enabled unattended-upgrades"
fi
systemctl enable --now obos-india-reboot.timer
say "weekly reboot timer on: Sunday 03:37 IST"

# 7. Start (or restart) the service, then check everything.
systemctl restart obos-india.service
say "obos-india restarted; running the doctor"
doctor_ok=1
"$BIN" doctor || doctor_ok=0

# 8. The read-only overlay, last, and off unless asked: the rehearsal stays editable.
if [[ $doctor_ok -eq 1 ]] && command -v raspi-config >/dev/null 2>&1; then
  read -r -p "Turn on the read-only overlay now? It protects the SD card; turn it off to change anything later. [y/N] " ans
  if [[ ${ans:-N} =~ ^[Yy]$ ]]; then
    raspi-config nonint enable_overlayfs
    say "overlay enabled: reboot to apply (sudo reboot)"
  else
    say "overlay left off"
  fi
fi

if [[ $doctor_ok -eq 1 ]]; then
  say "done: every check passed"
else
  die "the doctor found a problem (see the ❌ lines above); fix it and re-run setup.sh"
fi
