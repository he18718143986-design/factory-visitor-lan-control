'use strict';

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-checkin-flow.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-checkin-flow-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

let app, server, dbModule;

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signCheckinPayload(payloadObj) {
  const payload = b64urlEncode(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

function createCheckinToken(siteId, area = 'A区') {
  return signCheckinPayload({
    v: 1,
    siteId,
    area,
    iat: Date.now(),
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomUUID(),
  });
}

beforeAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}

  jest.resetModules();
  const express = require('express');

  app = express();
  app.use(express.json());
  app.use(require('../../routes/checkin'));

  server = http.createServer(app);
  dbModule = require('../../db');
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('POST /api/checkin', () => {
  it('returns MISSING_CHECKIN_TOKEN when token is absent', async () => {
    const res = await request(app)
      .post('/api/checkin')
      .send({ name: '张三' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_CHECKIN_TOKEN');
  });

  it('returns CHECKIN_SITE_MISMATCH when body siteId differs from token siteId', async () => {
    const userId = crypto.randomUUID();
    dbModule.stmts.insertUser.run(userId, 'checkin1@test.local', 'hash', 'U1', '', Date.now());
    const { siteId } = dbModule.createSiteWithTrialSubscription({ userId, siteName: '厂区1', trialDays: 7 });
    const otherSiteId = crypto.randomUUID();
    const token = createCheckinToken(siteId, 'A区');

    const res = await request(app)
      .post('/api/checkin')
      .send({ name: '张三', siteId: otherSiteId, checkinToken: token });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CHECKIN_SITE_MISMATCH');
  });

  it('reuses existing waiting session and returns the same deviceToken', async () => {
    const userId = crypto.randomUUID();
    dbModule.stmts.insertUser.run(userId, 'checkin2@test.local', 'hash', 'U2', '', Date.now());
    const { siteId } = dbModule.createSiteWithTrialSubscription({ userId, siteName: '厂区2', trialDays: 7 });
    const token = createCheckinToken(siteId, 'B区');

    const first = await request(app)
      .post('/api/checkin')
      .send({ name: '李四', siteId, checkinToken: token });

    expect(first.status).toBe(200);
    expect(first.body.sessionId).toBeTruthy();
    expect(first.body.deviceToken).toBeTruthy();

    const second = await request(app)
      .post('/api/checkin')
      .send({ name: '李四', siteId, checkinToken: token });

    expect(second.status).toBe(200);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(second.body.deviceToken).toBe(first.body.deviceToken);
  });
});
