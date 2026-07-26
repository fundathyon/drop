# 04 — Decisiones arquitectónicas y riesgos

## 12. ADRs (decisiones y trade-offs)

Formato corto: contexto → decisión → alternativas descartadas → coste que aceptamos.
Cada ADR se extraerá a `docs/adr/NNN-*.md` al aprobar el diseño.

---

### ADR-001 — Router HTTP: **Chi**, no Fiber

**Decisión: `go-chi/chi`.**

| Criterio | Chi | Fiber |
|---|---|---|
| Base | `net/http` de la stdlib | `fasthttp` (API propia, incompatible) |
| Ecosistema | Cualquier middleware `func(http.Handler) http.Handler`: OTel, `httptest`, `pprof`, `oapi-codegen`, `golang.org/x/net` | Necesita adaptadores específicos de Fiber |
| Contexto | `*http.Request` con `context.Context` nativo | `*fiber.Ctx`, ciclo de vida propio (reutiliza el ctx: bugs sutiles si escapa a una goroutine) |
| HTTP/2, HTTP/3, TLS | Nativo | fasthttp no soporta HTTP/2 |
| Rendimiento | ~40–60k req/s por instancia | 2–4× más en microbenchmarks |
| Test | `httptest` estándar | Requiere su propio harness |

**Por qué el rendimiento no decide aquí.** El invariante del sistema es que la API
**no transporta bytes de contenido**: maneja JSON de pocos KB, y su latencia está
dominada por Postgres, S3 y argon2 — no por el parseo HTTP. La ventaja de fasthttp
sería invisible, mientras que su incompatibilidad con `net/http` se pagaría en cada
integración (OpenAPI, tracing, middlewares de terceros, tests). Elegir Fiber sería
optimizar la dimensión que no es el cuello de botella y pagar en la que sí importa:
mantenibilidad a 3 años.

**Coste aceptado**: techo de throughput por instancia más bajo. Mitigación: escalado
horizontal (la API es stateless). Si alguna vez un endpoint concreto necesitase
throughput extremo, se extrae — no se reescribe todo el servidor.

---

### ADR-002 — Acceso a datos: **sqlc**, no GORM

**Decisión: `sqlc` + `pgx/v5` + `goose` para migraciones.**

Razones, en orden de peso:

1. **El esquema es el diseño.** Este sistema depende de particionado declarativo,
   índices parciales, `citext`, `jsonb`, `SKIP LOCKED`, PKs compuestas y `bytea`.
   GORM lucha contra todo eso; con SQL escrito a mano es lo natural.
2. **Sin reflexión ni sorpresas en runtime.** sqlc genera structs y métodos tipados en
   tiempo de compilación desde el SQL real: un cambio de columna rompe el build, no
   producción.
3. **Consultas visibles y auditables.** El N+1 no se puede "acumular por accidente"
   cuando cada query está escrita en un `.sql` revisable. En el camino crítico
   (`init` con 2 000 hashes) importa poder escribir `WHERE sha256 = ANY($1)` y saber
   exactamente qué se ejecuta.
4. **Encaja con Clean Architecture.** El repositorio implementa un puerto del dominio
   traduciendo entidades ↔ structs generados. Con GORM, las etiquetas de ORM tienden a
   colonizar el dominio.
5. **Rendimiento**: sin reflexión y con `pgx` nativo (protocolo binario, prepared
   statements, `CopyFrom` para insertar miles de `release_files`).

**Coste aceptado**: más código boilerplate de mapeo y hay que escribir SQL a mano
(incluido el CRUD aburrido). Es un coste real y lo asumimos: en un sistema cuyo valor
está en la corrección de las transacciones, el SQL explícito es una ventaja, no una
carga. `CopyFrom` de pgx y generadores de tests mitigan el boilerplate.

**Descartado también**: `ent` (buen codegen pero impone su propio modelado de esquema)
y `sqlx` (menos garantías que sqlc por el mismo esfuerzo).

---

### ADR-003 — Almacenamiento: **CAS + copia server-side al prefijo del release**

