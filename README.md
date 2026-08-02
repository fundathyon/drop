# Drop

Plataforma para publicar artefactos HTML estáticos. Todo vive en
[`api/`](api) y `go build` produce **un solo binario** que sirve el admin, la
API y los drops publicados: Go + Gin, GORM sobre SQLite, MinIO y Swagger.

El admin se renderiza en el servidor con `html/template`, y sus plantillas y
CSS se empotran con `go:embed` desde el propio código fuente. No hay paso de
build de frontend, ni Node, ni bundle: compilar el proyecto es compilar Go.

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

Requisitos: Go y un runtime de contenedores para MinIO (Docker, colima,
OrbStack…).

```bash
make dev
```

Levanta MinIO con docker compose, genera el par RSA que firma los tokens si no
existe, y ejecuta el servidor desde el código en `:8000`. La primera vez que
abras `http://localhost:8000` te pedirá configurar la organización, tu cuenta
y la contraseña maestra — no hay contraseña por defecto. Para un despliegue
sin navegador (Docker, CI…), define `ADMIN_EMAIL` y `ADMIN_PASSWORD` y ese
administrador se crea solo al arrancar.

Para compilar el binario y ejecutarlo:

```bash
make build && make run
```

Todo queda en `:8000`: el admin en `/`, la API en `/v1`, los drops en `/d` y la
documentación en `/docs`. Otros targets:

```bash
make help      # lista todos los targets
make seed      # llena el árbol con contenido de demo vía la API real
make up/down   # solo el stack de MinIO
make test      # go test + go vet
make swagger   # regenera el OpenAPI desde las anotaciones
make build     # compila el binario único (admin + API + drops)
make run       # ejecuta el binario compilado
make clean     # borra binarios, la DB local y los volúmenes de MinIO
```

| Servicio | URL |
|---|---|
| Panel de administración | http://localhost:8000 |
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

## Autenticación

Todo pide credenciales menos lo que tiene que ser público: `/healthz`, los
drops publicados en `/d/`, el formulario de entrada y los enlaces de invitación.
En `/d/` la sesión se resuelve pero no se exige: sirve a cualquiera si el drop
es público, y solo a quien corresponda si es privado.

- **El admin** usa una cookie `HttpOnly` de sesión. Se renderiza en el servidor,
  así que nada en la página necesita leer el token — y una vulnerabilidad de XSS
  tampoco puede.
- **La API** usa `Authorization: Bearer <token>`, firmado con **RS256**. Nunca
  hay secretos compartidos: la clave que firma no es la que verifica. Genera el
  par con `make keys`; sin él el proceso no arranca, en vez de degradarse en
  silencio a algo más débil. En una plataforma sin filesystem donde escribir
  (solo variables de entorno), pon el PEM directamente en `PRIVATE_KEY_JWT` /
  `PUBLIC_KEY_JWT` en vez de `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`;
  si el campo no admite saltos de línea reales, escríbelos como `\n` literal.
- **No hay registro abierto.** Las cuentas nacen del administrador inicial o de
  una invitación de un solo uso, con caducidad. No se envía ningún correo: el
  enlace se muestra una vez y lo repartes tú. Solo se guarda su hash, así que un
  enlace perdido se reemite, nunca se recupera.
- Las contraseñas se guardan con **Argon2id**, y entrar o refrescar están
  limitados por intentos.

La primera vez que se arranca sin ninguna cuenta, todo excepto `/setup` (y el
healthcheck) redirige ahí: es el único momento en que una instancia vacía deja
hacer algo. Ese formulario crea la organización y el administrador a la vez, y
te deja ya identificado. Con `ADMIN_EMAIL` **y** `ADMIN_PASSWORD` puestos, ese
paso se salta y el administrador se crea solo al arrancar en su lugar — pensado
para Docker o CI, no para abrir en un navegador. Si ya existe un administrador,
ninguna de las dos vías lo toca — ni su contraseña.

