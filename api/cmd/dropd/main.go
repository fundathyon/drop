// Command dropd serves the Drop admin API: a Gin HTTP layer over a relational
// metadata store and an S3-compatible object store.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/joho/godotenv"

	"drop/internal/auth"
	"drop/internal/config"
	"drop/internal/db"
	"drop/internal/httpapi"
	"drop/internal/objects"
	"drop/internal/service"
)

//	@title			Drop Admin API
//	@version		1.0
//	@description	Admin API for Drop: a Drive-like tree where any folder holding a `.drop` descriptor is a publishable drop. Metadata lives in SQL; file bytes live in MinIO.
//	@description	Every endpoint outside /v1/auth needs a token. Get one from POST /v1/auth/login and send it as `Authorization: Bearer <token>`.
//	@BasePath		/
//
//	@securityDefinitions.apikey	BearerAuth
//	@in							header
//	@name						Authorization
//	@description				RS256 access token, as `Bearer <token>`.
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

	// Tokens are signed with RS256; there is no shared-secret fallback, so a
	// missing keypair is a startup failure rather than a silent downgrade.
	// `make keys` writes one.
	keys, err := auth.LoadKeys(cfg.Auth.PrivateKeyPath, cfg.Auth.PublicKeyPath)
	if err != nil {
		slog.Error("load signing keys", "error", err,
			"hint", "run `make keys` to generate them")
		os.Exit(1)
	}
	issuer := auth.NewIssuer(keys, cfg.Auth.Issuer, cfg.Auth.AccessTTL, cfg.Auth.RefreshTTL)
	accounts := auth.NewService(database, issuer, cfg.Auth.InvitationTTL)

	admin, err := accounts.Bootstrap(ctx, cfg.Auth.AdminEmail, cfg.Auth.AdminPassword)
	if err != nil {
		slog.Error("bootstrap administrator", "error", err)
		os.Exit(1)
	}

	// The tree predates ownership on any database written before drives
	// existed. It is handed to the administrator here, once there is somebody
	// to hand it to; on every later start this matches nothing.
	adopted, err := db.AdoptOwnerlessNodes(database, admin.ID)
	if err != nil {
		slog.Error("assign owners to existing nodes", "error", err)
		os.Exit(1)
	}
	if adopted > 0 {
		slog.Warn("existing drops had no owner and now belong to the administrator",
			"nodes", adopted, "owner", admin.Email)
	}

	handler, err := httpapi.NewRouter(service.New(database, store, cfg.PublicBaseURL), httpapi.Config{
		AllowedOrigins: cfg.CORSOrigins,
		InjectWidget:   cfg.InjectWidget,
		Auth:           accounts,
		CookieSecure:   cfg.Auth.CookieSecure,
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
