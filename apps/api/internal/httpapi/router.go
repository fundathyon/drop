// Package httpapi exposes the Drop JSON API over HTTP using Gin, and serves
// its OpenAPI documentation at /docs. The admin UI is a separate frontend
// (../../web) that calls this API server-side; this package renders no HTML
// of its own beyond the published drops themselves.
package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "drop/docs" // generated OpenAPI spec, registered on import
	"drop/internal/auth"
	"drop/internal/service"
)

// maxUploadMemory is how much of a multipart upload Gin buffers in memory
// before spilling to temporary files.
const maxUploadMemory = 32 << 20 // 32 MiB

type Config struct {
	// AllowedOrigins are the browser origins permitted to call this API
	// cross-origin. The frontend's own server calls this API directly
	// (server-to-server, not subject to CORS), so this is only for a browser
	// calling the API itself — a third-party client, or the frontend's
	// server-only routes forwarding a browser request that still needs one.
	AllowedOrigins []string
	// InjectWidget appends the Drop badge to published HTML pages.
	InjectWidget bool
	// Auth is the account service. It is required: without it there would be
	// nothing standing between the internet and every account's data.
	Auth *auth.Service
}

// loginAttempts is how many credential checks one address gets per window.
// Generous enough that a person who mistypes a few times never notices, small
// enough that guessing a password online is not a strategy.
const (
	loginAttempts = 10
	loginWindow   = time.Minute
)

// NewRouter builds the HTTP handler: the JSON API, the published drops, and
// the Swagger UI.
func NewRouter(svc *service.Service, cfg Config) (http.Handler, error) {
	gin.SetMode(gin.ReleaseMode)

	if cfg.Auth == nil {
		return nil, errors.New("auth service is required")
	}

	limiter := newAttemptLimiter(loginAttempts, loginWindow)

	h := &handler{svc: svc, injectWidget: cfg.InjectWidget, accounts: cfg.Auth}
	apiAuth := &apiAuthHandler{svc: cfg.Auth, logins: limiter, tree: svc}

	apiGuard := requireAPIAuth(cfg.Auth)

	r := gin.New()
	r.MaxMultipartMemory = maxUploadMemory
	r.Use(requestLogger(), gin.Recovery(), cors(cfg.AllowedOrigins), setupGate(cfg.Auth))

	r.GET("/healthz", h.health)

	// Published drops. The /d/ prefix keeps slugs from colliding with the API,
	// the docs and the health endpoint. The session is resolved but not
	// required: a public drop serves to anyone, and a private one serves to the
	// accounts that may open it.
	published := r.Group("/d", resolveSession(cfg.Auth))
	published.GET("/:slug", h.servePublicDrop)
	published.GET("/:slug/*filepath", h.servePublicDrop)

	// Getting a token is the one API call that cannot require one. Both are
	// throttled: they are the two places a password or a token is checked.
	authAPI := r.Group("/v1/auth")
	{
		authAPI.POST("/login", limitAttempts(limiter, tooManyAttemptsJSON), apiAuth.login)
		authAPI.POST("/refresh", limitAttempts(limiter, tooManyAttemptsJSON), apiAuth.refresh)
		authAPI.POST("/logout", apiAuth.logout)
		authAPI.GET("/me", apiGuard, apiAuth.me)
	}

	// First-run setup and accepting an invitation both happen before anyone has
	// a session, so neither sits behind apiGuard — same as /v1/auth/login.
	r.GET("/v1/setup/status", apiAuth.setupStatus)
	r.POST("/v1/setup", apiAuth.setup)
	r.GET("/v1/invitations/by-token", apiAuth.invitationByToken)
	r.POST("/v1/invitations/accept", apiAuth.acceptInvitation)

	v1 := r.Group("/v1", apiGuard)
	{
		v1.GET("/nodes", h.listNodes)
		v1.POST("/nodes", h.createFolder)
		v1.DELETE("/nodes", h.deleteNode)

		v1.GET("/drops", h.getDrop)
		v1.POST("/drops", h.createDrop)
		v1.POST("/drops/upload", h.uploadDrop)
		v1.PATCH("/drops", h.patchDrop)
		v1.GET("/drops/versions", h.listDropVersions)
		v1.POST("/drops/versions/activate", h.activateDropVersion)

		v1.GET("/files", h.downloadFile)
		v1.POST("/files", h.uploadFiles)
		v1.DELETE("/files", h.deleteFile)

		v1.GET("/shares", h.listShares)
		v1.POST("/shares", h.shareNode)
		v1.DELETE("/shares", h.unshareNode)
		v1.GET("/shared", h.listSharedWithMe)

		// Account management is administrators only.
		accounts := v1.Group("", requireAdminAPI)
		accounts.GET("/users", apiAuth.listUsers)
		accounts.PATCH("/users/:id/active", apiAuth.setUserActive)
		accounts.DELETE("/users/:id", apiAuth.deleteUser)
		accounts.GET("/invitations", apiAuth.listInvitations)
		accounts.POST("/invitations", apiAuth.createInvitation)
		accounts.DELETE("/invitations/:id", apiAuth.revokeInvitation)
	}

	// Swagger UI. /docs redirects to the index so the bare path works. Nothing
	// in it requires a session to read — the frontend never renders through
	// this process anymore, so there is no cookie-based session left to gate
	// it with — and the endpoints it describes are unusable without a real
	// bearer token regardless of who can see the spec.
	r.GET("/docs", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/docs/index.html")
	})
	r.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	r.NoRoute(notFound)

	return r, nil
}

// tooManyAttemptsJSON is the rate-limit answer for API clients; the admin form
// redraws itself with the message instead.
func tooManyAttemptsJSON(c *gin.Context) {
	abortWithError(c, http.StatusTooManyRequests, "too_many_attempts",
		"too many attempts; wait a minute and try again")
}

func notFound(c *gin.Context) {
	abortWithError(c, http.StatusNotFound, "not_found", "no such endpoint")
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds())
	}
}

// cors allows the frontend, served from a different origin in development, to
// call this API. Only origins on the configured list are echoed back.
func cors(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && slices.Contains(allowedOrigins, origin) {
			h := c.Writer.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
