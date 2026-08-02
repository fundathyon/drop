package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
	"drop/internal/model"
)

// sessionCookie holds the refresh token for a browser. It never reaches
// JavaScript: the admin is rendered on the server, so nothing in the page has
// any reason to read it, and HttpOnly takes it out of reach of an XSS bug.
const sessionCookie = "drop_session"

// contextUser is where a resolved account is stashed for the handlers.
const contextUser = "auth.user"

// currentUser returns the account behind the request. The second result is
// false on the public routes, which run without one.
func currentUser(c *gin.Context) (auth.UserInfo, bool) {
	value, ok := c.Get(contextUser)
	if !ok {
		return auth.UserInfo{}, false
	}
	user, ok := value.(auth.UserInfo)
	return user, ok
}

// requireSession gates the admin pages. An unauthenticated request is sent to
// the login form carrying where it was going, so signing in lands on the page
// that was asked for rather than dumping everyone at the root.
func requireSession(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(sessionCookie)
		if err != nil || token == "" {
			redirectToLogin(c)
			return
		}
		user, err := svc.SessionUser(c.Request.Context(), token)
		if err != nil {
			// The cookie is stale, revoked, or belongs to a disabled account.
			// Clearing it stops every later request from repeating the lookup.
			clearSessionCookie(c, false)
			redirectToLogin(c)
			return
		}
		c.Set(contextUser, user)
		c.Next()
	}
}

// requireAPIAuth gates /v1. It takes a bearer access token, which is what a
// script or CLI carries, and falls back to the admin's session cookie so that
// links the admin renders — file downloads, the Swagger UI's "try it out" —
// work in a browser that is already signed in.
func requireAPIAuth(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token := bearerToken(c); token != "" {
			user, err := svc.UserFromAccessToken(c.Request.Context(), token)
			if err != nil {
				abortWithError(c, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			c.Set(contextUser, user)
			c.Next()
			return
		}

		if cookie, err := c.Cookie(sessionCookie); err == nil && cookie != "" {
			user, err := svc.SessionUser(c.Request.Context(), cookie)
			if err == nil {
				c.Set(contextUser, user)
				c.Next()
				return
			}
		}

		c.Header("WWW-Authenticate", `Bearer realm="drop"`)
		abortWithError(c, http.StatusUnauthorized, "unauthorized", "authentication required")
	}
}

// resolveSession attaches the account behind a request when there is one and
// lets it through anonymous when there is not. It is for the published routes,
// where being signed in changes what may be served — a private drop opens for
// the people it belongs to — but is never required to ask.
//
// A credential that does not check out is ignored rather than rejected, and the
// cookie is left alone: a stale one on a published page is not that page's
// business to clean up, and clearing it would sign the visitor out of the admin
// as a side effect of loading somebody's site.
func resolveSession(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token := bearerToken(c); token != "" {
			if user, err := svc.UserFromAccessToken(c.Request.Context(), token); err == nil {
				c.Set(contextUser, user)
			}
		} else if cookie, err := c.Cookie(sessionCookie); err == nil && cookie != "" {
			if user, err := svc.SessionUser(c.Request.Context(), cookie); err == nil {
				c.Set(contextUser, user)
			}
		}
		c.Next()
	}
}

// setupGate holds every route except the setup wizard itself closed until an
// administrator exists. It runs after cors(): cors() answers an OPTIONS
// preflight with AbortWithStatus and no c.Next(), so anything registered
// ahead of it would never see a preflight request at all.
func setupGate(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/setup" || path == "/healthz" || strings.HasPrefix(path, "/admin/static/") {
			c.Next()
			return
		}

		needsSetup, err := svc.NeedsSetup(c.Request.Context())
		if err != nil {
			abortWithError(c, http.StatusInternalServerError, "internal_error", "unexpected error")
			return
		}
		if !needsSetup {
			c.Next()
			return
		}

		if strings.HasPrefix(path, "/v1/") {
			abortWithError(c, http.StatusServiceUnavailable, "setup_required", "this instance has not been set up yet")
			return
		}
		c.Redirect(http.StatusSeeOther, "/setup")
		c.Abort()
	}
}

