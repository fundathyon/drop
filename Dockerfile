# syntax=docker/dockerfile:1
#
# One file, two runtime images, selected with `docker build --target`:
#   api   the Go server (apps/api/cmd/dropd) — JSON API + published drops
#   web   the Next.js admin panel (apps/web), standalone output
#
# The build context is the repo root for both, because the web build needs
# the workspace root (package.json + bun.lock) and not just apps/web.

# ------------------------------
# Go build stage
# ------------------------------
FROM golang:1.26-alpine AS api-build
WORKDIR /src/apps/api

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/. .
# The SQLite driver (modernc.org/sqlite) is pure Go, so the binary needs no
# C toolchain and no libc at runtime — CGO_ENABLED=0 and the alpine runtime
# stage below both fall out of that for free.
RUN CGO_ENABLED=0 go build -o /out/dropd ./cmd/dropd

# ------------------------------
# api target
# ------------------------------
FROM alpine:3.20 AS api
RUN apk add --no-cache ca-certificates

COPY --from=api-build /out/dropd /usr/local/bin/dropd
COPY infra/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["dropd"]

# ------------------------------
# Bun build stage
# ------------------------------
FROM oven/bun:1 AS web-build
WORKDIR /src

# Manifests first, so a source-only change doesn't re-resolve the whole
# dependency tree. The lockfile is the workspace's, at the repo root.
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile

COPY apps/web ./apps/web
# DROP_API_URL only matters at request time (every fetch reads it fresh from
# process.env at runtime, nothing is inlined at build time), so the build
# needs no server-side secrets — only NEXT_PUBLIC_* values would, and there
# are none here.
RUN cd apps/web && bun run build

# ------------------------------
# web target
# ------------------------------
# next.config.ts sets output: "standalone" with the tracing root pinned to the
# workspace, so the traced bundle lands at .next/standalone/apps/web/server.js
# with the shared node_modules store one level up — that nesting is why the
# copies below re-create the apps/web/ prefix instead of flattening it.
FROM oven/bun:1-slim AS web
WORKDIR /app
ENV NODE_ENV=production
# Docker auto-injects HOSTNAME=<container-id>, and the standalone Next server
# does `process.env.HOSTNAME || "0.0.0.0"` — so without this override it binds
# only to the interface that container id resolves to. Published ports still
# work by luck; anything hitting 127.0.0.1 inside the container (a compose
# healthcheck, an exec'd curl) does not.
ENV HOSTNAME=0.0.0.0

COPY --from=web-build /src/apps/web/.next/standalone ./
COPY --from=web-build /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /src/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
