package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
	"drop/internal/db"
	"drop/internal/service"
)

// newAuthedRouter builds the real router around a throwaway account store,
// already bootstrapped with an administrator. The drop service is nil on
// purpose: every case here is rejected by the auth middleware, which runs
// before any handler could reach it — and a nil service is what proves that.
// It exists to test session- and token-gating specifically; the setup gate
// that runs before either has its own fixture and tests below.
func newAuthedRouter(t *testing.T) (http.Handler, *auth.Service) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	database, err := db.Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	accounts := auth.NewService(database,
		auth.NewIssuer(&auth.Keys{Private: key, Public: &key.PublicKey}, "drop-test",
			time.Minute, time.Hour),
		time.Hour)
	if _, err := accounts.Bootstrap(context.Background(), "admin@drop.test", "bootstrap-password"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	router, err := NewRouter(nil, Config{Auth: accounts})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return router, accounts
}

// newSetupRouter builds the real router around a fresh, never-bootstrapped
// account store — the state a brand new instance starts in. Unlike
// newAuthedRouter, it needs a real drop service: a successful POST /v1/setup
// calls through to it to adopt any pre-ownership nodes.
func newSetupRouter(t *testing.T) (http.Handler, *auth.Service) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	database, err := db.Open(filepath.Join(t.TempDir(), "setup.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	accounts := auth.NewService(database,
		auth.NewIssuer(&auth.Keys{Private: key, Public: &key.PublicKey}, "drop-test",
			time.Minute, time.Hour),
		time.Hour)
	tree := service.New(database, nil, "http://localhost:8000")

	router, err := NewRouter(tree, Config{Auth: accounts})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return router, accounts
}

// TestUnauthenticatedPerimeter pins down what a stranger can reach. It is the
// test worth having: every other guarantee in the API rests on the answer to
// "which routes need a token", and a wrong answer there is silent.
func TestUnauthenticatedPerimeter(t *testing.T) {
	router, _ := newAuthedRouter(t)

	cases := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		// Public, no token needed at all.
		{"liveness stays open", http.MethodGet, "/healthz", http.StatusOK},
		{"setup status is public", http.MethodGet, "/v1/setup/status", http.StatusOK},
		{"an invitation preview is public", http.MethodGet, "/v1/invitations/by-token?token=x", http.StatusGone},
		{"the docs redirect without a token", http.MethodGet, "/docs", http.StatusMovedPermanently},

		// The API: a client gets a status it can branch on.
		{"listing needs a token", http.MethodGet, "/v1/nodes?path=", http.StatusUnauthorized},
		{"reading a drop needs a token", http.MethodGet, "/v1/drops?path=a", http.StatusUnauthorized},
		{"uploading needs a token", http.MethodPost, "/v1/drops/upload", http.StatusUnauthorized},
		{"downloading needs a token", http.MethodGet, "/v1/files?path=a", http.StatusUnauthorized},
		{"listing shares needs a token", http.MethodGet, "/v1/shares?path=a", http.StatusUnauthorized},
		{"listing shared-with-me needs a token", http.MethodGet, "/v1/shared", http.StatusUnauthorized},
		{"listing users needs a token", http.MethodGet, "/v1/users", http.StatusUnauthorized},
		{"inviting needs a token", http.MethodPost, "/v1/invitations", http.StatusUnauthorized},
		{"describing yourself needs a token", http.MethodGet, "/v1/auth/me", http.StatusUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.want {
				t.Fatalf("%s %s: expected %d, got %d (%s)",
					tc.method, tc.path, tc.want, rec.Code, rec.Body)
			}
		})
	}
}

// TestSetupGate pins down what a brand new, never-set-up instance allows and
// refuses — the counterpart to TestUnauthenticatedPerimeter, which assumes an
// administrator already exists.
func TestSetupGate(t *testing.T) {
	router, _ := newSetupRouter(t)

	cases := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		// Open regardless: a liveness probe must not fail before anyone has
		// had a chance to reach the wizard, and the wizard needs to know
		// whether it should even offer itself.
		{"liveness stays open", http.MethodGet, "/healthz", http.StatusOK},
		{"setup status is reachable", http.MethodGet, "/v1/setup/status", http.StatusOK},
		{"setup itself is reachable (even a bad body reaches the handler)",
			http.MethodPost, "/v1/setup", http.StatusBadRequest},

		// Everything else answers a status a JSON client can branch on,
		// rather than a page there is no longer anyone to render.
		{"listing answers setup_required", http.MethodGet, "/v1/nodes?path=", http.StatusServiceUnavailable},
		{"auth/me answers setup_required", http.MethodGet, "/v1/auth/me", http.StatusServiceUnavailable},
		{"an unknown path answers setup_required too", http.MethodGet, "/anything", http.StatusServiceUnavailable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.want {
				t.Fatalf("%s %s: expected %d, got %d (%s)",
					tc.method, tc.path, tc.want, rec.Code, rec.Body)
			}
		})
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc123":  "abc123",
		"bearer abc123":  "abc123",
		"BEARER abc123":  "abc123",
		"Bearer  spaced": "spaced",
		"Basic abc123":   "",
		"abc123":         "",
		"":               "",
	}
	for header, want := range cases {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		if got := bearerToken(testContext(req)); got != want {
			t.Errorf("bearerToken(%q) = %q, want %q", header, got, want)
		}
	}
}

// TestAttemptLimiterClosesTheWindow checks that guessing is bounded and that
// the bound lifts again, so a throttled address is not throttled forever.
func TestAttemptLimiterClosesTheWindow(t *testing.T) {
	now := time.Now()
	limiter := newAttemptLimiter(3, time.Minute)
	limiter.nowFunc = func() time.Time { return now }

	for i := 1; i <= 3; i++ {
		if !limiter.allow("10.0.0.1") {
			t.Fatalf("attempt %d should have been allowed", i)
		}
	}
	if limiter.allow("10.0.0.1") {
		t.Fatal("the fourth attempt should have been refused")
	}
	// Another client is unaffected: the counter is per address, not global.
	if !limiter.allow("10.0.0.2") {
		t.Fatal("a different address should not inherit the block")
	}

	now = now.Add(2 * time.Minute)
	if !limiter.allow("10.0.0.1") {
		t.Fatal("the window should have reopened")
	}
}

func TestAttemptLimiterResetClearsASuccessfulClient(t *testing.T) {
	limiter := newAttemptLimiter(2, time.Minute)

	limiter.allow("10.0.0.1")
	limiter.allow("10.0.0.1")
	if limiter.allow("10.0.0.1") {
		t.Fatal("expected the third attempt to be refused")
	}

	limiter.reset("10.0.0.1")
	if !limiter.allow("10.0.0.1") {
		t.Fatal("a signed-in client should start over")
	}
}

func testContext(req *http.Request) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return c
}

// TestInvitationLinkIsAbsolute checks the link handed to a recipient is one
// they can actually open, since nothing emails it for them.
func TestInvitationLinkIsAbsolute(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/invitations", nil)
	req.Host = "drop.example.com"
	c := testContext(req)

	got := absoluteURL(c, "/invitacion?token=abc")
	if want := "http://drop.example.com/invitacion?token=abc"; got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}

	req.Header.Set("X-Forwarded-Proto", "https")
	if got := absoluteURL(c, "/x"); !strings.HasPrefix(got, "https://") {
		t.Fatalf("expected https behind a TLS-terminating proxy, got %q", got)
	}
}