**Decisión**: los blobs viven en `blobs/{org}/{aa}/{bb}/{sha}` (CAS, dedup) y en
`finalize` se hace `CopyObject` a `s/{release_id}/{path}`.

**Alternativa descartada — resolución de manifest en el borde**: guardar solo el CAS y
que una función de edge traduzca `(slug, path) → sha256` consultando un manifest en KV.
Da dedup perfecto de almacenamiento y publicación instantánea (no hay que copiar nada).
Se descarta para el MVP porque:
- Requiere compute en el borde para **cada request de asset**, no solo para el HTML.
- Obliga a mantener manifests completos en KV (límites de tamaño de valor, cientos de
  entradas por drop).
- No funciona con MinIO/S3 puro → rompe el self-hosting y el `docker-compose` de dev.
- El `Content-Type` habría que inyectarlo en la respuesta desde el manifest, no desde
  el objeto.

**Coste aceptado**: el almacenamiento se duplica (CAS + copia) y `finalize` tarda
~10 ms × nº de archivos (paralelizado: ~150 ms para 100 archivos). El requisito real
del dedup era **no re-subir** (ancho de banda y tiempo del usuario), y eso se cumple
al 100%. El almacenamiento es la parte barata (~$0,015/GB/mes en R2).

**Optimización futura documentada**: eliminar el nivel CAS y apuntar `blobs.storage_key`
al primer `s/{release_id}/{path}` que contenga ese hash. Ahorra 1× de almacenamiento a
cambio de un GC bastante más complejo (re-hospedar blobs al borrar el release que los
aloja). Solo si el coste de almacenamiento llega a ser material.

---

### ADR-004 — **Indirección `slug → release` en el borde** (no rutas directas por slug)

**Decisión**: la URL pública `/{slug}/{path}` se reescribe en el borde a
`s/{release_id}/{path}`.

La alternativa obvia y más simple sería escribir los objetos directamente en
`sites/{slug}/{path}`: cero indirección, cero router, cero KV. Se descarta porque esa
simplicidad **cobra intereses en todo el roadmap**:

| Funcionalidad futura | Con indirección | Sin indirección |
|---|---|---|
| Publicación atómica | Cambiar 1 puntero | Copiar N objetos sobre los vivos: hay una ventana con el sitio mezclado |
| Versionado / rollback | Cambiar el puntero | Rediseño completo |
| Invalidación de CDN | Innecesaria (path nuevo) | Purga por objeto en cada publish |
| Contraseña / expiración | Un `if` en el router | Sin punto de aplicación |
| Dominios personalizados | `Host` → drop en el router | Reescritura del layout |
| Analytics | Ya hay un hop | Solo logs del CDN |

Es una pieza pequeña (un rewrite sin estado) que actúa como **punto de extensión de
todo el plano de datos**. Añadirla al final sería un rediseño; añadirla ahora cuesta
unas 200 líneas.

**Coste aceptado**: un componente más que desplegar y un lookup en la ruta de lectura
(cacheado en el borde, p99 < 2 ms, hit ratio > 95%).

---

### ADR-005 — **El contenido se sirve en un dominio distinto al de la aplicación**

**Decisión**: `drop.miempresa.com` sirve **solo** contenido de usuario;
`app.miempresa.com` y `api.miempresa.com` son otros orígenes. Ninguna cookie de sesión
se emite jamás en el dominio de contenido.

Motivo: publicamos HTML+JS arbitrario que se **ejecuta**. Si compartiera origen con el
dashboard, cualquier drop podría leer cookies, `localStorage` y hacer peticiones
autenticadas a la API en nombre del usuario. Esto no es un riesgo teórico: es el modo
de fallo de todos los servicios de hosting de contenido de usuario, y por eso GitHub
usa `githubusercontent.com`, Google `googleusercontent.com`, etc.

