import { api } from './api.js';
import { ALERT_STATUS, WORK_ORDER_STATUS } from './types.js';
import { createTencentMap } from './tencent-map.js';

const navItems = [
  ['dashboard','▦','数据总览','运营中心'], ['orders','▤','工单中心','告警与闭环处置'],
  ['map','⌖','地图巡检','空间态势'], ['devices','▣','设备运维','车载设备'], ['settings','⚙','系统配置','规则与权限'],
];
const state = { page:'dashboard', alerts:[], devices:[], orders:[], dashboard:null, orderPages:{ pending:1, processing:1, review:1, completed:1 }, orderFilters:{ pending:{ time:'', priority:'' }, processing:{ time:'', priority:'' }, review:{ time:'', priority:'' }, completed:{ time:'', priority:'' } } };
const dataCache = {
  dashboard:{ value:null, loadedAt:0, pending:null, ttl:120000 },
  alerts:{ value:null, loadedAt:0, pending:null, ttl:120000 },
  orders:{ value:null, loadedAt:0, pending:null, ttl:120000 },
  devices:{ value:null, loadedAt:0, pending:null, ttl:10000 },
};
const pageContent = document.querySelector('#page-content');
const nav = document.querySelector('#main-nav');
const title = document.querySelector('#page-title');
const kicker = document.querySelector('#page-kicker');
const dateButton = document.querySelector('#date-button');
const profileButton = document.querySelector('#profile-button');
const profileRoot = document.querySelector('#profile-root');
const orderSummary = document.querySelector('#order-summary');
const PROFILE_KEY = 'traffic-user-profile';
let deviceRefreshTimer = null;
let deviceRefreshInFlight = false;
let lastDeviceRefresh = null;
let activeMapController = null;

function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function badge(value, type = '') { return `<span class="badge ${type || value}">${esc(value)}</span>`; }
function statusClass(status) { return { pending:'amber', valid:'green', false:'gray', dispatched:'blue', online:'green', warning:'amber', offline:'red', processing:'blue', review:'purple', completed:'green', '正常':'green', '异常':'amber', '离线':'red' }[status] || 'gray'; }
function severityClass(severity) { return { '高':'red', '中':'amber', '低':'green', '安全':'green' }[severity] || 'gray'; }
function setCriticalAlarm(active) { document.body.classList.toggle('critical-alarm', active); }
function showToast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2600); }
function stopDeviceAutoRefresh() { if (deviceRefreshTimer) { clearInterval(deviceRefreshTimer); deviceRefreshTimer = null; } }
function startDeviceAutoRefresh() {
  if (deviceRefreshTimer) return;
  deviceRefreshTimer = setInterval(() => {
    if (state.page !== 'devices') { stopDeviceAutoRefresh(); return; }
    refreshDevices(true).catch(() => {});
  }, 5000);
}

function getProfile() {
  const fallback = { name:'王珊', avatar:'王' };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') }; } catch { return fallback; }
}
function profileAvatar(profile = getProfile()) { return (profile.avatar || profile.name || '用户').trim().slice(0, 2) || '用户'; }
function applyProfile() { profileButton.textContent = profileAvatar(); profileButton.title = `${getProfile().name}的基础设置`; }
function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit' }).format(now).replaceAll('/', '年').replace(/年(\d{2})$/, '月$1日');
  const time = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
  dateButton.textContent = `▣ ${date} ${time}`;
}
function closeProfile() { profileRoot.innerHTML = ''; }
function openProfile() {
  const profile = getProfile();
  profileRoot.innerHTML = `<div class="profile-scrim" data-close-profile></div><section class="profile-popover" aria-label="个人基础设置"><div class="profile-popover-head"><div class="profile-preview">${esc(profileAvatar(profile))}</div><div><b>${esc(profile.name)}</b><small>个人基础设置</small></div><button class="close-profile" type="button" aria-label="关闭" data-close-profile>×</button></div><label>用户名称<input id="profile-name" maxlength="16" value="${esc(profile.name)}" placeholder="请输入用户名称" /></label><label>头像文字<input id="profile-avatar" maxlength="2" value="${esc(profile.avatar)}" placeholder="最多两个字符" /></label><button class="primary-btn" id="save-profile" type="button">保存设置</button><button class="logout-btn" id="logout-button" type="button">退出登录</button></section>`;
  profileRoot.querySelectorAll('[data-close-profile]').forEach(button => button.addEventListener('click', closeProfile));
  profileRoot.querySelector('#save-profile').addEventListener('click', () => {
    const name = profileRoot.querySelector('#profile-name').value.trim() || '未命名用户';
    const avatar = profileRoot.querySelector('#profile-avatar').value.trim() || name.slice(0, 2);
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, avatar }));
    applyProfile(); closeProfile(); showToast('个人设置已保存');
  });
  profileRoot.querySelector('#logout-button').addEventListener('click', () => { sessionStorage.removeItem('traffic-auth'); window.location.reload(); });
}

