'use strict';
/**
 * server.js — 厂区访客设备本地管控主入口
 * 职责：HTTP 服务器 + WebSocket + 启动序列
 */

// ── Sentry 初始化（最早加载）──────────────────────────────────
const Sentry = require('@sentry/node');
const config = require('./config');
if (config.sentry.enabled) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    tracesSampleRate: config.isProd ? 0.2 : 1.0,
  });
  console.log('[Sentry] 错误监控已启用');
}

// ── 全局错误兜底（防止进程崩溃）────────────────────────────
process.on('uncaughtException',  err => {
  console.error('[FATAL] uncaughtException:', err);
  Sentry.captureException(err);
});
process.on('unhandledRejection', err => {
  console.error('[FATAL] unhandledRejection:', err);
  Sentry.captureException(err);
});

const express     = require('express');
const http        = require('http');
const https       = require('https');
const fs          = require('fs');
const WebSocket   = require('ws');
const cors        = require('cors');
const cookieParser = require('cookie-parser');
const path        = require('path');
const { ensureCsrfToken, csrfProtection } = require('./middleware/csrf');

// ── 初始化 HTTP(S) 服务器 ─────────────────────────────────────
const app    = express();

let server;
if (config.tls.enabled && config.tls.certPath && config.tls.keyPath) {
  try {
    const tlsOpts = {
      cert: fs.readFileSync(config.tls.certPath),
      key:  fs.readFileSync(config.tls.keyPath),
    };
    server = https.createServer(tlsOpts, app);
    console.log('[TLS] HTTPS 已启用');
  } catch (err) {
    console.error('[TLS] ❌ 证书加载失败:', err.message);
    console.error('[TLS] 降级为 HTTP 模式');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss    = new WebSocket.Server({ server });
app.disable('x-powered-by');
app.set('trust proxy', config.http.trustProxy);

// ── 广播模块初始化 ────────────────────────────────────────────
const wsHub = require('./broadcast/ws');
wsHub.init(wss);

// ── 中间件 ───────────────────────────────────────────────────
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());
app.use(ensureCsrfToken);

// Standardize error responses: enrich any JSON error with timestamp and requestId
const { v4: uuidv4 } = require('uuid');
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = function(body) {
    if (body && typeof body === 'object' && body.error && res.statusCode >= 400) {
      if (!body.timestamp) body.timestamp = new Date().toISOString();
      if (!body.requestId) body.requestId = uuidv4();
    }
    return origJson(body);
  };
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', config.security.csp);
  if (config.isProd && config.http.enableHsts) {
    res.setHeader('Strict-Transport-Security', `max-age=${config.http.hstsMaxAge}; includeSubDomains`);
  }
  next();
});

function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser / same-origin navigation
  if (!config.isProd) return true;
  const allowed = config.http.allowedOrigins;
  if (!allowed.length) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(origin);
}

app.use(cors({
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    return cb(new Error('CORS_NOT_ALLOWED'));
  },
  credentials: true,
}));
app.use(csrfProtection);

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

// ── 路由挂载 ─────────────────────────────────────────────────
app.use(require('./routes/auth'));
app.use(require('./routes/user'));
app.use(require('./routes/checkin'));
app.use(require('./routes/areas'));
app.use(require('./routes/device'));

// ── 根路由重定向 ─────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/login'));

// ── 统一错误处理（避免泄露堆栈）───────────────────────────────
Sentry.setupExpressErrorHandler(app);
const { errorBody } = require('./utils/errors');
app.use((err, req, res, next) => {
  if (!err) return next();
  if (res.headersSent) return next(err);
  if (err.message === 'CORS_NOT_ALLOWED') {
    return res.status(403).json(errorBody('CORS_FORBIDDEN', '跨域请求被拒绝'));
  }
  Sentry.captureException(err);
  if (!config.isProd) {
    return res.status(500).json(errorBody('INTERNAL_ERROR', err.message));
  }
  return res.status(500).json(errorBody('INTERNAL_ERROR', '服务器内部错误'));
});

