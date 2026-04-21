#!/bin/sh

set -eu

SEED_FILE="/seed/postgres/demo.dump"

if [ ! -f "$SEED_FILE" ]; then
  echo "[seed-postgres-restore] seed dump not found: $SEED_FILE" >&2
  exit 1
fi

if head -n 1 "$SEED_FILE" 2>/dev/null | grep -q "version https://git-lfs.github.com/spec/v1"; then
  echo "[seed-postgres-restore] seed dump is still a Git LFS pointer; run git lfs pull first." >&2
  exit 1
fi

PGHOST="postgres"

HAS_SITE_SETTINGS_TABLE="$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "
select case
  when exists (
    select 1
    from pg_tables
    where schemaname = 'public' and tablename = 'app_site_settings'
  ) then 'yes'
  else 'no'
end;
")"

if [ "$HAS_SITE_SETTINGS_TABLE" = "yes" ]; then
  RESTORE_REQUIRED="$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "
select case
  when exists (select 1 from app_site_settings where key = 'default') then 'no'
  else 'yes'
end;
")"
else
  # 空库首次启动时 app_site_settings 还不存在，这里不能直接引用该表，否则会在恢复前就失败。
  RESTORE_REQUIRED="yes"
fi

if [ "$RESTORE_REQUIRED" != "yes" ]; then
  echo "[seed-postgres-restore] existing business data detected; skip restore."
  exit 0
fi

echo "[seed-postgres-restore] restoring demo PostgreSQL seed into $POSTGRES_DB."

# 这里先清空 public schema，再整体恢复 dump，确保“空库但已被误初始化”的场景也能回到统一演示态。
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "
drop schema if exists public cascade;
create schema public;
"

PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  -h "$PGHOST" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  "$SEED_FILE"

echo "[seed-postgres-restore] done"
