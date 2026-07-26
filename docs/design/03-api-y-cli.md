# 03 — Diseño de la API REST y de la CLI

## 9. API REST

### 9.1 Convenciones transversales

| Aspecto | Decisión |
|---|---|
| Base | `https://api.drop.miempresa.com/v1` — versión en la ruta, no en cabecera |
| Contrato | **OpenAPI 3.1 primero**: `api/openapi/openapi.yaml` es la fuente de verdad. `oapi-codegen` genera interfaces del servidor + cliente Go de la CLI. Un cambio de contrato que no compile = build roto |
| Formato | JSON, `snake_case` (consistente con la mayoría de APIs públicas y con `--json` de la CLI) |
| Errores | **RFC 9457 `application/problem+json`** |
| Paginación | Cursor opaco: `?limit=50&cursor=...` → `{ "data": [...], "next_cursor": "..." }`. Nunca `offset` |
| Idempotencia | Cabecera `Idempotency-Key` en todos los POST que crean o mutan estado; respuesta cacheada 24 h |
| Concurrencia | `ETag` + `If-Match` en PATCH de recursos mutables |
| Trazas | `X-Request-Id` (se acepta el del cliente o se genera); propagación W3C `traceparent` |
| Rate limit | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` en 429 |
| Auth | `Authorization: Bearer <jwt>` o `Authorization: Bearer drop_sk_...` |
| Compatibilidad | Nunca se elimina ni se reinterpreta un campo dentro de `v1`; solo se añaden campos opcionales |

**Formato de error**

```json
{
  "type": "https://docs.drop.dev/errors/file-too-large",
  "title": "File exceeds the maximum allowed size",
  "status": 422,
  "detail": "assets/demo.mp4 is 142.3 MB; the limit for video is 100 MB",
  "instance": "/v1/drops/aBc91K/releases",
  "code": "file_too_large",
  "request_id": "01J8ZK9V...",
  "errors": [
    { "path": "files[14].size", "code": "max_size", "limit": 104857600, "got": 149217280 }
  ]
}
```

`code` es el contrato estable para máquinas (la CLI mapea `code` → mensaje y exit
code); `title`/`detail` son para humanos y pueden cambiar.

### 9.2 Catálogo de endpoints

#### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/auth/device` | Inicia device flow → `device_code`, `user_code`, `verification_uri` |
| `POST` | `/v1/auth/device/token` | Polling; `400 authorization_pending` hasta la aprobación |
| `POST` | `/v1/auth/token` | Canjea código PKCE (flujo loopback) |
| `POST` | `/v1/auth/refresh` | Rota el refresh token → nuevo par de tokens |
| `POST` | `/v1/auth/logout` | Revoca la familia de refresh tokens del dispositivo |
| `GET` | `/v1/me` | Usuario, organizaciones y rol efectivo |
| `GET` | `/.well-known/jwks.json` | Claves públicas de verificación (fuera de `/v1`) |

#### Organizaciones y credenciales

| Método | Ruta |
|---|---|
| `GET` `POST` | `/v1/orgs` |
| `GET` `PATCH` | `/v1/orgs/{org}` |
| `GET` `POST` `DELETE` | `/v1/orgs/{org}/members[/{user}]` |
| `GET` `POST` | `/v1/orgs/{org}/api-keys` (el secreto se devuelve **una sola vez**) |
| `DELETE` | `/v1/orgs/{org}/api-keys/{id}` (revocación inmediata) |
| `GET` | `/v1/orgs/{org}/usage` |
| `GET` | `/v1/orgs/{org}/audit-events` |

#### Drops

| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/v1/drops` | Filtros: `project`, `q`, `visibility`, `created_by`; cursor |
| `POST` | `/v1/drops` | Crea un drop vacío (opcional: normalmente lo crea el flujo de release) |
| `GET` | `/v1/drops/{slug}` | Metadata + release actual + URL pública |
| `PATCH` | `/v1/drops/{slug}` | `title`, `visibility`, (v1) `expires_at`, `password` |
| `DELETE` | `/v1/drops/{slug}` | Soft delete; `?purge=true` (solo admin) borra ya |
| `GET` | `/v1/drops/{slug}/releases` | Historial (base del versionado de v1) |
| `GET` | `/v1/drops/{slug}/files` | Manifest del release actual |

#### Publicación — el núcleo

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/drops/{slug}/releases` | **Init**: recibe el manifest, devuelve las URLs de subida de lo que falta |
| `POST` | `/v1/releases` | Init + creación del drop en una sola llamada (primer publish) |
| `GET` | `/v1/releases/{id}` | Estado (polling durante `assembling`) |
| `POST` | `/v1/releases/{id}/finalize` | Verifica, ensambla y publica atómicamente |
| `POST` | `/v1/releases/{id}/abort` | Cancela un release en `uploading` |
| `POST` | `/v1/drops/{slug}/rollback` | (v1) Repunta a un release anterior |

