# OBOS India service on a Raspberry Pi 4: CPCB relay, local API, setup kit

**Date:** 29 September 2026 · **Status:** design approved by the founder in conversation (29 Sep 2026)
**Context:** `docs/raspberry-pi-relay/` (plan, hardware/OS, remote access, readiness checklist); register AQI-R47/R47a/R48; PR #34 (dormant CPCB feed code).
**Founder direction:** the Pi code is **Go**. It must be clean and simple, with typed structs used well, and it must be first-class.

## 1. Goal

A Raspberry Pi 4 on an ordinary Indian connection runs one Go program, `obos-india`. The program relays CPCB's live feed to OBOS, which cloud servers cannot reach (AQI-R48), and exposes a small local API that future India-specific jobs plug into. OBOS gains a signed ingest endpoint and a `relay` feed source. Once `AIR_CPCB_SOURCE=relay` and `AIR_CPCB_FEED=on` are set, the Kolkata cards show CPCB's published AQI in production.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Go, standard library only.** One module at `pi/`, separate from the heat-map `go/` module. Build with `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`. No third-party modules. |
| D2 | **The Pi submits to OBOS; it never writes storage directly.** It holds only an HMAC key, which can do nothing except submit feeds. OBOS validates every submission with its audited parser before storing anything. The Vercel Blob token never leaves Vercel. |
| D3 | **One long-running service, `obos-india serve`.** It runs an internal scheduler (the relay every 15 min) and a small HTTP API bound to localhost and the tailnet. systemd supervises it: restart on failure, plus a watchdog via `sd_notify`. |
| D4 | **Storage is Vercel Blob, private.** `cpcb/latest.xml.gz` is overwritten on each new hour. `cpcb/archive/YYYY/MM/DD/HH.xml.gz` is keyed by the feed's IST `lastupdate` and written only if absent. |
| D5 | **The signing contract is identical in Go and TypeScript**, proven by one shared test vector file used by both test suites. |
| D6 | **Setup is one idempotent script**, `pi/deploy/setup.sh`. The binary is built on the Mac and copied over, so the Pi needs no Go toolchain. |

## 3. The signing contract (Pi → OBOS)

```
POST https://deltaclimate.earth/api/air-quality-ingest
Content-Type:       application/octet-stream
X-OBOS-Kind:        cpcb-feed
X-OBOS-Timestamp:   <unix seconds, decimal>
X-OBOS-Signature:   v1=<lowercase hex HMAC-SHA256(key, "<timestamp>.<lowercase hex SHA-256(body)>")>
body:               gzip(CPCB feed XML bytes, unchanged)
```

- **Key:** `RELAY_HMAC_KEY`, 32 or more random bytes, hex-encoded. It is set in Vercel (Production and Preview) and in `/etc/obos-india/env` on the Pi.
- **OBOS rejects the request (401, no detail) if:**
  - the signature is missing or malformed;
  - the signature does not match (checked with a constant-time comparison);
  - the timestamp is more than **300 s** from the server clock;
  - `RELAY_HMAC_KEY` is unset (the endpoint then answers **503**, so it is closed by default).
- **Shared vectors:** `tests/fixtures/pi/hmac-vectors.json` holds `{ key_hex, timestamp, body_hex, expected_signature }` entries. The Go tests and the TypeScript tests both assert every entry.

## 4. OBOS: the ingest endpoint (`api/air-quality-ingest.ts`)

- It is a **fetch-style handler**, `export async function POST(request: Request): Promise<Response>`, with the testable core `handleIngest(request, deps)`. Deps: `{ key, store, now }`. Every other method gets **405**.
- **Order of checks** (cheapest first; nothing is stored until all pass):
  1. Method is POST and `X-OBOS-Kind` is `cpcb-feed` or `ping`; otherwise 400.
  2. Key configured; otherwise 503. Timestamp fresh and signature valid; otherwise 401. The signature covers the body exactly as sent; for `ping` the body is empty.
     - A valid `ping` stops here with **204** and stores nothing. It is the doctor's end-to-end key check.
  3. Compressed body ≤ **1 MB**. Gunzip with `maxOutputLength` **2 MB** (the same cap as `FEED_MAX_BYTES`); otherwise 413 or 400.
  4. `parseFeed(xml)` succeeds. It must yield **≥ 300 stations**, and all stations must share **one** `published_at`. That time must be no more than 15 min in the future and no more than 7 days old. Otherwise 422, with a short machine reason such as `too_few_stations`.
- **Storing:**
  1. `putArchive(key, gz)` stores the file only if absent.
     - If it already exists, the answer is `200 {"stored":"duplicate", …}` and `latest` is **not** rewritten.
     - If it is new, `putLatest(gz)` follows.
  2. The answer is `200 {"stored":"new","lastupdate":"<ISO>","stations":<n>}`.
