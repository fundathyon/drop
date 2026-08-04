# Drop

Plataforma para publicar artefactos HTML estáticos. Dos servicios:

- [`api/`](api) — Go + Gin, GORM sobre SQLite, MinIO y Swagger. `go build`
  produce **un solo binario** que sirve la API JSON y los drops publicados.
- [`web/`](web) — Next.js (App Router) + Bun, el panel de administración.
  Server Components y Server Actions llaman a la API **desde el servidor de
  Next**, nunca desde el navegador: el navegador solo habla con `web`.

El admin dejó de renderizarse en Go — vivió ahí como páginas `html/template`
empotradas con `go:embed` hasta que se separó en `web/`. La API en sí no
cambió: sigue siendo la misma bajo `/v1`, con `Authorization: Bearer` como
único mecanismo de sesión.

El diseño completo del sistema vive en [`docs/design/`](docs/design/README.md).

## Modelo de datos

Estilo Drive, con la metadata y los bytes en sitios distintos:

- Una **carpeta** organiza otras carpetas y drops.
- Un **drop** es la unidad publicable: lleva metadata propia (título, slug,
  visibilidad) e historial.
- Una **versión** es una publicación del drop: sus archivos y su entrypoint.
  Subir otra vez el mismo drop no lo sobrescribe, abre la versión siguiente.

**SQLite** (vía GORM) es la fuente de verdad del árbol y las consultas.
**MinIO** guarda los bytes, indexados por slug y versión, junto a un archivo
**`.drop`** en YAML que se regenera con cada cambio — así el bundle almacenado
sigue siendo autodescriptivo y portable.

```
bucket drop-content/
└── drops/ZQpRw5PV/
    ├── v1/
    │   ├── .drop      metadata + listado de archivos de esta versión
    │   └── index.html
    └── v2/
        ├── .drop
        └── index.html
```

El `.drop` **se genera desde la base al leerlo**, y la copia en MinIO es un
espejo. Es a propósito: cuando el tamaño se calculaba aparte de los bytes, las
dos cosas se desincronizaban y el `Content-Length` dejaba la descarga a medias.

La base es SQLite *por ahora*; cambiar a Postgres es cambiar el driver en
[`internal/db`](api/internal/db/db.go), no los modelos.

## Versiones

Subir un drop con un título que ya existe publica una versión nueva en lugar de
fallar con un conflicto:

- La URL del drop (`/d/{slug}/`) sirve siempre la versión actual.
- Cada versión conserva su propia URL, `/d/{slug}/@2/`, que sigue sirviendo
  exactamente lo que se publicó entonces.
- Editar archivos desde el admin **no** abre una versión nueva: cambia la
  actual. Las versiones las corta la subida, no cada guardado.
- Restaurar una versión anterior solo mueve el puntero; no borra nada.
- Republicar **no** cambia la visibilidad salvo que se pida explícitamente: un
  drop privado no se abre al mundo por volver a subirlo.

Las páginas HTML servidas llevan un badge inyectado con el detalle del drop y su
historial (se desactiva con `DROP_INJECT_WIDGET=false`).

## Cómo ejecutarlo

Requisitos: Go, Bun, y un runtime de contenedores para MinIO (Docker, colima,
OrbStack…) — o solo Docker, si prefieres correr todo containerizado.

**La forma más simple, un solo comando:**

```bash
make up-all
```

Genera el par de claves si hace falta, y construye y levanta MinIO, la API y el
admin con `docker compose`. Todo queda arriba en un par de minutos:
`http://localhost:3000` es el panel, `http://localhost:8000` la API. `make
down-all` lo baja.

**Para desarrollar, con recarga en caliente**, en dos terminales:

```bash
make dev       # MinIO + la API desde el código, en :8000
make dev-web   # el admin desde el código, en :3000
```

La primera vez que abras `http://localhost:3000` te pedirá configurar la
organización, tu cuenta y la contraseña maestra — no hay contraseña por
defecto. Para un despliegue sin navegador (Docker, CI…), define `ADMIN_EMAIL` y
`ADMIN_PASSWORD` en `api/.env` y ese administrador se crea solo al arrancar.