> Pon `AUTH_COOKIE_SECURE=true` en cuanto esto no sea `localhost`, o el
> navegador enviará la cookie de sesión por HTTP en claro.

## Endpoints

```
GET    /                            panel de administración (tu unidad)
GET    /?owner=<id>&path=           una carpeta o drop de otra unidad
GET    /compartido                  lo que otros han compartido contigo
GET    /setup                       asistente de primer arranque (público; solo hasta que exista un admin)
GET    /login                       entrar (público)
GET    /invitacion?token=           aceptar una invitación (público)
GET    /admin/edit?path=&name=      editor de un archivo del drop
GET    /admin/usuarios              cuentas e invitaciones (solo admin)
POST   /admin/share                compartir  {owner, path, user_id, access}
POST   /admin/unshare               revocar    {owner, path, user_id}
POST   /admin/…                     acciones del panel (formularios; redirigen)
GET    /healthz
GET    /d/{slug}/                   abrir un drop publicado (su entrypoint)
GET    /d/{slug}/{ruta}             un archivo concreto del drop
GET    /d/{slug}/@{n}/{ruta}        lo mismo, anclado a la versión n
POST   /v1/drops/upload             publicar un drop; si ya existe, nueva versión
GET    /v1/nodes?path=              listar hijos de una carpeta de tu unidad
POST   /v1/nodes                    crear carpeta          {parent, name}
DELETE /v1/nodes?path=              borrar carpeta o drop (recursivo)
GET    /v1/drops?path=              metadata + archivos + historial de un drop
POST   /v1/drops                    crear drop             {parent, name, title, visibility, entrypoint}
PATCH  /v1/drops?path=              editar metadata        {title?, visibility?, entrypoint?}
GET    /v1/drops/versions?path=     historial de versiones
POST   /v1/drops/versions/activate?path=   volver a publicar una versión  {seq}
GET    /v1/files?path=              descargar/ver un archivo
POST   /v1/files?path=              subir archivo(s) (multipart, campo "file")
DELETE /v1/files?path=              borrar un archivo

POST   /v1/auth/login               credenciales -> tokens   {email, password}
POST   /v1/auth/refresh             renovar el access token  {refresh_token}
POST   /v1/auth/logout              revocar la sesión        {refresh_token}
GET    /v1/auth/me                  quién eres
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

Las rutas bajo `/admin` son formularios HTML: reciben `application/x-www-form-urlencoded`
(o `multipart/form-data` al subir) y responden `303 See Other` hacia el
explorador, con el resultado en una cookie de un solo uso. Son la interfaz del
panel, no una API; para automatizar, usa `/v1`.

## Configuración

La API lee [`api/.env`](api/.env).

| Variable | Por defecto | Descripción |
|---|---|---|
| `DROP_HTTP_ADDR` | `:8000` | Dirección de escucha |
| `DROP_DATABASE_DSN` | `drop.db` | Base SQLite |
| `DROP_PUBLIC_BASE_URL` | `http://localhost:8000` | Origen desde el que se sirven los drops; es la URL que devuelve la API |
| `DROP_CORS_ORIGINS` | *(vacío)* | Orígenes permitidos, separados por coma. El admin es del mismo origen, así que solo hace falta para clientes externos |
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
| `REFRESH_TOKEN_TTL` | `720h` | Caducidad del refresh token y de la sesión del navegador |
| `INVITATION_TTL` | `72h` | Cuánto sirve un enlace de invitación |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(vacío)* | Si se ponen **las dos**, crean el administrador al arrancar sin pasar por `/setup`. Deja ambas vacías para el asistente interactivo |
| `AUTH_COOKIE_SECURE` | `false` | Marca la cookie de sesión como `Secure`; ponlo en `true` fuera de localhost |

Ninguna caducidad está fijada en el código: todas salen de aquí, así que la
ventana de un token robado se cambia sin recompilar.
