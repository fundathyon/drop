// Package httpapi exposes the admin API over HTTP using Gin, and serves its
// OpenAPI documentation at /docs.
package httpapi

import (
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
}

// NewRouter builds the HTTP handler: the admin, the JSON API and the Swagger UI.
func NewRouter(svc *service.Service, cfg Config) (http.Handler, error) {
	gin.SetMode(gin.ReleaseMode)

	ui, err := adminui.New()
	if err != nil {
		return nil, fmt.Errorf("admin templates: %w", err)
	}
	static, err := adminui.Static()
	if err != nil {
		return nil, fmt.Errorf("admin assets: %w", err)
	}

	h := &handler{svc: svc, injectWidget: cfg.InjectWidget}
	a := &adminHandler{svc: svc, ui: ui}

	r := gin.New()
	r.MaxMultipartMemory = maxUploadMemory
	r.Use(requestLogger(), gin.Recovery(), cors(cfg.AllowedOrigins))

	r.GET("/healthz", h.health)

	// Published drops. The /d/ prefix keeps slugs from colliding with the API,
	// the docs and the health endpoint.
	r.GET("/d/:slug", h.servePublicDrop)
	r.GET("/d/:slug/*filepath", h.servePublicDrop)

	v1 := r.Group("/v1")
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
	}

	// Swagger UI. /docs redirects to the index so the bare path works.
	r.GET("/docs", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/docs/index.html")
	})
	r.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// The admin. It is server-rendered, so every route it needs is registered
	// here; anything else is a real 404 rather than a page.
	r.GET("/", a.index)
	r.GET("/admin/edit", a.edit)
	r.GET("/admin/static/*filepath", serveStatic(static))
	admin := r.Group("/admin")
	{
		admin.POST("/folders", a.createFolder)
		admin.POST("/drops", a.createDrop)
		admin.POST("/drops/meta", a.updateMeta)
		admin.POST("/drops/restore", a.restoreVersion)
		admin.POST("/nodes/delete", a.deleteNode)
		admin.POST("/files", a.uploadFiles)
		admin.POST("/files/save", a.saveFile)
		admin.POST("/files/delete", a.deleteFile)
	}

	r.NoRoute(notFound)

	return r, nil
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
