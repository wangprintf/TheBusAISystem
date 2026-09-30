import { api } from './api.js';
import { ALERT_STATUS, WORK_ORDER_STATUS } from './types.js';
import { createTencentMap, reverseGeocode } from './tencent-map.js';
import { buildPriorityTrend, mountPriorityTrend } from './priority-trend.js';
import { deviceState, mountDeviceHealth } from './device-health.js';
import { mountDashboardOrders } from './dashboard-orders.js';
import { hasMapCoordinates } from './map-activity.js';
import { isProcessingStatus, mountFinishUpload } from './finish-upload.js';
import { mountOrderCenter } from './order-center.js';
import { mountPatrolAgent } from './patrol-agent.js';
import { avatarText, mountPersonnelLocation } from './personnel-location.js';

const navItems = [
  ['dashboard','▦','路网总览','路网健康巡检'], ['orders','▤','事件中心','事件闭环处置'],
  ['map','⌖','地图巡检','路网空间态势'], ['devices','▣','设备中心','车载设备健康'], ['settings','⚙','系统配置','规则与权限'],
];
const state = { page:'dashboard', navigationId:0, alerts:[], devices:[], orders:[], dashboard:null };
const dataCache = {
  dashboard:{ value:null, loadedAt:0, pending:null, ttl:1000 },
  alerts:{ value:null, loadedAt:0, pending:null, ttl:1000 },
  orders:{ value:null, loadedAt:0, pending:null, ttl:1000 },
  devices:{ value:null, loadedAt:0, pending:null, ttl:1000 },
};
const pageContent = document.querySelector('#page-content');
const mainContent = document.querySelector('.main-content');
const nav = document.querySelector('#main-nav');
const title = document.querySelector('#page-title');
const kicker = document.querySelector('#page-kicker');
const dateButton = document.querySelector('#date-button');
const homeButton = document.querySelector('#home-button');
const profileButton = document.querySelector('#profile-button');
const profileRoot = document.querySelector('#profile-root');
const orderSummary = document.querySelector('#order-summary');
const patrolAgentController = mountPatrolAgent(document.querySelector('#patrol-agent-root'));
let deviceRefreshTimer = null;
let dashboardRefreshTimer = null;
let orderElapsedTimer = null;
let deviceRefreshInFlight = false;
let dashboardRefreshInFlight = false;
let lastDeviceRefresh = null;
let activeMapController = null;
let dashboardMapController = null;
let dashboardTrendController = null;
let dashboardDeviceController = null;
let dashboardOrdersController = null;
let pullRefreshInFlight = false;
let dataRevision = 0;
let orderCenterController = null;