function renderNav() {
  nav.innerHTML = navItems.map(([key, icon, label]) => `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}"><span>${icon}</span>${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
}
async function go(page) {
  if (page !== 'devices') stopDeviceAutoRefresh();
  if (page !== 'map' && activeMapController) { activeMapController.destroy(); activeMapController = null; }
  state.page = page; setCriticalAlarm(false); document.body.classList.remove('orders-page','devices-page'); orderSummary.innerHTML = ''; const item = navItems.find(i => i[0] === page); title.textContent = item[2]; kicker.textContent = item[3]; renderNav();
  if (!canRenderFromCache(page)) pageContent.innerHTML = `<div class="loading">正在加载数据…</div>`;
  const renderers = { dashboard:renderDashboard, alerts:renderAlerts, orders:renderOrders, map:renderMap, devices:renderDevices, settings:renderSettings };
  try {
    await renderers[page]();
  } catch (error) {
    pageContent.innerHTML = `<div class="loading">数据加载失败：${esc(error.message || '无法连接服务')}<br><br><button class="primary-btn" id="retry-load">重新加载</button></div>`;
    document.querySelector('#retry-load').addEventListener('click', () => go(page));
  }
}

function cacheIsFresh(key) { const entry = dataCache[key]; return entry.value !== null && Date.now() - entry.loadedAt < entry.ttl; }
function canRenderFromCache(page) {
  if (page === 'dashboard') return ['dashboard','alerts','orders','devices'].every(cacheIsFresh);
  if (page === 'orders') return cacheIsFresh('orders');
  if (page === 'map') return cacheIsFresh('alerts');
  if (page === 'devices') return cacheIsFresh('devices');
  return true;
}
async function loadCached(key, loader, force = false) {
  const entry = dataCache[key];
  if (!force && cacheIsFresh(key)) return entry.value;
  if (entry.pending) return entry.pending;
  entry.pending = Promise.resolve(loader()).then(value => {
    entry.value = value;
    entry.loadedAt = Date.now();
    return value;
  }).finally(() => { entry.pending = null; });
  return entry.pending;
}
function invalidateCache(key) { dataCache[key].loadedAt = 0; }
async function getDashboardData(force = false) { state.dashboard = await loadCached('dashboard', () => api.getDashboard(), force); return state.dashboard; }
async function getAlertsData(force = false) { state.alerts = await loadCached('alerts', () => api.getAlerts(), force); return state.alerts; }
async function getOrdersData(force = false) { state.orders = await loadCached('orders', () => api.getWorkOrders(), force); return state.orders; }
async function getDevicesData(force = false) { state.devices = await loadCached('devices', () => api.getDevices(), force); return state.devices; }
async function loadCore() { [state.dashboard, state.alerts, state.orders, state.devices] = await Promise.all([getDashboardData(), getAlertsData(), getOrdersData().catch(() => []), getDevicesData().catch(() => [])]); }
function metric(label, value, sub, tone) { return `<article class="metric-card"><div class="metric-label">${label}<span class="metric-icon ${tone}">●</span></div><strong>${value}</strong><small>${sub}</small></article>`; }
function metricSimple(label, value, tone) { return `<article class="metric-card metric-card-simple"><div class="metric-label">${label}<span class="metric-icon ${tone}">●</span></div><strong>${value}</strong></article>`; }
async function renderDashboard() {
  await loadCore(); const d = state.dashboard;
  pageContent.innerHTML = `<section class="metrics">${metric('今日告警',d.todayAlerts,'较昨日 +12.4%','blue')}${metric('有效告警率',`${d.validRate}%`,'目标 ≥ 90%','green')}${metric('待处理工单',d.pendingOrders,'其中 3 条高优先级','amber')}${metric('设备在线率',`${d.onlineRate}%`,'28 / 30 台在线','purple')}</section>
  <section class="grid two-one"><article class="panel"><div class="panel-head"><div><h2>告警趋势</h2><p>近 7 日有效告警数量</p></div><button class="link-btn" data-jump="orders">进入工单中心 →</button></div><div class="chart">${d.trend.map((n,i) => `<div class="bar-wrap"><span>${n}</span><div class="bar" style="height:${n/0.52}%"></div><small>${['周二','周三','周四','周五','周六','周日','今日'][i]}</small></div>`).join('')}</div></article>
  <article class="panel"><div class="panel-head"><div><h2>处置效率</h2><p>今日工单处理状态</p></div></div><div class="donut-row"><div class="donut"><b>86%</b><span>按时处置</span></div><div class="legend"><p><i class="green-dot"></i> 已完成 <b>36</b></p><p><i class="blue-dot"></i> 处理中 <b>12</b></p><p><i class="amber-dot"></i> 未处理 <b>8</b></p></div></div></article></section>
  <section class="grid two-one"><article class="panel"><div class="panel-head"><div><h2>待处置告警</h2><p>需要快速响应的 AI 识别事件</p></div><button class="link-btn" data-jump="orders">全部进入工单 →</button></div>${alertRows(state.alerts.filter(a => a.status === 'pending').slice(0,3))}</article><article class="panel"><div class="panel-head"><div><h2>设备健康度</h2><p>异常设备需要关注</p></div><button class="link-btn" data-jump="devices">运维中心 →</button></div>${deviceMini(state.devices)}</article></section>`;
  bindJump();
}
function alertRows(alerts) { return `<div class="mini-list">${alerts.map(a => `<button class="alert-mini" data-alert="${a.id}"><span class="scene ${a.thumbnail}">${a.thumbnail}</span><span><b>${a.type}</b><small>${a.location} · ${a.occurredAt}</small></span>${badge(a.severity, severityClass(a.severity))}</button>`).join('')}</div>`; }
function deviceMini(devices) { return `<div class="mini-list">${devices.slice(0,3).map(d => `<div class="device-mini"><i class="${statusClass(d.status)}-dot"></i><span><b>${esc(d.name || d.id || '--')}</b><small>${esc(d.abnormalInfo || d.lastSeen || '数据库同步')}</small></span><em>${esc(d.status || '未知')}</em></div>`).join('')}</div>`; }
function bindJump() { document.querySelectorAll('[data-jump]').forEach(x => x.addEventListener('click',() => go(x.dataset.jump))); document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click',() => openAlert(x.dataset.alert))); }

async function renderAlerts() {
  state.alerts = await api.getAlerts();
  pageContent.innerHTML = `<section class="toolbar panel"><div class="filter-row"><label>事件状态<select id="alert-status"><option value="">全部状态</option>${Object.entries(ALERT_STATUS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>关键词<input id="alert-search" placeholder="事件、线路或位置" /></label><button class="primary-btn" id="alert-filter">查询</button></div><p class="muted">共 <b id="alert-count">${state.alerts.length}</b> 条告警记录</p></section><section class="panel table-panel"><table><thead><tr><th>告警事件</th><th>发生时间</th><th>线路 / 设备</th><th>位置</th><th>置信度</th><th>状态</th><th></th></tr></thead><tbody id="alert-table"></tbody></table></section>`;
  paintAlertTable(state.alerts);
  document.querySelector('#alert-filter').addEventListener('click', async () => { const filters={status:document.querySelector('#alert-status').value,keyword:document.querySelector('#alert-search').value.trim()}; const rows=await api.getAlerts(filters); paintAlertTable(rows); });
}
function paintAlertTable(alerts) { document.querySelector('#alert-count').textContent=alerts.length; document.querySelector('#alert-table').innerHTML = alerts.map(a => `<tr><td><div class="event-cell"><span class="scene ${a.thumbnail}">${a.thumbnail}</span><span><b>${a.type}</b><small>${a.category} · ${badge(a.severity,a.severity==='高'?'red':'amber')}</small></span></div></td><td>${a.occurredAt}<small>2026-07-13</small></td><td>${a.route}<small>${a.deviceId}</small></td><td>${a.location}</td><td><b>${a.confidence}%</b></td><td>${badge(ALERT_STATUS[a.status],statusClass(a.status))}</td><td><button class="text-btn" data-alert="${a.id}">查看</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">没有匹配的告警记录</td></tr>`; document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click',() => openAlert(x.dataset.alert))); }
async function openAlert(id) {
  const alert = state.alerts.find(x => x.id === id) || (await api.getAlerts()).find(x => x.id === id); if (!alert) return;
  document.querySelector('#drawer-root').innerHTML = `<div class="scrim" id="close-drawer"></div><aside class="drawer"><button class="close" id="close-drawer-btn">×</button><p class="eyebrow">告警详情 · ${alert.id}</p><h2>${alert.type} ${badge(alert.severity,alert.severity==='高'?'red':'amber')}</h2><div class="evidence"><div class="road-scene"><span>车载前视取证画面</span><b>${alert.thumbnail}</b><i>REC · ${alert.occurredAt}</i></div><div class="thumb-row"><button class="selected">抓拍图</button><button>前后 10s 视频</button></div></div><dl class="detail-list"><div><dt>发生位置</dt><dd>${alert.location}</dd></div><div><dt>公交线路 / 设备</dt><dd>${alert.route} · ${alert.deviceId}</dd></div><div><dt>AI 置信度</dt><dd>${alert.confidence}%</dd></div><div><dt>事件说明</dt><dd>${alert.description}</dd></div></dl><div class="audit"><p>审核结论</p><div><button class="outline-btn" data-review="false">标记误报</button><button class="primary-btn" data-review="valid">确认有效</button></div><button class="wide-btn" id="create-order">＋ 转为处置工单</button></div></aside>`;
  const close=()=>document.querySelector('#drawer-root').innerHTML=''; document.querySelector('#close-drawer').addEventListener('click',close); document.querySelector('#close-drawer-btn').addEventListener('click',close);
  document.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',async()=>{ await api.updateAlert(id,{status:b.dataset.review}); showToast(b.dataset.review==='valid'?'已确认有效告警':'已标记为误报'); close(); go('orders'); }));
  document.querySelector('#create-order').addEventListener('click',async()=>{ await api.createWorkOrder({title:`处置${alert.location}${alert.type}`,sourceAlertId:alert.id,location:alert.location}); await api.updateAlert(id,{status:'dispatched'}); showToast('工单已创建，等待指派'); close(); go('orders'); });
}

async function renderOrders() {
  await getOrdersData();
  const slotsPerStatus = 2;
  const ordersByStatus = Object.fromEntries(Object.keys(WORK_ORDER_STATUS).map(key => [key, state.orders.filter(order => order.status === key)]));
  const filteredOrdersByStatus = Object.fromEntries(Object.entries(ordersByStatus).map(([key, orders]) => [key, filterOrders(orders, state.orderFilters[key]) ]));
  const totalPages = Object.fromEntries(Object.entries(filteredOrdersByStatus).map(([key, orders]) => [key, Math.max(1, Math.ceil(orders.length / slotsPerStatus))]));
  Object.keys(WORK_ORDER_STATUS).forEach(key => { state.orderPages[key] = Math.min(Math.max(1, Number(state.orderPages[key]) || 1), totalPages[key]); });
  const visibleOrders = Object.fromEntries(Object.entries(filteredOrdersByStatus).map(([key, orders]) => [key, orders.slice((state.orderPages[key] - 1) * slotsPerStatus, state.orderPages[key] * slotsPerStatus)]));
  const statusCounts = Object.fromEntries(Object.entries(ordersByStatus).map(([key, orders]) => [key, orders.length]));

  document.body.classList.add('orders-page');
  orderSummary.innerHTML = Object.entries(WORK_ORDER_STATUS).map(([key, label]) => `<article class="order-status-card ${key}"><span>${label}</span><strong>${statusCounts[key]}</strong></article>`).join('');
  pageContent.innerHTML = `<section class="orders-list" aria-label="工单列表">${Object.entries(WORK_ORDER_STATUS).map(([key,label])=>`<div class="kanban-col"><h3><i class="${statusClass(key)}-dot"></i>${label}<span>${statusCounts[key]}</span></h3>${orderFiltersBar(key)}<div class="order-slots">${visibleOrders[key].map(databaseOrderCard).join('')}${Array.from({ length: slotsPerStatus - visibleOrders[key].length }, () => '<div class="order-card-slot" aria-hidden="true"></div>').join('')}</div>${orderColumnPagination(key, totalPages[key])}</div>`).join('')}</section>`;
  pageContent.querySelectorAll('[data-order-review]').forEach(button => button.addEventListener('click', async () => {
    const isValid = Number(button.dataset.valid);
    const order = state.orders.find(item => item.id === button.dataset.orderReview);
    button.disabled = true;
    try {
      await api.reviewWorkOrder(button.dataset.orderReview, isValid, order?.remarks);
      invalidateCache('orders');
      showToast(isValid === 0 ? '已标记无效，审核备注已写入数据库' : '已确认有效，审核备注已写入数据库');
      await renderOrders();
    } catch (error) {
      button.disabled = false;
      showToast(error.message || '审核结果写入失败');
    }
  }));
  pageContent.querySelectorAll('[data-order-send]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api.sendWorkOrder(button.dataset.orderSend);
      invalidateCache('orders');
      showToast('工单已发送，等待处理');
      await renderOrders();
    } catch (error) {
      button.disabled = false;
      showToast(error.message || '工单发送失败');
    }
  }));
  pageContent.querySelectorAll('[data-order-detail]').forEach(card => {
    const openDetail = event => {
      if (event.target.closest('button, select, input, label')) return;
      openOrderDetail(card.dataset.orderDetail);
    };
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(event); } });
  });
  pageContent.querySelectorAll('[data-order-page]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.orderPage;
    state.orderPages[key] += button.dataset.orderDirection === 'prev' ? -1 : 1;
    renderOrders();
  }));
  pageContent.querySelectorAll('[data-order-page-jump]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const key = form.dataset.orderPageJump;
    state.orderPages[key] = Number(form.querySelector('[data-order-page-input]').value);
    renderOrders();
  }));
  pageContent.querySelectorAll('[data-order-time-input]').forEach(input => input.addEventListener('change', () => {
    const key = input.dataset.orderTimeInput;
    state.orderFilters[key].time = input.value;
    state.orderPages[key] = 1;
    renderOrders();
  }));
  pageContent.querySelectorAll('[data-order-time-trigger]').forEach(button => button.addEventListener('click', () => {
    const input = pageContent.querySelector(`[data-order-time-input="${button.dataset.orderTimeTrigger}"]`);
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else { input.focus(); input.click(); }
  }));
  pageContent.querySelectorAll('[data-order-priority]').forEach(select => select.addEventListener('change', () => {
    const key = select.dataset.orderPriority;
    state.orderFilters[key].priority = select.value;
    state.orderPages[key] = 1;
    renderOrders();
  }));
}

