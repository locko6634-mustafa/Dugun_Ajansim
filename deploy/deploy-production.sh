#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly environment_file=".env.production"
readonly compose_file="compose.production.yaml"
readonly deployment_script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly minimum_backup_reserve_mib="${BACKUP_MIN_FREE_MIB:-1024}"
readonly backup_retention_days="${BACKUP_RETENTION_DAYS:-30}"
readonly backup_max_files="${BACKUP_MAX_FILES:-30}"
readonly pii_maintenance_batch_size="${PII_MAINTENANCE_BATCH_SIZE:-100}"
readonly pii_maintenance_max_batches="${PII_MAINTENANCE_MAX_BATCHES:-1000}"
readonly allow_deploy_without_rollback="${ALLOW_DEPLOY_WITHOUT_ROLLBACK:-0}"
readonly legacy_plaintext_backup_cleanup="${LEGACY_PLAINTEXT_BACKUP_CLEANUP:-0}"
readonly use_file_secrets="${USE_FILE_SECRETS:-1}"
readonly backend_replicas="${BACKEND_REPLICAS:-2}"
readonly operation="${1:-deploy}"

source "$deployment_script_directory/validate-production-secrets.sh"
source "$deployment_script_directory/public-health.sh"

backup_only=0
case "$operation" in
  deploy) ;;
  --backup-only) backup_only=1 ;;
  *)
    printf '%s\n' "Kullanım: deploy-production.sh [--backup-only]" >&2
    exit 2
    ;;
esac

deploy_started=0
deployment_verified=0
rollback_window_closed=0
rollback_in_progress=0
rollback_available=1
restore_database=""
restore_database_created=0
temporary_backup_path=""
backend_original_image=""
frontend_original_image=""
backup_path=""
migration_state_before=""
source_migration_state=""
source_table_count=""
restore_log_path=""
maintenance_backend_container=""

log() {
  printf '%s\n' "$1"
}

fail() {
  printf '%s\n' "Dağıtım güvenlik kontrolü başarısız: $1" >&2
  return 1
}

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

is_sha256() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]]
}

is_unsigned_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

require_integer_range() {
  local name="$1"
  local value="$2"
  local minimum="$3"
  local maximum="$4"

  is_unsigned_integer "$value" || fail "$name pozitif tam sayı olmalıdır."
  (( value >= minimum && value <= maximum )) ||
    fail "$name $minimum-$maximum aralığında olmalıdır."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 komutu sunucuda bulunamadı."
}

postgres_owner_exec() {
  local -a compose_exec_options=()
  while [[ "$#" -gt 0 && "$1" != "--" ]]; do
    compose_exec_options+=("$1")
    shift
  done
  [[ "${1:-}" == "--" ]] || fail "PostgreSQL komut ayırıcısı eksik."
  shift
  [[ "$#" -gt 0 ]] || fail "PostgreSQL komutu eksik."

  if [[ "$use_file_secrets" == "1" ]]; then
    "${compose[@]}" exec -T "${compose_exec_options[@]}" postgres \
      sh /usr/local/bin/with-owner-password.sh "$@"
  else
    "${compose[@]}" exec -T "${compose_exec_options[@]}" postgres sh -eu -c \
      'PGPASSWORD="$POSTGRES_PASSWORD"; export PGPASSWORD; exec "$@"' sh "$@"
  fi
}

set_rls_enforcement() {
  local next_state="$1"
  [[ "$next_state" == "true" || "$next_state" == "false" ]] ||
    fail "RLS enforcement durumu yalnız true veya false olabilir."
  if [[ "$next_state" == "true" ]]; then
    postgres_owner_exec -- sh -eu -c \
      'psql -X --quiet --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="SELECT public.set_rls_enforcement(TRUE)" >/dev/null; result="$(psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="SELECT public.app_rls_is_enforced()")"; [ "$result" = "t" ]'
  else
    postgres_owner_exec -- sh -eu -c \
      'psql -X --quiet --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="SELECT public.set_rls_enforcement(FALSE)" >/dev/null; result="$(psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="SELECT public.app_rls_is_enforced()")"; [ "$result" = "f" ]'
  fi
}

enable_data_encryption_enforcement() {
  postgres_owner_exec -- sh -eu -c \
    'result="$(psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="SELECT public.enable_data_encryption_enforcement()")"; [ "$result" = "t" ]'
}

