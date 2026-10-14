#!/usr/bin/env bash

# Sunucu Baslatici (Frontend + Backend)
# Linux Bash Surumu

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

echo "Bagimsiz Frontend ve Backend sunuculari tetikleniyor..."
"$SCRIPT_DIR/sunucu_baslat.sh" "$@"
