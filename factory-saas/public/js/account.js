let subs = [], selectedSubId = null;
const rebindRequestsBySite = {};

function readCookie(name) {
  const key = `${name}=`;
  const found = document.cookie.split(';').map(s => s.trim()).find(v => v.startsWith(key));
  return found ? decodeURIComponent(found.slice(key.length)) : '';
}

async function api(url, opts={}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type':'application/json', ...(opts.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const r = await fetch(url, { ...opts, method, headers, credentials: 'include' });
  if (r.status === 401) { location.href='/login'; throw new Error('UNAUTH'); }
  return r;
}
// 兼容 admin.html 的 visitor 函数调用方式
const fetchWithAuth = api;

async function init() {
  // Bind static event listeners
  document.getElementById('btnBackDashboard').addEventListener('click', () => location.href='/dashboard');
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnAddSub').addEventListener('click', addSubscription);

  const me = await api('/api/auth/me').then(r=>r.json());
  document.getElementById('userName').textContent = me.name;

  subs = await api('/api/user/subscriptions').then(r=>r.json());
  renderSubList();
  if (subs.length) selectSub(subs[0].id);
}

async function refreshSubscriptions() {
  subs = await api('/api/user/subscriptions').then(r=>r.json());
}

async function loadRebindRequests(siteId, force = false) {
  if (!siteId) return [];
  if (!force && rebindRequestsBySite[siteId]) return rebindRequestsBySite[siteId];
  const r = await api(`/api/sites/${siteId}/network-rebind-requests`);
  const d = await r.json();
  rebindRequestsBySite[siteId] = Array.isArray(d) ? d : [];
  return rebindRequestsBySite[siteId];
}