// requireAdminAPI rejects a non-administrator on the JSON endpoints that manage
// accounts.
func requireAdminAPI(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok || user.Role != model.RoleAdmin {
		abortWithError(c, http.StatusForbidden, "forbidden", "administrator role required")
		return
	}
	c.Next()
}

func bearerToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func redirectToLogin(c *gin.Context) {
	target := "/login"
	// Only GETs are worth resuming: replaying a POST after a login would repeat
	// a write the user may no longer intend.
	if c.Request.Method == http.MethodGet {
		if next := c.Request.URL.RequestURI(); next != "/" {
			target += "?next=" + url.QueryEscape(next)
		}
	}
	c.Redirect(http.StatusSeeOther, target)
	c.Abort()
}

func setSessionCookie(c *gin.Context, token string, expires time.Time, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		// Lax, not Strict: a link into the admin from anywhere else should land
		// signed in. It still keeps the cookie off cross-site form posts, which
		// is the CSRF case that matters here.
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(c *gin.Context, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
	})
}

// ---------- rate limiting ----------

// attemptLimiter throttles credential checks per client. It is a fixed window
// in memory: this is one process with one database, and a shared store would be
// infrastructure bought before there is anything to spend it on.
//
// The point is to make online guessing impractical, which a coarse counter does
// as well as a precise one.
type attemptLimiter struct {
	mu      sync.Mutex
	hits    map[string]*attemptWindow
	limit   int
	window  time.Duration
	lastGC  time.Time
	nowFunc func() time.Time
}

type attemptWindow struct {
	count int
	until time.Time
}

func newAttemptLimiter(limit int, window time.Duration) *attemptLimiter {
	return &attemptLimiter{
		hits:    make(map[string]*attemptWindow),
		limit:   limit,
		window:  window,
		nowFunc: func() time.Time { return time.Now() },
	}
}

// allow records an attempt and reports whether it may proceed.
func (l *attemptLimiter) allow(key string) bool {
	now := l.nowFunc()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Sweeping on write keeps abandoned keys from growing the map without
	// bound, and costs nothing on a map this size.
	if now.Sub(l.lastGC) > l.window {
		for k, w := range l.hits {
			if now.After(w.until) {
				delete(l.hits, k)
			}
		}
		l.lastGC = now
	}

	w, ok := l.hits[key]
	if !ok || now.After(w.until) {
		l.hits[key] = &attemptWindow{count: 1, until: now.Add(l.window)}
		return true
	}
	w.count++
	return w.count <= l.limit
}

// reset clears a key, called after a successful sign-in so a legitimate user
// who mistyped a few times is not left throttled.
func (l *attemptLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.hits, key)
	l.mu.Unlock()
}

// limitAttempts guards the endpoints that check a credential. Keying on the
// client address alone is intentional: keying on the submitted email would let
// anyone lock out an account they know the address of.
func limitAttempts(limiter *attemptLimiter, onReject gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !limiter.allow(c.ClientIP()) {
			onReject(c)
			c.Abort()
			return
		}
		c.Next()
	}
}

// authErrorStatus maps an auth failure to its HTTP shape.
func authErrorStatus(err error) (int, string, string) {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		// One error covers a wrong password, an unknown address and a revoked
		// token, so the wording has to cover all three: naming which one failed
		// is exactly the distinction the shared error exists to hide.
		return http.StatusUnauthorized, "invalid_credentials", "credentials or token are not valid"
	case errors.Is(err, auth.ErrAccountDisabled):
		return http.StatusForbidden, "account_disabled", "this account is disabled"
	case errors.Is(err, auth.ErrNotFound):
		return http.StatusNotFound, "not_found", "resource not found"
	case errors.Is(err, auth.ErrExists):
		return http.StatusConflict, "already_exists", err.Error()
	case errors.Is(err, auth.ErrInvalidInvitation):
		return http.StatusGone, "invalid_invitation", err.Error()
	case errors.Is(err, auth.ErrLastAdmin):
		return http.StatusConflict, "last_admin", "this is the last active administrator"
	case errors.Is(err, auth.ErrAlreadySetUp):
		return http.StatusConflict, "already_set_up", "this instance is already set up"
	case errors.Is(err, auth.ErrInvalidInput):
		return http.StatusBadRequest, "invalid_body", err.Error()
	default:
		return http.StatusInternalServerError, "internal_error", "unexpected error"
	}
}
