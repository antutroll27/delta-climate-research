package relay

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
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

func TestRunOnceStateBookkeeping(t *testing.T) {
	w := newWorld(t)
	w.set(func(w *world) { w.obos = 503 })
	j := w.job()
	j.RunOnce(context.Background())
	if s := j.State(); !s.LastOK.IsZero() || s.LastError == "" {
		t.Fatalf("after a first failure LastOK must be zero and LastError set: %+v", s)
	}
	w.set(func(w *world) { w.obos = 200 })
	j.RunOnce(context.Background())
	if s := j.State(); s.LastError != "" || !s.LastOK.Equal(s.LastRun) {
		t.Fatalf("after a success LastError must clear and LastOK == LastRun: %+v", s)
	}
}

// A rejection (say a 401 during key rotation) must be retried and keep alerting:
// recording its lastupdate would make the next tick "unchanged" and ping green.
func TestRunOnceRejectedIsRetriedAndStaysRed(t *testing.T) {
	w := newWorld(t)
	w.set(func(w *world) { w.obos = 401 })
	j := w.job()
	for i := range 2 {
		if got := j.RunOnce(context.Background()); got != Rejected {
			t.Fatalf("run %d = %s, want rejected", i+1, got)
		}
	}
	if w.submits != 2 || len(w.pings) != 2 || w.pings[1] != "/uuid-secret/fail" {
		t.Errorf("submits = %d, pings = %v", w.submits, w.pings)
	}
	if s := j.State(); !s.LastUpdate.IsZero() || s.Submitted != 0 {
		t.Errorf("a rejected feed was recorded: %+v", s)
	}
}

// Alerting and submitting are separate: an old feed is always Stale (red), a
// changed old feed is still submitted so the archive stays whole, an unchanged
// old feed is not.
func TestRunOnceStaleFeed(t *testing.T) {
	cases := []struct {
		name    string
		age     time.Duration // of the second feed at the second run; 0 keeps the first feed
		want    Outcome
		submits int
		ping    string
	}{
		{"changed and fresh", 20 * time.Minute, Submitted, 2, "/uuid-secret"},
		{"changed and old", 4 * time.Hour, Stale, 2, "/uuid-secret/fail"},
		{"unchanged and old", 0, Stale, 1, "/uuid-secret/fail"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newWorld(t)
			j := w.job()
			if got := j.RunOnce(context.Background()); got != Submitted {
				t.Fatalf("first run = %s", got) // 05:00 IST, 30 min before the clock
			}
			first := time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC) // the first feed's lastupdate
			second := first.Add(tc.age + time.Hour)                 // the second feed is an hour newer than the first
			if tc.age == 0 {
				second = first.Add(5 * time.Hour) // the first feed, now 5 h old
			} else {
				stamp := second.Add(-tc.age).In(time.FixedZone("IST", 19800))
				w.set(func(w *world) { w.feed = feedAt(stamp.Format("02-01-2006 15:04:05")) })
			}
			j.Clock = func() time.Time { return second }
			if got := j.RunOnce(context.Background()); got != tc.want {
				t.Fatalf("second run = %s, want %s", got, tc.want)
			}
			if w.submits != tc.submits || w.pings[1] != tc.ping {
				t.Errorf("submits = %d, pings = %v", w.submits, w.pings)
			}
			s := j.State()
			if s.Submitted != tc.submits || s.LastOutcome != tc.want {
				t.Errorf("state = %+v", s)
			}
			if tc.want == Stale && (s.LastError == "" || s.Failures != 1 || !s.LastOK.Before(s.LastRun)) {
				t.Errorf("stale must count as a failure: %+v", s)
			}
		})
	}
}

// A SIGTERM mid-run (the weekly reboot) is not a failure: no state, log or ping.
func TestRunOnceCancelledLeavesNoTrace(t *testing.T) {
	t.Run("before the fetch", func(t *testing.T) {
		w := newWorld(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		j := w.job()
		if got := j.RunOnce(ctx); got != Cancelled {
			t.Fatalf("outcome = %s, want cancelled", got)
		}
		if (j.State() != State{}) || len(w.pings) != 0 || w.logs.Len() != 0 {
			t.Errorf("state %+v, pings %v, logs %q", j.State(), w.pings, w.logs.String())
		}
	})
	t.Run("during the submit", func(t *testing.T) {
		w := newWorld(t)
		ctx, cancel := context.WithCancel(context.Background())
		w.api.Config.Handler = http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			io.ReadAll(r.Body)
			cancel() // SIGTERM arrives while OBOS is answering
			io.WriteString(rw, `{"stored":"new"}`)
		})
		j := w.job()
		if got := j.RunOnce(ctx); got != Cancelled {
			t.Fatalf("outcome = %s, want cancelled", got)
		}
		if (j.State() != State{}) || len(w.pings) != 0 || w.logs.Len() != 0 {
			t.Errorf("state %+v, pings %v, logs %q", j.State(), w.pings, w.logs.String())
		}
	})
}

