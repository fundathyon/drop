package httpapi

import (
	"io/fs"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
)

// reservedRoots are the first path segments that belong to the server itself.
// Reaching the fallback under one of them means the endpoint does not exist, and
// the answer has to stay JSON: an API client should never be handed the admin's
// HTML in place of an error it can read.
var reservedRoots = []string{"v1", "d", "docs", "healthz"}

func isServerPath(urlPath string) bool {
	first, _, _ := strings.Cut(strings.TrimPrefix(urlPath, "/"), "/")
	return slices.Contains(reservedRoots, first)
}

// serveAdminUI serves the embedded admin build for everything that is not an
// API route. Gin's NoRoute is the hook for it, because a catch-all wildcard at
// the root would conflict with the routes registered above it.
func serveAdminUI(assets fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isServerPath(c.Request.URL.Path) ||
			(c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
			notFound(c)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+c.Request.URL.Path), "/")
		if name == "" {
			name = indexPage
		}

		// A directory is not a page. Serving one would hand out a listing of
		// the build, so it falls through to the shell like any other route.
		info, err := fs.Stat(assets, name)
		if err != nil || info.IsDir() {
			// A path without an extension is a navigation, which the admin
			// resolves client-side. A missing asset is a real 404: answering it
			// with the shell would turn a broken script tag into a blank page
			// instead of an error anyone can see.
			if err != nil && path.Ext(name) != "" {
				notFound(c)
				return
			}
			name = indexPage
		}

		// Astro fingerprints everything under _astro/, so those are immutable;
		// the shell must not be cached or a deploy would keep serving the old
		// one alongside new assets.
		if strings.HasPrefix(name, "_astro/") {
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Writer.Header().Set("Cache-Control", "no-cache")
		}

		// The request path is left alone on purpose: http.ServeFileFS redirects
		// any URL ending in /index.html to "./", so rewriting the path to the
		// file being served would answer every navigation with a 301.
		http.ServeFileFS(c.Writer, c.Request, assets, name)
	}
}

const indexPage = "index.html"

func notFound(c *gin.Context) {
	abortWithError(c, http.StatusNotFound, "not_found", "no such endpoint")
}
