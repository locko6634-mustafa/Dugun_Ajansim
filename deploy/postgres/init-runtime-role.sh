#!/bin/sh
set -eu

fail() {
  printf '%s\n' "PostgreSQL runtime rolü hazırlanamadı: $1" >&2
  exit 1
}

runtime_user="${POSTGRES_RUNTIME_USER:-}"
runtime_password="${POSTGRES_RUNTIME_PASSWORD:-}"

[ -n "${POSTGRES_USER:-}" ] || fail "POSTGRES_USER zorunludur."
[ -n "${POSTGRES_DB:-}" ] || fail "POSTGRES_DB zorunludur."
[ -n "$runtime_user" ] || fail "POSTGRES_RUNTIME_USER zorunludur."
[ -n "$runtime_password" ] || fail "POSTGRES_RUNTIME_PASSWORD zorunludur."

case "$runtime_user" in
  [a-z_]*) ;;
  *) fail "POSTGRES_RUNTIME_USER küçük harf veya alt çizgiyle başlamalıdır." ;;
esac
case "$runtime_user" in
  *[!a-z0-9_]*) fail "POSTGRES_RUNTIME_USER yalnızca küçük harf, rakam ve alt çizgi içerebilir." ;;
esac
[ "${#runtime_user}" -ge 3 ] && [ "${#runtime_user}" -le 63 ] ||
  fail "POSTGRES_RUNTIME_USER 3-63 karakter olmalıdır."
[ "$runtime_user" != "$POSTGRES_USER" ] ||
  fail "Runtime ve migration rolleri farklı olmalıdır."

[ "${#runtime_password}" -ge 20 ] ||
  fail "POSTGRES_RUNTIME_PASSWORD en az 20 karakter olmalıdır."
case "$runtime_password" in
  *[!A-Za-z0-9._~-]*) fail "POSTGRES_RUNTIME_PASSWORD URL-güvenli karakterlerden oluşmalıdır." ;;
esac

password_class_count=0
case "$runtime_password" in *[a-z]*) password_class_count=$((password_class_count + 1)) ;; esac
case "$runtime_password" in *[A-Z]*) password_class_count=$((password_class_count + 1)) ;; esac
case "$runtime_password" in *[0-9]*) password_class_count=$((password_class_count + 1)) ;; esac
case "$runtime_password" in *[._~-]*) password_class_count=$((password_class_count + 1)) ;; esac
[ "$password_class_count" -ge 3 ] ||
  fail "POSTGRES_RUNTIME_PASSWORD en az üç karakter sınıfı içermelidir."

if [ -n "${POSTGRES_PASSWORD:-}" ] && [ "$runtime_password" = "$POSTGRES_PASSWORD" ]; then
  fail "Runtime ve migration parolaları farklı olmalıdır."
fi
if [ -n "${PGPASSWORD:-}" ] && [ "$runtime_password" = "$PGPASSWORD" ]; then
  fail "Runtime ve migration parolaları farklı olmalıdır."
fi

psql -X -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv runtime_user POSTGRES_RUNTIME_USER
\getenv runtime_password POSTGRES_RUNTIME_PASSWORD
\getenv owner_user POSTGRES_USER
\getenv database_name POSTGRES_DB

SELECT EXISTS (
  SELECT 1
  FROM pg_roles AS role
  WHERE role.rolname = :'runtime_user'
    AND (
      EXISTS (SELECT 1 FROM pg_database WHERE datdba = role.oid)
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = role.oid)
      OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = role.oid)
      OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = role.oid)
      OR EXISTS (SELECT 1 FROM pg_type WHERE typowner = role.oid)
    )
) AS runtime_owns_objects \gset

\if :runtime_owns_objects
  \echo 'Runtime rolü beklenmeyen veritabanı nesnelerine sahip; güvenli yükseltme için işlem durduruldu.'
  \quit 3
\endif

SET password_encryption = 'scram-sha-256';

SELECT format(
  'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50',
  :'runtime_user',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user') \gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50',
  :'runtime_user',
  :'runtime_password'
) \gexec

SELECT format('REVOKE %I FROM %I', granted_role.rolname, member_role.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles AS member_role ON member_role.oid = membership.member
WHERE member_role.rolname = :'runtime_user' \gexec

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', :'database_name', :'runtime_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'runtime_user') \gexec

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'runtime_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user') \gexec

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'runtime_user') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'runtime_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I', :'runtime_user') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'runtime_user') \gexec

SELECT format('GRANT DELETE ON TABLE %I.%I TO %I', 'public', 'auth_sessions', :'runtime_user')
WHERE to_regclass('public.auth_sessions') IS NOT NULL \gexec
SELECT format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I', 'public', '_prisma_migrations', :'runtime_user')
WHERE to_regclass('public."_prisma_migrations"') IS NOT NULL \gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
  :'owner_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
  :'owner_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC',
  :'owner_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO %I',
  :'owner_user',
  :'runtime_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'owner_user',
  :'runtime_user'
) \gexec

\unset runtime_password
SQL

printf '%s\n' 'PostgreSQL runtime rolü en az ayrıcalıklarla hazırlandı.'
