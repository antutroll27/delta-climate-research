// Package sdnotify speaks systemd's notify protocol: one datagram per message to
// the unix socket named by NOTIFY_SOCKET. With no socket it does nothing, so the
// program runs the same outside systemd.
package sdnotify

import (
	"fmt"
	"net"
	"strconv"
	"time"
)

// The messages obos-india sends.
const (
	Ready    = "READY=1"
	Watchdog = "WATCHDOG=1"
	Stopping = "STOPPING=1"
)

// DefaultWatchdogInterval is used when systemd sets no WATCHDOG_USEC.
const DefaultWatchdogInterval = 30 * time.Second

// Notifier sends to one socket. The zero value is a no-op.
type Notifier struct {
	// Socket is NOTIFY_SOCKET. A leading '@' names an abstract socket, which the
	// net package already maps to a leading NUL on Linux.
	Socket string
}

// Notify sends state, such as Ready. It is a no-op when Socket is empty.
func (n Notifier) Notify(state string) error {
	if n.Socket == "" {
		return nil
	}
	conn, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: n.Socket, Net: "unixgram"})
	if err != nil {
		return fmt.Errorf("sdnotify: dial: %w", err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(state)); err != nil {
		return fmt.Errorf("sdnotify: write: %w", err)
	}
	return nil
}

// WatchdogInterval is half of systemd's WATCHDOG_USEC (microseconds), as
// sd_watchdog_enabled(3) advises, or DefaultWatchdogInterval if it is unset or bad.
func WatchdogInterval(usec string) time.Duration {
	n, err := strconv.ParseInt(usec, 10, 64)
	if err != nil || n <= 0 {
		return DefaultWatchdogInterval
	}
	return time.Duration(n) * time.Microsecond / 2
}
