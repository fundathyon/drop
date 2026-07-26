// Package httpapi exposes the admin API over HTTP using Gin, and serves its
// OpenAPI documentation at /docs.
package httpapi

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "drop/docs" // generated OpenAPI spec, registered on import
	"drop/internal/adminui"
	"drop/internal/auth"
	"drop/internal/model"
	"drop/internal/service"
)

// maxUploadMemory is how much of a multipart upload Gin buffers in memory
// before spilling to temporary files.
const maxUploadMemory = 32 << 20 // 32 MiB

type Config struct {
	// AllowedOrigins are the browser origins permitted to call this API
	// cross-origin. The admin is served from this same process, so this is for
	// third-party clients only.
	AllowedOrigins []string
	// InjectWidget appends the Drop badge to published HTML pages.
	InjectWidget bool
	// Auth is the account service. It is required: without it there would be
	// nothing standing between the internet and the admin.
	Auth *auth.Service
	// CookieSecure marks the session cookie Secure. Off for plain-HTTP
	// localhost, and on everywhere else.
	CookieSecure bool
}

// loginAttempts is how many credential checks one address gets per window.
// Generous enough that a person who mistypes a few times never notices, small
// enough that guessing a password online is not a strategy.
const (
	loginAttempts = 10
	loginWindow   = time.Minute
)

// NewRouter builds the HTTP handler: the admin, the JSON API and the Swagger UI.
func NewRouter(svc *service.Service, cfg Config) (http.Handler, error) {
	gin.SetMode(gin.ReleaseMode)

	if cfg.Auth == nil {
		return nil, errors.New("auth service is required")
	}

	ui, err := adminui.New()
	if err != nil {
		return nil, fmt.Errorf("admin templates: %w", err)
	}
	static, err := adminui.Static()
	if err != nil {
		return nil, fmt.Errorf("admin assets: %w", err)
	}

	limiter := newAttemptLimiter(loginAttempts, loginWindow)

	h := &handler{svc: svc, injectWidget: cfg.InjectWidget}
	a := &adminHandler{svc: svc, accounts: cfg.Auth, ui: ui}
	auths := &authHandler{svc: cfg.Auth, tree: svc, ui: ui, cookieSecure: cfg.CookieSecure, logins: limiter}
	apiAuth := &apiAuthHandler{svc: cfg.Auth, logins: limiter}

	session := requireSession(cfg.Auth)
	apiGuard := requireAPIAuth(cfg.Auth)

	r := gin.New()
	r.MaxMultipartMemory = maxUploadMemory
	r.Use(requestLogger(), gin.Recovery(), cors(cfg.AllowedOrigins))

	r.GET("/healthz", h.health)

	// Published drops. The /d/ prefix keeps slugs from colliding with the API,
	// the docs and the health endpoint.
	r.GET("/d/:slug", h.servePublicDrop)
	r.GET("/d/:slug/*filepath", h.servePublicDrop)

	// Getting a token is the one API call that cannot require one. Both are
	// throttled: they are the two places a password or a token is checked.
	authAPI := r.Group("/v1/auth")
	{
		authAPI.POST("/login", limitAttempts(limiter, tooManyAttemptsJSON), apiAuth.login)
		authAPI.POST("/refresh", limitAttempts(limiter, tooManyAttemptsJSON), apiAuth.refresh)
		authAPI.POST("/logout", apiAuth.logout)
		authAPI.GET("/me", apiGuard, apiAuth.me)
	}

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

		// Account management is administrators only.
		accounts := v1.Group("", requireAdminAPI)
		accounts.GET("/users", apiAuth.listUsers)
		accounts.PATCH("/users/:id/active", apiAuth.setUserActive)
		accounts.DELETE("/users/:id", apiAuth.deleteUser)
		accounts.GET("/invitations", apiAuth.listInvitations)
		accounts.POST("/invitations", apiAuth.createInvitation)
		accounts.DELETE("/invitations/:id", apiAuth.revokeInvitation)
	}

	// Swagger UI. /docs redirects to the index so the bare path works. It is
	// behind the session too: the spec describes every endpoint and their
	// shapes, which is a map worth not handing out.
	r.GET("/docs", session, func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/docs/index.html")
	})
	r.GET("/docs/*any", session, ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Signing in, and the invitation link, are the only admin pages reachable
	// without a session — everything else redirects here.
	r.GET("/login", auths.loginPage)
	r.POST("/login", limitAttempts(limiter, auths.tooManyLogins), auths.login)
	r.POST("/logout", auths.logout)
	r.GET("/invitacion", auths.invitePage)
	r.POST("/invitacion", auths.acceptInvite)

	// The stylesheet and script are needed to render the login form itself, so
	// they sit outside the session.
	r.GET("/admin/static/*filepath", serveStatic(static))

	// The admin. It is server-rendered, so every route it needs is registered
	// here; anything else is a real 404 rather than a page.
	r.GET("/", session, a.index)
	r.GET("/compartido", session, a.shared)
	r.GET("/admin/edit", session, a.edit)
	admin := r.Group("/admin", session)
	{
		admin.POST("/folders", a.createFolder)
		admin.POST("/drops", a.createDrop)
		admin.POST("/drops/meta", a.updateMeta)
		admin.POST("/drops/restore", a.restoreVersion)
		admin.POST("/nodes/delete", a.deleteNode)
		admin.POST("/files", a.uploadFiles)
		admin.POST("/files/save", a.saveFile)
		admin.POST("/files/delete", a.deleteFile)
		admin.POST("/share", a.share)
		admin.POST("/unshare", a.unshare)

		// Accounts and invitations, administrators only.
		accounts := admin.Group("/usuarios", requireAdminPage)
		accounts.GET("", auths.usersPage)
		accounts.POST("/activar", auths.setUserActive)
		accounts.POST("/eliminar", auths.deleteUser)
		accounts.POST("/invitaciones", auths.createInvitation)
		accounts.POST("/invitaciones/revocar", auths.revokeInvitation)
	}

	r.NoRoute(notFound)

	return r, nil
}

// tooManyAttemptsJSON is the rate-limit answer for API clients; the admin form
// redraws itself with the message instead.
func tooManyAttemptsJSON(c *gin.Context) {
	abortWithError(c, http.StatusTooManyRequests, "too_many_attempts",
		"too many attempts; wait a minute and try again")
}

// requireAdminPage keeps a signed-in non-administrator out of the account
// screens, sending them back to the explorer with the reason.
func requireAdminPage(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok || user.Role != model.RoleAdmin {
		setFlash(c, "error", "Solo un administrador puede gestionar cuentas")
		c.Redirect(http.StatusSeeOther, "/")
		c.Abort()
		return
	}
	c.Next()
}

// serveStatic serves the admin's stylesheet and script. Their URLs carry a
// digest of the contents, so a cached copy can never be the wrong one.
func serveStatic(assets fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		name := strings.TrimPrefix(path.Clean("/"+c.Param("filepath")), "/")
		info, err := fs.Stat(assets, name)
		if err != nil || info.IsDir() {
			notFound(c)
			return
		}
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFileFS(c.Writer, c.Request, assets, name)
	}
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
