'use strict';

describe('config/index', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads default config in development mode', () => {
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    const config = require('../../config');
    expect(config.port).toBe(3000);
    expect(config.jwt.secret).toBe('dev-secret-change-in-production');
    expect(config.isProd).toBe(false);
    expect(config.pricing.trialDays).toBe(7);
  });

  it('respects PORT env var', () => {
    process.env.PORT = '8080';
    delete process.env.NODE_ENV;
    const config = require('../../config');
    expect(config.port).toBe(8080);
  });

  it('respects JWT_SECRET env var', () => {
    process.env.JWT_SECRET = 'my-secure-secret-key-12345';
    delete process.env.NODE_ENV;
    const config = require('../../config');
    expect(config.jwt.secret).toBe('my-secure-secret-key-12345');
  });

  it('respects TRIAL_DAYS env var', () => {
    process.env.TRIAL_DAYS = '14';
    delete process.env.NODE_ENV;
    const config = require('../../config');
    expect(config.pricing.trialDays).toBe(14);
  });

  it('TLS defaults to disabled', () => {
    delete process.env.NODE_ENV;
    const config = require('../../config');
    expect(config.tls.enabled).toBe(false);
  });

  it('exits in production mode with default secrets', () => {
    process.env.NODE_ENV = 'production';
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
    expect(() => { require('../../config'); }).toThrow('EXIT');
    mockExit.mockRestore();
  });

  it('does NOT exit in production with custom secrets', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-abcdef';
    process.env.SUPER_ADMIN_PASSWORD = 'SecurePass!2024';
    const config = require('../../config');
    expect(config.isProd).toBe(true);
    expect(config.jwt.secret).toBe('production-secret-abcdef');
  });

  it('parses rate limit config', () => {
    process.env.CHECKIN_RATE_LIMIT_MAX = '20';
    delete process.env.NODE_ENV;
    const config = require('../../config');
    expect(config.rateLimit.checkin.max).toBe(20);
  });
});
