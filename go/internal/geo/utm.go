// Package geo is the slice of GDAL this pipeline actually needs, in pure Go.
//
// Scope is deliberately narrow and measured rather than guessed. The Python pipeline
// uses exactly one projected CRS pair — EPSG:4326 (WGS84 geographic) to EPSG:32645
// (WGS84 / UTM zone 45N, Kolkata) — GeoTIFF only, and nothing else GDAL offers. So
// this is ~5% of GDAL, not a reimplementation of it.
//
// Everything here is verified against the rasterio/GDAL output captured by
// scripts/dump-parity-oracle.py. The Python implementation stays in place; these are
// not a replacement so much as a second opinion that must agree.
package geo

import "math"

// WGS84 ellipsoid.
const (
	wgs84A  = 6378137.0            // semi-major axis, metres
	wgs84F  = 1 / 298.257223563    // flattening
	utmK0   = 0.9996               // UTM scale factor on the central meridian
	utmFalseEasting = 500000.0     // metres
)

// Zone45N is EPSG:32645 — WGS84 / UTM zone 45N. Central meridian 87°E.
//
// Kolkata sits at ~88.3–88.45°E, so roughly 1.4° east of the central meridian. That
// matters for one thing: it is why densified bounds transforms are indistinguishable
// from four-corner ones here (measured: 0.0 m over the pipeline's boxes, 2.8 km only
// once a box reaches 6°). See TransformBounds.
var Zone45N = TransverseMercator{CentralMeridianDeg: 87.0}

// TransverseMercator is the projection family EPSG:32645 belongs to.
type TransverseMercator struct {
	CentralMeridianDeg float64
}

// Ellipsoid constants derived once. e2 is first eccentricity squared, ep2 the second.
var (
	e2  = 2*wgs84F - wgs84F*wgs84F
	ep2 = e2 / (1 - e2)
	e1  = (1 - math.Sqrt(1-e2)) / (1 + math.Sqrt(1-e2))
)

// meridionalArc is the distance along the meridian from the equator to lat (radians).
func meridionalArc(lat float64) float64 {
	return wgs84A * ((1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*lat -
		(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*math.Sin(2*lat) +
		(15*e2*e2/256+45*e2*e2*e2/1024)*math.Sin(4*lat) -
		(35*e2*e2*e2/3072)*math.Sin(6*lat))
}

// Forward projects geographic degrees to projected metres (easting, northing).
//
// Snyder's series expansion, the same formulation PROJ uses for tmerc. Accurate to
// well under a millimetre within a 6° zone, which is three orders of magnitude tighter
// than the 70 m pixels this feeds.
func (p TransverseMercator) Forward(lonDeg, latDeg float64) (x, y float64) {
	lat := latDeg * math.Pi / 180
	lon := lonDeg * math.Pi / 180
	lon0 := p.CentralMeridianDeg * math.Pi / 180

	sinLat, cosLat, tanLat := math.Sin(lat), math.Cos(lat), math.Tan(lat)
	n := wgs84A / math.Sqrt(1-e2*sinLat*sinLat)
	t := tanLat * tanLat
	c := ep2 * cosLat * cosLat
	a := (lon - lon0) * cosLat
	m := meridionalArc(lat)

	a2, a3, a4, a5, a6 := a*a, a*a*a, a*a*a*a, a*a*a*a*a, a*a*a*a*a*a
	x = utmK0*n*(a+(1-t+c)*a3/6+(5-18*t+t*t+72*c-58*ep2)*a5/120) + utmFalseEasting
	y = utmK0 * (m + n*tanLat*(a2/2+(5-t+9*c+4*c*c)*a4/24+
		(61-58*t+t*t+600*c-330*ep2)*a6/720))
	return x, y
}

// Inverse projects projected metres back to geographic degrees.
func (p TransverseMercator) Inverse(x, y float64) (lonDeg, latDeg float64) {
	lon0 := p.CentralMeridianDeg * math.Pi / 180
	xp := x - utmFalseEasting
	m := y / utmK0
	mu := m / (wgs84A * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256))

	e1_2, e1_3, e1_4 := e1*e1, e1*e1*e1, e1*e1*e1*e1
	lat1 := mu + (3*e1/2-27*e1_3/32)*math.Sin(2*mu) +
		(21*e1_2/16-55*e1_4/32)*math.Sin(4*mu) +
		(151*e1_3/96)*math.Sin(6*mu) +
		(1097*e1_4/512)*math.Sin(8*mu)

	sin1, cos1, tan1 := math.Sin(lat1), math.Cos(lat1), math.Tan(lat1)
	c1 := ep2 * cos1 * cos1
	t1 := tan1 * tan1
	n1 := wgs84A / math.Sqrt(1-e2*sin1*sin1)
	r1 := wgs84A * (1 - e2) / math.Pow(1-e2*sin1*sin1, 1.5)
	d := xp / (n1 * utmK0)

	d2, d3, d4, d5, d6 := d*d, d*d*d, d*d*d*d, d*d*d*d*d, d*d*d*d*d*d
	lat := lat1 - (n1*tan1/r1)*(d2/2-
		(5+3*t1+10*c1-4*c1*c1-9*ep2)*d4/24+
		(61+90*t1+298*c1+45*t1*t1-252*ep2-3*c1*c1)*d6/720)
	lon := lon0 + (d-(1+2*t1+c1)*d3/6+
		(5-2*c1+28*t1-3*c1*c1+8*ep2+24*t1*t1)*d5/120)/cos1

	return lon * 180 / math.Pi, lat * 180 / math.Pi
}

// TransformBounds reprojects a geographic bounding box to projected metres, returning
// (west, south, east, north) — rasterio's from_bounds order.
//
// DENSIFY IS NOT DECORATION, even though it is currently unobservable here. A
// reprojected edge is CURVED, so transforming only the four corners underestimates the
// box. rasterio is called with densify_pts=21 in _ecostress.target_grid, and this
// matches that: 21 interior samples per edge, extremes taken over all of them.
//
// Measured against the oracle: the difference from four-corner code is exactly 0.0 m
// for every box the pipeline uses (wards at 0.15°, study bbox at 0.85°), because UTM is
// conformal and these boxes are small and near the central meridian. It reaches 2,813 m
// at 6°. So this is written the correct way rather than the convenient way, and the
// oracle carries a deliberately zone-wide guard case that fails four-corner code — if
// the study area ever widens, the test catches it instead of the science.
func (p TransverseMercator) TransformBounds(west, south, east, north float64, densifyPts int) (float64, float64, float64, float64) {
	if densifyPts < 0 {
		densifyPts = 0
	}
	// n samples along each edge, inclusive of both corners.
	n := densifyPts + 2
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)

	consider := func(lon, lat float64) {
		x, y := p.Forward(lon, lat)
		minX, maxX = math.Min(minX, x), math.Max(maxX, x)
		minY, maxY = math.Min(minY, y), math.Max(maxY, y)
	}
	for i := 0; i < n; i++ {
		f := float64(i) / float64(n-1)
		lon := west + (east-west)*f
		lat := south + (north-south)*f
		consider(lon, south) // bottom edge
		consider(lon, north) // top edge
		consider(west, lat)  // left edge
		consider(east, lat)  // right edge
	}
	return minX, minY, maxX, maxY
}
