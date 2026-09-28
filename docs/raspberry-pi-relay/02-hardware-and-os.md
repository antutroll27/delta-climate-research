# Raspberry Pi relay: hardware and operating system

**Date:** 28 September 2026
**Status:** Decided, not built. The founder chose a Raspberry Pi on Raspberry Pi OS Lite on 28 Sep 2026, and a **Raspberry Pi 4** on 29 Sep 2026.
**Part of:** [the Raspberry Pi relay docs](./README.md). The plan it serves is [01-relay-plan.md](./01-relay-plan.md).

## 1. Shopping list

| Item | Why | Approx. (INR) |
|---|---|---|
| **Raspberry Pi 4 Model B, 4 GB** (8 GB if it will also run other India jobs) | The relay, plus light India-specific jobs | 5,500–8,000 |
| Official Raspberry Pi 4 USB-C power supply (5.1 V, 3 A, 15 W) | Phone chargers under-power a Pi 4, causing random crashes and corrupted storage | 800–1,200 |
| 32–64 GB microSD, A2 class (or a small USB SSD) | Raspberry Pi OS Lite; an SSD survives years of writes better | 500–2,500 |
| Case with a fan or heatsink | Indian summers; keeps it from throttling | 500–1,000 |
| Small DC mini-UPS for 5 V, or a UPS HAT | Rides through power cuts; the router needs one too | 1,000–2,500 |
| Ethernet cable to the router | More reliable than Wi-Fi | 100–300 |

**Pi 4 notes:**
- **RAM.** 4 GB is plenty for the relay alone. Choose 8 GB if the Pi will also host other India-specific jobs.
- **Cooling matters.** A Pi 4 throttles when hot, so use a case with a fan or an aluminium heatsink case.
- **Storage.** A Pi 4 can boot from a USB 3 SSD, using the blue USB 3 ports. That is sturdier than a microSD for years of always-on use; a good A2 microSD is fine to start with.
- **No display needed.** It runs headless. The micro-HDMI ports are only needed if you ever plug in a monitor to troubleshoot.
- **Remote access.** Everything in [03-remote-access.md](./03-remote-access.md) (Tailscale, VS Code Remote-SSH, Raspberry Pi Connect) works the same on a Pi 4.

The software is free: Raspberry Pi OS Lite and the `obos-india` binary from `pi/` (built on the Mac; the Pi needs no toolchain).

## 2. Operating system: Raspberry Pi OS Lite

Considered and not chosen:
- **balenaOS:** revisit if we run two or more relays, or one nobody can reach physically;
- **DietPi, Alpine (RAM mode), Ubuntu Server:** no real gain for one relay.

Set-up:
1. **Raspberry Pi OS Lite (64-bit)**, flashed with Raspberry Pi Imager.
   - Set the hostname, a non-default user, SSH keys only (no password login), and the Wi-Fi country.
   - Use Ethernet, not Wi-Fi, for the relay.
2. **`obos-india`**, one static Go binary built on the Mac (`make -C pi build`) and copied over Tailscale. `pi/deploy/setup.sh` installs it; see `pi/deploy/README.md`.
3. **The service:** `obos-india.service` (`Type=notify`, watchdog, restart always), running as the unprivileged user `obos`; its own ticker relays every 15 min.
4. **Tailscale** for remote SSH. It needs no router port-forwarding, and SSH is exposed only on the tailnet. See [03-remote-access.md](./03-remote-access.md).
5. **`unattended-upgrades`** for security patches, plus a weekly reboot window. Pick a quiet hour, not on the IST hour when CPCB updates.
6. **Read-only overlay** (`raspi-config` → Performance → Overlay FS), switched on last, once everything works.
   - It protects the card from wear and from power cuts.
   - The relay keeps its state (the last submitted `lastupdate`) in memory. After a reboot it submits the current feed once, and OBOS answers `duplicate`: archive files are never overwritten.
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
5. Copy `obos-india` and `pi/deploy/` over, then run `sudo bash setup.sh ./obos-india` (`pi/deploy/README.md`).
6. Turn on the watchdog and `unattended-upgrades`.
7. Last, turn on the read-only overlay (`raspi-config` → Performance → Overlay FS) and reboot.
