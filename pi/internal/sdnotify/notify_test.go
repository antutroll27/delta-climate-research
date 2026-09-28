package sdnotify

import (
	"net"
	"path/filepath"
	"testing"
	"time"
)

func TestNotifySendsOneDatagram(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "n.sock")
	ln, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: sock, Net: "unixgram"})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	n := FromEnv(func(k string) string {
		if k == "NOTIFY_SOCKET" {
			return sock
		}
		return ""
	})
	for _, msg := range []string{Ready, Watchdog} {
		if err := n.Notify(msg); err != nil {
			t.Fatalf("Notify(%s): %v", msg, err)
		}
		buf := make([]byte, 64)
		ln.SetReadDeadline(time.Now().Add(2 * time.Second))
		k, err := ln.Read(buf)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if got := string(buf[:k]); got != msg {
			t.Errorf("got %q, want %q", got, msg)
		}
	}
}

func TestNotifyWithoutASocketIsANoOp(t *testing.T) {
	if err := (Notifier{}).Notify(Ready); err != nil {
		t.Fatalf("zero Notifier: %v", err)
	}
	if err := FromEnv(func(string) string { return "" }).Notify(Watchdog); err != nil {
		t.Fatalf("unset NOTIFY_SOCKET: %v", err)
	}
}

func TestNotifyToAMissingSocketIsAnError(t *testing.T) {
	n := Notifier{Socket: filepath.Join(t.TempDir(), "absent.sock")}
	if err := n.Notify(Ready); err == nil {
		t.Fatal("want an error for a socket that does not exist")
	}
}