cleanup_maintenance_backend() {
  if [[ -n "$maintenance_backend_container" ]]; then
    docker rm -f "$maintenance_backend_container" >/dev/null 2>&1 || true
    maintenance_backend_container=""
  fi
}

verify_maintenance_backend() {
  local attempt
  [[ -n "$maintenance_backend_container" ]] || fail "Bakım backend konteyneri eksik."
  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if docker exec "$maintenance_backend_container" node -e \
      "fetch('http://127.0.0.1:5000/api/v1/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));" \
      >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "Dış trafiğe kapalı bakım backend'i sağlık kontrolünü geçemedi."
}

drop_restore_database() {
  if [[ -z "$restore_database" || "$restore_database_created" -ne 1 ]]; then
    return
  fi

  if ! postgres_owner_exec -e RESTORE_DATABASE="$restore_database" -- sh -eu -c \
    'exec dropdb --if-exists --force --username="$POSTGRES_USER" "$RESTORE_DATABASE"' \
    >/dev/null 2>&1; then
    return 1
  fi
  restore_database=""
  restore_database_created=0
}

cleanup_temporary_files() {
  if [[ -n "$temporary_backup_path" && -f "$temporary_backup_path" ]]; then
    rm -f -- "$temporary_backup_path"
  fi
  temporary_backup_path=""
  cleanup_maintenance_backend
}

restore_image_reference() {
  local rollback_image="$1"
  local original_image="$2"

  if [[ -z "$original_image" ]]; then
    return 1
  fi
  docker image inspect "$rollback_image" >/dev/null 2>&1 || return 1
  docker image tag "$rollback_image" "$original_image" >/dev/null
}

capture_migration_state_hash() {
  local database_name="${1:-}"
  local migration_rows

  migration_rows="$(
    postgres_owner_exec -e MIGRATION_DATABASE="$database_name" -- sh -eu -c \
      'database_name="${MIGRATION_DATABASE:-$POSTGRES_DB}"; exec psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$database_name" --command="SELECT concat(migration_name, chr(58), checksum) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"'
  )" || return 1

  printf '%s' "$migration_rows" | sha256sum | awk '{print $1}'
}

