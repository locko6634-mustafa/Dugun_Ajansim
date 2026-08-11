#!/usr/bin/env bash

readonly public_healthcheck_mode="${PUBLIC_HEALTHCHECK_MODE:-strict}"

validate_public_healthcheck_configuration() {
  [[ "${PUBLIC_ORIGIN:-}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] ||
    fail "PUBLIC_ORIGIN yalnızca güvenli HTTPS origin olmalıdır."
  [[ "$public_healthcheck_mode" == "strict" || "$public_healthcheck_mode" == "pre-dns" ]] ||
    fail "PUBLIC_HEALTHCHECK_MODE yalnızca strict veya pre-dns olabilir."
}

verify_public_edge_health() {
  local max_time="$1"
  local retries="$2"
  local retry_delay="$3"
  local authority
  local hostname
  local port="443"
  local -a curl_options=(
    -fsS --max-time "$max_time" --retry "$retries" --retry-delay "$retry_delay" --retry-all-errors
  )

  if [[ "$public_healthcheck_mode" == "pre-dns" ]]; then
    authority="${PUBLIC_ORIGIN#https://}"
    hostname="${authority%%:*}"
    if [[ "$authority" == *:* ]]; then
      port="${authority##*:}"
    fi
    curl "${curl_options[@]}" --insecure --resolve "$hostname:$port:127.0.0.1" \
      "$PUBLIC_ORIGIN/healthz" | grep -qx ok
    curl "${curl_options[@]}" --insecure --resolve "$hostname:$port:127.0.0.1" \
      "$PUBLIC_ORIGIN/api/v1/health" >/dev/null
    printf 'PRE_DNS_EDGE_HEALTHY=1\n'
    return
  fi

  curl "${curl_options[@]}" "$PUBLIC_ORIGIN/healthz" | grep -qx ok
  curl "${curl_options[@]}" "$PUBLIC_ORIGIN/api/v1/health" >/dev/null
  printf 'PUBLIC_TRAFFIC_HEALTHY=1\n'
}
