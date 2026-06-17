'use strict';

const { errorBody, sendError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany, internal } = require('../../utils/errors');

describe('utils/errors', () => {
  describe('errorBody', () => {
    it('returns standard error object with required fields', () => {
      const body = errorBody('TEST_ERR', '测试错误');
      expect(body).toMatchObject({
        error: 'TEST_ERR',
        message: '测试错误',
      });
      expect(body.timestamp).toBeDefined();
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('includes extra fields when provided', () => {
      const body = errorBody('VALIDATION', '无效字段', { field: 'email' });
      expect(body.field).toBe('email');
      expect(body.error).toBe('VALIDATION');
    });

    it('generates unique requestIds', () => {
      const a = errorBody('A', 'a');
      const b = errorBody('B', 'b');
      expect(a.requestId).not.toBe(b.requestId);
    });
  });

  describe('sendError', () => {
    it('sends JSON response with correct status', () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      sendError(res, 418, 'TEAPOT', '我是茶壶');
      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'TEAPOT', message: '我是茶壶' })
      );
    });
  });

  describe('shortcut methods', () => {
    let res;
    beforeEach(() => {
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    it('badRequest sends 400', () => {
      badRequest(res, '参数错误');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'BAD_REQUEST' }));
    });

    it('badRequest supports custom code', () => {
      badRequest(res, '缺少字段', 'MISSING_FIELDS');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'MISSING_FIELDS' }));
    });

    it('unauthorized sends 401', () => {
      unauthorized(res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }));
    });

    it('forbidden sends 403', () => {
      forbidden(res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
    });

    it('notFound sends 404', () => {
      notFound(res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('conflict sends 409', () => {
      conflict(res, '已存在');
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('tooMany sends 429', () => {
      tooMany(res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'RATE_LIMIT_EXCEEDED' }));
    });

    it('internal sends 500', () => {
      internal(res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INTERNAL_ERROR' }));
    });
  });
});
