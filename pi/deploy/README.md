# obos-india on the Raspberry Pi: build, install, run

`obos-india` is one static Go binary. It relays CPCB's live feed to OBOS every 15 minutes
and serves a small local API (`/healthz`, `/status`). Design: `docs/superpowers/specs/2026-09-29-pi-india-service-design.md`.

The Pi needs no Go toolchain: the binary is built on the Mac and copied over.

## 1. Build (on the Mac)

```sh
make -C pi test vet fmt-check build     # bin/obos-india: linux/arm64, static, about 6.7 MB
file pi/bin/obos-india                   # ELF 64-bit LSB executable, ARM aarch64, ... statically linked
```

## 2. Copy to the Pi (over Tailscale)

```sh
ssh <user>@obos-relay-1 mkdir -p obos-india     # scp needs the folder to exist
scp pi/bin/obos-india pi/deploy/{setup.sh,obos-india.service,obos-india-reboot.service,obos-india-reboot.timer,obos-india-watchdog.conf,README.md} \
    <user>@obos-relay-1:~/obos-india/
```

## 3. Install

```sh
ssh <user>@obos-relay-1
cd ~/obos-india && sudo bash setup.sh ./obos-india
```

`setup.sh` asks once for `RELAY_HMAC_KEY` and `HEALTHCHECK_URL` (both hidden; the URL must be `https://`), installs and starts
the service, turns on the hardware watchdog, automatic security updates and a weekly reboot
(Sunday 03:37 IST), then runs `obos-india doctor`. Every line should be ✅. It offers the
read-only overlay last; the default is No. Re-running it is safe: it keeps existing values.

To upgrade, copy the new binary and run `sudo bash setup.sh ./obos-india` again. With the read-only overlay
on, `setup.sh` refuses to run: turn the overlay off first (section 7).

To re-enter a secret (a typo, or a healthcheck added later), delete its line and re-run, e.g.
`sudo sed -i '/^HEALTHCHECK_URL=/d' /etc/obos-india/env && sudo bash setup.sh ./obos-india`.

## 4. Everyday commands

| What | Command |
|---|---|
| Health check | `sudo obos-india doctor` |
| Logs, live | `journalctl -u obos-india -f` |
| Logs, today | `journalctl -u obos-india --since today` |
| Status JSON | `curl -s http://127.0.0.1:8787/status` |
| One relay run now | `sudo -u obos obos-india relay-once` (reads `/etc/obos-india/env`) |
| Restart | `sudo systemctl restart obos-india` |
| Version | `obos-india version` |

To reach `/status` from the Mac over the tailnet without opening a port: `sudo tailscale serve --bg 8787`
on the Pi, then open `https://obos-relay-1.<tailnet>.ts.net/status`.

## 5. Rotate the key (about 2 minutes; do it if the Pi is lost or the key may have leaked)

1. New key, on the Mac: `openssl rand -hex 32`. Do not paste it anywhere else.
2. Vercel: replace `RELAY_HMAC_KEY` in **Production** and **Preview**
   (`vercel env rm RELAY_HMAC_KEY production`, then `vercel env add RELAY_HMAC_KEY production`; the same for `preview`),
   then **redeploy**: a Vercel env change reaches only new deployments.
3. Pi: `sudo sed -i '/^RELAY_HMAC_KEY=/d' /etc/obos-india/env && sudo bash setup.sh ./obos-india` (it asks for the key again).
   With the read-only overlay on, turn it off first (section 7).
4. `sudo obos-india doctor`: the OBOS line is ✅ again. Between steps 2 and 3 submissions get 401; after 2 h the card shows the OpenAQ reading; nothing wrong is shown.

## 6. Uninstall

```sh
sudo systemctl disable --now obos-india.service obos-india-reboot.timer
sudo rm -f /etc/systemd/system/obos-india.service /etc/systemd/system/obos-india-reboot.{service,timer}
sudo systemctl daemon-reload
sudo rm -rf /etc/obos-india /usr/local/bin/obos-india /usr/local/share/doc/obos-india
sudo userdel obos
```

The watchdog settings (`dtparam=watchdog=on` in `/boot/firmware/config.txt`, and
`/etc/systemd/system.conf.d/obos-india-watchdog.conf`) and unattended-upgrades are left in place: they are good for any Pi.

## 7. The read-only overlay

`sudo raspi-config nonint enable_overlayfs` then reboot turns it on; `sudo raspi-config nonint disable_overlayfs`
then reboot turns it off. While it is on, every change (the env file, a new binary) is lost at the next reboot,
so turn it off, reboot, change, turn it on, reboot. The relay keeps its state in memory anyway: after any reboot
it submits the current feed once, which OBOS answers as a duplicate.

**The overlay and automatic updates work against each other.** With the overlay on, unattended-upgrades still
runs, but it installs into RAM, and the weekly reboot throws the updates away (they are fetched and applied again
each week). So with the overlay on, the Pi runs its installed packages plus that week's updates, never a patched disk.
Either keep the overlay off and rely on the UPS against SD corruption, or, with it on, turn it off once a month,
reboot, `sudo apt update && sudo apt full-upgrade`, and turn it back on.

The weekly reboot never fires within 12 h of boot. With the overlay on, the Pi boots on an old saved clock; when
NTP corrects it, a "missed" Saturday would otherwise fire at once, on every boot.
