#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
temporary_root="$(mktemp -d)"
secret_root="$temporary_root/secrets"
fixture_environment_file="$temporary_root/.env.production"
readonly environment_file=".env.production"
trap 'rm -rf -- "$temporary_root"' EXIT

source "$repository_root/deploy/validate-production-secrets.sh"

fail_test() {
  printf '%s\n' "Production secret kaynak testi başarısız: $1" >&2
  exit 1
}

secret_contract=(
  POSTGRES_PASSWORD_SECRET_FILE:postgres-owner-password
  POSTGRES_RUNTIME_PASSWORD_SECRET_FILE:postgres-runtime-password
  DATABASE_URL_OWNER_SECRET_FILE:database-url-owner
  DATABASE_URL_RUNTIME_SECRET_FILE:database-url-runtime
  TURNSTILE_SITE_KEY_SECRET_FILE:turnstile-site-key
  TURNSTILE_SECRET_KEY_SECRET_FILE:turnstile-secret-key
  DATA_ENCRYPTION_KEY_SECRET_FILE:data-encryption-key
  APPLICATION_KEY_FINGERPRINTS_SECRET_FILE:application-key-fingerprints
  DATA_ENCRYPTION_KEYRING_SECRET_FILE:data-encryption-keyring
  PII_BLIND_INDEX_KEYRING_SECRET_FILE:pii-blind-index-keyring
  PII_BLIND_INDEX_KEY_SECRET_FILE:pii-blind-index-key
  RATE_LIMIT_HMAC_KEY_SECRET_FILE:rate-limit-hmac-key
  BACKUP_ENCRYPTION_KEYRING_SECRET_FILE:backup-encryption-keyring
)

mkdir -p -- "$secret_root"
chmod 700 "$secret_root"
: >"$fixture_environment_file"
printf '%s\n' "USE_FILE_SECRETS=1" >>"$fixture_environment_file"
printf 'PRODUCTION_SECRET_ROOT=%s\n' "$secret_root" >>"$fixture_environment_file"
for contract in "${secret_contract[@]}"; do
  variable_name="${contract%%:*}"
  filename="${contract#*:}"
  printf '%s' "synthetic-$filename" >"$secret_root/$filename"
  chmod 600 "$secret_root/$filename"
  printf '%s=%s/%s\n' "$variable_name" "$secret_root" "$filename" >>"$fixture_environment_file"
done

current_user_id="$(id -u)"
validate_production_secret_sources "$fixture_environment_file" "$current_user_id"

chmod 444 "$secret_root/postgres-owner-password"
validate_production_secret_sources "$fixture_environment_file" "$current_user_id"
chmod 600 "$secret_root/postgres-owner-password"

sed '/^PRODUCTION_SECRET_ROOT=/d' "$fixture_environment_file" >"$temporary_root/missing-root.env"
if validate_production_secret_sources "$temporary_root/missing-root.env" "$current_user_id" >/dev/null 2>&1; then
  fail_test "Eksik PRODUCTION_SECRET_ROOT kabul edildi."
fi

sed "s#^PRODUCTION_SECRET_ROOT=.*#PRODUCTION_SECRET_ROOT=$secret_root/../secrets#" \
  "$fixture_environment_file" >"$temporary_root/noncanonical-root.env"
if validate_production_secret_sources "$temporary_root/noncanonical-root.env" "$current_user_id" >/dev/null 2>&1; then
  fail_test "Kanonik olmayan PRODUCTION_SECRET_ROOT kabul edildi."
fi

chmod 644 "$secret_root/postgres-owner-password"
if validate_production_secret_sources "$fixture_environment_file" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Grup/dünya tarafından okunabilen secret kabul edildi."
fi
chmod 600 "$secret_root/postgres-owner-password"

ln "$secret_root/postgres-owner-password" "$temporary_root/postgres-owner-hardlink"
if validate_production_secret_sources "$fixture_environment_file" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Birden fazla hard link içeren secret kabul edildi."
fi
rm -f -- "$temporary_root/postgres-owner-hardlink"

mv "$secret_root/postgres-owner-password" "$temporary_root/postgres-owner-original"
ln -s "$temporary_root/postgres-owner-original" "$secret_root/postgres-owner-password"
if validate_production_secret_sources "$fixture_environment_file" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Symlink secret kabul edildi."
fi
rm -f -- "$secret_root/postgres-owner-password"
mv "$temporary_root/postgres-owner-original" "$secret_root/postgres-owner-password"

: >"$secret_root/postgres-owner-password"
if validate_production_secret_sources "$fixture_environment_file" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Boş secret kabul edildi."
fi
printf '%s' "synthetic-postgres-owner-password" >"$secret_root/postgres-owner-password"

chmod 755 "$secret_root"
if validate_production_secret_sources "$fixture_environment_file" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Gevşek izinli secret dizini kabul edildi."
fi
chmod 700 "$secret_root"

sed '/^TURNSTILE_SECRET_KEY_SECRET_FILE=/d' "$fixture_environment_file" >"$temporary_root/missing.env"
if validate_production_secret_sources "$temporary_root/missing.env" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Eksik secret kaynağı kabul edildi."
fi

cp "$fixture_environment_file" "$temporary_root/duplicate.env"
grep '^POSTGRES_PASSWORD_SECRET_FILE=' "$fixture_environment_file" >>"$temporary_root/duplicate.env"
if validate_production_secret_sources "$temporary_root/duplicate.env" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Yinelenen secret path değişkeni kabul edildi."
fi

sed 's#^POSTGRES_PASSWORD_SECRET_FILE=.*#POSTGRES_PASSWORD_SECRET_FILE=/tmp/postgres-owner-password#' \
  "$fixture_environment_file" >"$temporary_root/wrong-path.env"
if validate_production_secret_sources "$temporary_root/wrong-path.env" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "Sabit production dizini dışındaki secret yolu kabul edildi."
fi

sed 's/^USE_FILE_SECRETS=1$/USE_FILE_SECRETS=0/' "$fixture_environment_file" >"$temporary_root/disabled.env"
if validate_production_secret_sources "$temporary_root/disabled.env" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test "USE_FILE_SECRETS=0 kabul edildi."
fi

cp "$fixture_environment_file" "$temporary_root/direct-secret.env"
printf '%s\n' 'DATA_ENCRYPTION_KEY=synthetic-direct-secret-for-rejection' >>"$temporary_root/direct-secret.env"
if validate_production_secret_sources "$temporary_root/direct-secret.env" "$current_user_id" "$secret_root" >/dev/null 2>&1; then
  fail_test ".env.production içindeki doğrudan secret kabul edildi."
fi

printf '%s\n' "Production secret kaynak kontrolleri geçti."