Otros targets:

```bash
make help       # lista todos los targets
make seed       # llena el árbol con contenido de demo vía la API real
make up/down    # solo el stack de MinIO
make up-all/down-all  # todo containerizado (MinIO + API + web)
make test       # go test + go vet
make test-web   # typecheck + lint + test del frontend
make swagger    # regenera el OpenAPI desde las anotaciones
make build      # compila el binario de la API
make build-web  # build de producción del frontend
make run        # ejecuta el binario de la API ya compilado
make clean      # borra binarios, la DB local y los volúmenes de MinIO
```

| Servicio | URL |
|---|---|
| Panel de administración | http://localhost:3000 |
| API | http://localhost:8000/v1 |
| **Swagger UI** | **http://localhost:8000/docs** |
| Consola de MinIO | http://localhost:9001 (`dropadmin` / `dropadmin123`) |

## Unidades y compartición

Cada cuenta tiene **su propia unidad**. El árbol no es global: dos personas
pueden tener las dos una carpeta `Proyectos` y son carpetas distintas. Nadie ve
la unidad de nadie, **tampoco un administrador** — administrar cuentas no es lo
mismo que leer archivos ajenos.

Una carpeta o un drop se puede **compartir** con otra cuenta, en dos niveles:

| Nivel | Puede |
|---|---|
| **lector** | abrir y descargar |
| **editor** | además subir, editar y borrar dentro |

- El permiso se aplica a **todo lo que cuelga** de lo compartido, así que
  compartir una carpeta comparte los drops que contiene.
- Comparten el dueño **y los editores**, para que un equipo no dependa de una
  sola persona. Un editor solo puede revocar lo que él mismo concedió.
- Un editor **no puede borrar la raíz compartida**: es lo único que podría
  hacer sin querer y el dueño no podría deshacer.
- Lo que te comparten aparece en **Compartido conmigo**, con su dueño y tu
  nivel de acceso.

Como una ruta ya no identifica un nodo por sí sola, las URLs del panel y de la
API llevan `owner=<id>` cuando apuntan a la unidad de otra persona. Sin ese
parámetro, la ruta es la tuya.

La **visibilidad** decide quién puede abrir `/d/{slug}/`, que no es lo mismo que
quién puede administrarlo desde el panel:

| Visibilidad | Abre su URL |
|---|---|
| `public` | cualquiera, y además se puede listar |
| `unlisted` | cualquiera que tenga el enlace |
| `private` | su dueño y las cuentas con las que esté compartido; para el resto responde 404 |

Un drop público lo sigue siendo para el mundo se comparta o no: compartir es lo
que reparte el panel. `private` es la única visibilidad donde las dos cosas se
tocan — sin eso, un drop privado sería una dirección que no responde a nadie,
ni siquiera a quien lo subió.

Como un drop privado contesta distinto según quién pregunte, sus respuestas
salen con `Cache-Control: private, no-store` y todo `/d/` lleva `Vary: Cookie`.

> El panel llama a la API **desde el servidor de Next**, con el bearer token —
> nunca desde el navegador. Por eso abrir la URL pública de un drop *privado*
> directamente (fuera del panel) solo funciona para quien tenga sesión con la
> propia API; es una limitación conocida de tener el admin en otro origen, no
> un agujero de seguridad (un drop privado sigue respondiendo 404 a cualquier
> otra persona). `public` y `unlisted` no se ven afectados: no comprueban
> sesión en absoluto.

## Autenticación

Todo pide un token menos lo que tiene que ser público: `/healthz`, los drops
publicados en `/d/`, el estado y el envío de `/v1/setup`, y la vista previa y
aceptación de una invitación. En `/d/` la sesión se resuelve pero no se exige:
sirve a cualquiera si el drop es público, y solo a quien corresponda si es
privado.

