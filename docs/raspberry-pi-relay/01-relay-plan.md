# CPCB relay plan: getting CPCB's live feed past its cloud firewall

**Version:** 0.3 (design approved; being built)
**Date:** 29 September 2026 (v0.2: 28 September)
**Status:** Being built on `feat/pi-india-service`: the Go service `obos-india`, the signed ingest endpoint and the relay source. Design: [`docs/superpowers/specs/2026-09-29-pi-india-service-design.md`](../superpowers/specs/2026-09-29-pi-india-service-design.md); step plan: [`docs/superpowers/plans/2026-09-29-pi-india-service.md`](../superpowers/plans/2026-09-29-pi-india-service.md). v0.3 replaces v0.2's Node script writing Blob directly (§5–§7).
**Depends on:** PR #34 (merged, `3d8bc47`), which ships the CPCB feed reader and card **dormant** behind `AIR_CPCB_FEED`.

## 1. Why a relay

OBOS's air card should show CPCB's own published station AQI. PR #34 built everything needed to read and display it, but in production it cannot reach the source:

| Channel | From an ordinary Indian connection | From Vercel (cloud) | Evidence |
|---|---|---|---|
| CPCB feed `airquality.cpcb.gov.in/caaqms/rss_feed` | ✅ 24/24 hourly fetches, 0.4 s | ❌ TCP connect timeout, both `bom1` and `iad1`, any User-Agent | AQI-R47, AQI-R48 |
| OpenAQ (CPCB relay) | — | reachable, but Indian government data frozen since 2026-09-24 17:30 UTC | AQI-R41; likely the same firewall (AQI-R48, hypothesis) |
| data.gov.in (CPCB dataset) | website 503 "Backend fetch failed" | API: "There was a problem proxying the request" (500, 36 s) on 2026-09-28 | this document, §9 |

CPCB's firewall admits ordinary (residential/office) connections and drops cloud data-centre ranges. A **relay** is a small, always-on machine on an ordinary Indian connection. It fetches CPCB's feed on a schedule and submits it, signed, to an OBOS endpoint that Vercel serves, which stores it where Vercel *can* read it. It is the only route that works today, and it delivers CPCB's exact published figures, not a model.

## 2. What the relay is and is not

- **It is** a courier. It fetches the feed, checks that it is a feed, and uploads it unchanged. All parsing and judgement stay in OBOS's existing, audited code (`src/lib/aqi/cpcb-feed.ts`: the linear parser, `pick()`'s sub-index guard, and the freshness states).
- **It is not** a second implementation of the AQI logic, a database, or a public service. It serves no public requests: its small API (`/healthz`, `/status`) listens on localhost only.
- **It fails honestly.** If the relay goes down, the card switches to OBOS's own OpenAQ reading once the relayed feed is over 2 h old (founder decision, 29 Sep 2026), exactly as it does when CPCB itself is unreachable.

## 3. Architecture

```
 CPCB feed ──(ordinary connection)──► RELAY: obos-india on the Pi (India, always on)
                                        │ every 15 min: fetch → shape check → gzip → sign (HMAC)
                                        ▼
                    POST /api/air-quality-ingest (Vercel)   verify signature and clock (±300 s),
                                        │                   cap 1 MB / 2 MB, parseFeed, ≥ 300 stations
                                        ▼
                               Vercel Blob (private)
                                 cpcb/latest.xml.gz
                                 cpcb/archive/YYYY/MM/DD/HH.xml.gz   (IST hour of lastupdate, written once)
                                        ▲
                                        │ read (server-side; the token never leaves Vercel)
 Visitor ──► /api/air-quality (bom1) ───┘  readRelayFeed → parseFeed → pick → currentFromFeed   (unchanged after the read)
                     └── OpenAQ for 30-day history + fallback                                 (unchanged)
```

**Push, not pull.** The relay makes only *outbound* HTTPS requests: to CPCB, then to OBOS's ingest endpoint. So it works behind any home or office router, needs no open ports and no fixed IP, and exposes nothing to the internet.

**The Pi never writes storage (design D2).** It holds one secret, `RELAY_HMAC_KEY`, which can do nothing but submit a feed. OBOS verifies the signature, then judges the feed with its own audited parser, and only then writes private Vercel Blob. The Blob token never leaves Vercel. Why: a Pi holding a Blob read-write token (v0.2) could, if stolen, overwrite `latest` with anything and delete the archive; with the key it can only submit something that already passes OBOS's parser, and archive files are write-once (register AQI-R49).

**Why Vercel Blob.**
- It is Vercel-native and one click to connect.
- It is readable from the function without another vendor.
- It keeps each hourly file, which becomes the raw archive for the planned PostgreSQL history (§8).

Alternatives considered:
- **GitHub Gist or repo commits:** public, and they trigger deploys. Rejected.
- **The relay writing Blob directly** (v0.2): puts a storage credential on a device in an office. Replaced by the signed ingest endpoint.

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

