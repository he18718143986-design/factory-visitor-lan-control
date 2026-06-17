# 工厂访客摄像头管控系统 — 部署文档

> **版本**：PoC Freeze v1  
> **适用范围**：首单 PoC 驻场交付（1–3 家工厂），局域网内网部署  
> **面向读者**：实施工程师 / 驻场运维  
> **部署环境**：Ubuntu 22.04 LTS 服务器 + 同网段 WiFi  

---

## 一、服务器环境要求

| 项目 | 最低要求 | 推荐 |
|------|---------|------|
| 操作系统 | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS Server |
| CPU | 2 核 | 4 核 |
| 内存 | 2 GB | 4 GB |
| 磁盘 | 10 GB 可用空间 | 20 GB SSD |
| Node.js | 18.x | 20.x LTS |
| PM2 | 5.x | 最新稳定版 |
| Git | 2.x | 最新稳定版 |
| 网络 | 固定内网 IP，与访客手机同网段 | 有线接入 + 独立 SSID |

### 1.1 依赖安装

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证版本
node -v   # >= 18.0.0
npm -v    # >= 9.0.0

# 全局安装 PM2
sudo npm install -g pm2

# 安装编译工具（better-sqlite3 需要）
sudo apt install -y build-essential python3
```

---

## 二、端口和网络要求

| 端口 | 协议 | 用途 | 必须 |
|------|------|------|------|
| **3000** | TCP (HTTP) | Web 管理面板 + API + APK 下载 | ✅ |
| **3000** | TCP (WebSocket) | 手机 ↔ 服务器实时通信 | ✅ |
| 5353 | UDP (mDNS) | 局域网设备发现（可选） | ❌ |

### 2.1 防火墙放行

```bash
# UFW 放行 3000 端口
sudo ufw allow 3000/tcp
sudo ufw status
```

### 2.2 网络拓扑确认

部署前务必确认：

1. 服务器和访客手机连接 **同一局域网（同网段）**
2. 服务器使用 **固定 IP**（如 `192.168.1.100`），避免 DHCP 漂移
3. 工厂路由器允许局域网内设备互访（无 AP 隔离）
4. 手机浏览器可访问 `http://<服务器IP>:3000`

```bash
# 查看服务器 IP
ip addr show | grep "inet " | grep -v 127.0.0.1
```

---

## 三、安装步骤

### 3.1 克隆代码

```bash
cd /opt
sudo git clone <仓库地址> nocameras
sudo chown -R $USER:$USER /opt/nocameras
cd /opt/nocameras/factory-saas
```

### 3.2 安装依赖

```bash
npm install --production
```

> 如果 `better-sqlite3` 编译失败，确认已安装 `build-essential` 和 `python3`。

### 3.3 创建环境配置

```bash
cp .env.example .env 2>/dev/null || true
nano .env
```

**必须配置的 `.env` 环境变量：**

```ini
# ─── 必填（生产模式强制校验）───────────────────
NODE_ENV=production
PORT=3000

# JWT 密钥：务必修改为随机字符串（至少 32 位）
JWT_SECRET=替换为随机密钥_可用_openssl_rand_hex_32_生成

# 超管账号（首次启动自动创建）
SUPER_ADMIN_EMAIL=admin@factory.local
SUPER_ADMIN_PASSWORD=替换为安全密码

# ─── 可选 ─────────────────────────────────────
# 数据库路径（默认 data/factory.db）
# DB_PATH=/opt/nocameras/factory-saas/data/factory.db

# TLS（PoC 阶段局域网可不开）
# TLS_ENABLED=false
```

**生成随机 JWT 密钥：**

```bash
openssl rand -hex 32
```

### 3.4 创建数据和日志目录

```bash
mkdir -p data logs
```

### 3.5 数据库初始化

首次启动时自动执行迁移。也可手动运行：

```bash
npm run db:migrate
```

---

## 四、APK 放置

将编译好的 Android APK 放置到 `public/` 目录，文件名必须为 `factory-control.apk`：

```bash
# 从构建机器拷贝 APK（根据实际路径调整）
cp /path/to/visitorapp/app/build/outputs/apk/release/app-release.apk \
   /opt/nocameras/factory-saas/public/factory-control.apk

# 或从 debug 构建拷贝（PoC 阶段）
cp /path/to/visitorapp/app/build/outputs/apk/debug/app-debug.apk \
   /opt/nocameras/factory-saas/public/factory-control.apk

# 确认文件存在
ls -lh /opt/nocameras/factory-saas/public/factory-control.apk
```

