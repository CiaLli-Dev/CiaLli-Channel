#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMA_FILE="${DIRECTUS_SCHEMA_FILE:-${ROOT_DIR}/directus/schema/app-schema.json}"

mkdir -p "$(dirname "${SCHEMA_FILE}")"

echo "[directus:schema:snapshot] exporting schema to ${SCHEMA_FILE}"

docker compose exec -T directus sh -lc '
  rm -f /tmp/directus-schema.json &&
  npx directus schema snapshot /tmp/directus-schema.json --yes --format json >/dev/null &&
  cat /tmp/directus-schema.json
' >"${SCHEMA_FILE}"

echo "[directus:schema:snapshot] done"
