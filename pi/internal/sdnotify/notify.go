// Package sdnotify speaks systemd's notify protocol: one datagram per message to
// the unix socket named by NOTIFY_SOCKET. With no socket it does nothing, so the
// program runs the same outside systemd.
package sdnotify

import (
	"fmt"
	"net"
)

// The messages obos-india sends.
const (
	Ready    = "READY=1"
	Watchdog = "WATCHDOG=1"
	Stopping = "STOPPING=1"
)

// Notifier sends to one socket. The zero value is a no-op.
type Notifier struct {
	Socket string // NOTIFY_SOCKET; a leading '@' names an abstract socket
}

// FromEnv reads NOTIFY_SOCKET through getenv (os.Getenv in production).
func FromEnv(getenv func(string) string) Notifier {
	return Notifier{Socket: getenv("NOTIFY_SOCKET")}
}

// Notify sends state, such as Ready. It is a no-op when Socket is empty.
func (n Notifier) Notify(state string) error {
	if n.Socket == "" {
		return nil
	}
	name := n.Socket
	if name[0] == '@' {
		name = "\x00" + name[1:]
	}
	conn, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: name, Net: "unixgram"})
	if err != nil {
		return fmt.Errorf("sdnotify: dial: %w", err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(state)); err != nil {
		return fmt.Errorf("sdnotify: write: %w", err)
	}
	return nil
}
