'use strict';
(function () {
  const wechatOnly  = document.getElementById('wechatOnly');
  const browserFlow = document.getElementById('browserFlow');
  const statusBox   = document.getElementById('statusBox');
  const statusMain  = document.getElementById('statusMain');
  const statusSub   = document.getElementById('statusSub');
  const errorBox   = document.getElementById('errorBox');
  const networkWarn = document.getElementById('network-warn');
  const inputName  = document.getElementById('visitorName');
  const inputCompany = document.getElementById('visitorCompany');
  const btnStart   = document.getElementById('submit-btn');

  const isWechat = /MicroMessenger/i.test(navigator.userAgent);
  const urlParams = new URLSearchParams(location.search);
  const areaParam = urlParams.get('area') || '';
  const siteIdParam = urlParams.get('siteId') || '';
  const checkinTokenParam = urlParams.get('t') || '';

  if (isWechat) {
    wechatOnly.classList.add('show');
    browserFlow.classList.add('show');
  } else {
    wechatOnly.classList.remove('show');
    browserFlow.classList.add('show');
  }

  // 加载厂区功能信息
  async function loadSiteFeatures() {
    if (!siteIdParam) return;
    try {
      const res = await fetch('/api/site-features?siteId=' + encodeURIComponent(siteIdParam));
      if (!res.ok) return;
      const data = await res.json();

      // 管控内容徽章
      const badges = [];
      if (data.camera)     badges.push('📷 禁止拍照');
      if (data.screenshot) badges.push('🖼️ 禁止截屏/录屏');
      if (badges.length === 0) return;
      const container = document.getElementById('controlsBadges');
      const wrapper   = document.getElementById('controlsInfo');
      if (!container || !wrapper) return;
      container.innerHTML = badges.map(b => `<span class="badge">${b}</span>`).join('');
      wrapper.classList.add('show');
    } catch(e) { /* 非关键功能，静默失败 */ }
  }

  // 页面加载时检测网络，给用户即时反馈
  async function checkNetwork() {
    // 先加载 WiFi 信息
    await loadSiteFeatures();
    try {
      const res  = await fetch('/api/network-check');
      const data = await res.json();
      if (!data.sameNetwork) {
        showWifiWarning();
        btnStart.disabled = true;
      } else {
        networkWarn.style.display = 'none';
        btnStart.disabled = false;
      }
    } catch (e) {
      showWifiWarning();
      btnStart.disabled = true;
    }
  }

  function showWifiWarning() {
    let html = '⚠️ 您的手机未连接厂区 Wi-Fi，无法完成入场登记。<br>';
    html += '请先在手机「设置 → Wi-Fi」中连接厂区网络，再重新扫码。';
    networkWarn.innerHTML = html;
    networkWarn.style.display = 'block';
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  checkNetwork();

  function setStatus(main, sub, isError) {
    statusMain.textContent = main;
    statusSub.textContent  = sub || '';
    if (isError) statusBox.classList.add('err');
    else statusBox.classList.remove('err');
  }

  function showError(msg) {
    errorBox.style.display = 'block';
    errorBox.textContent   = msg;
    setStatus('操作失败', '请联系门卫协助或稍后重试。', true);
  }

  btnStart.addEventListener('click', () => {
    const name = (inputName.value || '').trim();
    const company = (inputCompany.value || '').trim();
    if (!name) {
      showError('请先填写姓名再开始登记。');
      return;
    }
    errorBox.style.display = 'none';
    runBrowserFlow(name, company);
  });

  async function runBrowserFlow(name, company) {
    try {
      setStatus('正在登记入场…', '向服务器申请本次来访会话');

      const payload = { name };
      if (company) payload.company = company;
      if (areaParam) payload.area = areaParam;
      if (siteIdParam) payload.siteId = siteIdParam;
      if (checkinTokenParam) payload.checkinToken = checkinTokenParam;
      const csrf = readCookie('csrf_token');

      const res = await fetch('/api/checkin', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('服务器返回 ' + res.status);
      const data = await res.json();
      const sessionId = data.sessionId;
      const deviceToken = data.deviceToken || '';

      // 登记完成后统一跳转到下一步页面，由 welcome-bridge 负责后续唤起 APP / 下载
      setStatus('登记完成', isWechat
        ? '正在跳转到下一步页面，请稍后…'
        : '正在跳转到下一步页面，请稍后…');
      let nextUrl = '/welcome-bridge?sessionId=' + encodeURIComponent(sessionId);
      if (areaParam) nextUrl += '&area=' + encodeURIComponent(areaParam);
      if (deviceToken) nextUrl += '&dt=' + encodeURIComponent(deviceToken);
      window.location.href = nextUrl;
    } catch (e) {
      console.error(e);
      showError(e.message || String(e));
    }
  }
})();