// ── WebSocket 连接处理 ────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // Origin validation for WebSocket connections
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin)) {
    ws.close(1008, 'Origin not allowed');
    return;
  }

  const url  = new URL(req.url, 'http://x');
  const sid  = url.searchParams.get('sessionId');
  const siteId = url.searchParams.get('siteId');
  const lastEventId = Number(url.searchParams.get('lastEventId')) || 0;

  ws.siteId = siteId || null;
  ws.subscriptionId = null;

  // ── 认证逻辑 ───────────────────────────────────────────────
  // 管理端（siteId 参数）：需要有效 JWT cookie
  if (siteId) {
    const jwt = require('jsonwebtoken');
    const cookies = parseCookiesFromHeader(req.headers.cookie);
    const token   = cookies.token;
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const { stmts } = require('./db');
    const sub = stmts.getSubBySiteId.get(siteId);
    if (!sub) {
      ws.close(4004, 'Site not found');
      return;
    }
    // 只有订阅归属用户或超管才允许监听
    if (sub.user_id !== payload.userId && !payload.isSuperAdmin) {
      ws.close(4003, 'Forbidden');
      return;
    }
    ws.subscriptionId = sub.id;
  }

  // 访客端（sessionId 参数）：需要有效 deviceToken 或已认证管理员
  if (sid) {
    const { getSession } = require('./sessions/store');
    const session = getSession(sid);
    if (!session) {
      ws.close(4004, 'Session not found');
      return;
    }

    // 检查是否为已认证管理员（有有效 JWT）
    let isAuthenticatedOwner = false;
    const cookies2 = parseCookiesFromHeader(req.headers.cookie);
    if (cookies2.token) {
      try {
        const jwt2 = require('jsonwebtoken');
        const p = jwt2.verify(cookies2.token, config.jwt.secret);
        const { stmts: stmts2 } = require('./db');
        const sub2 = stmts2.getSubById.get(session.subscriptionId);
        if (sub2 && (sub2.user_id === p.userId || p.isSuperAdmin)) {
          isAuthenticatedOwner = true;
        }
      } catch { /* JWT 无效，继续走 deviceToken 验证 */ }
    }

    if (!isAuthenticatedOwner) {
      // 需要 deviceToken
      const dtParam = url.searchParams.get('dt') || '';
      if (session.deviceToken) {
        if (!dtParam) {
          ws.close(4001, 'Unauthorized');
          return;
        }
        try {
          const crypto = require('crypto');
          const a = Buffer.from(String(session.deviceToken));
          const b = Buffer.from(String(dtParam));
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            ws.close(4001, 'Unauthorized');
            return;
          }
        } catch {
          ws.close(4001, 'Unauthorized');
          return;
        }
      }
    }

    wsHub.joinRoom(sid, ws);
    const { serializeSession } = require('./sessions/serialize');
    ws.send(JSON.stringify({ event: 'init', session: serializeSession(session) }));
    ws.on('close', () => wsHub.leaveRoom(sid, ws));
  }

  // 断线重连：补发 lastEventId 之后的关键事件
  if (lastEventId > 0 && ws.subscriptionId) {
    try {
      const { stmts } = require('./db');
      const missed = stmts.getWsEventsSince.all(ws.subscriptionId, lastEventId);
      for (const row of missed) {
        try {
          const payload = JSON.parse(row.payload);
          payload._replay = true;
          payload._eventId = row.id;
          ws.send(JSON.stringify(payload));
        } catch (_) {}
      }
    } catch (err) {
      console.error('[WS] 补发事件失败:', err.message);
    }
  }

  ws.on('error', err => console.error('[WS]', err.message));
});

/** 从原始 Cookie 头解析 key=value 对 */
function parseCookiesFromHeader(header) {
  const map = {};
  if (!header) return map;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    map[key] = val;
  });
  return map;
}

