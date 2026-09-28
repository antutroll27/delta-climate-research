package relay

import (
	"bytes"
	"context"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/ingest"
)

var testKey = bytes.Repeat([]byte{0x42}, 32)

// feedAt is a minimal valid feed (300 stations) stamped with IST time stamp.
func feedAt(stamp string) []byte {
	var b strings.Builder
	b.WriteString("<AqIndex><Country id=\"India\">\n")
	for range 300 {
		b.WriteString(`<Station id="S" lastupdate="` + stamp + `" latitude="22.5" longitude="88.3"></Station>` + "\n")
	}
	b.WriteString("</Country></AqIndex>\n")
	return []byte(b.String())
}

// world is a fake CPCB, a fake OBOS and a fake healthchecks.io, each an httptest server.
type world struct {
	mu        sync.Mutex
	feed      []byte // what CPCB serves; nil means 503
	obos      int    // OBOS's status code
	submits   int
	pings     []string // paths pinged
	cpcb, api *httptest.Server
	hc        *httptest.Server
	logs      bytes.Buffer
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{feed: feedAt("27-09-2026 05:00:00"), obos: 200}
	w.cpcb = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.mu.Lock()
		defer w.mu.Unlock()
		if w.feed == nil {
			rw.WriteHeader(503)
			return
		}
		rw.Write(w.feed)
	}))
	w.api = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.mu.Lock()
		defer w.mu.Unlock()
		w.submits++
		rw.WriteHeader(w.obos)
		switch {
		case w.obos == 200:
			io.WriteString(rw, `{"stored":"new","lastupdate":"2026-09-26T23:30:00.000Z","stations":300}`)
		case w.obos == 422:
			io.WriteString(rw, `{"error":"too_few_stations"}`)
		}
	}))
	w.hc = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.pings = append(w.pings, r.URL.Path)
	}))
	t.Cleanup(func() { w.cpcb.Close(); w.api.Close(); w.hc.Close() })
	return w
}

func (w *world) job() *Job {
	return &Job{
		Fetcher:     cpcb.Fetcher{URL: w.cpcb.URL, UserAgent: "relay/test"},
		Client:      ingest.Client{URL: w.api.URL, Key: testKey, UserAgent: "relay/test"},
		Healthcheck: Healthcheck{URL: w.hc.URL + "/uuid-secret"},
		Clock:       func() time.Time { return time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC) },
		Log:         slog.New(slog.NewTextHandler(&w.logs, nil)),
	}
}

func (w *world) set(f func(*world)) { w.mu.Lock(); f(w); w.mu.Unlock() }

func TestRunOnceOutcomes(t *testing.T) {
	cases := []struct {
		name     string
		setup    func(*world)
		want     Outcome
		submits  int
		pingPath string
	}{
		{"submitted", func(*world) {}, Submitted, 1, "/uuid-secret"},
		{"fetch_failed: CPCB 503", func(w *world) { w.feed = nil }, FetchFailed, 0, "/uuid-secret/fail"},
		{"fetch_failed: not a feed", func(w *world) { w.feed = []byte("<html>busy</html>") }, FetchFailed, 0, "/uuid-secret/fail"},
		{"rejected: OBOS 422", func(w *world) { w.obos = 422 }, Rejected, 1, "/uuid-secret/fail"},
		{"rejected: OBOS 401", func(w *world) { w.obos = 401 }, Rejected, 1, "/uuid-secret/fail"},
		{"submit_failed: OBOS 503", func(w *world) { w.obos = 503 }, SubmitFailed, 1, "/uuid-secret/fail"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newWorld(t)
			w.set(tc.setup)
			j := w.job()
			if got := j.RunOnce(context.Background()); got != tc.want {
				t.Fatalf("outcome = %s, want %s", got, tc.want)
			}
			if w.submits != tc.submits {
				t.Errorf("submits = %d, want %d", w.submits, tc.submits)
			}
			if len(w.pings) != 1 || w.pings[0] != tc.pingPath {
				t.Errorf("pings = %v, want [%s]", w.pings, tc.pingPath)
			}
			s := j.State()
			if s.LastOutcome != tc.want || s.LastRun.IsZero() {
				t.Errorf("state = %+v", s)
			}
			if tc.want.OK() != (s.LastError == "") || tc.want.OK() != (s.Failures == 0) {
				t.Errorf("error bookkeeping wrong: %+v", s)
			}
		})
	}
}

func TestRunOnceSkipsAnUnchangedFeedAndSubmitsTheNextHour(t *testing.T) {
	w := newWorld(t)
	j := w.job()
	if got := j.RunOnce(context.Background()); got != Submitted {
		t.Fatalf("first run = %s", got)
	}
	if got := j.RunOnce(context.Background()); got != Unchanged {
		t.Fatalf("second run = %s, want unchanged", got)
	}
	if w.submits != 1 {
		t.Errorf("an unchanged feed was submitted again: %d submits", w.submits)
	}
	w.set(func(w *world) { w.feed = feedAt("27-09-2026 06:00:00") })
	if got := j.RunOnce(context.Background()); got != Submitted {
		t.Fatalf("next hour = %s, want submitted", got)
	}
	s := j.State()
	if s.Submitted != 2 || !s.LastUpdate.Equal(time.Date(2026, 9, 27, 0, 30, 0, 0, time.UTC)) {
		t.Errorf("state = %+v", s)
	}
	if w.pings[1] != "/uuid-secret" {
		t.Errorf("unchanged must ping success, got %v", w.pings)
	}
}

func TestRunOnceRetriesAFailedSubmissionAtTheNextTick(t *testing.T) {
	w := newWorld(t)
	w.set(func(w *world) { w.obos = 503 })
	j := w.job()
	j.RunOnce(context.Background())
	w.set(func(w *world) { w.obos = 200 })
	if got := j.RunOnce(context.Background()); got != Submitted {
		t.Fatalf("after a failed submit the same feed must be submitted again, got %s", got)
	}
	if s := j.State(); s.Failures != 1 || s.Submitted != 1 {
		t.Errorf("state = %+v", s)
	}
}

func TestRunOnceLogsOneLineAndNoSecrets(t *testing.T) {
	w := newWorld(t)
	w.set(func(w *world) { w.obos = 401 })
	w.job().RunOnce(context.Background())
	out := w.logs.String()
	if n := strings.Count(out, "\n"); n != 1 {
		t.Errorf("want one log line, got %d: %s", n, out)
	}
	for _, secret := range []string{hex.EncodeToString(testKey), "uuid-secret", "v1="} {
		if strings.Contains(out, secret) {
			t.Errorf("log leaks %q: %s", secret, out)
		}
	}
	if !strings.Contains(out, "outcome=rejected") {
		t.Errorf("log lacks the outcome: %s", out)
	}
}

func TestHealthcheckPingNeverLeaksTheURL(t *testing.T) {
	h := Healthcheck{URL: "http://127.0.0.1:1/uuid-secret", Timeout: time.Second}
	err := h.Ping(context.Background(), true, "submitted")
	if err == nil || strings.Contains(err.Error(), "uuid-secret") {
		t.Fatalf("want a URL-free error, got %v", err)
	}
	if err := (Healthcheck{}).Ping(context.Background(), false, "x"); err != nil {
		t.Errorf("an empty URL must be a no-op, got %v", err)
	}
}