## 5. Relay behaviour (the Go service `obos-india`)

One static Go binary (standard library only, `linux/arm64`), built on the Mac and copied to the Pi; the Pi needs no toolchain. systemd runs `obos-india serve` (`Type=notify`, watchdog, restart always). Code: `pi/`; runbook: `pi/deploy/README.md`.

1. **Schedule.** An internal ticker, every 15 minutes (`RELAY_INTERVAL`, minimum 5 min). CPCB updates hourly and appears within about 10 minutes of the IST hour (AQI-R47), so OBOS sees each update at most about 25 minutes late, well inside the 2 h "Live" rule. The first run waits (up to 10 min) for a synchronised clock: a Pi has no clock battery.
2. **Fetch** `https://airquality.cpcb.gov.in/caaqms/rss_feed` with a 30 s timeout, a 2 MB cap enforced while reading, and the User-Agent `delta-climate-research-relay/<version> (+https://deltaclimate.earth)`.
3. **Shape check before submitting** (`cpcb.Check`). Cheap and dumb on purpose; the real validation happens in OBOS:
   - HTTP 200;
   - at most 2 MB;
   - contains `<AqIndex` and ends with `</AqIndex>` (not truncated);
   - at least 300 `<Station ` elements;
   - exactly one distinct `lastupdate`, a real IST date and time.
4. **Submit only when `lastupdate` changed** since the last *submitted* feed. The body is the feed's XML, gzipped (about 43 KB), signed and POSTed to `/api/air-quality-ingest` with a 30 s timeout (the contract is in §6). A 4xx is `rejected`; a 5xx or network failure is `submit_failed` and is retried at the next tick, never in a loop.
5. **State in memory only.** After a restart the relay submits the current feed once; OBOS answers `duplicate`. This suits the read-only overlay.
6. **Heartbeat.** After every run, a ping to `HEALTHCHECK_URL` (healthchecks.io): success to the URL, failure to URL + `/fail`. One log line per run to journald; no secret is ever logged. `GET http://127.0.0.1:8787/status` shows the relay state and the Pi's temperature, free disk, clock sync and uptime.
7. **`obos-india doctor`** prints ✅/❌ for: config, clock sync, CPCB reachable, OBOS reachable with the key accepted (a signed `ping`), disk ≥ 20% free, CPU < 75 °C, service active.

## 6. OBOS changes

