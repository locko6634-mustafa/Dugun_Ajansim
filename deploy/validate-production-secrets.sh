#!/usr/bin/env bash

readonly production_secret_root="/run/dugun-ajansim-secrets"

production_secret_error() {
  printf '%s\n' "Production secret doğrulaması başarısız: $1" >&2
  return 1
}

read_production_environment_value() {
  local environment_file_path="$1"
  local variable_name="$2"
  local value

  value="$(
    awk -v variable_name="$variable_name" '
      BEGIN { matches = 0 }
      {
        sub(/\r$/, "")
        if ($0 ~ "^[[:space:]]*" variable_name "[[:space:]]*=") {
          matches += 1
          sub("^[[:space:]]*" variable_name "[[:space:]]*=[[:space:]]*", "")
          value = $0
        }
      }
      END {
        if (matches != 1) exit matches == 0 ? 2 : 3
        print value
      }
    ' "$environment_file_path"
  )" || {
    production_secret_error "$variable_name tam olarak bir kez tanımlanmalıdır."
    return 1
  }

  case "$value" in
    \"*\") value="${value:1:${#value}-2}" ;;
    \'*\') value="${value:1:${#value}-2}" ;;
  esac
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    production_secret_error "$variable_name boş veya çok satırlı olamaz."
    return 1
  }
  printf '%s' "$value"
}

require_empty_production_environment_value() {
  local environment_file_path="$1"
  local variable_name="$2"
  local value

  value="$(
    awk -v variable_name="$variable_name" '
      BEGIN { matches = 0 }
      {
        sub(/\r$/, "")
        if ($0 ~ "^[[:space:]]*" variable_name "[[:space:]]*=") {
          matches += 1
          sub("^[[:space:]]*" variable_name "[[:space:]]*=[[:space:]]*", "")
          value = $0
        }
      }
      END {
        if (matches > 1) exit 3
        if (matches == 1) print value
      }
    ' "$environment_file_path"
  )" || {
    production_secret_error "$variable_name en fazla bir kez tanımlanabilir."
    return 1
  }

  case "$value" in
    \"*\") value="${value:1:${#value}-2}" ;;
    \'*\') value="${value:1:${#value}-2}" ;;
  esac
  [[ -z "$value" ]] || {
    production_secret_error "$variable_name .env.production içinde secret değeri taşıyamaz; yalnız *_SECRET_FILE kullanılmalıdır."
    return 1
  }
}

validate_production_secret_sources() {
  local environment_file_path="$1"
  local expected_owner_id="$2"
  local secret_root="${3:-$production_secret_root}"
  local secret_root_mode
  local secret_root_owner
  local variable_name
  local expected_filename
  local secret_path
  local secret_mode
  local secret_owner
  local secret_links
  local secret_size

  [[ "$(read_production_environment_value "$environment_file_path" USE_FILE_SECRETS)" == "1" ]] || {
    production_secret_error "USE_FILE_SECRETS .env.production içinde tam olarak 1 olmalıdır."
    return 1
  }

  while IFS= read -r variable_name; do
    [[ -n "$variable_name" ]] || continue
    require_empty_production_environment_value "$environment_file_path" "$variable_name" || return 1
  done <<'DIRECT_SECRET_CONTRACT'
POSTGRES_PASSWORD
POSTGRES_RUNTIME_PASSWORD
DATABASE_URL
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
DATA_ENCRYPTION_KEY
APPLICATION_DATA_ENCRYPTION_KEY_FINGERPRINTS
DATA_ENCRYPTION_KEYRING_JSON
PII_BLIND_INDEX_KEYRING_JSON
PII_BLIND_INDEX_KEY
RATE_LIMIT_HMAC_KEY
BACKUP_ENCRYPTION_KEY
BACKUP_ENCRYPTION_KEYRING_JSON
DIRECT_SECRET_CONTRACT

  [[ -d "$secret_root" && ! -L "$secret_root" ]] || {
    production_secret_error "$secret_root normal bir dizin olmalıdır."
    return 1
  }
  secret_root_mode="$(stat -c '%a' -- "$secret_root")"
  secret_root_owner="$(stat -c '%u' -- "$secret_root")"
  [[ "$secret_root_mode" == "700" || "$secret_root_mode" == "500" ]] || {
    production_secret_error "$secret_root izinleri yalnız 700 veya 500 olabilir."
    return 1
  }
  [[ "$secret_root_owner" == "$expected_owner_id" ]] || {
    production_secret_error "$secret_root dağıtım kullanıcısına ait olmalıdır."
    return 1
  }

  while IFS=: read -r variable_name expected_filename; do
    [[ -n "$variable_name" ]] || continue
    secret_path="$(read_production_environment_value "$environment_file_path" "$variable_name")" || return 1
    [[ "$secret_path" == "$secret_root/$expected_filename" ]] || {
      production_secret_error "$variable_name yalnız sabit production secret dizinindeki beklenen dosyayı gösterebilir."
      return 1
    }
    [[ -f "$secret_path" && ! -L "$secret_path" ]] || {
      production_secret_error "$variable_name normal ve symlink olmayan bir dosya olmalıdır."
      return 1
    }

    secret_mode="$(stat -c '%a' -- "$secret_path")"
    secret_owner="$(stat -c '%u' -- "$secret_path")"
    secret_links="$(stat -c '%h' -- "$secret_path")"
    secret_size="$(stat -c '%s' -- "$secret_path")"
    [[ "$secret_mode" == "600" || "$secret_mode" == "400" ]] || {
      production_secret_error "$variable_name izinleri yalnız 600 veya 400 olabilir."
      return 1
    }
    [[ "$secret_owner" == "$expected_owner_id" ]] || {
      production_secret_error "$variable_name dağıtım kullanıcısına ait olmalıdır."
      return 1
    }
    [[ "$secret_links" == "1" ]] || {
      production_secret_error "$variable_name birden fazla hard link içeremez."
      return 1
    }
    [[ "$secret_size" =~ ^[0-9]+$ ]] && (( secret_size >= 1 && secret_size <= 65536 )) || {
      production_secret_error "$variable_name 1-65536 bayt aralığında olmalıdır."
      return 1
    }
    if od -An -v -tx1 "$secret_path" | grep -Eq '(^|[[:space:]])00([[:space:]]|$)'; then
      production_secret_error "$variable_name NUL baytı içeremez."
      return 1
    fi
  done <<'SECRET_FILE_CONTRACT'
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
SECRET_FILE_CONTRACT
}
