'use strict';

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const err = document.getElementById('errBox');
  btn.disabled = true; btn.textContent = '登录中…'; err.style.display = 'none';
  try {
    const csrf = readCookie('csrf_token');
    const r = await fetch('/api/auth/login', {
      method:'POST',
      credentials:'include',
      headers:{
        'Content-Type':'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body:JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }),
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.message || '登录失败'; err.style.display = 'block'; return; }
    window.location.href = d.redirect || '/dashboard';
  } catch(ex) { err.textContent = '网络错误，请稍后重试'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = '登 录'; }
});
