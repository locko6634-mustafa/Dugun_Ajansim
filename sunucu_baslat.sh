#!/usr/bin/env bash

# Bağımsız Sunucu Başlatıcı (Frontend + Backend)
# Linux Sürümü (systemd --user / nohup destekli)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
FRONTEND_DIR="$SCRIPT_DIR"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_PORT=8000
BACKEND_PORT=5000

RUN_DIR="$SCRIPT_DIR/.run"
mkdir -p "$RUN_DIR"
FE_PID_FILE="$RUN_DIR/frontend.pid"
BE_PID_FILE="$RUN_DIR/backend.pid"
FE_LOG_FILE="$SCRIPT_DIR/frontend.log"
BE_LOG_FILE="$SCRIPT_DIR/backend.log"

FE_SERVICE_NAME="dugun-frontend"
BE_SERVICE_NAME="dugun-backend"

# Renkler
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

has_systemd_user() {
  command -v systemd-run >/dev/null 2>&1 && systemctl --user is-system-running >/dev/null 2>&1
}

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tlpn 2>/dev/null | grep -qE ":${port}\b"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -i ":${port}" >/dev/null 2>&1
  else
    return 1
  fi
}

get_port_pid() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${port}" 2>/dev/null | head -n 1
  elif command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | awk '{print $1}'
  fi
}

is_process_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_server() {
  local service_name="$1"
  local pid_file="$2"
  local port="$3"
  local display_name="$4"
  local stopped=0

  # 1. systemd servisi olarak çalışıyorsa durdur
  if has_systemd_user; then
    if systemctl --user is-active --quiet "${service_name}.service" 2>/dev/null; then
      echo -e "${YELLOW}$display_name (systemd servisi) durduruluyor...${NC}"
      systemctl --user stop "${service_name}.service" 2>/dev/null || true
      systemctl --user reset-failed "${service_name}.service" 2>/dev/null || true
      stopped=1
    fi
  fi

  # 2. PID dosyasındaki süreci durdur
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if [ -n "$pid" ] && is_process_running "$pid"; then
      echo -e "${YELLOW}$display_name durduruluyor (PID: $pid)...${NC}"
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true

      for _ in {1..20}; do
        if ! is_process_running "$pid"; then
          break
        fi
        sleep 0.1
      done

      if is_process_running "$pid"; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      stopped=1
    fi
    rm -f "$pid_file"
  fi

  # 3. Port hala meşgulse fuser / lsof ile kalan süreçleri temizle
  if is_port_in_use "$port"; then
    local port_pid
    port_pid=$(get_port_pid "$port")
    if [ -n "$port_pid" ]; then
      echo -e "${YELLOW}Port $port üzerindeki artık süreç temizleniyor (PID: $port_pid)...${NC}"
      pkill -P "$port_pid" 2>/dev/null || true
      kill -9 "$port_pid" 2>/dev/null || true
      stopped=1
    fi
  fi

  if [ "$stopped" -eq 1 ]; then
    echo -e "${GREEN}-> $display_name durduruldu.${NC}"
  else
    echo -e "${YELLOW}-> $display_name zaten çalışmıyor.${NC}"
  fi
}