- **Logging:** only the outcome and machine reason. Never the key, the signature or the body.
- **Caching:** `Cache-Control: no-store` on every response.

## 5. OBOS: the relay source

- **`src/lib/aqi/relay-store.ts`**
  - An interface `FeedStore { getLatest(): Promise<Uint8Array | null>; putLatest(gz: Uint8Array): Promise<void>; putArchive(path: string, gz: Uint8Array): Promise<'stored' | 'exists'> }`.
  - `blobStore()` implements it with `@vercel/blob` (`put`/`get`, `access: 'private'`, `addRandomSuffix: false`; `latest` with `allowOverwrite: true`; the archive without it, where the "already exists" error maps to `'exists'`).
  - `memoryStore()` implements it for tests.
- **`cpcb-feed.ts`** gains `readRelayFeed(store)`: `getLatest`, gunzip with the 2 MB cap, then `parseFeed`. Every failure is a `FeedError`.
- **`api/air-quality.ts`**
  - `feedSource(env)` returns `'relay'` only for exactly `AIR_CPCB_SOURCE === 'relay'`; otherwise `'direct'`.
  - `feedFor` calls `readRelayFeed(store)` or `fetchFeed()` accordingly. The caching, negative cache, fallback and labels are all unchanged.
  - `AIR_CPCB_FEED=on` stays the master switch.
- **Freshness** comes only from the feed's own `lastupdate`, which is the existing logic. A dead relay therefore ages the card honestly.

## 6. The Pi program (`pi/`)

```
pi/
  go.mod                         module deltaclimate.earth/obos-india, go 1.26, no requires
  Makefile                       build (linux/arm64), test, vet, fmt-check
  cmd/obos-india/main.go         subcommands: serve | relay-once | doctor | version
  internal/config/config.go      type Config; Load(env map) (Config, error), validates everything
  internal/cpcb/feed.go          type Snapshot; type Fetcher; (Fetcher) Fetch(ctx) (Snapshot, error); Check(body) (Meta, error)
  internal/ingest/client.go      type Client; (Client) Submit(ctx, Snapshot) (Result, error); Sign(key, ts, body) string
  internal/relay/job.go          type Job; type State; (Job) RunOnce(ctx) Outcome; skips an unchanged lastupdate
  internal/health/system.go      type System; Read() System: CPU temp, disk free, clock sync, uptime (Linux paths injectable)
  internal/server/server.go      type Server; routes GET /healthz, GET /status (JSON: State + System + version)
  internal/doctor/doctor.go      type Check; type Report; Run(ctx, cfg) Report; prints ✅/❌ lines, non-zero exit if any fail
  internal/sdnotify/notify.go    READY=1, WATCHDOG=1 over NOTIFY_SOCKET (unixgram); a no-op when unset
  deploy/obos-india.service      systemd unit (Type=notify, WatchdogSec=120, Restart=always, hardening)
  deploy/setup.sh                idempotent installer (bash, set -euo pipefail)
  deploy/README.md               how to build, copy, install, rotate the key, uninstall
```

**Core types:** plain structs, exported fields, zero values meaningful.

```go
type Config struct {
    IngestURL     string        // OBOS_INGEST_URL, default https://deltaclimate.earth/api/air-quality-ingest
    HMACKey       []byte        // RELAY_HMAC_KEY (hex), required, ≥32 bytes
    FeedURL       string        // CPCB_FEED_URL, default CPCB's rss_feed
    Interval      time.Duration // RELAY_INTERVAL, default 15m, min 5m
    HealthcheckURL string       // HEALTHCHECK_URL, optional (healthchecks.io ping)
    ListenAddr    string        // LISTEN_ADDR, default 127.0.0.1:8787
    UserAgent     string        // fixed: delta-climate-research-relay/<version> (+https://deltaclimate.earth)
}

type Meta struct {         // what Check learns from a feed without trusting it further
    LastUpdate time.Time    // the single, feed-wide lastupdate (IST parsed to UTC)
    Stations   int
}

type Snapshot struct {
    Body      []byte        // raw XML, unchanged
    Meta      Meta
    FetchedAt time.Time
}

type State struct {         // exposed by /status; guarded by a mutex inside Job
    LastRun       time.Time
    LastOK        time.Time
    LastUpdate    time.Time  // CPCB's, of the last submitted feed
    LastOutcome   string     // "submitted" | "unchanged" | "fetch_failed" | "rejected" | "submit_failed"
    LastError     string     // short, no secrets
    Submitted     int        // counters since start
    Failures      int
}
```

