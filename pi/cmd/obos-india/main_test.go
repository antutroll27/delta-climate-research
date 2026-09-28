package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runArgs(t *testing.T, env map[string]string, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(context.Background(), args, &out, &errOut, env)
	return code, out.String(), errOut.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := runArgs(t, nil, "version")
	if code != 0 || out != "dev\n" {
		t.Errorf("version: %d %q", code, out)
	}
}

func TestUnknownOrMissingSubcommandIsUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"launch"}} {
		code, _, errOut := runArgs(t, nil, args...)
		if code != 2 || !strings.Contains(errOut, "usage: obos-india") {
			t.Errorf("%v: %d %q", args, code, errOut)
		}
	}
}

func TestRelayOnceRefusesABadConfigWithoutLeakingIt(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "absent")
	code, _, errOut := runArgs(t, map[string]string{"RELAY_HMAC_KEY": "abcd"}, "relay-once", "-env", missing)
	if code != 1 || !strings.Contains(errOut, "RELAY_HMAC_KEY") || strings.Contains(errOut, "abcd") {
		t.Errorf("relay-once: %d %q", code, errOut)
	}
}

func TestEnvFileIsReadAndTheProcessEnvironmentWins(t *testing.T) {
	p := filepath.Join(t.TempDir(), "env")
	os.WriteFile(p, []byte("RELAY_HMAC_KEY=00\nRELAY_INTERVAL=1m\n"), 0o600)
	// The file's key is too short, but the process supplies a valid one; the file's
	// interval (1m) is below the minimum and must be what fails.
	env := map[string]string{"RELAY_HMAC_KEY": strings.Repeat("ab", 32)}
	code, _, errOut := runArgs(t, env, "relay-once", "-env", p)
	if code != 1 || !strings.Contains(errOut, "RELAY_INTERVAL") {
		t.Errorf("want the file's RELAY_INTERVAL to be read and refused: %d %q", code, errOut)
	}
}

func TestDoctorReportsABadConfigAsItsFirstLine(t *testing.T) {
	code, out, _ := runArgs(t, map[string]string{}, "doctor", "-env", filepath.Join(t.TempDir(), "absent"))
	if code != 1 || !strings.HasPrefix(out, "❌ config valid: config: RELAY_HMAC_KEY: required") {
		t.Errorf("doctor: %d\n%s", code, out)
	}
}

// serve under a fake systemd: READY at start, WATCHDOG on WATCHDOG_USEC/2,
// STOPPING on shutdown, exit 0.
func TestServeSpeaksToSystemd(t *testing.T) {
	dir, err := os.MkdirTemp("", "sd") // short: macOS caps socket paths at 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	sock := filepath.Join(dir, "n")
	ln, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: sock, Net: "unixgram"})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	env := map[string]string{
		"RELAY_HMAC_KEY":  strings.Repeat("ab", 32),
		"LISTEN_ADDR":     freeAddr(t),
		"CPCB_FEED_URL":   "http://127.0.0.1:1/rss_feed", // refused at once, should the clock be synced
		"OBOS_INGEST_URL": "http://127.0.0.1:1/ingest",
		"NOTIFY_SOCKET":   sock,
		"WATCHDOG_USEC":   "100000", // a WATCHDOG every 50 ms
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	code := make(chan int, 1)
	go func() {
		code <- run(ctx, []string{"serve", "-env", filepath.Join(dir, "absent")}, io.Discard, io.Discard, env)
	}()

	read := func() string {
		buf := make([]byte, 64)
		ln.SetReadDeadline(time.Now().Add(3 * time.Second))
		k, err := ln.Read(buf)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		return string(buf[:k])
	}
	if got := read(); got != "READY=1" {
		t.Fatalf("first message = %q, want READY=1", got)
	}
	if got := read(); got != "WATCHDOG=1" {
		t.Fatalf("second message = %q, want WATCHDOG=1", got)
	}
	cancel()
	for got := read(); got != "STOPPING=1"; got = read() {
		if got != "WATCHDOG=1" {
			t.Fatalf("unexpected %q before STOPPING=1", got)
		}
	}
	select {
	case c := <-code:
		if c != 0 {
			t.Errorf("exit code = %d, want 0", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not return after shutdown")
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}
