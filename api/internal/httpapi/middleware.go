package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
	"drop/internal/model"
)

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

// actorOf is who the request is on behalf of. Zero is impossible on any route
// that sits behind requireAPIAuth, which every caller of this does.
func actorOf(c *gin.Context) uint {
	user, _ := currentUser(c)
	return user.ID
}

// requireAPIAuth gates /v1. It takes a bearer access token, which is what a
// script, a CLI, or the Next.js frontend's server carries.
func requireAPIAuth(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c)
		if token == "" {
			c.Header("WWW-Authenticate", `Bearer realm="drop"`)
			abortWithError(c, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		user, err := svc.UserFromAccessToken(c.Request.Context(), token)
		if err != nil {
			abortWithError(c, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}
		c.Set(contextUser, user)
		c.Next()
	}
}

// resolveSession attaches the account behind a request when there is one and
// lets it through anonymous when there is not. It is for the published routes,
// where being signed in changes what may be served — a private drop opens for
// the people it belongs to — but is never required to ask. A bearer token that
// does not check out is ignored rather than rejected: a stale credential on a
// published page is not that page's business to reject, only to disregard.
func resolveSession(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token := bearerToken(c); token != "" {
			if user, err := svc.UserFromAccessToken(c.Request.Context(), token); err == nil {
				c.Set(contextUser, user)
			}
		}
		c.Next()
	}
}

// setupGate holds every route except the setup endpoints themselves closed
// until an administrator exists. It runs after cors(): cors() answers an
// OPTIONS preflight with AbortWithStatus and no c.Next(), so anything
// registered ahead of it would never see a preflight request at all.
func setupGate(svc *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/healthz" || path == "/v1/setup/status" || path == "/v1/setup" {
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

		abortWithError(c, http.StatusServiceUnavailable, "setup_required", "this instance has not been set up yet")
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
