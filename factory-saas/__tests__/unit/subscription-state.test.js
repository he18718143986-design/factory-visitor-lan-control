'use strict';

const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '..', '..', 'data', 'test-subscription-state.db');
process.env.DB_PATH = testDbPath;
process.env.DB_AUTO_MIGRATE = 'true';
process.env.JWT_SECRET = 'test-subscription-state-secret';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'Admin123!';

const {
  getSubscriptionLifecycleState,
  canIssueQr,
} = require('../../db');

afterAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('subscription lifecycle state machine', () => {
  it('keeps trial subscription as trial before end', () => {
    const now = Date.now();
    const sub = {
      status: 'trial',
      trial_ends_at: now + 3600_000,
    };
    expect(getSubscriptionLifecycleState(sub, now)).toBe('trial');
  });

  it('expires trial subscription after trial end', () => {
    const now = Date.now();
    const sub = {
      status: 'trial',
      trial_ends_at: now - 1,
    };
    expect(getSubscriptionLifecycleState(sub, now)).toBe('expired');
  });

  it('keeps paid subscription active before paid end', () => {
    const now = Date.now();
    const sub = {
      status: 'active',
      paid_ends_at: now + 3600_000,
    };
    expect(getSubscriptionLifecycleState(sub, now)).toBe('active');
  });

  it('moves active subscription into grace after paid end when grace is enabled', () => {
    const now = Date.now();
    const sub = {
      status: 'active',
      paid_ends_at: now - 1000,
      grace_ends_at: now + 3600_000,
    };
    expect(getSubscriptionLifecycleState(sub, now, { enableGracePeriod: true, graceDays: 7 })).toBe('grace');
  });

  it('expires grace subscription after grace end', () => {
    const now = Date.now();
    const sub = {
      status: 'grace',
      paid_ends_at: now - 8 * 86400000,
      grace_ends_at: now - 1,
    };
    expect(getSubscriptionLifecycleState(sub, now, { enableGracePeriod: true, graceDays: 7 })).toBe('expired');
  });

  it('allows issue during grace when policy allows it', () => {
    const now = Date.now();
    const sub = {
      status: 'grace',
      paid_ends_at: now - 1000,
      grace_ends_at: now + 3600_000,
    };
    expect(canIssueQr(sub, { enableGracePeriod: true, allowIssueInGrace: true, graceDays: 7 })).toBe(true);
  });

  it('denies issue during grace when policy forbids it', () => {
    const now = Date.now();
    const sub = {
      status: 'grace',
      paid_ends_at: now - 1000,
      grace_ends_at: now + 3600_000,
    };
    expect(canIssueQr(sub, { enableGracePeriod: true, allowIssueInGrace: false, graceDays: 7 })).toBe(false);
  });
});
