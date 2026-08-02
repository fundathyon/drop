package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"net/url"
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
// newAuthedRouter, it needs a real drop service: a successful POST /setup
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
		{"setup redirects once there is an administrator", http.MethodGet, "/setup", http.StatusSeeOther},
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
		// had a chance to reach the wizard, and the wizard needs its own
		// stylesheet to render at all.
		{"liveness stays open", http.MethodGet, "/healthz", http.StatusOK},
		{"the setup wizard is reachable", http.MethodGet, "/setup", http.StatusOK},
		{"its stylesheet is reachable", http.MethodGet, "/admin/static/admin.css", http.StatusOK},

		// A browser is sent to the wizard, the same way it would be sent to
		// the login form once an administrator exists.
		{"login redirects to setup", http.MethodGet, "/login", http.StatusSeeOther},
		{"the explorer redirects to setup", http.MethodGet, "/", http.StatusSeeOther},
		{"the docs redirect to setup", http.MethodGet, "/docs", http.StatusSeeOther},

		// A JSON client gets a status it can branch on, same principle as the
		// 401s in TestUnauthenticatedPerimeter.
		{"the API answers setup_required", http.MethodGet, "/v1/nodes?path=", http.StatusServiceUnavailable},
		{"auth/me answers setup_required", http.MethodGet, "/v1/auth/me", http.StatusServiceUnavailable},
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

// TestSetupInstanceOverHTTP walks the whole first-run flow through the real
// router: submitting the wizard signs the new administrator in, and the
// wizard and the login form then point at each other the other way around.
func TestSetupInstanceOverHTTP(t *testing.T) {
	router, _ := newSetupRouter(t)

	form := url.Values{
		"org_name":         {"Acme"},
		"name":             {"Admin"},
		"email":            {"admin@drop.test"},
		"password":         {"a-strong-password"},
		"password_confirm": {"a-strong-password"},
	}
	req := httptest.NewRequest(http.MethodPost, "/setup", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("POST /setup: expected 303, got %d (%s)", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Location"); got != "/" {
		t.Fatalf("expected a redirect to /, got %q", got)
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			cookie = c
		}
	}
	if cookie == nil || cookie.Value == "" {
		t.Fatal("expected a session cookie after setup")
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/setup", nil))
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != "/login" {
		t.Fatalf("expected /setup to redirect to /login once set up, got %d %q",
			rec.Code, rec.Header().Get("Location"))
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/login", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected /login reachable once set up, got %d", rec.Code)
	}
}

// TestSetupInstanceRefusesASecondSubmission checks the once-only guard over
// HTTP: a second visitor (or a second tab) finishing the form after someone
// else already has is sent to sign in, not shown an error they cannot act on.
func TestSetupInstanceRefusesASecondSubmission(t *testing.T) {
	router, accounts := newSetupRouter(t)
	if _, _, err := accounts.SetupInstance(context.Background(), "Acme", "Admin",
		"admin@drop.test", "a-strong-password", auth.Device{}); err != nil {
		t.Fatalf("SetupInstance: %v", err)
	}

	form := url.Values{
		"org_name":         {"Otra"},
		"name":             {"Otro"},
		"email":            {"otro@drop.test"},
		"password":         {"another-password"},
		"password_confirm": {"another-password"},
	}
	req := httptest.NewRequest(http.MethodPost, "/setup", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != "/login" {
		t.Fatalf("expected a redirect to /login, got %d %q", rec.Code, rec.Header().Get("Location"))
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