function filterOrders(orders, filters) {
  return orders.filter(order => {
    const orderTime = String(order.occurredAt || '').replace(' ', 'T').slice(0, 16);
    return (!filters.time || orderTime.startsWith(filters.time)) && (!filters.priority || order.priority === filters.priority);
  }).sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}

function priorityWeight(priority) { return { '最高':4, '高':3, '中':2, '低':1 }[priority] || 0; }

function orderFiltersBar(key) {
  const filters = state.orderFilters[key];
  const timeLabel = filters.time ? filters.time.replaceAll('-', '/') : '时间';
  return `<div class="column-filters"><div class="time-filter"><button type="button" data-order-time-trigger="${key}">${timeLabel}</button><input data-order-time-input="${key}" type="date" value="${esc(filters.time)}" aria-label="${WORK_ORDER_STATUS[key]}日期" /></div><select data-order-priority="${key}" aria-label="${WORK_ORDER_STATUS[key]}优先级"><option value="">优先级</option><option value="最高" ${filters.priority === '最高' ? 'selected' : ''}>最高</option><option value="高" ${filters.priority === '高' ? 'selected' : ''}>高</option><option value="中" ${filters.priority === '中' ? 'selected' : ''}>中</option><option value="低" ${filters.priority === '低' ? 'selected' : ''}>低</option></select></div>`;
}

