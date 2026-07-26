# 05 — Repositorio, convenciones y roadmap

## 14. Estructura completa del repositorio

Monorepo, un solo módulo Go (`github.com/miempresa/drop`), 4 binarios.

```
drop/
├── README.md
├── LICENSE
├── Makefile                        # dev, test, lint, generate, migrate, docker-up
├── go.mod  go.sum
├── .golangci.yml
├── .goreleaser.yml                 # binarios de la CLI (mac/linux/windows, brew, scoop)
├── docker-compose.yml              # postgres + minio + redis + dropd + router
├── .env.example
├── sqlc.yaml
├── .github/workflows/              # ci.yml, release.yml, security.yml
│
├── api/
│   └── openapi/
│       ├── openapi.yaml            # FUENTE DE VERDAD del contrato
│       └── components/             # schemas/, responses/, parameters/ ($ref)
│
├── cmd/
│   ├── dropd/main.go               # API HTTP
│   ├── drop-router/main.go         # resolutor del plano de datos
│   ├── drop-worker/main.go         # jobs asíncronos
│   └── drop/main.go                # CLI
│
├── internal/
│   │
│   ├── domain/                     # ← NO importa nada de infraestructura (solo stdlib)
│   │   ├── drop/
│   │   │   ├── drop.go             # entidad Drop + invariantes
│   │   │   ├── slug.go             # value object Slug (+ generación y blocklist)
│   │   │   ├── visibility.go
│   │   │   ├── repository.go       # puerto: DropRepository
│   │   │   └── errors.go           # ErrNotFound, ErrSlugTaken...
│   │   ├── release/
│   │   │   ├── release.go          # agregado Release + máquina de estados
│   │   │   ├── manifest.go         # Manifest, File, normalización de rutas
│   │   │   ├── path.go             # value object Path (anti path-traversal)
│   │   │   ├── state.go
│   │   │   └── repository.go
│   │   ├── blob/
│   │   │   ├── blob.go
│   │   │   ├── hash.go             # value object SHA256
│   │   │   ├── mime.go             # allowlist y coherencia de tipos
│   │   │   ├── store.go            # puerto: BlobStore (presign, head, copy, delete)
│   │   │   └── repository.go
│   │   ├── identity/
│   │   │   ├── user.go  organization.go  membership.go  role.go
│   │   │   ├── apikey.go  token.go
│   │   │   └── repository.go
│   │   ├── authz/
│   │   │   ├── policy.go           # Can(subject, action, resource)
│   │   │   └── subject.go
│   │   ├── storage/
│   │   │   ├── pool.go             # storage pools, política de colocación
│   │   │   └── layout.go           # ÚNICO lugar que construye claves de objeto
│   │   ├── routing/
│   │   │   ├── route.go            # slug → release
│   │   │   └── store.go            # puerto: RouteStore
│   │   └── quota/
│   │       ├── limits.go  plan.go
│   │
│   ├── usecase/                    # orquestación; una carpeta por área
│   │   ├── publish/
│   │   │   ├── init_release.go     # negociación + presign
│   │   │   ├── finalize_release.go # verify + assemble + pointer flip
│   │   │   ├── assembler.go        # copia CAS → s/{release}/ (compartido con el worker)
│   │   │   ├── abort_release.go
│   │   │   └── *_test.go
│   │   ├── drops/                  # list, get, patch, delete, rollback(v1)
│   │   ├── auth/                   # device flow, refresh, logout, apikeys
│   │   ├── orgs/                   # members, usage, audit
│   │   └── maintenance/            # gc_blobs, purge_release, expire_drops, scan
│   │
│   ├── adapter/
│   │   ├── httpapi/                # entrada HTTP (Chi)
│   │   │   ├── server.go  router.go
│   │   │   ├── handler_*.go        # drops, releases, auth, orgs
│   │   │   ├── dto/                # request/response + mapeo desde el dominio
│   │   │   ├── middleware/         # authn, authz, ratelimit, reqid, recover,
│   │   │   │                       # otel, logging, idempotency, cors
│   │   │   ├── problem/            # RFC 9457: dominio → HTTP
│   │   │   └── gen/                # ← generado por oapi-codegen (versionado)
│   │   ├── postgres/
│   │   │   ├── db.go  tx.go        # pool pgx + gestor transaccional (unit of work)
│   │   │   ├── queries/*.sql       # ← fuente de sqlc
│   │   │   ├── gen/                # ← generado por sqlc (versionado)
│   │   │   └── repo_*.go           # implementaciones de los puertos del dominio
│   │   ├── objectstore/
│   │   │   ├── s3.go               # AWS SDK v2: presign, head, copy, delete
│   │   │   └── s3_test.go          # testcontainers + MinIO
│   │   ├── cache/                  # redis: ratelimit, routestore, idempotency, locks
│   │   ├── authn/                  # jwt (Ed25519), argon2id, keyring de la CLI
│   │   ├── jobs/                   # cola Postgres (SKIP LOCKED) + registro de handlers
│   │   └── notify/                 # (v1) webhooks, email
│   │
│   ├── router/                     # el binario drop-router
│   │   ├── resolver.go             # slug+path → clave de objeto
│   │   ├── proxy.go  redirect.go   # dos modos de entrega
│   │   ├── headers.go              # cache-control, nosniff, noindex...
│   │   └── errors.go               # páginas 404/410/403
│   │
│   ├── cli/
│   │   ├── cmd/                    # root, login, logout, whoami, upload, list,
│   │   │                           # info, open, delete, config, version, completion
│   │   ├── scanner/                # walk, ignore, entrypoint, html.go, css.go, svg.go
│   │   ├── hasher/                 # sha256 en streaming + pool de workers
│   │   ├── uploader/               # concurrencia, reintentos, multipart, progreso
│   │   ├── client/                 # wrapper del cliente generado desde OpenAPI
│   │   ├── config/                 # perfiles, .drop/config.json, precedencia
│   │   ├── credentials/            # keyring + fallback a fichero 0600
│   │   └── ui/                     # spinner, tabla, colores, modo CI, --json
│   │
│   └── platform/                   # infraestructura transversal, sin lógica de negocio
│       ├── config/                 # env → structs tipadas, validación al arrancar
│       ├── log/                    # slog JSON + redacción de secretos
│       ├── otel/                   # traces, metrics, propagación
│       ├── health/                 # healthz/readyz
│       ├── httpx/                  # servidor con graceful shutdown, cliente con retry
│       ├── id/                     # uuidv7, base62, crypto/rand
│       ├── clock/                  # interfaz Clock (tests deterministas)
│       └── errs/                   # errores de dominio → códigos
│
├── pkg/                            # API pública estable (importable desde fuera)
│   ├── dropclient/                 # SDK Go (envuelve el cliente generado)
│   └── manifest/                   # formato del manifest (spec compartida)
│
├── migrations/                     # goose, forward-only
│   ├── 00001_initial_schema.sql
│   ├── 00002_partitions_release_files.sql
│   └── ...
│
├── deploy/
│   ├── docker/                     # Dockerfile.dropd, .router, .worker (multi-stage)
│   ├── edge/                       # Cloudflare Worker / CloudFront Function (v1)
│   └── k8s/                        # (v2) manifiestos/helm
│
├── test/
│   ├── e2e/                        # publish end-to-end contra el stack de compose
│   ├── fixtures/                   # sitios de ejemplo (simple, con assets, hostil)
│   └── testutil/                   # testcontainers (pg + minio), factories, golden files
│
├── tools/
│   └── tools.go                    # pin de sqlc, oapi-codegen, goose, golangci-lint
│
└── docs/
    ├── design/                     # ← este diseño
    ├── adr/                        # ADRs extraídos, uno por fichero
    ├── runbooks/                   # incidentes: GC parado, bucket lleno, abuso
    └── api/                        # docs generadas desde OpenAPI
```

