#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMA_FILE="${DIRECTUS_SCHEMA_FILE:-${ROOT_DIR}/directus/schema/app-schema.json}"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "[directus:schema:apply] schema file not found: ${SCHEMA_FILE}" >&2
  exit 1
fi

echo "[directus:schema:apply] applying schema from ${SCHEMA_FILE}"

cat "${SCHEMA_FILE}" | docker compose exec -T directus sh -lc '
  cat > /tmp/directus-schema.json &&
  npx directus schema apply /tmp/directus-schema.json --yes
'

echo "[directus:schema:apply] done"
