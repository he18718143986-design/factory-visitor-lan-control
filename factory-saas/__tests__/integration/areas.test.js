'use strict';

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-areas.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-areas-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

let app, server, dbModule;

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

async function loginAsAdmin() {
  const agent = request.agent(app);
  const initRes = await agent.get('/api/auth/me').set('Accept', 'application/json');
  const { map } = parseCookies(initRes);

  await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', map.csrf_token || '')
    .send({ email: 'admin@test.local', password: 'Admin123!' })
    .expect(200);

  return { agent, csrf: map.csrf_token || '' };
}

async function loginAndCreateSite(siteName = '厂区 A') {
  const auth = await loginAsAdmin();
  const user = dbModule.stmts.getUserByEmail.get('admin@test.local');
  const { siteId } = dbModule.createSiteWithTrialSubscription({
    userId: user.id,
    siteName,
    trialDays: 365,
  });
  return { ...auth, siteId, user };
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
  app.use(require('../../routes/areas'));

  server = http.createServer(app);
  dbModule = require('../../db');
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('Areas integration', () => {
  it('lists empty areas for a site', async () => {
    const auth = await loginAndCreateSite('厂区 A');

    const viaAgent = await auth.agent
      .get('/api/areas?siteId=' + encodeURIComponent(auth.siteId))
      .set('Accept', 'application/json');

    expect(viaAgent.status).toBe(200);
    expect(viaAgent.body.areas).toEqual([]);
  });

  it('creates, updates and deletes an area', async () => {
    const auth = await loginAndCreateSite('厂区 B');
    const { siteId } = auth;

    const createRes = await auth.agent
      .post('/api/areas')
      .set('X-CSRF-Token', auth.csrf)
      .send({ siteId, name: 'A 区', sortOrder: 10 });

    expect(createRes.status).toBe(200);
    expect(createRes.body.name).toBe('A 区');
    expect(createRes.body.sortOrder).toBe(10);

    const updateRes = await auth.agent
      .put('/api/areas/' + createRes.body.id)
      .set('X-CSRF-Token', auth.csrf)
      .send({ name: 'B 区', sortOrder: 20 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('B 区');
    expect(updateRes.body.sortOrder).toBe(20);

    const listRes = await auth.agent
      .get('/api/areas?siteId=' + encodeURIComponent(siteId))
      .set('Accept', 'application/json');

    expect(listRes.status).toBe(200);
    expect(listRes.body.areas).toHaveLength(1);
    expect(listRes.body.areas[0].name).toBe('B 区');

    const deleteRes = await auth.agent
      .delete('/api/areas/' + createRes.body.id)
      .set('X-CSRF-Token', auth.csrf);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const listAfterDelete = await auth.agent
      .get('/api/areas?siteId=' + encodeURIComponent(siteId))
      .set('Accept', 'application/json');

    expect(listAfterDelete.status).toBe(200);
    expect(listAfterDelete.body.areas).toEqual([]);
  });

  it('forbids unauthenticated access to areas', async () => {
    const auth = await loginAndCreateSite('厂区 C');

    const res = await request(app)
      .get('/api/areas?siteId=' + encodeURIComponent(auth.siteId))
      .set('Accept', 'application/json');

    expect(res.status).toBe(401);
  });

  it('validates required fields', async () => {
    const auth = await loginAsAdmin();

    const res = await auth.agent
      .post('/api/areas')
      .set('X-CSRF-Token', auth.csrf)
      .send({ siteId: '', name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_SITE_ID');
  });
});
