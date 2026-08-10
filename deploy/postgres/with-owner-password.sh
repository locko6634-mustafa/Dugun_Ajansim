#!/bin/sh
set -eu

file_secret_helper="${FILE_SECRET_HELPER_PATH:-/usr/local/bin/file-secrets.sh}"
[ -f "$file_secret_helper" ] || {
  printf '%s\n' 'PostgreSQL file-backed secret yardımcısı bulunamadı.' >&2
  exit 1
}
. "$file_secret_helper"

if [ -n "${PGPASSWORD_FILE:-}" ]; then
  load_file_secret PGPASSWORD
elif [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  load_file_secret POSTGRES_PASSWORD
  PGPASSWORD="$POSTGRES_PASSWORD"
  export PGPASSWORD
elif [ -n "${POSTGRES_PASSWORD:-}" ]; then
  PGPASSWORD="$POSTGRES_PASSWORD"
  export PGPASSWORD
else
  printf '%s\n' 'PostgreSQL owner parolası bulunamadı.' >&2
  exit 1
fi

exec "$@"
