package httpapi

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// newTestRouter builds the router around a stand-in asset tree. The service is
// nil on purpose: none of the routes these tests exercise reach it.
func newTestRouter(t *testing.T, assets fs.FS) http.Handler {
	t.Helper()
	return NewRouter(nil, Config{AdminUI: assets})
}

func TestIsServerPath(t *testing.T) {
	cases := map[string]bool{
		"/v1/nodes":   true,
		"/v1":         true,
		"/d/abc123/":  true,
		"/d":          true,
		"/docs":       true,
		"/docs/index": true,
		"/healthz":    true,
		// Matching whole segments rather than prefixes: these belong to the
		// admin, and a prefix check would have swallowed all three.
		"/documentos":   false,
		"/v10":          false,
		"/dashboard":    false,
		"/":             false,
		"/_astro/x.js":  false,
		"/healthzcheck": false,
	}
	for path, want := range cases {
		if got := isServerPath(path); got != want {
			t.Errorf("%q: expected %v, got %v", path, want, got)
		}
	}
}

func TestServeAdminUI(t *testing.T) {
	assets := fstest.MapFS{
		"index.html":      {Data: []byte("<html>admin</html>")},
		"_astro/app.js":   {Data: []byte("console.log(1)")},
		"favicon.svg":     {Data: []byte("<svg/>")},
		"nested/page.txt": {Data: []byte("x")},
	}
	handler := newTestRouter(t, assets)

	cases := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
		wantCache  string
	}{
		{
			name: "the root serves the shell", method: http.MethodGet, path: "/",
			wantStatus: http.StatusOK, wantBody: "<html>admin</html>", wantCache: "no-cache",
		},
		{
			// The admin resolves its own routes, so a navigation it owns must
			// come back as the shell rather than a 404.
			name: "an unknown navigation falls back to the shell", method: http.MethodGet, path: "/carpeta/algo",
			wantStatus: http.StatusOK, wantBody: "<html>admin</html>",
		},
		{
			name: "a built asset is served as itself", method: http.MethodGet, path: "/_astro/app.js",
			wantStatus: http.StatusOK, wantBody: "console.log(1)",
			wantCache: "public, max-age=31536000, immutable",
		},
		{
			// Answering this with the shell would turn a broken script tag into
			// a blank page instead of a visible error.
			name: "a missing asset is a real 404", method: http.MethodGet, path: "/_astro/gone.js",
			wantStatus: http.StatusNotFound,
		},
		{
			name: "a directory does not list itself", method: http.MethodGet, path: "/_astro",
			wantStatus: http.StatusOK, wantBody: "<html>admin</html>",
		},
		{
			name: "unknown API paths stay JSON", method: http.MethodGet, path: "/v1/nope",
			wantStatus: http.StatusNotFound, wantBody: `{"code":"not_found","message":"no such endpoint"}`,
		},
		{
			name: "a write to an unknown path is not a page", method: http.MethodPost, path: "/carpeta/algo",
			wantStatus: http.StatusNotFound, wantBody: `{"code":"not_found","message":"no such endpoint"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("expected %d, got %d (body: %s)", tc.wantStatus, rec.Code, rec.Body)
			}
			if tc.wantBody != "" && rec.Body.String() != tc.wantBody {
				t.Errorf("expected body %q, got %q", tc.wantBody, rec.Body)
			}
			if tc.wantCache != "" && rec.Header().Get("Cache-Control") != tc.wantCache {
				t.Errorf("expected Cache-Control %q, got %q", tc.wantCache, rec.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestWithoutAnEmbeddedAdminEverythingStaysJSON(t *testing.T) {
	// A binary built without a frontend must behave like an API, not serve a
	// blank page at the root.
	handler := newTestRouter(t, nil)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("expected a JSON error, got %q", got)
	}
}