The whole card, parser and state machine already existed (PR #34). The relay adds one endpoint and one source.

1. **The signed ingest endpoint** `POST /api/air-quality-ingest` (`api/air-quality-ingest.ts`):
   ```
   X-OBOS-Kind:      cpcb-feed | ping
   X-OBOS-Timestamp: <unix seconds>
   X-OBOS-Signature: v1=<hex HMAC-SHA256(RELAY_HMAC_KEY, "<timestamp>.<hex SHA-256(body)>")>
   body:             gzip(CPCB XML, unchanged)   (empty for ping)
   ```
   - 503 when `RELAY_HMAC_KEY` is unset or not 32+ bytes of hex (closed by default); 401 for a missing or wrong signature or a clock more than 300 s off; 413 above 1 MB, or above 2 MB inflated; 422 when `parseFeed` refuses it, it has fewer than 300 stations or more than one `lastupdate`, or it is more than 15 min ahead or 7 days old.
   - A valid `ping` is 204 and stores nothing (the doctor's end-to-end key check).
   - Otherwise the archive file is written if absent (`duplicate` if present, and `latest` is left alone), then `latest`: `200 {"stored":"new"|"duplicate","lastupdate","stations"}`.
   - The Go and TypeScript signers are proven identical by `tests/fixtures/pi/hmac-vectors.json`, generated independently by Python.
2. **The source switch.** `AIR_CPCB_SOURCE=relay` (exactly) makes `feedFor` call `readRelayFeed`: `getLatest` from private Blob (uncached, 8 s), gunzip under the same 2 MB cap, `parseFeed`. Anything else is `direct` (CPCB itself, for development). `AIR_CPCB_FEED=on` stays the master switch. Everything after the read (`pick`, `currentFromFeed`, the caches, the negative cache, the fallback) is untouched.
3. **Freshness** comes only from the feed's own `lastupdate`. A relayed feed over 2 h old counts as a failure, so the card switches to OBOS's own OpenAQ reading once the relayed feed is over 2 h old. No new UI.
4. **Tests,** test-first with mutation proofs: every ingest rejection path, duplicate versus new, the caps, the shared vectors, the relay source's read and fallbacks, and `feedSource` exact-match.
5. **Pre-flight probe (mandatory, per AQI-R48).** Before production, a Preview with a Blob store, `RELAY_HMAC_KEY`, `AIR_CPCB_SOURCE=relay` and `AIR_CPCB_FEED=on` must show Ballygunge live from CPCB, verified with `vercel curl`. Run the relay's own fetch on the relay machine and confirm 200 and 480+ stations; never assume reachability from a development Mac.

## 7. Operations

- **Secrets.**
  - The relay holds only `RELAY_HMAC_KEY` (32+ random bytes, hex), in `/etc/obos-india/env` (0640 root:obos). Vercel holds the same key (Production and Preview) and the Blob token, which never leaves Vercel.
  - Neither goes in the repo or in logs. The healthchecks.io URL is treated as a secret too.
  - Rotate the key if the device is lost: `pi/deploy/README.md` §5 (about 2 minutes; a Vercel env change needs a redeploy).
- **Tampering.** Someone with the key could submit a fake feed. Mitigations:
  - OBOS parses every submission before storing it: at least 300 stations, one `lastupdate`, not in the future, not older than 7 days.
  - OBOS still applies every guard when serving: the AQI must equal the largest sub-index, values must be ≤ 500, the station must be the exact name within 100 m, and the date must be possible.
  - Archive files are write-once, so an hour already stored cannot be replaced, and the archive makes any tampering auditable.
- **Monitoring.** The relay pings **healthchecks.io** after every run (success, or `/fail`); a missed ping for more than 2 h emails the team. On the Pi, `GET http://127.0.0.1:8787/status` and `obos-india doctor` show the rest.
- **Power and network.** A small UPS on the Pi. The Pi reboots straight into the service. An outage only hands the card over to OpenAQ; it never shows a wrong number.
- **Redundancy (optional).** A second relay at another site, with its own key or the same one. Both submit; OBOS stores each IST hour once and answers the second `duplicate`, so the two are harmless together.
- **Updates.** The service is versioned in the repo (`pi/`). Build a new binary on the Mac (`make -C pi build`), copy it over Tailscale, and re-run `sudo bash setup.sh ./obos-india`, which keeps the existing settings.

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

Superseded for steps 2 and 3 by the step plan [`docs/superpowers/plans/2026-09-29-pi-india-service.md`](../superpowers/plans/2026-09-29-pi-india-service.md) (the Go service replaces `relay/cpcb-relay.ts`; the signed ingest replaces direct Blob uploads). The outline stays as the order of work.

1. **Pre-flight (no code).**
   - Buy and set up the Pi ([02-hardware-and-os.md](./02-hardware-and-os.md)); set up remote access ([03-remote-access.md](./03-remote-access.md)).
   - Run the fetch on it: expect 200 and 480+ stations.
   - Connect a Vercel Blob store; issue the tokens.
2. **Relay script** in `relay/cpcb-relay.ts`: fetch, sanity check, change detection, gzip upload of `latest` + `archive`, heartbeat. Unit tests with fake fetch and fake Blob. Timer units for systemd and launchd in `relay/`.
3. **Source switch** in OBOS: `AIR_CPCB_SOURCE` and the Blob reader in `cpcb-feed.ts`, with tests and mutation proofs.
4. **Trial run.** Run the relay on the founder's Mac for 24 h, then point a Preview at it with `AIR_CPCB_FEED=on` and `AIR_CPCB_SOURCE=relay`. Verify Ballygunge is live from CPCB on the Preview, through `vercel curl`.
5. **Production relay.** Install on the Pi. Set up the healthchecks.io ping. Let it run 48 h, then check `/status` (`curl -s http://127.0.0.1:8787/status`) and the archive for hourly files with no gaps.
6. **Switch on.** Set `AIR_CPCB_FEED=on` and `AIR_CPCB_SOURCE=relay` for Production. Verify on deltaclimate.earth. Rollback is unsetting `AIR_CPCB_FEED`.
7. **Docs.** Add register rows for the relay evidence; update this folder's README and `docs/AQI/README.md` "Current state".

## 11. Decisions for the founder (when work starts)

| # | Question | Default proposed |
|---|---|---|
| 1 | Relay device and where it lives | **Decided 2026-09-28: Raspberry Pi on Raspberry Pi OS Lite.** Location still open (office proposed) |
| 2 | Keep the hourly archive? | Yes: it seeds the PostgreSQL history |
| 3 | Alerting channel | healthchecks.io email to the team |
| 4 | Second relay for redundancy? | Not at first |
| 5 | Sign uploads (HMAC)? | **Decided 2026-09-29: yes.** The Pi submits signed feeds to OBOS and never holds a storage credential (spec D2, register AQI-R49) |
| 6 | Remote access from the Mac | **Decided 2026-09-28: VS Code Remote-SSH over Tailscale**, with Raspberry Pi Connect as the browser backup ([03-remote-access.md](./03-remote-access.md)) |

## 12. References

- Spec: `docs/superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md` (§10 rollout, §11 dormant release)
- Register: `docs/AQI/05-research-register.md`, AQI-R41, R47, R47a, R48
- Code: `src/lib/aqi/cpcb-feed.ts`, `api/air-quality.ts` (`feedEnabled`, `feedFor`)
- Evidence snapshots: `~/.cache/delta-climate/cpcb-rss/` (the 6 h cadence recording)
