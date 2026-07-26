# Drop

Plataforma para publicar artefactos HTML estáticos. Este repo contiene dos
aplicaciones independientes:

| Carpeta | Qué es | Stack |
|---|---|---|
| [`api/`](api) | API JSON del admin | Go + Gin, GORM sobre SQLite, MinIO, Swagger |
| [`web/`](web) | Panel de administración | Astro 7 + islas React 19, Tailwind 4, shadcn/ui, bun |

El diseño completo del sistema vive en [`docs/design/`](docs/design/README.md).

## Modelo de datos

Estilo Drive, con la metadata y los bytes en sitios distintos:

- Una **carpeta** organiza otras carpetas y drops.
- Un **drop** es la unidad publicable: lleva metadata propia (título, slug,
  entrypoint, visibilidad) y contiene archivos.

**SQLite** (vía GORM) es la fuente de verdad del árbol y las consultas.
**MinIO** guarda los bytes, indexados por el slug del drop, junto a un archivo
**`.drop`** en YAML que se regenera con cada cambio de metadata — así el bundle
almacenado sigue siendo autodescriptivo y portable.

```
bucket drop-content/
└── drops/ZQpRw5PV/
    ├── .drop          title, slug, entrypoint, visibility, timestamps
    └── index.html
```

La base es SQLite *por ahora*; cambiar a Postgres es cambiar el driver en
[`internal/db`](api/internal/db/db.go), no los modelos.

## Cómo ejecutarlo

Requisitos: Go, [bun](https://bun.com), y un runtime de contenedores para MinIO
(Docker, colima, OrbStack…).

```bash
make dev
```

Levanta MinIO con docker compose y luego la API en `:8000` y el frontend en
`:3000`. Otros targets:

```bash
make help      # lista todos los targets
make install   # dependencias del frontend (bun install)
make seed      # llena el árbol con contenido de demo vía la API real
make up/down   # solo el stack de MinIO
make test      # go test + go vet + astro check
make swagger   # regenera el OpenAPI desde las anotaciones
make build     # compila ambas apps
make clean     # borra binarios, la DB local y los volúmenes de MinIO
```

| Servicio | URL |
|---|---|
| Panel de administración | http://localhost:3000 |
| API | http://localhost:8000 |
| **Swagger UI** | **http://localhost:8000/docs** |
| Consola de MinIO | http://localhost:9001 (`dropadmin` / `dropadmin123`) |

## Endpoints

```
GET    /healthz
GET    /d/{slug}/            abrir un drop publicado (su entrypoint)
GET    /d/{slug}/{ruta}      un archivo concreto del drop
POST   /v1/drops/upload      crear un drop con sus archivos (multipart)
GET    /v1/nodes?path=       listar hijos de una carpeta
POST   /v1/nodes             crear carpeta          {parent, name}
DELETE /v1/nodes?path=       borrar carpeta o drop (recursivo)
GET    /v1/drops?path=       metadata + archivos de un drop
POST   /v1/drops             crear drop             {parent, name, title, visibility, entrypoint}
PATCH  /v1/drops?path=       editar metadata        {title?, visibility?, entrypoint?}
GET    /v1/files?path=       descargar/ver un archivo
POST   /v1/files?path=       subir archivo(s) (multipart, campo "file")
DELETE /v1/files?path=       borrar un archivo
```

La documentación viva, con los esquemas y el "try it out", está en
[`/docs`](http://localhost:8000/docs); el spec se genera desde las anotaciones
de los handlers con [swaggo](https://github.com/swaggo/swag).

Los errores devuelven `{ "code": "...", "message": "..." }`; `code` es el
contrato estable para clientes (por ejemplo `is_drop`, que el frontend usa para
saber que un path es un drop y no una carpeta).

## Configuración

Cada app lee su propio `.env` ([`api/.env`](api/.env), [`web/.env`](web/.env)).

### API

| Variable | Por defecto | Descripción |
|---|---|---|
| `DROP_HTTP_ADDR` | `:8000` | Dirección de escucha |
| `DROP_DATABASE_DSN` | `drop.db` | Base SQLite |
| `DROP_PUBLIC_BASE_URL` | `http://localhost:8000` | Origen desde el que se sirven los drops; es la URL que devuelve la API |
| `DROP_CORS_ORIGINS` | `http://localhost:3000` | Orígenes permitidos, separados por coma |
| `DROP_S3_ENDPOINT` | `localhost:9000` | Endpoint de MinIO |
| `DROP_S3_ACCESS_KEY` / `DROP_S3_SECRET_KEY` | `dropadmin` / `dropadmin123` | Credenciales |
| `DROP_S3_BUCKET` | `drop-content` | Bucket de contenido |
| `DROP_S3_USE_SSL` | `false` | TLS hacia el object store |

### Frontend

| Variable | Por defecto | Descripción |
|---|---|---|
| `PUBLIC_DROP_API_URL` | `http://localhost:8000` | Origen de la API que usa el navegador |
| `DROP_API_TARGET` | `http://localhost:8000` | Destino del proxy si `PUBLIC_DROP_API_URL` se deja vacío |

Hay dos formas de conectar el frontend con la API, ambas por `.env`:
con `PUBLIC_DROP_API_URL` puesto el navegador llama directo a la API (y el
origen debe estar en `DROP_CORS_ORIGINS`); dejándolo vacío las peticiones
quedan en el mismo origen y el dev server hace de proxy, sin CORS de por medio.
