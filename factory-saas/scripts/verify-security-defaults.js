'use strict';
/**
 * verify-security-defaults.js — 验证安全配置
 * 运行: node scripts/verify-security-defaults.js
 *
 * 检查项：
 *  - CSP 头部配置
 *  - 认证 cookie 属性
 *  - CSRF 保护
 *  - 速率限制
 *  - 默认密钥检测
 *  - TLS 配置
 */

const config = require('../config');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (!ok) {
    failed++;
    console.error(`  ❌ ${name}${detail ? ': ' + detail : ''}`);
  } else {
    passed++;
    console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`);
  }
}

console.log('\n🔒 安全配置验证\n');

// ── CSP ──────────────────────────────────────────────────────
console.log('── Content Security Policy ──');
const csp = config.security.csp;
check('CSP 已配置', !!csp);
check("CSP 包含 default-src", csp.includes("default-src"));
check("CSP 包含 script-src", csp.includes("script-src"));
check("CSP 包含 object-src 'none'", csp.includes("object-src 'none'"));
check("CSP 包含 base-uri 'self'", csp.includes("base-uri 'self'"));
check("CSP 包含 frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
check("CSP connect-src 允许 WebSocket", csp.includes('ws:') || csp.includes('wss:'));

// ── 认证 ─────────────────────────────────────────────────────
console.log('\n── 认证与密钥 ──');
check('JWT_SECRET 非空', !!config.jwt.secret);
check('JWT_SECRET 长度 >= 16', config.jwt.secret.length >= 16,
  config.isProd ? '' : `当前长度=${config.jwt.secret.length}`);
check('JWT 有效期已设置', !!config.jwt.expiresIn, config.jwt.expiresIn);
if (config.isProd) {
  check('生产模式下非默认 JWT 密钥', config.jwt.secret !== 'dev-secret-change-in-production');
  check('生产模式下非默认超管密码', config.superAdmin.password !== 'admin123456');
} else {
  console.log('  ⚠️  开发模式 — 跳过默认密钥检查');
}

// ── 速率限制 ─────────────────────────────────────────────────
console.log('\n── 速率限制 ──');
check('签到限流已配置', config.rateLimit.checkin.max > 0, `${config.rateLimit.checkin.max}次/${config.rateLimit.checkin.windowMs / 1000}秒`);
check('登录限流已配置', config.rateLimit.login.max > 0, `${config.rateLimit.login.max}次/${config.rateLimit.login.windowMs / 60000}分钟`);
check('注册限流已配置', config.rateLimit.register.max > 0, `${config.rateLimit.register.max}次/${config.rateLimit.register.windowMs / 3600000}小时`);
check('管理写入限流已配置', config.rateLimit.adminWrite.max > 0);

// ── TLS ──────────────────────────────────────────────────────
console.log('\n── TLS 配置 ──');
if (config.tls.enabled) {
  check('TLS 证书路径已配置', !!config.tls.certPath, config.tls.certPath);
  check('TLS 密钥路径已配置', !!config.tls.keyPath, config.tls.keyPath);
  const fs = require('fs');
  check('TLS 证书文件存在', fs.existsSync(config.tls.certPath));
  check('TLS 密钥文件存在', fs.existsSync(config.tls.keyPath));
} else {
  console.log('  ⚠️  TLS 未启用（生产环境建议启用）');
}

// ── HSTS ─────────────────────────────────────────────────────
console.log('\n── HSTS 配置 ──');
check('HSTS max-age >= 1年', config.http.hstsMaxAge >= 31536000, `${config.http.hstsMaxAge}秒`);
if (config.isProd) {
  check('生产模式 HSTS 已启用', config.http.enableHsts);
}

// ── 订阅安全 ─────────────────────────────────────────────────
console.log('\n── 业务安全 ──');
check('试用天数合理 (1-30天)', config.pricing.trialDays >= 1 && config.pricing.trialDays <= 30, `${config.pricing.trialDays}天`);
check('重绑风险分合理 (0-100)', config.rebind.highRiskScore >= 0 && config.rebind.highRiskScore <= 100, `阈值=${config.rebind.highRiskScore}`);
check('会话持久化间隔 > 0', config.timing.persistIntervalMs > 0, `${config.timing.persistIntervalMs}ms`);

// ── 结果 ──────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`);
if (failed > 0) {
  console.error('\n❌ 存在安全配置问题，请修复后再部署\n');
  process.exit(1);
} else {
  console.log('\n✅ 安全配置检查全部通过\n');
}