function orderColumnPagination(key, totalPages) {
  const currentPage = state.orderPages[key];
  const previousDisabled = currentPage === 1 ? 'disabled' : '';
  const nextDisabled = currentPage === totalPages ? 'disabled' : '';
  return `<nav class="column-pagination" aria-label="${WORK_ORDER_STATUS[key]}分页"><button class="outline-btn" type="button" data-order-page="${key}" data-order-direction="prev" ${previousDisabled}>上一页</button><span><b>${currentPage}</b> / ${totalPages}</span><button class="outline-btn" type="button" data-order-page="${key}" data-order-direction="next" ${nextDisabled}>下一页</button><form data-order-page-jump="${key}"><label>跳至 <input data-order-page-input type="number" min="1" max="${totalPages}" value="${currentPage}" aria-label="${WORK_ORDER_STATUS[key]}页码" /> 页</label><button class="primary-btn" type="submit">跳转</button></form></nav>`;
}

function databaseOrderCard(order) {
  const review = order.reviewStatus === 1 ? badge('人工审核：有效','green') : order.reviewStatus === 0 ? badge('人工审核：无效','gray') : badge('待人工审核','amber');
  const evidence = order.evidenceUrl ? `<figure class="order-evidence"><img src="${esc(order.evidenceUrl)}" alt="工单 ${esc(order.id)} 的事件取证图片" loading="lazy" /></figure>` : `<div class="order-evidence-empty">暂无事件取证图片</div>`;
  const actions = order.status === 'pending'
    ? `<div class="review-actions"><button class="outline-btn" type="button" data-order-review="${esc(order.id)}" data-valid="0">判定无效</button><button class="primary-btn" type="button" data-order-send="${esc(order.id)}">发送工单</button></div>`
    : order.status === 'review'
      ? `<div class="review-actions"><button class="outline-btn" type="button" data-order-review="${esc(order.id)}" data-valid="0">不合格</button><button class="primary-btn" type="button" data-order-review="${esc(order.id)}" data-valid="1">合格</button></div>`
      : '';
  return `<article class="order-card database-order-card" data-order-detail="${esc(order.id)}" role="button" tabindex="0" aria-label="查看事件 ${esc(order.id)} 详情"><span>事件 #${esc(order.id)} · ${WORK_ORDER_STATUS[order.status] || esc(order.processStatus)}</span><div class="order-card-badges">${badge(order.priority, severityClass(order.priority))}${review}</div><h4>${esc(order.title)}</h4>${evidence}<p>车牌：${esc(order.licensePlate)}<br>位置：${esc(order.location)}</p>${order.remarks ? `<p class="order-remarks">备注：${esc(order.remarks)}</p>` : ''}<footer><b>${esc(order.occurredAt)}</b><em>${order.finishAt ? `完成 ${esc(order.finishAt)}` : '等待处置'}</em></footer>${actions}</article>`;
}

