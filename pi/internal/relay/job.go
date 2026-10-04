// Package relay runs one CPCB → OBOS relay cycle and keeps its in-memory state.
package relay

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
	"unicode/utf8"

	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/ingest"
)

// Outcome is the result of one run.
type Outcome string

// The outcomes of spec 2026-09-29 §6.
const (
	Submitted    Outcome = "submitted"     // OBOS accepted the feed (stored "new" or "duplicate")
	Unchanged    Outcome = "unchanged"     // CPCB's lastupdate is not later than the last one submitted
	Stale        Outcome = "stale"         // CPCB's lastupdate is older than MaxFeedAge (submitted anyway if changed)
	FetchFailed  Outcome = "fetch_failed"  // CPCB unreachable, or its answer failed cpcb.Check
	Rejected     Outcome = "rejected"      // OBOS answered 4xx
	SubmitFailed Outcome = "submit_failed" // OBOS answered 5xx or not at all
	Cancelled    Outcome = "cancelled"     // ctx ended mid-run (shutdown): not recorded, logged or pinged
)

// OK reports whether the outcome is healthy (healthcheck success).
func (o Outcome) OK() bool { return o == Submitted || o == Unchanged }

// DefaultMaxFeedAge is how old CPCB's lastupdate may be before a run is Stale.
const DefaultMaxFeedAge = 3 * time.Hour

// maxErrorLen caps State.LastError so /status stays small.
const maxErrorLen = 200

// State is the relay's memory since start, exposed by GET /status.
//
// LastUpdate and Submitted advance on every feed OBOS accepts, including a
// changed but stale one, whose LastOutcome is still Stale.
type State struct {
	LastRun     time.Time `json:"last_run,omitzero"`
	LastOK      time.Time `json:"last_ok,omitzero"`
	LastUpdate  time.Time `json:"last_update,omitzero"` // CPCB's lastupdate of the last submitted feed
	LastOutcome Outcome   `json:"last_outcome,omitempty"`
	LastError   string    `json:"last_error,omitempty"` // short, no secrets
	Submitted   int       `json:"submitted"`
	Failures    int       `json:"failures"`
}

// Job is one relay: fetch CPCB, skip an unchanged feed, submit to OBOS, ping the
// healthcheck. Use it by pointer; its state is guarded by an internal mutex.
type Job struct {
	Fetcher     cpcb.Fetcher
	Client      ingest.Client
	Healthcheck Healthcheck
	MaxFeedAge  time.Duration    // zero: DefaultMaxFeedAge
	Clock       func() time.Time // nil: time.Now
	Log         *slog.Logger     // nil: slog.Default()

	mu    sync.Mutex
	state State
}

// State returns a copy of the current state.
func (j *Job) State() State {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.state
}

// RunOnce performs one cycle and returns its outcome. It never retries: a failure
// waits for the next tick. It logs exactly one line, except when Cancelled.
func (j *Job) RunOnce(ctx context.Context) Outcome {
	now := time.Now
	if j.Clock != nil {
		now = j.Clock
	}
	log := j.logger()
	maxAge := j.MaxFeedAge
	if maxAge == 0 {
		maxAge = DefaultMaxFeedAge
	}
	started := now().UTC()

	var (
		outcome   Outcome
		runErr    error
		res       ingest.Result
		submitted bool // OBOS accepted this feed
	)
	snap, err := j.Fetcher.Fetch(ctx)
	// Only a later lastupdate is news: CPCB's servers can flap back to an hour-old copy.
	if err == nil && snap.Meta.LastUpdate.After(j.State().LastUpdate) {
		res, err = j.Client.Submit(ctx, snap)
		submitted = err == nil
		if errors.Is(err, ingest.ErrRejected) {
			outcome = Rejected
		} else if err != nil {
			outcome = SubmitFailed
		}
	} else if err != nil {
		outcome = FetchFailed
	}
	if ctx.Err() != nil {
		return Cancelled
	}
	runErr = err
	if runErr == nil {
		switch age := started.Sub(snap.Meta.LastUpdate); {
		case age > maxAge:
			outcome, runErr = Stale, fmt.Errorf("feed is %s old, over %s", age.Round(time.Minute), maxAge)
		case submitted:
			outcome = Submitted
		default:
			outcome = Unchanged
		}
	}

	j.mu.Lock()
	j.state.LastRun = started
	j.state.LastOutcome = outcome
	j.state.LastError = ""
	if runErr != nil {
		j.state.LastError = truncate(runErr.Error(), maxErrorLen)
		j.state.Failures++
	} else {
		j.state.LastOK = started
	}
	if submitted {
		j.state.LastUpdate = snap.Meta.LastUpdate
		j.state.Submitted++
	}
	j.mu.Unlock()

	attrs := []any{"outcome", string(outcome)}
	if outcome != FetchFailed {
		attrs = append(attrs, "lastupdate", snap.Meta.LastUpdate.Format(time.RFC3339), "stations", snap.Meta.Stations)
	}
	if submitted {
		attrs = append(attrs, "stored", res.Stored)
	}
	if runErr != nil {
		attrs = append(attrs, "error", truncate(runErr.Error(), maxErrorLen))
	}
	if pingErr := j.Healthcheck.Ping(ctx, outcome.OK(), string(outcome)); pingErr != nil {
		attrs = append(attrs, "healthcheck", pingErr.Error())
	}
	if outcome.OK() {
		log.Info("relay run", attrs...)
	} else {
		log.Warn("relay run", attrs...)
	}
	return outcome
}

// truncate cuts s to at most n bytes without splitting a UTF-8 character.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// Loop waits for a synchronised clock (waitClock bounds the wait and reports
// whether it synced; a Pi has no clock battery), runs at once, then every tick,
// until ctx ends. Runs never overlap.
func (j *Job) Loop(ctx context.Context, every time.Duration, waitClock func(context.Context) bool) {
	if !waitClock(ctx) {
		if ctx.Err() != nil {
			return
		}
		j.logger().Warn("clock not synchronised after waiting; relaying anyway")
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		j.RunOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (j *Job) logger() *slog.Logger {
	if j.Log == nil {
		return slog.Default()
	}
	return j.Log
}
