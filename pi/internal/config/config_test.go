package config

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// key64 is 32 bytes of hex: the shortest valid RELAY_HMAC_KEY. A test value, not a secret.
const key64 = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func env(kv ...string) map[string]string {
	m := map[string]string{"RELAY_HMAC_KEY": key64}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return m
}

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env())
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.IngestURL != DefaultIngestURL || c.FeedURL != DefaultFeedURL || c.Interval != 15*time.Minute || c.MaxFeedAge != 3*time.Hour ||
		c.ListenAddr != "127.0.0.1:8787" || c.HealthcheckURL != "" || c.APIToken != "" || len(c.HMACKey) != 32 {
		t.Errorf("defaults wrong: %+v", c)
	}
}

func TestLoadAcceptsValidOverrides(t *testing.T) {
	c, err := Load(env(
		"OBOS_INGEST_URL", "http://127.0.0.1:8788/api/air-quality-ingest",
		"CPCB_FEED_URL", "http://localhost:9000/rss_feed",
		"RELAY_INTERVAL", "5m",
		"MAX_FEED_AGE", "1h",
		"HEALTHCHECK_URL", "https://hc-ping.com/abc/",
		"LISTEN_ADDR", "[::1]:9090",
		"API_TOKEN", strings.Repeat("t", 32),
	))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Interval != 5*time.Minute || c.MaxFeedAge != time.Hour || c.HealthcheckURL != "https://hc-ping.com/abc" || c.ListenAddr != "[::1]:9090" {
		t.Errorf("overrides wrong: %+v", c)
	}
}

func TestLoadRules(t *testing.T) {
	cases := []struct {
		name, varName string
		env           map[string]string
	}{
		{"key missing", "RELAY_HMAC_KEY", map[string]string{}},
		{"key not hex", "RELAY_HMAC_KEY", map[string]string{"RELAY_HMAC_KEY": strings.Repeat("zz", 32)}},
		{"key odd length", "RELAY_HMAC_KEY", map[string]string{"RELAY_HMAC_KEY": key64 + "0"}},
		{"key 31 bytes", "RELAY_HMAC_KEY", map[string]string{"RELAY_HMAC_KEY": key64[:62]}},
		{"ingest not https", "OBOS_INGEST_URL", env("OBOS_INGEST_URL", "http://deltaclimate.earth/api/air-quality-ingest")},
		{"ingest relative", "OBOS_INGEST_URL", env("OBOS_INGEST_URL", "/api/air-quality-ingest")},
		{"ingest ftp", "OBOS_INGEST_URL", env("OBOS_INGEST_URL", "ftp://deltaclimate.earth/x")},
		{"feed not https", "CPCB_FEED_URL", env("CPCB_FEED_URL", "http://airquality.cpcb.gov.in/caaqms/rss_feed")},
		{"healthcheck not https", "HEALTHCHECK_URL", env("HEALTHCHECK_URL", "http://hc-ping.com/abc")},
		{"interval not a duration", "RELAY_INTERVAL", env("RELAY_INTERVAL", "15")},
		{"interval below 5m", "RELAY_INTERVAL", env("RELAY_INTERVAL", "4m59s")},
		{"feed age not a duration", "MAX_FEED_AGE", env("MAX_FEED_AGE", "3")},
		{"feed age below 1h", "MAX_FEED_AGE", env("MAX_FEED_AGE", "59m")},
		{"listen without port", "LISTEN_ADDR", env("LISTEN_ADDR", "127.0.0.1")},
		{"listen without host", "LISTEN_ADDR", env("LISTEN_ADDR", ":8787")},
		{"listen port 0", "LISTEN_ADDR", env("LISTEN_ADDR", "127.0.0.1:0")},
		{"listen port 65536", "LISTEN_ADDR", env("LISTEN_ADDR", "127.0.0.1:65536")},
		{"listen on every interface", "LISTEN_ADDR", env("LISTEN_ADDR", "0.0.0.0:8787")},
		{"listen on the LAN", "LISTEN_ADDR", env("LISTEN_ADDR", "192.168.1.20:8787")},
		{"listen on a hostname", "LISTEN_ADDR", env("LISTEN_ADDR", "obos-relay-1:8787")},
		{"api token too short", "API_TOKEN", env("API_TOKEN", strings.Repeat("t", 31))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(tc.env)
			var fe *FieldError
			if !errors.As(err, &fe) {
				t.Fatalf("want *FieldError, got %v", err)
			}
			if fe.Var != tc.varName {
				t.Errorf("Var = %s, want %s", fe.Var, tc.varName)
			}
		})
	}
}

func TestFieldErrorNeverCarriesTheValue(t *testing.T) {
	secret := strings.Repeat("ab", 31) // 31 bytes: too short, so it errors
	_, err := Load(map[string]string{"RELAY_HMAC_KEY": secret})
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("error must exist and must not contain the key: %v", err)
	}
	notHex := strings.Repeat("zq", 32)
	_, err = Load(map[string]string{"RELAY_HMAC_KEY": notHex})
	if err == nil || strings.Contains(err.Error(), notHex) {
		t.Fatalf("error must exist and must not contain a non-hex key: %v", err)
	}
	token := strings.Repeat("s", 31)
	_, err = Load(env("API_TOKEN", token))
	if err == nil || strings.Contains(err.Error(), token) {
		t.Fatalf("error must exist and must not contain the token: %v", err)
	}
}

func TestUserAgent(t *testing.T) {
	if got := UserAgent("1.2.3"); got != "delta-climate-research-relay/1.2.3 (+https://deltaclimate.earth)" {
		t.Errorf("UserAgent = %q", got)
	}
}

func TestReadEnvFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "env")
	body := "# written by setup.sh\n\n; a systemd-style comment\nexport RELAY_HMAC_KEY=" + key64 + "\nHEALTHCHECK_URL=\"https://hc-ping.com/abc\"\nAPI_TOKEN=\n"
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadEnvFile(p)
	if err != nil {
		t.Fatalf("ReadEnvFile: %v", err)
	}
	if got["RELAY_HMAC_KEY"] != key64 || got["HEALTHCHECK_URL"] != "https://hc-ping.com/abc" || got["API_TOKEN"] != "" || len(got) != 3 {
		t.Errorf("parsed %v", got)
	}

	if _, err := ReadEnvFile(filepath.Join(dir, "missing")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("missing file: want fs.ErrNotExist, got %v", err)
	}
	bad := filepath.Join(dir, "bad")
	if err := os.WriteFile(bad, []byte("export RELAY_HMAC_KEY\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadEnvFile(bad); !errors.Is(err, ErrBadEnvLine) {
		t.Errorf("bad line: want ErrBadEnvLine, got %v", err)
	}
}

func TestEnvironAndMerge(t *testing.T) {
	m := Environ([]string{"A=1", "B=x=y", "NOEQUALS"})
	if m["A"] != "1" || m["B"] != "x=y" || len(m) != 2 {
		t.Errorf("Environ = %v", m)
	}
	got := Merge(map[string]string{"A": "file", "B": "file"}, map[string]string{"B": "process"})
	if got["A"] != "file" || got["B"] != "process" {
		t.Errorf("Merge = %v", got)
	}
}