### Notas sobre la organización de paquetes

- **`internal/` por defecto.** Solo `pkg/` es importable desde fuera, y solo contiene lo
  que estamos dispuestos a mantener estable (SDK y spec del manifest).
- **Los puertos viven en `domain/<agregado>/`**, no en un paquete `ports/`. Los define
  quien los consume y son pequeños (`BlobStore` tiene 5 métodos, no 30).
- **`domain/storage/layout.go` es el único sitio que construye claves de objeto.** Si el
  layout del bucket se decide en dos lugares, tarde o temprano divergen y se corrompen
  datos.
- **`usecase/publish/assembler.go` se comparte** entre el handler síncrono y el worker
  (ADR-011): una sola implementación del ensamblado.
- **El código generado se versiona** (`gen/`) para que `go build` funcione sin toolchain
  extra, con un check en CI que verifica que `make generate` no produce diff.
- **La CLI no puede importar adaptadores del servidor.** Test de arquitectura que falla
  si el grafo de imports de `cmd/drop` toca `internal/adapter/postgres`.
- Sin paquetes `utils`, `common`, `helpers`, `models` ni `base`. Si algo no tiene nombre
  propio, es que aún no sabemos qué es.

---

## 15. Convenciones de código

### Go

- **Go 1.24+**, `gofumpt`, `golangci-lint` con: `errcheck`, `govet`, `staticcheck`,
  `revive`, `gosec`, `bodyclose`, `rowserrcheck`, `sqlclosecheck`, `contextcheck`,
  `errorlint`, `nilerr`, `copyloopvar`, `perfsprint`. **CI falla con cualquier warning.**
