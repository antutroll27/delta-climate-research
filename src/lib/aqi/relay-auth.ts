/**
 * THE PI → OBOS SIGNING CONTRACT, verifier side (spec 2026-09-29 §3).
 *
 *   X-OBOS-Timestamp: <unix seconds>
 *   X-OBOS-Signature: v1=<hex HMAC-SHA256(key, "<timestamp>.<hex SHA-256(body)>")>
 *
 * The Go signer is pi/internal/ingest/sign.go. Both suites assert
 * tests/fixtures/pi/hmac-vectors.json, generated independently by Python.
 *
 * The comparison is constant-time over the 32 raw MAC bytes. A key that is not
 * at least 32 bytes of hex is "no key": Buffer.from('zz', 'hex') is an EMPTY
 * buffer, and an HMAC under an empty key is one anybody can forge.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** How far the request's timestamp may be from the server clock, seconds. */
export const MAX_SKEW_S = 300;

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'no_key' | 'no_signature' | 'bad_timestamp' | 'skew' | 'mismatch' };

const KEY_HEX = /^(?:[0-9a-fA-F]{2}){32,}$/;
const TS = /^\d{1,12}$/;
const SIG = /^v1=([0-9a-f]{64})$/;

/** True when keyHex is a usable key: hex, at least 32 bytes. */
export const validKey = (keyHex: string): boolean => KEY_HEX.test(keyHex);

function mac(keyHex: string, ts: number, body: Uint8Array): Buffer {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`${ts}.${digest}`).digest();
}

/** The X-OBOS-Signature value for body at unix time ts. */
export function signV1(keyHex: string, ts: number, body: Uint8Array): string {
  return `v1=${mac(keyHex, ts, body).toString('hex')}`;
}

export type Signed = { ok: true; ts: number; given: Buffer } | { ok: false; reason: 'no_signature' | 'bad_timestamp' | 'skew' };

/**
 * The signature headers, parsed, with the timestamp checked against `now`. Needs no
 * body, so a caller can refuse a stale or unsigned request before reading one.
 */
export function readSigned(headers: Headers, now: Date): Signed {
  const tsRaw = headers.get('x-obos-timestamp') ?? '';
  const sig = SIG.exec(headers.get('x-obos-signature') ?? '');
  if (!sig) return { ok: false, reason: 'no_signature' };
  if (!TS.test(tsRaw)) return { ok: false, reason: 'bad_timestamp' };
  const ts = Number(tsRaw);
  if (Math.abs(now.getTime() / 1000 - ts) > MAX_SKEW_S) return { ok: false, reason: 'skew' };
  return { ok: true, ts, given: Buffer.from(sig[1]!, 'hex') };
}

/** Verifies a request's key, timestamp and signature over body, exactly as received. */
export function verifyV1(keyHex: string, headers: Headers, body: Uint8Array, now: Date): Verdict {
  if (!validKey(keyHex)) return { ok: false, reason: 'no_key' };
  const s = readSigned(headers, now);
  if (!s.ok) return s;
  return timingSafeEqual(s.given, mac(keyHex, s.ts, body)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
