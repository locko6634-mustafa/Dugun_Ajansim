#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly environment_file=".env.production"
readonly compose_file="compose.production.yaml"
readonly backend_replicas="${BACKEND_REPLICAS:-2}"
readonly recovery_timeout_seconds="${WATCHDOG_RECOVERY_TIMEOUT_SECONDS:-90}"

fail() {
  printf '%s\n' "Watchdog güvenlik kontrolü başarısız: $1" >&2
  exit 1
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

for required_command in chmod curl docker flock git grep id mkdir stat; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command komutu bulunamadı."
done

require_integer_range "BACKEND_REPLICAS" "$backend_replicas" 2 8
require_integer_range "WATCHDOG_RECOVERY_TIMEOUT_SECONDS" "$recovery_timeout_seconds" 30 300
[[ "${PUBLIC_ORIGIN:-}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] ||
  fail "PUBLIC_ORIGIN yalnızca güvenli HTTPS origin olmalıdır."

repository_root="$(git rev-parse --show-toplevel)"
[[ "$(pwd -P)" == "$(cd "$repository_root" && pwd -P)" ]] ||
  fail "Betik proje kökünden çalıştırılmalıdır."
[[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
  fail "Kirli veya izlenmeyen çalışma ağacında otomatik onarım yapılmaz."
[[ -f "$environment_file" && ! -L "$environment_file" ]] ||
  fail "$environment_file normal bir dosya olmalıdır."

environment_mode="$(stat -c '%a' "$environment_file")"
environment_owner="$(stat -c '%u' "$environment_file")"
current_user_id="$(id -u)"
[[ "$environment_mode" == "600" || "$environment_mode" == "400" ]] ||
  fail "$environment_file izinleri yalnız 600 veya 400 olabilir."
[[ "$environment_owner" == "$current_user_id" ]] ||
  fail "$environment_file watchdog kullanıcısına ait olmalıdır."

backup_directory="$repository_root/backups"
[[ ! -L "$backup_directory" ]] || fail "Yedek dizini sembolik bağlantı olamaz."
mkdir -p -- "$backup_directory"
[[ "$(cd "$backup_directory" && pwd -P)" == "$repository_root/backups" ]] ||
  fail "Yedek dizini proje kökü dışında çözümlendi."
[[ "$(stat -c '%u' "$backup_directory")" == "$current_user_id" ]] ||
  fail "Yedek dizini watchdog kullanıcısına ait olmalıdır."

operations_lock_path="$backup_directory/.operations.lock"
[[ ! -L "$operations_lock_path" ]] || fail "Operasyon kilidi sembolik bağlantı olamaz."
exec 9>"$operations_lock_path"
chmod 600 "$operations_lock_path"
flock -n 9 || fail "Başka bir dağıtım, yedekleme veya watchdog işlemi devam ediyor."

compose=(docker compose --env-file "$environment_file" -f "$compose_file")
"${compose[@]}" config -q

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$1"
}

service_container_ids() {
  "${compose[@]}" ps --all -q "$1"
}

reconcile_service() {
  local service="$1"
  local expected_count="$2"
  local output
  local -a container_ids=()
  local container_id
  local health_status
  local needs_reconcile=0

  output="$(service_container_ids "$service")"
  if [[ -n "$output" ]]; then
    mapfile -t container_ids <<<"$output"
  fi
  if (( ${#container_ids[@]} != expected_count )); then
    needs_reconcile=1
  fi

  for container_id in "${container_ids[@]}"; do
    health_status="$(container_health "$container_id")"
    if [[ "$health_status" != "healthy" ]]; then
      needs_reconcile=1
      printf 'WATCHDOG_RESTART=%s:%s:%s\n' "$service" "$container_id" "$health_status"
      docker restart "$container_id" >/dev/null
    fi
  done

  if (( needs_reconcile == 1 )); then
    if [[ "$service" == "backend" ]]; then
      "${compose[@]}" up -d --no-deps --wait --wait-timeout "$recovery_timeout_seconds" \
        --scale backend="$backend_replicas" backend
    else
      "${compose[@]}" up -d --no-deps --wait --wait-timeout "$recovery_timeout_seconds" frontend
    fi
  fi

  output="$(service_container_ids "$service")"
  [[ -n "$output" ]] || fail "$service konteyneri bulunamadı."
  mapfile -t container_ids <<<"$output"
  (( ${#container_ids[@]} == expected_count )) ||
    fail "$service replika sayısı beklenen değerle eşleşmiyor."
  for container_id in "${container_ids[@]}"; do
    [[ "$(container_health "$container_id")" == "healthy" ]] ||
      fail "$service konteyneri onarım sonrasında sağlıklı değil."
  done
}

postgres_output="$(service_container_ids postgres)"
[[ -n "$postgres_output" ]] || fail "PostgreSQL konteyneri bulunamadı; otomatik veri katmanı onarımı yapılmadı."
mapfile -t postgres_ids <<<"$postgres_output"
(( ${#postgres_ids[@]} == 1 )) || fail "Beklenmeyen PostgreSQL konteyner sayısı."
[[ "$(container_health "${postgres_ids[0]}")" == "healthy" ]] ||
  fail "PostgreSQL sağlıksız; veri katmanı otomatik yeniden başlatılmadı."

reconcile_service backend "$backend_replicas"
reconcile_service frontend 1

curl -fsS --max-time 10 --retry 2 --retry-delay 2 --retry-all-errors \
  "$PUBLIC_ORIGIN/healthz" | grep -qx ok
curl -fsS --max-time 10 --retry 2 --retry-delay 2 --retry-all-errors \
  "$PUBLIC_ORIGIN/api/v1/health" >/dev/null

printf 'WATCHDOG_OK=1\n'
