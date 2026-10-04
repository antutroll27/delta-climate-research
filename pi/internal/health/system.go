// Package health reads the Pi's vital signs: CPU temperature, free disk, clock
// sync and uptime. Every path is under Reader.Root, so tests use a fake tree.
package health

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// The Linux paths read, relative to Reader.Root.
const (
	TempPath   = "sys/class/thermal/thermal_zone0/temp"
	SyncedPath = "run/systemd/timesync/synchronized"
	UptimePath = "proc/uptime"
)

// Disk is a filesystem's size and the space available to unprivileged users.
type Disk struct {
	Free, Total uint64 // bytes
}

// System is one reading. A nil pointer means the value could not be read (for
// example, off-Pi); it is never guessed.
type System struct {
	CPUTempC    *float64 `json:"cpu_temp_c"`
	DiskFreePct *float64 `json:"disk_free_pct"`
	ClockSynced bool     `json:"clock_synced"`
	UptimeS     *float64 `json:"uptime_s"`
}

// Reader reads System. The zero value reads the real machine.
type Reader struct {
	Root     string                          // "": "/"
	DiskPath string                          // "": "/"
	Statfs   func(path string) (Disk, error) // nil: the real statfs(2)
}

func (r Reader) path(rel string) string {
	root := r.Root
	if root == "" {
		root = "/"
	}
	return filepath.Join(root, rel)
}

// Read takes one reading.
func (r Reader) Read() System {
	s := System{ClockSynced: r.ClockSynced()}
	if t, err := r.CPUTempC(); err == nil {
		s.CPUTempC = &t
	}
	if p, err := r.DiskFreePct(); err == nil {
		s.DiskFreePct = &p
	}
	if u, err := r.Uptime(); err == nil {
		sec := u.Seconds()
		s.UptimeS = &sec
	}
	return s
}

// CPUTempC reads thermal_zone0, which the kernel reports in millidegrees.
func (r Reader) CPUTempC() (float64, error) {
	b, err := os.ReadFile(r.path(TempPath))
	if err != nil {
		return 0, fmt.Errorf("health: temperature: %w", err)
	}
	milli, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return 0, fmt.Errorf("health: temperature: %w", err)
	}
	return float64(milli) / 1000, nil
}

// DiskFreePct is the share of the disk still free, 0-100.
func (r Reader) DiskFreePct() (float64, error) {
	statfs := r.Statfs
	if statfs == nil {
		statfs = statfsDisk
	}
	p := r.DiskPath
	if p == "" {
		p = "/"
	}
	d, err := statfs(p)
	if err != nil {
		return 0, fmt.Errorf("health: disk: %w", err)
	}
	if d.Total == 0 {
		return 0, errors.New("health: disk: zero size")
	}
	return 100 * float64(d.Free) / float64(d.Total), nil
}

// ClockSynced reports whether systemd-timesyncd has synchronised the clock.
func (r Reader) ClockSynced() bool {
	_, err := os.Stat(r.path(SyncedPath))
	return err == nil
}

// Uptime reads the first field of /proc/uptime.
func (r Reader) Uptime() (time.Duration, error) {
	b, err := os.ReadFile(r.path(UptimePath))
	if err != nil {
		return 0, fmt.Errorf("health: uptime: %w", err)
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0, errors.New("health: uptime: empty")
	}
	sec, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, fmt.Errorf("health: uptime: %w", err)
	}
	return time.Duration(sec * float64(time.Second)), nil
}

// WaitClockSync polls every poll until the clock is synchronised, limit elapses, or
// ctx ends. It reports whether the clock is synchronised.
func (r Reader) WaitClockSync(ctx context.Context, limit, poll time.Duration) bool {
	deadline := time.NewTimer(limit)
	defer deadline.Stop()
	tick := time.NewTicker(poll)
	defer tick.Stop()
	for {
		if r.ClockSynced() {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-deadline.C:
			return r.ClockSynced()
		case <-tick.C:
		}
	}
}