- `context.Context` como primer parámetro en toda función que haga I/O. Nunca guardado
  en un struct.
- **Errores**: envolver con `fmt.Errorf("finalize release %s: %w", id, err)`. Sentinelas
  en el dominio (`var ErrNotFound = errors.New(...)`), comparación con `errors.Is/As`.
  El mapeo a HTTP ocurre **solo** en `adapter/httpapi/problem`. El dominio no conoce
  códigos de estado.
- **Interfaces**: pequeñas, definidas por el consumidor, nombradas por comportamiento
  (`BlobStore`, `RouteStore`, `Clock`). Los constructores devuelven tipos concretos
  (`func NewS3Store(...) *S3Store`), no interfaces.
- **Sin estado global**: ni `init()` con efectos, ni singletons, ni variables de paquete
  mutables. Todo se inyecta desde `cmd/*`.
- **Concurrencia**: `errgroup` con `SetLimit` siempre (nunca fan-out ilimitado); toda
  goroutine tiene dueño y forma de terminar; `context` cancelable de extremo a extremo.
- **Nombres**: paquetes en singular y minúscula sin `_`; `release.Release` es aceptable
  antes que `release.ReleaseEntity`. Sin prefijos húngaros, sin `I` en interfaces.
- **Comentarios**: godoc en todo lo exportado. En el cuerpo, solo el *por qué*; el *qué*
  lo dice el código.

### Tests

- **Table-driven** por defecto; `testify/require` para aserciones (permitido; `assert`
  desaconsejado: los tests deben parar en el primer fallo).
- **Pirámide**: dominio y casos de uso con dobles en memoria (rápidos, sin red) →
  adaptadores con **testcontainers** (Postgres real, MinIO real; nunca mocks de SQL) →
  e2e del flujo de publicación completo.
- **Objetivo de cobertura**: `domain` y `usecase` > 85%. Los adaptadores se cubren con
  tests de integración, no persiguiendo el porcentaje.
- Casos hostiles como ciudadanos de primera clase (`test/fixtures/hostile/`): rutas con
  `..`, symlinks al exterior, nombres con NUL, SVG con `<script>`, HTML de 30 MB,
  colisiones de mayúsculas, hash que no coincide con los bytes.
- Determinismo: `Clock` y `IDGen` inyectados. Prohibido `time.Sleep` en tests
  (`synctest`/polling con timeout).
- Golden files para la salida `--json` de la CLI: **es contrato público**.

### Observabilidad

- **Logging estructurado** con `slog` en JSON: `level, ts, msg, request_id, trace_id,
  org_id, user_id, drop_slug, release_id, duration_ms`. **Un solo log por request** en
  el camino feliz (no hay `log.Println` de depuración en producción). Redacción
  obligatoria de tokens, hashes de secretos y URLs prefirmadas.
