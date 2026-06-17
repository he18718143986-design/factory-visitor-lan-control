#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# deploy.sh — 工厂访客摄像头管控系统 一键部署脚本
# 适用环境：macOS (开发/PoC) · Ubuntu 22.04 LTS (生产)
# 用法：
#   chmod +x deploy.sh
#   # macOS (无需 sudo):
#   ./deploy.sh                    # 全新安装
#   # Linux:
#   sudo ./deploy.sh               # 全新安装
#   ./deploy.sh --update           # 仅更新代码并重启
#   ./deploy.sh --verify           # 仅运行验证
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── 平台检测 ──────────────────────────────────────────────────
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
  Darwin) IS_MAC=true  ;;
  Linux)  IS_MAC=false ;;
  *)      echo "不支持的操作系统: $OS_TYPE"; exit 1 ;;
esac

# ── 配置区（按需修改）─────────────────────────────────────────
INSTALL_DIR=""
APP_DIR="$INSTALL_DIR/factory-saas"
REPO_URL=""                          # 留空则跳过 git clone（用于本地部署）
APP_PORT=3000
ADMIN_EMAIL="admin@factory.local"
ADMIN_PASSWORD=""                    # 留空则自动生成
NODE_MAJOR=20                        # Node.js 主版本

# ── 颜色输出 ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
die()   { fail "$*"; exit 1; }

# ── 权限检查 ──────────────────────────────────────────────────
if $IS_MAC; then
  # macOS: brew 不允许 root 运行，无需 sudo
  REAL_USER="$USER"
else
  [[ $EUID -eq 0 ]] || die "Linux 下请使用 sudo 运行此脚本"
  REAL_USER="${SUDO_USER:-$USER}"
  [[ "$REAL_USER" != "root" ]] || warn "建议使用普通用户 sudo 执行，而非直接 root 登录"
fi

# ── 以实际用户身份运行命令 ────────────────────────────────────
run_as_user() {
  if $IS_MAC || [[ $EUID -ne 0 ]]; then
    "$@"
  else
    sudo -u "$REAL_USER" "$@"
  fi
}

# ── 参数解析 ──────────────────────────────────────────────────
MODE="install"
for arg in "$@"; do
  case "$arg" in
    --update)  MODE="update" ;;
    --verify)  MODE="verify" ;;
    --help|-h)
      echo "用法: ./deploy.sh [--update|--verify]"
      echo "  (无参数)   全新安装"
      echo "  --update   更新代码并重启服务"
      echo "  --verify   仅运行部署验证"
      exit 0 ;;
  esac
done

# ── 操作系统检查 ──────────────────────────────────────────────
check_os() {
  info "检查操作系统..."
  if $IS_MAC; then
    ok "操作系统: macOS $(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
  else
    if [[ -f /etc/os-release ]]; then
      . /etc/os-release
      if [[ "$ID" != "ubuntu" ]]; then
        warn "当前系统为 $ID，脚本针对 Ubuntu 22.04 编写，其他发行版可能需要调整"
      fi
      ok "操作系统: $(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"')"
    else
      ok "操作系统: Linux (unknown)"
    fi
  fi
}

# ── 系统依赖安装 ──────────────────────────────────────────────
install_system_deps() {
  info "安装系统依赖..."

  if $IS_MAC; then
    install_system_deps_mac
  else
    install_system_deps_linux
  fi

  # PM2（通用）
  if command -v pm2 &>/dev/null; then
    ok "PM2 $(pm2 -v) 已安装"
  else
    info "安装 PM2..."
    npm install -g pm2 > /dev/null 2>&1
    ok "PM2 $(pm2 -v) 已安装"
  fi
}

install_system_deps_mac() {
  # 检查 Homebrew
  if ! command -v brew &>/dev/null; then
    die "请先安装 Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  fi
  ok "Homebrew 已安装"

  # Xcode Command Line Tools（提供 make/gcc/python3）
  if ! xcode-select -p &>/dev/null; then
    info "安装 Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    warn "请在弹窗中点击"安装"，完成后重新运行此脚本"
    exit 0
  fi
  ok "Xcode CLT 已安装（含 make, python3）"

  # Node.js
  check_or_install_node
}

install_system_deps_linux() {
  apt-get update -qq

  # build-essential + python3（better-sqlite3 编译需要）
  apt-get install -y -qq build-essential python3 curl git > /dev/null 2>&1
  ok "build-essential, python3, curl, git 已安装"

  # Node.js
  check_or_install_node
}

