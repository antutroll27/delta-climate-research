package relay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultPingTimeout bounds one healthcheck ping.
const DefaultPingTimeout = 10 * time.Second

// ErrPing is returned for any failed healthcheck ping. It never wraps the
// transport error, whose text would carry the ping URL: that URL is a credential.
var ErrPing = errors.New("relay: healthcheck ping failed")

// Healthcheck pings a healthchecks.io-style URL after every run: URL on success,
// URL+"/fail" on failure. An empty URL makes Ping a no-op.
type Healthcheck struct {
	URL     string        // optional; no trailing slash
	HTTP    *http.Client  // nil: http.DefaultClient
	Timeout time.Duration // zero: DefaultPingTimeout
}

// Ping reports one run. body is a short, secret-free summary shown in the dashboard.
func (h Healthcheck) Ping(ctx context.Context, ok bool, body string) error {
	if h.URL == "" {
		return nil
	}
	timeout := h.Timeout
	if timeout == 0 {
		timeout = DefaultPingTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	url := h.URL
	if !ok {
		url += "/fail"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return ErrPing
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	client := h.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return ErrPing
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 512)) // lets the connection be reused
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%w: HTTP %d", ErrPing, resp.StatusCode)
	}
	return nil
}
