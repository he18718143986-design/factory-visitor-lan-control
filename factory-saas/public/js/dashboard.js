// ── 认证 ─────────────────────────────────────────────────────
let _currentSubId  = localStorage.getItem('dashboard_sub_id') || null;
let _currentSiteId = localStorage.getItem('dashboard_site_id') || null;

function readCookie(name) {
  const key = `${name}=`;
  const found = document.cookie.split(';').map(s => s.trim()).find(v => v.startsWith(key));
  return found ? decodeURIComponent(found.slice(key.length)) : '';
}

async function fetchWithAuth(url, opts={}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type':'application/json', ...(opts.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const r = await fetch(url, { ...opts, method, headers, credentials:'include' });
  if (r.status === 401) { location.href='/login'; throw new Error('UNAUTH'); }
  return r;
}

async function logout() {
  await fetchWithAuth('/api/auth/logout', { method:'POST' });
  location.href = '/login';
}

// ── 初始化 ──────────────────────────────────────────────────

async function init() {
  // Bind static event listeners (replacing inline onclick/onchange)
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnAddArea').addEventListener('click', () => onAddCheckinArea());
  document.getElementById('btnEditArea').addEventListener('click', () => onEditCheckinArea(currentCheckinArea));
  document.getElementById('btnDeleteArea').addEventListener('click', () => onDeleteCheckinArea(currentCheckinArea));
  document.getElementById('btnSavePreset').addEventListener('click', savePresetCompany);
  document.getElementById('checkinAreaSelect').addEventListener('change', function() { onAreaSelectChange(this.value); });

  // 读取用户订阅列表，选出第一个有效订阅
  try {
    const subs = await fetchWithAuth('/api/user/subscriptions').then(r=>r.json());
    if (!subs.length) {
      document.getElementById('headerTitle').textContent = '访客管控系统';
      document.getElementById('headerSubtitle').textContent = '暂无订阅，请先在账户管理中创建厂区';
      return;
    }
    // 优先按 site_id 选中
    const saved = subs.find(s => s.site_id && s.site_id === _currentSiteId) || subs[0];
    _currentSubId = saved.id;
    _currentSiteId = saved.site_id || null;
    localStorage.setItem('dashboard_sub_id', _currentSubId);
    if (_currentSiteId) localStorage.setItem('dashboard_site_id', _currentSiteId);

    // 把订阅厂区名同步到 area select，并把 siteId 注入全局
    window._currentSubId = _currentSubId;
    window._currentSiteId = _currentSiteId;
    window._currentSubName = saved.area_name;
    document.getElementById('headerTitle').textContent = saved.area_name;
    document.getElementById('headerSubtitle').textContent = '访客管控系统';

    // 如果有多个订阅，注入切换下拉（覆盖 checkinAreaSelect 之前的渲染）
    _subs = subs;
    await loadCheckinAreas();
    renderCheckinAreaTabs();
    loadPresetUI();
    loadFeatureUI();
    loadCheckinQR();
    loadSessions();
    connectWS();
    setConnFooter(true, location.host);
  } catch(e) { console.warn('init error', e); }
}

// ── 订阅感知的 API 适配 ──────────────────────────────────────
// Override loadSessions/loadCheckinQR to be subscription-aware



// ── WS subscription 标记 ─────────────────────────────────────
// Patch connectWS to pass siteId
const _origConnectWS = function() {
  if (!location.host) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const siteId = window._currentSiteId || '';
  const lastEventId = localStorage.getItem('ws_lastEventId') || '0';
  ws = new WebSocket(`${proto}://${location.host}?siteId=${encodeURIComponent(siteId)}&lastEventId=${lastEventId}`);
  ws.onopen  = () => setConnFooter(true, location.host);
  ws.onclose = () => { setConnFooter(false, location.host); setTimeout(connectWS, 4000); };
  ws.onerror = () => ws.close();
  ws.onmessage = e => { try { handleWsMessage(JSON.parse(e.data)); } catch(_) {} };
};

// Multiple subscriptions: override renderCheckinAreaTabs to show sub selector
let _subs = [];
// ── Inject all original admin.js below ──────────────────────

// ─── State ─────────────────────────────────────────────────
const API = '';
let ws = null;
let sessionFocusWs = null;
let activeView = 'home';        // 'home' | 'history'
let activeSessionId = null;
let homeTrackedSessionId = null;
let historySearchText = '';
let historySelectedId = null;
let checkinQrData = '';
let logPopoverSessionId = null;
let visitorFilterText   = '';   // 搜索关键词
let visitorFilterStatus = '';   // 状态筛选（''=全部）

const sessionsMap = new Map();
const ADMIN_TOKEN_KEY = 'admin_token';
const PRESET_COMPANY_KEY = 'admin_preset_company';

// ─── Auth ───────────────────────────────────────────────────
function getAdminToken() { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; }


// ─── 厂区 & 入场码 ──────────────────────────────────────────
let CHECKIN_AREAS = []; // [{id, name, sortOrder}] loaded from API
let currentCheckinArea = '全厂区';

async function loadCheckinAreas() {
  const siteId = window._currentSiteId || '';
  if (!siteId) return;
  try {
    const res = await fetchWithAuth('/api/areas?siteId=' + encodeURIComponent(siteId));
    if (!res.ok) return;
    const data = await res.json();
    CHECKIN_AREAS = (data.areas || []).map(a => ({ id: a.id, name: a.name, sortOrder: a.sortOrder || 0 }));
    if (!CHECKIN_AREAS.length) CHECKIN_AREAS = [];
    if (CHECKIN_AREAS.length && !CHECKIN_AREAS.find(a => a.name === currentCheckinArea)) {
      currentCheckinArea = CHECKIN_AREAS[0].name;
    }
  } catch (e) { console.warn('[loadCheckinAreas] error:', e); }
}

function syncCheckinQrImage() {
  const img = document.getElementById('checkinQRImg');
  if (img && checkinQrData) img.src = checkinQrData;
}

async function loadCheckinQR() {
  try {
    const area  = (currentCheckinArea || '').trim();
    const siteId = window._currentSiteId || '';
    const params = new URLSearchParams();
    if (siteId) params.set('siteId', siteId);
    if (area)  params.set('area',  area);
    const url  = '/api/checkin-qr?' + params.toString();
    const res  = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[loadCheckinQR] 失败:', res.status, err.error || err.message);
      return;
    }
    const data = await res.json();
    if (data.qr) checkinQrData = data.qr;
    syncCheckinQrImage();
  } catch (e) { console.warn('[loadCheckinQR] error:', e); }
}

function _adminRenderCheckinAreaTabs() {
  const select = document.getElementById('checkinAreaSelect');
  if (!select) return;
  select.innerHTML = CHECKIN_AREAS.map(area => {
    const sel = area.name === currentCheckinArea ? 'selected' : '';
    return `<option value="${esc(area.name)}" ${sel}>${esc(area.name)}</option>`;
  }).join('');
}

