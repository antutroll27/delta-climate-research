// Package parity holds the tests that gate the Go pipeline against the rasterio one.
//
// These are not unit tests. They compare this implementation against fixtures dumped
// from the live GDAL pipeline by scripts/dump-parity-oracle.py, on real cached
// ECOSTRESS granules. The Python implementation stays in the repo, so this is a
// permanent second opinion rather than a one-off migration check: if either side drifts,
// this fails.
//
// If a case here cannot be made to pass, the correct response is to STOP and keep the
// Python for that stage — not to loosen the tolerance. A projection or reader that is
// almost right does not crash; it publishes wrong numbers.
package parity

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/antutroll27/delta-climate/go/internal/geo"
)

const oracleDir = "../../tests/fixtures/geo-oracle"

type boundsCase struct {
	Src            string    `json:"src"`
	Dst            string    `json:"dst"`
	Bounds4326     []float64 `json:"bounds4326"`
	Densify21      []float64 `json:"densify21"`
	Naive4Corner   []float64 `json:"naive4corner"`
	DensifyDeltaM  []float64 `json:"densifyDeltaM"`
}

type gridCase struct {
	Bbox4326  []float64 `json:"bbox4326"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Res       float64   `json:"res"`
	Transform []float64 `json:"transform"`
}

type oracle struct {
	Rasterio        string                `json:"rasterio"`
	GDAL            string                `json:"gdal"`
	TargetCRS       string                `json:"targetCrs"`
	TargetRes       float64               `json:"targetRes"`
	DensifyPts      int                   `json:"densifyPts"`
	TransformBounds map[string]boundsCase `json:"transformBounds"`
	TargetGrid      map[string]gridCase   `json:"targetGrid"`
	FromBounds      struct {
		Scene struct {
			CRS       string    `json:"crs"`
			Width     int       `json:"width"`
			Height    int       `json:"height"`
			Transform []float64 `json:"transform"`
		} `json:"scene"`
		Windows map[string]struct {
			Bounds4326     []float64 `json:"bounds4326"`
			BoundsSceneCRS []float64 `json:"boundsSceneCrs"`
			ColOff         float64   `json:"colOff"`
			RowOff         float64   `json:"rowOff"`
			Width          float64   `json:"width"`
			Height         float64   `json:"height"`
		} `json:"windows"`
	} `json:"fromBounds"`
}

func load(t *testing.T) oracle {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(oracleDir, "oracle.json"))
	if err != nil {
		t.Skipf("no oracle present (%v) — run: python3 scripts/dump-parity-oracle.py", err)
	}
	var o oracle
	if err := json.Unmarshal(b, &o); err != nil {
		t.Fatalf("oracle.json is unreadable: %v", err)
	}
	return o
}

func TestTransformBoundsMatchesGDAL(t *testing.T) {
	o := load(t)
	if o.DensifyPts != 21 {
		t.Fatalf("oracle was built with densifyPts=%d; the pipeline uses 21", o.DensifyPts)
	}
	// Sub-metre. The grid is 70 m, so anything at this scale is 1/70th of a pixel —
	// but a systematic error would show up as a constant offset across all boxes, and
	// this tolerance is tight enough to catch a wrong ellipsoid or scale factor.
	const tolM = 0.01

	for name, c := range o.TransformBounds {
		if c.Dst != "EPSG:32645" {
			t.Fatalf("%s: oracle targets %s, this port only implements EPSG:32645", name, c.Dst)
		}
		w, s, e, n := c.Bounds4326[0], c.Bounds4326[1], c.Bounds4326[2], c.Bounds4326[3]
		gl, gb, gr, gt := geo.Zone45N.TransformBounds(w, s, e, n, o.DensifyPts)
		for i, got := range []float64{gl, gb, gr, gt} {
			if d := math.Abs(got - c.Densify21[i]); d > tolM {
				t.Errorf("%s: bound[%d] = %.4f, GDAL = %.4f (off by %.4f m)",
					name, i, got, c.Densify21[i], d)
			}
		}
	}
}

// The densification is unobservable on the boxes this pipeline uses (measured 0.0 m),
// so a naive four-corner implementation would pass every real case. This asserts the
// guard box behaves the other way — proving densification is actually implemented.
func TestDensificationIsActuallyImplemented(t *testing.T) {
	o := load(t)
	c, ok := o.TransformBounds["guard-zonewide-6deg"]
	if !ok {
		t.Skip("oracle has no zone-wide guard case; regenerate it")
	}
	w, s, e, n := c.Bounds4326[0], c.Bounds4326[1], c.Bounds4326[2], c.Bounds4326[3]

	dense := [4]float64{}
	dense[0], dense[1], dense[2], dense[3] = geo.Zone45N.TransformBounds(w, s, e, n, 21)
	naive := [4]float64{}
	naive[0], naive[1], naive[2], naive[3] = geo.Zone45N.TransformBounds(w, s, e, n, 0)

	// GDAL says these differ by ~2.8 km on this box. If our two paths agree, our
	// "densified" code is silently doing four corners.
	var maxSelfGap float64
	for i := range dense {
		maxSelfGap = math.Max(maxSelfGap, math.Abs(dense[i]-naive[i]))
	}
	wantGap := 0.0
	for _, d := range c.DensifyDeltaM {
		wantGap = math.Max(wantGap, d)
	}
	if wantGap < 100 {
		t.Fatalf("guard box is too small to discriminate (GDAL gap %.1f m)", wantGap)
	}
	if maxSelfGap < wantGap/2 {
		t.Errorf("densify appears to be a no-op: our dense-vs-naive gap is %.1f m, "+
			"GDAL's is %.1f m — the edge sampling is probably not happening",
			maxSelfGap, wantGap)
	}
	// And the densified result must still match GDAL on this box.
	for i, got := range dense {
		if d := math.Abs(got - c.Densify21[i]); d > 1.0 {
			t.Errorf("guard bound[%d] = %.2f, GDAL = %.2f (off by %.2f m)",
				i, got, c.Densify21[i], d)
		}
	}
}

func TestTargetGridMatchesGDAL(t *testing.T) {
	o := load(t)
	for name, c := range o.TargetGrid {
		w, s, e, n := c.Bbox4326[0], c.Bbox4326[1], c.Bbox4326[2], c.Bbox4326[3]
		tf, gw, gh := geo.TargetGrid(w, s, e, n, c.Res, geo.Zone45N, o.DensifyPts)

		// Width and height are EXACT — they come from a ceil() and a one-column
		// difference re-registers every layer against the world.
		if gw != c.Width || gh != c.Height {
			t.Errorf("%s: grid %dx%d, GDAL %dx%d", name, gw, gh, c.Width, c.Height)
		}
		got := []float64{tf.A, tf.B, tf.C, tf.D, tf.E, tf.F}
		for i := range got {
			if d := math.Abs(got[i] - c.Transform[i]); d > 0.01 {
				t.Errorf("%s: transform[%d] = %.4f, GDAL = %.4f", name, i, got[i], c.Transform[i])
			}
		}
		if tf.E >= 0 {
			t.Errorf("%s: transform E = %.4f, must be negative for a north-up grid", name, tf.E)
		}
	}
}

func TestFromBoundsMatchesGDAL(t *testing.T) {
	o := load(t)
	if len(o.FromBounds.Windows) == 0 {
		t.Skip("oracle has no window cases")
	}
	tr := o.FromBounds.Scene.Transform
	scene := geo.Affine{A: tr[0], B: tr[1], C: tr[2], D: tr[3], E: tr[4], F: tr[5]}

	for name, c := range o.FromBounds.Windows {
		// Use GDAL's own reprojected bounds here, so this test isolates from_bounds
		// rather than re-testing the projection.
		b := c.BoundsSceneCRS
		win := geo.FromBounds(b[0], b[1], b[2], b[3], scene)

		// Sub-hundredth of a pixel. rasterio returns fractional offsets and carries
		// them into resampling, so we must too.
		const tolPx = 0.01
		for _, f := range []struct {
			label    string
			got, exp float64
		}{
			{"colOff", win.ColOff, c.ColOff},
			{"rowOff", win.RowOff, c.RowOff},
			{"width", win.Width, c.Width},
			{"height", win.Height, c.Height},
		} {
			if d := math.Abs(f.got - f.exp); d > tolPx {
				t.Errorf("%s: %s = %.4f, GDAL = %.4f", name, f.label, f.got, f.exp)
			}
		}
	}
}

// Round-tripping every ward centre through the projection and back must return the
// input. Catches a forward/inverse mismatch that a one-directional test would miss.
func TestForwardInverseRoundTrip(t *testing.T) {
	for _, w := range []struct {
		name     string
		lon, lat float64
	}{
		{"ballygunge", 88.3659, 22.528},
		{"baruipur", 88.4319, 22.3654},
		{"barrackpore", 88.3713, 22.7621},
		{"central meridian", 87.0, 22.5},
		{"zone edge west", 84.0, 22.5},
		{"zone edge east", 90.0, 22.5},
	} {
		x, y := geo.Zone45N.Forward(w.lon, w.lat)
		lon, lat := geo.Zone45N.Inverse(x, y)
		// 1e-7 degrees is ~1 cm. Snyder's series closes to ~0.2 mm at the ward
		// centres and ~2e-9 deg at the zone edges 3 deg off the central meridian,
		// so this has ~50x headroom while still being 7000x tighter than the 70 m
		// pixel it feeds. An earlier 1e-9 bound failed at the edges purely because
		// it was tighter than the expansion's own truncation, not because anything
		// was wrong.
		const tolDeg = 1e-7
		if math.Abs(lon-w.lon) > tolDeg || math.Abs(lat-w.lat) > tolDeg {
			t.Errorf("%s: round trip (%.6f,%.6f) -> (%.1f,%.1f) -> (%.9f,%.9f)",
				w.name, w.lon, w.lat, x, y, lon, lat)
		}
	}
}