start_frontend() {
  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}Hata: Guvenli frontend sunucusu icin Node.js 22+ gereklidir.${NC}" >&2
    exit 1
  fi

  local node_version
  node_version=$(node -v 2>/dev/null || echo "v0")
  local node_major
  node_major=$(echo "$node_version" | sed 's/^v//' | cut -d'.' -f1)
  if [ "$node_major" -lt 22 ]; then
    echo -e "${YELLOW}Uyari: Mevcut Node.js surumu ($node_version). Guvenli calisma icin Node.js 22+ onerilir.${NC}"
  fi

  if is_port_in_use "$FRONTEND_PORT"; then
    local current_pid
    current_pid=$(get_port_pid "$FRONTEND_PORT")
    echo -e "${YELLOW}Uyari: Frontend portu ($FRONTEND_PORT) zaten kullanımda! (PID: ${current_pid:-bilinmiyor})${NC}"
    echo -e "${YELLOW}Yeniden baslatmak icin: $0 restart${NC}"
    return 0
  fi

  echo -e "${CYAN}Frontend sunucusu (Port $FRONTEND_PORT) baslatiliyor...${NC}"

  local fe_pid=""
  if has_systemd_user; then
    systemctl --user stop "${FE_SERVICE_NAME}.service" 2>/dev/null || true
    systemctl --user reset-failed "${FE_SERVICE_NAME}.service" 2>/dev/null || true
    systemd-run --user \
      --unit="$FE_SERVICE_NAME" \
      --description="Dugun Ajansim Frontend Sunucusu" \
      --working-directory="$FRONTEND_DIR" \
      --property=StandardOutput=append:"$FE_LOG_FILE" \
      --property=StandardError=append:"$FE_LOG_FILE" \
      node "$FRONTEND_DIR/tools/serve.mjs" "$FRONTEND_PORT" 127.0.0.1 >/dev/null 2>&1

    sleep 0.5
    fe_pid=$(systemctl --user show "${FE_SERVICE_NAME}.service" --property=MainPID --value 2>/dev/null || true)
  fi

  if [ -z "$fe_pid" ] || [ "$fe_pid" = "0" ]; then
    nohup node "$FRONTEND_DIR/tools/serve.mjs" "$FRONTEND_PORT" 127.0.0.1 </dev/null >> "$FE_LOG_FILE" 2>&1 &
    fe_pid=$!
  fi

  echo "$fe_pid" > "$FE_PID_FILE"

  sleep 0.5
  if is_port_in_use "$FRONTEND_PORT" || is_process_running "$fe_pid"; then
    echo -e "${GREEN}-> Frontend basariyla baslatildi! PID: ${fe_pid:-aktif}${NC}"
    echo -e "${GREEN}   URL: http://localhost:$FRONTEND_PORT${NC}"
  else
    echo -e "${RED}Hata: Frontend sunucusu baslatilamadi. Log dosyasina bakin: $FE_LOG_FILE${NC}"
  fi
}

start_backend() {
  if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${YELLOW}Uyari: Backend klasoru ($BACKEND_DIR) bulunamadi.${NC}"
    return 0
  fi

  if is_port_in_use "$BACKEND_PORT"; then
    local current_pid
    current_pid=$(get_port_pid "$BACKEND_PORT")
    echo -e "${YELLOW}Uyari: Backend portu ($BACKEND_PORT) zaten kullanımda! (PID: ${current_pid:-bilinmiyor})${NC}"
    echo -e "${YELLOW}Yeniden baslatmak icin: $0 restart${NC}"
    return 0
  fi

  if [ ! -f "$BACKEND_DIR/.env" ] && [ -f "$BACKEND_DIR/.env.example" ]; then
    echo -e "${YELLOW}Bilgi: backend/.env bulunamadı. Backend başlatılırken ortam değişkenleri gerekecektir.${NC}"
  fi

  echo -e "${CYAN}Backend dev sunucusu (Port $BACKEND_PORT) baslatiliyor...${NC}"

  local be_pid=""
  if has_systemd_user; then
    systemctl --user stop "${BE_SERVICE_NAME}.service" 2>/dev/null || true
    systemctl --user reset-failed "${BE_SERVICE_NAME}.service" 2>/dev/null || true
    systemd-run --user \
      --unit="$BE_SERVICE_NAME" \
      --description="Dugun Ajansim Backend Dev Sunucusu" \
      --working-directory="$BACKEND_DIR" \
      --property=StandardOutput=append:"$BE_LOG_FILE" \
      --property=StandardError=append:"$BE_LOG_FILE" \
      bash -c 'if [ ! -d "node_modules" ]; then npm install; fi; exec npm run dev' >/dev/null 2>&1

    sleep 1
    be_pid=$(systemctl --user show "${BE_SERVICE_NAME}.service" --property=MainPID --value 2>/dev/null || true)
  fi

  if [ -z "$be_pid" ] || [ "$be_pid" = "0" ]; then
    nohup bash -c '
      cd "$1" || exit 1
      if [ ! -d "node_modules" ]; then
        npm install
      fi
      exec npm run dev
    ' _ "$BACKEND_DIR" </dev/null >> "$BE_LOG_FILE" 2>&1 &
    be_pid=$!
  fi

  echo "$be_pid" > "$BE_PID_FILE"

  sleep 1
  if is_port_in_use "$BACKEND_PORT" || is_process_running "$be_pid"; then
    echo -e "${GREEN}-> Backend basariyla baslatildi! PID: ${be_pid:-aktif}${NC}"
    echo -e "${GREEN}   API Health Endpoint: http://localhost:$BACKEND_PORT/api/v1/health${NC}"
  else
    echo -e "${RED}Hata: Backend sunucusu baslatilamadi veya hemen kapandi. Detay icin log: $BE_LOG_FILE${NC}"
  fi
}

