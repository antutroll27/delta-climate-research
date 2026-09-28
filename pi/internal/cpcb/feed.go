// Package cpcb fetches CPCB's CAAQMS feed and checks that it is one.
//
// The check is deliberately shallow: the Pi is a courier. OBOS parses and judges
// every feed with its audited parser (src/lib/aqi/cpcb-feed.ts) before storing it.
// Check only stops the Pi from submitting something that is plainly not a feed.
package cpcb

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Limits, shared in meaning with OBOS (FEED_MAX_BYTES) and spec 2026-09-29 §6.
const (
	MaxBytes       = 2_000_000
	MinStations    = 300
	DefaultTimeout = 30 * time.Second
	// lastupdateLayout is CPCB's "27-09-2026 05:00:00", in IST.
	lastupdateLayout = "02-01-2006 15:04:05"
	istOffsetSeconds = 5*3600 + 1800
)

// Check failures. Every error Check or Fetch returns wraps one of these.
var (
	ErrTooLarge        = errors.New("cpcb: feed larger than 2 MB")
	ErrNotFeed         = errors.New("cpcb: not a CPCB AQI feed")
	ErrTruncated       = errors.New("cpcb: feed truncated")
	ErrTooFewStations  = errors.New("cpcb: too few stations")
	ErrMixedLastUpdate = errors.New("cpcb: lastupdate not unique")
	ErrBadLastUpdate   = errors.New("cpcb: bad lastupdate")
	ErrStatus          = errors.New("cpcb: unexpected HTTP status")
)

// Meta is what Check learns from a feed without trusting it further.
type Meta struct {
	LastUpdate time.Time // the single, feed-wide lastupdate, IST parsed to UTC
	Stations   int       // count of "<Station " openings
}

// Snapshot is one fetched, checked feed.
type Snapshot struct {
	Body      []byte // raw XML, unchanged
	Meta      Meta
	FetchedAt time.Time
}

// Check verifies that body looks like a whole CPCB feed: at most MaxBytes, an
// <AqIndex> root that is closed, at least MinStations stations, and exactly one
// distinct lastupdate, which must be a real IST date and time. One forward pass.
func Check(body []byte) (Meta, error) {
	if len(body) > MaxBytes {
		return Meta{}, ErrTooLarge
	}
	if !bytes.Contains(body, []byte("<AqIndex")) {
		return Meta{}, ErrNotFeed
	}
	if !bytes.HasSuffix(bytes.TrimSpace(body), []byte("</AqIndex>")) {
		return Meta{}, ErrTruncated
	}
	n := bytes.Count(body, []byte("<Station "))
	if n < MinStations {
		return Meta{}, fmt.Errorf("%w: %d, need %d", ErrTooFewStations, n, MinStations)
	}
	stamp, err := uniqueLastUpdate(body)
	if err != nil {
		return Meta{}, err
	}
	t, err := time.ParseInLocation(lastupdateLayout, stamp, time.FixedZone("IST", istOffsetSeconds))
	if err != nil {
		return Meta{}, fmt.Errorf("%w: %q", ErrBadLastUpdate, stamp)
	}
	return Meta{LastUpdate: t.UTC(), Stations: n}, nil
}

// uniqueLastUpdate returns the one lastupdate="…" value in body, scanning forward
// once; a second, different value is ErrMixedLastUpdate.
func uniqueLastUpdate(body []byte) (string, error) {
	const attr = `lastupdate="`
	var first []byte
	for rest := body; ; {
		i := bytes.Index(rest, []byte(attr))
		if i < 0 {
			break
		}
		rest = rest[i+len(attr):]
		j := bytes.IndexByte(rest, '"')
		if j < 0 {
			return "", fmt.Errorf("%w: unterminated attribute", ErrBadLastUpdate)
		}
		v := rest[:j]
		rest = rest[j+1:]
		if first == nil {
			first = v
		} else if !bytes.Equal(v, first) {
			return "", ErrMixedLastUpdate
		}
	}
	if first == nil {
		return "", fmt.Errorf("%w: none found", ErrBadLastUpdate)
	}
	return string(first), nil
}

// HTTPClient is the one method of *http.Client that Fetcher uses.
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Fetcher fetches and checks CPCB's feed. The zero value of each optional field
// means the production default.
type Fetcher struct {
	URL       string           // required
	UserAgent string           // required
	Client    HTTPClient       // nil: http.DefaultClient
	Timeout   time.Duration    // zero: DefaultTimeout
	Clock     func() time.Time // nil: time.Now
}

// Fetch makes one GET, reads at most MaxBytes (the cap is enforced while reading),
// and returns the checked Snapshot.
func (f Fetcher) Fetch(ctx context.Context) (Snapshot, error) {
	timeout := f.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URL, nil)
	if err != nil {
		return Snapshot{}, fmt.Errorf("cpcb: request: %w", err)
	}
	req.Header.Set("User-Agent", f.UserAgent)
	req.Header.Set("Accept", "application/xml")

	client := f.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return Snapshot{}, fmt.Errorf("cpcb: fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Snapshot{}, fmt.Errorf("%w: %d", ErrStatus, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxBytes+1))
	if err != nil {
		return Snapshot{}, fmt.Errorf("cpcb: read: %w", err)
	}
	meta, err := Check(body)
	if err != nil {
		return Snapshot{}, err
	}
	now := time.Now
	if f.Clock != nil {
		now = f.Clock
	}
	return Snapshot{Body: body, Meta: meta, FetchedAt: now().UTC()}, nil
}