rollback_deployment() {
  local rollback_failed=0
  local database_forward_only=0
  local rollback_sha="${PREVIOUS_SHA:-}"

  if (( rollback_in_progress == 1 )); then
    return
  fi
  rollback_in_progress=1

  if (( deployment_verified == 1 )); then
    printf '%s\n' "Dağıtım sağlık kontrollerini geçti; sonrasındaki operasyon hatası için çalışan sürüm geri alınmayacak." >&2
    return
  fi

  if (( rollback_window_closed == 1 )); then
    printf '%s\n' "ROLLBACK_BLOCKED_FORWARD_ONLY=1" >&2
    printf '%s\n' "MAINTENANCE_OUTAGE=1" >&2
    printf '%s\n' "Veri dönüşümü başladı; eski image veri sözleşmesiyle uyumsuz olduğu için otomatik rollback engellendi. Dış trafik kapalı tutuluyor ve operatör müdahalesi gerekiyor." >&2
    if [[ -n "$backup_path" ]]; then
      printf 'ROLLBACK_BACKUP=%s\n' "$backup_path" >&2
    fi
    return
  fi

  if ! is_sha "$rollback_sha" || ! command -v git >/dev/null 2>&1; then
    printf '%s\n' "Geçerli PREVIOUS_SHA bulunmadığı için otomatik rollback başlatılamadı." >&2
    return
  fi

  log "ROLLBACK_STARTED_SHA=$rollback_sha"
  if (( deploy_started == 1 )) && ! set_rls_enforcement false; then
    printf '%s\n' "RLS enforcement kapatılamadığı için eski backend rollback'i güvenli biçimde başlatılamadı." >&2
    return
  fi
  git reset --hard "$rollback_sha" >/dev/null || rollback_failed=1

  if (( deploy_started == 1 )); then
    if (( rollback_available == 0 )); then
      printf '%s\n' "Önceki backend/frontend image seti bulunamadı; otomatik image rollback yapılamadı." >&2
      rollback_failed=1
    else
      restore_image_reference "dugun-ajansim-rollback-backend:previous" "$backend_original_image" ||
        rollback_failed=1
      restore_image_reference "dugun-ajansim-rollback-frontend:previous" "$frontend_original_image" ||
        rollback_failed=1

      local rollback_compose=(
        docker compose --env-file "$environment_file" -f "$compose_file" -f compose.production.secrets.yaml
      )
      "${rollback_compose[@]}" config -q || rollback_failed=1
      "${rollback_compose[@]}" up -d --no-build --force-recreate --no-deps --wait postgres ||
        rollback_failed=1
      "${rollback_compose[@]}" up -d --no-build --force-recreate --no-deps --wait \
        --scale backend="$backend_replicas" backend ||
        rollback_failed=1
      "${rollback_compose[@]}" up -d --no-build --force-recreate --no-deps --wait frontend ||
        rollback_failed=1

      "${rollback_compose[@]}" exec -T backend node -e \
        "fetch('http://127.0.0.1:5000/api/v1/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));" ||
        rollback_failed=1
      "${rollback_compose[@]}" exec -T frontend sh -c \
        "wget -qO- http://127.0.0.1:8080/healthz | grep -qx ok" || rollback_failed=1

      local migration_state_after=""
      migration_state_after="$(capture_migration_state_hash)" || rollback_failed=1
      if [[ -n "$migration_state_before" && "$migration_state_after" != "$migration_state_before" ]]; then
        database_forward_only=1
        rollback_failed=1
      fi
    fi
  fi

  if (( rollback_failed == 0 )); then
    log "ROLLBACK_COMPLETED_SHA=$rollback_sha"
  else
    if (( database_forward_only == 1 )); then
      printf '%s\n' "ROLLBACK_PARTIAL_DATABASE_FORWARD_ONLY=1" >&2
    fi
    printf '%s\n' "Otomatik rollback tamamlanamadı; şifreli yedek ve operatör müdahalesi gereklidir." >&2
    if [[ -n "$backup_path" ]]; then
      printf 'ROLLBACK_BACKUP=%s\n' "$backup_path" >&2
    fi
  fi
}

handle_signal() {
  local exit_code="$1"
  trap - HUP INT TERM
  handle_error "$exit_code"
}

handle_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  drop_restore_database || true
  cleanup_temporary_files
  if (( backup_only == 0 )); then
    rollback_deployment
  fi
  exit "$exit_code"
}

safe_remove_backup() {
  local candidate="$1"
  local filename="${candidate##*/}"

  if [[ "${candidate%/*}" != "$backup_directory" ||
    ! "$filename" =~ ^(pre-deploy-[0-9a-f]{40}|scheduled)-[0-9]{8}T[0-9]{6}Z\.dump\.gcm$ ]]; then
    fail "Beklenmeyen yedek yolu silme kapsamına girdi: $candidate"
    return 1
  fi
  if [[ "$candidate" == "$backup_path" ]]; then
    fail "Yeni doğrulanmış yedek budanamaz."
    return 1
  fi
  if [[ -L "$candidate" ]]; then
    fail "Yedek sembolik bağlantı olarak budanamaz."
    return 1
  fi
  if [[ -f "$candidate" ]]; then
    rm -f -- "$candidate"
    printf 'PRUNED_BACKUP=%s\n' "$candidate"
  fi
}

safe_remove_legacy_backup() {
  local candidate="$1"
  local filename="${candidate##*/}"

  if [[ "${candidate%/*}" != "$backup_directory" ||
    ! "$filename" =~ ^(pre-deploy-[0-9a-f]{7,40}-[0-9]{8}T[0-9]{6}Z|dugun-ajansim-[0-9]{8}-[0-9]{6})\.dump$ ]]; then
    fail "Beklenmeyen eski yedek yolu silme kapsamına girdi: $candidate"
    return 1
  fi
  if [[ -L "$candidate" ]]; then
    fail "Eski yedek sembolik bağlantı olarak budanamaz."
    return 1
  fi
  if [[ ! -f "$candidate" ]]; then
    fail "Eski yedek normal bir dosya olmalıdır: $candidate"
    return 1
  fi
  rm -f -- "$candidate"
  printf 'PRUNED_LEGACY_PLAINTEXT_BACKUP=%s\n' "$candidate"
}

