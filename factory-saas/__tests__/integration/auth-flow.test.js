'use strict';

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-auth-flow.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-auth-flow-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

let app, server;

function parseCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  const map = {};
  raw.forEach(c => {
    const [kv] = c.split(';');
    const [k, ...v] = kv.split('=');
    map[k.trim()] = decodeURIComponent(v.join('='));
  });
  return { map, str: raw.map(c => c.split(';')[0]).join('; ') };
}

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
  app.use(require('../../routes/auth'));
  app.use(require('../../routes/user'));

  server = http.createServer(app);
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('Auth Flow Integration (local deployment)', () => {
  it('should login as local admin with correct credentials', async () => {
    const initRes = await request(app).get('/api/auth/me').set('Accept', 'application/json');
    const { map, str } = parseCookies(initRes);

    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', str)
      .set('X-CSRF-Token', map.csrf_token || '')
      .send({ email: 'admin@test.local', password: 'Admin123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe('/dashboard');
  });

  it('should reject wrong password', async () => {
    const initRes = await request(app).get('/api/auth/me').set('Accept', 'application/json');
    const { map, str } = parseCookies(initRes);

    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', str)
      .set('X-CSRF-Token', map.csrf_token || '')
      .send({ email: 'admin@test.local', password: 'WrongPass!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('should access authenticated endpoint with cookie', async () => {
    const initRes = await request(app).get('/api/auth/me').set('Accept', 'application/json');
    const { map: initMap, str: initStr } = parseCookies(initRes);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Cookie', initStr)
      .set('X-CSRF-Token', initMap.csrf_token || '')
      .send({ email: 'admin@test.local', password: 'Admin123!' });

    const loginCookies = parseCookies(loginRes);
    const combined = [initStr, loginCookies.str].filter(Boolean).join('; ');

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', combined)
      .set('Accept', 'application/json');

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('admin@test.local');
  });

  it('should reject unauthenticated JSON access', async () => {
    const res = await request(app)
      .get('/api/user/subscriptions')
      .set('Accept', 'application/json');

    expect(res.status).toBe(401);
  });
});