check_or_install_node() {
  if command -v node &>/dev/null; then
    local node_ver
    node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_ver" -ge 18 ]]; then
      ok "Node.js $(node -v) 已安装，跳过"
      return
    fi
    warn "Node.js 版本过低 ($(node -v))，升级到 ${NODE_MAJOR}.x..."
  fi
  install_node
}

install_node() {
  info "安装 Node.js ${NODE_MAJOR}.x..."
  if $IS_MAC; then
    brew install "node@${NODE_MAJOR}" 2>/dev/null || brew upgrade "node@${NODE_MAJOR}" 2>/dev/null || true
    brew link --force --overwrite "node@${NODE_MAJOR}" 2>/dev/null || true
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
  fi
  ok "Node.js $(node -v) 已安装"
}

# ── 防火墙 ────────────────────────────────────────────────────
configure_firewall() {
  info "配置防火墙..."
  if $IS_MAC; then
    ok "macOS 默认无入站防火墙限制，跳过"
  elif command -v ufw &>/dev/null; then
    ufw allow "$APP_PORT/tcp" > /dev/null 2>&1 || true
    ok "UFW 已放行端口 $APP_PORT"
  else
    warn "未检测到 UFW，请手动确认端口 $APP_PORT 已放行"
  fi
}

# ── 代码部署 ──────────────────────────────────────────────────
deploy_code() {
  if [[ -n "$REPO_URL" ]] && [[ ! -d "$APP_DIR" ]]; then
    info "克隆仓库到 $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    if ! $IS_MAC; then
      chown -R "$REAL_USER":"$REAL_USER" "$INSTALL_DIR"
    fi
    ok "代码已克隆"
  elif [[ -d "$APP_DIR" ]]; then
    ok "代码目录已存在: $APP_DIR"
  else
    # 尝试从脚本所在目录推断项目位置
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$script_dir/factory-saas/server.js" ]]; then
      INSTALL_DIR="$script_dir"
      APP_DIR="$INSTALL_DIR/factory-saas"
      ok "检测到项目在: $APP_DIR"
    elif [[ -f "$script_dir/server.js" ]]; then
      APP_DIR="$script_dir"
      INSTALL_DIR="$(dirname "$APP_DIR")"
      ok "检测到项目在: $APP_DIR"
    else
      die "未找到项目代码。请设置 REPO_URL 或将脚本放在项目根目录运行"
    fi
  fi

  [[ -f "$APP_DIR/server.js" ]] || die "$APP_DIR/server.js 不存在，请检查代码目录"
  [[ -f "$APP_DIR/package.json" ]] || die "$APP_DIR/package.json 不存在"
}

# ── NPM 依赖 ──────────────────────────────────────────────────
install_deps() {
  info "安装 NPM 依赖..."
  cd "$APP_DIR"
  run_as_user npm install --production 2>&1 | tail -3
  ok "NPM 依赖安装完成"
}

# ── 目录创建 ──────────────────────────────────────────────────
create_dirs() {
  info "创建 data / logs 目录..."
  run_as_user mkdir -p "$APP_DIR/data" "$APP_DIR/logs"
  ok "目录已就绪"
}

# ── 环境变量配置 ──────────────────────────────────────────────
configure_env() {
  local env_file="$APP_DIR/.env"

  if [[ -f "$env_file" ]]; then
    # 检查是否仍在使用默认值
    if grep -q "dev-secret-change-in-production\|替换为随机密钥\|替换为安全密码" "$env_file" 2>/dev/null; then
      warn ".env 存在但含默认值，将自动更新密钥"
    else
      ok ".env 已配置，跳过"
      return
    fi
  fi

  info "生成 .env 配置..."
  local jwt_secret
  jwt_secret=$(openssl rand -hex 32)

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 16)
    warn "超管密码已自动生成: $ADMIN_PASSWORD （请记录！）"
  fi

  cat > "$env_file" <<EOF
# ─── 自动生成于 $(date '+%Y-%m-%d %H:%M:%S') ───
NODE_ENV=production
PORT=${APP_PORT}

# JWT 密钥（自动生成，请勿泄露）
JWT_SECRET=${jwt_secret}

