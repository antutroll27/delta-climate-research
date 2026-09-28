# CPCB relay plan: getting CPCB's live feed past its cloud firewall

**Version:** 0.2 (plan, not built)
**Date:** 28 September 2026
**Status:** Planned. The founder decided on 28 Sep 2026 to build this later, **on a Raspberry Pi**. Nothing in this document is implemented yet.
**Depends on:** PR #34 (merged, `3d8bc47`), which ships the CPCB feed reader and card **dormant** behind `AIR_CPCB_FEED`.

## 1. Why a relay

OBOS's air card should show CPCB's own published station AQI. PR #34 built everything needed to read and display it, but in production it cannot reach the source:

| Channel | From an ordinary Indian connection | From Vercel (cloud) | Evidence |
|---|---|---|---|
| CPCB feed `airquality.cpcb.gov.in/caaqms/rss_feed` | ✅ 24/24 hourly fetches, 0.4 s | ❌ TCP connect timeout, both `bom1` and `iad1`, any User-Agent | AQI-R47, AQI-R48 |
| OpenAQ (CPCB relay) | — | reachable, but Indian government data frozen since 2026-09-24 17:30 UTC | AQI-R41; likely the same firewall (AQI-R48, hypothesis) |
| data.gov.in (CPCB dataset) | website 503 "Backend fetch failed" | API: "There was a problem proxying the request" (500, 36 s) on 2026-09-28 | this document, §9 |

CPCB's firewall admits ordinary (residential/office) connections and drops cloud data-centre ranges. A **relay** is a small, always-on machine on an ordinary Indian connection. It fetches CPCB's feed on a schedule and hands it to OBOS through storage that Vercel *can* reach. It is the only route that works today, and it delivers CPCB's exact published figures, not a model.

## 2. What the relay is and is not

- **It is** a courier. It fetches the feed, checks that it is a feed, and uploads it unchanged. All parsing and judgement stay in OBOS's existing, audited code (`src/lib/aqi/cpcb-feed.ts`: the linear parser, `pick()`'s sub-index guard, and the freshness states).
- **It is not** a second implementation of the AQI logic, a database, or a public service. It never serves requests.
- **It fails honestly.** If the relay goes down, the card ages through the states that already exist, "Not Live · N h Old" and then fallback, exactly as it would if CPCB itself stopped.

## 3. Architecture

```
 CPCB feed ──(ordinary connection)──► RELAY (India, always on)
                                        │ every 15 min: fetch → sanity check → gzip
                                        ▼
                               Vercel Blob (private)
                                 cpcb/latest.xml.gz
                                 cpcb/archive/YYYY/MM/DD/HH.xml.gz   (one per new lastupdate)
                                        ▲
                                        │ read (server-side, token)
 Visitor ──► /api/air-quality (bom1) ───┘  parseFeed → pick → currentFromFeed   (unchanged)
                     └── OpenAQ for 30-day history + fallback                   (unchanged)
```

**Push, not pull.** The relay makes only *outbound* HTTPS requests: to CPCB, then to Vercel Blob. So it works behind any home or office router, needs no open ports and no fixed IP, and exposes nothing to the internet.

**Why Vercel Blob.**
- It is Vercel-native and one click to connect.
- It is readable from the function without another vendor.
- It keeps each hourly file, which becomes the raw archive for the planned PostgreSQL history (§8).

Alternatives considered:
- **GitHub Gist or repo commits:** public, and they trigger deploys. Rejected.
- **A custom upload endpoint on `/api`:** more code and a public write surface. Kept as the fallback if Blob is unsuitable.

## 4. The relay machine

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Raspberry Pi 4/5 (2–4 GB)** on office/home broadband + small UPS | about ₹6–9k all-in, about 5 W, silent, boots straight into the job | one more device to look after | **Recommended** |
| Old laptop or office PC | free | sleeps and updates; power-hungry; easily switched off | Acceptable for a trial |
| Founder's Mac (launchd) | zero setup | sleeps with the lid shut, travels | **Trial only** (proves the pipeline) |
| Indian VPS or small hosting provider | no hardware | may sit in a blocked range: **must be tested from the box first** | Only after a passing probe |
| GitHub Actions, AWS, GCP or Azure in India | free or cheap | cloud IP ranges, almost certainly blocked like Vercel | Rejected unless a probe passes |

**Location.** Anywhere in India on an ordinary ISP (Jio, Airtel, ACT, BSNL and so on). A second relay at a different site is optional redundancy (§7).

