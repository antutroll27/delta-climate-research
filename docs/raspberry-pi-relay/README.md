# Raspberry Pi relay

**Status (28 September 2026):** Planned, not built. The founder decided to build it later.
**Why it exists:** CPCB's live air-quality feed blocks cloud servers, including Vercel, where deltaclimate.earth runs. OpenAQ's Indian data froze on 24 Sep, and data.gov.in's CPCB dataset was failing on 28 Sep. A small always-on Raspberry Pi on an ordinary Indian connection can fetch CPCB's feed and hand it to OBOS. That is the only route that works today, and it gives CPCB's exact published numbers.

## Documents

| Document | For | What it covers |
|---|---|---|
| [01-relay-plan.md](./01-relay-plan.md) | Founders, engineering | Why a relay; the architecture (Pi → Vercel Blob → `/api/air-quality`); relay behaviour; OBOS changes; operations; archive; implementation outline; open decisions |
| [02-hardware-and-os.md](./02-hardware-and-os.md) | Whoever sets up the Pi | Shopping list (about ₹8–15k); Raspberry Pi OS Lite set-up; first-boot checklist, including the CPCB reachability check |
| [03-remote-access.md](./03-remote-access.md) | Anyone who maintains the Pi | Using the Pi from a Mac: VS Code Remote-SSH over Tailscale (free), Raspberry Pi Connect as backup, and rehearsing in a UTM VM |
| [04-readiness-checklist.md](./04-readiness-checklist.md) | Founder, engineering | Everything that must be ready so Pi day is: flash, plug in, one command, ✅. Covers software, accounts, hardware (incl. the forgotten items), self-care, failure drills, paperwork, and the Pi-day sequence |

## Decisions so far

| Decision | Choice | Date |
|---|---|---|
| Route for live CPCB data | Relay in India (data.gov.in retried later) | 28 Sep 2026 |
| Device | **Raspberry Pi 4 Model B** (4 GB; 8 GB if it also runs other India jobs) | 29 Sep 2026 |
| Operating system | Raspberry Pi OS Lite (64-bit), read-only overlay | 28 Sep 2026 |
| Remote access | VS Code Remote-SSH over Tailscale; Raspberry Pi Connect backup | 28 Sep 2026 |
| Still open | Where the Pi lives; keep the hourly archive; alert channel; second relay; signed uploads | See [01-relay-plan.md](./01-relay-plan.md) §11 |

## Related

- The live air-quality feature and its evidence: [`docs/AQI/`](../AQI/README.md), in particular register rows AQI-R47, R47a and R48.
- The dormant CPCB code the relay switches on (PR #34): `src/lib/aqi/cpcb-feed.ts`, `api/air-quality.ts` (`AIR_CPCB_FEED`).
- Design spec: [`docs/superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md`](../superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md) (§10, §11).
