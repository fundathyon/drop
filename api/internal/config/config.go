// Package config loads the API's runtime settings from the environment.
package config

import (
	"os"
	"strconv"
	"strings"
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
		CORSOrigins:   splitList(env("DROP_CORS_ORIGINS", "http://localhost:3000")),
		S3: S3{
			Endpoint:  env("DROP_S3_ENDPOINT", "localhost:9000"),
			AccessKey: env("DROP_S3_ACCESS_KEY", "dropadmin"),
			SecretKey: env("DROP_S3_SECRET_KEY", "dropadmin123"),
			Bucket:    env("DROP_S3_BUCKET", "drop-content"),
			UseSSL:    envBool("DROP_S3_USE_SSL", false),
		},
	}
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
