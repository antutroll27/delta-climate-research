// Package config reads and validates obos-india's settings from the environment.
//
// Every rule lives in Load, so a bad value stops the program at start-up with the
// variable's name and the rule it broke. A FieldError never contains the value:
// RELAY_HMAC_KEY and API_TOKEN are secrets.
package config

import (
	"bufio"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Defaults, per spec 2026-09-29 §6.
const (
	DefaultIngestURL  = "https://deltaclimate.earth/api/air-quality-ingest"
	DefaultFeedURL    = "https://airquality.cpcb.gov.in/caaqms/rss_feed"
	DefaultInterval   = 15 * time.Minute
	MinInterval       = 5 * time.Minute
	DefaultMaxFeedAge = 3 * time.Hour
	MinMaxFeedAge     = time.Hour // CPCB publishes hourly: less would alert every hour
	DefaultListenAddr = "127.0.0.1:8787"
	MinKeyBytes       = 32
	MinAPITokenLen    = 32
	// DefaultEnvFile is the file setup.sh writes and systemd loads.
	DefaultEnvFile = "/etc/obos-india/env"
)

// Config is obos-india's validated configuration.
type Config struct {
	IngestURL      string        // OBOS_INGEST_URL
	HMACKey        []byte        // RELAY_HMAC_KEY (hex), required, at least 32 bytes
	FeedURL        string        // CPCB_FEED_URL
	Interval       time.Duration // RELAY_INTERVAL, at least 5m
	MaxFeedAge     time.Duration // MAX_FEED_AGE, at least 1h: an older CPCB feed alerts
	HealthcheckURL string        // HEALTHCHECK_URL, optional, no trailing slash
	ListenAddr     string        // LISTEN_ADDR, loopback host:port (/status is unauthenticated)
	APIToken       string        // API_TOKEN, optional; /v1 stays closed without it
}

// FieldError says which variable broke which rule. It never carries the value.
type FieldError struct {
	Var    string
	Reason string
}

func (e *FieldError) Error() string { return "config: " + e.Var + ": " + e.Reason }

// UserAgent is the identifying User-Agent for every outbound request.
func UserAgent(version string) string {
	return "delta-climate-research-relay/" + version + " (+https://deltaclimate.earth)"
}

// Load builds a Config from env, applying defaults and validating every field.
// The first rule broken is returned as a *FieldError.
func Load(env map[string]string) (Config, error) {
	c := Config{
		IngestURL:      orDefault(env["OBOS_INGEST_URL"], DefaultIngestURL),
		FeedURL:        orDefault(env["CPCB_FEED_URL"], DefaultFeedURL),
		Interval:       DefaultInterval,
		MaxFeedAge:     DefaultMaxFeedAge,
		HealthcheckURL: strings.TrimRight(env["HEALTHCHECK_URL"], "/"),
		ListenAddr:     orDefault(env["LISTEN_ADDR"], DefaultListenAddr),
		APIToken:       env["API_TOKEN"],
	}

	keyHex := env["RELAY_HMAC_KEY"]
	if keyHex == "" {
		return Config{}, &FieldError{"RELAY_HMAC_KEY", "required"}
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return Config{}, &FieldError{"RELAY_HMAC_KEY", "must be hex"}
	}
	if len(key) < MinKeyBytes {
		return Config{}, &FieldError{"RELAY_HMAC_KEY", fmt.Sprintf("must be at least %d bytes (%d hex characters)", MinKeyBytes, 2*MinKeyBytes)}
	}
	c.HMACKey = key

	for _, f := range []struct{ name, value string }{
		{"OBOS_INGEST_URL", c.IngestURL},
		{"CPCB_FEED_URL", c.FeedURL},
		{"HEALTHCHECK_URL", c.HealthcheckURL},
	} {
		if f.value == "" && f.name == "HEALTHCHECK_URL" {
			continue
		}
		if reason := checkURL(f.value); reason != "" {
			return Config{}, &FieldError{f.name, reason}
		}
	}

	for _, d := range []struct {
		name string
		min  time.Duration
		dst  *time.Duration
	}{
		{"RELAY_INTERVAL", MinInterval, &c.Interval},
		{"MAX_FEED_AGE", MinMaxFeedAge, &c.MaxFeedAge},
	} {
		s := env[d.name]
		if s == "" {
			continue
		}
		v, err := time.ParseDuration(s)
		if err != nil {
			return Config{}, &FieldError{d.name, "must be a duration such as " + d.dst.String()}
		}
		if v < d.min {
			return Config{}, &FieldError{d.name, "must be at least " + d.min.String()}
		}
		*d.dst = v
	}

	host, port, err := net.SplitHostPort(c.ListenAddr)
	if err != nil || host == "" {
		return Config{}, &FieldError{"LISTEN_ADDR", "must be host:port"}
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return Config{}, &FieldError{"LISTEN_ADDR", "port must be 1-65535"}
	}
	if host != "localhost" && !net.ParseIP(host).IsLoopback() {
		return Config{}, &FieldError{"LISTEN_ADDR", "host must be loopback (127.0.0.1, ::1 or localhost); reach it over Tailscale SSH"}
	}

	if c.APIToken != "" && len(c.APIToken) < MinAPITokenLen {
		return Config{}, &FieldError{"API_TOKEN", fmt.Sprintf("must be at least %d characters", MinAPITokenLen)}
	}
	return c, nil
}

// checkURL returns "" for an absolute https URL, or an http URL to a loopback host
// (the local rehearsal); otherwise the reason it is refused.
func checkURL(s string) string {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "must be an absolute URL"
	}
	switch u.Scheme {
	case "https":
		return ""
	case "http":
		if h := u.Hostname(); h == "localhost" || net.ParseIP(h).IsLoopback() {
			return ""
		}
		return "http is allowed only for a loopback host; use https"
	default:
		return "must be https"
	}
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

var envKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ReadEnvFile parses a systemd EnvironmentFile: KEY=VALUE lines, optionally
// prefixed "export ", blank lines and # or ; comments ignored, one pair of
// surrounding quotes removed. A missing file is an
// error wrapping fs.ErrNotExist, so callers can treat it as empty.
func ReadEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		k, v, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if !ok || !envKey.MatchString(k) {
			return nil, fmt.Errorf("config: %s line %d: %w", path, n, ErrBadEnvLine)
		}
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		out[k] = v
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("config: %s: %w", path, err)
	}
	return out, nil
}

// ErrBadEnvLine marks a line of an env file that is not KEY=VALUE.
var ErrBadEnvLine = errors.New("not a KEY=VALUE line")

// Environ turns os.Environ-style "KEY=VALUE" pairs into a map.
func Environ(pairs []string) map[string]string {
	out := make(map[string]string, len(pairs))
	for _, p := range pairs {
		if k, v, ok := strings.Cut(p, "="); ok {
			out[k] = v
		}
	}
	return out
}

// Merge returns base overlaid by over: a variable set in over wins.
func Merge(base, over map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(over))
	maps.Copy(out, base)
	maps.Copy(out, over)
	return out
}