function openOrderDetail(id) {
  const order = state.orders.find(item => item.id === id);
  if (!order) return;
  const mediaPage = { alarm:0, processed:0 };
  const root = document.querySelector('#drawer-root');
  const close = () => { root.innerHTML = ''; };
  const render = () => {
    const reviewLabel = order.reviewStatus === 1 ? '合格' : order.reviewStatus === 0 ? '不合格' : '待审核';
    const actions = order.status === 'pending'
      ? `<button class="primary-btn" type="button" data-detail-send="${esc(order.id)}">发送工单</button>`
      : order.status === 'review'
        ? `<button class="outline-btn" type="button" data-detail-review="${esc(order.id)}" data-valid="0">不合格</button><button class="primary-btn" type="button" data-detail-review="${esc(order.id)}" data-valid="1">合格</button>`
        : '';
    root.innerHTML = `<div class="order-detail-scrim" data-detail-close></div><section class="order-detail-dialog" role="dialog" aria-modal="true" aria-label="工单详情"><header class="order-detail-head"><div><p>工单详情 · 事件 #${esc(order.id)}</p><h2>${esc(order.title)}</h2></div><button class="order-detail-close" type="button" aria-label="关闭详情" data-detail-close>×</button></header><div class="order-detail-summary"><div><small>上报时间</small><b>${esc(order.occurredAt)}</b></div><div><small>事件类型</small><b>${esc(order.eventType || order.title)}</b></div><div><small>优先级</small>${badge(order.priority, severityClass(order.priority))}</div><div><small>审核结果</small>${badge(reviewLabel, order.reviewStatus === 1 ? 'green' : order.reviewStatus === 0 ? 'gray' : 'amber')}</div><div><small>处置状态</small><b>${esc(WORK_ORDER_STATUS[order.status] || order.processStatus)}</b></div></div><div class="order-detail-media">${detailMediaPanel('报警材料', 'alarm', order.alertMedia, mediaPage.alarm)}${detailMediaPanel('处理后材料', 'processed', order.processedMedia, mediaPage.processed)}</div><section class="order-detail-notes"><div><h3>事件信息</h3><p>车牌：${esc(order.licensePlate)}　位置：${esc(order.location)}</p></div><div><h3>备注</h3><p>${esc(order.remarks || '暂无备注')}</p></div></section><footer class="order-detail-actions">${actions}</footer></section>`;
    root.querySelectorAll('[data-detail-close]').forEach(button => button.addEventListener('click', close));
    root.querySelectorAll('[data-media-step]').forEach(button => button.addEventListener('click', () => {
      const section = button.dataset.mediaSection;
      const items = section === 'alarm' ? order.alertMedia : order.processedMedia;
      mediaPage[section] = (mediaPage[section] + Number(button.dataset.mediaStep) + items.length) % items.length;
      render();
    }));
    root.querySelectorAll('[data-detail-send]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api.sendWorkOrder(order.id); invalidateCache('orders'); showToast('工单已发送，等待处理'); close(); await renderOrders(); }
      catch (error) { button.disabled = false; showToast(error.message || '工单发送失败'); }
    }));
    root.querySelectorAll('[data-detail-review]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api.reviewWorkOrder(order.id, Number(button.dataset.valid), order.remarks); invalidateCache('orders'); showToast(Number(button.dataset.valid) ? '已判定合格' : '已判定不合格'); close(); await renderOrders(); }
      catch (error) { button.disabled = false; showToast(error.message || '审核结果写入失败'); }
    }));
  };
  render();
}