// ── ADB 设备轮询 + 断连检测 ───────────────────────────────────
const adbMgr = require('./adb');
const { getSession } = require('./sessions/store');
const { serializeSession } = require('./sessions/serialize');
const { broadcastToSub } = require('./broadcast/ws');
const { setStatus: flowSetStatus, log: flowLog } = require('./pairing/flow');
const { markDirty } = require('./sessions/store');

adbMgr.startPolling();
adbMgr.setOnDeviceLost((lostDeviceId) => {
  // 找到所有使用该设备 ID 且处于 restricted/pairing 状态的会话
  const { stmts, db } = require('./db');
  const rows = db.prepare("SELECT id, subscription_id FROM visitor_sessions WHERE json_extract(data,'$.deviceId') = ?").all(lostDeviceId);
  rows.forEach(row => {
    const session = getSession(row.id);
    if (!session) return;
    if (!['restricted', 'pairing'].includes(session.status)) return;
    flowLog(session, '🚨 管控中设备 ADB 连接断开：' + lostDeviceId, 'error');
    broadcastToSub(session.subscriptionId, {
      event: 'deviceDisconnected',
      sessionId: session.id, deviceId: lostDeviceId,
      visitorName: session.visitorName, area: session.area,
    });
    session.pairedNotConnectedReason = 'device_disconnected';
    session.status = 'paired_not_connected';
    markDirty();
    flowSetStatus(session, 'paired_not_connected', '⚠️ ADB 连接断开，请让访客确认 WiFi 后点击重试');
    broadcastToSub(session.subscriptionId, { event: 'sessionUpdate', session: serializeSession(session) });
  });
});

// ── 生命周期定时检查 ─────────────────────────────────────────
require('./sessions/lifecycle').start();

// ── 摄像头权限巡检 ───────────────────────────────────────────
require('./sessions/patrol').start();

// ── mDNS 启动 ────────────────────────────────────────────────
const mdns = require('./mdns');
mdns.advertiseControlServer(config.port);
mdns.startPairingListener();

// ── IP 变更检测 ──────────────────────────────────────────────
const { getServerIP } = require('./utils/network');
let lastIP = getServerIP();
setInterval(() => {
  const ip = getServerIP();
  if (ip !== lastIP) { lastIP = ip; console.log('[IP] 服务器 IP 变更：' + ip); }
}, 30000);

// ── ADB 版本检查 ─────────────────────────────────────────────
async function checkAdb() {
  try {
    const { execFile } = require('child_process');
    const out = await new Promise((res, rej) => execFile('adb', ['version'], { timeout: 5000 }, (e, s) => e ? rej(e) : res(s)));
    const m = out.match(/(\d+\.\d+\.\d+)/);
    console.log('[ADB] 版本：' + (m ? m[1] : out.trim()));
  } catch { console.warn('[ADB] ⚠️ adb 未安装或不可用'); }
}

// ── 端口冲突 ─────────────────────────────────────────────────
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${config.port} 已被占用\n`);
    process.exit(1);
  }
  throw err;
});

// ── 优雅停机 ─────────────────────────────────────────────────
function gracefulShutdown(sig) {
  console.log(`\n[${sig}] 正在优雅关闭…`);
  require('./sessions/store').persist();
  adbMgr.stopPolling();
  mdns.shutdown();
  server.close(() => { console.log('服务器已关闭'); process.exit(0); });
  setTimeout(() => process.exit(1), 8000);
}
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── 启动 ─────────────────────────────────────────────────────
server.listen(config.port, async () => {
  const ip = getServerIP();
  const proto = config.tls.enabled ? 'https' : 'http';
  await checkAdb();

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║     厂区访客设备本地管控  v2.0  已启动            ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  登录页:     ${proto}://${ip}:${config.port}/login`);
  console.log(`║  管控控制台: ${proto}://${ip}:${config.port}/dashboard`);
  console.log(`║  部署模式:   局域网本地安装（需与手机同网段）      ║`);
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
});
