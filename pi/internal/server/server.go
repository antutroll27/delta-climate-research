// Package server is obos-india's local HTTP API: GET /healthz, GET /status, and
// the /v1/ extension point for future India APIs, closed behind a bearer token.
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"deltaclimate.earth/obos-india/internal/health"
	"deltaclimate.earth/obos-india/internal/relay"
)

// ShutdownTimeout bounds a graceful shutdown.
const ShutdownTimeout = 10 * time.Second

// Status is the body of GET /status.
type Status struct {
	Version string        `json:"version"`
	Relay   relay.State   `json:"relay"`
	System  health.System `json:"system"`
}

// Server serves the local API. State and System are read on every /status request.
type Server struct {
	Version  string
	APIToken string               // empty: every /v1/ request is 401
	State    func() relay.State   // required
	System   func() health.System // required
	Log      *slog.Logger         // nil: slog.Default()
}

// Handler returns the routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(Status{Version: s.Version, Relay: s.State(), System: s.System()})
	})
	v1 := http.NewServeMux() // future India APIs register here; none exist yet
	mux.Handle("/v1/", s.requireToken(v1))
	return mux
}

// requireToken admits only "Authorization: Bearer <APIToken>", compared in
// constant time. With no token configured, nothing is admitted.
func (s *Server) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if s.APIToken == "" || !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.APIToken)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="obos-india"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Serve answers on ln until ctx ends, then shuts down gracefully. It returns nil
// after a clean shutdown.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	log.Info("server listening", "addr", ln.Addr().String())

	select {
	case err := <-errc:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("server: shutdown: %w", err)
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server: %w", err)
	}
	return nil
}