function detailMediaPanel(title, section, items, page) {
  if (!items.length) return `<section class="media-panel"><div class="media-panel-head"><h3>${title}</h3><span>暂无材料</span></div><div class="media-empty">暂无可展示的图片或视频</div></section>`;
  const item = items[page];
  const media = item.kind === 'video'
    ? `<video controls preload="metadata" src="${esc(item.url)}">当前浏览器不支持视频播放。</video>`
    : `<img src="${esc(item.url)}" alt="${title} ${page + 1}" />`;
  const controls = items.length > 1 ? `<div class="media-pager"><button type="button" data-media-step="-1" data-media-section="${section}" aria-label="上一份材料">‹</button><span>${page + 1} / ${items.length} · ${item.kind === 'video' ? '视频' : '图片'}</span><button type="button" data-media-step="1" data-media-section="${section}" aria-label="下一份材料">›</button></div>` : `<div class="media-pager single">1 / 1 · ${item.kind === 'video' ? '视频' : '图片'}</div>`;
  return `<section class="media-panel"><div class="media-panel-head"><h3>${title}</h3><span>${item.kind === 'video' ? '视频' : '图片'}</span></div><div class="media-stage">${media}</div>${controls}</section>`;
}

async function renderLegacyOrders() {
  [state.orders, state.alerts] = await Promise.all([api.getWorkOrders(), api.getAlerts()]);
  const urgentAlerts = state.alerts.filter(a => a.severity === '高' && a.status !== 'false');
  setCriticalAlarm(urgentAlerts.length > 0);
  pageContent.innerHTML = `<section class="emergency-banner ${urgentAlerts.length ? 'is-critical' : 'is-safe'}"><div class="emergency-icon">${urgentAlerts.length ? '!' : '✓'}</div><div><p>${urgentAlerts.length ? '紧急事件播报 · 请快速处理' : '安全播报 · 当前无紧急事件'}</p><h2>${urgentAlerts.length ? `${urgentAlerts.length} 项最高级事件正在等待处置` : '现场态势平稳，所有事件均处于安全等级'}</h2><span>${urgentAlerts.length ? urgentAlerts.map(a => `${a.type}｜${a.location}`).join('　') : '安全等级以绿色展示'}</span></div><button class="banner-action" id="urgent-focus">${urgentAlerts.length ? '立即查看' : '查看工单'}</button></section>
  <section class="split-heading"><div><p>告警审核、紧急播报与现场整改统一在此闭环</p></div><button class="primary-btn" id="new-order">＋ 新建工单</button></section>
  <section class="alert-workbench panel"><div class="panel-head"><div><h2>告警待办</h2><p>点击事件可查看证据并转为处置工单</p></div><span class="severity-guide"><i class="red-dot"></i>最高紧急　<i class="amber-dot"></i>一般　<i class="green-dot"></i>安全</span></div>${alertRows(state.alerts)}</section>
  <section class="kanban">${Object.entries(WORK_ORDER_STATUS).map(([key,label])=>`<div class="kanban-col"><h3><i class="${statusClass(key)}-dot"></i>${label}<span>${state.orders.filter(x=>x.status===key).length}</span></h3><div>${state.orders.filter(x=>x.status===key).map(orderCard).join('') || `<p class="empty-card">暂无工单</p>`}</div></div>`).join('')}</section>`;
  document.querySelector('#new-order').addEventListener('click',()=>showToast('可从上方告警待办中一键创建关联工单'));
  document.querySelector('#urgent-focus').addEventListener('click',()=>urgentAlerts[0] ? openAlert(urgentAlerts[0].id) : document.querySelector('.kanban').scrollIntoView({behavior:'smooth'}));
  document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click',() => openAlert(x.dataset.alert)));
}
function orderCard(o) { const source = state.alerts.find(a => a.id === o.sourceAlertId); return `<article class="order-card ${source ? severityClass(source.severity) : ''}"><span>${o.id}</span>${source ? badge(source.severity, severityClass(source.severity)) : ''}<h4>${o.title}</h4><p>⌖ ${o.location}</p><footer><b>${o.assignee}</b><em>${o.dueAt}</em></footer></article>`; }