prune_legacy_plaintext_backups() {
  local backup_listing
  local candidate
  local legacy_filename_pattern='.*/(pre-deploy-[0-9a-f]{7,40}-[0-9]{8}T[0-9]{6}Z|dugun-ajansim-[0-9]{8}-[0-9]{6})\.dump'

  if [[ "$legacy_plaintext_backup_cleanup" != "1" ]]; then
    log "LEGACY_PLAINTEXT_BACKUP_CLEANUP_DISABLED=1"
    return
  fi

  backup_listing="$(
    find "$backup_directory" -mindepth 1 -maxdepth 1 -regextype posix-extended -type f \
      -regex "$legacy_filename_pattern" -print
  )" || fail "Eski düz metin yedekleri listelenemedi."
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] && safe_remove_legacy_backup "$candidate"
  done <<<"$backup_listing"
}

prune_backups() {
  local backup_listing
  local candidate
  local filename_pattern='.*/(pre-deploy-[0-9a-f]{40}|scheduled)-[0-9]{8}T[0-9]{6}Z\.dump'

  prune_legacy_plaintext_backups

  backup_listing="$(
    find "$backup_directory" -mindepth 1 -maxdepth 1 -regextype posix-extended -type f \
      -regex "${filename_pattern}\.gcm" -mtime "+$backup_retention_days" -print
  )" || fail "Süresi dolan şifreli yedekler listelenemedi."
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] && safe_remove_backup "$candidate"
  done <<<"$backup_listing"

  backup_listing="$(
    find "$backup_directory" -mindepth 1 -maxdepth 1 -regextype posix-extended -type f \
      -regex "${filename_pattern}\.gcm" -printf '%T@ %p\n' | sort -nr
  )" || fail "Şifreli yedekler sıralanamadı."

  local retained_other_backups=0
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    candidate="${candidate#* }"
    if [[ "$candidate" == "$backup_path" ]]; then
      continue
    fi
    if (( retained_other_backups < backup_max_files - 1 )); then
      retained_other_backups=$((retained_other_backups + 1))
    else
      safe_remove_backup "$candidate"
    fi
  done <<<"$backup_listing"
}

capture_rollback_image() {
  local service="$1"
  local container_output
  local -a container_ids=()
  local container_id
  local health_status
  local image_id
  local image_revision
  local original_image
  local expected_image_id=""
  local expected_original_image=""

  container_output="$("${compose[@]}" ps -q "$service")"
  if [[ -z "$container_output" ]]; then
    rollback_available=0
    return
  fi
  mapfile -t container_ids <<<"$container_output"

  for container_id in "${container_ids[@]}"; do
    health_status="$(
      docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container_id"
    )"
    image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
    original_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
    image_revision="$(
      docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$container_id"
    )"
    if [[ "$health_status" != "healthy" || -z "$image_id" || -z "$original_image" ||
      "$image_revision" != "${PREVIOUS_SHA:-}" ||
      ( -n "$expected_image_id" && "$image_id" != "$expected_image_id" ) ]]; then
      rollback_available=0
      return
    fi
    expected_image_id="$image_id"
    expected_original_image="$original_image"
  done

  docker image tag "$expected_image_id" "dugun-ajansim-rollback-${service}:previous" >/dev/null
  if [[ "$service" == "backend" ]]; then
    backend_original_image="$expected_original_image"
  else
    frontend_original_image="$expected_original_image"
  fi
}

verify_backend_replicas() {
  local container_output
  local -a container_ids=()
  local container_id

  container_output="$("${compose[@]}" ps -q backend)"
  [[ -n "$container_output" ]] || fail "Çalışan backend konteyneri bulunamadı."
  mapfile -t container_ids <<<"$container_output"
  [[ "${#container_ids[@]}" == "$backend_replicas" ]] ||
    fail "Backend replika sayısı beklenen değerle eşleşmiyor."
  for container_id in "${container_ids[@]}"; do
    docker exec "$container_id" node -e \
      "fetch('http://127.0.0.1:5000/api/v1/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"
  done
}

