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
	// PRIVATE_KEY_JWT/PUBLIC_KEY_JWT (the keypair itself) take priority over
	// JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH (a path to it) when both are
	// set, for platforms with no writable filesystem to point a path at;
	// `make keys` is what writes the files the path-based default expects.
	var keys *auth.Keys
	switch {
	case cfg.Auth.PrivateKeyPEM != "" && cfg.Auth.PublicKeyPEM != "":
		keys, err = auth.KeysFromPEM([]byte(cfg.Auth.PrivateKeyPEM), []byte(cfg.Auth.PublicKeyPEM))
		if err != nil {
			slog.Error("load signing keys from PRIVATE_KEY_JWT/PUBLIC_KEY_JWT", "error", err)
			os.Exit(1)
		}
	case cfg.Auth.PrivateKeyPEM != "" || cfg.Auth.PublicKeyPEM != "":
		slog.Error("PRIVATE_KEY_JWT and PUBLIC_KEY_JWT must both be set, or both left empty to load from JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH")
		os.Exit(1)
	default:
		keys, err = auth.LoadKeys(cfg.Auth.PrivateKeyPath, cfg.Auth.PublicKeyPath)
		if err != nil {
			slog.Error("load signing keys", "error", err,
				"hint", "run `make keys` to generate them")
			os.Exit(1)
		}
	}
	issuer := auth.NewIssuer(keys, cfg.Auth.Issuer, cfg.Auth.AccessTTL, cfg.Auth.RefreshTTL)
	accounts := auth.NewService(database, issuer, cfg.Auth.InvitationTTL)

	// Headless bootstrap is opt-in and all-or-nothing: both ADMIN_EMAIL and
	// ADMIN_PASSWORD set means a scripted/containerized deployment that pins
	// its own credentials, so the administrator is created here rather than
	// waiting on a browser. Exactly one set is almost certainly a typo, so it
	// fails loudly instead of silently falling through to the wizard. Neither
	// set — the default — leaves the database empty and the interactive
	// /setup wizard creates the first administrator instead.
	var admin auth.UserInfo
	switch {
	case cfg.Auth.AdminEmail != "" && cfg.Auth.AdminPassword != "":
		admin, err = accounts.Bootstrap(ctx, cfg.Auth.AdminEmail, cfg.Auth.AdminPassword)
		if err != nil {
			slog.Error("bootstrap administrator", "error", err)
			os.Exit(1)
		}
	case cfg.Auth.AdminEmail != "" || cfg.Auth.AdminPassword != "":
		slog.Error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set, or both left empty for the interactive setup wizard")
		os.Exit(1)
	default:
		slog.Info("no administrator configured; waiting for the interactive setup wizard",
			"setup", "http://localhost"+cfg.HTTPAddr+"/setup")
	}

	// Organizations arrived after users did. This covers both a database
	// upgraded from before they existed and the account Bootstrap may have
	// just created above, in the same pass — a fresh, still-empty database
	// is left alone, since /setup creates the organization for that case.
	if _, err := accounts.BackfillOrganizations(ctx); err != nil {
		slog.Error("backfill organizations", "error", err)
		os.Exit(1)
	}

	// The tree predates ownership on any database written before drives
	// existed. It is handed to the administrator here, once there is somebody
	// to hand it to; on every later start this matches nothing. Skipped
	// entirely when Bootstrap did not run above: the interactive wizard runs
	// the same adoption once it creates the first administrator instead.
	if admin.ID != 0 {
		adopted, err := db.AdoptOwnerlessNodes(database, admin.ID)
		if err != nil {
			slog.Error("assign owners to existing nodes", "error", err)
			os.Exit(1)
		}
		if adopted > 0 {
			slog.Warn("existing drops had no owner and now belong to the administrator",
				"nodes", adopted, "owner", admin.Email)
		}
	}

	tree := service.New(database, store, cfg.PublicBaseURL)
	handler, err := httpapi.NewRouter(tree, httpapi.Config{
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