function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function badge(value, type = '') { return `<span class="badge ${type || value}"${['高', '中'].includes(value) ? ` data-priority="${value}"` : ''}>${esc(value)}</span>`; }
function statusClass(status) { return { pending:'amber', valid:'green', false:'gray', dispatched:'blue', online:'green', '在线':'green', warning:'amber', offline:'gray', processing:'blue', review:'purple', completed:'green', '正常':'green', '异常':'amber', '离线':'gray' }[status] || 'gray'; }
function severityClass(severity) { return { '高':'red', '中':'amber', '低':'green', '安全':'green' }[severity] || 'gray'; }
function setCriticalAlarm(active) { document.body.classList.toggle('critical-alarm', active); }
function isOnlineDevice(device) { return ['正常', '在线', 'online'].includes(device.status); }
function showToast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2600); }
function decorateLiveWorkOrders(root = document) {
  root.querySelectorAll('button, article, li, .order-card, .dashboard-order-item').forEach(element => {
    const text = String(element.textContent || '').trim();
    if ((text.includes('高优先级') || text.includes('最高优先级') || text.includes('高级别')) && text.length < 260) {
      element.classList.add('priority-flash', 'priority-flash-item');
    }
  });
  root.querySelectorAll('button').forEach(button => {
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    const status = text.match(/^(全部|未处理|处理中|待审核|已完成)/)?.[1];
    if (!status) return;
    button.classList.add('order-status-filter', {
      '全部': 'filter-all', '未处理': 'filter-unprocessed', '处理中': 'filter-processing',
      '待审核': 'filter-review', '已完成': 'filter-completed',
    }[status]);
  });
}
function removeHoverHintLabels(root = document) {
  root.querySelectorAll('*').forEach(element => {
    if (element.children.length || !element.textContent.includes('悬停满 1 秒固定小窗')) return;
    element.remove();
  });
}
function replaceCoordinateLocations(root = document) {
  const containers = root.querySelectorAll('.dashboard-order-list, .order-queue');
  containers.forEach(container => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      if (/\b\d{2,3}\.\d{4,},\s*\d{2}\.\d{4,}\b/.test(node.nodeValue || '')) {
        node.nodeValue = String(node.nodeValue).replace(/\b\d{2,3}\.\d{4,},\s*\d{2}\.\d{4,}\b/g, '天津理工大学');
      }
    });
  });
}
function stopDeviceAutoRefresh() { if (deviceRefreshTimer) { clearInterval(deviceRefreshTimer); deviceRefreshTimer = null; } }
function stopDashboardAutoRefresh() { if (dashboardRefreshTimer) { clearInterval(dashboardRefreshTimer); dashboardRefreshTimer = null; } }
function parseSentTime(remarks = '') {
  const matches = String(remarks).match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})-发送工单/g) || [];
  const last = matches.at(-1);
  if (!last) return null;
  const value = Date.parse(last.slice(0, 19).replace(' ', 'T'));
  return Number.isNaN(value) ? null : value;
}
function elapsedText(remarks = '') {
  const sentAt = parseSentTime(remarks);
  if (!sentAt) return '未记录发送时间';
  const seconds = Math.max(0, Math.floor((Date.now() - sentAt) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days}天 ` : ''}${hours}小时${minutes}分`;
}
function canRemind(order) { const sentAt = parseSentTime(order?.remarks); return sentAt !== null && Date.now() - sentAt >= 24 * 3600000; }
function startOrderElapsedTimer() {
  if (orderElapsedTimer) return;
  orderElapsedTimer = setInterval(() => {
    document.querySelectorAll('[data-order-elapsed]').forEach(el => { el.textContent = elapsedText(el.dataset.orderRemarks || ''); });
    document.querySelectorAll('[data-order-remind]').forEach(button => { button.disabled = button.dataset.orderBusy === 'true' || !canRemind({ remarks: button.dataset.orderRemarks || '' }); });
  }, 1000);
}
function startDashboardAutoRefresh() {
  if (dashboardRefreshTimer) return;
  dashboardRefreshTimer = setInterval(() => {
    if (state.page !== 'dashboard') { stopDashboardAutoRefresh(); return; }
    if (dashboardRefreshInFlight) return;
    dashboardRefreshInFlight = true;
    refreshDashboardInPlace().catch(() => {}).finally(() => { dashboardRefreshInFlight = false; });
  }, 10000);
}

async function refreshDashboardInPlace() {
  if (state.page !== 'dashboard' || !pageContent.querySelector('.dashboard-screen')) return;
  const refreshNavigationId = state.navigationId;
  const refreshDataRevision = dataRevision;
  const [dashboard, alerts, orders, devices] = await Promise.all([
    loadCached('dashboard', () => api.getDashboard(), true),
    loadCached('alerts', () => api.getAlerts(), true),
    loadCached('orders', () => api.getWorkOrders(), true),
    loadCached('devices', () => api.getDevices(), true),
  ]);
  if (state.page !== 'dashboard' || state.navigationId !== refreshNavigationId || dataRevision !== refreshDataRevision || !pageContent.querySelector('.dashboard-screen')) return;
  state.dashboard = dashboard;
  state.alerts = alerts;
  state.orders = orders;
  state.devices = devices;
  const d = dashboard || {};
  dashboardTrendController?.update(d.priorityTrend || buildPriorityTrend(alerts));
  dashboardDeviceController?.update(devices);
  dashboardOrdersController?.update(orders);
  const online = devices.filter(isOnlineDevice).length;
  const total = devices.length;
  const processedTotal = (d.completed || 0) + (d.processing || 0) + (d.review || 0) + (d.unprocessed || 0);
  const processedRate = processedTotal ? Math.round((d.completed || 0) * 100 / processedTotal) : 0;
  const onlineRate = total ? Math.round(online * 100 / total) : 0;
  const setText = (selector, value) => { pageContent.querySelectorAll(selector).forEach(element => { element.textContent = value; }); };
  setText('[data-dashboard-today-alerts]', d.todayAlerts ?? 0);
  setText('[data-dashboard-pending-orders]', d.pendingOrders ?? 0);
  setText('[data-dashboard-online-devices]', online);
  setText('[data-dashboard-online-total]', `/${total}`);
  setText('[data-dashboard-health-rate]', onlineRate);
  setText('[data-dashboard-valid-rate]', Math.round(d.validRate || 0));
  pageContent.querySelector('.ring-metric:first-child .ring')?.style.setProperty('--ring', `${Math.min(100, d.validRate || 0)}%`);
  setText('[data-dashboard-processed-value]', processedRate);
  setText('[data-dashboard-sync-time]', new Intl.DateTimeFormat('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(new Date()));
  setText('[data-dashboard-pending-count]', alerts.filter(alert => alert.status === 'pending').length);
  pageContent.querySelector('.ring-metric:nth-child(3) .ring')?.style.setProperty('--ring', `${processedRate}%`);
  pageContent.querySelector('.health-ring')?.style.setProperty('--ring', `${onlineRate}%`);
  setText('[data-dashboard-located-count]', orders.filter(hasMapCoordinates).length);
  dashboardMapController?.updateAlerts?.(orders);
}
function startDeviceAutoRefresh() {
  if (deviceRefreshTimer) return;
  deviceRefreshTimer = setInterval(() => {
    if (state.page !== 'devices') { stopDeviceAutoRefresh(); return; }
    refreshDevices(true).catch(() => {});
  }, 5000);
}

function getSession() {
  try { return JSON.parse(sessionStorage.getItem('traffic-auth') || '{}') || {}; } catch { return {}; }
}
function getProfile() {
  const session = getSession();
  return { name: String(session.name || '用户').trim(), department: String(session.department || '未设置部门').trim() };
}
function profileAvatar(profile = getProfile()) {
  return avatarText(profile);
}
function applyProfile() { profileButton.textContent = profileAvatar(); profileButton.title = `${getProfile().name}的个人信息`; }
function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit' }).format(now).replaceAll('/', '年').replace(/年(\d{2})$/, '月$1日');
  const time = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
  dateButton.textContent = `▣ ${date} ${time}`;
}
function closeProfile() { profileRoot.innerHTML = ''; }
function openProfile() {
  const profile = getProfile();
  profileRoot.innerHTML = `<div class="profile-scrim" data-close-profile></div><section class="profile-popover" aria-label="个人信息"><div class="profile-popover-head"><div class="profile-preview">${esc(profileAvatar(profile))}</div><div class="profile-identity"><b>${esc(profile.name)}</b><span class="profile-department-inline" aria-label="所属部门">${esc(profile.department)}</span></div><button class="close-profile" type="button" aria-label="关闭" data-close-profile>×</button></div><label>用户名称<input id="profile-name" value="${esc(profile.name)}" readonly /></label><button class="logout-btn" id="logout-button" type="button">退出登录</button></section>`;
  profileRoot.querySelectorAll('[data-close-profile]').forEach(button => button.addEventListener('click', closeProfile));
  profileRoot.querySelector('#logout-button').addEventListener('click', () => { sessionStorage.removeItem('traffic-auth'); window.location.reload(); });
}

function renderNav() {
  document.querySelectorAll('[data-center-page]').forEach(button => {
    // The login API authenticates the account; department is profile data, not a permission.
    button.hidden = false;
    if (state.page === button.dataset.centerPage) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  nav.innerHTML = navItems.map(([key, icon, label]) => `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}"><span>${icon}</span>${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const page = button.dataset.page;
    if (state.page === 'dashboard' && page !== 'dashboard') {
      if (page === 'orders') return go('orders');
      if (page === 'devices') return go('devices');
      if (page === 'map') return go('map');
      if (page === 'settings') return openDashboardSettings();
    }
    go(page);
  }));
}
async function go(page) {
  patrolAgentController?.close({ restoreFocus: false });
  if (orderCenterController?.isBusy()) { showToast('工单操作进行中，请稍后再离开'); return; }
  orderCenterController?.destroy();
  orderCenterController = null;
  const availableItems = navItems;
  if (!availableItems.some(([key]) => key === page)) page = 'dashboard';
  const navigationId = ++state.navigationId;
  if (page !== 'devices') stopDeviceAutoRefresh();
  if (page !== 'dashboard') stopDashboardAutoRefresh();
  if (page !== 'map' && activeMapController) { activeMapController.destroy(); activeMapController = null; }
  if (page !== 'dashboard' && dashboardMapController) { dashboardMapController.destroy(); dashboardMapController = null; }
  if (page !== 'dashboard' && dashboardTrendController) { dashboardTrendController.destroy(); dashboardTrendController = null; }
  if (page !== 'dashboard' && dashboardDeviceController) { dashboardDeviceController.destroy(); dashboardDeviceController = null; }
  if (page !== 'dashboard' && dashboardOrdersController) { dashboardOrdersController.destroy(); dashboardOrdersController = null; }
  state.page = page; setCriticalAlarm(false); document.body.classList.remove('orders-page','devices-page','dashboard-page'); document.body.classList.toggle('dashboard-page', page === 'dashboard'); homeButton?.classList.toggle('visible', page !== 'dashboard'); orderSummary.innerHTML = ''; const item = availableItems.find(i => i[0] === page); title.textContent = page === 'dashboard' ? '路网健康巡检系统' : item[2]; kicker.textContent = page === 'dashboard' ? '路网运行 · 实时巡检指挥中心' : ''; renderNav();
  pageContent.innerHTML = `<div class="loading">正在加载数据…</div>`;
  const renderers = { dashboard:renderDashboard, alerts:renderAlerts, orders:renderOrders, map:renderMap, devices:renderDevices, settings:renderSettings };
  try {
    await renderers[page](navigationId);
  } catch (error) {
    if (state.navigationId !== navigationId || state.page !== page) return;
    pageContent.innerHTML = `<div class="loading">数据加载失败：${esc(error.message || '无法连接服务')}<br><br><button class="primary-btn" id="retry-load">重新加载</button></div>`;
    document.querySelector('#retry-load').addEventListener('click', () => go(page));
  }
}

async function refreshCurrentPage() {
  if (pullRefreshInFlight) return;
  pullRefreshInFlight = true;
  const indicator = document.querySelector('#pull-refresh-indicator');
  indicator?.classList.add('refreshing');
  if (indicator) indicator.textContent = '正在更新数据…';
  try {
    Object.keys(dataCache).forEach(invalidateCache);
    api.invalidateReads();
    if (state.page === 'dashboard') await refreshDashboardInPlace();
    else if (state.page === 'devices') await refreshDevices(true);
    else await go(state.page);
    if (indicator) indicator.textContent = '已更新';
    showToast('当前页面数据已更新');
  } catch (error) {
    if (indicator) indicator.textContent = '更新失败';
    showToast(error.message || '数据更新失败，请检查网络');
  } finally {
    window.setTimeout(() => {
      indicator?.classList.remove('visible', 'refreshing', 'ready');
      pullRefreshInFlight = false;
    }, 560);
  }
}

function installPullToRefresh() {
  const indicator = document.createElement('div');
  indicator.id = 'pull-refresh-indicator';
  indicator.textContent = '下拉更新';
  document.body.append(indicator);
  let startY = 0;
  let distance = 0;
  let tracking = false;
  const scrollTop = () => window.matchMedia('(max-width:700px)').matches
    ? window.scrollY || document.documentElement.scrollTop || 0
    : mainContent.scrollTop;
  const ignoreTarget = target => target.closest('input, select, textarea, button, .tencent-map, .order-detail-dialog, .drawer, .operation-workspace');
  document.addEventListener('touchstart', event => {
    if (pullRefreshInFlight || scrollTop() > 1 || ignoreTarget(event.target)) return;
    startY = event.touches[0]?.clientY || 0;
    distance = 0;
    tracking = true;
  }, { passive:true });
  document.addEventListener('touchmove', event => {
    if (!tracking) return;
    distance = Math.max(0, (event.touches[0]?.clientY || startY) - startY);
    if (!distance) return;
    if (distance > 8) event.preventDefault();
    indicator.style.setProperty('--pull-distance', `${Math.min(distance, 92)}px`);
    indicator.classList.add('visible');
    indicator.classList.toggle('ready', distance >= 68);
    indicator.textContent = distance >= 68 ? '松开即可更新' : '继续下拉更新';
  }, { passive:false });
  document.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;
    if (distance >= 68) refreshCurrentPage();
    else indicator.classList.remove('visible', 'ready');
    distance = 0;
  }, { passive:true });
  document.addEventListener('touchcancel', () => {
    tracking = false;
    distance = 0;
    indicator.classList.remove('visible', 'ready');
  }, { passive:true });
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
  const generation = entry.generation;
  const pending = Promise.resolve().then(loader).then(value => {
    if (generation !== entry.generation) return loadCached(key, loader, true);
    entry.value = value;
    entry.loadedAt = Date.now();
    return value;
  }).finally(() => { if (entry.pending === pending) entry.pending = null; });
  entry.pending = pending;
  return pending;
}
function invalidateCache(key) {
  dataRevision += 1;
  const keys = key === 'orders' ? ['orders', 'alerts', 'dashboard'] : key === 'devices' ? ['devices', 'dashboard'] : [key];
  for (const name of keys) {
    const entry = dataCache[name];
    entry.loadedAt = 0;
    entry.generation = (entry.generation || 0) + 1;
    entry.pending = null;
  }
}
function isCurrentNavigation(page, navigationId) { return state.page === page && state.navigationId === navigationId; }
async function getDashboardData(force = false) { state.dashboard = await loadCached('dashboard', () => api.getDashboard(), force); return state.dashboard; }
async function getAlertsData(force = false) { state.alerts = await loadCached('alerts', () => api.getAlerts(), force); return state.alerts; }
async function getOrdersData(force = false) { state.orders = await loadCached('orders', () => api.getWorkOrders(), force); return state.orders; }
async function getDevicesData(force = false) { state.devices = await loadCached('devices', () => api.getDevices(), force); return state.devices; }
async function loadCore() { [state.dashboard, state.alerts, state.orders, state.devices] = await Promise.all([getDashboardData(), getAlertsData(), getOrdersData().catch(() => []), getDevicesData(true).catch(() => [])]); }
function metric(label, value, sub, tone) { return `<article class="metric-card"><div class="metric-label">${label}<span class="metric-icon ${tone}">●</span></div><strong>${value}</strong></article>`; }
function metricSimple(label, value, tone) { return `<article class="metric-card metric-card-simple"><div class="metric-label">${label}<span class="metric-icon ${tone}">●</span></div><strong>${value}</strong></article>`; }
async function renderDashboard(navigationId = state.navigationId) {
  await loadCore();
  if (!isCurrentNavigation('dashboard', navigationId)) return;
  const d = state.dashboard;
  const onlineDeviceTotal = state.devices.length;
  const onlineDeviceCount = state.devices.filter(isOnlineDevice).length;
  const processedTotal = (d.completed || 0) + (d.processing || 0) + (d.review || 0) + (d.unprocessed || 0);
  const processedRate = processedTotal ? Math.round(((d.completed || 0) * 100) / processedTotal) : 0;
  title.textContent = '路网健康巡检系统';
  kicker.textContent = '路网运行 · 实时巡检指挥中心';
  const locatedCount = state.orders.filter(hasMapCoordinates).length;
  const pendingCount = state.alerts.filter(alert => alert.status === 'pending').length;
  const onlineRate = onlineDeviceTotal ? Math.round(onlineDeviceCount / onlineDeviceTotal * 100) : 0;
  dashboardTrendController?.destroy();
  dashboardDeviceController?.destroy();
  dashboardOrdersController?.destroy();
  pageContent.innerHTML = `<section class="dashboard-screen" aria-label="路网健康巡检系统">
    <div class="dashboard-meta"><span><i class="live-dot"></i> 数据链路稳定</span><span>数据更新时间 <b class="dashboard-meta-time" data-dashboard-sync-time>${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())}</b></span></div>
    <div class="dashboard-grid">
      <aside class="dash-column dash-left">
        <article class="dash-panel overview-panel"><div class="dash-panel-head"><div><span class="panel-code">01 / OVERVIEW</span><h2>实时运行概况</h2></div><span class="live-badge">LIVE</span></div><div class="ring-metrics"><div class="ring-metric"><div class="ring" style="--ring:${Math.min(100, d.validRate || 0)}%"><b><span data-dashboard-valid-rate>${Math.round(d.validRate || 0)}</span><small>%</small></b></div><span>告警有效率</span></div><div class="ring-metric online-health-metric"><div class="health-ring" style="--ring:${onlineRate}%"><b><span data-dashboard-health-rate>${onlineRate}</span><small>%</small></b></div><div class="online-health-details"><span>设备在线率</span><strong><span data-dashboard-online-devices>${onlineDeviceCount}</span><span data-dashboard-online-total>/${onlineDeviceTotal}</span><small> 台</small></strong></div></div><div class="ring-metric"><div class="ring orange" style="--ring:${Math.min(100, processedRate)}%"><b><span data-dashboard-processed-value>${processedRate}</span><small>%</small></b></div><span>工单完成率</span></div></div><div class="quick-stats"><div><small>今日告警</small><b data-dashboard-today-alerts>${d.todayAlerts}</b><em>实时汇总</em></div><div><small>待处理工单</small><b data-dashboard-pending-orders>${d.pendingOrders}</b><em class="warn">需关注</em></div><div><small>在线设备</small><b><span data-dashboard-online-devices>${onlineDeviceCount}</span><i data-dashboard-online-total>/${onlineDeviceTotal}</i></b></div></div></article>
        <article class="dash-panel trend-panel"><div class="dash-panel-head"><div><span class="panel-code">02 / TRAFFIC ALERTS</span><h2>告警趋势</h2></div></div><div class="dash-chart-labels"><span>近 7 日事件量</span><b data-priority-peak></b></div><div id="dashboard-priority-trend" class="priority-trend" role="group" aria-label="近 7 日按优先级统计的事件柱状图"></div></article>
        <article class="dash-panel device-panel device-operations-panel"><div class="dash-panel-head"><div><span class="panel-code">03 / DEVICE OPERATIONS</span><h2>设备运维</h2></div><button type="button" class="dash-link dash-shortcut" data-jump="devices"><span class="dash-shortcut-label">设备中心 <span aria-hidden="true">→</span></span></button></div><div id="dashboard-device-health"></div></article>
      </aside>
      <main class="dash-column dash-center">
        <article class="dash-panel map-panel-dash">
          <div class="dash-panel-head"><div><span class="panel-code">04 / SPATIAL SITUATION</span><h2>城市路网态势</h2></div><div class="map-heading-actions"><div class="map-legend-dash"><i class="cluster"></i>数字聚合 · 点击放大 <i class="red"></i>高风险点</div></div></div>
          <div class="city-map dashboard-map-host"><div id="dashboard-tencent-map" class="tencent-map" aria-label="腾讯地图城市巡检态势"></div><div class="dashboard-map-overlay" aria-hidden="true"><div class="map-halo halo-a"></div><div class="map-halo halo-b"></div><div class="map-scanline"></div><div class="map-chip chip-top"><span>已定位事件</span><b data-dashboard-located-count>${locatedCount}</b><small>条</small></div><div class="map-chip chip-bottom"><span>待处置告警</span><b data-dashboard-pending-count>${pendingCount}</b><small>条</small></div></div></div>
        </article>
      </main>
      <aside class="dash-column dash-right" id="dashboard-work-orders" aria-label="工单状态与工单中心"></aside>
    </div>
      <div class="dashboard-footer"><span>智巡云 · 路网健康巡检系统</span><span class="footer-status"><i class="live-dot"></i> 接口 / 地图 / 设备全部在线</span></div>
  </section>`;
  dashboardTrendController = mountPriorityTrend(pageContent.querySelector('#dashboard-priority-trend'), d.priorityTrend || buildPriorityTrend(state.alerts));
  dashboardDeviceController = mountDeviceHealth(pageContent.querySelector('#dashboard-device-health'), state.devices, openDeviceDialog);
  dashboardOrdersController = mountDashboardOrders(pageContent.querySelector('#dashboard-work-orders'), state.orders, openOrderDetail, () => openCenterPage('orders'));
  decorateLiveWorkOrders(pageContent);
  removeHoverHintLabels(pageContent);
  replaceCoordinateLocations(pageContent);
  bindJump();
  dashboardMapController?.destroy();
  const dashboardMap = await createAccountMap({
    container: pageContent.querySelector('#dashboard-tencent-map'),
    alerts: state.orders,
    onAlertClick: openOrderDetail,
  });
  if (!isCurrentNavigation('dashboard', navigationId)) { dashboardMap?.destroy(); return; }
  dashboardMapController = dashboardMap;
  startDashboardAutoRefresh();
}
async function createAccountMap(options) {
  let tracking;
  const controller = await createTencentMap({ ...options, onPersonnelClick: person => tracking?.showDetails(person) });
  if (controller.available) tracking = mountPersonnelLocation({
    container: options.container.parentElement,
    controller,
    loadLocations: () => api.getPersonnelLocations(),
  });
  return { ...controller, destroy() { tracking?.destroy(); controller.destroy(); } };
}
function alertRows(alerts) { return `<div class="mini-list">${alerts.map(a => `<button class="alert-mini" data-alert="${a.id}"><span class="scene ${a.thumbnail}">${a.thumbnail}</span><span><b>${a.type}</b><small>${a.location} · ${a.occurredAt}</small></span>${badge(a.severity, severityClass(a.severity))}</button>`).join('')}</div>`; }
function deviceMini(devices) { return `<div class="mini-list">${devices.slice(0,3).map(d => `<div class="device-mini"><i class="${statusClass(d.status)}-dot"></i><span><b>${esc(d.name || d.id || '--')}</b><small>${esc(d.abnormalInfo || d.lastSeen || '数据库同步')}</small></span><em>${esc(d.status || '未知')}</em></div>`).join('')}</div>`; }
function openDashboardSettings() {
  const root = document.querySelector('#drawer-root');
  root.innerHTML = `<div class="scrim dashboard-quick-scrim" data-close-settings></div><section class="drawer dashboard-quick-drawer" aria-label="系统配置"><button class="close" type="button" data-close-settings>×</button><p class="eyebrow">SYSTEM SETTINGS</p><h2>系统配置</h2><p class="quick-drawer-copy">调整告警判定与通知策略，保存后在下一次设备同步时生效。</p><form id="dashboard-settings-form" class="dashboard-settings-form"><label>违停最短判定时长<div class="input-suffix"><input name="stopDuration" type="number" value="180" min="30"><span>秒</span></div></label><label>道路病害告警置信度<div class="input-suffix"><input name="confidence" type="number" value="85" min="1" max="100"><span>%</span></div></label><label class="switch-row">高优先级事件即时通知<input name="instantNotice" type="checkbox" checked></label><button class="primary-btn" type="submit">保存配置</button></form></section>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-close-settings]').forEach(button => button.addEventListener('click', close));
  root.querySelector('#dashboard-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api.updateSettings({ stopDuration: Number(form.get('stopDuration')), confidence: Number(form.get('confidence')), instantNotice: form.get('instantNotice') === 'on' });
      close();
      showToast('配置已保存，将在设备下次同步时生效');
    } catch (error) { button.disabled = false; showToast(error.message || '配置保存失败'); }
  });
}

function openCenterPage(kind) {
  if (!['orders', 'devices'].includes(kind)) return;
  return go(kind);
}

function bindJump() {
  document.querySelectorAll('[data-jump]').forEach(x => x.addEventListener('click', () => {
    const page = x.dataset.jump;
    if (page === 'orders' || page === 'devices') return openCenterPage(page);
    if (document.body.classList.contains('dashboard-page') && page === 'map') return showToast('腾讯地图已在驾驶舱中心运行');
    if (document.body.classList.contains('dashboard-page') && page === 'settings') return openDashboardSettings();
    go(page);
  }));
  document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click', () => openAlert(x.dataset.alert)));
}

async function renderAlerts(navigationId = state.navigationId) {
  state.alerts = await api.getAlerts();
  if (!isCurrentNavigation('alerts', navigationId)) return;
  pageContent.innerHTML = `<section class="toolbar panel"><div class="filter-row"><label>事件状态<select id="alert-status"><option value="">全部状态</option>${Object.entries(ALERT_STATUS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>关键词<input id="alert-search" placeholder="事件、线路或位置" /></label><button class="primary-btn" id="alert-filter">查询</button></div><p class="muted">共 <b id="alert-count">${state.alerts.length}</b> 条告警记录</p></section><section class="panel table-panel"><table><thead><tr><th>告警事件</th><th>发生时间</th><th>线路 / 设备</th><th>位置</th><th>置信度</th><th>状态</th><th></th></tr></thead><tbody id="alert-table"></tbody></table></section>`;
  paintAlertTable(state.alerts);
  document.querySelector('#alert-filter').addEventListener('click', async () => { const filters={status:document.querySelector('#alert-status').value,keyword:document.querySelector('#alert-search').value.trim()}; const rows=await api.getAlerts(filters); paintAlertTable(rows); });
}
function paintAlertTable(alerts) { document.querySelector('#alert-count').textContent=alerts.length; document.querySelector('#alert-table').innerHTML = alerts.map(a => `<tr><td><div class="event-cell"><span class="scene ${a.thumbnail}">${a.thumbnail}</span><span><b>${a.type}</b><small>${a.category} · ${badge(a.severity,a.severity==='高'?'red':'amber')}</small></span></div></td><td>${a.occurredAt}<small>2026-07-13</small></td><td>${a.route}<small>${a.deviceId}</small></td><td>${a.location}</td><td><b>${a.confidence}%</b></td><td>${badge(ALERT_STATUS[a.status],statusClass(a.status))}</td><td><button class="text-btn" data-alert="${a.id}">查看</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">没有匹配的告警记录</td></tr>`; document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click',() => openAlert(x.dataset.alert))); }
function alertEvidence(alert) {
  const source = String(alert.evidenceUrl || '').trim();
  if (/^https?:\/\//i.test(source)) return `<img class="evidence-image" src="${esc(source)}" alt="${esc(alert.type)}现场取证图片" />`;
  return `<div class="evidence-empty"><b>暂无现场取证图片</b><span>设备上传图片后将在此展示</span></div>`;
}
async function openAlert(id) {
  const alert = state.alerts.find(x => x.id === id) || (await api.getAlerts()).find(x => x.id === id); if (!alert) return;
  document.querySelector('#drawer-root').innerHTML = `<div class="scrim" id="close-drawer"></div><aside class="drawer"><button class="close" id="close-drawer-btn">×</button><p class="eyebrow">告警详情 · ${alert.id}</p><h2>${alert.type} ${badge(alert.severity,alert.severity==='高'?'red':'amber')}</h2><div class="evidence"><div class="evidence-stage">${alertEvidence(alert)}<span class="evidence-label">现场取证图片</span><i>REC · ${alert.occurredAt}</i></div></div><dl class="detail-list"><div><dt>发生位置</dt><dd>${alert.location}</dd></div><div><dt>公交线路 / 设备</dt><dd>${alert.route} · ${alert.deviceId}</dd></div><div><dt>AI 置信度</dt><dd>${alert.confidence}%</dd></div><div><dt>事件说明</dt><dd>${alert.description}</dd></div></dl><div class="audit"><p>审核结论</p><div><button class="outline-btn" data-review="false">标记误报</button><button class="primary-btn" data-review="valid">确认有效</button></div><button class="wide-btn" id="create-order">＋ 转为处置工单</button></div></aside>`;
  const close=()=>document.querySelector('#drawer-root').innerHTML=''; document.querySelector('#close-drawer').addEventListener('click',close); document.querySelector('#close-drawer-btn').addEventListener('click',close);
  const openOrders = () => openCenterPage('orders');
  document.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',async()=>{ await api.updateAlert(id,{status:b.dataset.review}); showToast(b.dataset.review==='valid'?'已确认有效告警':'已标记为误报'); close(); openOrders(); }));
  document.querySelector('#create-order').addEventListener('click',async()=>{ await api.createWorkOrder({title:`处置${alert.location}${alert.type}`,sourceAlertId:alert.id,location:alert.location}); await api.updateAlert(id,{status:'dispatched'}); showToast('工单已创建，等待指派'); close(); openOrders(); });
}

async function renderOrders(navigationId = state.navigationId) {
  const content = pageContent;
  const summary = orderSummary;
  await getOrdersData();
  if (!isCurrentNavigation('orders', navigationId) || !content.isConnected) return;
  document.body.classList.add('orders-page');
  summary.innerHTML = '';
  if (orderCenterController?.container === content) orderCenterController.update(state.orders);
  else {
    orderCenterController?.destroy();
    orderCenterController = mountOrderCenter(content, state.orders, {
      mountDetail: (order, root) => mountOrderDetail(order, root, { embedded: true, onChanged: () => renderOrders() }),
      onBlocked: () => showToast('工单操作进行中，请稍后再切换'),
    });
  }
  decorateLiveWorkOrders(content);
  removeHoverHintLabels(content);
  replaceCoordinateLocations(content);
  startOrderElapsedTimer();
}

function orderCoordinate(order) {
  return hasMapCoordinates(order)
    ? { latitude: Number(order.latitude), longitude: Number(order.longitude) }
    : null;
}

function orderCoordinateLabel(order) {
  const point = orderCoordinate(order);
  return point ? `${point.longitude.toFixed(6)}, ${point.latitude.toFixed(6)}` : '';
}

function orderLocationMarkup(order) {
  const point = orderCoordinate(order);
  if (!point) return `<span>${esc(order.location || '位置暂缺')}</span>`;
  return `<span class="location-coordinate">经纬度：<b class="location-value">${esc(orderCoordinateLabel(order))}</b></span><small class="location-place" data-location-name>正在解析地点名称…</small>`;
}

function remarksMarkup(remarks) {
  const lines = String(remarks || '').split(/[；;]/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return '暂无备注';
  return lines.map((line, index) => `<span class="remark-line">${esc(line)}${index < lines.length - 1 ? '；' : ''}</span>`).join('');
}

function openOrderDetail(id) {
  const order = state.orders.find(item => String(item.id) === String(id));
  if (!order) return;
  return mountOrderDetail(order, document.querySelector('#drawer-root'), { onChanged: () => renderOrders() });
}

function mountOrderDetail(order, root, { embedded = false, onChanged } = {}) {
  const mediaPage = { alarm:0, processed:0 };
  order.alertMedia ||= [];
  order.processedMedia ||= [];
  let finishUpload;
  let actionBusy = false;
  const isBusy = () => actionBusy || Boolean(finishUpload?.isBusy());
  const close = () => {
    if (isBusy()) { showToast('工单操作进行中，请稍后再关闭'); return; }
    finishUpload?.destroy(); root.innerHTML = '';
  };
  const render = () => {
    const reviewLabel = order.reviewStatus === 1 ? '合格' : order.reviewStatus === 0 ? '不合格' : '待审核';
    const actions = order.status === 'pending'
      ? `<button class="outline-btn" type="button" data-detail-review="${esc(order.id)}" data-valid="0" data-result="无效">判定无效</button><button class="primary-btn" type="button" data-detail-send="${esc(order.id)}">发送工单</button>`
      : order.status === 'review'
        ? `<button class="outline-btn" type="button" data-detail-review="${esc(order.id)}" data-valid="0" data-result="不合格">不合格</button><button class="primary-btn" type="button" data-detail-review="${esc(order.id)}" data-valid="1" data-result="合格">合格</button>`
        : order.status === 'processing'
          ? `<span class="order-followup">已耗时：<b data-order-elapsed data-order-remarks="${esc(order.remarks || '')}">${elapsedText(order.remarks)}</b><button class="outline-btn" type="button" data-detail-remind="${esc(order.id)}" data-order-remind="${esc(order.id)}" data-order-remarks="${esc(order.remarks || '')}" ${canRemind(order) ? '' : 'disabled'}>催办</button></span>`
        : '';
    root.innerHTML = `${embedded ? '' : '<div class="order-detail-scrim" data-detail-close></div>'}<section class="${embedded ? 'order-detail-inline' : 'order-detail-dialog'}" ${embedded ? '' : 'role="dialog" aria-modal="true"'} aria-label="工单详情" data-detail-order="${esc(order.id)}"><header class="order-detail-head"><div><p>工单详情 · 事件 #${esc(order.id)}</p><h2>${esc(order.title)}</h2></div>${embedded ? '' : '<button class="order-detail-close" type="button" aria-label="关闭详情" data-detail-close>×</button>'}</header><div class="order-detail-summary"><div><small>上报时间</small><b>${esc(order.occurredAt)}</b></div><div><small>事件类型</small><b>${esc(order.eventType || order.title)}</b></div><div><small>优先级</small>${badge(order.priority, severityClass(order.priority))}</div><div><small>审核结果</small>${badge(reviewLabel, order.reviewStatus === 1 ? 'green' : order.reviewStatus === 0 ? 'gray' : 'amber')}</div><div><small>处置状态</small>${badge(WORK_ORDER_STATUS[order.status] || order.processStatus, statusClass(order.status))}</div></div><div class="order-detail-media">${detailMediaPanel('报警材料', 'alarm', order.alertMedia, mediaPage.alarm)}${detailMediaPanel('处理后材料', 'processed', order.processedMedia, mediaPage.processed, isProcessingStatus(order.status))}</div><section class="order-detail-notes"><div><h3>事件信息</h3><p>车牌：${esc(order.licensePlate)}<br>${orderLocationMarkup(order)}</p></div><div><h3>备注</h3><p>${remarksMarkup(order.remarks)}</p></div></section><footer class="order-detail-actions">${actions}</footer></section>`;
    root.querySelectorAll('[data-detail-close]').forEach(button => button.addEventListener('click', close));
    root.querySelectorAll('[data-media-gallery]').forEach(gallery => gallery.addEventListener('click', event => {
      const button = event.target.closest('[data-media-step]');
      if (!button) return;
      const section = button.dataset.mediaSection;
      const items = section === 'alarm' ? order.alertMedia : order.processedMedia;
      mediaPage[section] = (mediaPage[section] + Number(button.dataset.mediaStep) + items.length) % items.length;
      gallery.innerHTML = detailMediaContents(section === 'alarm' ? '报警材料' : '处理后材料', section, items, mediaPage[section]);
    }));
    const processedGallery = root.querySelector('[data-media-gallery="processed"]');
    const actionButtons = [...root.querySelectorAll('.order-detail-actions button')];
    const originalDisabled = actionButtons.map(button => button.disabled);
    const runAction = async (operation, success, failure) => {
      if (isBusy()) return;
      actionBusy = true;
      root.querySelector('[data-finish-upload]').inert = true;
      actionButtons.forEach(button => { button.disabled = true; button.dataset.orderBusy = 'true'; });
      try {
        await operation();
        invalidateCache('orders');
        showToast(success);
        actionBusy = false;
        if (!embedded) close();
        if (root.isConnected) await onChanged?.();
      } catch (error) {
        showToast(error.message || failure);
      } finally {
        actionBusy = false;
        // These nodes may have been replaced by the refreshed order detail.
        const upload = actionButtons[0]?.closest('[data-detail-order]')?.querySelector('[data-finish-upload]');
        if (upload) upload.inert = false;
        actionButtons.forEach((button, index) => { button.disabled = originalDisabled[index]; button.dataset.orderBusy = 'false'; });
      }
    };
    finishUpload = mountFinishUpload(root.querySelector('[data-finish-upload]'), {
      canUpload: () => isProcessingStatus(order.status),
      upload: (file, uploadId, onProgress) => {
        if (!isProcessingStatus(order.status)) throw new Error('仅处理中的事件可上传图片和视频');
        return api.uploadFinishMedia(order.id, file, uploadId, onProgress);
      },
      onBusy: busy => actionButtons.forEach((button, index) => { button.disabled = busy || actionBusy || originalDisabled[index]; if (button.hasAttribute('data-detail-remind')) button.dataset.orderBusy = String(busy || actionBusy); }),
      onComplete: media => {
        const keyOf = item => item.key || new URL(item.url).pathname;
        const newPath = new URL(media.url).pathname;
        const index = order.processedMedia.findIndex(item => keyOf(item) === media.key || new URL(item.url).pathname === newPath);
        if (index < 0) order.processedMedia.push(media); else order.processedMedia[index] = media;
        mediaPage.processed = index < 0 ? order.processedMedia.length - 1 : index;
        const currentOrder = state.orders.find(item => item.id === order.id);
        if (currentOrder) currentOrder.processedMedia = [...order.processedMedia];
        invalidateCache('orders');
        if (processedGallery.isConnected) processedGallery.innerHTML = detailMediaContents('处理后材料', 'processed', order.processedMedia, mediaPage.processed);
      },
    });
    root.querySelectorAll('[data-detail-send]').forEach(button => button.addEventListener('click', () => runAction(
      () => api.sendWorkOrder(order.id, order.remarks), '工单已发送，等待处理', '工单发送失败')));
    root.querySelectorAll('[data-detail-review]').forEach(button => button.addEventListener('click', () => {
      const isValid = Number(button.dataset.valid);
      const success = order.status === 'review'
        ? (isValid ? '审核合格，工单已完成' : '审核不合格，工单已退回未处理')
        : (isValid ? '已确认有效' : '已判定无效，已从工单中心移除');
      return runAction(() => api.reviewWorkOrder(order.id, isValid, order.remarks, button.dataset.result, order.status),
        success, '审核结果写入失败');
    }));
    root.querySelectorAll('[data-detail-remind]').forEach(button => button.addEventListener('click', () => runAction(
      () => api.remindWorkOrder(order.id, order.remarks), '已添加催办备注', '催办失败')));
  };
  render();
  startOrderElapsedTimer();
  const locationName = root.querySelector('[data-location-name]');
  const point = orderCoordinate(order);
  if (point) {
    reverseGeocode(point.latitude, point.longitude).then(placeName => {
      if (locationName?.isConnected) locationName.textContent = `地点名称：${placeName}`;
    }).catch(error => {
      console.warn('腾讯地图逆地址解析失败：', error);
      if (locationName?.isConnected) locationName.textContent = `地点名称解析失败：${error.message}`;
    });
  }
  return { isBusy, destroy() { finishUpload?.destroy(); root.querySelectorAll('video').forEach(video => video.pause()); root.innerHTML = ''; } };
}

function detailMediaPanel(title, section, items, page) {
  return `<section class="media-panel"><div data-media-gallery="${section}">${detailMediaContents(title, section, items, page)}</div>${section === 'processed' ? '<div class="finish-upload" data-finish-upload></div>' : ''}</section>`;
}

function detailMediaContents(title, section, items, page) {
  if (!items.length) return `<div class="media-panel-head"><h3>${title}</h3><span>暂无材料</span></div><div class="media-empty">暂无可展示的图片或视频</div>`;
  const item = items[page];
  const media = item.kind === 'video'
    ? `<video controls preload="metadata" src="${esc(item.url)}">当前浏览器不支持视频播放。</video>`
    : `<img src="${esc(item.url)}" alt="${title} ${page + 1}" />`;
  const controls = items.length > 1 ? `<div class="media-pager"><button type="button" data-media-step="-1" data-media-section="${section}" aria-label="上一份材料">‹</button><span>${page + 1} / ${items.length} · ${item.kind === 'video' ? '视频' : '图片'}</span><button type="button" data-media-step="1" data-media-section="${section}" aria-label="下一份材料">›</button></div>` : `<div class="media-pager single">1 / 1 · ${item.kind === 'video' ? '视频' : '图片'}</div>`;
  return `<div class="media-panel-head"><h3>${title}</h3><span>${item.kind === 'video' ? '视频' : '图片'}</span></div><div class="media-stage">${media}</div>${controls}`;
}

async function renderLegacyOrders() {
  [state.orders, state.alerts] = await Promise.all([api.getWorkOrders(), api.getAlerts()]);
  const urgentAlerts = state.alerts.filter(a => a.severity === '高' && a.status !== 'false');
  setCriticalAlarm(urgentAlerts.length > 0);
  pageContent.innerHTML = `<section class="emergency-banner ${urgentAlerts.length ? 'is-critical' : 'is-safe'}"><div class="emergency-icon">${urgentAlerts.length ? '!' : '✓'}</div><div><p>${urgentAlerts.length ? '紧急事件播报 · 请快速处理' : '安全播报 · 当前无紧急事件'}</p><h2>${urgentAlerts.length ? `${urgentAlerts.length} 项高等级事件正在等待处置` : '现场态势平稳，所有事件均处于安全等级'}</h2><span>${urgentAlerts.length ? urgentAlerts.map(a => `${a.type}｜${a.location}`).join('　') : '安全等级以绿色展示'}</span></div><button class="banner-action" id="urgent-focus">${urgentAlerts.length ? '立即查看' : '查看工单'}</button></section>
  <section class="split-heading"><div><p>告警审核、紧急播报与现场整改统一在此闭环</p></div><button class="primary-btn" id="new-order">＋ 新建工单</button></section>
  <section class="alert-workbench panel"><div class="panel-head"><div><h2>告警待办</h2><p>点击事件可查看证据并转为处置工单</p></div><span class="severity-guide"><i class="red-dot"></i>高等级　<i class="amber-dot"></i>一般　<i class="green-dot"></i>安全</span></div>${alertRows(state.alerts)}</section>
  <section class="kanban">${Object.entries(WORK_ORDER_STATUS).map(([key,label])=>`<div class="kanban-col"><h3><i class="${statusClass(key)}-dot"></i>${label}<span>${state.orders.filter(x=>x.status===key).length}</span></h3><div>${state.orders.filter(x=>x.status===key).map(orderCard).join('') || `<p class="empty-card">暂无工单</p>`}</div></div>`).join('')}</section>`;
  document.querySelector('#new-order').addEventListener('click',()=>showToast('可从上方告警待办中一键创建关联工单'));
  document.querySelector('#urgent-focus').addEventListener('click',()=>urgentAlerts[0] ? openAlert(urgentAlerts[0].id) : document.querySelector('.kanban').scrollIntoView({behavior:'smooth'}));
  document.querySelectorAll('[data-alert]').forEach(x => x.addEventListener('click',() => openAlert(x.dataset.alert)));
}
function orderCard(o) { const source = state.alerts.find(a => a.id === o.sourceAlertId); return `<article class="order-card ${source ? severityClass(source.severity) : ''}"><span>${o.id}</span>${source ? badge(source.severity, severityClass(source.severity)) : ''}<h4>${o.title}</h4><p>⌖ ${o.location}</p><footer><b>${o.assignee}</b><em>${o.dueAt}</em></footer></article>`; }

async function renderMap(navigationId = state.navigationId) {
  await getOrdersData(true);
  if (!isCurrentNavigation('map', navigationId)) return;
  activeMapController?.destroy();
  const validMapOrders = state.orders.filter(order => hasMapCoordinates(order));
  const coordinateText = order => `${Number(order.longitude).toFixed(6)}, ${Number(order.latitude).toFixed(6)}`;
  const mapEventRows = validMapOrders.map(order => `<button class="map-event-row" data-map-order="${esc(order.id)}"><span class="map-event-dot ${order.severity === '高' ? 'high' : ''}"></span><span><b>${esc(order.title)}</b><small>${esc(coordinateText(order))}</small></span>${badge(order.priority, severityClass(order.priority))}</button>`).join('') || `<p class="map-empty">暂无可用经纬度的事件</p>`;
  pageContent.innerHTML = `<section class="map-page"><div class="map-panel"><div id="tencent-map" class="tencent-map" aria-label="腾讯地图"></div><div class="map-head"><b>城市巡检态势</b><span>已定位 ${validMapOrders.length} / ${state.orders.length} 个工单事件</span></div><div class="map-legend"><i class="red-dot"></i> 高优先级　<i class="amber-dot"></i> 一般事件</div></div><aside class="map-side panel"><h2>工单图层</h2><label class="switch-row">机动车 <input type="checkbox" checked data-map-category="机动车"></label><label class="switch-row">非机动车 <input type="checkbox" checked data-map-category="非机动车"></label><label class="switch-row">行人 <input type="checkbox" checked data-map-category="行人"></label><label class="switch-row">道路 <input type="checkbox" checked data-map-category="道路"></label><hr><div class="map-event-heading"><h3>已定位事件</h3><span>${validMapOrders.length}</span></div><div class="map-event-list">${mapEventRows}</div></aside></section>`;
  const mapController = await createAccountMap({
    container: pageContent.querySelector('#tencent-map'),
    alerts: validMapOrders,
    onAlertClick: openOrderDetail,
  });
  if (!isCurrentNavigation('map', navigationId)) { mapController?.destroy(); return; }
  activeMapController = mapController;
  const selectedCategories = () => new Set([...pageContent.querySelectorAll('[data-map-category]:checked')].map(input => input.dataset.mapCategory));
  pageContent.querySelectorAll('[data-map-category]').forEach(input => input.addEventListener('change', () => activeMapController?.setVisibleCategories(selectedCategories())));
  pageContent.querySelectorAll('[data-map-order]').forEach(button => button.addEventListener('click', () => {
    activeMapController?.focusAlert(button.dataset.mapOrder);
    openOrderDetail(button.dataset.mapOrder);
  }));
}

async function renderDevices() { await refreshDevices(); startDeviceAutoRefresh(); }
async function refreshDevices(force = false) {
  if (deviceRefreshInFlight) return;
  deviceRefreshInFlight = true;
  try {
    await getDevicesData(force);
    lastDeviceRefresh = new Date();
    const contentRoot = pageContent;
    if (state.page !== 'devices') return;
    const online=state.devices.filter(isOnlineDevice).length;
    const attention=state.devices.filter(d=>deviceState(d)==='abnormal').length;
    document.body.classList.add('devices-page');
    const existingTable = contentRoot.querySelector('#device-table-body');
    if (force && existingTable) {
      contentRoot.querySelector('#device-total').textContent = state.devices.length;
      contentRoot.querySelector('#device-online').textContent = online;
      contentRoot.querySelector('#device-attention').textContent = attention;
      existingTable.innerHTML = deviceRowsMarkup(state.devices);
      bindDeviceTableInteractions();
      return;
    }
    contentRoot.innerHTML=`<section class="metrics compact"><article class="metric-card"><div class="metric-label">接入设备<button class="text-btn" id="add-device-button" type="button">＋ 新增设备</button></div><strong id="device-total">${state.devices.length}</strong></article><article class="metric-card metric-card-simple"><div class="metric-label">当前在线<span class="metric-icon green">●</span></div><strong id="device-online">${online}</strong></article><article class="metric-card metric-card-simple"><div class="metric-label">需关注<span class="metric-icon amber">●</span></div><strong id="device-attention">${attention}</strong></article></section><section class="panel table-panel"><div class="panel-head"><div><h2>车载设备</h2><p>点击设备行查看运行详情与维护状态</p></div><button class="outline-btn" id="export-device-button" type="button">导出运维记录</button></div><table><thead><tr><th>设备编号</th><th>车辆牌照</th><th>运行时间</th><th>异常信息</th><th>存储</th><th>温度</th><th>状态</th></tr></thead><tbody id="device-table-body">${deviceRowsMarkup(state.devices)}</tbody></table></section>`;
    contentRoot.querySelector('#add-device-button').addEventListener('click', openCreateDeviceDialog);
    contentRoot.querySelector('#export-device-button').addEventListener('click', () => openExportDeviceDialog(state.devices));
    bindDeviceTableInteractions();
  } finally { deviceRefreshInFlight = false; }
}

function deviceRowsMarkup(devices) {
  return devices.map(d=>`<tr class="device-table-row" data-device-detail="${esc(d.id)}" role="button" tabindex="0"><td><b>${esc(d.id || '--')}</b></td><td><b>${esc(d.name || '--')}</b></td><td>${formatWorkTime(d.workStartTime,d.workFinishTime)}</td><td>${esc(d.abnormalInfo || '--')}</td><td>${d.storage == null ? '--' : `<div class="progress"><i style="width:${d.storage}%"></i></div>${d.storage}%`}</td><td>${d.temperature == null ? '--' : d.temperature+'°C'}</td><td>${badge(d.status || '--',statusClass(d.status))}</td></tr>`).join('');
}

function bindDeviceTableInteractions() {
  const root = pageContent;
  root.querySelectorAll('[data-device-detail]').forEach(row => {
    const openDetail = event => { if (event.target.closest('button, input, select, a')) return; openDeviceDialog(row.dataset.deviceDetail); };
    row.addEventListener('click', openDetail);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(event); } });
  });
}

function formatWorkTime(start, finish) {
  const normalize = value => String(value || '').slice(0, 5);
  if (!start && !finish) return '--';
  return `${normalize(start) || '--'}-${normalize(finish) || '--'}`;
}

function openDeviceDialog(deviceId) {
  const device = state.devices.find(item => String(item.id) === String(deviceId));
  if (!device) return;
  const root = document.querySelector('#drawer-root');
  const status = String(device.status || '未知');
  const statusTone = statusClass(status);
  const close = () => { root.innerHTML = ''; };
  const storagePercent = device.storage == null ? 0 : Math.max(0, Math.min(100, Number(device.storage)));
  root.innerHTML = `<div class="scrim device-detail-scrim" data-close-device-detail></div><section class="drawer device-detail-drawer" aria-label="设备详情"><button class="close" type="button" data-close-device-detail>×</button><p class="eyebrow">设备档案 · ${esc(device.id || '--')}</p><div class="device-dialog-title"><div class="device-dialog-orb ${statusTone}">▣</div><div><h2>${esc(device.name || device.id || '未命名设备')}</h2><span>${esc(device.route || '未配置线路')} · ${badge(status, statusTone)}</span></div></div><div class="device-dialog-meter"><div class="meter-ring ${statusTone}" style="--meter:${storagePercent}%"><b>${device.storage == null ? '--' : device.storage}<small>${device.storage == null ? '' : '%'}</small></b></div><div><strong>设备运行状态</strong><p>${isOnlineDevice(device) ? '链路在线，数据持续上报' : '设备需要现场检查或重新连接'}</p></div></div><dl class="detail-list"><div><dt>设备编号</dt><dd>${esc(device.id || '--')}</dd></div><div><dt>车辆牌照</dt><dd>${esc(device.name || '--')}</dd></div><div><dt>运行时段</dt><dd>${formatWorkTime(device.workStartTime, device.workFinishTime)}</dd></div><div><dt>网络状态</dt><dd>${esc(device.network || device.lastSeen || '数据库同步')}</dd></div><div><dt>设备温度</dt><dd>${device.temperature == null ? '--' : `${device.temperature}°C`}</dd></div><div><dt>异常信息</dt><dd>${esc(device.abnormalInfo || '当前无异常记录')}</dd></div></dl><div class="device-dialog-actions"><button class="outline-btn" type="button" data-close-device-detail>关闭</button><button class="primary-btn" type="button" data-jump="devices">返回设备运维</button></div></section>`;
  root.querySelectorAll('[data-close-device-detail]').forEach(button => button.addEventListener('click', close));
  root.querySelector('[data-jump="devices"]')?.addEventListener('click', () => {
    close();
    if (state.page !== 'devices') openCenterPage('devices');
  });
}

function openCreateDeviceDialog() {
  const root = document.querySelector('#drawer-root');
  root.innerHTML = `<div class="scrim" data-close-device></div><section class="drawer device-create-dialog"><button class="close" type="button" data-close-device>×</button><h2>新增设备</h2><form id="create-device-form" class="setting-card"><label>设备编号<input name="deviceId" required placeholder="例如 a_999" /></label><label>车牌号<input name="licensePlate" required placeholder="例如 津A12345" /></label><label>运行开始时间<input name="workStartTime" type="time" required value="08:00" /></label><label>运行结束时间<input name="workFinishTime" type="time" required value="19:00" /></label><button class="primary-btn" type="submit">保存设备</button></form></section>`;
  root.querySelectorAll('[data-close-device]').forEach(el => el.addEventListener('click', () => { root.innerHTML = ''; }));
  root.querySelector('#create-device-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api.createDevice(Object.fromEntries(form.entries()));
      invalidateCache('devices');
      root.innerHTML = '';
      showToast('设备已新增');
      await refreshDevices(true);
    } catch (error) { button.disabled = false; showToast(error.message || '新增设备失败'); }
  });
}

