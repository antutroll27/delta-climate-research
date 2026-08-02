package geo

import "math"

// Affine is a raster's georeferencing transform, in rasterio's parameter order.
//
//	| A B C |     x_geo = A*col + B*row + C
//	| D E F |     y_geo = D*col + E*row + F
//
// For a north-up grid B and D are zero and E is NEGATIVE — row increases southward
// while northing decreases. Getting E's sign wrong flips the raster vertically and
// still produces plausible-looking output, which is why FromOrigin exists rather than
// callers assembling this by hand.
type Affine struct {
	A, B, C float64
	D, E, F float64
}

// FromOrigin builds a north-up transform from the top-left corner and pixel size,
// mirroring rasterio.transform.from_origin(west, north, xsize, ysize).
func FromOrigin(west, north, xSize, ySize float64) Affine {
	return Affine{A: xSize, B: 0, C: west, D: 0, E: -ySize, F: north}
}

// XY returns the projected coordinate of a (col, row) position. Integer col/row give
// the pixel's top-left corner; add 0.5 for its centre.
func (t Affine) XY(col, row float64) (x, y float64) {
	return t.A*col + t.B*row + t.C, t.D*col + t.E*row + t.F
}

// ColRow is the inverse of XY — projected coordinate to fractional pixel position.
func (t Affine) ColRow(x, y float64) (col, row float64) {
	det := t.A*t.E - t.B*t.D
	dx, dy := x-t.C, y-t.F
	return (dx*t.E - dy*t.B) / det, (dy*t.A - dx*t.D) / det
}

// Window is a pixel-space rectangle, matching rasterio.windows.Window.
//
// Offsets and sizes are FLOAT, not int, exactly as rasterio's from_bounds returns them.
// Rounding here rather than at read time was tempting and would be wrong: rasterio
// carries the fraction through to the resampling step, so truncating early shifts the
// sampled window by up to a pixel — 70 m on the ECOSTRESS grid.
type Window struct {
	ColOff, RowOff float64
	Width, Height  float64
}

// FromBounds computes the pixel window covering a projected bounding box, mirroring
// rasterio.windows.from_bounds(left, bottom, right, top, transform).
//
// Argument order is (west, south, east, north) to match rasterio. It is the same order
// as _types.ward_bounds returns, which that function's docstring calls out precisely
// because inverting it reads the wrong window silently instead of raising.
func FromBounds(west, south, east, north float64, t Affine) Window {
	// North-up: the top edge is `north` and maps to the smaller row index.
	colA, rowA := t.ColRow(west, north)
	colB, rowB := t.ColRow(east, south)
	return Window{
		ColOff: math.Min(colA, colB),
		RowOff: math.Min(rowA, rowB),
		Width:  math.Abs(colB - colA),
		Height: math.Abs(rowB - rowA),
	}
}

// TargetGrid reproduces _ecostress.target_grid: the shared UTM 45N grid for a
// geographic bbox, at the given resolution.
//
// The `ceil` matters. A grid one column short of the extent silently clips the eastern
// edge of every raster registered against it, and because every layer is clipped the
// same way the maps still line up with each other — the error is invisible in
// comparison and only wrong against the world.
func TargetGrid(west, south, east, north, res float64, p TransverseMercator, densifyPts int) (Affine, int, int) {
	l, b, r, tp := p.TransformBounds(west, south, east, north, densifyPts)
	w := int(math.Ceil((r - l) / res))
	h := int(math.Ceil((tp - b) / res))
	return FromOrigin(l, tp, res, res), w, h
}