> **重要**：文件名必须是 `factory-control.apk`，访客引导页 (`welcome-bridge.html`) 硬编码了此路径。

---

## 五、启动服务

### 5.1 PM2 启动

```bash
cd /opt/nocameras/factory-saas

# 生产模式启动（含自动备份定时任务）
pm2 start ecosystem.config.js --env production

# 保存 PM2 进程列表（重启后自动恢复）
pm2 save

# 设置开机自启
pm2 startup
# 按提示执行输出的 sudo 命令
```

### 5.2 查看运行状态

```bash
pm2 status
```

期望输出：

```
┌──────────────┬────┬──────┬───────┬────────┐
│ name         │ id │ mode │ status│ restart│
├──────────────┼────┼──────┼───────┼────────┤
│ factory-saas │ 0  │ fork │ online│ 0      │
│ db-backup    │ 1  │ fork │ stop  │ 0      │
└──────────────┴────┴──────┴───────┴────────┘
```

`factory-saas` 状态为 `online` 即正常。`db-backup` 为定时任务，运行完后显示 `stopped` 是正常行为。

---

## 六、启动验证

### 6.1 端口监听确认

```bash
ss -tlnp | grep 3000
```

期望输出包含 `LISTEN` 和端口 `3000`。

### 6.2 API 健康检查

```bash
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}"
# 期望返回 302（重定向到 /login）
```

### 6.3 日志检查

```bash
pm2 logs factory-saas --lines 20
```

正常启动日志应包含：

```
[DB] 已应用迁移: v1:xxx, v2:xxx ...
[DB] 超管账号已创建：admin@factory.local
```

若出现 `❌ 生产环境不允许使用默认密钥`，请检查 `.env` 中 `JWT_SECRET` 和 `SUPER_ADMIN_PASSWORD` 是否已修改。

---

## 七、Dashboard 验证

在**服务器所在网段的任意设备**浏览器中访问：

| 页面 | URL | 用途 |
|------|-----|------|
| 登录 | `http://<IP>:3000/login` | 管理员登录入口 |
| 管理面板 | `http://<IP>:3000/dashboard` | 访客会话监控 |
| 管理后台 | `http://<IP>:3000/admin` | 超管功能 |
| 访客引导 | `http://<IP>:3000/welcome-bridge` | 访客手机落地页 |

### 验证步骤

1. 打开 `http://<服务器IP>:3000/login`
2. 使用 `.env` 中配置的超管邮箱 / 密码登录
3. 登录后跳转到 Dashboard，确认页面正常加载
4. 左上角应显示工厂名称，右侧显示在线访客列表

---

## 八、Android App 下载验证

### 8.1 服务端验证

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/factory-control.apk
# 期望返回 200
```

```bash
curl -sI http://localhost:3000/factory-control.apk | head -5
# Content-Type 应包含 application/vnd.android.package-archive 或 application/octet-stream
# Content-Length 应与 APK 文件大小一致
```

### 8.2 手机端验证

1. 在访客手机浏览器中打开 `http://<服务器IP>:3000/welcome-bridge`
2. 页面应显示下载按钮
3. 点击下载，APK 应正常下载（约 10–30 MB）
4. 安装 APK（需允许"未知来源"安装）
5. 打开 App，应显示空闲待扫码界面

> **注意**：部分手机浏览器会拦截 APK 下载，建议使用 Chrome 或系统自带浏览器。

---

## 九、常见部署问题排查

### 9.1 端口被占用

```bash
# 查看谁占用了 3000 端口
sudo lsof -i :3000
# 杀掉占用进程或修改 .env 中的 PORT
```

### 9.2 better-sqlite3 编译失败

```bash
# 确保编译工具链完整
sudo apt install -y build-essential python3

# 清除缓存重装
rm -rf node_modules
npm install --production
```

### 9.3 手机无法访问服务器

**逐步排查：**

```bash
# 1. 确认服务器端口在监听
ss -tlnp | grep 3000

# 2. 确认防火墙已放行
sudo ufw status

# 3. 确认手机和服务器 IP 同网段
# 服务器 IP
ip addr show | grep "inet "
# 手机 IP：设置 → WLAN → 查看已连接网络详情

# 4. 手机 ping 服务器（需安装终端 App 或用浏览器直接访问）
```

### 9.4 PM2 启动后立即 errored

