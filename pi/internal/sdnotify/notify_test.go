package sdnotify

import (
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// listen opens a unixgram socket at a short path (macOS caps socket paths at 104 bytes).
func listen(t *testing.T) (string, *net.UnixConn) {
	t.Helper()
	dir, err := os.MkdirTemp("", "sd")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "n")
	ln, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: sock, Net: "unixgram"})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	return sock, ln
}

func expect(t *testing.T, ln *net.UnixConn, want string) {
	t.Helper()
	buf := make([]byte, 64)
	ln.SetReadDeadline(time.Now().Add(2 * time.Second))
	k, err := ln.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := string(buf[:k]); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestNotifySendsOneDatagram(t *testing.T) {
	sock, ln := listen(t)
	n := Notifier{Socket: sock}
	for _, msg := range []string{Ready, Watchdog} {
		if err := n.Notify(msg); err != nil {
			t.Fatalf("Notify(%s): %v", msg, err)
		}
		expect(t, ln, msg)
	}
}

func TestNotifyWithoutASocketIsANoOp(t *testing.T) {
	if err := (Notifier{}).Notify(Ready); err != nil {
		t.Fatalf("zero Notifier: %v", err)
	}
}

func TestNotifyToAMissingSocketIsAnError(t *testing.T) {
	n := Notifier{Socket: filepath.Join(t.TempDir(), "absent.sock")}
	if err := n.Notify(Ready); err == nil {
		t.Fatal("want an error for a socket that does not exist")
	}
}

func TestWatchdogInterval(t *testing.T) {
	cases := map[string]time.Duration{
		"120000000": 60 * time.Second, // WatchdogSec=120
		"100000":    50 * time.Millisecond,
		"":          DefaultWatchdogInterval,
		"0":         DefaultWatchdogInterval,
		"-5":        DefaultWatchdogInterval,
		"2m":        DefaultWatchdogInterval,
	}
	for in, want := range cases {
		if got := WatchdogInterval(in); got != want {
			t.Errorf("WatchdogInterval(%q) = %v, want %v", in, got, want)
		}
	}
}
