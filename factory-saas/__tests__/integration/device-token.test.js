'use strict';

const request  = require('supertest');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-device-token.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-device-token-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

let app, server;

// We need to test the /api/sessions/:id/device endpoint with a real session in the store.
// To do that we manually inject a session via the store module.

beforeAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}

  jest.resetModules();
  const express = require('express');

  app = express();
  app.use(express.json());
  app.use(require('../../routes/device'));

  server = http.createServer(app);
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

function createTestSession(overrides = {}) {
  const { setSession } = require('../../sessions/store');
  const id = crypto.randomUUID();
  const deviceToken = crypto.randomBytes(16).toString('hex');
  const session = {
    id,
    subscriptionId: 'test-sub-1',
    userId: 'test-user-1',
    visitorName: 'Test',
    visitorCompany: '',
    area: 'A区',
    wifiSsid: '',
    wifiPassword: '',
    exitToken: crypto.randomUUID(),
    deviceToken,
    status: 'waiting',
    deviceId: null,
    deviceIp: null,
    checkinRequestIp: '127.0.0.1',
    adbServiceName: 'svc',
    adbPassword: 'pwd',
    createdAt: new Date(),
    restrictedAt: null,
    exitedAt: null,
    logs: [],
    entryQR: '',
    exitQR: '',
    selfCheckin: true,
    ...overrides,
  };
  setSession(session);
  return session;
}

describe('POST /api/sessions/:id/device — deviceToken validation', () => {
  it('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .post('/api/sessions/nonexistent/device')
      .send({ deviceIp: '192.168.1.100', deviceToken: 'abc' });
    expect(res.status).toBe(404);
  });

  it('returns 401 when deviceToken is missing from request', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '192.168.1.100' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('MISSING_DEVICE_TOKEN');
  });

  it('returns 401 when deviceToken is wrong', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '192.168.1.100', deviceToken: 'wrong-token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_DEVICE_TOKEN');
  });

  it('returns 200 when deviceToken is correct', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '192.168.1.100', deviceToken: session.deviceToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 when session status is not waiting/pairing', async () => {
    const session = createTestSession({ status: 'restricted' });
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '192.168.1.100', deviceToken: session.deviceToken });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_STATUS');
  });

  it('returns 400 when deviceIp is missing', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceToken: session.deviceToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_DEVICE_IP');
  });

  it('returns 400 when deviceIp is a public IP', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '8.8.8.8', deviceToken: session.deviceToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_DEVICE_IP');
  });

  it('returns 400 when deviceIp is not a valid IPv4', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: 'not-an-ip', deviceToken: session.deviceToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_DEVICE_IP');
  });

  it('accepts 10.x.x.x private IP', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '10.0.1.50', deviceToken: session.deviceToken });
    expect(res.status).toBe(200);
  });

  it('accepts 172.16.x.x private IP', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '172.16.0.1', deviceToken: session.deviceToken });
    expect(res.status).toBe(200);
  });

  it('accepts 172.31.x.x private IP upper bound', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '172.31.255.255', deviceToken: session.deviceToken });
    expect(res.status).toBe(200);
  });

  it('rejects 172.15.x.x just below private range', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '172.15.0.1', deviceToken: session.deviceToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_DEVICE_IP');
  });

  it('rejects 172.32.x.x just above private range', async () => {
    const session = createTestSession();
    const res = await request(app)
      .post(`/api/sessions/${session.id}/device`)
      .send({ deviceIp: '172.32.0.1', deviceToken: session.deviceToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_DEVICE_IP');
  });
});