if [[ "${DEPLOY_PRODUCTION_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

trap 'handle_error "$?"' ERR
trap 'drop_restore_database || true; cleanup_temporary_files' EXIT
trap 'handle_signal 129' HUP
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

for required_command in awk chmod curl date df dirname docker find flock git grep id mkdir mv od rm sha256sum sleep sort stat tr; do
  require_command "$required_command"
done

is_sha "${DEPLOY_SHA:-}" || fail "DEPLOY_SHA 40 karakterlik küçük harf SHA olmalıdır."
if (( backup_only == 0 )); then
  is_sha "${PREVIOUS_SHA:-}" || fail "PREVIOUS_SHA 40 karakterlik küçük harf SHA olmalıdır."
  validate_public_healthcheck_configuration
fi
require_integer_range "BACKUP_MIN_FREE_MIB" "$minimum_backup_reserve_mib" 256 1048576
require_integer_range "BACKUP_RETENTION_DAYS" "$backup_retention_days" 1 3650
require_integer_range "BACKUP_MAX_FILES" "$backup_max_files" 2 1000
require_integer_range "PII_MAINTENANCE_BATCH_SIZE" "$pii_maintenance_batch_size" 50 100
require_integer_range "PII_MAINTENANCE_MAX_BATCHES" "$pii_maintenance_max_batches" 1 10000
require_integer_range "BACKEND_REPLICAS" "$backend_replicas" 2 8
[[ "$allow_deploy_without_rollback" == "0" || "$allow_deploy_without_rollback" == "1" ]] ||
  fail "ALLOW_DEPLOY_WITHOUT_ROLLBACK yalnızca 0 veya 1 olabilir."
[[ "$legacy_plaintext_backup_cleanup" == "0" || "$legacy_plaintext_backup_cleanup" == "1" ]] ||
  fail "LEGACY_PLAINTEXT_BACKUP_CLEANUP yalnızca 0 veya 1 olabilir."
[[ "$use_file_secrets" == "1" ]] ||
  fail "Production dağıtımı USE_FILE_SECRETS=1 olmadan çalıştırılamaz."

repository_root="$(git rev-parse --show-toplevel)"
[[ "$(pwd -P)" == "$(cd "$repository_root" && pwd -P)" ]] ||
  fail "Betik proje kökünden çalıştırılmalıdır."
[[ "$(git rev-parse HEAD)" == "$DEPLOY_SHA" ]] || fail "Çalışma ağacı DEPLOY_SHA üzerinde değil."
if (( backup_only == 0 )); then
  git cat-file -e "${PREVIOUS_SHA}^{commit}" ||
    fail "PREVIOUS_SHA yerel Git nesnelerinde bulunamadı."
fi
worktree_status="$(git status --porcelain --untracked-files=all)"
[[ -z "$worktree_status" ]] ||
  fail "İzlenen veya izlenmeyen proje dosyaları mevcut; yalnız temiz Git ağacı dağıtılabilir."
[[ -f "$compose_file" ]] || fail "$compose_file bulunamadı."
[[ -f "$environment_file" && ! -L "$environment_file" ]] ||
  fail "$environment_file normal bir dosya olmalıdır."

environment_mode="$(stat -c '%a' "$environment_file")"
environment_owner="$(stat -c '%u' "$environment_file")"
current_user_id="$(id -u)"
[[ "$environment_mode" == "600" || "$environment_mode" == "400" ]] ||
  fail "$environment_file izinleri yalnız 600 veya 400 olabilir; mevcut: $environment_mode"
[[ "$environment_owner" == "$current_user_id" ]] ||
  fail "$environment_file dağıtım kullanıcısına ait olmalıdır."
validate_production_secret_sources "$environment_file" "$current_user_id" ||
  fail "File-backed production secret kaynakları doğrulanamadı."

[[ -f "compose.production.secrets.yaml" && ! -L "compose.production.secrets.yaml" ]] ||
  fail "File-backed secret overlay normal bir dosya olmalıdır."
compose=(
  docker compose --env-file "$environment_file" -f "$compose_file" -f compose.production.secrets.yaml
)
"${compose[@]}" config -q

backup_directory="$repository_root/backups"
[[ ! -L "$backup_directory" ]] || fail "Yedek dizini sembolik bağlantı olamaz."
[[ ! -e "$backup_directory" || -d "$backup_directory" ]] ||
  fail "Yedek yolu normal bir dizin olmalıdır."
mkdir -p -- "$backup_directory"
[[ "$(cd "$backup_directory" && pwd -P)" == "$repository_root/backups" ]] ||
  fail "Yedek dizini proje kökü dışında çözümlendi."
chmod 700 "$backup_directory"
[[ "$(stat -c '%u' "$backup_directory")" == "$current_user_id" ]] ||
  fail "Yedek dizini dağıtım kullanıcısına ait olmalıdır."

operations_lock_path="$backup_directory/.operations.lock"
[[ ! -L "$operations_lock_path" ]] || fail "Operasyon kilidi sembolik bağlantı olamaz."
exec 9>"$operations_lock_path"
chmod 600 "$operations_lock_path"
flock -n 9 || fail "Başka bir dağıtım veya yedekleme işlemi devam ediyor."

if (( backup_only == 0 )); then
  capture_rollback_image backend
  capture_rollback_image frontend
fi

if (( backup_only == 0 && rollback_available == 0 )); then
  (( allow_deploy_without_rollback == 1 )) ||
    fail "Sağlıklı ve PREVIOUS_SHA ile eşleşen önceki backend/frontend image seti bulunamadı. İlk kurulumda açık ALLOW_DEPLOY_WITHOUT_ROLLBACK=1 onayı gerekir."
  log "ROLLBACK_UNAVAILABLE_EXPLICITLY_ACCEPTED=1"
fi

source_migration_state="$(capture_migration_state_hash)" ||
  fail "Dağıtım öncesi migration durumu alınamadı."
is_sha256 "$source_migration_state" || fail "Migration durum hash'i geçersiz."
if (( rollback_available == 1 )); then
  migration_state_before="$source_migration_state"
fi

"${compose[@]}" --profile operations build backup-crypto
"${compose[@]}" --profile operations run --rm --no-deps -T backup-crypto validate

database_bytes="$(
  postgres_owner_exec -- sh -eu -c \
    'exec psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="SELECT pg_database_size(current_database())"'
)"
database_bytes="$(printf '%s' "$database_bytes" | tr -d '[:space:]')"
is_unsigned_integer "$database_bytes" || fail "Veritabanı boyutu ölçülemedi."

source_table_count="$(
  postgres_owner_exec -- sh -eu -c \
    'exec psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = chr(112) || chr(117) || chr(98) || chr(108) || chr(105) || chr(99)"'
)"
source_table_count="$(printf '%s' "$source_table_count" | tr -d '[:space:]')"
is_unsigned_integer "$source_table_count" || fail "Kaynak tablo sayısı doğrulanamadı."
(( source_table_count > 0 )) || fail "Kaynak veritabanında public tablo bulunamadı."

