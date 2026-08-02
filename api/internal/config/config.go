// Package config loads the API's runtime settings from the environment.
package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr    string
	DatabaseDSN string
	// PublicBaseURL is the origin published drops are served from. It is what
	// the API hands back as a drop's URL, so it must be reachable by whoever
	// receives that link.
	PublicBaseURL string
	// InjectWidget appends the Drop badge to published HTML pages. It is the
	// only thing the API adds to user content, so it can be turned off.
	InjectWidget bool
	CORSOrigins  []string
	S3           S3
	Auth         Auth
}

// Auth configures signing and the bootstrap administrator.
type Auth struct {
	// PrivateKeyPath and PublicKeyPath hold the RS256 keypair. There is no
	// shared-secret fallback: a symmetric key would have to be handed to
	// everything that verifies a token, and each of those could then mint one.
	PrivateKeyPath string
	PublicKeyPath  string
	Issuer         string
	// AccessTTL and RefreshTTL are configured rather than compiled in, so the
	// window of a stolen token can be changed without a release.
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	// InvitationTTL is how long an invitation link stays usable.
	InvitationTTL time.Duration
	// AdminEmail and AdminPassword create the first administrator headlessly
	// on an empty database, for scripted or containerized deployments that
	// pin credentials via secrets. Left empty (the default), an empty
	// database instead waits for the interactive /setup wizard. An existing
	// admin is never modified from here either way.
	AdminEmail    string
	AdminPassword string
	// CookieSecure marks the refresh cookie Secure. It defaults to off so
	// plain-HTTP localhost works, and must be on anywhere else.
	CookieSecure bool
}

// S3 points at a MinIO (or any S3-compatible) endpoint holding drop content.
type S3 struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

// Load reads the configuration, applying defaults suited to the local
// docker-compose stack.
func Load() Config {
	return Config{
		HTTPAddr:      env("DROP_HTTP_ADDR", ":8000"),
		DatabaseDSN:   env("DROP_DATABASE_DSN", "drop.db"),
		PublicBaseURL: strings.TrimSuffix(env("DROP_PUBLIC_BASE_URL", "http://localhost:8000"), "/"),
		InjectWidget:  envBool("DROP_INJECT_WIDGET", true),
		// Empty by default: the admin is served by this same process, so
		// nothing needs cross-origin access until a third-party client does.
		CORSOrigins: splitList(os.Getenv("DROP_CORS_ORIGINS")),
		S3: S3{
			Endpoint:  env("DROP_S3_ENDPOINT", "localhost:9000"),
			AccessKey: env("DROP_S3_ACCESS_KEY", "dropadmin"),
			SecretKey: env("DROP_S3_SECRET_KEY", "dropadmin123"),
			Bucket:    env("DROP_S3_BUCKET", "drop-content"),
			UseSSL:    envBool("DROP_S3_USE_SSL", false),
		},
		Auth: Auth{
			PrivateKeyPath: env("JWT_PRIVATE_KEY_PATH", "./certs/private.pem"),
			PublicKeyPath:  env("JWT_PUBLIC_KEY_PATH", "./certs/public.pem"),
			Issuer:         env("JWT_ISSUER", "drop"),
			AccessTTL:      envDuration("ACCESS_TOKEN_TTL", 15*time.Minute),
			RefreshTTL:     envDuration("REFRESH_TOKEN_TTL", 720*time.Hour),
			InvitationTTL:  envDuration("INVITATION_TTL", 72*time.Hour),
			AdminEmail:     env("ADMIN_EMAIL", ""),
			AdminPassword:  env("ADMIN_PASSWORD", ""),
			CookieSecure:   envBool("AUTH_COOKIE_SECURE", false),
		},
	}
}

// envDuration reads a Go duration such as "15m" or "720h".
func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		// Falling back silently would hand out tokens with a lifetime nobody
		// asked for, so this is loud.
		slog.Warn("ignoring invalid duration", "key", key, "value", raw, "using", fallback)
		return fallback
	}
	return d
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return v
}

func splitList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
