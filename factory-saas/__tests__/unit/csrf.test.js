'use strict';

jest.mock('../../config', () => ({
  isProd: false,
}));

const { ensureCsrfToken, csrfProtection, CSRF_EXEMPT_PATTERNS } = require('../../middleware/csrf');

describe('middleware/csrf', () => {
  function mockReq(overrides = {}) {
    return {
      method: 'GET',
      cookies: {},
      get: jest.fn(() => null),
      ...overrides,
    };
  }

  function mockRes() {
    const res = {};
    res.cookie = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  describe('ensureCsrfToken', () => {
    it('generates token if not present in cookies', () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      ensureCsrfToken(req, res, next);

      expect(res.cookie).toHaveBeenCalledWith(
        'csrf_token',
        expect.any(String),
        expect.objectContaining({ sameSite: 'Strict' })
      );
      expect(req.csrfToken).toBeDefined();
      expect(req.csrfToken.length).toBe(48); // 24 bytes hex
      expect(next).toHaveBeenCalled();
    });

    it('reuses existing cookie token', () => {
      const req = mockReq({ cookies: { csrf_token: 'existing-token' } });
      const res = mockRes();
      const next = jest.fn();

      ensureCsrfToken(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(req.csrfToken).toBe('existing-token');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('csrfProtection', () => {
    it('skips safe methods (GET, HEAD, OPTIONS)', () => {
      const next = jest.fn();

      ['GET', 'HEAD', 'OPTIONS'].forEach(method => {
        csrfProtection(mockReq({ method }), mockRes(), next);
      });

      expect(next).toHaveBeenCalledTimes(3);
    });

    it('blocks POST without matching csrf tokens', () => {
      const req = mockReq({
        method: 'POST',
        cookies: { csrf_token: 'valid-token' },
        get: jest.fn(() => 'wrong-token'),
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'CSRF_INVALID' })
      );
    });

    it('allows POST with matching csrf tokens', () => {
      const token = 'matching-csrf-token';
      const req = mockReq({
        method: 'POST',
        cookies: { csrf_token: token },
        get: jest.fn((h) => h === 'X-CSRF-Token' ? token : null),
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('blocks when cookie token is missing', () => {
      const req = mockReq({
        method: 'POST',
        cookies: {},
        get: jest.fn(() => 'some-token'),
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks when header token is missing', () => {
      const req = mockReq({
        method: 'POST',
        cookies: { csrf_token: 'valid' },
        get: jest.fn(() => null),
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('CSRF exempt paths', () => {
    const exemptPaths = [
      '/api/checkin',
      '/api/sessions/abc-123/device',
      '/api/sessions/some-uuid/exit',
      '/api/payment/notify',
    ];

    it.each(exemptPaths)('skips CSRF for POST %s', (path) => {
      const req = mockReq({
        method: 'POST',
        cookies: {},               // no csrf cookie
        get: jest.fn(() => null),   // no X-CSRF-Token header
        path,
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    const nonExemptPaths = [
      '/api/checkin/extra',
      '/api/sessions/abc/device/extra',
      '/api/sessions/abc/retry',
      '/api/sessions/abc/force-exit',
      '/api/orders/abc/alipay',
      '/api/auth/login',
    ];

    it.each(nonExemptPaths)('still enforces CSRF for POST %s', (path) => {
      const req = mockReq({
        method: 'POST',
        cookies: {},
        get: jest.fn(() => null),
        path,
      });
      const res = mockRes();
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('CSRF_EXEMPT_PATTERNS covers exactly 4 routes', () => {
      expect(CSRF_EXEMPT_PATTERNS).toHaveLength(4);
    });
  });
});
