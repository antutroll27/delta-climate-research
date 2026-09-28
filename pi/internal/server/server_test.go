package server

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"deltaclimate.earth/obos-india/internal/health"
	"deltaclimate.earth/obos-india/internal/relay"
)

const token = "tttttttttttttttttttttttttttttttt" // 32 characters; a test value

func testServer() *Server {
	temp := 51.5
	return &Server{
		Version:  "1.0.0-test",
		APIToken: token,
		State: func() relay.State {
			return relay.State{LastOutcome: relay.Submitted, Submitted: 3,
				LastUpdate: time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC)}
		},
		System: func() health.System { return health.System{CPUTempC: &temp, ClockSynced: true} },
	}
}

func do(t *testing.T, h http.Handler, method, path, auth string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealthz(t *testing.T) {
	rec := do(t, testServer().Handler(), "GET", "/healthz", "")
	if rec.Code != 200 || rec.Body.String() != "ok\n" {
		t.Errorf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestStatus(t *testing.T) {
	rec := do(t, testServer().Handler(), "GET", "/status", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("got %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	relayJSON := got["relay"].(map[string]any)
	systemJSON := got["system"].(map[string]any)
	if got["version"] != "1.0.0-test" || relayJSON["last_outcome"] != "submitted" || relayJSON["submitted"] != 3.0 ||
		relayJSON["last_update"] != "2026-09-26T23:30:00Z" || systemJSON["cpu_temp_c"] != 51.5 || systemJSON["disk_free_pct"] != nil {
		t.Errorf("status = %s", rec.Body.String())
	}
	if _, present := relayJSON["last_ok"]; present {
		t.Error("a zero time must be omitted, not reported as year 1")
	}
}

func TestMethodsOtherThanGETAre405(t *testing.T) {
	for _, path := range []string{"/healthz", "/status"} {
		if rec := do(t, testServer().Handler(), "POST", path, ""); rec.Code != 405 {
			t.Errorf("POST %s = %d, want 405", path, rec.Code)
		}
	}
}

func TestV1IsClosedBehindTheToken(t *testing.T) {
	h := testServer().Handler()
	cases := []struct {
		name, auth string
		want       int
	}{
		{"no header", "", 401},
		{"wrong token, same length", "Bearer " + strings.Repeat("u", 32), 401},
		{"right token, last char wrong", "Bearer " + token[:31] + "x", 401},
		{"token as Basic", "Basic " + token, 401},
		{"right token: no route yet", "Bearer " + token, 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := do(t, h, "GET", "/v1/anything", tc.auth); rec.Code != tc.want {
				t.Errorf("got %d, want %d", rec.Code, tc.want)
			}
		})
	}
	closed := testServer()
	closed.APIToken = ""
	if rec := do(t, closed.Handler(), "GET", "/v1/anything", "Bearer "); rec.Code != 401 {
		t.Errorf("no token configured: got %d, want 401", rec.Code)
	}
}

func TestServeShutsDownGracefully(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- testServer().Serve(ctx, ln) }()

	resp, err := http.Get("http://" + ln.Addr().String() + "/healthz")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "ok\n" {
		t.Fatalf("healthz = %q", b)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Serve returned %v, want nil after shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after the context ended")
	}
}