host_free_bytes="$(df -Pk "$backup_directory" | awk 'NR == 2 { printf "%.0f", $4 * 1024 }')"
postgres_free_bytes="$(
  "${compose[@]}" exec -T postgres sh -eu -c \
    'df -Pk "$PGDATA" | awk '\''NR == 2 { printf "%.0f", $4 * 1024 }'\'''
)"
host_free_bytes="$(printf '%s' "$host_free_bytes" | tr -d '[:space:]')"
postgres_free_bytes="$(printf '%s' "$postgres_free_bytes" | tr -d '[:space:]')"
is_unsigned_integer "$host_free_bytes" || fail "Host yedek disk alanı ölçülemedi."
is_unsigned_integer "$postgres_free_bytes" || fail "PostgreSQL disk alanı ölçülemedi."

minimum_reserve_bytes=$((minimum_backup_reserve_mib * 1024 * 1024))
required_host_bytes=$((database_bytes + minimum_reserve_bytes))
required_postgres_bytes=$((database_bytes * 2 + minimum_reserve_bytes))
(( host_free_bytes >= required_host_bytes )) ||
  fail "Şifreli yedek için host disk alanı yetersiz."
(( postgres_free_bytes >= required_postgres_bytes )) ||
  fail "Geçici restore tatbikatı için PostgreSQL disk alanı yetersiz."

backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_prefix="pre-deploy-${DEPLOY_SHA}"
if (( backup_only == 1 )); then
  backup_prefix="scheduled"
