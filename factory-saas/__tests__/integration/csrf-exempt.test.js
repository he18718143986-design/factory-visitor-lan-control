'use strict';

/**
 * Integration test: CSRF exempt paths work through the full middleware stack.
 * Validates that Android-facing and payment-callback endpoints are not blocked
 * by the global csrfProtection middleware (Blocker B-1 / B-2 fix).
 */

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-csrf-exempt.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-csrf-exempt-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

let app, server;

beforeAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}

  jest.resetModules();
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { ensureCsrfToken, csrfProtection } = require('../../middleware/csrf');

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(ensureCsrfToken);
  app.use(csrfProtection);
  app.use(require('../../routes/checkin'));
  app.use(require('../../routes/device'));
  app.use(require('../../routes/auth'));

  server = http.createServer(app);
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('CSRF exempt paths (full middleware stack)', () => {
  // ── B-1: Android-called endpoints should NOT return 403 CSRF_INVALID ──

  it('POST /api/checkin without CSRF tokens is not blocked by CSRF', async () => {
    // Will fail on business logic (missing token etc.) but NOT on CSRF
    const res = await request(server)
      .post('/api/checkin')
      .send({ name: 'test' });

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe('CSRF_INVALID');
  });

  it('POST /api/sessions/:id/device without CSRF tokens is not blocked by CSRF', async () => {
    const fakeId = crypto.randomUUID();
    const res = await request(server)
      .post(`/api/sessions/${fakeId}/device`)
      .send({ deviceToken: 'aabbccdd', deviceIp: '192.168.1.100' });

    // Should get 404 (session not found) — not 403 CSRF
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe('CSRF_INVALID');
  });

  it('POST /api/sessions/:id/exit without CSRF tokens is not blocked by CSRF', async () => {
    const fakeId = crypto.randomUUID();
    const res = await request(server)
      .post(`/api/sessions/${fakeId}/exit`)
      .send({ exitToken: 'fake-token' });

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe('CSRF_INVALID');
  });

  // ── Non-exempt paths should STILL be protected ──

  it('POST /api/auth/login without CSRF tokens returns 403 CSRF_INVALID', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'password' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_INVALID');
  });

  it('POST /api/user/subscriptions without CSRF tokens returns 403 CSRF_INVALID', async () => {
    const res = await request(server)
      .post('/api/user/subscriptions')
      .send({ areaName: 'test' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_INVALID');
  });
});
