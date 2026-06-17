'use strict';
const os = require('os');

function getServerIP() {
  // 允许通过环境变量覆盖（如模拟器测试用 SERVER_IP=10.0.2.2）
  if (process.env.SERVER_IP) return process.env.SERVER_IP;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function getClientIp(req) {
  const raw = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '').split(',')[0].trim();
  return raw.replace(/^::ffff:/i, '');
}

function ipToSubnet(ip, prefixLen = 24) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.slice(0, 3).join('.');   // /24 — 取前三段
}

function isSameSubnet(ipA, ipB) {
  return ipToSubnet(ipA) === ipToSubnet(ipB);
}

function isValidIPv4(ip) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

function isPrivateIPv4(ip) {
  if (!isValidIPv4(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.some(n => n < 0 || n > 255)) return false;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;
  return false;
}

module.exports = { getServerIP, getClientIp, ipToSubnet, isSameSubnet, isValidIPv4, isPrivateIPv4 };
