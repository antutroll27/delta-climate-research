# Raspberry Pi relay: hardware and operating system

**Date:** 28 September 2026
**Status:** Decided, not bought or built. The founder chose a Raspberry Pi on Raspberry Pi OS Lite on 28 Sep 2026.
**Part of:** [the Raspberry Pi relay docs](./README.md). The plan it serves is [01-relay-plan.md](./01-relay-plan.md).

## 1. Shopping list

| Item | Why | Approx. (INR) |
|---|---|---|
| Raspberry Pi 5 (4 GB), or Pi 4 (2–4 GB) | The relay; 4 GB is ample | 5,000–7,000 |
| Official USB-C power supply (27 W for Pi 5) | Under-powered Pis corrupt their storage | 1,000–1,500 |
| 32–64 GB microSD, A2 class (or a small USB SSD) | Raspberry Pi OS Lite; an SSD survives years of writes better | 500–2,500 |
| Case with a fan or heatsink | Indian summers; keeps it from throttling | 500–1,000 |
| Small DC mini-UPS for 5 V, or a UPS HAT | Rides through power cuts; the router needs one too | 1,000–2,500 |
| Ethernet cable to the router | More reliable than Wi-Fi | 100–300 |

The software is free: Raspberry Pi OS Lite, Node LTS, and the relay script from `relay/`.

## 2. Operating system: Raspberry Pi OS Lite

Considered and not chosen:
- **balenaOS:** revisit if we run two or more relays, or one nobody can reach physically;
- **DietPi, Alpine (RAM mode), Ubuntu Server:** no real gain for one relay.

Set-up:
1. **Raspberry Pi OS Lite (64-bit)**, flashed with Raspberry Pi Imager.
   - Set the hostname, a non-default user, SSH keys only (no password login), and the Wi-Fi country.
   - Use Ethernet, not Wi-Fi, for the relay.
2. **Node LTS**, from the official Node binaries or NodeSource, with the version pinned. The relay script lives in `relay/`, deployed by `git pull`.
3. **Relay timer:** a systemd `cpcb-relay.service` + `cpcb-relay.timer`, run every 15 min with `Persistent=true`, as a dedicated unprivileged user.
4. **Tailscale** for remote SSH. It needs no router port-forwarding, and SSH is exposed only on the tailnet. See [03-remote-access.md](./03-remote-access.md).
5. **`unattended-upgrades`** for security patches, plus a weekly reboot window. Pick a quiet hour, not on the IST hour when CPCB updates.
6. **Read-only overlay** (`raspi-config` → Performance → Overlay FS), switched on last, once everything works.
   - It protects the card from wear and from power cuts.
   - The relay's small state file (the last uploaded `lastupdate`) then lives in RAM. After a reboot the relay simply re-uploads the current feed once. That is harmless: archive files are never overwritten, and `latest` is idempotent.
   - To change anything later: turn the overlay off, reboot, change, turn it back on.
7. **Watchdog:** enable the hardware watchdog, so a hung Pi reboots itself.

## 3. First boot checklist

Work through these in order:
1. Flash Raspberry Pi OS Lite (64-bit) with Raspberry Pi Imager. Set the hostname (e.g. `obos-relay-1`), a non-default user, SSH-key login and the Wi-Fi country. Connect by Ethernet.
2. Update everything: `sudo apt update && sudo apt full-upgrade`.
3. Install Tailscale and log in. Confirm the Mac can SSH to the Pi by its Tailscale name ([03-remote-access.md](./03-remote-access.md)).
4. **The reachability check, before anything else:**
   ```
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://airquality.cpcb.gov.in/caaqms/rss_feed
   ```
   It must print `200` and about 360000. If it doesn't, this connection is blocked too, so stop and choose another site.
5. Install Node LTS; clone the repo; install the relay timer (built later, [01-relay-plan.md](./01-relay-plan.md) §10).
6. Turn on the watchdog and `unattended-upgrades`.
7. Last, turn on the read-only overlay (`raspi-config` → Performance → Overlay FS) and reboot.