**Limitación conocida y aceptada en el MVP**: como la URL es `drop.../{slug}`, todos
los drops **comparten origen entre sí**. Un drop malicioso podría leer el
`localStorage` que otro drop haya escrito. Aceptable en el MVP (el contenido es
documentación, no aplicaciones con secretos) y documentado como riesgo R-02.
Endurecimiento previsto en v1: origen único por drop
(`aBc91K.dropusercontent.com`), sirviendo la forma `/{slug}` como redirección
canónica, más `Content-Security-Policy: sandbox` opcional por drop.

---

### ADR-006 — **Subidas prefirmadas directas al storage** (la API nunca hace proxy)

Presigned PUT con `x-amz-checksum-sha256` y `content-length-range` **firmados**.

- La API no gasta ancho de banda, CPU ni memoria por MB subido: su capacidad no depende
  del tamaño del contenido.
- La **integridad la impone el storage**: si los bytes no coinciden con el hash
  declarado, S3 devuelve 400. Sin esto, un cliente podría envenenar el CAS
  (escribir contenido arbitrario bajo el hash de otro archivo y afectar a releases
  futuros que "deduplican" contra él). Es la mitigación crítica del diseño de CAS.
- El límite de tamaño también lo impone el storage, no la buena fe del cliente.

**Coste aceptado**: URLs prefirmadas con TTL (necesita refresco en subidas muy largas)
y una superficie de escritura al bucket concedida temporalmente al cliente — acotada a
una clave exacta, un tamaño exacto y un checksum exacto.

---

### ADR-007 — Claves primarias: **UUIDv7**

Ordenables temporalmente (localidad en índices B-tree, sin el *page splitting*
aleatorio de UUIDv4), generables en el cliente (la API conoce el ID antes de la
escritura → idempotencia, logs correlacionados, sin `RETURNING` en el camino crítico) y
no revelan volumen ni permiten enumeración (a diferencia de `bigserial`).

**Coste**: 16 bytes vs 8 de `bigint`. A 6 × 10⁸ filas en `release_files` son ~5 GB
extra de índices. Se acepta: es barato comparado con perder la generación en cliente y
la privacidad de IDs. El `slug` público es independiente del PK, por lo que el ID
interno nunca se filtra.

---

### ADR-008 — **Monorepo, un solo módulo Go**

Un `go.mod`, varios `cmd/`. API, CLI, router y worker comparten dominio, DTOs y cliente
generado; un cambio de contrato es un único commit atómico verificable por el
compilador. Módulos separados (o repos) obligarían a versionar y publicar el dominio
para consumirlo desde la CLI — pura fricción a esta escala de equipo.

**Coste**: la CLI arrastra el árbol de dependencias del repo en tiempo de compilación
(no en el binario: el linker de Go elimina lo no usado). Se vigila con un test que
falla si el binario de la CLI importa `internal/adapter/postgres`.

---

### ADR-009 — **JWT EdDSA de vida corta + refresh opaco rotatorio**

Verificación sin acceso a base de datos (la API escala sin estado de sesión), TTL de
15 min (la revocación es implícita, sin lista global), refresh opaco en Postgres con
rotación y detección de reuso por familia (mitiga robo de credenciales del disco).
Ed25519 sobre RSA: firmas de 64 bytes y verificación ~5× más rápida.

**Coste**: una ventana de hasta 15 min en la que un access token robado sigue siendo
válido. Mitigación: denylist de `jti` en Redis para incidentes concretos.

---

### ADR-010 — **Redis para rate limiting y route cache**, Postgres para todo lo demás

No se usa Redis como fuente de verdad de nada. Es caché y contadores: pérdida total de
Redis = degradación (más carga en PG, límites de auth fallando cerrado), no pérdida de
datos. En dev, `docker-compose` lo incluye; en producción cloud, el route cache pasa a
ser el KV del edge.

**Coste**: una dependencia más de infraestructura. Alternativa evaluada
(Postgres-only con `pg_advisory_lock` para límites): funciona, pero convierte cada
request en escritura en la BD y ensucia el camino crítico.

---

### ADR-011 — **`finalize` síncrono con contrato asíncrono**