The chosen device (a Raspberry Pi on Raspberry Pi OS Lite), its shopping list and the OS set-up are in [02-hardware-and-os.md](./02-hardware-and-os.md). Remote access from a Mac is in [03-remote-access.md](./03-remote-access.md).

## 5. Relay behaviour

1. A **timer every 15 minutes** (systemd timer on the Pi; launchd on a Mac). CPCB updates hourly and appears within about 10 minutes of the IST hour (AQI-R47). Polling every 15 minutes means OBOS sees each update at most about 25 minutes late, well inside the 2 h "Live" rule.
2. **Fetch** `https://airquality.cpcb.gov.in/caaqms/rss_feed` with a 30 s timeout and the identifying User-Agent `delta-climate-research-relay/1.0 (https://deltaclimate.earth)`.
3. **Sanity check before uploading**, rejecting and logging anything that fails. This is cheap and dumb on purpose; the real validation happens in OBOS.
   - HTTP 200;
   - body under 2 MB;
   - contains `<AqIndex`;
   - at least 300 `<Station ` elements;
   - exactly one distinct `lastupdate`.
4. **Upload only when `lastupdate` changed** since the last successful upload (kept in a small state file):
   - overwrite `cpcb/latest.xml.gz`;
   - write `cpcb/archive/YYYY/MM/DD/HH.xml.gz`, keyed by the feed's IST `lastupdate`, never overwriting an existing file.
   - Both uploads are **gzip** (about 43 KB each; the raw feed is about 360 KB).
5. **Heartbeat.** After every run, success or not, write `cpcb/relay-status.json` with `{ relay_id, ran_at, last_ok_at, last_error, lastupdate, stations }`. OBOS can then tell "relay down" apart from "CPCB not updating".
6. **Language: Node (TypeScript, one file).** Node matches the repo's toolchain, and the sanity check can import the constants it needs from `src/lib/aqi/cpcb-feed.ts` (`FEED_URL`, `FEED_MAX_BYTES`) so they cannot drift. It lives in `relay/cpcb-relay.ts` and runs as `node --experimental-strip-types relay/cpcb-relay.ts`. A Python version would also be acceptable, provided it passes strict mypy per repo rules.

## 6. OBOS changes (small)

The whole card, parser and state machine already exist. Only the **source of the XML** changes.

1. **A source switch.** A new env var selects where the XML comes from:
   - `AIR_CPCB_SOURCE=relay`: read the latest relay file from Vercel Blob;
   - `AIR_CPCB_SOURCE=direct`: fetch CPCB's feed directly, as today, for local development.

   `AIR_CPCB_FEED=on` stays the master switch. `fetchFeed()` gains a `source` option; everything after it (`parseFeed`, `pick`, `currentFromFeed`, the caches) is untouched.
2. **Reading from Blob.**
   - Read with `@vercel/blob` (a new dependency) using a **read** token, or a private download URL.
   - Send it through the same 8 s timeout, 2 MB cap, gunzip, and `parseFeed`.
   - Freshness comes from the feed's own `lastupdate`, as now.
3. **Relay-down wording.** When the relay heartbeat is older than 2 h and the feed is stale, the fallback line stays neutral, as today ("no usable current CPCB figure"). The team gets alerted instead (§7). No new UI.
4. **Tests.** They mirror the existing suites, test-first with mutation proofs:
   - relay source reads and parses the fixture;
   - a stale relay file ages correctly;
   - a missing, corrupt or oversize blob falls back;
   - `AIR_CPCB_SOURCE` unset or unknown leaves the feed off;
   - the relay's own sanity check rejects each bad input.
5. **Pre-flight probe (mandatory, per AQI-R48).** Before any release, run a Preview-only probe that reads the Blob from Vercel `bom1`. Also run the relay's own fetch *on the relay machine* and confirm 200 and 480+ stations. Never assume reachability from a development Mac.

## 7. Operations

- **Secrets.**
  - The relay holds a **write-only-scoped** Blob token (`BLOB_READ_WRITE_TOKEN` for a store used only by the relay).
  - Vercel holds the read side.
  - Neither goes in the repo or in logs.
  - Rotate the token if the device is lost.
- **Tampering.** Someone with the relay token could upload a fake feed. Mitigations:
  - OBOS still applies every guard: the AQI must equal the largest sub-index, values must be ≤ 500, the station must be the exact name within 100 m, and the date must be possible.
  - The archive makes any tampering auditable.
  - Optional later: sign each upload with an HMAC key held only by the relay and Vercel.
