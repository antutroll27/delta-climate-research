# Go pipeline — pure Go, no cgo, no GDAL

`CGO_ENABLED=0` is a hard requirement, not a preference. The whole reason this exists
is a single static binary that cross-compiles anywhere; cgo would forfeit that, and
`godal`/`lukeroth-gdal` are cgo bindings to the same C++ libgdal rather than Go
reimplementations. See the plan for the measurement that made pure Go viable: this
pipeline uses one projected CRS pair (EPSG:4326 <-> 32645), GeoTIFF only, and needs
remote reads in exactly one function.

**The Python pipeline in `scripts/` stays.** This is additive. `parity/` compares the
two continuously against fixtures dumped from the rasterio implementation
(`scripts/dump-parity-oracle.py`), so divergence surfaces as a test failure rather
than as wrong science.

    CGO_ENABLED=0 go build ./...
    CGO_ENABLED=0 go test ./...
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./...   # must also pass