# 超管账号
SUPER_ADMIN_EMAIL=${ADMIN_EMAIL}
SUPER_ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF

  if ! $IS_MAC; then
    chown "$REAL_USER":"$REAL_USER" "$env_file"
  fi
  chmod 600 "$env_file"
  ok ".env 已生成（权限 600）"
}

# ── APK 放置检查 ──────────────────────────────────────────────
check_apk() {
  local apk_path="$APP_DIR/public/factory-control.apk"
  local visitorapp_dir="$INSTALL_DIR/visitorapp"

  if [[ -f "$apk_path" ]]; then
    local size
    size=$(stat -f%z "$apk_path" 2>/dev/null || stat -c%s "$apk_path" 2>/dev/null)
    if [[ "$size" -gt 1000000 ]]; then
      ok "APK 已就绪 (${size} bytes)"
      return
    fi
    warn "APK 文件过小 (${size} bytes)，可能损坏"
  fi

  # 尝试从本地构建产物复制
  local candidates=(
    "$visitorapp_dir/app/build/outputs/apk/debug/app-debug.apk"
    "$visitorapp_dir/app/build/outputs/apk/release/app-release.apk"
    "$visitorapp_dir/app/release/app-release.apk"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      info "从构建产物复制 APK: $candidate"
      cp "$candidate" "$apk_path"
      if ! $IS_MAC; then
        chown "$REAL_USER":"$REAL_USER" "$apk_path"
      fi
      ok "APK 已放置到 public/factory-control.apk"
      return
    fi
  done

  warn "APK 未找到！请手动放置到: $apk_path"
  warn "  cp /path/to/app.apk $apk_path"
}

# ── PM2 启动 ──────────────────────────────────────────────────
start_service() {
  info "启动服务..."
  cd "$APP_DIR"

  # 停止旧实例（忽略错误）
  run_as_user pm2 delete factory-saas 2>/dev/null || true
  run_as_user pm2 delete db-backup 2>/dev/null || true
  run_as_user pm2 delete expiry-reminder 2>/dev/null || true

  # 启动
  run_as_user pm2 start ecosystem.config.js --env production

  # 保存进程列表 + 开机自启
  run_as_user pm2 save
  if $IS_MAC; then
    run_as_user pm2 startup launchd 2>/dev/null || true
  else
    local user_home
    user_home=$(eval echo "~$REAL_USER")
    env PATH="$PATH" pm2 startup systemd -u "$REAL_USER" --hp "$user_home" 2>/dev/null || true
  fi

  # 等待启动
  sleep 3
  ok "PM2 进程已启动"
}

# ── 部署验证 ──────────────────────────────────────────────────
verify_deployment() {
  echo ""
  info "═══════════════ 部署验证 ═══════════════"
  local pass=0 total=0

  # 1. PM2 进程
  total=$((total+1))
  if run_as_user pm2 pid factory-saas > /dev/null 2>&1 && \
     [[ "$(run_as_user pm2 pid factory-saas)" -gt 0 ]]; then
    ok "[1/6] PM2 factory-saas 进程运行中"
    pass=$((pass+1))
  else
    fail "[1/6] PM2 factory-saas 未运行"
  fi

  # 2. 端口监听
  total=$((total+1))
  local port_listening=false
  if $IS_MAC; then
    lsof -iTCP:"${APP_PORT}" -sTCP:LISTEN -P -n &>/dev/null && port_listening=true
  else
    ss -tlnp 2>/dev/null | grep -q ":${APP_PORT} " && port_listening=true
  fi
  if $port_listening; then
    ok "[2/6] 端口 $APP_PORT 正在监听"
    pass=$((pass+1))
  else
    fail "[2/6] 端口 $APP_PORT 未监听"
  fi

  # 3. HTTP 响应
  total=$((total+1))
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}/" 2>/dev/null || echo "000")
  if [[ "$http_code" == "302" || "$http_code" == "200" ]]; then
    ok "[3/6] HTTP 响应正常 (${http_code})"
    pass=$((pass+1))
  else
    fail "[3/6] HTTP 响应异常 (${http_code})"
  fi

  # 4. Dashboard 页面
  total=$((total+1))
  local dash_code
  dash_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}/login" 2>/dev/null || echo "000")
  if [[ "$dash_code" == "200" ]]; then
    ok "[4/6] Dashboard 登录页正常"
    pass=$((pass+1))
  else
    fail "[4/6] Dashboard 登录页异常 (${dash_code})"
  fi

  # 5. APK 下载
  total=$((total+1))
  local apk_code
  apk_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}/factory-control.apk" 2>/dev/null || echo "000")
  if [[ "$apk_code" == "200" ]]; then
    ok "[5/6] APK 下载端点正常"
    pass=$((pass+1))
  else
    warn "[5/6] APK 下载返回 ${apk_code}（可能尚未放置 APK 文件）"
  fi

  # 6. WebSocket
  total=$((total+1))
  local ws_ok=false
  if command -v node &>/dev/null; then
    local ws_result
    ws_result=$(node -e "
      const ws = new (require('ws'))('ws://localhost:${APP_PORT}');
      const t = setTimeout(() => { process.exit(1); }, 3000);
      ws.on('open', () => { clearTimeout(t); console.log('ok'); ws.close(); process.exit(0); });
      ws.on('error', () => { clearTimeout(t); process.exit(1); });
    " 2>/dev/null) || true
    if [[ "$ws_result" == "ok" ]]; then
      ws_ok=true
    fi
  fi
  if $ws_ok; then
    ok "[6/6] WebSocket 连接正常"
    pass=$((pass+1))
  else
    warn "[6/6] WebSocket 测试跳过（ws 模块未全局安装）"
  fi

  # 汇总
  echo ""
  local server_ip
  if $IS_MAC; then
    server_ip=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
  else
    server_ip=$(ip -4 addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -1)
  fi
  [[ -n "$server_ip" ]] || server_ip="localhost"

  if [[ $pass -ge $((total-1)) ]]; then
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ 部署成功！ ($pass/$total 项通过)${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
  else
    echo -e "${RED}══════════════════════════════════════════════${NC}"
    echo -e "${RED}  ❌ 部署存在问题 ($pass/$total 项通过)${NC}"
    echo -e "${RED}══════════════════════════════════════════════${NC}"
    echo "  查看日志: pm2 logs factory-saas --err --lines 50"
  fi

  echo ""
  echo "  访问地址:"
  echo "    管理面板:   http://${server_ip}:${APP_PORT}/dashboard"
  echo "    登录页:     http://${server_ip}:${APP_PORT}/login"
  echo "    访客引导:   http://${server_ip}:${APP_PORT}/welcome-bridge"
  echo "    APK 下载:   http://${server_ip}:${APP_PORT}/factory-control.apk"
  echo ""
  echo "  超管账号:     ${ADMIN_EMAIL}"
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    echo "  超管密码:     ${ADMIN_PASSWORD}"
  fi
  echo ""
  echo "  常用命令:"
  echo "    pm2 status                    # 查看进程状态"
  echo "    pm2 logs factory-saas         # 查看日志"
  echo "    pm2 restart factory-saas      # 重启服务"
  echo ""
}

# ── 更新模式 ──────────────────────────────────────────────────
do_update() {
  info "═══════════════ 更新模式 ═══════════════"
  deploy_code
  cd "$APP_DIR"

  if [[ -n "$REPO_URL" ]] && [[ -d "$APP_DIR/.git" ]]; then
    info "拉取最新代码..."
    run_as_user git -C "$APP_DIR" pull --ff-only
    ok "代码已更新"
  fi

  install_deps
  check_apk

  info "重启服务..."
  run_as_user pm2 restart ecosystem.config.js --env production 2>/dev/null || start_service
  sleep 3

  verify_deployment
}

# ── 主流程 ────────────────────────────────────────────────────
main() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  工厂访客摄像头管控系统 — 自动部署脚本       ║"
  echo "║  版本: PoC Freeze v1                         ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""

  case "$MODE" in
    verify)
      deploy_code
      # 从 .env 读取管理员信息用于显示
      if [[ -f "$APP_DIR/.env" ]]; then
        ADMIN_EMAIL=$(grep '^SUPER_ADMIN_EMAIL=' "$APP_DIR/.env" | cut -d= -f2)
        ADMIN_PASSWORD="(已配置，见 .env)"
      fi
      verify_deployment
      ;;
    update)
      do_update
      ;;
    install)
      check_os
      install_system_deps
      configure_firewall
      deploy_code
      create_dirs
      install_deps
      configure_env
      check_apk
      start_service
      verify_deployment
      ;;
  esac
}

main