function _adminOnAreaSelectChange(v) {
  currentCheckinArea = v || '全厂区';
  loadCheckinQR();
}
async function onAddCheckinArea() {
  const name = (prompt('请输入新厂区名称：') || '').trim();
  if (!name) return;
  if (CHECKIN_AREAS.find(a => a.name === name)) { alert('已存在同名区域。'); return; }
  const siteId = window._currentSiteId || '';
  if (!siteId) return;
  try {
    const res = await fetchWithAuth('/api/areas', {
      method: 'POST',
      body: JSON.stringify({ siteId, name, sortOrder: CHECKIN_AREAS.length }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.message || '添加失败'); return; }
    const area = await res.json();
    CHECKIN_AREAS.push({ id: area.id, name: area.name, sortOrder: area.sortOrder || 0 });
    currentCheckinArea = name;
    renderCheckinAreaTabs();
    loadCheckinQR();
  } catch (e) { alert('网络错误'); }
}
async function onEditCheckinArea(areaName) {
  const area = CHECKIN_AREAS.find(a => a.name === areaName);
  if (!area) return;
  const next = (prompt('重命名厂区：', areaName) || '').trim();
  if (!next) return;
  if (CHECKIN_AREAS.find(a => a.name === next) && next !== areaName) { alert('已存在同名厂区。'); return; }
  try {
    const res = await fetchWithAuth('/api/areas/' + encodeURIComponent(area.id), {
      method: 'PUT',
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) { alert('重命名失败'); return; }
    area.name = next;
    if (currentCheckinArea === areaName) currentCheckinArea = next;
    renderCheckinAreaTabs();
    loadCheckinQR();
  } catch (e) { alert('网络错误'); }
}
async function onDeleteCheckinArea(areaName) {
  if (CHECKIN_AREAS.length <= 1) { alert('至少保留一个厂区。'); return; }
  const area = CHECKIN_AREAS.find(a => a.name === areaName);
  if (!area) return;
  if (!confirm(`确定删除厂区「${areaName}」吗？`)) return;
  try {
    const res = await fetchWithAuth('/api/areas/' + encodeURIComponent(area.id), { method: 'DELETE' });
    if (!res.ok) { alert('删除失败'); return; }
    CHECKIN_AREAS = CHECKIN_AREAS.filter(a => a.id !== area.id);
    if (currentCheckinArea === areaName) currentCheckinArea = CHECKIN_AREAS[0] ? CHECKIN_AREAS[0].name : '全厂区';
    renderCheckinAreaTabs();
    loadCheckinQR();
  } catch (e) { alert('网络错误'); }
}

// ─── 预设 ───────────────────────────────────────────────────
const PRESET_WIFI_SSID_KEY = 'admin_preset_wifi_ssid';

async function savePresetCompany() {
  if (!_currentSubId) return;
  const ssidEl = document.getElementById('presetWifiSsid');
  const pwdEl  = document.getElementById('presetWifiPassword');
  const ssid     = ssidEl ? (ssidEl.value || '').trim() : '';
  const password = pwdEl  ? (pwdEl.value  || '').trim() : '';
  try {
    const res = await fetchWithAuth(`/api/user/subscriptions/${_currentSubId}/wifi`, {
      method: 'PUT',
      body: JSON.stringify({ ssid, password }),
    });
    if (res.ok) {
      // 同步到缓存
      const sub = _subs && _subs.find(s => s.id === _currentSubId);
      if (sub) { sub.wifi_ssid = ssid; sub.wifi_password = password; }
      const btn = document.querySelector('.preset-save');
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ 已保存'; setTimeout(() => { btn.textContent = orig; }, 1500); }
    } else {
      alert('保存失败');
    }
  } catch (_) { alert('保存失败'); }
}
function loadPresetUI() {
  const sub = _subs && _subs.find(s => s.id === _currentSubId);
  const ssidEl = document.getElementById('presetWifiSsid');
  const pwdEl  = document.getElementById('presetWifiPassword');
  if (ssidEl) ssidEl.value = (sub && sub.wifi_ssid) || '';
  if (pwdEl)  pwdEl.value  = (sub && sub.wifi_password) || '';
}
function getPresetWifiSsid() {
  const sub = _subs && _subs.find(s => s.id === _currentSubId);
  return (sub && sub.wifi_ssid) || '';
}

// ─── WebSocket ──────────────────────────────────────────────
function setConnFooter(online, text) {
  const el = document.getElementById('serverAddr');
  const foot = document.getElementById('leftFooterConn');
  if (el) el.textContent = text;
  if (foot) foot.classList.toggle('is-offline', !online);
}

function _adminConnectWS() {
  if (!location.host) {
    setConnFooter(false, '请通过 http://服务器IP:3000/admin.html 访问');
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen  = () => setConnFooter(true, location.host + ' — 已连接');
  ws.onclose = () => { setConnFooter(false, '连接断开，3s 后重连…'); setTimeout(connectWS, 3000); };
  ws.onmessage = e => {
    try { handleWsMessage(JSON.parse(e.data)); } catch (_) {}
  };
}

function handleWsMessage(msg) {
  // 追踪最新事件 ID 用于断线重连补发
  if (msg._eventId) {
    localStorage.setItem('ws_lastEventId', String(msg._eventId));
  }
  const isReplay = !!msg._replay;

  switch (msg.event) {
    case 'sessionCreated':
    case 'sessionUpdate':
      updateSession(msg.session);
      if (activeView === 'home') renderVisitorTableBody();
      else if (activeView === 'history') refreshHistoryPageIfOpen();
      break;

    // [修复#2] 处理 command 事件
    case 'command':
      if (!isReplay && msg.command === 'recover_pairing') {
        const s = sessionsMap.get(activeSessionId);
        const name = s ? s.visitorName : '访客';
        showSecurityAlert(
          '⚠️ 建议重置配对',
          `建议为访客 ${esc(name)} 重置无线调试并重新配对\n原因：${esc(msg.reason || '连接失败')}`,
          activeSessionId
        );
      }
      break;

    case 'restrictionDegraded':
      if (!isReplay) showSecurityAlert(
        '⚠️ 管控降级',
        `访客 ${esc(msg.visitorName)}（${esc(msg.area)}）的管控已生效，但以下项目降级：\n${(msg.warnings || []).map(w => '• ' + w).join('\n')}\n\n建议核查日志确认实际保护效果。`,
        msg.sessionId
      );
      break;

    case 'exitWithoutDevice':
      if (!isReplay) showSecurityAlert(
        '🚨 管控未解除',
        `访客 ${esc(msg.visitorName)}（${esc(msg.area)}）${msg.forced ? '已强制离厂' : '已扫码离厂'}，但设备不可达，手机上的管控指令未能解除！\n\n手机相机/截屏仍处于限制状态。需告知访客：\n• 重新连接厂区 WiFi 后扫码重试\n• 或重启手机后手动恢复（设置→应用管理）`,
        msg.sessionId
      );
      break;

    case 'deviceDisconnected':
      if (!isReplay) showSecurityAlert(
        '🚨 设备断连',
        `管控中访客 ${esc(msg.visitorName)}（${esc(msg.area)}）的 ADB 连接已断开！\n请让访客确认手机 WiFi 已连接，再点击卡片上的「重试连接」按钮。`,
        msg.sessionId
      );
      // 立即更新本地 session 状态，使卡片无需等待 WS sessionUpdate 就显示「重试连接」按钮
      if (msg.sessionId && sessionsMap.has(msg.sessionId)) {
        const sess = sessionsMap.get(msg.sessionId);
        sess.status = 'paired_not_connected';
        sess.pairedNotConnectedReason = 'device_disconnected';
        if (activeView === 'home') renderVisitorTableBody();
      }
      break;

    case 'tamperAlert':
      if (!isReplay) showSecurityAlert(
        '🚨 管控篡改',
        `访客 ${esc(msg.visitorName)}（${esc(msg.area)}）的管控被篡改：\n${(msg.details || []).join('；')}${msg.autoReapply ? '\n\n✅ 系统已自动重新下发管控命令' : ''}`,
        msg.sessionId
      );
      // [修复#3] 同步到会话内存，供详情页持久展示
      if (msg.sessionId && sessionsMap.has(msg.sessionId)) {
        const sess = sessionsMap.get(msg.sessionId);
        sess._tamperDetected = true;
        sess._tamperDetails  = msg.details || [];
        if (activeView === 'home') renderVisitorTableBody();
      }
      break;

    case 'sessionOverdue':
      if (!isReplay) showSecurityAlert(
        '⏰ 管控超时',
        `访客 ${esc(msg.visitorName)}（${esc(msg.area)}）管控已持续 ${msg.hours} 小时，请确认是否仍在厂区。\n如已离开请使用「强制离厂」解除管控。`,
        msg.sessionId
      );
      break;
  }
}

// ─── 安全告警 ───────────────────────────────────────────────
function showSecurityAlert(title, message, sessionId) {
  playAlertSound();
  const container = document.getElementById('alertContainer');
  if (!container) return;
  const id = 'alert_' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'security-alert';
  div.style.pointerEvents = 'auto';
  div.innerHTML = `
    <div class="alert-header">
      <strong>${title}</strong>
      <button data-action="dismissAlert" data-id="${id}" class="alert-dismiss">×</button>
    </div>
    <div class="alert-body">${esc(message)}</div>
    ${sessionId ? `<button class="alert-action" data-action="selectAndDismissAlert" data-session-id="${sessionId}" data-id="${id}">查看详情</button>` : ''}
  `;
  container.prepend(div);
  setTimeout(() => dismissAlert(id), 30000);
}
function dismissAlert(id) { const el = document.getElementById(id); if (el) el.remove(); }
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [800, 600, 800].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; gain.gain.value = 0.3;
      osc.start(ctx.currentTime + i * 0.2); osc.stop(ctx.currentTime + i * 0.2 + 0.15);
    });
  } catch (_) {}
}

// ─── 会话管理 ───────────────────────────────────────────────
function updateSession(s) {
  const prev = sessionsMap.get(s.id);
  // 保留本地缓存的篡改标记和实时状态消息
  const merged = { ...s };
  // [修复#3] 从服务器字段恢复篡改标记（刷新后持久展示）
  if (s.tamperDetected) {
    merged._tamperDetected = true;
    if (s.tamperDetails && s.tamperDetails.length) merged._tamperDetails = s.tamperDetails;
  }
  if (prev) {
    if (prev._tamperDetected) { merged._tamperDetected = true; merged._tamperDetails = prev._tamperDetails || merged._tamperDetails; }
    if (prev.liveStatusMessage && prev.status === s.status) merged.liveStatusMessage = prev.liveStatusMessage;
    // 若服务端尚未推送 pairedNotConnectedReason，保留本地设置的断连原因
    if (!merged.pairedNotConnectedReason && prev.pairedNotConnectedReason === 'device_disconnected'
        && merged.status === 'paired_not_connected') {
      merged.pairedNotConnectedReason = 'device_disconnected';
    }
  }
  sessionsMap.set(s.id, merged);
}

function closeSessionFocusWs() {
  if (sessionFocusWs) { try { sessionFocusWs.close(); } catch (_) {} sessionFocusWs = null; }
}

function selectSession(id) {
  const s = sessionsMap.get(id);
  if (!s) return;
  homeTrackedSessionId = id;
  // 已离厂 → 跳历史页
  if (s.status === 'exited') { openHistoryPage(s.visitorName || '', s.id); return; }
  activeView = 'home';
  activeSessionId = id;
  closeSessionFocusWs();
  renderVisitorTableBody();
  // 订阅该会话的实时事件
  if (!location.host) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  sessionFocusWs = new WebSocket(`${proto}://${location.host}?sessionId=${id}`);
  sessionFocusWs.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === 'init') { updateSession(msg.session); renderVisitorTableBody(); }
      if (msg.event === 'status' && activeSessionId === id) { updateSessionStatus(id, msg.status, msg.message); }
      if (msg.event === 'log'    && activeSessionId === id) { appendSessionLog(id, msg.message, msg.type); }
    } catch (_) {}
  };
}

