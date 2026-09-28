package health

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeRoot builds a tree with the Linux files the Reader reads.
func fakeRoot(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestReadAPi(t *testing.T) {
	root := fakeRoot(t, map[string]string{
		TempPath:   "48312\n",
		SyncedPath: "",
		UptimePath: "12345.67 40000.00\n",
	})
	r := Reader{Root: root, Statfs: func(string) (Disk, error) { return Disk{Free: 25, Total: 100}, nil }}
	s := r.Read()
	if s.CPUTempC == nil || *s.CPUTempC != 48.312 {
		t.Errorf("CPUTempC = %v", s.CPUTempC)
	}
	if s.DiskFreePct == nil || *s.DiskFreePct != 25 {
		t.Errorf("DiskFreePct = %v", s.DiskFreePct)
	}
	if !s.ClockSynced {
		t.Error("ClockSynced = false")
	}
	if s.UptimeS == nil || *s.UptimeS != 12345.67 {
		t.Errorf("UptimeS = %v", s.UptimeS)
	}
}

func TestReadOffPiLeavesUnknownsNil(t *testing.T) {
	r := Reader{Root: t.TempDir(), Statfs: func(string) (Disk, error) { return Disk{}, errors.New("no disk") }}
	s := r.Read()
	if s.CPUTempC != nil || s.DiskFreePct != nil || s.UptimeS != nil || s.ClockSynced {
		t.Errorf("want every value unknown, got %+v", s)
	}
}

func TestBadFilesAreErrorsNotZeros(t *testing.T) {
	r := Reader{Root: fakeRoot(t, map[string]string{TempPath: "hot\n", UptimePath: "\n"})}
	if _, err := r.CPUTempC(); err == nil {
		t.Error("non-numeric temperature must be an error")
	}
	if _, err := r.Uptime(); err == nil {
		t.Error("empty uptime must be an error")
	}
	zero := Reader{Statfs: func(string) (Disk, error) { return Disk{}, nil }}
	if _, err := zero.DiskFreePct(); err == nil {
		t.Error("a zero-size disk must be an error, not a division")
	}
}

func TestRealStatfs(t *testing.T) {
	pct, err := Reader{DiskPath: t.TempDir()}.DiskFreePct()
	if err != nil {
		t.Fatalf("statfs: %v", err)
	}
	if pct <= 0 || pct > 100 {
		t.Errorf("free = %.2f%%, want (0, 100]", pct)
	}
}

func TestWaitClockSync(t *testing.T) {
	root := t.TempDir()
	r := Reader{Root: root}
	if r.WaitClockSync(context.Background(), 30*time.Millisecond, 5*time.Millisecond) {
		t.Fatal("no sync file: must give up after max")
	}
	go func() {
		time.Sleep(20 * time.Millisecond)
		p := filepath.Join(root, SyncedPath)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, nil, 0o644)
	}()
	if !r.WaitClockSync(context.Background(), 2*time.Second, 5*time.Millisecond) {
		t.Fatal("the sync file appeared: must report synced")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if (Reader{Root: t.TempDir()}).WaitClockSync(ctx, time.Minute, time.Second) {
		t.Fatal("a cancelled context must stop the wait")
	}
}
