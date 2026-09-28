// Package doctor runs obos-india's self-checks (spec 2026-09-29 §6) and prints
// one ✅/❌ line per check with the reason. Every check is a function, so tests
// run the whole report with fakes.
package doctor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"time"

	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/health"
)

// Thresholds, spec 2026-09-29 §6.
const (
	MinDiskFreePct = 20.0
	MaxCPUTempC    = 75.0
	// CheckTimeout bounds each check.
	CheckTimeout = 45 * time.Second
)

// ErrSkipped marks a check that does not apply here (for example, off-Pi). It is
// printed but does not fail the report.
var ErrSkipped = errors.New("skipped")

// Check is one named self-check. Run returns nil for a pass, an error wrapping
// ErrSkipped for "not applicable", and any other error for a failure, whose text
// is the reason printed.
type Check struct {
	Name string
	Run  func(ctx context.Context) error
}

// Result is one check's verdict.
type Result struct {
	Name string
	Err  error
}

// Passed reports a pass or a skip.
func (r Result) Passed() bool { return r.Err == nil || errors.Is(r.Err, ErrSkipped) }

// Report is every check's result, in order.
type Report struct {
	Results []Result
}

// OK reports whether no check failed.
func (r Report) OK() bool {
	for _, res := range r.Results {
		if !res.Passed() {
			return false
		}
	}
	return true
}

// ExitCode is 0 when OK, else 1.
func (r Report) ExitCode() int {
	if r.OK() {
		return 0
	}
	return 1
}

// Print writes one line per check: "✅ name", "➖ name: skipped (why)" or "❌ name: reason".
func (r Report) Print(w io.Writer) {
	for _, res := range r.Results {
		switch {
		case res.Err == nil:
			fmt.Fprintf(w, "✅ %s\n", res.Name)
		case errors.Is(res.Err, ErrSkipped):
			fmt.Fprintf(w, "➖ %s: %v\n", res.Name, res.Err)
		default:
			fmt.Fprintf(w, "❌ %s: %v\n", res.Name, res.Err)
		}
	}
}

// Run runs every check in order, each under CheckTimeout.
func Run(ctx context.Context, checks []Check) Report {
	var rep Report
	for _, c := range checks {
		cctx, cancel := context.WithTimeout(ctx, CheckTimeout)
		err := c.Run(cctx)
		cancel()
		rep.Results = append(rep.Results, Result{Name: c.Name, Err: err})
	}
	return rep
}

// Deps is what the standard checks need. A nil function means "cannot run": the
// check fails with that reason, never passes silently.
type Deps struct {
	ConfigErr   error                                        // config.Load's error; nil when valid
	Health      health.Reader                                // clock, disk, temperature
	FetchCPCB   func(ctx context.Context) (cpcb.Meta, error) // a real fetch plus cpcb.Check
	PingOBOS    func(ctx context.Context) error              // a signed "ping" to the ingest endpoint
	Systemctl   func(ctx context.Context, args ...string) error
	ServiceName string // "obos-india"
}

var errNoConfig = errors.New("needs a valid config (see the first line)")

// Checks returns the seven checks of spec §6, in its order.
func Checks(d Deps) []Check {
	return []Check{
		{"config valid", func(context.Context) error { return d.ConfigErr }},
		{"clock synchronised", func(context.Context) error {
			if !d.Health.ClockSynced() {
				return errors.New("systemd-timesyncd has not synchronised the clock")
			}
			return nil
		}},
		{"CPCB feed reachable and valid", func(ctx context.Context) error {
			if d.FetchCPCB == nil {
				return errNoConfig
			}
			_, err := d.FetchCPCB(ctx)
			return err
		}},
		{"OBOS ingest reachable and key accepted", func(ctx context.Context) error {
			if d.PingOBOS == nil {
				return errNoConfig
			}
			return d.PingOBOS(ctx)
		}},
		{fmt.Sprintf("disk at least %.0f%% free", MinDiskFreePct), func(context.Context) error {
			pct, err := d.Health.DiskFreePct()
			if err != nil {
				return err
			}
			if pct < MinDiskFreePct {
				return fmt.Errorf("%.1f%% free", pct)
			}
			return nil
		}},
		{fmt.Sprintf("CPU below %.0f °C", MaxCPUTempC), func(context.Context) error {
			t, err := d.Health.CPUTempC()
			if err != nil {
				return fmt.Errorf("%w (no thermal sensor: not a Pi)", ErrSkipped)
			}
			if t >= MaxCPUTempC {
				return fmt.Errorf("%.1f °C", t)
			}
			return nil
		}},
		{"service active", func(ctx context.Context) error {
			if d.Systemctl == nil {
				return fmt.Errorf("%w (no systemctl)", ErrSkipped)
			}
			err := d.Systemctl(ctx, "is-active", "--quiet", d.ServiceName)
			if errors.Is(err, exec.ErrNotFound) {
				return fmt.Errorf("%w (no systemctl: not a Pi)", ErrSkipped)
			}
			if err != nil {
				return fmt.Errorf("%s is not active", d.ServiceName)
			}
			return nil
		}},
	}
}

// Systemctl runs the real systemctl.
func Systemctl(ctx context.Context, args ...string) error {
	return exec.CommandContext(ctx, "systemctl", args...).Run()
}
