// Package relay runs one CPCB → OBOS relay cycle and keeps its in-memory state.
package relay

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/ingest"
)

// Outcome is the result of one run.
type Outcome string

// The five outcomes of spec 2026-09-29 §6.
const (
	Submitted    Outcome = "submitted"     // OBOS accepted the feed (stored "new" or "duplicate")
	Unchanged    Outcome = "unchanged"     // CPCB's lastupdate equals the last one submitted
	FetchFailed  Outcome = "fetch_failed"  // CPCB unreachable, or its answer failed cpcb.Check
	Rejected     Outcome = "rejected"      // OBOS answered 4xx
	SubmitFailed Outcome = "submit_failed" // OBOS answered 5xx or not at all
)

// OK reports whether the outcome is healthy (healthcheck success).
func (o Outcome) OK() bool { return o == Submitted || o == Unchanged }

// maxErrorLen caps State.LastError so /status stays small.
const maxErrorLen = 200

// State is the relay's memory since start, exposed by GET /status.
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
// waits for the next tick. It logs exactly one line.
func (j *Job) RunOnce(ctx context.Context) Outcome {
	now := time.Now
	if j.Clock != nil {
		now = j.Clock
	}
	log := j.Log
	if log == nil {
		log = slog.Default()
	}
	started := now().UTC()

	var (
		outcome Outcome
		runErr  error
		res     ingest.Result
	)
	snap, err := j.Fetcher.Fetch(ctx)
	switch {
	case err != nil:
		outcome, runErr = FetchFailed, err
	case snap.Meta.LastUpdate.Equal(j.State().LastUpdate):
		outcome = Unchanged
	default:
		res, err = j.Client.Submit(ctx, snap)
		switch {
		case errors.Is(err, ingest.ErrRejected):
			outcome, runErr = Rejected, err
		case err != nil:
			outcome, runErr = SubmitFailed, err
		default:
			outcome = Submitted
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
	if outcome == Submitted {
		j.state.LastUpdate = snap.Meta.LastUpdate
		j.state.Submitted++
	}
	j.mu.Unlock()

	attrs := []any{"outcome", string(outcome)}
	if outcome != FetchFailed {
		attrs = append(attrs, "lastupdate", snap.Meta.LastUpdate.Format(time.RFC3339), "stations", snap.Meta.Stations)
	}
	if outcome == Submitted {
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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
