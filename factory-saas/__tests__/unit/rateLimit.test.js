'use strict';

// Must mock ../config and ../utils/network BEFORE requiring rateLimit
jest.mock('../../config', () => ({
  rateLimit: {
    checkin:       { max: 10, windowMs: 60000 },
    login:         { max: 8,  windowMs: 900000 },
    register:      { max: 5,  windowMs: 3600000 },
    adminWrite:    { max: 60, windowMs: 60000 },
    paymentReview: { max: 20, windowMs: 60000 },
    rebindReview:  { max: 30, windowMs: 60000 },
  },
}));

jest.mock('../../utils/network', () => ({
  getClientIp: jest.fn(() => '10.0.0.1'),
}));

const { createRateLimiter } = require('../../middleware/rateLimit');

describe('middleware/rateLimit', () => {
  function mockReq(overrides = {}) {
    return {
      headers: {},
      connection: { remoteAddress: '10.0.0.1' },
      body: {},
      ...overrides,
    };
  }

  function mockRes() {
    const res = { headers: {} };
    res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  it('allows requests within limit window', () => {
    const limiter = createRateLimiter({ name: 'test-allow', max: 3, windowMs: 60000 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.headers['X-RateLimit-Limit']).toBe('3');
    expect(res.headers['X-RateLimit-Remaining']).toBe('2');
  });

  it('blocks requests over limit', () => {
    const limiter = createRateLimiter({ name: 'test-block', max: 2, windowMs: 60000 });
    const req = mockReq();
    const next = jest.fn();

    // First 2 requests pass
    limiter(req, mockRes(), next);
    limiter(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    // Third request blocked
    const res = mockRes();
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2); // not called again
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'RATE_LIMITED' })
    );
  });

  it('sets Retry-After header on 429', () => {
    const limiter = createRateLimiter({ name: 'test-retry', max: 1, windowMs: 60000 });
    const req = mockReq();

    limiter(req, mockRes(), jest.fn()); // use up limit
    const res = mockRes();
    limiter(req, res, jest.fn());
    expect(res.headers['Retry-After']).toBeDefined();
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('uses custom message', () => {
    const limiter = createRateLimiter({ name: 'test-msg', max: 1, windowMs: 60000, message: '太快了' });
    const req = mockReq();

    limiter(req, mockRes(), jest.fn());
    const res = mockRes();
    limiter(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '太快了' })
    );
  });

  it('uses custom key function', () => {
    const limiter = createRateLimiter({
      name: 'test-key',
      max: 1,
      windowMs: 60000,
      keyFn: (req) => req.body.email || 'anon',
    });
    const next = jest.fn();

    // Different keys should have separate limits
    limiter(mockReq({ body: { email: 'a@a.com' } }), mockRes(), next);
    limiter(mockReq({ body: { email: 'b@b.com' } }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2); // both pass

    // Same key exhausts limit
    const res = mockRes();
    limiter(mockReq({ body: { email: 'a@a.com' } }), res, next);
    expect(next).toHaveBeenCalledTimes(2); // blocked
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('shows 0 remaining at limit boundary', () => {
    const limiter = createRateLimiter({ name: 'test-boundary', max: 1, windowMs: 60000 });
    const res = mockRes();
    limiter(mockReq(), res, jest.fn());
    expect(res.headers['X-RateLimit-Remaining']).toBe('0');
  });
});