status_servers() {
  echo -e "${CYAN}=== Sunucu Durumlari ===${NC}"

  if is_port_in_use "$FRONTEND_PORT"; then
    local fe_pid
    fe_pid=$(get_port_pid "$FRONTEND_PORT")
    echo -e "${GREEN}[CALISIYOR] Frontend - Port: $FRONTEND_PORT (PID: ${fe_pid:-bilinmiyor}) - http://localhost:$FRONTEND_PORT${NC}"
  else
    echo -e "${RED}[KAPALI]    Frontend - Port: $FRONTEND_PORT${NC}"
  fi

  if is_port_in_use "$BACKEND_PORT"; then
    local be_pid
    be_pid=$(get_port_pid "$BACKEND_PORT")
    echo -e "${GREEN}[CALISIYOR] Backend  - Port: $BACKEND_PORT (PID: ${be_pid:-bilinmiyor}) - http://localhost:$BACKEND_PORT/api/v1/health${NC}"
  else
    echo -e "${RED}[KAPALI]    Backend  - Port: $BACKEND_PORT${NC}"
  fi
}

# Parametre analizi
WAIT=0
ACTION="start"

for arg in "$@"; do
  case "$arg" in
    --wait|-w|-Wait)
      WAIT=1
      ;;
    stop)
      ACTION="stop"
      ;;
    status)
      ACTION="status"
      ;;
    restart)
      ACTION="restart"
      ;;
    start)
      ACTION="start"
      ;;
    --help|-h)
      echo "Kullanım: $0 [start|stop|restart|status] [--wait]"
      exit 0
      ;;
  esac
done

case "$ACTION" in
  stop)
    stop_server "$FE_SERVICE_NAME" "$FE_PID_FILE" "$FRONTEND_PORT" "Frontend sunucusu"
    stop_server "$BE_SERVICE_NAME" "$BE_PID_FILE" "$BACKEND_PORT" "Backend sunucusu"
    ;;
  status)
    status_servers
    ;;
  restart)
    stop_server "$FE_SERVICE_NAME" "$FE_PID_FILE" "$FRONTEND_PORT" "Frontend sunucusu"
    stop_server "$BE_SERVICE_NAME" "$BE_PID_FILE" "$BACKEND_PORT" "Backend sunucusu"
    sleep 0.5
    start_frontend
    start_backend
    echo -e "\n${YELLOW}Her iki sunucu da bagimsiz arka plan surecleri olarak calisiyor.${NC}"
    ;;
  start)
    start_frontend
    start_backend
    echo -e "\n${YELLOW}Her iki sunucu da bagimsiz arka plan surecleri olarak calisiyor.${NC}"
    echo -e "Durdurmak icin: ${CYAN}$0 stop${NC}"
    echo -e "Durum kontrolu: ${CYAN}$0 status${NC}"

    if [ "$WAIT" -eq 1 ]; then
      local monitor_pid=""
      if [ -f "$FE_PID_FILE" ]; then
        monitor_pid=$(cat "$FE_PID_FILE" 2>/dev/null || true)
      fi
      if [ -z "$monitor_pid" ] || [ "$monitor_pid" = "0" ]; then
        monitor_pid=$(get_port_pid "$FRONTEND_PORT")
      fi
      if [ -n "$monitor_pid" ] && is_process_running "$monitor_pid"; then
        echo -e "${CYAN}Test tamamlanana kadar Frontend sureci izleniyor (PID: $monitor_pid)...${NC}"
        tail --pid="$monitor_pid" -f /dev/null 2>/dev/null || wait "$monitor_pid" 2>/dev/null || true
      fi
    fi
    ;;
esac
