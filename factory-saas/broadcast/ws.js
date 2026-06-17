'use strict';
/**
 * broadcast/ws.js — WebSocket 房间管理
 * 支持按 sessionId 和 subscriptionId 分组广播
 * 关键事件持久化到 ws_events 表，支持断线重连补发
 */

const WebSocket = require('ws');

let _wss = null;

// sessionId → Set<WebSocket>
const wsRooms = new Map();

// 需要持久化的关键事件类型（排除高频低价值的 log 事件）
const PERSIST_EVENTS = new Set([
  'sessionCreated', 'sessionUpdate', 'status',
  'tamperAlert', 'deviceDisconnected', 'sessionOverdue',
  'restrictionDegraded', 'exitWithoutDevice',
]);

function init(wss) { _wss = wss; }

function joinRoom(sessionId, ws) {
  if (!wsRooms.has(sessionId)) wsRooms.set(sessionId, new Set());
  wsRooms.get(sessionId).add(ws);
}

function leaveRoom(sessionId, ws) {
  wsRooms.get(sessionId)?.delete(ws);
  if (wsRooms.get(sessionId)?.size === 0) wsRooms.delete(sessionId);
}

/** 将关键事件写入 ws_events 表 */
function persistEvent(subscriptionId, data) {
  if (!subscriptionId || !data || !PERSIST_EVENTS.has(data.event)) return;
  try {
    const { stmts } = require('../db');
    const sessionId = data.sessionId || data.session?.id || '';
    stmts.insertWsEvent.run(
      subscriptionId,
      sessionId,
      data.event,
      JSON.stringify(data),
      Date.now()
    );
  } catch (err) {
    console.error('[WS] 事件持久化失败:', err.message);
  }
}

/** 广播到某个 session 房间（订阅了该 sessionId 的客户端）*/
function broadcast(sessionId, data) {
  const room = wsRooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify(data);
  room.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(msg));
}

/** 广播到所有已连接客户端（用于刷新访客列表）*/
function broadcastAll(data) {
  if (!_wss) return;
  const msg = JSON.stringify(data);
  _wss.clients.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(msg));
}

/** 广播到某个 subscription 下所有客户端（通过 ws.subscriptionId 标记）*/
function broadcastToSub(subscriptionId, data) {
  if (!_wss) return;
  const msg = JSON.stringify(data);
  _wss.clients.forEach(ws => {
    if (ws.subscriptionId === subscriptionId && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
  // 持久化关键事件
  persistEvent(subscriptionId, data);
}

module.exports = { init, joinRoom, leaveRoom, broadcast, broadcastAll, broadcastToSub };
