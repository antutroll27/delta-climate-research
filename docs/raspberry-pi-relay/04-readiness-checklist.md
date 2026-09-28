# Raspberry Pi relay: readiness checklist

**Date:** 29 September 2026
**Goal:** when the Pi 4 and its accessories arrive, setting it up means flashing a card, plugging it in, running one command and seeing ✅. Then it runs for months without anyone touching it.
**Part of:** [the Raspberry Pi relay docs](./README.md).

⭐ marks the items people most often forget. **Owner** says who does it: *Eng* is engineering (the code), *Founder* is accounts, purchases and physical tasks.

## 1. Software, ready before the hardware arrives

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **The Pi service (Go):** fetch CPCB, sanity-check, submit to OBOS, heartbeat; one static `linux/arm64` binary | Eng | To build |
| 2 | **OBOS ingest endpoint:** accepts signed submissions from the Pi, validates them with the same parser as the site, and stores them in Vercel Blob | Eng | To build |
| 3 | **OBOS relay source:** `AIR_CPCB_SOURCE=relay` makes `/api/air-quality` read the stored feed | Eng | To build |
| 4 | ⭐ **One-command setup** (`setup.sh`): installs the service, timers, watchdog, automatic updates and the read-only mode. It is idempotent, so it is safe to re-run | Eng | To build |
| 5 | ⭐ **Health check** (`obos-india doctor`): checks CPCB reachability, submission to OBOS, time sync, disk, temperature and the last run, and prints ✅ or ❌ per line | Eng | To build |
| 6 | ⭐ **Dress rehearsal** in a UTM VM on the Mac running Raspberry Pi OS: the full setup and a full day's run before the Pi exists | Eng | To do |
| 7 | Tests, mutation proofs, an independent audit, and a Preview check before production | Eng | To do |

## 2. Accounts and decisions (about 30 minutes)

| # | Item | Owner | Cost |
|---|---|---|---|
| 8 | Vercel Blob store connected to the project | Founder (1 click) | Free tier |
| 9 | Tailscale account; sign in on the Mac | Founder | Free |
| 10 | ⭐ healthchecks.io account, which emails the team if the Pi goes quiet for more than 2 h | Founder | Free |
| 11 | Raspberry Pi Connect account (a browser backup for getting in) | Founder | Free |
| 12 | ⭐ **Where the Pi lives**, and **who can walk over and power-cycle it** | Founder | — |
| 13 | Optional: Cloudflare account, only needed later for public India APIs through a tunnel | Founder | Free |

## 3. Hardware, including the things people forget

| # | Item | Why |
|---|---|---|
| 14 | Raspberry Pi 4 Model B (4 GB; 8 GB if it will host other India jobs) | The server |
| 15 | Official Pi 4 USB-C power supply (5.1 V, 3 A) | A phone charger causes random crashes and corrupted storage |
| 16 | Case with a fan or heatsink, kept somewhere ventilated | A Pi 4 throttles when hot |
| 17 | 32–64 GB A2 microSD (a USB 3 SSD is fine later) | The system disk |
| 18 | ⭐ **A UPS for the router as well as the Pi** | A Pi on battery with the router dark is still offline |
| 19 | ⭐ **A second microSD, flashed and kept as a spare** | A dead card becomes a 5-minute swap |
| 20 | A microSD reader for the Mac, if it has no slot | To flash the card |
| 21 | Ethernet cable to the router | More reliable than Wi-Fi |
| 22 | Optional: a smart plug | Power-cycle it remotely if it ever freezes |

## 4. Built-in self-care (all handled by `setup.sh`)

| # | What | Covers |
|---|---|---|
| 23 | Hardware watchdog, plus systemd restart-on-failure | A frozen Pi or a crashed service recovers by itself |
| 24 | Read-only overlay | A power cut cannot corrupt the SD card |
| 25 | `unattended-upgrades` plus a weekly reboot at a quiet hour | Stays patched with nobody touching it |
| 26 | ⭐ **Time-sync guard.** The Pi has no clock battery, so the service waits for a synchronised clock before its first run | A wrong clock would break the freshness checks |
| 27 | Heartbeat to OBOS plus a healthchecks.io ping | The team hears about an outage before visitors notice |
| 28 | ⭐ **Temperature and disk alarms** in the heartbeat | Catches slow failures |
| 29 | Tailscale, VS Code Remote-SSH and Pi Connect | Fix anything from anywhere ([03-remote-access.md](./03-remote-access.md)) |

## 5. Failure drills: planned, and each tested once in the rehearsal

| Scenario | Expected behaviour |
|---|---|
| Power cut of 5 min | The next run after boot uploads; the card never leaves "Live" |
| Power cut of 5 h | The card ages to "Not Live · N h Old", then recovers by itself; alert after 2 h |
| Internet down | Same as the 5 h cut |
| CPCB changes its feed format | The Pi's sanity check or OBOS's validation rejects it; the site falls back; an alert fires |
| SD card dies | Swap in the spare card (or flash a new one and run `setup.sh`), back in about 15 min |
| The Pi's submission key leaks | Rotate the key in Vercel and on the Pi in about 2 min (the runbook covers this). A leaked key can only submit feeds, and OBOS validates every feed before storing it |
| Clock wrong after boot | The time-sync guard holds the first run until the clock is synchronised |

## 6. Paperwork

| # | Item |
|---|---|
| 30 | ⭐ **Runbook:** a one-page "if X, do Y" for whoever sits near the Pi |
| 31 | **Secrets register:** which keys exist, where each lives, and how to rotate it |
| 32 | **Pi as an India server:** how future India jobs and APIs are added safely (a separate service, a key, a tunnel only when needed) |

## 7. Pi day, in order

1. Flash Raspberry Pi OS Lite (64-bit) with Raspberry Pi Imager. Set the hostname `obos-relay-1`, your user, SSH key and Wi-Fi country.
2. Plug in Ethernet, then power.
3. Install Tailscale and SSH in from the Mac ([03-remote-access.md](./03-remote-access.md)).
4. Run `setup.sh`. It asks for the two secrets once.
5. Run `obos-india doctor`. Every line should be ✅.
6. Wait 24 h, then check that the healthchecks.io dashboard is green and the archive is filling hourly.
7. Engineering sets `AIR_CPCB_SOURCE=relay` and `AIR_CPCB_FEED=on` on a Preview, verifies, then does the same in Production.