- **Relay rules:**
  - Fetch with a 30 s timeout and a 2 MB cap.
  - `Check` requires `<AqIndex`, ≥ 300 `<Station `, and exactly one distinct `lastupdate`, parsed as IST.
  - Skip if `Meta.LastUpdate` equals the last *submitted* one.
  - Submit with a 30 s timeout. A 5xx or network failure is retried at the next tick, never in a tight loop.
  - Ping `HEALTHCHECK_URL` after every run: success → `/`, failure → `/fail`.
  - State lives in memory. After a restart the relay re-submits the current feed once, which is idempotent at OBOS.
- **Clock:** the first run waits (up to 10 min) until the clock is synchronised: `/run/systemd/timesync/synchronized` exists. A Pi has no clock battery.
- **Server:** `GET /healthz` returns `200 ok`. `GET /status` returns JSON. Future India APIs register under `/v1/...` behind a bearer-token middleware (`API_TOKEN`); none exist yet. Graceful shutdown on SIGTERM.
- **Doctor checks:**
  1. config valid;
  2. clock synced;
  3. CPCB reachable, with a real fetch and `Check`;
  4. OBOS ingest reachable and the key accepted (a signed request with `X-OBOS-Kind: ping`, which OBOS answers with 204 after verifying the signature, storing nothing);
  5. disk ≥ 20% free;
  6. temperature < 75 °C;
  7. the service active (`systemctl is-active`, skipped off-Pi).
- **Logging:** `log/slog` as text to stdout (journald), one line per run. No secrets are ever logged.

## 7. Setup kit (`pi/deploy/setup.sh`)

The script is idempotent, runs as root, and each step prints what it did:
1. Create the system user `obos` (no login) and the directories `/etc/obos-india` (0750) and `/usr/local/bin`.
2. Install the binary passed as `$1` (default `./obos-india`) with mode 0755. Verify it with `obos-india version`.
3. Write `/etc/obos-india/env` (0640, root:obos), prompting only for values that are missing: `RELAY_HMAC_KEY` (input hidden) and `HEALTHCHECK_URL`. Existing values are kept.
4. Install and enable `obos-india.service`, and enable `systemd-time-wait-sync`.
5. Hardware watchdog: add `dtparam=watchdog=on` to `/boot/firmware/config.txt` and set `RuntimeWatchdogSec=15` in `/etc/systemd/system.conf`, each once.
6. `unattended-upgrades` installed and enabled; a weekly reboot timer (Sunday 03:37 IST).
7. Restart the service, then run `obos-india doctor`.
8. Offer the read-only overlay last (`raspi-config nonint enable_overlayfs`). The default answer is **No** on the first install, so the rehearsal stays editable.

## 8. Testing

- **Go:**
  - table tests for `Config.Load`, `Check` (the real fixture passes; truncated, oversize, no-AqIndex, too few stations and mixed-lastupdate inputs fail), `Sign` (the shared vectors), `Job.RunOnce` (fake CPCB and OBOS through `httptest`: submitted, unchanged, fetch_failed, rejected, submit_failed), the health readers (fake `/sys`, `/run` paths), the server routes and the doctor report;
  - `go vet`, `gofmt -l` empty, `go test -race ./...`.
- **TypeScript:**
  - ingest: every rejection path;
  - duplicate versus new;
  - the shared vectors;
  - the body and gunzip caps;
  - the 300-station and single-`lastupdate` rules;
  - relay source: reads, parses, and a missing/corrupt/oversize blob gives `FeedError` and then the fallback;
  - `feedSource` is exact-match.
- **Proof that the tests bite:** every rule gets a mutation proof, red then reverted, recorded in the commit bodies.
- **Contract:** the Go and TypeScript suites both run `tests/fixtures/pi/hmac-vectors.json`.
- **Rehearsal:**
  1. A UTM Debian arm64 VM on the Mac runs `setup.sh` and `serve` against a Preview's ingest endpoint.
  2. The Preview with `AIR_CPCB_SOURCE=relay` and `AIR_CPCB_FEED=on` shows Ballygunge live from CPCB, verified with `vercel curl`.
  3. Drills: kill the process (it restarts), pull the network (the card ages, then recovers), rotate the key (401 until both sides match).
- **Gates:** `npm run check`, `typecheck`, `test:py`, `test:unit` and `build`, a real `vercel build`, `make -C pi test vet build`, and an independent audit before merge.

## 9. Out of scope (now)

- Public India APIs and a Cloudflare Tunnel (only the extension point is built).
- A second relay.
- HMAC per-station signing.
- The PostgreSQL history. The hourly archive is its future input.
- data.gov.in.
