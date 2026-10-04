# Raspberry Pi relay: readiness checklist

**Date:** 29 September 2026
**Goal:** when the Pi 4 and its accessories arrive, setting it up means flashing a card, plugging it in, running one command and seeing ✅. Then it runs for months without anyone touching it.
**Part of:** [the Raspberry Pi relay docs](./README.md).

⭐ marks the items people most often forget. **Owner** says who does it: *Eng* is engineering (the code), *Founder* is accounts, purchases and physical tasks.

## 1. Software, ready before the hardware arrives

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **The Pi service (Go):** fetch CPCB, sanity-check, submit to OBOS, heartbeat; one static `linux/arm64` binary | Eng | Built on `feat/pi-india-service`; not merged |
| 2 | **OBOS ingest endpoint:** accepts signed submissions from the Pi, validates them with the same parser as the site, and stores them in Vercel Blob | Eng | Built on `feat/pi-india-service`; not merged |
| 3 | **OBOS relay source:** `AIR_CPCB_SOURCE=relay` makes `/api/air-quality` read the stored feed | Eng | Built on `feat/pi-india-service`; not merged |
| 4 | ⭐ **One-command setup** (`setup.sh`): installs the service, the weekly reboot timer, the watchdog and automatic updates, then offers the read-only mode (default No). It is idempotent, so it is safe to re-run | Eng | Built on `feat/pi-india-service`; not merged |
| 5 | ⭐ **Health check** (`obos-india doctor`): checks the config, time sync, CPCB reachability, submission to OBOS (a signed ping), disk, temperature and that the service is active, and prints ✅ or ❌ per line. Run it with `sudo` (the config is readable only by root and the service) | Eng | Built on `feat/pi-india-service`; not merged |
| 6 | ⭐ **Dress rehearsal** in the Linux VM on the Mac (Debian 13 arm64, the base of current Raspberry Pi OS; kept on the portable SSD): the full setup and a full day's run before the Pi exists | Eng | VM built 29 Sep; Linux-only checks pass (systemd socket test, unit files verified, security score 1.7, reboot guard skips after boot). Full `setup.sh` run and end-to-end feed still to do |
| 7 | Tests, mutation proofs, an independent audit, and a Preview check before production | Eng | Tests, mutation proofs and the independent audit done (29 Sep; every finding fixed or documented as a known limit); Preview to do |

## 2. Accounts and decisions (about 30 minutes)

| # | Item | Owner | Cost |
|---|---|---|---|
| 8 | Vercel Blob store connected to the project, for **Production as well as Preview** (the Pi submits to Production) | Founder (1 click) | Free tier |
| 9 | Tailscale account; sign in on the Mac | Founder | Free |
| 10 | ⭐ healthchecks.io account, which emails the team if the Pi goes quiet for more than 2 h | Founder | Free |
| 11 | Raspberry Pi Connect account (a browser backup for getting in) | Founder | Free |
| 12 | ⭐ **Where the Pi lives**, and **who can walk over and power-cycle it** | Founder | — |
| 13 | Optional: Cloudflare account, only needed later for public India APIs through a tunnel | Founder | Free |
| 13a | ⭐ **Before Pi day:** the branch merged and live on deltaclimate.earth (the Pi's default target is Production; without it the doctor's OBOS line is ❌ and `setup.sh` stops) | Eng | — |
| 13b | ⭐ **Before Pi day:** `RELAY_HMAC_KEY` set in Vercel **Production** and redeployed; the same value kept in the password manager for the Pi | Founder + Eng | — |

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
| 24 | Read-only overlay, **offered** at the end (default No). With it on, `setup.sh` refuses to run, and updates last only until the weekly reboot (see `pi/deploy/README.md` §7) | A power cut cannot corrupt the SD card |
| 25 | `unattended-upgrades` plus a weekly reboot at a quiet hour | Stays patched with nobody touching it |
| 26 | ⭐ **Time-sync guard.** The Pi has no clock battery, so the service waits for a synchronised clock before its first run | A wrong clock would break the freshness checks |
| 27 | A healthchecks.io ping after every run (success, or `/fail`) | The team hears about an outage before visitors notice |
| 28 | ⭐ **Temperature and disk** in `/status` and checked by `obos-india doctor` (not pushed as alerts yet) | Catches slow failures when someone looks |
| 29 | Tailscale, VS Code Remote-SSH and Pi Connect | Fix anything from anywhere ([03-remote-access.md](./03-remote-access.md)) |

## 5. Failure drills: planned, and each tested once in the rehearsal

| Scenario | Expected behaviour |
|---|---|
| Power cut of 5 min | The next run after boot submits; the card never leaves "Live" |
| Power cut of 5 h | After 2 h the card switches to the OpenAQ reading, then returns to CPCB by itself; alert after 2 h |
| Internet down | Same as the 5 h cut |
| CPCB changes its feed format | The Pi's sanity check or OBOS's validation rejects it; the site falls back; an alert fires |
| SD card dies | Swap in the spare card (or flash a new one and run `setup.sh`), back in about 15 min |
| The Pi's submission key leaks | Rotate the key in Vercel and on the Pi in about 2 min (the runbook covers this). A leaked key can only submit feeds, and OBOS validates every feed before storing it |
| Clock wrong after boot | The time-sync guard holds the first run until the clock is synchronised, for at most 10 minutes; then it relays anyway and warns |
| CPCB's feed freezes (still served, never updated) | After 3 h the run turns "stale" and the healthcheck alert fires |

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
4. Create the folder, copy the files and run `setup.sh` (`pi/deploy/README.md` §2–3). It asks for the two secrets once.
5. Run `sudo obos-india doctor`. Every line should be ✅.
6. Wait 24 h, then check that the healthchecks.io dashboard is green and the archive is filling hourly.
7. Engineering sets `AIR_CPCB_SOURCE=relay` and `AIR_CPCB_FEED=on` on a Preview, verifies, then does the same in Production.