- **Traces (OTel)**: `init → presign → uploads (cliente) → finalize → copy → publish`
  correlacionados. La CLI envía `traceparent`: una publicación lenta se diagnostica de
  punta a punta.
- **Métricas** (Prometheus, `RED` + negocio): `drop_publish_duration_seconds`,
  `drop_publish_total{result}`, `drop_dedup_ratio`, `drop_blob_upload_bytes`,
  `drop_assemble_objects_total`, `drop_gc_deleted_total`, `drop_route_cache_hit_ratio`,
  `drop_quota_rejections_total`.
- **SLOs propuestos**: `init` p99 < 300 ms · publish extremo a extremo p95 < 3 s para
  ≤ 20 archivos · disponibilidad de lectura del plano de datos 99,95% ·
  disponibilidad de la API 99,9%.

### Configuración (12-factor)

Solo variables de entorno, parseadas a structs tipadas y **validadas al arrancar**
(fallo inmediato si falta algo, nunca un valor por defecto silencioso en producción):

```
DROP_ENV, DROP_LOG_LEVEL, DROP_HTTP_ADDR
DROP_DATABASE_URL, DROP_DATABASE_MAX_CONNS
DROP_REDIS_URL
DROP_S3_ENDPOINT, DROP_S3_REGION, DROP_S3_BUCKET,
DROP_S3_ACCESS_KEY_ID, DROP_S3_SECRET_ACCESS_KEY, DROP_S3_FORCE_PATH_STYLE
DROP_PUBLIC_BASE_URL, DROP_APP_BASE_URL
DROP_JWT_PRIVATE_KEY (PEM Ed25519), DROP_JWT_KEY_ID
DROP_LIMIT_FILE_BYTES, DROP_LIMIT_RELEASE_BYTES, DROP_LIMIT_FILE_COUNT
DROP_OTEL_EXPORTER_OTLP_ENDPOINT
```

### Git y CI

- **Conventional Commits** (`feat(cli):`, `fix(api):`, `chore(deps):`) → CHANGELOG
  automático.
- Trunk-based: ramas cortas, PR obligatoria, CI verde, squash merge.
- CI: `lint → generate-check → test-unit → test-integration → build → e2e → security`
  (`gosec`, `govulncheck`, escaneo de imágenes).
- Versionado: SemVer. La CLI se publica con **goreleaser** (Homebrew, Scoop, `.deb`,
  binarios). La API versiona su contrato en la ruta (`/v1`).

---

## 13. Roadmap

### MVP — "un comando, una URL" (4–5 semanas)

Objetivo: `drop login && drop upload .` funciona de punta a punta, con
`docker-compose up` levantando todo el stack en local.

| # | Entregable |
|---|---|
| 0 | Andamiaje: repo, módulo, Makefile, compose (PG + MinIO + Redis), CI, config, logging, healthz |
| 1 | `openapi.yaml` v1 del camino de publicación + generación de servidor y cliente |
| 2 | Migraciones y dominio: orgs, users, memberships, projects, drops, releases, blobs, release_files, storage_pools |
| 3 | Auth: device flow, JWT Ed25519, refresh rotatorio, JWKS, middleware authn/authz, API keys |
| 4 | `objectstore`: presign con checksum, head, copy, delete (tests con MinIO) |
| 5 | **`InitRelease`**: validación, cuotas, dedup, presign |
| 6 | **`FinalizeRelease`**: verificación, ensamblado concurrente, pointer flip atómico, `RouteStore` |
| 7 | `drop-router` (modo proxy y redirect), entrypoint, índices de directorio, 404, headers |
| 8 | CLI: `login`, `logout`, `whoami`, `upload` (archivo y directorio), escáner HTML/CSS/SVG, hasher, uploader, UI + `--json` |
| 9 | CLI: `list`, `info`, `open`, `delete` |
| 10 | `drop-worker`: GC de blobs, limpieza de releases abandonados, purga |
| 11 | Rate limiting, `audit_events`, métricas, traces |
| 12 | Tests e2e (incluidos los fixtures hostiles), README, `docs/adr/`, guía de self-hosting |

