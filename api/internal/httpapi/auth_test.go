package httpapi

import (
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
)

// newAuthedRouter builds the real router around a throwaway account store. The
// drop service is nil on purpose: every case here is rejected by the auth
// middleware, which runs before any handler could reach it — and a nil service
// is what proves that.
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

	router, err := NewRouter(nil, Config{Auth: accounts})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return router, accounts
}

// TestUnauthenticatedPerimeter pins down what a stranger can reach. It is the
// test worth having: every other guarantee in the admin rests on the answer to
// "which routes need a session", and a wrong answer there is silent.
func TestUnauthenticatedPerimeter(t *testing.T) {
	router, _ := newAuthedRouter(t)

	cases := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		// Public: the product, and the two ways in.
		{"liveness stays open", http.MethodGet, "/healthz", http.StatusOK},
		{"the login form is reachable", http.MethodGet, "/login", http.StatusOK},
		{"an invitation link is reachable", http.MethodGet, "/invitacion?token=x", http.StatusGone},
		{"the stylesheet renders the login form", http.MethodGet, "/admin/static/admin.css", http.StatusOK},

		// The admin: a browser is redirected, not refused, so it lands on a
		// form rather than a JSON error it cannot act on.
		{"the explorer needs a session", http.MethodGet, "/", http.StatusSeeOther},
		{"the editor needs a session", http.MethodGet, "/admin/edit?path=a&name=b", http.StatusSeeOther},
		{"account management needs a session", http.MethodGet, "/admin/usuarios", http.StatusSeeOther},
		{"writes need a session", http.MethodPost, "/admin/folders", http.StatusSeeOther},
		{"deletes need a session", http.MethodPost, "/admin/nodes/delete", http.StatusSeeOther},
		{"the API docs need a session", http.MethodGet, "/docs", http.StatusSeeOther},

		// The API: a client gets a status it can branch on.
		{"listing needs a token", http.MethodGet, "/v1/nodes?path=", http.StatusUnauthorized},
		{"reading a drop needs a token", http.MethodGet, "/v1/drops?path=a", http.StatusUnauthorized},
		{"uploading needs a token", http.MethodPost, "/v1/drops/upload", http.StatusUnauthorized},
		{"downloading needs a token", http.MethodGet, "/v1/files?path=a", http.StatusUnauthorized},
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

// TestSignedOutRedirectRemembersWhereYouWereGoing checks the detail that makes
// the redirect worth having at all.
func TestSignedOutRedirectRemembersWhereYouWereGoing(t *testing.T) {
	router, _ := newAuthedRouter(t)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/?path=Proyectos", nil))

	got := rec.Header().Get("Location")
	if want := "/login?next=%2F%3Fpath%3DProyectos"; got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

// TestSafeNextRefusesToLeaveTheSite guards the open redirect. Without it the
// login form forwards anywhere an attacker names, which is what turns a
// phishing link into a convincing one.
func TestSafeNextRefusesToLeaveTheSite(t *testing.T) {
	cases := map[string]string{
		"/":                    "/",
		"/?path=x":             "/?path=x",
		"/admin/usuarios":      "/admin/usuarios",
		"":                     "/",
		"//evil.example.com":   "/",
		"https://evil.example": "/",
		"http://evil.example":  "/",
		"javascript:alert(1)":  "/",
		"evil.example.com":     "/",
	}
	for next, want := range cases {
		if got := safeNext(next); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", next, got, want)
		}
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc123": "abc123",
		"bearer abc123": "abc123",
		"BEARER abc123": "abc123",
		"Bearer  spaced": "spaced",
		"Basic abc123":  "",
		"abc123":        "",
		"":              "",
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
	req := httptest.NewRequest(http.MethodGet, "/admin/usuarios", nil)
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
