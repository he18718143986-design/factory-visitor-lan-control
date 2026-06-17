'use strict';

function cleanStr(v, max = 120) {
  return String(v || '').trim().slice(0, max);
}

function normalizeMac(v) {
  const s = cleanStr(v, 32).replace(/-/g, ':').toLowerCase();
  if (!s) return '';
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(s)) return '';
  return s;
}

module.exports = { cleanStr, normalizeMac };
