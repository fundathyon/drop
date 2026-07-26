#!/usr/bin/env bash
# Populates the admin tree with demo content through the real API, so the
# explorer has something to show. This is demo data, not a data layer: every
# object below is created with the same endpoints the frontend uses.
set -euo pipefail

API="${DROP_API_URL:-http://localhost:8000}"

if ! curl -fsS "$API/healthz" >/dev/null 2>&1; then
  echo "error: no API at $API — start it with 'make api' (or 'make dev') first." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# POST helper that tolerates a 409 so re-seeding is not an error.
post_json() {
  local path="$1" body="$2" label="$3"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API$path" \
    -H 'Content-Type: application/json' -d "$body")
  case "$code" in
    201) echo "  + $label" ;;
    409) echo "  = $label (ya existía)" ;;
    *)   echo "  ! $label — HTTP $code" >&2 ;;
  esac
}

folder() {
  post_json "/v1/nodes" "{\"parent\":\"$1\",\"name\":\"$2\"}" "carpeta $1${1:+/}$2"
}

drop() {
  local parent="$1" name="$2" title="$3" visibility="$4"
  post_json "/v1/drops" \
    "{\"parent\":\"$parent\",\"name\":\"$name\",\"title\":\"$title\",\"visibility\":\"$visibility\"}" \
    "drop $parent${parent:+/}$name"
}

upload() {
  local dest="$1" filename="$2" content="$3" ctype="$4"
  printf '%s' "$content" > "$work/$filename"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/files?path=$dest" \
    -F "file=@$work/$filename;type=$ctype")
  if [ "$code" = "201" ]; then
    echo "    · $filename"
  else
    echo "    ! $filename — HTTP $code" >&2
  fi
}

echo "Sembrando contenido de demo en $API"

folder "" "Proyectos"
folder "" "Clientes"
folder "Clientes" "acme"

drop "Proyectos" "arquitectura" "Arquitectura del sistema" "public"
upload "Proyectos/arquitectura" "index.html" \
  '<!doctype html><meta charset="utf-8"><title>Arquitectura</title><link rel="stylesheet" href="styles.css"><h1>Arquitectura del sistema</h1><p>Diagrama de componentes y flujos de publicación.</p>' \
  "text/html"
upload "Proyectos/arquitectura" "styles.css" \
  'body{font-family:system-ui;margin:3rem auto;max-width:42rem;line-height:1.6}' \
  "text/css"
upload "Proyectos/arquitectura" "diagrama.svg" \
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" rx="6" fill="#e8eaf0"/><text x="60" y="34" text-anchor="middle" font-size="11" fill="#333">API → MinIO</text></svg>' \
  "image/svg+xml"

drop "Proyectos" "roadmap" "Roadmap Q3" "unlisted"
upload "Proyectos/roadmap" "index.html" \
  '<!doctype html><meta charset="utf-8"><title>Roadmap</title><h1>Roadmap Q3</h1><ol><li>Versionado de releases</li><li>Dominios propios</li><li>Analytics</li></ol>' \
  "text/html"

drop "Clientes/acme" "propuesta" "Propuesta comercial ACME" "private"
upload "Clientes/acme/propuesta" "index.html" \
  '<!doctype html><meta charset="utf-8"><title>Propuesta ACME</title><h1>Propuesta comercial</h1><p>Alcance, plazos y presupuesto.</p>' \
  "text/html"
upload "Clientes/acme/propuesta" "notas.txt" \
  'Reunión de kickoff: martes 10:00. Pendiente confirmar alcance de la fase 2.' \
  "text/plain"

drop "" "demo-landing" "Landing de demostración" "public"
upload "demo-landing" "index.html" \
  '<!doctype html><meta charset="utf-8"><title>Demo</title><script src="app.js" defer></script><h1>Landing de demostración</h1><p id="hint"></p>' \
  "text/html"
upload "demo-landing" "app.js" \
  'document.getElementById("hint").textContent = "Servido desde MinIO vía Drop.";' \
  "text/javascript"

echo "Listo. Abre http://localhost:8000 para verlo."