function updateSessionStatus(id, status, message) {
  if (sessionsMap.has(id)) {
    const s = sessionsMap.get(id);
    s.status = status;
    s.liveStatusMessage = message;
  }
  renderVisitorTableBody();
  refreshLogPopoverIfOpen();
}

function appendSessionLog(id, message, type = 'info') {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${message}`;
  if (sessionsMap.has(id)) {
    const s = sessionsMap.get(id);
    s.logs = s.logs || [];
    s.logs.push(line);
  }
  renderVisitorTableBody();
  refreshLogPopoverIfOpen();
}

function selectHome() {
  activeView = 'home'; activeSessionId = null;
  closeSessionFocusWs(); closeVisitorLogPopover();
  renderHomeDashboard();
}

// ─── 页面一：访客列表渲染 ────────────────────────────────────
function renderHomeDashboard() {
  syncCheckinQrImage();
  document.getElementById('mainContent').innerHTML = `
    <div class="home-dashboard">
      <div class="home-main">
        <div class="visitor-table-wrap">
          <div class="visitor-table-head">
            <span>当前访客</span>
            <div class="visitor-table-head-actions">
              <button type="button" class="btn-history-link" data-action="openHistoryPage">📋 历史记录</button>
            </div>
          </div>

          <!-- 搜索 + 筛选栏 -->
          <div class="visitor-filter-bar" id="visitorFilterBar">
            <div class="visitor-search-wrap">
              <span class="visitor-search-icon">⌕</span>
              <input
                type="text"
                id="visitorSearchInput"
                class="visitor-search-input"
                placeholder="搜索姓名、公司、区域、设备 ID…"
                value="${esc(visitorFilterText)}"
                data-on-input="onVisitorSearch"
                autocomplete="off"
              />
              ${visitorFilterText ? `<button class="visitor-search-clear" data-action="clearVisitorSearch" title="清除搜索">×</button>` : ''}
            </div>
            <div class="visitor-filter-tabs" id="visitorFilterTabs">
              ${buildFilterTabs()}
            </div>
          </div>

          <!-- 访客卡片列表 -->
          <div class="visitor-table" id="visitorListBody"></div>

          <div id="visitorLogPopover" class="visitor-log-popover is-hidden" aria-hidden="true">
            <div class="visitor-log-popover-head">
              <span id="visitorLogPopoverTitle">操作日志</span>
              <button type="button" data-action="closeVisitorLogPopover">关闭</button>
            </div>
            <div id="visitorLogPopoverBody" class="visitor-log-popover-body"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  renderVisitorTableBody();
}

function renderVisitorTableBody() {
  const el = document.getElementById('visitorListBody');
  if (!el) return;

  const all = [...sessionsMap.values()].filter(s => s.status !== 'exited');

  // 状态筛选
  let filtered = visitorFilterStatus
    ? all.filter(s => s.status === visitorFilterStatus)
    : all;

  // 关键词搜索（姓名/公司/区域/设备ID，不区分大小写）
  const kw = visitorFilterText.trim().toLowerCase();
  if (kw) {
    filtered = filtered.filter(s =>
      (s.visitorName    || '').toLowerCase().includes(kw) ||
      (s.visitorCompany || '').toLowerCase().includes(kw) ||
      (s.area           || '').toLowerCase().includes(kw) ||
      (s.deviceId       || '').toLowerCase().includes(kw) ||
      (s.deviceIp       || '').toLowerCase().includes(kw)
    );
  }

  // 更新筛选 tabs 计数（实时反映 sessionsMap 变化）
  const tabsEl = document.getElementById('visitorFilterTabs');
  if (tabsEl) tabsEl.innerHTML = buildFilterTabs();

  // 更新搜索框清除按钮
  const clearBtn = document.querySelector('.visitor-search-clear');
  const existsClear = !!clearBtn;
  if (visitorFilterText && !existsClear) {
    const wrap = document.querySelector('.visitor-search-wrap');
    if (wrap) {
      const btn = document.createElement('button');
      btn.className = 'visitor-search-clear';
      btn.title = '清除搜索';
      btn.textContent = '×';
      btn.onclick = clearVisitorSearch;
      wrap.appendChild(btn);
    }
  } else if (!visitorFilterText && clearBtn) {
    clearBtn.remove();
  }

  if (!all.length) {
    el.innerHTML = `<div class="visitor-empty">
      暂无待处理访客。<br/>请访客扫描左侧<strong>常驻入场码</strong>登记入场。<br/>
      <span style="font-size:12px;opacity:.8">已离厂数据请点击右上角「历史记录」或左侧「打开」搜索查看。</span>
    </div>`;
    return;
  }

  if (!filtered.length) {
    const tip = kw
      ? `未找到与「${esc(visitorFilterText)}」相关的访客`
      : `没有处于「${statusLabel(visitorFilterStatus)}」状态的访客`;
    el.innerHTML = `<div class="visitor-empty visitor-empty-filter">
      <div class="empty-filter-icon">🔍</div>
      <div>${tip}</div>
      <button class="btn btn-sm btn-outline" style="margin-top:10px" data-action="clearVisitorFilter">清除筛选</button>
    </div>`;
    return;
  }

  const sorted = filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  el.innerHTML = sorted.map(s => buildVisitorRowHtml(s)).join('');
  refreshLogPopoverIfOpen();
}

// ─── 访客搜索 & 筛选 ────────────────────────────────────────

const FILTER_STATUS_OPTIONS = [
  { value: '',                    label: '全部' },
  { value: 'waiting',             label: '等待配对' },
  { value: 'pairing',             label: '配对中' },
  { value: 'paired_not_connected',label: '断开' },
  { value: 'restricted',          label: '管控中' },
  { value: 'error',               label: '异常' },
];

function buildFilterTabs() {
  const all = [...sessionsMap.values()].filter(s => s.status !== 'exited');
  return FILTER_STATUS_OPTIONS.map(opt => {
    const count = opt.value ? all.filter(s => s.status === opt.value).length : all.length;
    const active = visitorFilterStatus === opt.value ? ' ftab-active' : '';
    const hasItems = count > 0;
    return `<button
      type="button"
      class="ftab${active}${!hasItems && opt.value ? ' ftab-empty' : ''}"
      data-action="setVisitorFilterStatus" data-value="${opt.value}"
    >${opt.label}<span class="ftab-count">${count}</span></button>`;
  }).join('');
}

function setVisitorFilterStatus(status) {
  visitorFilterStatus = status;
  renderVisitorTableBody();
}

function onVisitorSearch(value) {
  visitorFilterText = value;
  renderVisitorTableBody();
}

function clearVisitorSearch() {
  visitorFilterText = '';
  const input = document.getElementById('visitorSearchInput');
  if (input) { input.value = ''; input.focus(); }
  renderVisitorTableBody();
}

function clearVisitorFilter() {
  visitorFilterText   = '';
  visitorFilterStatus = '';
  const input = document.getElementById('visitorSearchInput');
  if (input) input.value = '';
  renderVisitorTableBody();
}

