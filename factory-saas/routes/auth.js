'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();

const { stmts, logAudit }  = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const { getClientIp } = require('../utils/network');
const config = require('../config');
const crypto = require('crypto');

// GET /account (account management page)
router.get('/account', require('../middleware/auth').requireAuth, (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'public', 'account.html'));
});

// GET /login
router.get('/login', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'public', 'login.html')));

// POST /api/auth/login
router.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const emailLc = String(email || '').trim().toLowerCase();
  const ip = getClientIp(req);
  const ua = req.get('user-agent') || '';
  if (!email || !password) return res.status(400).json({ error: 'MISSING_FIELDS' });

  const user = stmts.getUserByEmail.get(emailLc);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit({
      actorRole: 'anonymous',
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'user',
      targetId: emailLc || 'unknown',
      ip,
      ua,
      payload: { reason: 'invalid_credentials' },
    });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' });
  }
  if (user.status === 'suspended') {
    logAudit({
      actorUserId: user.id,
      actorRole: user.is_super_admin ? 'super_admin' : 'user',
      action: 'AUTH_LOGIN_BLOCKED',
      targetType: 'user',
      targetId: user.id,
      ip,
      ua,
      payload: { reason: 'suspended' },
    });
    return res.status(403).json({ error: 'SUSPENDED', message: '账号已被暂停，请联系客服' });
  }

  stmts.updateUserLogin.run(Date.now(), user.id);
  const token = signToken({ userId: user.id, isSuperAdmin: !!user.is_super_admin });
  setAuthCookie(res, token);
  logAudit({
    actorUserId: user.id,
    actorRole: user.is_super_admin ? 'super_admin' : 'user',
    action: 'AUTH_LOGIN_SUCCESS',
    targetType: 'user',
    targetId: user.id,
    ip,
    ua,
    payload: { email: user.email },
  });

  res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: !!user.is_super_admin },
    redirect: '/dashboard',
  });
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/api/auth/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, email: u.email, name: u.name, isSuperAdmin: !!u.is_super_admin });
});

// GET /forgot-password
router.get('/forgot-password', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'public', 'forgot-password.html')));

// POST /api/auth/forgot-password — 发送验证码
router.post('/api/auth/forgot-password', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'MISSING_EMAIL', message: '请输入邮箱' });

  const user = stmts.getUserByEmail.get(email);
  // 无论用户是否存在，都返回成功（防止用户枚举）
  if (!user) return res.json({ success: true, message: '如果邮箱已注册，验证码将发送至您的邮箱' });

  // 限制：每用户每小时最多 5 次
  const recentCount = stmts.countRecentResetTokens.get(user.id, Date.now() - 3600000);
  if (recentCount && recentCount.cnt >= 5) {
    return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: '请求过于频繁，请稍后再试' });
  }

  // 生成 6 位数字验证码
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 分钟
  stmts.insertPasswordResetToken.run(user.id, code, expiresAt, Date.now());

  // 发送邮件
  sendResetEmail(email, code).catch(err => console.error('[SMTP] 发送重置邮件失败:', err));

  logAudit({
    actorUserId: user.id,
    actorRole: 'user',
    action: 'PASSWORD_RESET_REQUESTED',
    targetType: 'user',
    targetId: user.id,
    ip: getClientIp(req),
    ua: req.get('user-agent') || '',
  });

  res.json({ success: true, message: '如果邮箱已注册，验证码将发送至您的邮箱' });
});

// POST /api/auth/reset-password — 验证码 + 新密码
router.post('/api/auth/reset-password', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code  = String(req.body.code || '').trim();
  const newPassword = req.body.newPassword || '';

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: '邮箱、验证码和新密码均为必填' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '密码至少 8 位' });
  }

  const user = stmts.getUserByEmail.get(email);
  if (!user) return res.status(400).json({ error: 'INVALID_CODE', message: '验证码无效或已过期' });

  const token = stmts.getValidResetToken.get(user.id, code, Date.now());
  if (!token) return res.status(400).json({ error: 'INVALID_CODE', message: '验证码无效或已过期' });

  // 标记 token 已使用
  stmts.markResetTokenUsed.run(token.id);

  // 更新密码
  const hash = bcrypt.hashSync(newPassword, 10);
  stmts.updateUserPassword.run(hash, user.id);

  logAudit({
    actorUserId: user.id,
    actorRole: 'user',
    action: 'PASSWORD_RESET_SUCCESS',
    targetType: 'user',
    targetId: user.id,
    ip: getClientIp(req),
    ua: req.get('user-agent') || '',
  });

  res.json({ success: true, message: '密码已重置，请使用新密码登录' });
});

// ── 邮件发送 ────────────────────────────────────────────────
async function sendResetEmail(to, code) {
  if (!config.smtp.host) {
    console.warn('[SMTP] 未配置 SMTP，验证码:', code, '(仅开发环境可见)');
    return;
  }
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch {
    console.warn('[SMTP] nodemailer 未安装，验证码:', code);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: '厂区管控系统 — 密码重置验证码',
    text: `您的密码重置验证码为：${code}\n\n该验证码 15 分钟内有效。如非本人操作，请忽略此邮件。`,
    html: `<p>您的密码重置验证码为：</p><h2 style="letter-spacing:4px">${code}</h2><p>该验证码 15 分钟内有效。如非本人操作，请忽略此邮件。</p>`,
  });
}

module.exports = router;
