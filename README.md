# Factory Visitor LAN Control / 厂区访客设备本地管控系统

> On-premise visitor device control for factories: a guard-station desktop console
> plus an Android companion app. QR pairing, ADB wireless debug, and camera/screen
> restrictions all require the phone and control PC to share the same LAN.
>
> 厂区访客手机摄像头本地管控：门卫电脑端控制台 + Android 辅助 App。
> 进厂二维码、无线调试配对、设备权限管控均依赖**同一局域网**，非云端 SaaS。

---

## Highlights / 项目亮点

- **LAN-native pairing / 局域网原生配对**：mDNS discovers `_factory-control._tcp` and
  `_adb-tls-pairing._tcp`; the server triggers `adb pair` after the visitor scans the
  entry QR code.（mDNS 发现 + ADB 无线配对，扫码后自动完成 TLS 握手。）
- **Multi-ROM Android automation / 多 ROM 适配**：Accessibility + DevicePolicy profiles
  for Huawei, Xiaomi, OPPO, vivo, Samsung, and generic AOSP.（覆盖主流国产 ROM。）
- **Real-time guard dashboard / 门卫实时管控台**：WebSocket pushes session state;
  guards issue QR codes, monitor visitors, and revoke device restrictions on exit.
- **WiFi fingerprint binding / WiFi 指纹绑定**：subnet / BSSID / gateway matching
  prevents credential sharing across factory sites.（防同一账号跨厂区滥用。）
- **On-premise deployment / 本地部署**：Node.js + SQLite runs on the guard PC;
  `deploy.sh` supports macOS PoC and Ubuntu 22.04 production.

## Architecture / 系统架构

```
┌─────────────────────┐     same LAN      ┌──────────────────────┐
│  Guard PC           │◄──── mDNS / WS ───►│  Visitor Android App │
│  factory-saas/      │◄──── ADB over WiFi ►│  visitorapp/         │
│  Node.js + Web UI   │                     │  Kotlin              │
└─────────────────────┘                     └──────────────────────┘
         │
    SQLite (per-site)
```

| Component | Path | Role |
|-----------|------|------|
| Control server | `factory-saas/` | HTTP API, WebSocket, mDNS, ADB orchestration, guard web UI |
| Android app | `visitorapp/` | Visitor-side setup, ROM-specific restriction enforcement |
| Deploy | `deploy.sh` | One-shot install on macOS / Ubuntu |
| Ops docs | `docs/` | Deployment checklist, incident runbook, acceptance criteria |

> **Note:** Internal data model uses `subscription` / `siteId` as the per-factory
> site instance ID — not a cloud multi-tenant SaaS layer.

## Prerequisites / 环境要求

| Item | Requirement |
|------|-------------|
| Node.js | 20.x LTS (recommended) |
| ADB | Android SDK platform-tools on guard PC |
| Network | Guard PC and visitor phones on the **same subnet**; no AP isolation |
| Android | API 24+; wireless debugging enabled |

## Quick start / 快速启动

```bash
cd factory-saas
cp .env.example .env
# Edit JWT_SECRET and SUPER_ADMIN_PASSWORD

npm install
npm run db:migrate
npm run dev
```

Open `http://<guard-pc-ip>:3000/login` from a browser on the same LAN.

Default admin is created on first migration via `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` in `.env`.

## Android app build / 编译访客 App

```bash
cd visitorapp
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Install on visitor phones; the app discovers the control server via mDNS on the local network.

## Production deploy / 生产部署

```bash
chmod +x deploy.sh
sudo ./deploy.sh          # Ubuntu 22.04
# or on macOS:
./deploy.sh
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for firewall ports, network topology, and acceptance checklist.

## Core flow / 核心流程

1. Guard logs into the local console and generates an entry QR code.
2. Visitor scans the QR on their phone (wireless debugging pairing).
3. Server detects mDNS `_adb-tls-pairing._tcp` and runs `adb pair`.
4. ADB applies camera freeze, screenshot block, and app restrictions per site config.
5. On exit, restrictions are lifted and the session is archived.

## Tests / 测试

```bash
cd factory-saas
npm test
```

## License

MIT — see [LICENSE](LICENSE).

## Author

He Shuting (何淑婷) — [he18718143986-design](https://github.com/he18718143986-design)
