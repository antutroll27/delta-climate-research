package ingest

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"deltaclimate.earth/obos-india/internal/cpcb"
)

var (
	testKey = bytes.Repeat([]byte{0x42}, 32)
	fixedAt = time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
)

// received is what the fake OBOS saw.
type received struct {
	method, kind, ts, sig, ctype, ua string
	body                             []byte
}

func fakeOBOS(t *testing.T, status int, answer string, got *received) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*got = received{r.Method, r.Header.Get("X-OBOS-Kind"), r.Header.Get("X-OBOS-Timestamp"),
			r.Header.Get("X-OBOS-Signature"), r.Header.Get("Content-Type"), r.Header.Get("User-Agent"), b}
		w.WriteHeader(status)
		io.WriteString(w, answer)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func client(url string) Client {
	return Client{URL: url, Key: testKey, UserAgent: "relay/test", Clock: func() time.Time { return fixedAt }}
}

func TestSubmitSendsASignedGzip(t *testing.T) {
	var got received
	srv := fakeOBOS(t, 200, `{"stored":"new","lastupdate":"2026-09-26T23:30:00.000Z","stations":481}`, &got)
	xml := []byte("<AqIndex>feed</AqIndex>")
	res, err := client(srv.URL).Submit(context.Background(), cpcb.Snapshot{Body: xml})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	want := Result{Stored: "new", LastUpdate: time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC), Stations: 481}
	if res.Stored != want.Stored || !res.LastUpdate.Equal(want.LastUpdate) || res.Stations != want.Stations {
		t.Errorf("Result = %+v, want %+v", res, want)
	}
	if got.method != "POST" || got.kind != "cpcb-feed" || got.ctype != "application/octet-stream" || got.ua != "relay/test" {
		t.Errorf("headers wrong: %+v", got)
	}
	if got.ts != strconv.FormatInt(fixedAt.Unix(), 10) {
		t.Errorf("timestamp = %s", got.ts)
	}
	if got.sig != Sign(testKey, fixedAt.Unix(), got.body) {
		t.Errorf("signature does not cover the body as sent")
	}
	zr, err := gzip.NewReader(bytes.NewReader(got.body))
	if err != nil {
		t.Fatalf("body is not gzip: %v", err)
	}
	if plain, _ := io.ReadAll(zr); !bytes.Equal(plain, xml) {
		t.Errorf("gunzipped body = %q, want the XML unchanged", plain)
	}
}

func TestSubmitErrors(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		answer     string
		want       error
		wantReason string
	}{
		{"401", 401, "", ErrRejected, ""},
		{"422 with reason", 422, `{"error":"too_few_stations"}`, ErrRejected, "too_few_stations"},
		{"413", 413, `{"error":"too_large"}`, ErrRejected, "too_large"},
		{"503", 503, `{"error":"store_failed"}`, ErrUnavailable, "store_failed"},
		{"500 no body", 500, "", ErrUnavailable, ""},
		{"200 garbage", 200, "not json", ErrUnavailable, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got received
			srv := fakeOBOS(t, tc.status, tc.answer, &got)
			_, err := client(srv.URL).Submit(context.Background(), cpcb.Snapshot{Body: []byte("x")})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			var se *StatusError
			if tc.wantReason != "" && (!errors.As(err, &se) || se.Reason != tc.wantReason) {
				t.Errorf("reason: %v", err)
			}
		})
	}
}

func TestSubmitNetworkFailureIsUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens any more
	_, err := client(url).Submit(context.Background(), cpcb.Snapshot{Body: []byte("x")})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestSubmitTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body) // the server notices a closed client only once the body is read
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer srv.Close()
	c := client(srv.URL)
	c.Timeout = 50 * time.Millisecond
	_, err := c.Submit(context.Background(), cpcb.Snapshot{Body: []byte("x")})
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want ErrUnavailable wrapping DeadlineExceeded", err)
	}
}

func TestPing(t *testing.T) {
	var got received
	srv := fakeOBOS(t, 204, "", &got)
	if err := client(srv.URL).Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if got.kind != "ping" || len(got.body) != 0 || got.sig != Sign(testKey, fixedAt.Unix(), nil) {
		t.Errorf("ping wrong: %+v", got)
	}

	srv401 := fakeOBOS(t, 401, "", &got)
	if err := client(srv401.URL).Ping(context.Background()); !errors.Is(err, ErrRejected) {
		t.Errorf("401 ping: %v, want ErrRejected", err)
	}
}

func TestErrorsNeverCarryTheKey(t *testing.T) {
	var got received
	srv := fakeOBOS(t, 401, `{"error":"unauthorized"}`, &got)
	_, err := client(srv.URL).Submit(context.Background(), cpcb.Snapshot{Body: []byte("x")})
	msg := err.Error()
	if strings.Contains(msg, hex.EncodeToString(testKey)) || strings.Contains(msg, got.sig) {
		t.Errorf("error leaks a secret: %s", msg)
	}
}