Bajo umbral (≤ 200 archivos, ≤ 100 MiB) el ensamblado ocurre en línea: la UX ideal es
"un comando, una URL, sin polling". Por encima, se encola. **La CLI implementa el
polling desde el primer día**, así que mover el 100% del trabajo al worker es una
decisión de operación, no un cambio de contrato.

**Coste**: dos rutas de código en el mismo caso de uso. Se mitiga con un único
`ReleaseAssembler` invocado por ambas (en línea o desde el worker); la diferencia son
tres líneas en el handler.

---

### ADR-012 — **Dedup con alcance de organización**, no global

El dedup global maximizaría el ahorro, pero crea un **canal lateral entre tenants**:
subiendo un archivo y observando si Drop lo omite, se confirma que otra organización lo
tiene almacenado. Con documentos confidenciales (una auditoría, un contrato en HTML)
eso es una fuga real.

**Coste**: los mismos bytes se almacenan una vez por organización. El ahorro que
importa —el mismo equipo republicando los mismos assets— se conserva íntegro.

---

### ADR-013 — **Clean Architecture pragmática: 3 capas, sin ceremonia**

`domain` (entidades, invariantes, puertos) → `usecase` (orquestación, transacciones) →
`adapter` (HTTP, Postgres, S3, Redis). Sin capa de "servicios de dominio" vacía, sin
un caso de uso por cada CRUD trivial, sin mappers de 4 niveles. La regla operativa es
una sola: **el dominio no importa infraestructura**. DDD se aplica donde aporta
(`Release` como agregado con máquina de estados; `Path`, `Slug`, `Hash` como value
objects que se validan al construirse) y no donde no aporta (no hay agregado
`UsageCounter`).

---

### ADR-014 — **OpenAPI primero, con generación de código**

`api/openapi/openapi.yaml` es la fuente de verdad. `oapi-codegen` genera las interfaces
del servidor (implementarlas es obligatorio para compilar) y el cliente Go que usa la
CLI. Esto elimina por construcción la deriva entre documentación, servidor y cliente, y
regala el SDK y los tipos para futuras integraciones.

**Coste**: hay que editar YAML antes de escribir Go, y el código generado se versiona.
A cambio, el contrato no puede mentir.

---

### ADR-015 — **Un binario, tres despliegues (monolito modular)**

`dropd` (API), `drop-router` (plano de datos) y `drop-worker` (asíncrono) comparten
código y se despliegan por separado porque tienen **perfiles de escalado y de riesgo
distintos**: el router debe seguir sirviendo aunque la API esté caída; el worker no
debe competir por CPU con las peticiones. Nada más se separa: microservicios aquí
solo añadirían latencia y transacciones distribuidas donde hoy hay un `BEGIN...COMMIT`.

---

## 11. Riesgos técnicos

Ordenados por *riesgo real* = impacto × probabilidad.

### R-01 · Abuso de la plataforma: phishing y distribución de malware — **CRÍTICO**

Un servicio que hospeda HTML arbitrario en un dominio con buena reputación y URLs de
un comando es un vector de phishing de primera. Consecuencias: bloqueo del dominio en
Google Safe Browsing, listas de correo, proxies corporativos — **el dominio muere y con
él el producto**.

Mitigaciones:
- `X-Robots-Tag: noindex, nofollow` por defecto en el dominio de contenido; opt-in a
  indexación por drop (v1).
- Dominio de contenido **separado y sacrificable**, distinto del corporativo. Los
  drops públicos anónimos, si existieran, en un tercer dominio.
- Publicar requiere cuenta autenticada y verificada (email); cuota diaria.
- `POST /report` público + página de abuso; SLA de takedown; borrado *hard* que purga
  CDN + blobs.
- Detección heurística asíncrona en el worker: formularios que postean a dominios
  externos, marcas conocidas en el texto, ofuscación de JS. Marca para revisión, no
  bloquea automáticamente.
- Antivirus opcional (ClamAV) sobre blobs con `scan_state`; `infected` → release
  bloqueado.
- Registro de `created_by`, IP y API key en `audit_events` para todo publish.

### R-02 · XSS y aislamiento entre drops (mismo origen) — **ALTO**