async function renderMap() {
  await getAlertsData();
  activeMapController?.destroy();
  pageContent.innerHTML = `<section class="map-page"><div class="map-panel"><div id="tencent-map" class="tencent-map" aria-label="腾讯地图"></div><div class="map-head"><b>城市巡检态势</b><span>${state.alerts.length} 个事件点位</span></div><div class="map-legend"><i class="red-dot"></i> 高优先级　<i class="amber-dot"></i> 一般事件　<span class="legend-route"></span> 公交巡检路线</div></div><aside class="map-side panel"><h2>巡检图层</h2><label class="switch-row">道路病害 <input type="checkbox" checked data-map-category="道路病害"></label><label class="switch-row">道路设施 <input type="checkbox" checked data-map-category="道路设施"></label><label class="switch-row">施工市容 <input type="checkbox" checked data-map-category="市容巡检"></label><label class="switch-row">车载设备 <input type="checkbox" checked data-map-category="车载设备"></label><hr><h3>高优先级事件</h3>${alertRows(state.alerts.filter(x => x.severity === '高'))}</aside></section>`;
  activeMapController = await createTencentMap({
    container: pageContent.querySelector('#tencent-map'),
    alerts: state.alerts,
    onAlertClick: openAlert,
  });
  const selectedCategories = () => new Set([...pageContent.querySelectorAll('[data-map-category]:checked')].map(input => input.dataset.mapCategory));
  pageContent.querySelectorAll('[data-map-category]').forEach(input => input.addEventListener('change', () => activeMapController?.setVisibleCategories(selectedCategories())));
  pageContent.querySelectorAll('[data-alert]').forEach(button => button.addEventListener('click', () => {
    activeMapController?.focusAlert(button.dataset.alert);
    openAlert(button.dataset.alert);
  }));
}

