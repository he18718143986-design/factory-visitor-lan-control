'use strict';
/**
 * utils/errors.js — 统一错误响应格式
 *
 * 所有 API 错误应使用此模块返回：
 *   { error: 'ERROR_CODE', message: '用户可见文案', timestamp, requestId }
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 构建标准错误响应对象
 * @param {string} code   - 错误码 (如 'UNAUTHORIZED', 'VALIDATION_ERROR')
 * @param {string} message - 用户可见的错误描述
 * @param {object} [extra] - 额外字段 (如 { field: 'email' })
 */
function errorBody(code, message, extra = {}) {
  return {
    error:     code,
    message:   message,
    timestamp: new Date().toISOString(),
    requestId: uuidv4(),
    ...extra,
  };
}

/**
 * 发送标准错误响应
 */
function sendError(res, status, code, message, extra) {
  return res.status(status).json(errorBody(code, message, extra));
}

// ── 常用快捷方法 ─────────────────────────────────────────────

function badRequest(res, message = '请求参数无效', code = 'BAD_REQUEST') {
  return sendError(res, 400, code, message);
}

function unauthorized(res, message = '未登录或登录已过期') {
  return sendError(res, 401, 'UNAUTHORIZED', message);
}

function forbidden(res, message = '无权执行此操作') {
  return sendError(res, 403, 'FORBIDDEN', message);
}

function notFound(res, message = '资源不存在') {
  return sendError(res, 404, 'NOT_FOUND', message);
}

function conflict(res, message = '资源冲突', code = 'CONFLICT') {
  return sendError(res, 409, code, message);
}

function tooMany(res, message = '请求过于频繁，请稍后重试') {
  return sendError(res, 429, 'RATE_LIMIT_EXCEEDED', message);
}

function internal(res, message = '服务器内部错误') {
  return sendError(res, 500, 'INTERNAL_ERROR', message);
}

module.exports = {
  errorBody,
  sendError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  internal,
};
