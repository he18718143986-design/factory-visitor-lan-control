'use strict';
/**
 * scripts/expiry-reminder.js — 订阅到期提醒
 * 运行方式：node scripts/expiry-reminder.js
 * 建议通过 cron 每日执行一次
 */

const config = require('../config');
const Database = require('better-sqlite3');

const DB_PATH = config.db.path;

function getExpiringSubscriptions(db, daysAhead) {
  const now = Date.now();
  const targetStart = now;
  const targetEnd = now + daysAhead * 86400000;

  return db.prepare(`
    SELECT s.id, s.user_id, s.area_name, s.plan, s.status, s.paid_ends_at, s.trial_ends_at,
           u.email, u.name AS user_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE u.status = 'active'
      AND (
        (s.status = 'active' AND s.paid_ends_at > ? AND s.paid_ends_at <= ?)
        OR
        (s.status = 'trial' AND s.trial_ends_at > ? AND s.trial_ends_at <= ?)
      )
  `).all(targetStart, targetEnd, targetStart, targetEnd);
}

async function sendReminderEmail(to, userName, areaName, daysLeft, expiryDate) {
  if (!config.smtp.host) {
    console.log(`[DRY-RUN] 提醒 ${to}: "${areaName}" ${daysLeft} 天后到期 (${expiryDate})`);
    return;
  }

  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch {
    console.warn('[SMTP] nodemailer 未安装');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: `厂区管控 — 您的订阅「${areaName}」将在 ${daysLeft} 天后到期`,
    text: [
      `${userName} 您好，`,
      '',
      `您的厂区「${areaName}」订阅将于 ${expiryDate} 到期（剩余 ${daysLeft} 天）。`,
      '',
      '为避免服务中断，请及时续费。',
      '',
      '—— 厂区访客管控系统',
    ].join('\n'),
    html: [
      `<p>${userName} 您好，</p>`,
      `<p>您的厂区「<strong>${areaName}</strong>」订阅将于 <strong>${expiryDate}</strong> 到期（剩余 <strong>${daysLeft}</strong> 天）。</p>`,
      '<p>为避免服务中断，请及时续费。</p>',
      '<p>—— 厂区访客管控系统</p>',
    ].join(''),
  });
}

async function run() {
  const db = new Database(DB_PATH, { readonly: true });
  const reminderDays = [7, 3, 1];
  let totalSent = 0;

  for (const days of reminderDays) {
    const subs = getExpiringSubscriptions(db, days);
    // 只取刚好在 (days-1, days] 天区间的（避免重复通知）
    const now = Date.now();
    const filtered = subs.filter(s => {
      const endsAt = Number(s.paid_ends_at || s.trial_ends_at || 0);
      const daysLeft = Math.ceil((endsAt - now) / 86400000);
      return daysLeft === days;
    });

    for (const sub of filtered) {
      const endsAt = Number(sub.paid_ends_at || sub.trial_ends_at || 0);
      const expiryDate = new Date(endsAt).toLocaleDateString('zh-CN');
      try {
        await sendReminderEmail(sub.email, sub.user_name, sub.area_name, days, expiryDate);
        totalSent++;
        console.log(`[OK] ${sub.email} — "${sub.area_name}" ${days}天后到期`);
      } catch (err) {
        console.error(`[ERR] ${sub.email}:`, err.message);
      }
    }
  }

  db.close();
  console.log(`[完成] 共发送 ${totalSent} 封提醒邮件`);
}

run().catch(err => { console.error('[expiry-reminder] 致命错误:', err); process.exit(1); });