**Fuera del MVP, explícitamente**: dashboard web, versionado expuesto, contraseñas,
expiración, dominios personalizados, analytics, multi-región, antivirus.

**Definición de "hecho" del MVP**
- `drop upload .` con 20 archivos: < 3 s en red doméstica.
- Republicar solo sube lo que cambió (verificado por test).
- Matar `dropd` a mitad de `finalize` no deja ningún drop visible roto.
- Cada fixture hostil produce un error claro, no un 500.
- Un tercero levanta el stack completo con `docker-compose up` y una variable de entorno.

### v1 — "listo para equipos" (2–3 meses después)

- **Versionado y rollback** expuestos: `drop releases <slug>`, `drop rollback <slug> [seq]`
  (el modelo de datos ya lo soporta: solo faltan endpoints y comandos).
- **Contraseña y expiración** por drop (aplicadas en el router con cookie firmada).
- **Privacidad real**: drops `private` con auth de lector; bucket privado + signed
  cookies con alcance al prefijo del release.
- **Aislamiento por subdominio** (`aBc91K.dropusercontent.com`) — cierra R-02.
- **API keys + GitHub Action** oficial (`drop-upload-action`) y `--json` estabilizado.
- **Router nativo en el borde** (Cloudflare Worker + KV / CloudFront Function).
- **Dashboard web** de solo lectura: listar, previsualizar, borrar, gestionar miembros y
  keys.
- **Cuotas y planes**, contadores de uso, avisos.
- **Analytics básico**: visitas por drop desde los logs del borde (agregados, sin
  cookies, respetuoso con la privacidad).
- **Antivirus opcional** y pipeline de abuso con reportes y takedown.
- **`drop watch`**: republica al detectar cambios (bucle de desarrollo).
- **RLS de Postgres** como red de seguridad de tenancy.

### v2 — "plataforma" (6+ meses)

- **Organizaciones, teams y workspaces** completos, con RBAC granular y SSO/SAML.
- **Dominios personalizados** con emisión automática de certificados.
- **Multi-región**: pools por región, colocación por organización, réplica y latencia
  de escritura optimizada.
- **Deploy desde GitHub**: GitHub App que publica en cada push (previews por PR).
- **SDKs** (Go, TypeScript, Python) generados desde OpenAPI.
- **Integraciones con agentes y editores**: **servidor MCP de Drop** (el vector
  principal: Claude Code, Cursor, Windsurf, OpenCode y Codex CLI hablan MCP), más
  extensión de VS Code y comandos empaquetados. La CLI con `--json` es el sustrato de
  todas ellas.
- **Comentarios y anotaciones** sobre drops publicados.
- **Búsqueda** sobre metadata y contenido HTML indexado.
- **Webhooks** y exportación de auditoría.
- Optimizaciones: brotli precomputado, dedup por chunks para HTML grandes, colapso del
  doble almacenamiento (ADR-003) si el coste lo justifica.

### Cómo el MVP ya soporta el futuro (sin implementarlo)

| Futuro | Costura ya presente en el MVP |
|---|---|
| Versionado / rollback / historial | `releases` con `seq` + `current_release_id`; los releases antiguos no se borran |
| Contraseña / expiración / privados | Columnas en `drops` + `RouteResolver` como punto de aplicación |
| Dominios personalizados | Tabla `domains` + el router discrimina por `Host` |
| Analytics | Hop del router ya existe: solo hay que emitir eventos |
| Teams / workspaces | `organizations` → `projects` → `drops` desde el día 1 |
| Multi-región / multi-bucket | `storage_pools` con `pool_id` en cada blob y release |
| API keys / SDK / integraciones IDE | OpenAPI como fuente de verdad + `--json` versionado + `pkg/dropclient` |
| Deploy desde GitHub | `releases.source` y la publicación por API son agnósticas al cliente |
| Antivirus | `blobs.scan_state` + cola de jobs |
| Comentarios | Entidades nuevas; ninguna migración de lo existente |
