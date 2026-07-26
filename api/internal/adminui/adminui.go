// Package adminui carries the built admin frontend inside the binary, so one
// process serves the admin, the JSON API and the published drops.
//
// The assets are produced by the Astro build in web/ and staged here by
// `make build`: go:embed cannot reach outside its own package directory, which
// is why they are copied into this tree instead of embedded from web/dist.
package adminui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// Assets returns the embedded admin build.
//
// It reports false when the binary was compiled without one — a bare `go build`
// with no frontend build in front of it — so the server can keep behaving like
// an API-only process rather than serving a blank page.
func Assets() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}