function openExportDeviceDialog(devices) {
  const root = document.querySelector('#drawer-root');
  const options = devices.map((device, index) => `<label class="export-device-option"><input type="checkbox" name="deviceId" value="${esc(device.id)}" ${index === 0 ? 'checked' : ''} /><span><b>${esc(device.id)}</b>${device.name ? ` · ${esc(device.name)}` : ''}</span></label>`).join('');
  root.innerHTML = `<div class="scrim" data-close-export></div><section class="drawer device-create-dialog"><button class="close" type="button" data-close-export>×</button><h2>导出运维记录</h2><form id="export-device-form" class="setting-card"><fieldset class="export-device-list"><legend>选择设备编号（可多选）</legend>${options || '<p>暂无可导出的设备</p>'}</fieldset><p>一次勾选多个设备后，将分别下载对应的运维明细 CSV 文件。</p><button class="primary-btn" type="submit" ${devices.length ? '' : 'disabled'}>开始导出</button></form></section>`;
  root.querySelectorAll('[data-close-export]').forEach(el => el.addEventListener('click', () => { root.innerHTML = ''; }));
  root.querySelector('#export-device-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const deviceIds = new FormData(event.currentTarget).getAll('deviceId').filter(Boolean);
    if (!deviceIds.length) { showToast('请至少选择一个设备'); return; }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      for (const deviceId of deviceIds) {
        const blob = await api.exportDeviceDetail(deviceId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${deviceId}-运维记录.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      root.innerHTML = '';
      showToast(`已导出 ${deviceIds.length} 台设备的运维记录`);
    } catch (error) { button.disabled = false; showToast(error.message || '导出失败'); }
  });
}

