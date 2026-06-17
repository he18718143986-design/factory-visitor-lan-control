'use strict';

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-checkin-features.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-checkin-features-secret';
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

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(require('../../routes/checkin'));

  server = http.createServer(app);
});

afterAll(() => {
  if (server) server.close();
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('GET /api/site-features', () => {
  it('returns defaults when siteId is missing', async () => {
    const res = await request(app).get('/api/site-features');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ camera: true, screenshot: false });
  });

  it('returns defaults when siteId is not found', async () => {
    const res = await request(app).get('/api/site-features?siteId=nonexistent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ camera: true, screenshot: false });
  });

  it('does not return wifiSsid field', async () => {
    const res = await request(app).get('/api/site-features?siteId=any');
    expect(res.body).not.toHaveProperty('wifiSsid');
  });

  it('does not return wifiPassword field', async () => {
    const res = await request(app).get('/api/site-features?siteId=any');
    expect(res.body).not.toHaveProperty('wifiPassword');
  });

  it('only returns expected fields for unknown site', async () => {
    const res = await request(app).get('/api/site-features?siteId=unknown');
    const keys = Object.keys(res.body);
    expect(keys).toEqual(expect.arrayContaining(['camera', 'screenshot']));
    expect(keys).not.toContain('wifiSsid');
    expect(keys).not.toContain('wifiPassword');
    expect(keys).not.toContain('wifi_ssid');
    expect(keys).not.toContain('wifi_password');
  });
});
