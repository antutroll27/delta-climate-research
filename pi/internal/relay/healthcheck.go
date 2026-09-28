package relay

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// DefaultPingTimeout bounds one healthcheck ping.
const DefaultPingTimeout = 10 * time.Second

// ErrPing is returned for any failed healthcheck ping. It never wraps the
// transport error, whose text would carry the ping URL: that URL is a credential.
var ErrPing = errors.New("relay: healthcheck ping failed")

// HTTPClient is the one method of *http.Client that Healthcheck uses.
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Healthcheck pings a healthchecks.io-style URL after every run: URL on success,
// URL+"/fail" on failure. An empty URL makes Ping a no-op.
type Healthcheck struct {
	URL     string        // optional; no trailing slash
	Client  HTTPClient    // nil: http.DefaultClient
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
	client := h.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return ErrPing
	}
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%w: HTTP %d", ErrPing, resp.StatusCode)
	}
	return nil
}