- **Monitoring.** Free choices:
  - the relay pings **healthchecks.io** on each successful run; a missed ping for more than 2 h emails the team;
  - or a Vercel Cron job reads `relay-status.json` hourly and alerts when it is stale.
- **Power and network.** A small UPS on the Pi. The Pi reboots straight into the timer. An outage only ages the card; it never shows a wrong number.
- **Redundancy (optional).** A second relay at another site, with its own `relay_id`. Both write, and each upload happens only when `lastupdate` is newer, so the two are harmless together.
- **Updates.** The relay script is versioned in the repo (`relay/`) and deployed by `git pull` plus a restart. Pin the Node LTS version.

## 8. The archive becomes history

Every hourly file under `cpcb/archive/` is CPCB's full national snapshot: 480+ stations, sub-indices, and the published AQI.

- **Now:** it is kept as raw evidence (about 43 KB/hour, about 380 MB/year; check the Blob plan's included storage).
- **Later:** the planned PostgreSQL archive ingests these files. That gives OBOS its **own** 30-day chart and long-term record from CPCB's official figures, and ends the dependence on OpenAQ for history.
- It also covers Bengaluru stations for free, whenever wards gain an in-window station.

## 9. data.gov.in: still worth retrying

data.gov.in is the government's sanctioned programmatic route to the same CPCB dataset (resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69`). On 2026-09-28:
- its website returned 503;
- its API returned 500 "There was a problem proxying the request" after 36 s;
- the shared demo key returned 429.

If it recovers and the founder gets a key, it could replace the relay with no hardware. The OBOS side would be one more `AIR_CPCB_SOURCE` value. It needs its own field check first: are its values CPCB's sub-indices, and how fresh are they?

## 10. Implementation outline

These are the tasks for a later subagent-driven build. A full step-level plan will be written when the work is started.

1. **Pre-flight (no code).**
   - Buy and set up the Pi ([02-hardware-and-os.md](./02-hardware-and-os.md)); set up remote access ([03-remote-access.md](./03-remote-access.md)).
   - Run the fetch on it: expect 200 and 480+ stations.
   - Connect a Vercel Blob store; issue the tokens.
2. **Relay script** in `relay/cpcb-relay.ts`: fetch, sanity check, change detection, gzip upload of `latest` + `archive`, heartbeat. Unit tests with fake fetch and fake Blob. Timer units for systemd and launchd in `relay/`.
3. **Source switch** in OBOS: `AIR_CPCB_SOURCE` and the Blob reader in `cpcb-feed.ts`, with tests and mutation proofs.
4. **Trial run.** Run the relay on the founder's Mac for 24 h, then point a Preview at it with `AIR_CPCB_FEED=on` and `AIR_CPCB_SOURCE=relay`. Verify Ballygunge is live from CPCB on the Preview, through `vercel curl`.
5. **Production relay.** Install on the Pi. Set up the healthchecks.io ping. Let it run 48 h, then check `relay-status.json` and the archive for hourly files with no gaps.
6. **Switch on.** Set `AIR_CPCB_FEED=on` and `AIR_CPCB_SOURCE=relay` for Production. Verify on deltaclimate.earth. Rollback is unsetting `AIR_CPCB_FEED`.
7. **Docs.** Add register rows for the relay evidence; update this folder's README and `docs/AQI/README.md` "Current state".

## 11. Decisions for the founder (when work starts)

| # | Question | Default proposed |
|---|---|---|
| 1 | Relay device and where it lives | **Decided 2026-09-28: Raspberry Pi on Raspberry Pi OS Lite.** Location still open (office proposed) |
| 2 | Keep the hourly archive? | Yes: it seeds the PostgreSQL history |
| 3 | Alerting channel | healthchecks.io email to the team |
| 4 | Second relay for redundancy? | Not at first |
| 5 | Sign uploads (HMAC)? | Not at first; the OBOS-side guards and the archive suffice |
| 6 | Remote access from the Mac | **Decided 2026-09-28: VS Code Remote-SSH over Tailscale**, with Raspberry Pi Connect as the browser backup ([03-remote-access.md](./03-remote-access.md)) |

## 12. References

- Spec: `docs/superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md` (§10 rollout, §11 dormant release)
- Register: `docs/AQI/05-research-register.md`, AQI-R41, R47, R47a, R48
- Code: `src/lib/aqi/cpcb-feed.ts`, `api/air-quality.ts` (`feedEnabled`, `feedFor`)
- Evidence snapshots: `~/.cache/delta-climate/cpcb-rss/` (the 6 h cadence recording)
