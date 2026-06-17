'use strict';
/**
 * sessions/patrol.js — 摄像头权限巡检模块
 *
 * 在厂期间，周期性通过 ADB 检查处于 restricted 状态的设备：
 *   1. 相机/录屏 APP 是否仍被冻结
 *   2. 关键 APP 的 CAMERA appops 是否仍为 deny
 *   3. 截屏策略是否仍生效
 *
 * 如检测到权限被手动恢复（篡改），立即：
 *   - 重新下发管控 ADB 命令
 *   - 广播告警到管理端 dashboard
 *   - 记录篡改日志到会话
 */

const config = require('../config');
const { getSessions, markDirty } = require('./store');
const { serializeSession } = require('./serialize');
const { broadcastToSub } = require('../broadcast/ws');
const adb = require('../adb');
const { stmts } = require('../db');

// 巡检间隔从 config 读取，默认 30 秒
const PATROL_INTERVAL_MS = config.timing.patrolIntervalMs;

// 单次巡检中每个设备的最大 ADB 检查耗时
const PER_DEVICE_TIMEOUT_MS = 15000;

// 防止并发巡检
let patrolRunning = false;

function getSubFeatures(subscriptionId) {
  const sub = stmts.getSubById.get(subscriptionId);
  if (!sub) return { camera: true, screenshot: true };
  return { camera: !!sub.feature_camera, screenshot: !!sub.feature_screenshot };
}

/**
 * 对单个设备执行摄像头权限巡检。
 * 返回 { intact, details } 或 null（设备不可达时）。
 */
async function patrolDevice(session) {
  const deviceId = session.deviceId;
  if (!deviceId) return null;

  try {
    const features = getSubFeatures(session.subscriptionId);
    const report = await adb.verifyRestrictions(deviceId, () => {}, features);
    return report;
  } catch {
    // 设备不可达（ADB 断开），跳过本轮巡检
    return null;
  }
}

/**
 * 对篡改设备重新下发管控命令。
 */
async function reApplyRestrictions(session) {
  const deviceId = session.deviceId;
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const logFn = (msg) => session.logs.push(`[${ts}] [巡检修复] ${msg}`);
  const features = getSubFeatures(session.subscriptionId);

  try {
    await adb.applyRestrictions(deviceId, logFn, features);
    session.logs.push(`[${ts}] ✅ 巡检：已重新下发管控命令`);
  } catch (e) {
    session.logs.push(`[${ts}] ⚠️ 巡检：重新下发管控失败 — ${e.message}`);
  }
}

/**
 * 执行一轮巡检：扫描所有 restricted 状态的会话。
 */
async function patrolTick() {
  if (patrolRunning) return;
  patrolRunning = true;

  try {
    const { db } = require('../db');
    const subs = db
      .prepare('SELECT DISTINCT subscription_id FROM visitor_sessions')
      .all();

    for (const { subscription_id: subId } of subs) {
      const sessions = getSessions(subId);
      for (const [id, session] of sessions) {
        // 只巡检处于 restricted 状态且已有设备连接的会话
        if (session.status !== 'restricted' || !session.deviceId) continue;

        const report = await patrolDevice(session);
        if (!report) continue; // 设备不可达，跳过

        if (!report.intact) {
          const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const details = [];

          if (report.unfrozenPkgs && report.unfrozenPkgs.length) {
            details.push(`相机/录屏 APP 被解冻: ${report.unfrozenPkgs.join(', ')}`);
          }
          if (report.cameraAllowedPkgs && report.cameraAllowedPkgs.length) {
            details.push(`摄像头权限被恢复: ${report.cameraAllowedPkgs.join(', ')}`);
          }
          if (!report.screenCaptureOk) {
            details.push('截屏策略被关闭');
          }

          const detailText = details.join('；');

          // 记录到会话
          session.tamperDetected = true;
          if (!session.tamperDetails) session.tamperDetails = [];
          session.tamperDetails.push({
            type: 'patrol_detected',
            ts: Date.now(),
            detail: detailText,
          });
          session.logs.push(
            `[${ts}] 🚨 巡检发现篡改：${detailText}`
          );
          markDirty();

          // 广播告警到管理端
          broadcastToSub(subId, {
            event: 'tamperAlert',
            sessionId: id,
            visitorName: session.visitorName,
            area: session.area,
            details: details,
            message: `巡检发现管控被篡改：${detailText}`,
            autoReapply: true,
          });

          // 立即重新下发管控
          await reApplyRestrictions(session);
          markDirty();

          // 更新管理端的会话状态
          broadcastToSub(subId, {
            event: 'sessionUpdate',
            session: serializeSession(session),
          });
        }
      }
    }
  } catch (e) {
    console.error('[Patrol] 巡检异常:', e.message);
  } finally {
    patrolRunning = false;
  }
}

let _timer = null;

function start() {
  if (_timer) return;
  console.log(`[Patrol] 摄像头权限巡检已启动，间隔 ${PATROL_INTERVAL_MS / 1000}s`);
  _timer = setInterval(patrolTick, PATROL_INTERVAL_MS);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, patrolTick };
