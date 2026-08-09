#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly project_name="${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME zorunludur}"
readonly compose_file="${COMPOSE_FILE:-compose.production.yaml}"
readonly restore_database="infra_restore_${RANDOM}"
compose=(docker compose -f "$compose_file" -p "$project_name")
restore_database_created=0

cleanup() {
  if (( restore_database_created != 1 )); then
    return
  fi
  "${compose[@]}" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists --force --username="$POSTGRES_USER" "$RESTORE_DATABASE"' \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

drop_restore_database() {
  "${compose[@]}" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists --force --username="$POSTGRES_USER" "$RESTORE_DATABASE"' \
    >/dev/null
  restore_database_created=0
}

"${compose[@]}" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" createdb --username="$POSTGRES_USER" "$RESTORE_DATABASE"'
restore_database_created=1

"${compose[@]}" exec -T postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-acl' |
  "${compose[@]}" --profile operations run --rm --no-deps -T backup-crypto encrypt |
  "${compose[@]}" --profile operations run --rm --no-deps -T backup-crypto decrypt |
  "${compose[@]}" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE"'

restored_table_count="$(
  "${compose[@]}" exec -T -e RESTORE_DATABASE="$restore_database" postgres sh -eu -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE" --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = '\''public'\''"'
)"
restored_table_count="${restored_table_count//[[:space:]]/}"
[[ "$restored_table_count" =~ ^[0-9]+$ ]] || {
  printf '%s\n' "Restore edilen tablo sayısı doğrulanamadı." >&2
  exit 1
}
(( restored_table_count > 0 )) || {
  printf '%s\n' "Restore edilen veritabanında public tablo bulunamadı." >&2
  exit 1
}

drop_restore_database
printf 'BACKUP_RESTORE_SMOKE_TABLES=%s\n' "$restored_table_count"