// ─── 访客卡片 HTML ───────────────────────────────────────────
function buildVisitorRowHtml(s) {
  const st = s.status;
  const statusMsg = s.liveStatusMessage || getStatusMsg(st);

  // 进厂码样式
  const entryDone   = ['restricted','exiting','exited'].includes(st);
  const entryWarn   = st === 'paired_not_connected';
  const entryActive = ['waiting','pairing'].includes(st);
  let entryCls = 'qr-slot';
  if (entryDone) entryCls += ' qr-entry-done';
  else if (entryWarn) entryCls += ' qr-entry-warn';
  else if (entryActive) entryCls += ' qr-entry-active';

  // 离厂码样式
  const exitActive = st === 'restricted';
  const exitDone   = ['exiting','exited'].includes(st);
  let exitCls = 'qr-slot';
  if (exitActive) exitCls += ' qr-exit-active';
  else if (exitDone) exitCls += ' qr-exit-done';
  else exitCls += ' qr-exit-locked';

  const entryImg = s.entryQR ? `<img src="${s.entryQR}" alt="进厂码"/>` : '<span style="font-size:9px;color:#94a3b8">无</span>';
  const exitImg  = s.exitQR  ? `<img src="${s.exitQR}"  alt="离厂码"/>` : '<span style="font-size:9px;color:#94a3b8">无</span>';
  const entryBadge = entryDone ? '<span class="qr-done-badge" title="已进厂">✓</span>' : '';
  const activeCard = activeSessionId === s.id ? 'active' : '';
  const selfTag = s.selfCheckin ? '<span class="visitor-self-tag">[自]</span> ' : '';
  const logCount = (s.logs || []).length;
  let entryTimeHtml = s.restrictedAt ? formatTime(s.restrictedAt) : (s.createdAt ? formatTime(s.createdAt) + ' <span class="kv-hint">(登记)</span>' : '—');

  // [修复#3] 篡改检测标记（从 WS tamperAlert 缓存到 _tamperDetected）
  const tamperBadge = s._tamperDetected
    ? '<span class="pill pill-err" title="' + esc((s._tamperDetails||[]).join('；')) + '">⚠ 篡改</span>'
    : '';

  // [修复#1] recover-enable 按钮：仅在 paired_not_connected 且未开启时显示
  const recoverBtn = st === 'paired_not_connected' && !s.recoverPairingEnabled
    ? `<button type="button" class="btn btn-sm btn-purple" data-action="enableRecoverPairing" data-id="${s.id}" title="通知 APP 重置无线调试并重新配对">🔁 恢复配对</button>`
    : '';
  // recover 已开启时显示状态
  const recoverPill = s.recoverPairingEnabled
    ? (() => {
        if (s.recoverPairingEnabledUntil) {
          const remainMs = s.recoverPairingEnabledUntil - Date.now();
          const remainMin = Math.max(0, Math.ceil(remainMs / 60000));
          const label = remainMs > 0 ? `恢复配对 ON（剩余 ${remainMin} 分钟）` : '恢复配对 ON（已到期）';
          return `<span class="pill pill-info" title="恢复配对已启用，到期时间：${formatTime(s.recoverPairingEnabledUntil)}">${label}</span>`;
        }
        return '<span class="pill pill-info" title="恢复配对已启用">恢复配对 ON</span>';
      })()
    : '';

  // 提取配对完成时间（从日志）
  const pairEntry = (parseLogEntries(s)).find(e => /🔑.*Successfully paired|🔑.*已配对/.test(e.message));
  const pairTime  = pairEntry ? pairEntry.time : null;

  return `
    <div class="visitor-card ${activeCard}" role="button" tabindex="0" data-action="selectSession" data-id="${s.id}">
      <div class="visitor-card-layout">

        <!-- 信息列 -->
        <div class="visitor-strip visitor-info-col">
          <span class="strip-h">访客信息</span>
          <div class="visitor-strip-body">
            <dl class="visitor-kv">
              <dt>姓名</dt><dd class="visitor-kv-name">${selfTag}${esc(s.visitorName)}</dd>
              <dt>公司</dt><dd>${s.visitorCompany ? esc(s.visitorCompany) : '—'}</dd>
              <dt>区域</dt><dd>${esc(s.area)}</dd>
              <dt>设备</dt><dd class="visitor-kv-mono">${s.deviceId ? esc(s.deviceId.replace(/^adb-/, '').split('-')[0].slice(0,12)) : '—'}</dd>
              <dt>登记</dt><dd>${s.createdAt ? formatTime(s.createdAt) + (s.selfCheckin ? ' <span class="kv-hint">[自助]</span>' : '') : '—'}</dd>
              ${pairTime ? `<dt>配对</dt><dd class="visitor-kv-mono">${pairTime}</dd>` : ''}
              <dt>管控</dt><dd>${s.restrictedAt ? formatTime(s.restrictedAt) : '—'}</dd>
              <dt>离厂</dt><dd>${s.exitedAt ? formatTime(s.exitedAt) : '—'}</dd>
            </dl>
          </div>
        </div>

        <!-- 配对码列 -->
        <div class="visitor-strip visitor-qr-entry-col" data-stop-prop>
          <span class="strip-h">配对码</span>
          <div class="visitor-strip-body">
            <div class="${entryCls}">
              ${entryBadge}
              ${entryImg}
            </div>
          </div>
        </div>

        <!-- 离厂码列 -->
        <div class="visitor-strip visitor-qr-exit-col" data-stop-prop>
          <span class="strip-h">离厂码</span>
          <div class="visitor-strip-body">
            <div class="${exitCls}">
              ${exitImg}
              <span class="qr-slot-label">扫码离厂</span>
            </div>
          </div>
        </div>

        <!-- 实时反馈列 -->
        <div class="visitor-strip visitor-feedback-col">
          <span class="strip-h">管控状态</span>
          <div class="visitor-strip-body visitor-feedback-body">

            <!-- 顶部：状态徽章 + 告警标记 -->
            <div class="visitor-feedback-head">
              <span class="status-badge badge-${st}">${statusLabel(st)}</span>
              ${tamperBadge}
              ${recoverPill}
            </div>

            <!-- 状态消息 -->
            <div class="visitor-status-line">${statusEmoji(st)} ${esc(statusMsg)}</div>
            ${st === 'paired_not_connected' ? `<div class="visitor-status-hint">原因：${esc(reasonLabel(s.pairedNotConnectedReason))}</div>` : ''}

            <!-- 流程步骤 -->
            <div class="progress-steps visitor-steps visitor-steps-feedback">${buildSteps(st)}</div>

            <!-- 管控详情：从日志提取的实际数据 -->
            <div class="restriction-detail">
              ${buildRestrictionSummary(s)}
            </div>

            <!-- 操作按钮 -->
            <div class="visitor-feedback-actions">
              <div class="visitor-card-actions">
                ${st === 'error' && s.deviceId ? `<button type="button" class="btn btn-sm btn-outline" data-action="retrySession" data-id="${s.id}">🔄 重试</button>` : ''}
                ${st === 'error' && !s.deviceId ? `<button type="button" class="btn btn-sm btn-outline" data-action="regeneratePairing" data-id="${s.id}">🔄 重新生成配对码</button>` : ''}
                ${st === 'paired_not_connected' ? `<button type="button" class="btn btn-sm btn-outline" data-action="retryConnect" data-id="${s.id}">🔌 重试连接</button>` : ''}
                ${recoverBtn}
                ${st === 'restricted' ? `<button type="button" class="btn btn-sm btn-danger" data-action="forceExit" data-id="${s.id}">强制离厂</button>` : ''}
              </div>
              <button type="button" class="btn-log-popover" data-action="openVisitorLogPopover" data-id="${s.id}">
                操作日志（${logCount} 条）· 点击展开
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  `;
}

// ─── 管控详情摘要（从日志提取真实数据）───────────────────────
function buildRestrictionSummary(s) {
  const ent = parseLogEntries(s);
  const st  = s.status;
  const done    = ['restricted','exiting','exited'].includes(st);
  const active  = ['pairing','paired_not_connected'].includes(st);
  const waiting = st === 'waiting';

  // ── ADB 连接状态 ──
  let adbCls = 'pill-wait', adbText = '待连';
  if (st === 'paired_not_connected') { adbCls = 'pill-err'; adbText = '断连'; }
  else if (s.deviceId && done)        { adbCls = 'pill-ok';  adbText = '已连'; }
  else if (st === 'pairing')          { adbCls = 'pill-info'; adbText = '配对中'; }
  else if (st === 'error')            { adbCls = 'pill-warn'; adbText = '异常'; }

  // 还未到管控阶段：只显示 ADB 状态
  if (waiting) {
    return `<div class="control-pills"><span class="pill ${adbCls}">ADB ${adbText}</span></div>`;
  }

  // ── 从日志提取实际管控数据 ──
  // 冻结的相机/录屏包数量
  const frozenCount  = ent.filter(e => /✓ \[(disable|suspend)\]/.test(e.message)).length;
  // 封锁相机权限的应用数量
  const blockedCount = ent.filter(e => /✓ 已封锁：/.test(e.message)).length;
  // 移除的控制中心 Tile 数量
  const tileCount    = ent.filter(e => /✓ \[移除 Tile\]/.test(e.message)).length;

  // 截屏方式（强→弱依次判断）
  let shotMethod = '', shotStrong = false;
  if (hasStep(ent, [/DPM 截屏禁用已设置|device_policy 截屏禁用已设置|wm screen-capture 截屏禁用已设置/])) {
    shotMethod = 'DPM'; shotStrong = true;
  } else if (hasStep(ent, [/系统截屏策略已设置（settings）/])) {
    shotMethod = 'settings';
  } else if (done) {
    shotMethod = '—';
  }

  // ── 告警项 ──
  const warnDpm   = hasStep(ent, [/DPM\/wm 截屏禁用不可用/]);
  const warnSysui = hasStep(ent, [/SystemUI 重启失败/]);
  const warnAdb   = hasStep(ent, [/无线调试关闭失败/]);
  const warnPerm  = hasStep(ent, [/无法设置 user-fixed/]);

  // ── 构建 pills ──
  const okCls   = done   ? 'pill-ok'   : active ? 'pill-info' : 'pill-wait';
  const dimCls  = done   ? 'pill-off'  : 'pill-wait';

  const pills = [];

  // ADB
  pills.push(`<span class="pill ${adbCls}">ADB·${adbText}</span>`);

  // 相机应用冻结
  if (frozenCount > 0) {
    pills.push(`<span class="pill ${okCls}" title="已冻结的相机/录屏应用">相机×${frozenCount}</span>`);
  } else if (done) {
    pills.push(`<span class="pill ${dimCls}" title="未发现需冻结的相机应用">相机×0</span>`);
  }

  // 摄像头权限封锁
  if (blockedCount > 0) {
    pills.push(`<span class="pill ${okCls}" title="已封锁摄像头权限的应用">权限×${blockedCount}</span>`);
  } else if (done) {
    pills.push(`<span class="pill ${dimCls}" title="未封锁应用摄像头权限">权限×0</span>`);
  }

  // 截屏方式
  if (shotMethod && shotMethod !== '—') {
    const sCls = shotStrong ? 'pill-ok' : (warnDpm ? 'pill-warn' : 'pill-ok');
    pills.push(`<span class="pill ${sCls}" title="截屏限制方式">截屏·${shotMethod}</span>`);
  } else if (done) {
    pills.push(`<span class="pill ${dimCls}" title="截屏状态未确认">截屏·?</span>`);
  }

  // Tile
  if (tileCount > 0) {
    pills.push(`<span class="pill ${okCls}" title="已从控制中心移除的截屏/录屏按钮">Tile×${tileCount}</span>`);
  } else if (done) {
    pills.push(`<span class="pill ${dimCls}" title="控制中心无截屏Tile">Tile×0</span>`);
  }

  // ── 告警 pills ──
  const warns = [];
  if (warnDpm)   warns.push(`<span class="pill pill-warn restrict-warn" title="DPM/wm 截屏禁用不可用，已降级为 settings 方式，部分 ROM（如荣耀/华为）可能无效">⚠ 截屏降级</span>`);
  if (warnSysui) warns.push(`<span class="pill pill-warn restrict-warn" title="SystemUI 重启失败，控制中心截屏按钮下拉一次后才会消失">⚠ 控制中心</span>`);
  if (warnAdb)   warns.push(`<span class="pill pill-warn restrict-warn" title="无线调试未成功关闭，请提醒访客在开发者选项中手动关闭">⚠ 调试未关</span>`);
  if (warnPerm)  warns.push(`<span class="pill pill-warn restrict-warn" title="此 ROM 不支持 permission-flags，摄像头权限封锁仅依赖 appops，效果略弱">⚠ 权限降级</span>`);

  return `
    <div class="control-pills restriction-pills">${pills.join('')}</div>
    ${warns.length ? `<div class="control-pills warn-pills">${warns.join('')}</div>` : ''}
  `;
}

