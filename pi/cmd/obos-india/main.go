// Command obos-india is the Raspberry Pi service: it relays CPCB's live feed to
// OBOS and serves a small local API. Spec: docs/superpowers/specs/2026-09-29-pi-india-service-design.md
//
//	obos-india serve        run under systemd: relay every RELAY_INTERVAL, serve the API
//	obos-india relay-once   one relay cycle, then exit (0 if submitted or unchanged)
//	obos-india doctor       run the self-checks, print ✅/❌, exit 1 if any fails
//	obos-india version      print the version
//
// Configuration is the environment, over the file named by -env
// (default /etc/obos-india/env). main only wires; every behaviour lives in internal/.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"deltaclimate.earth/obos-india/internal/config"
	"deltaclimate.earth/obos-india/internal/cpcb"
	"deltaclimate.earth/obos-india/internal/doctor"
	"deltaclimate.earth/obos-india/internal/health"
	"deltaclimate.earth/obos-india/internal/ingest"
	"deltaclimate.earth/obos-india/internal/relay"
	"deltaclimate.earth/obos-india/internal/sdnotify"
	"deltaclimate.earth/obos-india/internal/server"
)

// version is set at build time: -ldflags "-X main.version=…".
var version = "dev"

const (
	clockWaitMax = 10 * time.Minute
	clockPoll    = 5 * time.Second
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Stdout, os.Stderr, config.Environ(os.Environ()))
	stop()
	os.Exit(code)
}

// run is main without the process: it returns the exit code.
func run(ctx context.Context, args []string, stdout, stderr io.Writer, env map[string]string) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	fset := flag.NewFlagSet(args[0], flag.ContinueOnError)
	fset.SetOutput(stderr)
	envFile := fset.String("env", config.DefaultEnvFile, "environment file (KEY=VALUE lines); the process environment wins")
	if err := fset.Parse(args[1:]); err != nil {
		return 2
	}
	log := slog.New(slog.NewTextHandler(stdout, nil))

	switch args[0] {
	case "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "serve":
		cfg, err := loadConfig(*envFile, env)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := serve(ctx, cfg, env, log); err != nil {
			log.Error("serve stopped", "error", err.Error())
			return 1
		}
		return 0
	case "relay-once":
		cfg, err := loadConfig(*envFile, env)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if !newJob(cfg, log).RunOnce(ctx).OK() {
			return 1
		}
		return 0
	case "doctor":
		cfg, err := loadConfig(*envFile, env)
		rep := doctor.Run(ctx, doctor.Checks(doctorDeps(cfg, err)))
		rep.Print(stdout)
		return rep.ExitCode()
	default:
		usage(stderr)
		return 2
	}
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: obos-india serve|relay-once|doctor|version [-env FILE]")
}

// loadConfig reads the env file (a missing file is fine) under the process environment.
func loadConfig(path string, env map[string]string) (config.Config, error) {
	file, err := config.ReadEnvFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return config.Config{}, err
	}
	return config.Load(config.Merge(file, env))
}

func newJob(cfg config.Config, log *slog.Logger) *relay.Job {
	ua := config.UserAgent(version)
	return &relay.Job{
		Fetcher:     cpcb.Fetcher{URL: cfg.FeedURL, UserAgent: ua},
		Client:      ingest.Client{URL: cfg.IngestURL, Key: cfg.HMACKey, UserAgent: ua},
		Healthcheck: relay.Healthcheck{URL: cfg.HealthcheckURL},
		MaxFeedAge:  cfg.MaxFeedAge,
		Log:         log,
	}
}

func doctorDeps(cfg config.Config, cfgErr error) doctor.Deps {
	d := doctor.Deps{ConfigErr: cfgErr, Systemctl: doctor.Systemctl, ServiceName: "obos-india"}
	if cfgErr == nil {
		job := newJob(cfg, slog.New(slog.DiscardHandler))
		d.FetchCPCB = func(ctx context.Context) (cpcb.Meta, error) {
			snap, err := job.Fetcher.Fetch(ctx)
			return snap.Meta, err
		}
		d.PingOBOS = job.Client.Ping
	}
	return d
}

// serve runs until ctx ends: the API, the relay loop and the systemd watchdog.
func serve(ctx context.Context, cfg config.Config, env map[string]string, log *slog.Logger) error {
	notifier := sdnotify.Notifier{Socket: env["NOTIFY_SOCKET"]}
	reader := health.Reader{}
	job := newJob(cfg, log)
	srv := &server.Server{Version: version, APIToken: cfg.APIToken, State: job.State, System: reader.Read, Log: log}

	ln, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ctx, ln) }()

	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		job.Loop(ctx, cfg.Interval, func(ctx context.Context) bool {
			return reader.WaitClockSync(ctx, clockWaitMax, clockPoll)
		})
	}()

	if err := notifier.Notify(sdnotify.Ready); err != nil {
		log.Warn("sd_notify failed", "error", err.Error())
	}
	log.Info("obos-india started", "version", version, "interval", cfg.Interval.String())

	watchdog := time.NewTicker(sdnotify.WatchdogInterval(env["WATCHDOG_USEC"]))
	defer watchdog.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = notifier.Notify(sdnotify.Stopping)
			<-relayDone
			return <-serveErr
		case err := <-serveErr:
			return err
		case <-watchdog.C:
			_ = notifier.Notify(sdnotify.Watchdog)
		}
	}
}
