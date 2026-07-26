// Package httpapi exposes the admin API over HTTP using Gin, and serves its
// OpenAPI documentation at /docs.
package httpapi

import (
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "drop/docs" // generated OpenAPI spec, registered on import
	"drop/internal/service"
)

// maxUploadMemory is how much of a multipart upload Gin buffers in memory
// before spilling to temporary files.
const maxUploadMemory = 32 << 20 // 32 MiB

type Config struct {
	// AllowedOrigins are the browser origins permitted to call this API
	// cross-origin — the frontend dev server, typically.
	AllowedOrigins []string
}

// NewRouter builds the HTTP handler: the JSON API plus the Swagger UI.
func NewRouter(svc *service.Service, cfg Config) http.Handler {
	gin.SetMode(gin.ReleaseMode)

	h := &handler{svc: svc}

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

		v1.GET("/files", h.downloadFile)
		v1.POST("/files", h.uploadFiles)
		v1.DELETE("/files", h.deleteFile)
	}

	// Swagger UI. /docs redirects to the index so the bare path works.
	r.GET("/docs", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/docs/index.html")
	})
	r.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	r.NoRoute(func(c *gin.Context) {
		abortWithError(c, http.StatusNotFound, "not_found", "no such endpoint")
	})

	return r
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