fi
backup_path="$backup_directory/${backup_prefix}-${backup_timestamp}.dump.gcm"
temporary_backup_path="${backup_path}.tmp"
restore_log_path="$backup_directory/restore-${DEPLOY_SHA}-${backup_timestamp}.log"
[[ ! -e "$backup_path" && ! -e "$temporary_backup_path" ]] ||
  fail "Aynı dağıtım zaman damgasıyla yedek zaten mevcut."
[[ ! -e "$restore_log_path" ]] || fail "Aynı dağıtım için restore hata günlüğü zaten mevcut."

if ! postgres_owner_exec -- sh -eu -c \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-acl' |
  "${compose[@]}" --profile operations run --rm --no-deps -T backup-crypto encrypt >"$temporary_backup_path"; then
  fail "Veritabanı yedeği alınamadı veya şifrelenemedi."
fi
[[ -s "$temporary_backup_path" ]] || fail "Şifreli yedek boş oluşturuldu."
mv -- "$temporary_backup_path" "$backup_path"
temporary_backup_path=""

restore_database="restore_check_${DEPLOY_SHA:0:12}_${RANDOM}"
postgres_owner_exec -e RESTORE_DATABASE="$restore_database" -- sh -eu -c \
  'exec createdb --username="$POSTGRES_USER" "$RESTORE_DATABASE"'
restore_database_created=1

if ! "${compose[@]}" --profile operations run --rm --no-deps -T backup-crypto decrypt <"$backup_path" |
  postgres_owner_exec -e RESTORE_DATABASE="$restore_database" -- sh -eu -c \
    'exec pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE"' \
    2>"$restore_log_path"; then
  fail "Şifreli yedek geçici veritabanına geri yüklenemedi; ayrıntı yalnız yerel $restore_log_path dosyasındadır."
fi

restored_table_count="$(
  postgres_owner_exec -e RESTORE_DATABASE="$restore_database" -- sh -eu -c \
    'exec psql -X --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE" --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = '\''public'\''"'
)"
restored_table_count="$(printf '%s' "$restored_table_count" | tr -d '[:space:]')"
is_unsigned_integer "$restored_table_count" || fail "Restore edilen tablo sayısı doğrulanamadı."
[[ "$restored_table_count" == "$source_table_count" ]] ||
  fail "Restore edilen tablo sayısı kaynakla eşleşmiyor."
restored_migration_state="$(capture_migration_state_hash "$restore_database")" ||
  fail "Restore edilen migration durumu doğrulanamadı."
[[ "$restored_migration_state" == "$source_migration_state" ]] ||
  fail "Restore edilen migration kümesi kaynakla eşleşmiyor."
drop_restore_database
rm -f -- "$restore_log_path"
restore_log_path=""
printf 'VALIDATED_ENCRYPTED_BACKUP=%s\n' "$backup_path"
prune_backups

if (( backup_only == 1 )); then
  "${compose[@]}" --profile operations run --rm --no-deps -T data-retention
  printf 'SCHEDULED_RETENTION_COMPLETED=1\n'
  trap - ERR
  printf 'SCHEDULED_BACKUP_COMPLETED=%s\n' "$backup_path"
  exit 0
fi

run_pii_batches() {
  local pii_operation="$1"
  local output
  local attempt
  local result_status
  local parser_operation="${pii_operation#--}"
  for ((attempt = 1; attempt <= pii_maintenance_max_batches; attempt += 1)); do
    if output="$(
      "${compose[@]}" --profile operations run --rm --no-deps -T pii-maintenance \
        sh -eu -c \
        'output="$(node dist/scripts/maintainPiiEncryption.js "$1" "--batch-size=$2")"; printf "%s\n" "$output"; printf "%s\n" "$output" | node /usr/local/lib/dugun-ajansim/parse-pii-maintenance-result.mjs "$3"' \
        sh "$pii_operation" "$pii_maintenance_batch_size" "$parser_operation"
    )"; then
      log "$output"
      return
    else
      result_status="$?"
      log "$output"
      if [[ "$result_status" == "10" ]]; then
        continue
      fi
      fail "PII bakım çıktısı doğrulanamadı veya işlem başarısız oldu: $pii_operation"
      return 1
    fi
  done
  fail "PII bakım işlemi güvenli parti sınırı içinde tamamlanamadı: $pii_operation"
}

"${compose[@]}" build postgres migrate backend frontend

