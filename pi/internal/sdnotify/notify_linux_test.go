package sdnotify

import (
	"net"
	"os"
	"strconv"
	"testing"
)

// systemd may hand over an abstract socket ("@name"). Linux only: macOS has no
// abstract namespace, so on a Mac this path is unverified by design.
func TestNotifyToAnAbstractSocket(t *testing.T) {
	name := "@obos-india-test-" + strconv.Itoa(os.Getpid())
	ln, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: name, Net: "unixgram"})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	if err := (Notifier{Socket: name}).Notify(Ready); err != nil {
		t.Fatalf("Notify: %v", err)
	}
	expect(t, ln, Ready)
}