function renderSubList() {
  const el = document.getElementById('subList');
  if (!subs.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">🏭</div>暂无厂区，点击上方新增</div>'; return; }
  el.innerHTML = subs.map(s => {
    const badgeCls = s.status === 'trial' ? 'badge-trial' : s.status === 'active' ? 'badge-active' : 'badge-expired';
    const badgeText = s.status === 'trial' ? `试用 ${s.remainingDays}天` : s.status === 'active' ? `有效 ${s.remainingDays}天` : '已过期';
    const wifiBound = s.wifi_locked && s.wifi_subnet;
    return `<div class="sub-card ${s.id===selectedSubId?'active':''}" data-action="selectSub" data-id="${s.id}">
      <div class="sub-card-top">
        <span class="sub-name">${esc(s.area_name)}</span>
        <span class="sub-badge ${badgeCls}">${badgeText}</span>
      </div>
      <div class="sub-meta">${s.status === 'trial' ? '本地部署' : s.status === 'active' ? '运行中' : '已停用'}</div>
      <div class="sub-wifi ${wifiBound?'bound':''}">
        ${wifiBound ? `🔒 绑定：${s.wifi_subnet}.x` : '⚪ WiFi 未绑定（首次使用自动绑定）'}
      </div>
    </div>`;
  }).join('');
}

// ── 入场码 ────────────────────────────────────────────────
const qrCache = {};

async function loadQr(subId, forceRefresh = false) {
  if (!forceRefresh && qrCache[subId]) {
    applyQr(subId, qrCache[subId]);
    return;
  }
  const wrap = document.getElementById('qrImgWrap-' + subId);
  const urlEl = document.getElementById('qrUrl-' + subId);
  if (wrap) wrap.innerHTML = '<div class="qr-img-placeholder">生成中…</div>';

  try {
    const sub = subs.find(s => s.id === subId);
    const siteId = sub?.site_id || '';
    if (!siteId) {
      if (wrap) wrap.innerHTML = `<div class="qr-img-placeholder" style="color:var(--red)">缺少 siteId，无法生成</div>`;
      return;
    }
    const r = await api(`/api/checkin-qr?siteId=${encodeURIComponent(siteId)}`);
    if (!r.ok) {
      const d = await r.json().catch(()=>({}));
      if (wrap) wrap.innerHTML = `<div class="qr-img-placeholder" style="color:var(--red)">${d.message || '生成失败'}</div>`;
      return;
    }
    const data = await r.json();
    qrCache[subId] = data;
    applyQr(subId, data);
  } catch(e) {
    if (wrap) wrap.innerHTML = `<div class="qr-img-placeholder" style="color:var(--red)">网络错误</div>`;
  }
}

function applyQr(subId, data) {
  const wrap  = document.getElementById('qrImgWrap-' + subId);
  const urlEl = document.getElementById('qrUrl-' + subId);
  if (wrap)  wrap.innerHTML  = `<img src="${data.qr}" alt="入场码">`;
  if (urlEl) urlEl.textContent = data.url || '';
}

async function copyQrUrl(subId) {
  const urlEl = document.getElementById('qrUrl-' + subId);
  const url   = urlEl?.textContent?.trim();
  if (!url || url === '生成中…') return;
  try {
    await navigator.clipboard.writeText(url);
    const btn = urlEl.nextElementSibling;
    if (btn) { btn.textContent = '已复制'; setTimeout(()=>{ btn.textContent = '复制'; }, 2000); }
  } catch { alert('请长按链接手动复制：' + url); }
}

async function selectSub(id) {
  selectedSubId = id;
  renderSubList();
  const sub = subs.find(s=>s.id===id);
  if (!sub) return;
  if (sub.site_id) {
    try { await loadRebindRequests(sub.site_id); } catch {}
  }
  renderSubDetail(sub);
  // 自动加载入场码（过期不加载）
  if (sub.status !== 'expired') loadQr(id);
}

function renderSubDetail(sub) {
  const mainEl = document.getElementById('mainContent');

  mainEl.innerHTML = `
  <div class="tab-panel active" id="tab-manage">

  <div class="section">
    <div class="section-title">管控功能定制</div>
    <div class="feature-card">
      <div class="feature-item">
        <input type="checkbox" id="feat-camera-${sub.id}" ${sub.feature_camera ? 'checked' : ''} data-on-change="onAccountFeatureChange" data-id="${sub.id}">
        <div class="feature-item-info">
          <div class="feature-item-name">禁止拍照（关闭摄像头）</div>
          <div class="feature-item-desc">冻结相机 APP、封锁所有应用的摄像头权限</div>
        </div>
        <div class="feature-item-price">${sub.feature_camera ? '已启用' : '未启用'}</div>
      </div>
      <div class="feature-item">
        <input type="checkbox" id="feat-screenshot-${sub.id}" ${sub.feature_screenshot ? 'checked' : ''} data-on-change="onAccountFeatureChange" data-id="${sub.id}">
        <div class="feature-item-info">
          <div class="feature-item-name">禁止截屏/录屏</div>
          <div class="feature-item-desc">禁用截屏、屏幕录制、移除控制中心截屏按钮</div>
        </div>
        <div class="feature-item-price off">${sub.feature_screenshot ? '已启用' : '未启用'}</div>
      </div>
      <div class="feature-summary">
        <div class="feature-summary-total">摄像头：<span id="feat-total-${sub.id}">${sub.feature_camera ? '开启' : '关闭'}</span> · 截屏管控：<span>${sub.feature_screenshot ? '开启' : '关闭'}</span></div>
        <button class="btn-save-features" id="feat-save-${sub.id}" data-action="saveAccountFeatures" data-id="${sub.id}" disabled>保存设置</button>
      </div>
      <div id="feat-msg-${sub.id}" class="feature-msg"></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">WiFi IP 绑定管理</div>
    <div class="wifi-card">
      <div class="wifi-status">
        <div class="wifi-dot ${sub.wifi_locked?'bound':''}"></div>
        <div class="wifi-info">${sub.wifi_locked&&sub.wifi_subnet ? `已绑定到 ${sub.wifi_subnet}.x 网络` : '尚未绑定'}</div>
      </div>
      <div class="wifi-desc">绑定后，只有来自该 WiFi 网段的访客才能使用此订阅入场，防止同一账户在多个厂区使用。<br>若网络变更，请提交重绑申请等待管理员审批。</div>
      ${!sub.wifi_locked ? `<button class="btn-bind" data-action="bindIp" data-id="${sub.id}">📍 绑定当前 WiFi</button>` : `<button class="btn-bind" data-action="submitRebindRequest" data-id="${sub.id}">📝 提交重绑申请</button>`}
      <div class="rebind-history">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">网络重绑申请记录</div>
        ${renderRebindHistory(sub)}
      </div>
    </div>
  </div>
  </div><!-- /tab-manage -->
  `;
}

function renderRebindHistory(sub) {
  const siteId = sub.site_id;
  const rows = siteId ? (rebindRequestsBySite[siteId] || []) : [];
  if (!siteId) return `<div style="font-size:12px;color:var(--text-dim)">当前订阅暂无 site_id，暂不支持重绑申请。</div>`;
  if (!rows.length) return `<div style="font-size:12px;color:var(--text-dim)">暂无申请记录</div>`;
  const statusLabel = { pending_review: '待审核', approved: '已通过', rejected: '已拒绝', cancelled: '已取消' };
  const statusCls = { pending_review: 'badge-review', approved: 'badge-ok', rejected: 'badge-no', cancelled: 'badge-no' };
  return rows.map(r => `
    <div class="rebind-item">
      <div class="rebind-top">
        <span class="rebind-subnet">${esc(r.candidate_subnet)}</span>
        <span class="badge-small ${statusCls[r.status] || 'badge-review'}">${statusLabel[r.status] || r.status}</span>
      </div>
      <div class="rebind-meta">
        申请时间：${new Date(r.created_at).toLocaleString('zh-CN')}<br>
        原因：${esc(r.reason || '—')}${r.review_note ? `<br>审核备注：${esc(r.review_note)}` : ''}
      </div>
    </div>
  `).join('');
}

function showPaySection(subId) {
  const el = document.getElementById('paySection-' + subId);
  if (el) { el.style.display = ''; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function renderPaymentTable(list) {
  if (!list.length) return '<div class="empty"><div class="empty-icon">💳</div>暂无支付记录</div>';
  const statusText = {
    pending_payment: '待支付',
    paid_pending_review: '审核中',
    confirmed: '已确认',
    rejected: '已拒绝',
    cancelled: '已取消',
    expired: '已过期',
  };
  const statusCls  = {
    pending_payment: 'status-pending',
    paid_pending_review: 'status-pending',
    confirmed: 'status-confirmed',
    rejected: 'status-rejected',
  };
  return `<table class="pay-table"><thead><tr><th>套餐</th><th>金额</th><th>流水号</th><th>提交时间</th><th>状态</th><th>发票</th></tr></thead><tbody>
    ${list.map(p=>{
      const invReq = invoices.find(i => i.order_id === p.id);
      const invCell = p.status === 'confirmed'
        ? (invReq
          ? `<span class="invoice-status invoice-${invReq.status}">${invReq.status==='pending'?'申请中':invReq.status==='issued'?'已开具':'已拒绝'}</span>`
          : `<button class="btn-invoice-sm" data-action="showInvoiceForm" data-id="${p.id}">申请</button>`)
        : '—';
      return `<tr>
      <td>${(p.plan_code || p.plan)==='monthly'?'月度':'年度'}</td>
      <td>¥${(p.amount_fen/100).toFixed(2)}</td>
      <td style="font-family:var(--mono);font-size:11px">${esc(p.txn_id||'—')}</td>
      <td style="font-family:var(--mono);font-size:11px">${new Date(p.created_at).toLocaleDateString('zh-CN')}</td>
      <td class="${statusCls[p.status]||''}">${statusText[p.status]||p.status}</td>
      <td>${invCell}</td>
    </tr>`;}).join('')}
  </tbody></table>`;
}

function renderInvoiceSection(sub, myPayments) {
  const confirmedOrders = myPayments.filter(p => p.status === 'confirmed');
  const myInvoices = invoices.filter(i => confirmedOrders.some(o => o.id === i.order_id));

  if (!confirmedOrders.length && !myInvoices.length) {
    return '<div class="empty" style="padding:16px"><div class="empty-icon">🧾</div>暂无可开票订单。订单确认付款后方可申请发票。</div>';
  }

  const invStatusText = { pending: '⏳ 待开具', issued: '✅ 已开具', rejected: '❌ 已拒绝' };
  const invRows = myInvoices.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">发票申请记录</div>
      <table class="pay-table"><thead><tr><th>抬头</th><th>税号</th><th>金额</th><th>类型</th><th>申请时间</th><th>状态</th></tr></thead><tbody>
        ${myInvoices.map(i => `<tr>
          <td>${esc(i.title)}</td>
          <td style="font-family:var(--mono);font-size:11px">${esc(i.tax_number)}</td>
          <td>¥${(i.amount_fen/100).toFixed(2)}</td>
          <td>${i.invoice_type==='special'?'专票':'普票'}</td>
          <td style="font-family:var(--mono);font-size:11px">${new Date(i.created_at).toLocaleDateString('zh-CN')}</td>
          <td>${invStatusText[i.status]||i.status}${i.status==='rejected'&&i.reject_reason?`<br><span style="font-size:11px;color:var(--red)">${esc(i.reject_reason)}</span>`:''}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>` : '';

  // 可开票但未申请的订单
  const pendingInvOrders = confirmedOrders.filter(o => !invoices.some(i => i.order_id === o.id));

  return `
    ${invRows}
    <div id="invoiceFormWrap" style="display:none">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">📝 申请开票</div>
      <input type="hidden" id="invoiceOrderId">
      <div class="field-group">
        <label>发票类型</label>
        <select id="invoiceType" data-on-change="onInvoiceTypeChange">
          <option value="normal">增值税普通发票</option>
          <option value="special">增值税专用发票</option>
        </select>
      </div>
      <div class="field-group">
        <label>公司名称（必填）</label>
        <input type="text" id="invoiceTitle" placeholder="开票公司全称">
      </div>
      <div class="field-group">
        <label>纳税人识别号（必填）</label>
        <input type="text" id="invoiceTaxNumber" placeholder="统一社会信用代码">
      </div>
      <div id="invoiceSpecialFields" style="display:none">
        <div class="field-group">
          <label>公司地址（专票必填）</label>
          <input type="text" id="invoiceAddress" placeholder="注册地址">
        </div>
        <div class="field-group">
          <label>公司电话（专票必填）</label>
          <input type="text" id="invoicePhone" placeholder="公司电话">
        </div>
        <div class="field-group">
          <label>开户银行（专票必填）</label>
          <input type="text" id="invoiceBankName" placeholder="开户银行名称">
        </div>
        <div class="field-group">
          <label>银行账号（专票必填）</label>
          <input type="text" id="invoiceBankAccount" placeholder="银行账号">
        </div>
      </div>
      <div class="field-group">
        <label>接收邮箱（必填）</label>
        <input type="email" id="invoiceEmail" placeholder="发票将发送到此邮箱">
      </div>
      <button class="btn-submit" data-action="submitInvoiceRequest">提交发票申请</button>
      <div id="invoiceMsg" style="margin-top:12px"></div>
    </div>
    ${pendingInvOrders.length && !invRows ? '<div style="font-size:12px;color:var(--text-dim)">在支付记录中点击「申请」按钮为已确认的订单申请发票</div>' : ''}
  `;
}
let selectedPlan = 'monthly';
function selectPlan(plan, subId) {
  selectedPlan = plan;
  document.getElementById('plan-monthly').classList.toggle('selected', plan==='monthly');
  document.getElementById('plan-yearly').classList.toggle('selected', plan==='yearly');
  // 更新待支付金额显示
  const sub = subs.find(s => s.id === subId);
  if (sub) {
    const baseM = Number(payInfo.prices?.monthly || 9900);
    const baseY = Number(payInfo.prices?.yearly  || 99900);
    const ssM   = Number(payInfo.prices?.screenshotAddonMonthly || 5000);
    const ssY   = Number(payInfo.prices?.screenshotAddonYearly  || 50000);
    const total = plan === 'yearly'
      ? (baseY + (sub.feature_screenshot ? ssY : 0))
      : (baseM + (sub.feature_screenshot ? ssM : 0));
    const el = document.getElementById(`payAmountDisplay-${subId}`);
    if (el) el.textContent = (total / 100).toFixed(2);
  }
}

function toggleTransfer(subId) {
  const el = document.getElementById('transferBlock-' + subId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function submitPayment(subId) {
  const txnId  = document.getElementById(`txnId-${subId}`).value.trim();
  const notes  = document.getElementById(`payNotes-${subId}`).value.trim();
  const msgEl  = document.getElementById(`payMsg-${subId}`);

  try {
    const sub = subs.find(s => s.id === subId);
    if (!sub || !sub.site_id) {
      msgEl.innerHTML='<div class="alert alert-error">当前厂区缺少 siteId，无法创建订单</div>';
      return;
    }
    const createRes = await api('/api/orders', {
      method:'POST',
      body: JSON.stringify({ siteId: sub.site_id, planCode: selectedPlan }),
    });
    const createBody = await createRes.json();
    if (!createRes.ok || !createBody?.order?.id) {
      msgEl.innerHTML=`<div class="alert alert-error">${createBody.message||createBody.error||'创建订单失败'}</div>`;
      return;
    }
    const payRes = await api(`/api/orders/${createBody.order.id}/pay`, {
      method:'POST',
      body: JSON.stringify({ txnId, note: notes }),
    });
    const payBody = await payRes.json();
    if (!payRes.ok) {
      msgEl.innerHTML=`<div class="alert alert-error">${payBody.message||payBody.error||'提交失败'}</div>`;
      return;
    }
    msgEl.innerHTML='<div class="alert alert-success">✅ 付款申请已提交，管理员审核后将激活订阅（通常 1 个工作日内）</div>';
    orders = await api('/api/orders').then(r=>r.json());
    setTimeout(()=>{ const sub=subs.find(s=>s.id===subId); if(sub) renderSubDetail(sub); }, 1500);
  } catch(e) { msgEl.innerHTML=`<div class="alert alert-error">网络错误：${e.message}</div>`; }
}

async function bindIp(subId) {
  if (!confirm('将当前网络 IP 绑定到此订阅？绑定后只有该 WiFi 网段的访客才能使用此厂区。')) return;
  try {
    const r = await api(`/api/user/subscriptions/${subId}/bind-ip`, { method:'POST' });
    const d = await r.json();
    if (!r.ok) { alert(d.message||'绑定失败'); return; }
    await refreshSubscriptions();
    renderSubList();
    const sub = subs.find(s=>s.id===subId);
    if (sub) renderSubDetail(sub);
  } catch(e) { alert('网络错误'); }
}

async function submitRebindRequest(subId) {
  const sub = subs.find(s => s.id === subId);
  if (!sub || !sub.site_id) { alert('当前厂区标识缺失，无法提交重绑申请'); return; }
  const subnet = prompt('请输入新网络子网（例如 192.168.10），留空则自动识别当前网络：', '');
  if (subnet === null) return;
  const reason = prompt('请输入重绑原因（可选）：', '') || '';
  try {
    const payload = { reason };
    if (subnet.trim()) payload.candidateSubnet = subnet.trim();
    const r = await api(`/api/sites/${sub.site_id}/network-rebind-requests`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.message || d.error || '提交失败'); return; }
    await loadRebindRequests(sub.site_id, true);
    const latest = subs.find(s => s.id === subId);
    if (latest) renderSubDetail(latest);
    alert('已提交重绑申请，等待管理员审核。');
  } catch (e) {
    alert('网络错误，提交失败');
  }
}

async function addSubscription() {
  const name = prompt('请输入新厂区名称：');
  if (!name?.trim()) return;
  await api('/api/user/subscriptions', { method:'POST', body:JSON.stringify({ areaName: name.trim() }) });
  await refreshSubscriptions();
  renderSubList();
}

async function logout() {
  await api('/api/auth/logout', { method:'POST' });
  location.href = '/login';
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── 管控功能定制 ──────────────────────────────────────────────

function onAccountFeatureChange(subId) {
  const sub = subs.find(s => s.id === subId);
  if (!sub) return;
  const cam = document.getElementById(`feat-camera-${subId}`)?.checked;
  const ss  = document.getElementById(`feat-screenshot-${subId}`)?.checked;

  // 更新费用显示
  const total = (cam ? 99 : 0) + (ss ? 50 : 0);
  const totalEl = document.getElementById(`feat-total-${subId}`);
  if (totalEl) totalEl.textContent = total > 0 ? `¥${total}/月` : '未启用';

  // 检测是否有变更
  const changed = (!!cam !== !!sub.feature_camera) || (!!ss !== !!sub.feature_screenshot);
  const btn = document.getElementById(`feat-save-${subId}`);
  if (btn) btn.disabled = !changed;
}

async function saveAccountFeatures(subId) {
  const cam = document.getElementById(`feat-camera-${subId}`)?.checked;
  const ss  = document.getElementById(`feat-screenshot-${subId}`)?.checked;
  const msgEl = document.getElementById(`feat-msg-${subId}`);
  const btn   = document.getElementById(`feat-save-${subId}`);
  if (btn) btn.disabled = true;

  try {
    const r = await api(`/api/user/subscriptions/${subId}/features`, {
      method: 'PUT',
      body: JSON.stringify({ camera: !!cam, screenshot: !!ss }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if (msgEl) msgEl.innerHTML = `<div class="alert alert-error">${d.error || '保存失败'}</div>`;
      if (btn) btn.disabled = false;
      return;
    }
    // 同步到本地缓存
    const sub = subs.find(s => s.id === subId);
    if (sub) { sub.feature_camera = cam ? 1 : 0; sub.feature_screenshot = ss ? 1 : 0; }
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-success">✅ 管控功能已更新，下次续费按新价格计算</div>';
    setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 4000);
    // 刷新支付面板价格
    if (sub) renderSubDetail(sub);
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<div class="alert alert-error">网络错误：${e.message}</div>`;
    if (btn) btn.disabled = false;
  }
}

// ── 发票申请 ──────────────────────────────────────────────────

function showInvoiceForm(orderId) {
  const wrap = document.getElementById('invoiceFormWrap');
  if (!wrap) return;
  document.getElementById('invoiceOrderId').value = orderId;
  wrap.style.display = '';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onInvoiceTypeChange() {
  const type = document.getElementById('invoiceType').value;
  const fields = document.getElementById('invoiceSpecialFields');
  if (fields) fields.style.display = type === 'special' ? '' : 'none';
}

async function submitInvoiceRequest() {
  const orderId    = document.getElementById('invoiceOrderId').value;
  const invoiceType = document.getElementById('invoiceType').value;
  const title      = document.getElementById('invoiceTitle').value.trim();
  const taxNumber  = document.getElementById('invoiceTaxNumber').value.trim();
  const address    = document.getElementById('invoiceAddress')?.value.trim() || '';
  const phone      = document.getElementById('invoicePhone')?.value.trim() || '';
  const bankName   = document.getElementById('invoiceBankName')?.value.trim() || '';
  const bankAccount= document.getElementById('invoiceBankAccount')?.value.trim() || '';
  const email      = document.getElementById('invoiceEmail').value.trim();
  const msgEl      = document.getElementById('invoiceMsg');

  if (!title || !taxNumber || !email) {
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-error">请填写公司名称、税号和接收邮箱</div>';
    return;
  }
  if (invoiceType === 'special' && (!address || !phone || !bankName || !bankAccount)) {
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-error">专票需填写地址、电话、开户银行和银行账号</div>';
    return;
  }

  try {
    const r = await api(`/api/orders/${orderId}/invoice`, {
      method: 'POST',
      body: JSON.stringify({ invoiceType, title, taxNumber, address, phone, bankName, bankAccount, email }),
    });
    const d = await r.json();
    if (!r.ok) {
      if (msgEl) msgEl.innerHTML = `<div class="alert alert-error">${d.message || d.error || '提交失败'}</div>`;
      return;
    }
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-success">✅ 发票申请已提交，开具后将发送到您的邮箱</div>';
    invoices = await api('/api/user/invoices').then(r => r.json()).catch(() => []);
    setTimeout(() => {
      const sub = subs.find(s => s.id === selectedSubId);
      if (sub) renderSubDetail(sub);
    }, 1500);
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<div class="alert alert-error">网络错误：${e.message}</div>`;
  }
}

// ── CSP 兼容事件委托 ──────────────────────────────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  switch (action) {
    case 'selectSub':            selectSub(id); break;
    case 'showPaySection':       showPaySection(id); break;
    case 'toggleTransfer':       toggleTransfer(id); break;
    case 'selectPlan':           selectPlan(el.dataset.plan, id); break;
    case 'submitPayment':        submitPayment(id); break;
    case 'saveAccountFeatures':  saveAccountFeatures(id); break;
    case 'bindIp':               bindIp(id); break;
    case 'submitRebindRequest':  submitRebindRequest(id); break;
    case 'showInvoiceForm':      showInvoiceForm(id); break;
    case 'submitInvoiceRequest': submitInvoiceRequest(); break;
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-on-change]');
  if (!el) return;
  switch (el.dataset.onChange) {
    case 'onAccountFeatureChange': onAccountFeatureChange(el.dataset.id); break;
    case 'onInvoiceTypeChange':    onInvoiceTypeChange(); break;
  }
});

init().catch(console.error);

