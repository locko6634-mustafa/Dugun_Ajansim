#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
temporary_root="$(mktemp -d)"
trap 'rm -rf -- "$temporary_root"' EXIT

fail_test() {
  printf '%s\n' "Yedek budama testi başarısız: $1" >&2
  exit 1
}

run_default_disabled_test() (
  export DEPLOY_PRODUCTION_LIBRARY_ONLY=1
  source "$repository_root/deploy/deploy-production.sh"
  backup_directory="$temporary_root/default/backups"
  mkdir -p -- "$backup_directory"
  candidate="$backup_directory/pre-deploy-abc1234-20260810T010203Z.dump"
  printf 'plaintext' >"$candidate"
  prune_legacy_plaintext_backups
  [[ -f "$candidate" ]] || fail_test "Varsayılan kapalı durumda dosya silindi."
)

run_enabled_cleanup_test() (
  export DEPLOY_PRODUCTION_LIBRARY_ONLY=1
  export LEGACY_PLAINTEXT_BACKUP_CLEANUP=1
  source "$repository_root/deploy/deploy-production.sh"
  backup_directory="$temporary_root/enabled/backups"
  mkdir -p -- "$backup_directory"

  short_sha="$backup_directory/pre-deploy-abc1234-20260810T010203Z.dump"
  full_sha="$backup_directory/pre-deploy-0123456789abcdef0123456789abcdef01234567-20260810T010203Z.dump"
  old_name="$backup_directory/dugun-ajansim-20260810-010203.dump"
  unexpected="$backup_directory/pre-deploy-abc123-20260810T010203Z.dump"
  printf 'plaintext' >"$short_sha"
  printf 'plaintext' >"$full_sha"
  printf 'plaintext' >"$old_name"
  printf 'keep' >"$unexpected"

  prune_legacy_plaintext_backups
  [[ ! -e "$short_sha" && ! -e "$full_sha" && ! -e "$old_name" ]] ||
    fail_test "Allowlist içindeki legacy dosyalar silinmedi."
  [[ -f "$unexpected" ]] || fail_test "Allowlist dışındaki dosya silindi."

  outside="$temporary_root/pre-deploy-abc1234-20260810T010203Z.dump"
  printf 'outside' >"$outside"
  if safe_remove_legacy_backup "$outside" >/dev/null 2>&1; then
    fail_test "Yedek dizini dışındaki yol kabul edildi."
  fi

  unexpected_direct="$backup_directory/dugun-ajansim-20260810.dump"
  printf 'unexpected' >"$unexpected_direct"
  if safe_remove_legacy_backup "$unexpected_direct" >/dev/null 2>&1; then
    fail_test "Beklenmeyen dosya adı kabul edildi."
  fi

  link_target="$temporary_root/link-target.dump"
  link_path="$backup_directory/pre-deploy-abc1234-20260811T010203Z.dump"
  printf 'target' >"$link_target"
  ln -s "$link_target" "$link_path"
  if [[ -L "$link_path" ]]; then
    if safe_remove_legacy_backup "$link_path" >/dev/null 2>&1; then
      fail_test "Sembolik bağlantı kabul edildi."
    fi
    [[ -f "$link_target" ]] || fail_test "Sembolik bağlantı hedefi değiştirildi."
  else
    # Windows Git Bash, geliştirici modu kapalıyken ln -s yerine normal dosya oluşturabilir.
    rm -f -- "$link_path"
  fi
)

run_default_disabled_test
run_enabled_cleanup_test
printf '%s\n' "Legacy plaintext yedek budama testleri geçti."
