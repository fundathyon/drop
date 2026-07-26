# Drop — Diseño del sistema

> Estado: **propuesta de diseño (v0.1)** — pendiente de aprobación. No hay código todavía.

Drop es una plataforma para publicar artefactos HTML estáticos con un comando y
obtener una URL pública. *Pastebin para HTML, para equipos de ingeniería.*

```
drop upload architecture.html   →   https://drop.miempresa.com/aBc91K
```

## Índice de documentos

| Doc | Contenido | Entregables cubiertos |
|-----|-----------|-----------------------|
| [01-arquitectura.md](01-arquitectura.md) | Visión general, componentes, responsabilidades, flujo de publicación, flujo de autenticación | 1, 2, 3, 4, 5 |
| [02-datos-y-almacenamiento.md](02-datos-y-almacenamiento.md) | Modelo de datos, diseño de storage, diseño del bucket, GC y multi-región | 6, 7, 8 |
| [03-api-y-cli.md](03-api-y-cli.md) | API REST (OpenAPI), diseño de la CLI, UX, escáner de dependencias | 9, 10 |
| [04-decisiones-y-riesgos.md](04-decisiones-y-riesgos.md) | ADRs con trade-offs, riesgos técnicos y mitigaciones, seguridad | 11, 12 |
| [05-repositorio-y-roadmap.md](05-repositorio-y-roadmap.md) | Estructura del repo, convenciones de código, organización de paquetes, roadmap MVP/v1/v2 | 13, 14, 15 |

## Los 5 principios que gobiernan todas las decisiones

1. **La API nunca transporta bytes de contenido.** Sube el cliente (presigned URLs),
   sirve el CDN. La API solo mueve metadata y coordina.
2. **Todo lo servido es inmutable.** Un *release* nunca se sobrescribe; publicar es
   crear un release nuevo y mover un puntero. Esto da atomicidad, caché infinita,
   rollback y versionado sin rediseñar nada.
3. **Una indirección en el borde.** `slug → release` se resuelve en el edge, no en la
   API. Ahí viven después contraseñas, expiración, dominios propios y analytics
   sin tocar el core.
4. **El contenido no confiable vive en otro dominio.** Nunca en el mismo origin que
   el dashboard o las cookies de sesión.
5. **Aburrido y explícito.** Postgres, S3, Go, SQL escrito a mano. Cero magia:
   la complejidad se gasta en el dominio (publicación atómica, dedup, GC), no en
   el framework.

## Qué NO es Drop (límites de alcance, deliberados)

- No es un CMS, ni un editor, ni un generador de documentación.
- No renderiza Markdown, no ejecuta builds, no tiene runtime de servidor.
- No transforma el contenido: lo publica tal cual (más allá de validaciones de
  seguridad y headers).
