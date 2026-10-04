// Package ingest submits CPCB feeds to OBOS's signed ingest endpoint.
//
// The signing contract (spec 2026-09-29 §3) is shared with the TypeScript verifier
// in src/lib/aqi/relay-auth.ts; tests/fixtures/pi/hmac-vectors.json proves both agree.
package ingest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
)

// Sign returns the X-OBOS-Signature header value for body sent at unix time ts:
//
//	v1=<hex HMAC-SHA256(key, "<ts>.<hex SHA-256(body)>")>
//
// body is exactly the bytes sent on the wire (the gzip, not the XML).
func Sign(key []byte, ts int64, body []byte) string {
	digest := sha256.Sum256(body)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(strconv.FormatInt(ts, 10) + "." + hex.EncodeToString(digest[:])))
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}