func TestTruncateIsRuneSafe(t *testing.T) {
	cases := []struct {
		s    string
		n    int
		want string
	}{
		{"abc", 5, "abc"},
		{"abcdef", 3, "abc"},
		{"ab€", 3, "ab"}, // € is 3 bytes; cutting inside it drops it whole
		{"ab€", 5, "ab€"},
	}
	for _, tc := range cases {
		if got := truncate(tc.s, tc.n); got != tc.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tc.s, tc.n, got, tc.want)
		}
	}
}

func TestLoopRunsAtOnceThenEveryTickUntilCancelled(t *testing.T) {
	w := newWorld(t)
	j := w.job()
	pings := func() int { w.mu.Lock(); defer w.mu.Unlock(); return len(w.pings) }

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { j.Loop(ctx, time.Hour, func(context.Context) bool { return true }); close(done) }()
	for deadline := time.Now().Add(3 * time.Second); pings() < 1; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("no run at start: the first run must not wait for a tick")
		}
	}
	cancel()
	<-done
	if pings() != 1 {
		t.Errorf("an hour-long interval ran %d times", pings())
	}

	w2 := newWorld(t)
	j2 := w2.job()
	ctx2, cancel2 := context.WithCancel(context.Background())
	done2 := make(chan struct{})
	go func() { j2.Loop(ctx2, 20*time.Millisecond, func(context.Context) bool { return true }); close(done2) }()
	for deadline := time.Now().Add(3 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		w2.mu.Lock()
		n := len(w2.pings)
		w2.mu.Unlock()
		if n >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d runs in 3 s at a 20 ms interval", n)
		}
	}
	cancel2()
	<-done2
}

func TestLoopClockWait(t *testing.T) {
	t.Run("gives up, warns, relays anyway", func(t *testing.T) {
		w := newWorld(t)
		j := w.job()
		ctx, cancel := context.WithCancel(context.Background())
		j.Healthcheck.URL = "" // the only side effect left is the log
		done := make(chan struct{})
		go func() { j.Loop(ctx, time.Hour, func(context.Context) bool { return false }); close(done) }()
		for deadline := time.Now().Add(3 * time.Second); j.State().LastRun.IsZero(); time.Sleep(5 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatal("an unsynchronised clock must not stop the relay")
			}
		}
		cancel()
		<-done
		if !strings.Contains(w.logs.String(), "clock not synchronised") {
			t.Errorf("no warning logged: %s", w.logs.String())
		}
	})
	t.Run("shutdown while waiting runs nothing", func(t *testing.T) {
		w := newWorld(t)
		j := w.job()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		j.Loop(ctx, time.Hour, func(context.Context) bool { return false })
		if !j.State().LastRun.IsZero() || w.logs.Len() != 0 {
			t.Errorf("ran or logged after shutdown: %+v %q", j.State(), w.logs.String())
		}
	})
}

func TestHealthcheckPingFailures(t *testing.T) {
	t.Run("non-2xx", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			rw.WriteHeader(500)
		}))
		defer srv.Close()
		err := Healthcheck{URL: srv.URL + "/uuid-secret"}.Ping(context.Background(), true, "x")
		if !errors.Is(err, ErrPing) || strings.Contains(err.Error(), "uuid-secret") {
			t.Fatalf("want a URL-free ErrPing, got %v", err)
		}
	})
	t.Run("timeout", func(t *testing.T) {
		release := make(chan struct{})
		srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			select {
			case <-release:
			case <-r.Context().Done():
			}
		}))
		defer srv.Close()
		defer close(release)
		start := time.Now()
		err := Healthcheck{URL: srv.URL, Timeout: 50 * time.Millisecond}.Ping(context.Background(), true, "x")
		if !errors.Is(err, ErrPing) || time.Since(start) > 2*time.Second {
			t.Fatalf("want ErrPing within the timeout, got %v after %v", err, time.Since(start))
		}
	})
}

// CPCB's servers can flap back to an hour-old copy. An older lastupdate is not
// news: it is never resubmitted, and the state never moves backwards.
func TestRunOnceAnOlderFeedIsUnchanged(t *testing.T) {
	w := newWorld(t)
	j := w.job()
	j.RunOnce(context.Background()) // 05:00 IST
	w.set(func(w *world) { w.feed = feedAt("27-09-2026 04:00:00") })
	if got := j.RunOnce(context.Background()); got != Unchanged {
		t.Fatalf("an older feed = %s, want unchanged", got)
	}
	if s := j.State(); w.submits != 1 || !s.LastUpdate.Equal(time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC)) {
		t.Errorf("submits = %d, state = %+v", w.submits, s)
	}
}

func TestLastErrorIsCapped(t *testing.T) {
	w := newWorld(t)
	j := w.job()
	j.Fetcher.URL = "http://127.0.0.1:1/" + strings.Repeat("x", 400) // the dial error quotes the URL
	j.RunOnce(context.Background())
	if n := len(j.State().LastError); n == 0 || n > maxErrorLen {
		t.Errorf("LastError is %d bytes, want 1-%d", n, maxErrorLen)
	}
}
