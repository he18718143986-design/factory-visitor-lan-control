'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { stmts } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/areas?siteId= — 列出厂区的区域
router.get('/api/areas', requireAuth, (req, res) => {
  const siteId = (req.query.siteId || '').trim();
  if (!siteId) return res.status(400).json({ error: 'MISSING_SITE_ID' });

  const sub = stmts.getSubBySiteId.get(siteId);
  if (!sub || (sub.user_id !== req.user.id && !req.user.is_super_admin)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const areas = stmts.listAreasBySub.all(sub.id);
  res.json({ areas });
});

// POST /api/areas — 新增区域
router.post('/api/areas', requireAuth, (req, res) => {
  const siteId = (req.body.siteId || '').trim();
  const name = (req.body.name || '').trim().slice(0, 50);
  const sortOrder = Number(req.body.sortOrder) || 0;

  if (!siteId) return res.status(400).json({ error: 'MISSING_SITE_ID' });
  if (!name) return res.status(400).json({ error: 'MISSING_NAME' });

  const sub = stmts.getSubBySiteId.get(siteId);
  if (!sub || (sub.user_id !== req.user.id && !req.user.is_super_admin)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  // 限制每个厂区最多 50 个区域
  const existing = stmts.listAreasBySub.all(sub.id);
  if (existing.length >= 50) {
    return res.status(400).json({ error: 'AREA_LIMIT_REACHED', message: '每个厂区最多 50 个区域' });
  }

  const id = uuidv4();
  const now = Date.now();
  stmts.insertArea.run(id, sub.id, name, sortOrder, now, now);
  res.json({ id, subscriptionId: sub.id, name, sortOrder, createdAt: now, updatedAt: now });
});

// PUT /api/areas/:id — 更新区域
router.put('/api/areas/:id', requireAuth, (req, res) => {
  const area = stmts.getAreaById.get(req.params.id);
  if (!area) return res.status(404).json({ error: 'NOT_FOUND' });

  const sub = stmts.getSubById.get(area.subscription_id);
  if (!sub || (sub.user_id !== req.user.id && !req.user.is_super_admin)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const name = (req.body.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'MISSING_NAME' });
  const sortOrder = req.body.sortOrder !== undefined ? Number(req.body.sortOrder) || 0 : area.sort_order;
  const now = Date.now();

  stmts.updateArea.run(name, sortOrder, now, area.id);
  res.json({ id: area.id, subscriptionId: area.subscription_id, name, sortOrder, createdAt: area.created_at, updatedAt: now });
});

// DELETE /api/areas/:id — 删除区域
router.delete('/api/areas/:id', requireAuth, (req, res) => {
  const area = stmts.getAreaById.get(req.params.id);
  if (!area) return res.status(404).json({ error: 'NOT_FOUND' });

  const sub = stmts.getSubById.get(area.subscription_id);
  if (!sub || (sub.user_id !== req.user.id && !req.user.is_super_admin)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  stmts.deleteArea.run(area.id);
  res.json({ success: true });
});

module.exports = router;