// ─── 废弃旧函数，保持向后兼容 ───────────────────────────────
function buildControlPillsHtml(s) { return buildRestrictionSummary(s); }

// ─── 流程步骤 ────────────────────────────────────────────────
// [修复#6] 为 paired_not_connected 的 adb 步骤添加 error 红色状态
function buildSteps(status) {
  const steps = [
    { key: 'app',      label: 'APP 已上报设备 IP',  doneAt: ['pairing','paired_not_connected','restricted','exiting','exited'] },
    { key: 'adb',      label: 'ADB 配对 & 连接成功', doneAt: ['restricted','exiting','exited'] },
    { key: 'restrict', label: '管控指令已下发',       doneAt: ['restricted','exiting','exited'] },
    { key: 'exit',     label: '访客已离厂',           doneAt: ['exited'] },
  ];
  // paired_not_connected 时 adb 步骤单独显示 error；其余 active 逻辑维持原样
  const activeMap = { waiting: '', pairing: 'app', paired_not_connected: '', restricted: '', exiting: 'exit', error: '' };
  const activeKey = activeMap[status] || '';

  return steps.map((item, i) => {
    const done    = item.doneAt.includes(status);
    const isError = !done && status === 'paired_not_connected' && item.key === 'adb';
    const active  = !done && !isError && item.key === activeKey;
    const cls  = done ? 'done' : isError ? 'error' : active ? 'active' : '';
    const icon = done ? '✓' : isError ? '✗' : (i + 1).toString();
    return `<div class="step ${cls}"><div class="step-icon">${icon}</div><div class="step-text">${item.label}</div></div>`;
  }).join('');
}

// ─── 日志展开面板 ────────────────────────────────────────────
function openVisitorLogPopover(sessionId) {
  const s = sessionsMap.get(sessionId);
  const wrap  = document.getElementById('visitorLogPopover');
  const body  = document.getElementById('visitorLogPopoverBody');
  const title = document.getElementById('visitorLogPopoverTitle');
  if (!wrap || !body || !title || !s) { closeVisitorLogPopover(); return; }
  logPopoverSessionId = sessionId;
  title.textContent = `操作日志 · ${s.visitorName}（${(s.logs || []).length} 条）`;
  const lines = s.logs || [];
  body.innerHTML = lines.length
    ? lines.map(l => {
        const isErr = l.toLowerCase().includes('error') || l.includes('❌') || l.includes('篡改');
        return `<div class="log-entry-pop ${isErr ? 'error' : ''}">${esc(l)}</div>`;
      }).join('')
    : '<div class="log-empty">暂无日志</div>';
  wrap.classList.remove('is-hidden');
  wrap.setAttribute('aria-hidden', 'false');
  body.scrollTop = body.scrollHeight;
}
function closeVisitorLogPopover() {
  logPopoverSessionId = null;
  const wrap = document.getElementById('visitorLogPopover');
  if (wrap) { wrap.classList.add('is-hidden'); wrap.setAttribute('aria-hidden', 'true'); }
}
function refreshLogPopoverIfOpen() {
  if (logPopoverSessionId && sessionsMap.has(logPopoverSessionId)) openVisitorLogPopover(logPopoverSessionId);
}

// ─── 页面二：历史记录 ────────────────────────────────────────
async function openHistoryPage(namePrefill, sessionId) {
  activeView         = 'history';
  activeSessionId    = null;
  historySearchText  = namePrefill != null ? String(namePrefill) : '';
  historySelectedId  = sessionId || null;
  historyFilterArea  = '';
  historyFilterDate  = '';
  historyFilterTamper = false;
  closeSessionFocusWs();
  closeVisitorLogPopover();
  await loadHistorySessionsPersisted();
  renderHistoryFullPage();
}

// ── 历史筛选状态 ────────────────────────────────────────────
let historyFilterArea   = '';
let historyFilterDate   = '';
let historyFilterTamper = false;

function getFilteredExitedSessions() {
  const q    = (historySearchText || '').trim().toLowerCase();
  const area = historyFilterArea;
  const date = historyFilterDate;

  let base = [...sessionsMap.values()]
    .filter(s => s.status === 'exited')
    .sort((a, b) => new Date(b.exitedAt || b.createdAt) - new Date(a.exitedAt || a.createdAt));

  if (q) base = base.filter(s =>
    (s.visitorName    || '').toLowerCase().includes(q) ||
    (s.visitorCompany || '').toLowerCase().includes(q) ||
    (s.deviceId       || '').toLowerCase().includes(q) ||
    (s.area           || '').toLowerCase().includes(q)
  );

  if (area) base = base.filter(s => s.area === area);

  if (date) {
    const d = new Date(date);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    base = base.filter(s => {
      const t = new Date(s.exitedAt || s.createdAt);
      return t >= d && t < next;
    });
  }

  if (historyFilterTamper) {
    base = base.filter(s => {
      const tamperLogs = (s.logs || []).some(l => l.includes('管控完整性异常') || l.includes('篡改'));
      return s._tamperDetected || s.tamperDetected || tamperLogs;
    });
  }

  return base;
}

function getHistoryStats(list) {
  const all = [...sessionsMap.values()].filter(s => s.status === 'exited');
  let totalDuration = 0, validDuration = 0;
  let tamperCount = 0, longStayCount = 0;

  all.forEach(s => {
    const tamperLogs = (s.logs || []).some(l => l.includes('管控完整性异常') || l.includes('篡改'));
    if (s._tamperDetected || s.tamperDetected || tamperLogs) tamperCount++;
    if (s.restrictedAt && s.exitedAt) {
      const dur = new Date(s.exitedAt) - new Date(s.restrictedAt);
      totalDuration += dur;
      validDuration++;
      if (dur > 8 * 3600000) longStayCount++;
    }
  });

  const avgMin = validDuration > 0 ? Math.round(totalDuration / validDuration / 60000) : 0;
  return { total: all.length, filtered: list.length, tamperCount, longStayCount, avgMin };
}

