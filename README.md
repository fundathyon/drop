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

Levanta MinIO con docker compose y ejecuta el servidor desde el código en
`:8000`. Para compilar el binario y ejecutarlo:

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

> El admin no tiene autenticación todavía, y comparte puerto con los drops
> publicados. Sirve para desarrollo y para una red de confianza; no lo expongas
> a internet tal cual.

## Endpoints

```
GET    /                            panel de administración
GET    /admin/edit?path=&name=      editor de un archivo del drop
POST   /admin/…                     acciones del panel (formularios; redirigen)
GET    /healthz
GET    /d/{slug}/                   abrir un drop publicado (su entrypoint)
GET    /d/{slug}/{ruta}             un archivo concreto del drop
GET    /d/{slug}/@{n}/{ruta}        lo mismo, anclado a la versión n
POST   /v1/drops/upload             publicar un drop; si ya existe, nueva versión
GET    /v1/nodes?path=              listar hijos de una carpeta
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
