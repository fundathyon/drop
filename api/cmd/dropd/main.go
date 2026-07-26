// Command dropd serves the Drop admin API: a Gin HTTP layer over a relational
// metadata store and an S3-compatible object store.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/joho/godotenv"

	"drop/internal/config"
	"drop/internal/db"
	"drop/internal/httpapi"
	"drop/internal/objects"
	"drop/internal/service"
)

//	@title			Drop Admin API
//	@version		1.0
//	@description	Admin API for Drop: a Drive-like tree where any folder holding a `.drop` descriptor is a publishable drop. Metadata lives in SQL; file bytes live in MinIO.
//	@BasePath		/
func main() {
	// A .env next to the binary is convenience for local development; real
	// deployments set the environment directly.
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		slog.Debug("no .env loaded", "error", err)
	}

	cfg := config.Load()
	ctx := context.Background()

	database, err := db.Open(cfg.DatabaseDSN)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}

	store, err := objects.New(ctx, cfg.S3)
	if err != nil {
		slog.Error("open object storage", "error", err, "endpoint", cfg.S3.Endpoint)
		os.Exit(1)
	}

	handler, err := httpapi.NewRouter(service.New(database, store, cfg.PublicBaseURL), httpapi.Config{
		AllowedOrigins: cfg.CORSOrigins,
		InjectWidget:   cfg.InjectWidget,
	})
	if err != nil {
		slog.Error("build router", "error", err)
		os.Exit(1)
	}

	slog.Info("dropd listening",
		"addr", cfg.HTTPAddr,
		"database", cfg.DatabaseDSN,
		"bucket", cfg.S3.Bucket,
		"s3_endpoint", cfg.S3.Endpoint,
		"cors_origins", cfg.CORSOrigins,
		"admin", "http://localhost"+cfg.HTTPAddr+"/",
		"docs", "http://localhost"+cfg.HTTPAddr+"/docs")

	if err := http.ListenAndServe(cfg.HTTPAddr, handler); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
