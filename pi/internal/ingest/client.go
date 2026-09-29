package ingest

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"deltaclimate.earth/obos-india/internal/cpcb"
)

// DefaultTimeout bounds one submission, request and response together.
const DefaultTimeout = 30 * time.Second

// Kind is the X-OBOS-Kind header value.
type Kind string

// The two kinds OBOS accepts.
const (
	KindFeed Kind = "cpcb-feed"
	KindPing Kind = "ping"
)

// ErrRejected means OBOS answered 4xx: the submission itself is wrong (bad
// signature, stale clock, a feed its parser refused). Retrying the same feed will
// not help. ErrUnavailable means 5xx or no answer: retry at the next tick.
var (
	ErrRejected    = errors.New("ingest: rejected")
	ErrUnavailable = errors.New("ingest: unavailable")
)

// StatusError is an unexpected HTTP answer from OBOS. It unwraps to ErrRejected
// (4xx) or ErrUnavailable (anything else), so callers use errors.Is.
type StatusError struct {
	Code   int
	Reason string // OBOS's short machine reason, such as "too_few_stations"; may be empty
}

func (e *StatusError) Error() string {
	if e.Reason == "" {
		return fmt.Sprintf("ingest: HTTP %d", e.Code)
	}
	return fmt.Sprintf("ingest: HTTP %d %s", e.Code, e.Reason)
}

func (e *StatusError) Unwrap() error {
	if e.Code >= 400 && e.Code < 500 {
		return ErrRejected
	}
	return ErrUnavailable
}

// Result is OBOS's answer to an accepted feed.
type Result struct {
	Stored string `json:"stored"` // "new" or "duplicate"
}

// Client submits to OBOS's ingest endpoint. The zero value of each optional field
// means the production default. It never logs, and no error it returns contains
// the key or the signature.
type Client struct {
	URL       string           // required: the ingest endpoint
	Key       []byte           // required: the shared HMAC key
	UserAgent string           // required
	HTTP      *http.Client     // nil: http.DefaultClient; redirects are always refused
	Timeout   time.Duration    // zero: DefaultTimeout
	Clock     func() time.Time // nil: time.Now; supplies X-OBOS-Timestamp
}

// Submit gzips the snapshot's XML, signs the gzip and POSTs it.
func (c Client) Submit(ctx context.Context, snap cpcb.Snapshot) (Result, error) {
	var gz bytes.Buffer
	zw, err := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	if err != nil {
		return Result{}, fmt.Errorf("ingest: gzip: %w", err)
	}
	if _, err := zw.Write(snap.Body); err != nil {
		return Result{}, fmt.Errorf("ingest: gzip: %w", err)
	}
	if err := zw.Close(); err != nil {
		return Result{}, fmt.Errorf("ingest: gzip: %w", err)
	}

	resp, err := c.post(ctx, KindFeed, gz.Bytes())
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Result{}, statusError(resp)
	}
	var r Result
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&r); err != nil {
		return Result{}, fmt.Errorf("%w: unreadable answer: %w", ErrUnavailable, err)
	}
	return r, nil
}

// Ping sends a signed empty request of kind "ping". OBOS answers 204 after
// verifying the signature and stores nothing: the doctor's end-to-end key check.
func (c Client) Ping(ctx context.Context) error {
	resp, err := c.post(ctx, KindPing, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return statusError(resp)
	}
	return nil
}

func (c Client) post(ctx context.Context, kind Kind, body []byte) (*http.Response, error) {
	timeout := c.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	now := time.Now
	if c.Clock != nil {
		now = c.Clock
	}
	ts := now().Unix()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("ingest: request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("User-Agent", c.UserAgent)
	req.Header.Set("X-OBOS-Kind", string(kind))
	req.Header.Set("X-OBOS-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-OBOS-Signature", Sign(c.Key, ts, body))

	client := http.Client{}
	if c.HTTP != nil {
		client = *c.HTTP
	}
	// A redirect would turn the POST into a GET and carry the signature to
	// another URL: take the 3xx as the answer, which statusError makes ErrUnavailable.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	resp.Body = cancelOnClose{resp.Body, cancel}
	return resp, nil
}

// cancelOnClose releases the request's timeout once the caller has read the answer.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

func statusError(resp *http.Response) error {
	var body struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1024)).Decode(&body)
	reason := body.Error
	if len(reason) > 64 {
		reason = reason[:64]
	}
	return &StatusError{Code: resp.StatusCode, Reason: reason}
}