async function renderSettings() { pageContent.innerHTML=`<section class="settings-layout"><article class="panel setting-card"><h2>告警判定规则</h2><p>调整后会在下一次设备同步时生效。</p><label>违停最短判定时长 <div class="input-suffix"><input id="stop-minutes" type="number" value="180" min="30"><span>秒</span></div></label><label>道路病害告警置信度 <div class="input-suffix"><input id="confidence" type="number" value="85" min="1" max="100"><span>%</span></div></label><label class="switch-row">高优先级事件即时通知 <input id="notice" type="checkbox" checked></label><button class="primary-btn" id="save-settings">保存配置</button></article><article class="panel setting-card"><h2>电子围栏与白名单</h2><p>配置禁行区域、重点巡检路段和特种车辆白名单。</p><button class="outline-btn wide-btn">管理电子围栏</button><button class="outline-btn wide-btn">管理白名单车辆</button><hr><h3>模型发布</h3><p>当前生产版本：<b>vision-1.4.2</b></p><button class="text-btn">查看模型版本记录 →</button></article></section>`; document.querySelector('#save-settings').addEventListener('click',async()=>{await api.updateSettings({stopDuration:Number(document.querySelector('#stop-minutes').value),confidence:Number(document.querySelector('#confidence').value),instantNotice:document.querySelector('#notice').checked});showToast('配置已保存，将在设备下次同步时生效');}); }

applyProfile();
updateClock();
setInterval(updateClock, 1000);
profileButton.addEventListener('click', openProfile);
homeButton?.addEventListener('click', () => go('dashboard'));
document.querySelectorAll('[data-center-page]').forEach(button => button.addEventListener('click', () => openCenterPage(button.dataset.centerPage)));
installPullToRefresh();

await go('dashboard');