#### Operación

`GET /healthz` (liveness), `GET /readyz` (dependencias), `GET /metrics`
(Prometheus, red interna), `GET /openapi.json`.

### 9.3 El intercambio de publicación, completo

**Request — init**

```http
POST /v1/releases HTTP/1.1
Authorization: Bearer eyJhbGc...
Idempotency-Key: 01J8ZK9VQ4T7X2M0
Content-Type: application/json

{
  "project": "default",
  "title": "Arquitectura de Drop",
  "entrypoint": "index.html",
  "visibility": "public",
  "client": { "cli_version": "0.1.0", "os": "darwin/arm64" },
  "files": [
    { "path": "index.html",     "sha256": "9f2b...c1", "size": 48213, "content_type": "text/html" },
    { "path": "assets/app.css", "sha256": "2a71...9d", "size": 10240, "content_type": "text/css" },
    { "path": "img/arch.svg",   "sha256": "cc10...4e", "size": 88190, "content_type": "image/svg+xml" }
  ]
}
```

**Response — init**

```http
HTTP/1.1 201 Created
Location: /v1/releases/01J8ZKA1
Content-Type: application/json

{
  "release_id": "01J8ZKA1...",
  "drop": { "slug": "aBc91K", "url": "https://drop.miempresa.com/aBc91K" },
  "state": "uploading",
  "expires_at": "2026-07-25T17:20:00Z",
  "upload_concurrency": 8,
  "uploads": [
    {
      "sha256": "9f2b...c1",
      "method": "PUT",
      "url": "https://s3.eu-central-1.amazonaws.com/drop-content-prod-eu/blobs/...?X-Amz-...",
      "headers": {
        "Content-Type": "text/html",
        "x-amz-checksum-sha256": "nyt...=="
      }
    }
  ],
  "skipped": [
    { "sha256": "2a71...9d", "reason": "already_stored" },
    { "sha256": "cc10...4e", "reason": "already_stored" }
  ],
  "stats": { "files": 3, "to_upload": 1, "deduplicated": 2, "bytes_saved": 98430 }
}
```

Puntos de diseño:
- La API **decide qué se sube**; la CLI no adivina. Si mañana el dedup cambia (por
  ejemplo, dedup por chunks), la CLI no se toca.
- `headers` viene explícito: la CLI debe enviarlos **tal cual** o la firma falla. Es un
  contrato, no una sugerencia.
- `expires_at` es el TTL de las URLs (1 h). Si expira a mitad de una subida grande, la
  CLI llama a `POST /v1/releases/{id}/refresh-uploads` en lugar de empezar de cero.

**Request — finalize**

```http
POST /v1/releases/01J8ZKA1/finalize HTTP/1.1
Idempotency-Key: 01J8ZK9VQ4T7X2M0-fin
```

**Response — finalize (síncrono)**

```json
{
  "release_id": "01J8ZKA1...",
  "state": "published",
  "seq": 1,
  "url": "https://drop.miempresa.com/aBc91K",
  "entrypoint": "index.html",
  "files": 3, "total_bytes": 146643,
  "published_at": "2026-07-25T16:21:04Z"
}
```

Si supera el umbral: `202 Accepted` con `state: "assembling"` y la CLI hace polling con
backoff sobre `GET /v1/releases/{id}`. **La CLI implementa el polling desde el día 1**
aunque el MVP casi siempre responda 200: así el paso a asíncrono es invisible.

### 9.4 Validaciones en `init` (fail fast, antes de subir un solo byte)

