#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMA_FILE="${DIRECTUS_SCHEMA_FILE:-${ROOT_DIR}/directus/schema/app-schema.json}"

usage() {
  cat <<EOF
Usage:
  pnpm directus:schema:snapshot
  pnpm directus:schema:apply

Options:
  --help, -h    Show this help message.

Environment:
  DIRECTUS_SCHEMA_FILE  Override the schema file path.
EOF
}

normalize_command() {
  if [[ $# -eq 0 ]]; then
    return
  fi

  if [[ "$1" == "--" ]]; then
    shift
  fi

  printf '%s\n' "${1:-}"
}

COMMAND="$(normalize_command "$@")"
if [[ "${2:-}" == "--help" || "${2:-}" == "-h" ]]; then
  usage
  exit 0
fi

case "${COMMAND}" in
  "" )
    echo "[directus:schema] missing subcommand." >&2
    usage >&2
    exit 1
    ;;
  "--help" | "-h" )
    usage
    exit 0
    ;;
  "snapshot" )
    mkdir -p "$(dirname "${SCHEMA_FILE}")"

    echo "[directus:schema] exporting schema to ${SCHEMA_FILE}"

    docker compose exec -T directus sh -lc '
      rm -f /tmp/directus-schema.json &&
      npx directus schema snapshot /tmp/directus-schema.json --yes --format json >/dev/null &&
      cat /tmp/directus-schema.json
    ' >"${SCHEMA_FILE}"

    echo "[directus:schema] snapshot done"
    ;;
  "apply" )
    if [[ ! -f "${SCHEMA_FILE}" ]]; then
      echo "[directus:schema] schema file not found: ${SCHEMA_FILE}" >&2
      exit 1
    fi

    echo "[directus:schema] applying schema from ${SCHEMA_FILE}"

    cat "${SCHEMA_FILE}" | docker compose exec -T directus sh -lc '
      cat > /tmp/directus-schema.json &&
      npx directus schema apply /tmp/directus-schema.json --yes
    '

    echo "[directus:schema] apply done"
    ;;
  * )
    echo "[directus:schema] unsupported subcommand: ${COMMAND}" >&2
    usage >&2
    exit 1
    ;;
esac
