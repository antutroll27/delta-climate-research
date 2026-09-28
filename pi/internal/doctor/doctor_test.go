package doctor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/health"
)

// piRoot is a fake Pi: clock synced, CPU at the given millidegrees.
func piRoot(t *testing.T, milliC string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range map[string]string{health.SyncedPath: "", health.TempPath: milliC} {
		p := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(body), 0o644)
	}
	return root
}

// healthy is a Deps under which every check passes.
func healthy(t *testing.T) Deps {
	return Deps{
		Health:      health.Reader{Root: piRoot(t, "48000\n"), Statfs: func(string) (health.Disk, error) { return health.Disk{Free: 50, Total: 100}, nil }},
		FetchCPCB:   func(context.Context) (cpcb.Meta, error) { return cpcb.Meta{Stations: 481}, nil },
		PingOBOS:    func(context.Context) error { return nil },
		Systemctl:   func(context.Context, ...string) error { return nil },
		ServiceName: "obos-india",
	}
}

func TestAllChecksPassOnAHealthyPi(t *testing.T) {
	rep := Run(context.Background(), Checks(healthy(t)))
	if len(rep.Results) != 7 {
		t.Fatalf("want the 7 checks of spec §6, got %d", len(rep.Results))
	}
	var out bytes.Buffer
	rep.Print(&out)
	if !rep.OK() || rep.ExitCode() != 0 || strings.Count(out.String(), "✅") != 7 {
		t.Errorf("report:\n%s", out.String())
	}
}

func TestEachCheckFailsAlone(t *testing.T) {
	cases := []struct {
		name    string
		breakIt func(*Deps, *testing.T)
		line    string // the ❌ line must start with this
	}{
		{"config", func(d *Deps, t *testing.T) { d.ConfigErr = errors.New("config: RELAY_HMAC_KEY: required") }, "❌ config valid: config: RELAY_HMAC_KEY: required"},
		{"clock", func(d *Deps, t *testing.T) { os.Remove(filepath.Join(d.Health.Root, health.SyncedPath)) }, "❌ clock synchronised:"},
		{"cpcb", func(d *Deps, t *testing.T) {
			d.FetchCPCB = func(context.Context) (cpcb.Meta, error) { return cpcb.Meta{}, cpcb.ErrTooFewStations }
		}, "❌ CPCB feed reachable and valid: cpcb: too few stations"},
		{"cpcb without config", func(d *Deps, t *testing.T) { d.FetchCPCB = nil }, "❌ CPCB feed reachable and valid: needs a valid config"},
		{"obos", func(d *Deps, t *testing.T) {
			d.PingOBOS = func(context.Context) error { return errors.New("ingest: HTTP 401") }
		}, "❌ OBOS ingest reachable and key accepted: ingest: HTTP 401"},
		{"disk 19.9%", func(d *Deps, t *testing.T) {
			d.Health.Statfs = func(string) (health.Disk, error) { return health.Disk{Free: 199, Total: 1000}, nil }
		}, "❌ disk at least 20% free: 19.9% free"},
		{"temp 75.0", func(d *Deps, t *testing.T) {
			os.WriteFile(filepath.Join(d.Health.Root, health.TempPath), []byte("75000\n"), 0o644)
		}, "❌ CPU below 75 °C: 75.0 °C"},
		{"service inactive", func(d *Deps, t *testing.T) {
			d.Systemctl = func(context.Context, ...string) error { return errors.New("exit status 3") }
		}, "❌ service active: obos-india is not active"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := healthy(t)
			tc.breakIt(&d, t)
			rep := Run(context.Background(), Checks(d))
			var out bytes.Buffer
			rep.Print(&out)
			if rep.OK() || rep.ExitCode() != 1 {
				t.Fatalf("report must fail:\n%s", out.String())
			}
			if strings.Count(out.String(), "❌") != 1 || !strings.Contains(out.String(), tc.line) {
				t.Errorf("want exactly one failure %q, got:\n%s", tc.line, out.String())
			}
		})
	}
}

func TestBoundariesPass(t *testing.T) {
	d := healthy(t)
	d.Health.Statfs = func(string) (health.Disk, error) { return health.Disk{Free: 20, Total: 100}, nil }
	os.WriteFile(filepath.Join(d.Health.Root, health.TempPath), []byte("74999\n"), 0o644)
	if rep := Run(context.Background(), Checks(d)); !rep.OK() {
		t.Errorf("20%% free and 74.999 °C must pass: %+v", rep.Results)
	}
}

func TestOffPiChecksAreSkippedNotFailed(t *testing.T) {
	d := healthy(t)
	os.Remove(filepath.Join(d.Health.Root, health.TempPath))
	d.Systemctl = func(context.Context, ...string) error { return fmt.Errorf("run: %w", exec.ErrNotFound) }
	rep := Run(context.Background(), Checks(d))
	var out bytes.Buffer
	rep.Print(&out)
	if !rep.OK() || strings.Count(out.String(), "➖") != 2 {
		t.Errorf("want two skips and a pass:\n%s", out.String())
	}
}

func TestSystemctlArguments(t *testing.T) {
	var got []string
	d := healthy(t)
	d.Systemctl = func(_ context.Context, args ...string) error { got = args; return nil }
	Run(context.Background(), Checks(d))
	if strings.Join(got, " ") != "is-active --quiet obos-india" {
		t.Errorf("systemctl %v", got)
	}
}
