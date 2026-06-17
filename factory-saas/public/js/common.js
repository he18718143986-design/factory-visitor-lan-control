'use strict';
/**
 * common.js — 前端共享工具函数
 */

function readCookie(name) {
  const key = `${name}=`;
  const found = document.cookie.split(';').map(s => s.trim()).find(v => v.startsWith(key));
  return found ? decodeURIComponent(found.slice(key.length)) : '';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
