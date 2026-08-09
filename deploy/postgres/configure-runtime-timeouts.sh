#!/bin/sh
set -eu

fail() {
  printf '%s\n' "PostgreSQL runtime timeout ayarları uygulanamadı: $1" >&2
  exit 1
}

validate_integer() {
  setting_name="$1"
  setting_value="$2"
  minimum_value="$3"
  maximum_value="$4"

  case "$setting_value" in
    ''|*[!0-9]*) fail "$setting_name pozitif tam sayı olmalıdır." ;;
  esac
  [ "$setting_value" -ge "$minimum_value" ] && [ "$setting_value" -le "$maximum_value" ] ||
    fail "$setting_name $minimum_value-$maximum_value milisaniye aralığında olmalıdır."
}

runtime_user="${POSTGRES_RUNTIME_USER:-}"
statement_timeout_ms="${POSTGRES_RUNTIME_STATEMENT_TIMEOUT_MS:-}"
lock_timeout_ms="${POSTGRES_RUNTIME_LOCK_TIMEOUT_MS:-}"
idle_transaction_timeout_ms="${POSTGRES_RUNTIME_IDLE_TRANSACTION_TIMEOUT_MS:-}"

[ -n "${POSTGRES_USER:-}" ] || fail "POSTGRES_USER zorunludur."
[ -n "${POSTGRES_DB:-}" ] || fail "POSTGRES_DB zorunludur."
[ -n "$runtime_user" ] || fail "POSTGRES_RUNTIME_USER zorunludur."

case "$runtime_user" in
  [a-z_]*) ;;
  *) fail "POSTGRES_RUNTIME_USER küçük harf veya alt çizgiyle başlamalıdır." ;;
esac
case "$runtime_user" in
  *[!a-z0-9_]*) fail "POSTGRES_RUNTIME_USER yalnızca küçük harf, rakam ve alt çizgi içerebilir." ;;
esac

validate_integer "POSTGRES_RUNTIME_STATEMENT_TIMEOUT_MS" "$statement_timeout_ms" 1000 300000
validate_integer "POSTGRES_RUNTIME_LOCK_TIMEOUT_MS" "$lock_timeout_ms" 250 60000
validate_integer "POSTGRES_RUNTIME_IDLE_TRANSACTION_TIMEOUT_MS" "$idle_transaction_timeout_ms" 1000 300000

psql -X -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv runtime_user POSTGRES_RUNTIME_USER
\getenv statement_timeout_ms POSTGRES_RUNTIME_STATEMENT_TIMEOUT_MS
\getenv lock_timeout_ms POSTGRES_RUNTIME_LOCK_TIMEOUT_MS
\getenv idle_transaction_timeout_ms POSTGRES_RUNTIME_IDLE_TRANSACTION_TIMEOUT_MS

BEGIN;
SELECT format(
  'ALTER ROLE %I SET statement_timeout = %L',
  :'runtime_user',
  :'statement_timeout_ms' || 'ms'
) \gexec
SELECT format(
  'ALTER ROLE %I SET lock_timeout = %L',
  :'runtime_user',
  :'lock_timeout_ms' || 'ms'
) \gexec
SELECT format(
  'ALTER ROLE %I SET idle_in_transaction_session_timeout = %L',
  :'runtime_user',
  :'idle_transaction_timeout_ms' || 'ms'
) \gexec
COMMIT;

WITH expected(name, milliseconds) AS (
  VALUES
    ('statement_timeout', :'statement_timeout_ms'::numeric),
    ('lock_timeout', :'lock_timeout_ms'::numeric),
    ('idle_in_transaction_session_timeout', :'idle_transaction_timeout_ms'::numeric)
),
actual AS (
  SELECT
    split_part(setting, '=', 1) AS name,
    split_part(setting, '=', 2)::interval AS duration
  FROM pg_catalog.pg_db_role_setting AS role_setting
  JOIN pg_catalog.pg_roles AS role ON role.oid = role_setting.setrole
  CROSS JOIN LATERAL unnest(role_setting.setconfig) AS setting
  WHERE role.rolname = :'runtime_user'
    AND role_setting.setdatabase = 0
)
SELECT count(*) = 3
  AND bool_and(abs(extract(epoch FROM actual.duration) * 1000 - expected.milliseconds) < 0.001)
  AS settings_valid
FROM expected
JOIN actual USING (name)
\gset

\if :settings_valid
\else
  \echo 'Runtime rolü timeout doğrulaması başarısız.'
  \quit 3
\endif
SQL

printf '%s\n' 'PostgreSQL runtime timeout ayarları uygulandı.'
