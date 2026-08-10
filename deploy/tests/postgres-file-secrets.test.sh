#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
temporary_root="$(mktemp -d)"
trap 'rm -rf -- "$temporary_root"' EXIT

fail_test() {
  printf '%s\n' "PostgreSQL file-secret testi başarısız: $1" >&2
  exit 1
}

source "$repository_root/deploy/postgres/file-secrets.sh"
valid_path="$temporary_root/runtime-password"
empty_path="$temporary_root/empty"
nul_path="$temporary_root/nul"
oversized_path="$temporary_root/oversized"
printf '%s\n' 'Synthetic-Runtime-Only-2026_' >"$valid_path"
: >"$empty_path"
printf 'before\0after' >"$nul_path"
head -c 65537 /dev/zero | tr '\0' 'a' >"$oversized_path"

export USE_FILE_SECRETS=1
export POSTGRES_RUNTIME_PASSWORD_FILE="$valid_path"
unset POSTGRES_RUNTIME_PASSWORD
load_file_secret POSTGRES_RUNTIME_PASSWORD
[[ "$POSTGRES_RUNTIME_PASSWORD" == 'Synthetic-Runtime-Only-2026_' ]] ||
  fail_test "Geçerli secret dosyası yüklenmedi."

if (
  export PGPASSWORD='direct-value'
  export PGPASSWORD_FILE="$valid_path"
  load_file_secret PGPASSWORD >/dev/null 2>&1
); then
  fail_test "Doğrudan değer ve _FILE çakışması kabul edildi."
fi
if (
  export USE_FILE_SECRETS=0
  unset PGPASSWORD
  export PGPASSWORD_FILE="$valid_path"
  load_file_secret PGPASSWORD >/dev/null 2>&1
); then
  fail_test "Kapalı opt-in kapısıyla secret dosyası kabul edildi."
fi
for rejected_path in "$empty_path" "$nul_path" "$oversized_path" "$temporary_root"; do
  if (
    export USE_FILE_SECRETS=1
    unset PGPASSWORD
    export PGPASSWORD_FILE="$rejected_path"
    load_file_secret PGPASSWORD >/dev/null 2>&1
  ); then
    fail_test "Güvensiz secret kaynağı kabul edildi: $rejected_path"
  fi
done

link_path="$temporary_root/password-link"
ln -s "$valid_path" "$link_path"
if [[ -L "$link_path" ]]; then
  if (
    export USE_FILE_SECRETS=1
    unset PGPASSWORD
    export PGPASSWORD_FILE="$link_path"
    load_file_secret PGPASSWORD >/dev/null 2>&1
  ); then
    fail_test "Sembolik bağlantı secret kaynağı kabul edildi."
  fi
else
  rm -f -- "$link_path"
fi

owner_output="$({
  export USE_FILE_SECRETS=1
  export FILE_SECRET_HELPER_PATH="$repository_root/deploy/postgres/file-secrets.sh"
  export POSTGRES_PASSWORD_FILE="$valid_path"
  unset POSTGRES_PASSWORD PGPASSWORD PGPASSWORD_FILE
  sh "$repository_root/deploy/postgres/with-owner-password.sh" sh -eu -c \
    'printf "%s" "$PGPASSWORD"'
})"
[[ "$owner_output" == 'Synthetic-Runtime-Only-2026_' ]] ||
  fail_test "Owner yardımcı betiği POSTGRES_PASSWORD_FILE değerini PGPASSWORD olarak aktarmadı."

printf '%s\n' "PostgreSQL file-backed secret testleri geçti."
