'use strict';

const crypto = require('crypto');
const config = require('../config');

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// 这些端点由非浏览器客户端调用，自身携带独立验证机制：
//   /api/checkin           — checkinToken (HMAC-SHA256 签名)
//   /api/sessions/*/device — deviceToken  (timing-safe 对比)
//   /api/sessions/*/exit   — exitToken    (UUID 随机密钥)
//   /api/payment/notify    — 支付宝 RSA2 签名验证
const CSRF_EXEMPT_PATTERNS = [
  /^\/api\/checkin$/,
  /^\/api\/sessions\/[^/]+\/device$/,
  /^\/api\/sessions\/[^/]+\/exit$/,
  /^\/api\/payment\/notify$/,
];

function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

function csrfCookieOptions() {
  return {
    httpOnly: false, // 前端需要读取并写入 X-CSRF-Token 头
    secure: config.isProd,
    sameSite: 'Strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function ensureCsrfToken(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = generateCsrfToken();
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  }
  req.csrfToken = token;
  next();
}

function csrfProtection(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return next();

  // 豁免自带签名/token 验证的非浏览器端点
  const pathname = req.path || req.url?.split('?')[0] || '';
  if (CSRF_EXEMPT_PATTERNS.some(re => re.test(pathname))) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF_INVALID', message: 'CSRF 校验失败' });
  }
  // timing-safe 比较，防止定时攻击逐字节猜解 token
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF_INVALID', message: 'CSRF 校验失败' });
  }
  return next();
}

module.exports = { ensureCsrfToken, csrfProtection, CSRF_EXEMPT_PATTERNS };

