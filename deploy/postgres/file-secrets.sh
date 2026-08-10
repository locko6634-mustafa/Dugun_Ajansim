#!/bin/sh

file_secret_fail() {
  printf '%s\n' "PostgreSQL file-backed secret yüklenemedi: $1" >&2
  return 1
}

load_file_secret() {
  variable_name="$1"
  case "$variable_name" in
    POSTGRES_PASSWORD|POSTGRES_RUNTIME_PASSWORD|PGPASSWORD) ;;
    *) file_secret_fail "Değişken allowlist içinde değil: $variable_name" ; return 1 ;;
  esac

  eval "file_is_set=\${${variable_name}_FILE+x}"
  [ "$file_is_set" = "x" ] || return 0
  [ "${USE_FILE_SECRETS:-0}" = "1" ] ||
    { file_secret_fail "${variable_name}_FILE yalnız USE_FILE_SECRETS=1 ile kullanılabilir."; return 1; }
  eval "direct_is_set=\${${variable_name}+x}"
  [ "$direct_is_set" != "x" ] ||
    { file_secret_fail "$variable_name ile ${variable_name}_FILE aynı anda kullanılamaz."; return 1; }
  eval "file_path=\${${variable_name}_FILE-}"
  [ -n "$file_path" ] || { file_secret_fail "${variable_name}_FILE boş olamaz."; return 1; }
  [ -f "$file_path" ] && [ ! -L "$file_path" ] ||
    { file_secret_fail "${variable_name}_FILE normal ve symlink olmayan dosya olmalıdır."; return 1; }

  file_size="$(wc -c <"$file_path" | tr -d '[:space:]')"
  case "$file_size" in
    ''|*[!0-9]*) file_secret_fail "${variable_name}_FILE boyutu okunamadı." ; return 1 ;;
  esac
  [ "$file_size" -ge 1 ] && [ "$file_size" -le 65536 ] ||
    { file_secret_fail "${variable_name}_FILE 1-65536 bayt aralığında olmalıdır."; return 1; }
  if od -An -v -tx1 "$file_path" | grep -Eq '(^|[[:space:]])00([[:space:]]|$)'; then
    file_secret_fail "${variable_name}_FILE NUL baytı içeremez."
    return 1
  fi
  secret_value="$(cat "$file_path")"
  [ -n "$secret_value" ] ||
    { file_secret_fail "${variable_name}_FILE boş secret içeremez."; return 1; }
  export "$variable_name=$secret_value"
}