Todos los drops comparten `drop.miempresa.com` en el MVP: JS de un drop puede leer
`localStorage`/`sessionStorage` escrito por otro y hacer peticiones con `credentials`
al mismo origen.

Mitigaciones: dominio de contenido sin cookies de sesión (ADR-005), `nosniff`,
`Content-Type` estricto desde la allowlist, `Referrer-Policy: no-referrer`,
`Permissions-Policy` restrictiva. **SVG es especialmente peligroso** (puede contener
`<script>` y ejecutarse si se navega directamente a él): se sirve con `nosniff` y en
v1 se sanea o se fuerza `Content-Disposition: attachment` cuando es el recurso de
nivel superior. Endurecimiento v1: subdominio por drop → aislamiento real de origen.

### R-03 · Corrección del recolector de basura (pérdida de datos) — **ALTO**

Un bug en el GC borra blobs referenciados y **rompe drops publicados de forma
irrecuperable**. Es el peor fallo posible: silencioso y permanente.

Mitigaciones: sin `refcount` (ADR: barrido por consulta, ver §7.6); ventana de gracia
de 7 días; borrado en dos fases con re-verificación; *dry-run* con métricas durante las
primeras semanas; límite de objetos borrados por ejecución (un GC que quiere borrar el
30% del bucket se detiene y alerta); test de integración que publica, borra y verifica
que los blobs vivos sobreviven.

### R-04 · Latencia y coste de `finalize` con muchos archivos pequeños — **MEDIO**

Un release de 2 000 archivos = 2 000 `HEAD` + 2 000 `CopyObject`. Con concurrencia 32,
~2–4 s; secuencial serían minutos. Además, coste por request y riesgo de 503 SlowDown.

Mitigaciones: concurrencia con `errgroup.SetLimit`, reintentos con backoff ante
`SlowDown`, umbral síncrono/asíncrono (ADR-011), sharding de prefijos, y aviso en la
CLI cuando el conteo de archivos es anómalo (suele ser un `node_modules` sin ignorar).

### R-05 · Análisis estático incompleto en modo archivo — **MEDIO**

`drop upload index.html` no puede saber que el JS hará `fetch('./data/2026.json')`. El
usuario ve su drop roto y culpa a Drop.

Mitigaciones: `drop upload .` (modo directorio) como camino recomendado en la
documentación; detección de patrones de carga dinámica con aviso explícito; `--dry-run`
que lista exactamente lo que se subirá; en v1, mensaje de 404 del router que sugiere
republicar con el directorio completo.

### R-06 · Dependencia del borde y lock-in del proveedor — **MEDIO**

La versión de producción del router es una Cloudflare Worker / CloudFront Function con
KV: código específico del proveedor en el camino crítico de lectura.

Mitigaciones: la lógica vive tras el puerto `RouteResolver`; la implementación en Go
(`drop-router`) es funcionalmente equivalente y es la que se usa en dev y self-hosting;
el script del edge se mantiene deliberadamente trivial (< 100 líneas: lookup +
rewrite). El `RouteStore` es una interfaz con implementaciones Redis / CF KV /
CloudFront KVS.

### R-07 · Enumeración de slugs y fuga de contenido "unlisted" — **MEDIO**

Los drops `unlisted` se protegen solo por lo impredecible de la URL.

Mitigaciones: 8 caracteres base62 con `crypto/rand` (§6.4); rate limit por IP en el
borde con penalización por ráfaga de 404; `noindex`; y comunicación honesta en el
producto: "unlisted no es privado" — la privacidad real llega con contraseña/auth (v1).

### R-08 · Envenenamiento del CAS — **MITIGADO POR DISEÑO, alto si se descuida**

Si un cliente pudiera escribir bytes arbitrarios bajo un hash ajeno, contaminaría
releases futuros de la organización. El checksum firmado en la presigned URL
(ADR-006) lo hace imposible: **es la razón por la que ese detalle no es opcional**.
Se cubre con un test explícito que intenta subir bytes que no coinciden con el hash y
verifica el 400 de S3.