```bash
# 查看错误日志
pm2 logs factory-saas --err --lines 50

# 常见原因：
# - .env 中 JWT_SECRET 未修改（生产模式强制校验）
# - Node.js 版本过低（需 >= 18）
# - data/ 目录不存在或无写权限
```

### 9.5 数据库锁定 / SQLITE_BUSY

```bash
# SQLite WAL 模式下极少出现，若出现：
# 1. 确认只有一个 factory-saas 实例在运行
pm2 status
# 2. 检查是否有残留进程
ps aux | grep server.js
```

### 9.6 APK 下载返回 404

```bash
# 确认文件存在且路径正确
ls -la /opt/nocameras/factory-saas/public/factory-control.apk

# 文件名必须完全匹配（大小写敏感）
```

### 9.7 WebSocket 连接失败

```bash
# 测试 WS 连接（需安装 wscat）
npm install -g wscat
wscat -c ws://localhost:3000
# 连接成功后会显示 "Connected"
```

---

## 十、驻场部署建议

### 10.1 现场准备清单

- [ ] 服务器已配置固定 IP 并接入工厂网络
- [ ] 工厂 WiFi SSID / 密码已确认
- [ ] 确认访客手机与服务器在同一 VLAN / 网段
- [ ] 确认路由器未开启 AP 隔离（客户端隔离）
- [ ] 准备至少 2 台测试手机（不同品牌：三星 / 小米 / OPPO 等）
- [ ] APK 已放入 `public/factory-control.apk`
- [ ] `.env` 已配置安全密钥

### 10.2 现场部署流程

```
1. 服务器上架 + 接通网络 + 确认固定 IP
             ↓
2. git clone + npm install + 配置 .env
             ↓
3. pm2 start + 验证端口 + 登录 Dashboard
             ↓
4. 手机连接工厂 WiFi
             ↓
5. 手机浏览器打开 welcome-bridge 页 → 下载 APK → 安装
             ↓
6. 门卫端创建区域 → 生成入场二维码
             ↓
7. 测试手机扫码入场 → 确认进入管控状态
             ↓
8. 扫码离场 → 确认管控解除
             ↓
9. 交付客户，培训门卫操作
```

### 10.3 备份策略

PM2 已配置 `db-backup` 定时任务，每 6 小时自动备份一次数据库到 `data/backups/` 目录。

手动触发备份：

```bash
npm run db:backup
```

### 10.4 数据库位置

```
/opt/nocameras/factory-saas/data/factory.db      # 主数据库
/opt/nocameras/factory-saas/data/factory.db-wal   # WAL 日志
/opt/nocameras/factory-saas/data/factory.db-shm   # 共享内存
```

> **切勿**在服务运行时直接拷贝 `.db` 文件。使用 `npm run db:backup` 确保一致性。

---

## 附录：常用命令

### 服务管理

```bash
# 启动
pm2 start ecosystem.config.js --env production

# 停止
pm2 stop factory-saas

# 重启
pm2 restart factory-saas

# 删除进程（需要重新 start）
pm2 delete all

# 查看状态
pm2 status

# 查看实时日志
pm2 logs factory-saas

# 查看最近 100 行错误日志
pm2 logs factory-saas --err --lines 100

# 监控面板（CPU / 内存 / 请求数）
pm2 monit
```

### 数据库

```bash
# 手动迁移
npm run db:migrate

# 手动备份
npm run db:backup

# 查看数据库（需安装 sqlite3）
sudo apt install -y sqlite3
sqlite3 data/factory.db ".tables"
sqlite3 data/factory.db "SELECT count(*) FROM sessions;"
```

### 验证脚本

```bash
# 验证安全默认配置
npm run verify:security

# 验证订阅状态机
npm run verify:state-machine
```

### 网络诊断

```bash
# 查看服务器 IP
ip addr show

# 测试端口可达性（从另一台机器）
nc -zv <服务器IP> 3000

# 查看端口监听
ss -tlnp | grep 3000

# 查看连接数
ss -s
```

### APK 更新

```bash
# 替换 APK
cp /path/to/new-app.apk /opt/nocameras/factory-saas/public/factory-control.apk

# 无需重启服务，Express 静态文件直接生效
# 验证
curl -sI http://localhost:3000/factory-control.apk | grep Content-Length
```

---

> **文档维护**：本文档随代码仓库同步更新。如有部署问题请联系项目技术负责人。
