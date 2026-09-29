package cpcb

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// realFeed is CPCB's feed as captured at 05:00 IST on 27 Sep 2026: 481 stations.
func realFeed(t *testing.T) []byte {
	t.Helper()
	f, err := os.Open("testdata/cpcb-feed-2026-09-27T0500IST.xml.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// feedOf builds a minimal well-formed feed of n stations sharing stamp.
func feedOf(n int, stamp string) []byte {
	var b strings.Builder
	b.WriteString("<?xml version='1.0'?>\n<AqIndex><Country id=\"India\"><State id=\"X\"><City id=\"Y\">\n")
	for i := range n {
		b.WriteString(`<Station id="S` + strings.Repeat("x", i%3) + `" lastupdate="` + stamp + `" latitude="22.5" longitude="88.3"></Station>` + "\n")
	}
	b.WriteString("</City></State></Country></AqIndex>\n")
	return []byte(b.String())
}

func TestCheckRealFeed(t *testing.T) {
	m, err := Check(realFeed(t))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if m.Stations != 481 {
		t.Errorf("Stations = %d, want 481", m.Stations)
	}
	if want := time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC); !m.LastUpdate.Equal(want) || m.LastUpdate.Location() != time.UTC {
		t.Errorf("LastUpdate = %v, want %v in UTC", m.LastUpdate, want)
	}
}

func TestCheckRejects(t *testing.T) {
	real := realFeed(t)
	mixed := bytes.Replace(real, []byte(`lastupdate="27-09-2026 05:00:00"`), []byte(`lastupdate="27-09-2026 04:00:00"`), 1)
	cases := []struct {
		name string
		body []byte
		want error
	}{
		{"truncated", real[:len(real)/2], ErrTruncated},
		{"oversize", append(bytes.Repeat([]byte(" "), MaxBytes), real...), ErrTooLarge},
		{"no AqIndex", []byte("<html><body>Service busy</body></html>"), ErrNotFeed},
		{"299 stations", feedOf(299, "27-09-2026 05:00:00"), ErrTooFewStations},
		{"mixed lastupdate", mixed, ErrMixedLastUpdate},
		{"bad date 31 Feb", feedOf(300, "31-02-2026 05:00:00"), ErrBadLastUpdate},
		{"bad hour 24", feedOf(300, "27-09-2026 24:00:00"), ErrBadLastUpdate},
		{"ISO date", feedOf(300, "2026-09-27 05:00:00"), ErrBadLastUpdate},
		{"no lastupdate", bytes.ReplaceAll(feedOf(300, "x"), []byte(`lastupdate="x" `), nil), ErrBadLastUpdate},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Check(tc.body); !errors.Is(err, tc.want) {
				t.Errorf("Check = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestCheckBoundary300Passes(t *testing.T) {
	m, err := Check(feedOf(300, "27-09-2026 05:00:00"))
	if err != nil || m.Stations != 300 {
		t.Fatalf("300 stations must pass: %v %+v", err, m)
	}
}

func TestFetch(t *testing.T) {
	real := realFeed(t)
	var gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		w.Write(real)
	}))
	defer srv.Close()
	f := Fetcher{URL: srv.URL, UserAgent: "delta-climate-research-relay/test"}
	snap, err := f.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if gotUA != "delta-climate-research-relay/test" {
		t.Errorf("User-Agent = %q", gotUA)
	}
	if !bytes.Equal(snap.Body, real) || snap.Meta.Stations != 481 {
		t.Errorf("snapshot wrong: stations %d", snap.Meta.Stations)
	}
}

func TestFetchFailures(t *testing.T) {
	real := realFeed(t)
	cases := []struct {
		name    string
		handler http.HandlerFunc
		want    error
	}{
		{"503", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }, ErrStatus},
		{"oversize while reading", func(w http.ResponseWriter, r *http.Request) {
			w.Write(real)
			w.Write(bytes.Repeat([]byte(" "), MaxBytes))
		}, ErrTooLarge},
		{"html", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>busy</html>")) }, ErrNotFeed},
		{"timeout", func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
		}, context.DeadlineExceeded},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			f := Fetcher{URL: srv.URL, UserAgent: "ua", Timeout: 100 * time.Millisecond}
			if _, err := f.Fetch(context.Background()); !errors.Is(err, tc.want) {
				t.Errorf("Fetch = %v, want %v", err, tc.want)
			}
		})
	}
}

// capReader serves 3 × MaxBytes of spaces and counts what Fetch reads, proving
// the cap is enforced while reading and not after buffering everything.
type capReader struct{ n int }

func (c *capReader) Read(p []byte) (int, error) {
	if c.n >= 3*MaxBytes {
		return 0, io.EOF
	}
	p = p[:min(len(p), 3*MaxBytes-c.n)]
	for i := range p {
		p[i] = ' '
	}
	c.n += len(p)
	return len(p), nil
}
func (c *capReader) Close() error { return nil }

// bodyTransport answers every request with 200 and body.
type bodyTransport struct{ body *capReader }

func (b bodyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Body: b.body, Header: http.Header{}}, nil
}

func TestFetchStopsReadingAtTheCap(t *testing.T) {
	big := &capReader{}
	f := Fetcher{URL: "http://cpcb.invalid/rss_feed", UserAgent: "ua", HTTP: &http.Client{Transport: bodyTransport{big}}}
	if _, err := f.Fetch(context.Background()); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	if big.n > MaxBytes+64*1024 {
		t.Errorf("read %d bytes of a 6 MB body; the cap is %d", big.n, MaxBytes)
	}
}