- **La API** (y por tanto el panel, que la llama desde su propio servidor) usa
  `Authorization: Bearer <token>`, firmado con **RS256**. Nunca hay secretos
  compartidos: la clave que firma no es la que verifica. Genera el par con
  `make keys`; sin él el proceso no arranca, en vez de degradarse en silencio a
  algo más débil. En una plataforma sin filesystem donde escribir (solo
  variables de entorno), pon el PEM directamente en `PRIVATE_KEY_JWT` /
  `PUBLIC_KEY_JWT` en vez de `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`; si
  el campo no admite saltos de línea reales, escríbelos como `\n` literal.
- El panel guarda el refresh token en **su propia** cookie `HttpOnly`, en su
  propio origen — no en el de la API. Un access token se pide de nuevo cuando
  hace falta; el navegador nunca ve ninguno de los dos.
- **No hay registro abierto.** Las cuentas nacen del administrador inicial o de
  una invitación de un solo uso, con caducidad. No se envía ningún correo: el
  enlace se muestra una vez y lo repartes tú. Solo se guarda su hash, así que un
  enlace perdido se reemite, nunca se recupera.
- Las contraseñas se guardan con **Argon2id**, y entrar o refrescar están
  limitados por intentos.

La primera vez que se arranca sin ninguna cuenta, todo excepto
`/v1/setup*` (y el healthcheck) responde `503 setup_required`: es el único
momento en que una instancia vacía deja hacer algo. El asistente de primer
arranque (en el panel) crea la organización y el administrador a la vez, y te
deja ya identificado. Con `ADMIN_EMAIL` **y** `ADMIN_PASSWORD` puestos, ese
paso se salta y el administrador se crea solo al arrancar en su lugar —
pensado para Docker o CI, no para abrir en un navegador. Si ya existe un
administrador, ninguna de las dos vías lo toca — ni su contraseña.

## Endpoints

Todo lo que sirve la API vive bajo `/v1` (JSON) o `/d` (drops publicados); el
panel en `web/` es quien traduce esto a pantallas.

```
GET    /healthz
GET    /d/{slug}/                   abrir un drop publicado (su entrypoint)
GET    /d/{slug}/{ruta}             un archivo concreto del drop
GET    /d/{slug}/@{n}/{ruta}        lo mismo, anclado a la versión n

POST   /v1/auth/login               credenciales -> tokens   {email, password}
POST   /v1/auth/refresh             renovar el access token  {refresh_token}
POST   /v1/auth/logout              revocar la sesión        {refresh_token}
GET    /v1/auth/me                  quién eres

GET    /v1/setup/status             ¿hace falta configurar la instancia?      (público)
POST   /v1/setup                    crear organización + admin, y entrar      (público) {org_name, name?, email, password, password_confirm}
GET    /v1/invitations/by-token?token=   vista previa de una invitación       (público)
POST   /v1/invitations/accept       aceptar invitación (no abre sesión)       (público) {token, name?, password, password_confirm}

GET    /v1/nodes?path=              listar hijos de una carpeta de tu unidad
POST   /v1/nodes                    crear carpeta          {parent, name}
DELETE /v1/nodes?path=              borrar carpeta o drop (recursivo)
GET    /v1/drops?path=              metadata + archivos + historial de un drop
POST   /v1/drops                    crear drop             {parent, name, title, visibility, entrypoint}
POST   /v1/drops/upload             publicar un drop; si ya existe, nueva versión
PATCH  /v1/drops?path=              editar metadata        {title?, visibility?, entrypoint?}
GET    /v1/drops/versions?path=     historial de versiones
POST   /v1/drops/versions/activate?path=   volver a publicar una versión  {seq}
GET    /v1/files?path=              descargar/ver un archivo
POST   /v1/files?path=              subir archivo(s) (multipart, campo "file")
DELETE /v1/files?path=              borrar un archivo

GET    /v1/shares?path=             quién tiene acceso a un nodo, y a quién más se le podría dar
POST   /v1/shares?path=             compartir  {user_id, access}   — access: viewer | editor
DELETE /v1/shares?path=&user_id=    revocar acceso
GET    /v1/shared                   lo que otros han compartido contigo

GET    /v1/users                    listar cuentas                 (solo admin)
PATCH  /v1/users/{id}/active        activar o desactivar           (solo admin)
DELETE /v1/users/{id}               borrar una cuenta              (solo admin)
GET    /v1/invitations              listar invitaciones            (solo admin)
POST   /v1/invitations              invitar {email, role}          (solo admin)
DELETE /v1/invitations/{id}         revocar una invitación         (solo admin)
```