async function renderDevices() { await refreshDevices(); startDeviceAutoRefresh(); }
async function refreshDevices(force = false) {
  if (deviceRefreshInFlight) return;
  deviceRefreshInFlight = true;
  try {
    await getDevicesData(force);
    lastDeviceRefresh = new Date();
    if (state.page !== 'devices') return;
    const online=state.devices.filter(d=>d.status==='正常').length;
    const attention=state.devices.filter(d=>d.status==='异常').length;
    document.body.classList.add('devices-page');
    pageContent.innerHTML=`<section class="metrics compact">${metricSimple('接入设备',state.devices.length,'blue')}${metricSimple('当前在线',online,'green')}${metricSimple('需关注',attention,'amber')}</section><section class="panel table-panel"><div class="panel-head"><div><h2>车载设备</h2></div><button class="outline-btn">导出运维记录</button></div><table><thead><tr><th>设备编号</th><th>车辆牌照</th><th>异常信息</th><th>存储</th><th>温度</th><th>状态</th></tr></thead><tbody>${state.devices.map(d=>`<tr><td><b>${d.id || '--'}</b></td><td><b>${d.name || '--'}</b></td><td>${d.abnormalInfo || '--'}</td><td>${d.storage == null ? '--' : `<div class="progress"><i style="width:${d.storage}%"></i></div>${d.storage}%`}</td><td>${d.temperature == null ? '--' : d.temperature+'°C'}</td><td>${badge(d.status || '--',d.status==='正常'?'green':d.status==='异常'?'amber':'gray')}</td></tr>`).join('')}</tbody></table></section>`;
  } finally { deviceRefreshInFlight = false; }
}

async function renderSettings() { pageContent.innerHTML=`<section class="settings-layout"><article class="panel setting-card"><h2>告警判定规则</h2><p>调整后会在下一次设备同步时生效。</p><label>违停最短判定时长 <div class="input-suffix"><input id="stop-minutes" type="number" value="180" min="30"><span>秒</span></div></label><label>道路病害告警置信度 <div class="input-suffix"><input id="confidence" type="number" value="85" min="1" max="100"><span>%</span></div></label><label class="switch-row">高优先级事件即时通知 <input id="notice" type="checkbox" checked></label><button class="primary-btn" id="save-settings">保存配置</button></article><article class="panel setting-card"><h2>电子围栏与白名单</h2><p>配置禁行区域、重点巡检路段和特种车辆白名单。</p><button class="outline-btn wide-btn">管理电子围栏</button><button class="outline-btn wide-btn">管理白名单车辆</button><hr><h3>模型发布</h3><p>当前生产版本：<b>vision-1.4.2</b></p><button class="text-btn">查看模型版本记录 →</button></article></section>`; document.querySelector('#save-settings').addEventListener('click',async()=>{await api.updateSettings({stopDuration:Number(document.querySelector('#stop-minutes').value),confidence:Number(document.querySelector('#confidence').value),instantNotice:document.querySelector('#notice').checked});showToast('配置已保存，将在设备下次同步时生效');}); }

applyProfile();
updateClock();
setInterval(updateClock, 1000);
profileButton.addEventListener('click', openProfile);

await go('dashboard');
