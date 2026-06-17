'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const { stmts, isSubscriptionActive, refreshSubStatus, subRemainingDays, createSiteWithTrialSubscription, canSubmitPayment, canRequestNetworkRebind, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getClientIp, ipToSubnet, isValidIPv4 } = require('../utils/network');
const config = require('../config');
const { cleanStr, normalizeMac } = require('../utils/sanitize');

function normalizeCandidateFingerprint(raw, fallbackIp) {
  const fp = raw && typeof raw === 'object' ? raw : {};
  const publicIp = cleanStr(fp.publicIp || fallbackIp || '', 64);
  const gatewayIp = cleanStr(fp.gatewayIp || '', 64);
  const subnet =
    cleanStr(fp.lanSubnet || fp.subnet || '', 64) ||
    (isValidIPv4(gatewayIp) ? ipToSubnet(gatewayIp) : '') ||
    (isValidIPv4(publicIp) ? ipToSubnet(publicIp) : '');

  const confidenceRaw = Number(fp.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, Math.round(confidenceRaw))) : 0;

  return {
    lanSubnet: subnet,
    publicIp,
    ssid: cleanStr(fp.ssid || '', 80),
    bssid: normalizeMac(fp.bssid || ''),
    gatewayIp,
    gatewayMac: normalizeMac(fp.gatewayMac || ''),
    source: cleanStr(fp.source || 'user_reported', 40) || 'user_reported',
    confidence,
  };
}

function inferRebindRiskScore({ fingerprint, activeBinding }) {
  let score = 20;
  if (!fingerprint.bssid && !fingerprint.gatewayMac) score += 25;
  if (!fingerprint.ssid) score += 10;
  if (fingerprint.confidence > 0 && fingerprint.confidence < 50) score += 15;
  if (activeBinding && activeBinding.lan_subnet && fingerprint.lanSubnet && activeBinding.lan_subnet !== fingerprint.lanSubnet) {
    score += 25;
  }
  return Math.max(0, Math.min(100, score));
}

function parseFingerprintJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ── 页面 ─────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, (req, res) => {
  if (req.user.is_super_admin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// ── 订阅管理 API ─────────────────────────────────────────────

// GET /api/sites — 当前用户厂区列表
router.get('/api/sites', requireAuth, (req, res) => {
  const sites = stmts.getSitesByUser.all(req.user.id).map(site => {
    const sub = stmts.getSubBySiteId.get(site.id);
    if (!sub) return { ...site, subscription: null };
    refreshSubStatus(sub);
    return {
      ...site,
      subscription: {
        ...sub,
        isActive: isSubscriptionActive(sub),
        remainingDays: subRemainingDays(sub),
      },
    };
  });
  res.json(sites);
});

// POST /api/sites — 创建厂区（自动创建试用订阅）
router.post('/api/sites', requireAuth, (req, res) => {
  const { name, address } = req.body || {};
  const created = createSiteWithTrialSubscription({
    userId: req.user.id,
    siteName: name || '新厂区',
    address: address || '',
    trialDays: config.pricing.trialDays,
  });
  logAudit({
    actorUserId: req.user.id,
    actorRole: 'user',
    siteId: created.siteId,
    action: 'SITE_CREATED',
    targetType: 'site',
    targetId: created.siteId,
    ip: getClientIp(req),
    ua: req.get('user-agent') || '',
    payload: {
      name: cleanStr(name || '新厂区', 50),
      address: cleanStr(address || '', 120),
      subscriptionId: created.subscriptionId,
      trialEndsAt: created.trialEndsAt,
    },
  });
  res.json({ success: true, siteId: created.siteId, subscriptionId: created.subscriptionId });
});

// GET /api/sites/:siteId/network-rebind-requests — 厂区网络重绑申请历史
router.get('/api/sites/:siteId/network-rebind-requests', requireAuth, (req, res) => {
  const site = stmts.getSiteById.get(req.params.siteId);
  if (!site || site.user_id !== req.user.id) return res.status(404).json({ error: 'SITE_NOT_FOUND' });
  const rows = stmts.listRebindRequestsBySite.all(site.id).map(row => ({
    ...row,
    candidate_fingerprint: parseFingerprintJson(row.candidate_fingerprint_json),
    is_high_risk: Number(row.risk_score || 0) >= config.rebind.highRiskScore,
  }));
  res.json(rows);
});

// POST /api/sites/:siteId/network-rebind-requests — 发起网络重绑申请
router.post('/api/sites/:siteId/network-rebind-requests', requireAuth, (req, res) => {
  const site = stmts.getSiteById.get(req.params.siteId);
  if (!site || site.user_id !== req.user.id) return res.status(404).json({ error: 'SITE_NOT_FOUND' });
  const sub = stmts.getSubBySiteId.get(site.id);
  if (!sub) return res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
  refreshSubStatus(sub);
  if (!canRequestNetworkRebind(sub)) {
    return res.status(409).json({
      error: 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_REBIND',
      status: sub.status,
      message: '当前订阅状态不允许发起网络重绑申请',
    });
  }

  const { candidateSubnet, reason, evidence, candidateFingerprint } = req.body || {};
  const clientIp = getClientIp(req);
  const fingerprint = normalizeCandidateFingerprint(candidateFingerprint, clientIp);
  const subnet = cleanStr(candidateSubnet || fingerprint.lanSubnet || ipToSubnet(clientIp) || '', 64);
  if (!subnet) return res.status(400).json({ error: 'INVALID_SUBNET', message: '无法识别候选网络' });
  fingerprint.lanSubnet = subnet;
  if (!fingerprint.publicIp) fingerprint.publicIp = clientIp || '';

  const pending = stmts.getPendingRebindBySiteAndSubnet.get(site.id, subnet);
  if (pending) {
    return res.status(409).json({ error: 'PENDING_REQUEST_EXISTS', requestId: pending.id });
  }

  const activeBinding = stmts.listActiveSiteBindings.all(site.id)[0];
  const riskScore = inferRebindRiskScore({ fingerprint, activeBinding });
  const evidenceText = cleanStr(evidence || '', 500);
  if (riskScore >= config.rebind.highRiskScore && evidenceText.length < config.rebind.minEvidenceForHighRisk) {
    return res.status(400).json({
      error: 'REBIND_EVIDENCE_REQUIRED',
      message: `高风险重绑申请至少需要 ${config.rebind.minEvidenceForHighRisk} 字符证据说明`,
      riskScore,
    });
  }
  const now = Date.now();
  const requestId = uuidv4();
  stmts.insertRebindRequest.run(
    requestId,
    site.id,
    req.user.id,
    subnet,
    fingerprint.publicIp || clientIp || '',
    JSON.stringify(fingerprint),
    evidenceText,
    riskScore,
    (reason || '').trim().slice(0, 300),
    now,
    now
  );
  logAudit({
    actorUserId: req.user.id,
    actorRole: 'user',
    siteId: site.id,
    action: 'NETWORK_REBIND_REQUESTED',
    targetType: 'network_rebind_request',
    targetId: requestId,
    ip: clientIp,
    ua: req.get('user-agent') || '',
    payload: {
      candidateSubnet: subnet,
      candidateIp: fingerprint.publicIp || clientIp || '',
      reason: cleanStr(reason || '', 300),
      evidence: evidenceText,
      riskScore,
      fingerprint,
    },
  });

  res.json({
    success: true,
    requestId,
    status: 'pending_review',
    candidateSubnet: subnet,
    riskScore,
    candidateFingerprint: fingerprint,
  });
});

// GET /api/user/subscriptions — 当前用户所有订阅
router.get('/api/user/subscriptions', requireAuth, (req, res) => {
  const subs = stmts.getSubsByUser.all(req.user.id).map(s => {
    refreshSubStatus(s);
    return {
      ...s,
      isActive:      isSubscriptionActive(s),
      remainingDays: subRemainingDays(s),
    };
  });
  res.json(subs);
});

// POST /api/user/subscriptions — 新增订阅（多厂区）
router.post('/api/user/subscriptions', requireAuth, (req, res) => {
  // 兼容旧前端入口：底层已切换为 site + subscription 一起创建
  const { areaName } = req.body || {};
  const created = createSiteWithTrialSubscription({
    userId: req.user.id,
    siteName: areaName || '新厂区',
    trialDays: config.pricing.trialDays,
  });
  logAudit({
    actorUserId: req.user.id,
    actorRole: 'user',
    siteId: created.siteId,
    action: 'SITE_CREATED',
    targetType: 'site',
    targetId: created.siteId,
    ip: getClientIp(req),
    ua: req.get('user-agent') || '',
    payload: {
      source: 'legacy_subscription_create',
      name: cleanStr(areaName || '新厂区', 50),
      subscriptionId: created.subscriptionId,
      trialEndsAt: created.trialEndsAt,
    },
  });
  res.json({ success: true, siteId: created.siteId, subscriptionId: created.subscriptionId });
});

// PUT /api/user/subscriptions/:subId/area — 修改厂区名称
router.put('/api/user/subscriptions/:subId/area', requireAuth, (req, res) => {
  const sub = stmts.getSubById.get(req.params.subId);
  if (!sub || sub.user_id !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  const name = (req.body.areaName || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'EMPTY_NAME' });
  stmts.updateSubAreaName.run(name, sub.id);
  if (sub.site_id) {
    stmts.updateSiteName.run(name, Date.now(), sub.site_id);
  }
  res.json({ success: true });
});

// PUT /api/user/subscriptions/:subId/features — 修改管控功能开关
router.put('/api/user/subscriptions/:subId/features', requireAuth, (req, res) => {
  const sub = stmts.getSubById.get(req.params.subId);
  if (!sub || sub.user_id !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  const { camera, screenshot } = req.body || {};
  const featureCamera     = camera === false ? 0 : 1;   // 摄像头默认开启
  const featureScreenshot = screenshot === true ? 1 : 0; // 截屏默认关闭
  stmts.updateSubFeatures.run(featureCamera, featureScreenshot, Date.now(), sub.id);
  res.json({ success: true, feature_camera: featureCamera, feature_screenshot: featureScreenshot });
});

// PUT /api/user/subscriptions/:subId/wifi — 修改厂区 WiFi 名称和密码
router.put('/api/user/subscriptions/:subId/wifi', requireAuth, (req, res) => {
  const sub = stmts.getSubById.get(req.params.subId);
  if (!sub || sub.user_id !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  const ssid     = String(req.body.ssid     || '').trim().slice(0, 64);
  const password = String(req.body.password  || '').trim().slice(0, 128);
  stmts.updateSubWifi.run(ssid, password, Date.now(), sub.id);
  res.json({ success: true, wifi_ssid: ssid });
});

// POST /api/user/subscriptions/:subId/bind-ip — 绑定当前 WiFi IP
router.post('/api/user/subscriptions/:subId/bind-ip', requireAuth, (req, res) => {
  const sub = stmts.getSubById.get(req.params.subId);
  if (!sub || sub.user_id !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  refreshSubStatus(sub);
  if (!canRequestNetworkRebind(sub)) {
    return res.status(409).json({
      error: 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_REBIND',
      status: sub.status,
    });
  }

  const ip = getClientIp(req);
  const subnet = ipToSubnet(ip);
  if (!subnet) return res.status(400).json({ error: 'INVALID_IP', clientIp: ip });

  stmts.bindSubIp.run(subnet, sub.id);
  if (sub.site_id) {
    const now = Date.now();
    const existing = stmts.getSiteBindingBySubnet.get(sub.site_id, subnet);
    if (existing) {
      stmts.touchSiteBindingSeenAt.run(now, now, existing.id);
    } else {
      stmts.insertSiteBinding.run(uuidv4(), sub.site_id, subnet, ip, '', '', '', '', 90, 'legacy_bind_ip', now, now, now, now);
    }
  }
  res.json({ success: true, wifiSubnet: subnet });
});

// POST /api/user/subscriptions/:subId/unbind-ip — 解绑（需超管确认，普通用户不能自己解绑）
router.post('/api/user/subscriptions/:subId/unbind-ip', requireAuth, (req, res) => {
  if (!req.user.is_super_admin) {
    return res.status(403).json({ error: 'FORBIDDEN', message: '解绑 WiFi 需联系管理员' });
  }
  const sub = stmts.getSubById.get(req.params.subId);
  if (!sub) return res.status(404).json({ error: 'NOT_FOUND' });
  stmts.unbindSubIp.run(req.params.subId);
  if (sub.site_id) stmts.revokeSiteBindingsBySite.run(Date.now(), sub.site_id);
  res.json({ success: true });
});

// GET /api/user/profile
router.get('/api/user/profile', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, email: u.email, name: u.name, phone: u.phone, createdAt: u.created_at });
});

module.exports = router;