Para usar la API desde un script, pide un token y mándalo en cada petición
(sustituye por el email y la contraseña de tu propio administrador):

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@tu-dominio.com","password":"tu-contraseña"}' | jq -r .access_token)

curl -X POST http://localhost:8000/v1/drops/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F 'title=Mi documento' -F 'file=@index.html'
```

La documentación viva, con los esquemas y el "try it out", está en
[`/docs`](http://localhost:8000/docs); el spec se genera desde las anotaciones
de los handlers con [swaggo](https://github.com/swaggo/swag).

Los errores devuelven `{ "code": "...", "message": "..." }`; `code` es el
contrato estable para clientes (por ejemplo `is_drop`, que distingue un drop de
una carpeta).

## Configuración

La API lee [`api/.env`](api/.env); el frontend lee [`web/.env.local`](web/.env.example).

| Variable | Por defecto | Descripción |
|---|---|---|
| `DROP_HTTP_ADDR` | `:8000` | Dirección de escucha |
| `DROP_DATABASE_DSN` | `drop.db` | Base SQLite |
| `DROP_PUBLIC_BASE_URL` | `http://localhost:8000` | Origen desde el que se sirven los drops; es la URL que devuelve la API |
| `DROP_CORS_ORIGINS` | *(vacío)* | Orígenes permitidos, separados por coma — el del frontend (`http://localhost:3000` en desarrollo), para cuando un navegador llame a la API directamente en vez de a través del servidor de Next |
| `DROP_S3_ENDPOINT` | `localhost:9000` | Endpoint de MinIO |
| `DROP_S3_ACCESS_KEY` / `DROP_S3_SECRET_KEY` | `dropadmin` / `dropadmin123` | Credenciales |
| `DROP_S3_BUCKET` | `drop-content` | Bucket de contenido |
| `DROP_S3_USE_SSL` | `false` | TLS hacia el object store |
| `DROP_INJECT_WIDGET` | `true` | Inyecta el badge de Drop en las páginas HTML publicadas |
| `JWT_PRIVATE_KEY_PATH` | `./certs/private.pem` | Clave RSA que firma los tokens (`make keys`) |
| `JWT_PUBLIC_KEY_PATH` | `./certs/public.pem` | Clave pública que los verifica |
| `PRIVATE_KEY_JWT` / `PUBLIC_KEY_JWT` | *(vacío)* | El mismo par, pero como PEM en la propia variable en vez de una ruta. Si se ponen **las dos**, tienen prioridad sobre `JWT_*_KEY_PATH` |
| `JWT_ISSUER` | `drop` | Emisor que llevan los tokens |
| `ACCESS_TOKEN_TTL` | `15m` | Caducidad del access token |
| `REFRESH_TOKEN_TTL` | `720h` | Caducidad del refresh token y de la sesión del panel |
| `INVITATION_TTL` | `72h` | Cuánto sirve un enlace de invitación |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(vacío)* | Si se ponen **las dos**, crean el administrador al arrancar sin pasar por el asistente. Deja ambas vacías para el asistente interactivo |

Ninguna caducidad está fijada en el código: todas salen de aquí, así que la
ventana de un token robado se cambia sin recompilar.

`web/.env.local` (o `web/.env.example` como plantilla) solo necesita
`DROP_API_URL`, el origen de la API tal como lo alcanza **el servidor** de
Next — `http://localhost:8000` en desarrollo, `http://api:8000` dentro de
`docker compose --profile full`.