function calcDuration(s) {
  if (!s.restrictedAt || !s.exitedAt) return null;
  const ms = new Date(s.exitedAt) - new Date(s.restrictedAt);
  if (ms < 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getAreaOptions() {
  const areas = [...new Set(
    [...sessionsMap.values()].filter(s => s.status === 'exited').map(s => s.area).filter(Boolean)
  )].sort();
  return areas;
}

// ── 导出 CSV ────────────────────────────────────────────────
function exportHistoryCSV(list) {
  if (!list.length) { alert('无数据可导出'); return; }
  const cols = ['姓名', '公司/单位', '区域', '设备ID', '设备IP', '登记时间', '管控生效', '离厂时间', '在厂时长(分钟)', 'WiFi', '自助入场', '篡改告警', '会话ID'];
  const rows = list.map(s => {
    const tamperLogs = (s.logs || []).some(l => l.includes('管控完整性异常') || l.includes('篡改'));
    const hasTamper  = s._tamperDetected || s.tamperDetected || tamperLogs;
    const durMin = (s.restrictedAt && s.exitedAt)
      ? Math.round((new Date(s.exitedAt) - new Date(s.restrictedAt)) / 60000)
      : '';
    const csvVal = v => `"${String(v || '').replace(/"/g, '""')}"`;
    return [
      csvVal(s.visitorName), csvVal(s.visitorCompany), csvVal(s.area),
      csvVal(s.deviceId), csvVal(s.deviceIp),
      csvVal(s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', {hour12:false}) : ''),
      csvVal(s.restrictedAt ? new Date(s.restrictedAt).toLocaleString('zh-CN', {hour12:false}) : ''),
      csvVal(s.exitedAt ? new Date(s.exitedAt).toLocaleString('zh-CN', {hour12:false}) : ''),
      csvVal(durMin),
      csvVal(s.wifiSsid), csvVal(s.selfCheckin ? '是' : '否'),
      csvVal(hasTamper ? '是' : '否'), csvVal(s.id),
    ].join(',');
  });
  const bom  = '\uFEFF';
  const csv  = bom + cols.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `访客记录_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportHistoryCSVFromServer(scope) {
  const siteId = window._currentSiteId || '';
  if (!siteId) { alert('缺少 siteId，无法导出'); return; }
  const p = new URLSearchParams({ siteId, status: 'exited' });
  if (scope === 'filtered') {
    if (historySearchText) p.set('q', historySearchText);
    if (historyFilterDate) {
      const from = new Date(historyFilterDate);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      to.setMilliseconds(to.getMilliseconds() - 1);
      p.set('from', String(from.getTime()));
      p.set('to', String(to.getTime()));
    }
  }
  const url = `/api/history/sessions/export?${p.toString()}`;
  window.open(url, '_blank');
}

function exportSingleRecord(s) {
  const tamperLogs = (s.logs || []).filter(l => l.includes('管控完整性异常') || l.includes('篡改'));
  const hasTamper  = s._tamperDetected || s.tamperDetected || tamperLogs.length > 0;

  const lines = [
    '厂区访客管控系统 — 访客存档',
    '导出时间：' + new Date().toLocaleString('zh-CN', {hour12:false}),
    '─'.repeat(50),
    '',
    '【基本信息】',
    `姓名：${s.visitorName || '—'}`,
    `公司/单位：${s.visitorCompany || '—'}`,
    `进入区域：${s.area || '—'}`,
    `厂区 WiFi：${s.wifiSsid || '—'}`,
    `入场方式：${s.selfCheckin ? '自助入场' : '人工登记'}`,
    '',
    '【设备信息】',
    `设备 ID：${s.deviceId || '—'}`,
    `设备 IP：${s.deviceIp || '—'}`,
    '',
    '【时间记录】',
    `登记时间：${s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false}) : '—'}`,
    `管控生效：${s.restrictedAt ? new Date(s.restrictedAt).toLocaleString('zh-CN',{hour12:false}) : '—'}`,
    `离厂时间：${s.exitedAt ? new Date(s.exitedAt).toLocaleString('zh-CN',{hour12:false}) : '—'}`,
    `在厂时长：${calcDuration(s) || '—'}`,
    '',
    `【安全状态】`,
    `篡改告警：${hasTamper ? '是 — ' + (s.tamperDetails||tamperLogs.map(l=>l.replace(/^\[.+?\]\s*/,''))).join('；') : '否'}`,
    '',
    '【操作日志】',
    ...(s.logs || []),
    '',
    `会话ID：${s.id}`,
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `访客存档_${(s.visitorName||'未知').replace(/\s/g,'_')}_${(s.exitedAt ? new Date(s.exitedAt).toLocaleDateString('zh-CN').replace(/\//g,'-') : '')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 渲染历史页 ──────────────────────────────────────────────
function renderHistoryFullPage() {
  const list   = getFilteredExitedSessions();
  const stats  = getHistoryStats(list);
  const areas  = getAreaOptions();

  const areaOpts = `<option value="">全部区域</option>` +
    areas.map(a => `<option value="${esc(a)}" ${historyFilterArea === a ? 'selected' : ''}>${esc(a)}</option>`).join('');

  document.getElementById('mainContent').innerHTML = `
    <div class="home-dashboard" style="padding:0;height:100%;display:flex;flex-direction:column;">
      <div class="history-page">

        <!-- 顶部工具栏 -->
        <div class="hist-toolbar">
          <button type="button" class="btn btn-outline btn-sm" data-action="selectHome">← 返回</button>
          <span class="hist-title">历史记录</span>
          <div class="hist-toolbar-right">
            <button class="btn-export" data-action="exportHistoryCSV" data-scope="filtered">
              ↓ 导出筛选结果 CSV
            </button>
            <button class="btn-export btn-export-all" data-action="exportHistoryCSV" data-scope="all">
              ↓ 导出全部 CSV
            </button>
          </div>
        </div>

        <!-- 汇总统计 -->
        <div class="hist-stats-bar">
          <div class="hist-stat accent">
            <div class="hist-stat-val">${stats.total}</div>
            <div class="hist-stat-label">历史总访客</div>
          </div>
          <div class="hist-stat">
            <div class="hist-stat-val">${stats.filtered}</div>
            <div class="hist-stat-label">当前筛选</div>
          </div>
          <div class="hist-stat">
            <div class="hist-stat-val">${stats.avgMin > 0 ? (stats.avgMin >= 60 ? Math.round(stats.avgMin/60)+'h' : stats.avgMin+'m') : '—'}</div>
            <div class="hist-stat-label">平均在厂时长</div>
          </div>
          <div class="hist-stat ${stats.longStayCount > 0 ? 'warn' : ''}">
            <div class="hist-stat-val">${stats.longStayCount}</div>
            <div class="hist-stat-label">超长停留(>8h)</div>
          </div>
          <div class="hist-stat ${stats.tamperCount > 0 ? 'danger' : ''}">
            <div class="hist-stat-val">${stats.tamperCount}</div>
            <div class="hist-stat-label">篡改告警</div>
          </div>
        </div>

        <!-- 筛选条 -->
        <div class="hist-filter-bar">
          <div class="hist-search-wrap">
            <span class="hist-search-icon">⌕</span>
            <input type="text" id="historySearchInput" class="hist-search-input"
              placeholder="搜索姓名、公司、区域、设备…"
              value="${esc(historySearchText)}"
              data-on-input="historySearch"
              autocomplete="off"
            />
            ${historySearchText ? `<button class="hist-search-clear" data-action="clearHistorySearch">×</button>` : ''}
          </div>

          <span class="hist-filter-label">区域</span>
          <select class="hist-filter-select" data-on-change="historyFilterArea">
            ${areaOpts}
          </select>

          <span class="hist-filter-label">日期</span>
          <input type="date" class="hist-filter-date" value="${esc(historyFilterDate)}"
            data-on-change="historyFilterDate" />

          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;">
            <input type="checkbox" ${historyFilterTamper ? 'checked' : ''} data-on-change="historyFilterTamper" />
            <span class="hist-filter-label" style="margin:0;">仅异常</span>
          </label>

          <span class="hist-result-count">${list.length} 条</span>
        </div>

        <!-- 主体：列表 + 详情 -->
        <div class="hist-body">
          <!-- 左：访客列表 -->
          <div class="hist-list-col">
            <div class="hist-list-header">
              <span>访客</span>
              <span>时长</span>
              <span>状态</span>
            </div>
            <div id="historyPageListScroll" class="hist-list-scroll"></div>
          </div>

          <!-- 右：详情 -->
          <div class="hist-detail-col" id="historyDetailCol">
            <div class="hist-empty">
              <div class="hist-empty-icon">📋</div>
              <div>点击左侧访客查看详细存档</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  renderHistoryList();
  if (historySelectedId) renderHistoryDetail(historySelectedId);
}

function renderHistoryList() {
  const listEl = document.getElementById('historyPageListScroll');
  if (!listEl) return;

  const list = getFilteredExitedSessions();

  if (!list.length) {
    listEl.innerHTML = `<div class="hist-empty" style="min-height:120px">
      <div class="hist-empty-icon">🔍</div>
      <div>无匹配记录</div>
      ${(historySearchText || historyFilterArea || historyFilterDate || historyFilterTamper)
        ? `<button class="btn btn-sm btn-outline" style="margin-top:8px" data-action="clearHistoryFilters">清除筛选</button>` : ''}
    </div>`;
    return;
  }

  listEl.innerHTML = list.map(s => {
    const tamperLogs = (s.logs || []).some(l => l.includes('管控完整性异常') || l.includes('篡改'));
    const hasTamper  = s._tamperDetected || s.tamperDetected || tamperLogs;
    const dur        = calcDuration(s);
    const durMs      = (s.restrictedAt && s.exitedAt) ? new Date(s.exitedAt) - new Date(s.restrictedAt) : 0;
    const isLong     = durMs > 8 * 3600000;
    const active     = s.id === historySelectedId ? ' is-active' : '';
    const tamperCls  = hasTamper ? ' has-tamper' : '';
    const exitDate   = s.exitedAt ? new Date(s.exitedAt).toLocaleDateString('zh-CN') : '—';
    const exitTime   = s.exitedAt ? new Date(s.exitedAt).toLocaleTimeString('zh-CN', {hour12:false, hour:'2-digit', minute:'2-digit'}) : '';
    return `<div class="hist-row${active}${tamperCls}" data-action="selectHistoryRow" data-id="${s.id}">
      <div class="hist-row-top">
        <span class="hist-row-name">${esc(s.visitorName)}</span>
        <div class="hist-row-badges">
          ${hasTamper ? '<span class="pill pill-err" style="font-size:8px">⚠</span>' : ''}
          ${s.selfCheckin ? '<span class="pill" style="font-size:8px">自</span>' : ''}
        </div>
      </div>
      <div class="hist-row-meta">
        <span>${esc(s.area)}</span>
        ${s.visitorCompany ? `<span>${esc(s.visitorCompany)}</span>` : ''}
        <span>${exitDate} ${exitTime}</span>
      </div>
      ${dur ? `<div class="hist-row-duration ${isLong ? 'long' : ''}">⏱ ${dur}${isLong ? ' ⚠' : ''}</div>` : ''}
    </div>`;
  }).join('');
}

function renderHistoryDetail(id) {
  const s = sessionsMap.get(id);
  const detailCol = document.getElementById('historyDetailCol');
  if (!detailCol) return;
  if (!s) {
    detailCol.innerHTML = `<div class="hist-empty"><div class="hist-empty-icon">❓</div><div>找不到该记录</div></div>`;
    return;
  }

  const tamperLogs   = (s.logs || []).filter(l => l.includes('管控完整性异常') || l.includes('篡改'));
  const hasTamper    = s._tamperDetected || s.tamperDetected || tamperLogs.length > 0;
  const tamperDesc   = (s.tamperDetails || []).join('；') || tamperLogs.map(l => l.replace(/^\[.+?\]\s*/, '')).join('；');
  const dur          = calcDuration(s);
  const durMs        = (s.restrictedAt && s.exitedAt) ? new Date(s.exitedAt) - new Date(s.restrictedAt) : 0;
  const isLong       = durMs > 8 * 3600000;

  const fmtTime = t => t ? new Date(t).toLocaleString('zh-CN', {hour12:false}) : '—';

  const tlItems = [
    { label: '登记入场',  time: fmtTime(s.createdAt),    cls: s.createdAt ? 'done' : 'skip' },
    { label: '管控生效',  time: fmtTime(s.restrictedAt), cls: s.restrictedAt ? 'done' : 'skip' },
    { label: '离厂解除',  time: fmtTime(s.exitedAt),     cls: s.exitedAt ? 'done' : 'skip' },
  ];

  if (hasTamper) {
    const tamperTime = tamperLogs.length > 0
      ? (tamperLogs[0].match(/^\[(\d{2}:\d{2}:\d{2})\]/)?.[1] || '')
      : '';
    tlItems.splice(2, 0, { label: '⚠ 篡改检测', time: tamperTime, cls: 'danger' });
  }

  const logsHtml = (s.logs || []).length
    ? (s.logs || []).map(l => {
        const isErr = /❌|异常|篡改/i.test(l) || l.toLowerCase().includes('error');
        return `<span class="hist-log-line ${isErr ? 'err' : ''}">${esc(l)}</span>`;
      }).join('')
    : '<span class="hist-log-line" style="color:var(--text-dim)">（无操作日志）</span>';

  detailCol.innerHTML = `
    <div class="hist-detail-header">
      <div>
        <div class="hist-detail-name">${esc(s.visitorName)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-top:3px">${esc(s.area)}${s.visitorCompany ? ' · ' + esc(s.visitorCompany) : ''}</div>
      </div>
      <div class="hist-detail-actions">
        <button class="btn-export btn-sm" data-action="exportSingleRecord" data-id="${s.id}">↓ 下载存档</button>
      </div>
    </div>

    <div class="hist-detail-scroll">

      ${hasTamper ? `
      <div class="hist-tamper-block">
        <div class="hist-tamper-title">🚨 安全告警：检测到管控篡改</div>
        <div class="hist-tamper-detail">${esc(tamperDesc || '管控完整性验证失败，详见日志')}</div>
      </div>` : ''}

      <!-- 基本信息 -->
      <div class="hist-detail-section">
        <div class="hist-detail-section-title">基本信息</div>
        <div class="hist-info-grid">
          <div class="hist-info-cell">
            <div class="hist-info-key">访客姓名</div>
            <div class="hist-info-val sans">${esc(s.visitorName)}</div>
          </div>
          <div class="hist-info-cell">
            <div class="hist-info-key">公司/单位</div>
            <div class="hist-info-val sans">${esc(s.visitorCompany || '—')}</div>
          </div>
          <div class="hist-info-cell">
            <div class="hist-info-key">进入区域</div>
            <div class="hist-info-val sans">${esc(s.area)}</div>
          </div>
          <div class="hist-info-cell">
            <div class="hist-info-key">入场方式</div>
            <div class="hist-info-val sans">${s.selfCheckin ? '自助入场' : '人工登记'}</div>
          </div>
          <div class="hist-info-cell">
            <div class="hist-info-key">设备 IP</div>
            <div class="hist-info-val">${esc(s.deviceIp || '—')}</div>
          </div>
          <div class="hist-info-cell">
            <div class="hist-info-key">厂区 WiFi</div>
            <div class="hist-info-val">${esc(s.wifiSsid || '—')}</div>
          </div>
          <div class="hist-info-cell full-width">
            <div class="hist-info-key">设备 ID</div>
            <div class="hist-info-val" style="font-size:10px">${esc(s.deviceId || '—')}</div>
          </div>
        </div>
      </div>

      <!-- 进出时间轴 -->
      <div class="hist-detail-section">
        <div class="hist-detail-section-title">进出时间轴${dur ? `<span style="font-family:var(--mono);font-size:10px;color:${isLong ? 'var(--yellow)' : 'var(--text-dim)'}">在厂 ${dur}${isLong ? ' ⚠ 超长停留' : ''}</span>` : ''}</div>
        <div class="hist-timeline">
          ${tlItems.map(item => `
          <div class="hist-tl-item">
            <div class="hist-tl-dot ${item.cls}"></div>
            <div class="hist-tl-label">${item.label}</div>
            <div class="hist-tl-time">${item.time}</div>
          </div>`).join('')}
        </div>
      </div>

      <!-- 操作日志 -->
      <div class="hist-detail-section">
        <div class="hist-detail-section-title">操作日志（${(s.logs || []).length} 条）</div>
        <div class="hist-log-wrap">
          <div class="hist-log-header">
            <span>只读存档</span>
            <span style="font-family:var(--mono)">${esc(s.id.slice(0,8))}…</span>
          </div>
          <div class="hist-log-body">${logsHtml}</div>
        </div>
      </div>

    </div>
  `;
}

function selectHistoryRow(id) {
  historySelectedId = id;
  // 更新列表高亮
  document.querySelectorAll('.hist-row').forEach(el => el.classList.remove('is-active'));
  document.querySelectorAll('.hist-row').forEach(el => {
    if (el.dataset.id === id) el.classList.add('is-active');
  });
  renderHistoryDetail(id);
}

function onHistoryFilterChange(type, value) {
  if (type === 'search') historySearchText = value;
  else if (type === 'area') historyFilterArea = value;
  else if (type === 'date') historyFilterDate = value;
  else if (type === 'tamper') historyFilterTamper = !!value;
  renderHistoryList();
  // 更新统计条和结果数
  const stats = getHistoryStats(getFilteredExitedSessions());
  const countEl = document.querySelector('.hist-result-count');
  if (countEl) countEl.textContent = getFilteredExitedSessions().length + ' 条';
  // 重新生成汇总行
  const statEls = document.querySelectorAll('.hist-stat-val');
  if (statEls.length >= 5) {
    statEls[0].textContent = stats.total;
    statEls[1].textContent = stats.filtered;
    statEls[2].textContent = stats.avgMin > 0 ? (stats.avgMin >= 60 ? Math.round(stats.avgMin/60)+'h' : stats.avgMin+'m') : '—';
    statEls[3].textContent = stats.longStayCount;
    statEls[4].textContent = stats.tamperCount;
  }
  // 同步选中状态
  if (historySelectedId) {
    const list = getFilteredExitedSessions();
    if (!list.some(s => s.id === historySelectedId) && list.length) {
      historySelectedId = list[0].id;
      renderHistoryDetail(historySelectedId);
    }
  }
}

function clearHistorySearch() {
  historySearchText = '';
  const inp = document.getElementById('historySearchInput');
  if (inp) { inp.value = ''; inp.focus(); }
  onHistoryFilterChange('search', '');
}

function clearHistoryFilters() {
  historySearchText   = '';
  historyFilterArea   = '';
  historyFilterDate   = '';
  historyFilterTamper = false;
  renderHistoryFullPage();
}

function onHistorySearchInput(v) { onHistoryFilterChange('search', v); }
function refreshHistoryPageIfOpen() {
  if (activeView !== 'history') return;
  renderHistoryList();
  if (historySelectedId) renderHistoryDetail(historySelectedId);
}
function syncHistorySelectionAfterFilter() {
  const list = getFilteredExitedSessions();
  if (historySelectedId && list.some(s => s.id === historySelectedId)) return;
  historySelectedId = list.length ? list[0].id : null;
}



// ─── 操作 ────────────────────────────────────────────────────
async function retrySession(id) {
  const res = await fetchWithAuth(`/api/sessions/${id}/retry`, { method: 'POST' });
  if (!res.ok) { const d = await res.json().catch(()=>({})); alert('重试失败：' + (d.error || 'HTTP ' + res.status)); }
  else alert('已触发重试，请稍候…');
}

async function regeneratePairing(id, btn) {
  const s = sessionsMap.get(id);
  if (!s) return;
  if (!confirm(`为访客「${s.visitorName}」重新生成配对码？\n访客需重新扫进厂码。`)) return;
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const res = await fetchWithAuth(`/api/sessions/${id}/regenerate-pairing`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      alert('操作失败：' + (d.error || 'HTTP ' + res.status));
    }
    // sessionUpdate WS 事件会自动刷新卡片
  } catch (e) {
    alert('请求失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 重新生成配对码'; }
  }
}

async function retryConnect(id, btn) {
  const s = sessionsMap.get(id);
  if (!s) return;
  if (btn && btn.dataset.busy === '1') return;
  if (!confirm(`确认重试 ${s.visitorName} 的 ADB 连接？`)) return;
  if (btn) {
    btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = '🔌 重试中…';
    setTimeout(() => { btn.disabled = false; btn.dataset.busy = '0'; btn.textContent = '🔌 重试连接'; }, 8000);
  }
  const res = await fetchWithAuth(`/api/sessions/${id}/retry-connect`, { method: 'POST' });
  if (!res.ok) { const d = await res.json().catch(()=>({})); alert('重试连接失败：' + (d.error || 'HTTP ' + res.status)); }
  else alert('已触发重试连接，请稍候…');
}

// [修复#1] recover-enable 接口调用
async function enableRecoverPairing(id, btn) {
  const s = sessionsMap.get(id);
  if (!s) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetchWithAuth(`/api/sessions/${id}/recover-enable`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      alert('操作失败：' + (d.error || 'HTTP ' + res.status));
      if (btn) { btn.disabled = false; btn.textContent = '🔁 恢复配对'; }
      return;
    }
    // 更新本地会话状态以即时刷新 UI
    s.recoverPairingEnabled = true;
    renderVisitorTableBody();
  } catch (e) {
    alert('请求失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔁 恢复配对'; }
  }
}

async function forceExit(id) {
  const s = sessionsMap.get(id);
  if (!s) return;
  if (!confirm(`确认强制解除 ${s.visitorName} 的管控并离厂？`)) return;
  const res = await fetchWithAuth(`/api/sessions/${id}/force-exit`, { method: 'POST' });
  if (!res.ok) { const d = await res.json().catch(()=>({})); alert('强制离厂失败：' + (d.error || 'HTTP ' + res.status)); }
}

// ─── 日志辅助 ────────────────────────────────────────────────
function parseLogEntries(session) {
  return (session.logs || []).map(line => {
    const m = String(line).match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/);
    return { time: m ? m[1] : '--:--:--', message: m ? m[2] : String(line) };
  });
}
function hasStep(entries, patterns) {
  return entries.some(e => patterns.some(p => p.test(e.message)));
}

// ─── 标签与文案 ─────────────────────────────────────────────
function statusLabel(s) {
  return { waiting:'WAITING', pairing:'PAIRING', paired_not_connected:'CONN LOST', restricted:'PROTECTED', exiting:'EXITING', exited:'EXITED', error:'ERROR' }[s] || s;
}
function statusEmoji(s) {
  return { waiting:'⏳', pairing:'📡', paired_not_connected:'⚠️', restricted:'🔒', exiting:'🚪', exited:'✅', error:'❌' }[s] || '•';
}
function getStatusMsg(status) {
  return {
    waiting:              '等待 APP 上报设备…',
    pairing:              '等待访客扫 ADB 配对码…',
    paired_not_connected: '已配对但未连接，请重试',
    restricted:           '管控已生效',
    exiting:              '正在解除管控…',
    exited:               '访客已离厂',
    error:                '发生错误，请查看日志',
  }[status] || status;
}
function reasonLabel(reason) {
  return {
    mdns_connect_missing:  '未收到 connect 广播',
    adb_connect_failed:    'adb connect 失败',
    not_in_adb_devices:    '设备未出现在 adb devices',
    device_disconnected:   '管控中途 WiFi 断开',
    pairing_timeout:       '配对流程超时（15 分钟）',
    server_restart:        '服务器重启，mDNS 监听器已重置',
  }[reason] || reason || '—';
}

// ─── 加载 ────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const siteId = window._currentSiteId || '';
    if (!siteId) { console.warn('[loadSessions] 无 siteId，跳过'); return; }
    const res  = await fetchWithAuth(`/api/sessions?siteId=${encodeURIComponent(siteId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[loadSessions] 失败:', res.status, err.error || err.message);
      return;
    }
    const list = await res.json();
    list.forEach(s => sessionsMap.set(s.id, s));
    renderHomeDashboard();
  } catch (e) { console.warn('[loadSessions] error:', e); }
}

async function loadHistorySessionsPersisted() {
  try {
    const siteId = window._currentSiteId || '';
    if (!siteId) return;
    const params = new URLSearchParams({
      siteId,
      status: 'exited',
      limit: '500',
      offset: '0',
    });
    const res = await fetchWithAuth(`/api/history/sessions?${params.toString()}`);
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    items.forEach(s => sessionsMap.set(s.id, s));
  } catch (e) {
    console.warn('[loadHistorySessionsPersisted] error:', e);
  }
}

// ─── 工具 ────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function formatTime(t) {
  if (!t) return '—';
  return new Date(t).toLocaleString('zh-CN', { hour12: false });
}

// ── Override connectWS after admin JS defined it ────────────
function connectWS() { _origConnectWS(); }

// ── SaaS-specific overrides ──────────────────────────────────

// Subscription selector in area dropdown
function renderCheckinAreaTabs() {
  const sel = document.getElementById('checkinAreaSelect');
  if (!sel) return;

  // If we have multiple subs, show them as options too
  if (_subs && _subs.length > 1) {
    sel.innerHTML = _subs.map(s => {
      if (!s.site_id) return '';
      const key = `__site__${s.site_id}`;
      const active = s.site_id === _currentSiteId ? ' selected' : '';
      const days = s.status==='trial' ? `试用${s.remainingDays}天` : s.status==='active' ? `有效${s.remainingDays}天` : '已过期';
      return `<option value="${key}"${active}>[订阅] ${esc(s.area_name)} (${days})</option>`;
    }).join('') + CHECKIN_AREAS.map(a =>
      `<option value="${esc(a.name)}"${a.name===currentCheckinArea?' selected':''}>${esc(a.name)}</option>`
    ).join('');
    return;
  }

  // Single subscription: use areas from API
  sel.innerHTML = CHECKIN_AREAS.map(a =>
    `<option value="${esc(a.name)}"${a.name===currentCheckinArea?' selected':''}>${esc(a.name)}</option>`
  ).join('');
  if (!currentCheckinArea && CHECKIN_AREAS.length) currentCheckinArea = CHECKIN_AREAS[0].name;
}

// onAreaSelectChange override
function onAreaSelectChange(val) {
  if (val.startsWith('__site__')) {
    // Switch site
    let sub = null;
    const newSiteId = val.replace('__site__', '');
    _currentSiteId = newSiteId;
    sub = _subs.find(s => s.site_id === newSiteId) || null;
    if (sub) _currentSubId = sub.id;
    localStorage.setItem('dashboard_site_id', newSiteId);
    if (_currentSubId) localStorage.setItem('dashboard_sub_id', _currentSubId);
    window._currentSubId = _currentSubId;
    window._currentSiteId = _currentSiteId;
    if (!sub) sub = _subs.find(s=>s.id===_currentSubId) || null;
    if (sub) {
      document.getElementById('headerTitle').textContent = sub.area_name;
      window._currentSubName = sub.area_name;
    }
    sessionsMap.clear();
    loadCheckinQR();
    loadFeatureUI();
    loadSessions();
    return;
  }
  _adminOnAreaSelectChange(val);
}

// ── 管控功能显示（只读） ──────────────────────────────────────

function loadFeatureUI() {
  const sub = _subs && _subs.find(s => s.id === _currentSubId);
  const cam = sub ? !!sub.feature_camera : true;
  const ss  = sub ? !!sub.feature_screenshot : false;

  const camDot   = document.getElementById('featureCameraDot');
  const camLabel = document.getElementById('featureCameraLabel');
  const ssDot    = document.getElementById('featureScreenshotDot');
  const ssLabel  = document.getElementById('featureScreenshotLabel');
  if (camDot)   { camDot.className   = 'feature-dot ' + (cam ? 'on' : 'off'); }
  if (camLabel) { camLabel.className = 'feature-label' + (cam ? '' : ' off'); }
  if (ssDot)    { ssDot.className    = 'feature-dot ' + (ss ? 'on' : 'off'); }
  if (ssLabel)  { ssLabel.className  = 'feature-label' + (ss ? '' : ' off'); }


}

// ── CSP 兼容事件委托 ──────────────────────────────────────────
document.addEventListener('click', (e) => {
  // Handle data-stop-prop elements (prevent card click propagation)
  if (e.target.closest('[data-stop-prop]')) { e.stopPropagation(); }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  e.stopPropagation();
  switch (action) {
    case 'dismissAlert':           dismissAlert(id); break;
    case 'selectAndDismissAlert':  selectSession(el.dataset.sessionId); dismissAlert(id); break;
    case 'openHistoryPage':        openHistoryPage('', null); break;
    case 'clearVisitorSearch':     clearVisitorSearch(); break;
    case 'closeVisitorLogPopover': closeVisitorLogPopover(); break;
    case 'clearVisitorFilter':     clearVisitorFilter(); break;
    case 'setVisitorFilterStatus': setVisitorFilterStatus(el.dataset.value); break;
    case 'selectSession':          selectSession(id); break;
    case 'enableRecoverPairing':   enableRecoverPairing(id, el); break;
    case 'retrySession':           retrySession(id); break;
    case 'regeneratePairing':      regeneratePairing(id, el); break;
    case 'retryConnect':           retryConnect(id, el); break;
    case 'forceExit':              forceExit(id); break;
    case 'openVisitorLogPopover':  openVisitorLogPopover(id); break;
    case 'selectHome':             selectHome(); break;
    case 'exportHistoryCSV':       exportHistoryCSVFromServer(el.dataset.scope); break;
    case 'clearHistorySearch':     clearHistorySearch(); break;
    case 'clearHistoryFilters':    clearHistoryFilters(); break;
    case 'selectHistoryRow':       selectHistoryRow(id); break;
    case 'exportSingleRecord':     exportSingleRecord(sessionsMap.get(id)); break;
  }
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-on-input]');
  if (!el) return;
  switch (el.dataset.onInput) {
    case 'onVisitorSearch': onVisitorSearch(el.value); break;
    case 'historySearch':   onHistoryFilterChange('search', el.value); break;
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-on-change]');
  if (!el) return;
  switch (el.dataset.onChange) {
    case 'historyFilterArea':   onHistoryFilterChange('area', el.value); break;
    case 'historyFilterDate':   onHistoryFilterChange('date', el.value); break;
    case 'historyFilterTamper': onHistoryFilterChange('tamper', el.checked); break;
  }
});

// ── Start ────────────────────────────────────────────────────
init();