### R-09 · Crecimiento y mantenimiento de `release_files` — **MEDIO**

6 × 10⁸ filas a 10⁷ drops. Riesgo de bloat por churn y de `autovacuum` insuficiente.

Mitigaciones: particionado por hash desde el día 1 (§6.5); inserción con `CopyFrom`;
borrado por partición cuando se purgan releases; `autovacuum` afinado por tabla;
monitorización de bloat.

### R-10 · Cumplimiento legal: DMCA y derecho al olvido — **MEDIO**

Un borrado debe ser real: metadata, objetos del release, blobs (si no se comparten) y
caché del CDN.

Mitigaciones: `DELETE ?purge=true` que encola un job de purga completa con
verificación e invalidación del CDN; `audit_events` conserva el hecho del borrado, no
el contenido; retención documentada; el dedup por organización simplifica el borrado
(no hay blobs compartidos entre clientes).

### R-11 · Expiración de URLs prefirmadas en subidas largas — **BAJO**

TTL de 1 h vs una subida de 200 MB con red mala.

Mitigación: `POST /v1/releases/{id}/refresh-uploads` re-emite URLs para lo que falta;
multipart reanudable; tolerancia a *clock skew* (aviso claro si el reloj del cliente
está desviado, causa clásica de `SignatureDoesNotMatch`).

### R-12 · Fuga de credenciales en CI — **BAJO/MEDIO**

Mitigaciones: prefijo `drop_sk_` registrable en secret scanning de GitHub; alcances
mínimos; expiración; `last_used_at` con alerta de uso desde IP nueva (v1); redacción
obligatoria en el logger de la CLI (test que verifica que ningún token aparece en la
salida `--verbose`).

### R-13 · Sitios con un único HTML gigantesco (base64 inline) — **BAJO**

El output típico de un LLM puede ser un HTML de 30 MB con imágenes embebidas. Rompe el
dedup (un byte cambiado = re-subida completa) y es lento de servir.

Mitigaciones: límite de 25 MiB por archivo con mensaje explicativo; compresión del CDN
(brotli reduce base64 muy eficazmente); aviso en la CLI sugiriendo extraer los assets.
Chunking del CAS (dedup a nivel de bloque) queda descartado para el MVP como
complejidad desproporcionada.

### R-14 · Rutas case-insensitive y normalización Unicode — **BAJO**

`Logo.PNG` y `logo.png` coexisten en Linux y colisionan en macOS/Windows; nombres
Unicode en NFD vs NFC producen rutas distintas para el mismo archivo.

Mitigación: normalización NFC + detección de colisiones case-insensitive en `init`, con
error explícito en lugar de sobrescritura silenciosa (§9.4).

---

## Resumen de seguridad (checklist de implementación)

| Control | Dónde |
|---|---|
| Autenticación (device flow, JWT EdDSA, refresh rotatorio, API keys argon2id) | `dropd` |
| Autorización RBAC + `org_id` obligatorio en repositorios + RLS (v1) | `domain/authz`, `adapter/postgres` |
| Rate limiting por capas, auth falla cerrado | middleware Chi + Redis |
| Validación de paths (traversal, absolutos, nulos, reservados, NFC, colisiones) | CLI **y** API (doble) |
| Allowlist de MIME + coherencia extensión/magic bytes/declarado | CLI **y** API |
| Límites de tamaño impuestos por el storage (condición firmada) | presigned PUT |
| Integridad SHA-256 verificada por el storage | presigned PUT + `HEAD` en finalize |
| Publicación atómica (nunca estado visible parcial) | máquina de estados + pointer flip |
| Sin sobrescritura: releases y blobs inmutables | diseño de claves |
| Aislamiento de origen del contenido | dominio separado (+ subdominio por drop en v1) |
| `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex` | router / CDN |
| Bucket privado, acceso solo desde CDN | política de bucket / OAC |
| Antivirus opcional, pipeline de abuso, takedown | `drop-worker` |
| Auditoría de toda acción con efecto | `audit_events` |
| Secretos nunca en logs; redacción verificada por test | `platform/log` |
