package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