1. Autenticación, autorización (`releases:write` sobre la organización) y cuotas.
2. **Normalización y validación de cada `path`**: relativo, sin `..`, sin raíz `/`,
   sin `\`, sin bytes nulos ni de control, sin nombres reservados de Windows
   (`CON`, `NUL`, `AUX`…), NFC Unicode, sin duplicados tras normalizar (`A.png` vs
   `a.png` es un conflicto en almacenamientos case-insensitive → error explícito).
3. Extensión en la allowlist y coherente con el `content_type` declarado.
4. Límites: tamaño por archivo, total, número de archivos, profundidad.
5. El `entrypoint` existe en la lista de archivos y es HTML.
6. Formato de `sha256` (64 hex) y `size > 0` coherente.

Rechazar en `init` es la diferencia entre "error en 200 ms" y "error después de subir
200 MB". La UX de un error rápido es parte del producto.

### 9.5 Rate limiting

Token bucket en Redis (Lua atómico), por capas:

| Ámbito | Límite | Notas |
|---|---|---|
| IP → `/v1/auth/*` | 10/min | Anti fuerza bruta; sin degradación (falla cerrado) |
| Organización → API global | 600/min, burst 100 | Cabeceras `RateLimit-*` |
| Organización → publish | 100/día (plan) | Cuota, no rate limit |
| API key | Igual que org + límite propio opcional | Aislar un CI ruidoso |
| Bytes subidos | Cuota mensual por plan | Comprobada en `init` |
| Lectura (router/CDN) | Por IP en el borde | No consume recursos de la API |

Si Redis cae: los límites de autenticación **fallan cerrado** (seguridad), el resto
**falla abierto** con degradación registrada y alertada (disponibilidad).

---

## 10. Diseño de la CLI

### 10.1 Principios de UX

1. **Como git**: `drop <verbo> [objeto] [flags]`, verbos cortos, salida útil por
   defecto, `--help` con ejemplos reales.
2. **Un comando resuelve el caso al 90%**: `drop upload .`
3. **Nunca sorprender**: nada destructivo sin confirmación; `--yes` para
   automatización.
4. **Legible por humanos y por máquinas**: `--json` en todos los comandos, TTY
   detectado automáticamente (en CI: sin spinners, sin colores, una línea por evento).
5. **Rápida**: hashing y subida en paralelo; el trabajo local no espera a la red.
   Objetivo: `< 2 s` de extremo a extremo para un HTML de 50 KB.
6. **Errores accionables**: qué falló, por qué, y el comando exacto para arreglarlo.

### 10.2 Comandos

```
drop login                    Autenticar (device flow; --browser para loopback)
drop logout                   Revocar credenciales locales y del servidor
drop whoami                   Usuario, organización y alcance activos

drop upload [ruta]            Publicar un archivo o directorio (por defecto ".")
drop list                     Listar drops
drop info <slug>              Detalle de un drop y su release actual
drop open <slug>              Abrir en el navegador
drop delete <slug>            Borrar un drop

drop config get|set|list      Configuración local y perfiles
drop version                  Versión, commit, endpoint de API
drop completion <shell>       Autocompletado (bash|zsh|fish|powershell)
```

Flags globales: `--json`, `--quiet`, `--verbose`, `--no-color`, `--profile <p>`,
`--api <url>`, `--org <slug>`, `--timeout <d>`, `--yes`.

#### `drop upload`

```
drop upload [ruta]
  --name, -n <título>      Título del drop (por defecto: <title> del HTML o el nombre del dir)
  --entry <archivo>        Entrypoint explícito (por defecto: index.html o el único .html)
  --new                    Fuerza un drop nuevo aunque el directorio ya esté vinculado
  --update <slug>          Publica un nuevo release sobre un drop existente
  --project <slug>         Proyecto destino
  --visibility <v>         public | unlisted   (private en v1)
  --include <glob>         Añadir patrones (repetible)
  --exclude <glob>         Excluir patrones (repetible)
  --follow-refs            Modo archivo único: seguir referencias (por defecto: true)
  --dry-run                Muestra qué se subiría y no sube nada
  --open                   Abre el navegador al terminar
  --concurrency <n>        Subidas en paralelo (por defecto 8)
```

**Dos modos, deliberadamente distintos:**

- `drop upload docs/index.html` → **modo archivo**: el HTML y *solo* los recursos que
  se pueden demostrar referenciados (análisis estático transitivo). Predecible y
  mínimo.
- `drop upload .` → **modo directorio**: todo lo que sobreviva a la allowlist y a
  `.dropignore`. Sin sorpresas por análisis incompleto.

Si el modo archivo detecta indicios de carga dinámica (`fetch(`, `import(`,
`XMLHttpRequest`, plantillas de rutas) advierte:
`⚠ Se detectaron cargas dinámicas; considera 'drop upload .' para incluir todo`.

### 10.3 Escáner de dependencias (modo archivo)

Extracción **transitiva** y conservadora. Solo lo que se puede resolver estáticamente:

| Fuente | Se extrae de |
|---|---|
| HTML | `<link href>`, `<script src>`, `<img src|srcset>`, `<source src|srcset>`, `<video src|poster>`, `<audio src>`, `<embed src>`, `<object data>`, `<iframe src>` (solo local), `<use href>`, `<input type=image src>`, atributos `style="...url()..."` |
| CSS | `url(...)`, `@import`, `image-set()`, `src:` de `@font-face` — recursivo en los CSS importados |
| SVG | `<image href>`, `<use href>`, referencias a fuentes |
| JS | **No se parsea.** Un análisis de módulos ES es factible pero da falsa sensación de completitud (imports dinámicos, strings construidos). Se detecta y se avisa |

Reglas:
- Solo rutas **relativas** dentro del directorio raíz. Absolutas (`/x.css`) → error con
  sugerencia (romperían al servirse bajo el prefijo del slug). URLs externas
  (`https://cdn...`) → se dejan intactas y se listan como dependencias externas
  (`ℹ 3 recursos externos no se publican`).
- Cualquier intento de salir de la raíz (`../../etc/passwd`, symlinks apuntando fuera)
  → **error, no se sigue**. Path traversal se corta en el cliente y se vuelve a cortar
  en la API.
- `data:` URIs, anclas, `mailto:`, `#fragmentos` → ignorados.
- Los symlinks internos se resuelven al fichero real y se suben como archivo normal.

`.dropignore` (sintaxis `.gitignore`). Excluidos por defecto:
`.git/ .DS_Store node_modules/ .env* *.log .drop/ .idea/ .vscode/ __pycache__/
dist/*.map`(configurable)`, thumbs.db`.

### 10.4 Salida

**Interactivo (TTY)**

```
$ drop upload .

  Drop  ·  miempresa/default

  ✔ Detectando archivos           18 archivos · 2.4 MB
  ✔ Analizando dependencias       entrypoint: index.html
  ✔ Calculando hashes             18/18
  ✔ Subiendo                      6 archivos · 1.1 MB  (12 ya existían, 1.3 MB ahorrados)
  ✔ Publicando                    release #3

  https://drop.miempresa.com/aBc91K

  Listo en 1.8 s
```

**No interactivo (CI)**

```
drop: detectando archivos (18 archivos, 2.4 MB)
drop: analizando dependencias (entrypoint=index.html)
drop: subiendo 6/18 archivos (12 deduplicados)
drop: publicado release 3
drop: url=https://drop.miempresa.com/aBc91K
```

**`--json`** (una sola línea, estable, versionada):

```json
{"schema":"drop.upload/v1","drop":{"slug":"aBc91K","url":"https://drop.miempresa.com/aBc91K"},
 "release":{"id":"01J8ZKA1","seq":3,"files":18,"bytes":2517324,"uploaded":6,"deduplicated":12},
 "duration_ms":1804}
```

Esto es lo que consumirán la GitHub Action y las integraciones con agentes (Claude
Code, Cursor…): **la salida `--json` es API pública** y se versiona con `schema`.

### 10.5 Configuración y estado local

```
~/.config/drop/config.yaml        # perfiles (estilo kubectl context)
~/.config/drop/credentials.json   # 0600, solo si no hay keyring del SO
<proyecto>/.drop/config.json      # vínculo directorio → drop (para republicar)
```

```yaml
# ~/.config/drop/config.yaml
current_profile: work
profiles:
  work:
    api_url: https://api.drop.miempresa.com
    org: miempresa
    project: default
  personal:
    api_url: https://api.drop.dev
    org: rafa
defaults:
  concurrency: 8
  visibility: public
```

Precedencia: flags > variables de entorno (`DROP_*`) > `.drop/config.json` >
`config.yaml` > valores por defecto.

Credenciales: **OS keyring** primero (Keychain / Secret Service / Credential Manager),
fallback a fichero `0600`. En CI: `DROP_TOKEN` (API key) — nunca se escribe a disco y
nunca se imprime, ni con `--verbose` (redacción explícita en el logger).

### 10.6 Robustez de red

- Reintentos con backoff exponencial + jitter en 5xx, 429 (respeta `Retry-After`) y
  errores de red. Nunca en 4xx deterministas.
- Multipart para archivos > 8 MiB, en partes de 8 MiB, reanudable.
- `context.Context` con cancelación limpia por `SIGINT`: aborta el release y no deja
  basura.
- Un fallo de subida no aborta el resto: se reintenta y solo al final se reporta el
  conjunto de fallos.
- Comprobación de versión de la API y aviso si la CLI está desactualizada (sin
  bloquear).

### 10.7 Códigos de salida

| Código | Significado |
|---|---|
| 0 | Éxito |
| 1 | Error genérico |
| 2 | Uso incorrecto (flags/argumentos) |
| 3 | No autenticado / token expirado (`drop login`) |
| 4 | Sin permisos |
| 5 | Validación (archivo no permitido, límite excedido) |
| 6 | Cuota o rate limit excedido |
| 7 | Red / API no disponible |
| 8 | Conflicto (slug ocupado, release en curso) |