# Eski sürümün yeni plaintext satırlar yazabileceği pencereyi kapat. Bu noktadan yeni
# backend doğrulanana kadar dış trafik fail-closed kalır; legacy alanlar rollback için korunur.
deploy_started=1
log "MAINTENANCE_TRAFFIC_STOPPING=1"
"${compose[@]}" stop --timeout 30 frontend backend
"${compose[@]}" up -d --no-build --no-deps --wait postgres
"${compose[@]}" run --rm --no-deps -T migrate
"${compose[@]}" run --rm --no-deps -T db-role-bootstrap
"${compose[@]}" run --rm --no-deps -T db-runtime-hardening
log "EXPAND_MIGRATION_COMPLETED=1"

# Veri sözleşmesi değişmeden önce yeni imajın en azından ayağa kalktığını yalnız iç ağda doğrula.
# Normal backend/frontend servisleri durur ve Traefik etiketi kesin olarak kapatılır.
maintenance_backend_name="dugun-ajansim-maintenance-backend-${DEPLOY_SHA:0:12}"
maintenance_backend_container="$(
  "${compose[@]}" run -d --no-deps --use-aliases \
    --name "$maintenance_backend_name" --label traefik.enable=false backend
)"
maintenance_backend_container="$(printf '%s' "$maintenance_backend_container" | tr -d '[:space:]')"
[[ "$maintenance_backend_container" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Bakım backend konteyner kimliği doğrulanamadı."
[[ "$(docker inspect --format '{{ index .Config.Labels "traefik.enable" }}' "$maintenance_backend_container")" == "false" ]] ||
  fail "Bakım backend'i Traefik erişimine kapatılamadı."
verify_maintenance_backend
log "STRICT_BACKEND_INTERNAL_HEALTHY=1"

deployed_sha="$(git rev-parse HEAD)"
[[ "$deployed_sha" == "$DEPLOY_SHA" ]] || fail "Dağıtım sonrasında Git SHA değişti."
rollback_window_closed=1
log "ROLLBACK_WINDOW_CLOSED=1"

# İlk veri dönüşümüyle eski image uyumsuz hale gelir; bu yüzden rollback penceresi yukarıda
# kapatılmıştır. Dış trafik bütün dönüşüm ve enforcement kapıları boyunca kapalı kalır.
run_pii_batches --backfill
"${compose[@]}" --profile operations run --rm --no-deps -T pii-maintenance \
  node dist/scripts/maintainPiiEncryption.js --verify-backfill
verify_maintenance_backend
log "PII_BACKFILL_VERIFIED=1"

# Drain sonrasında oluşabilecek son farkı da dış trafik hâlâ kapalıyken tüket.
run_pii_batches --backfill
"${compose[@]}" --profile operations run --rm --no-deps -T pii-maintenance \
  node dist/scripts/maintainPiiEncryption.js --verify-backfill
log "PII_DELTA_BACKFILL_VERIFIED=1"

# Bu noktadan sonra eski imaja dönüş güvenli değildir; trafik enforcement tamamlanana dek kapalıdır.
run_pii_batches --redact-legacy
"${compose[@]}" --profile operations run --rm --no-deps -T pii-maintenance \
  node dist/scripts/maintainPiiEncryption.js --verify
enable_data_encryption_enforcement
log "DATA_ENCRYPTION_ENFORCEMENT_ENABLED=1"

# Önceki başarısız rollback RLS enforcement'ını kapatmış olabilir; owner bağlamında yeniden aç.
set_rls_enforcement true
verify_maintenance_backend
log "STRICT_BACKEND_ENFORCED_HEALTHY=1"

# Yalnız bütün veri ve RLS enforcement kapıları geçince gerçek edge servislerini aç.
cleanup_maintenance_backend
"${compose[@]}" up -d --no-build --no-deps --wait --scale backend="$backend_replicas" backend
verify_backend_replicas
"${compose[@]}" up -d --no-build --no-deps --wait frontend
"${compose[@]}" exec -T frontend sh -c \
  "wget -qO- http://127.0.0.1:8080/healthz | grep -qx ok"
verify_public_edge_health 10 5 3
deployment_verified=1

"${compose[@]}" --profile operations run --rm --no-deps -T data-retention

trap - ERR
printf 'DEPLOYED_GIT_SHA=%s\n' "$deployed_sha"
