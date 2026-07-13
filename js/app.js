import { api } from './api.js';
import { ALERT_STATUS, WORK_ORDER_STATUS } from './types.js';

const navItems = [
  ['dashboard','▦','数据总览','运营中心'], ['alerts','◉','告警中心','智能审核'], ['orders','▤','工单中心','闭环处置'],
  ['map','⌖','地图巡检','空间态势'], ['devices','▣','设备运维','车载设备'], ['settings','⚙','系统配置','规则与权限'],
];
const state = { page:'dashboard', alerts:[], devices:[], orders:[], dashboard:null };
const pageContent = document.querySelector('#page-content');
const nav = document.querySelector('#main-nav');
const title = document.querySelector('#page-title');
const kicker = document.querySelector('#page-kicker');

function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function badge(value, type = '') { return `<span class="badge ${type || value}">${esc(value)}</span>`; }
function statusClass(status) { return { pending:'amber', valid:'green', false:'gray', dispatched:'blue', online:'green', warning:'amber', offline:'red', processing:'blue', checking:'amber', closed:'green' }[status] || 'gray'; }
function showToast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2600); }

function renderNav() {
  nav.innerHTML = navItems.map(([key, icon, label]) => `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}"><span>${icon}</span>${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
}
async function go(page) {
  state.page = page; const item = navItems.find(i => i[0] === page); title.textContent = item[2]; kicker.textContent = item[3]; renderNav();
  pageContent.innerHTML = `<div class="loading">正在加载数据…</div>`;
  const renderers = { dashboard:renderDashboard, alerts:renderAlerts, orders:renderOrders, map:renderMap, devices:renderDevices, settings:renderSettings };
  await renderers[page]();
}

async function loadCore() { [state.dashboard, state.alerts, state.orders, state.devices] = await Promise.all([api.getDashboard(), api.getAlerts(), api.getWorkOrders(), api.getDevices()]); }
function metric(label, value, sub, tone) { return `<article class="metric-card"><div class="metric-label">${label}<span class="metric-icon ${tone}">●</span></div><strong>${value}</strong><small>${sub}</small></article>`; }
async function renderDashboard() {
  await loadCore(); const d = state.dashboard;
  pageContent.innerHTML = `<section class="metrics">${metric('今日告警',d.todayAlerts,'较昨日 +12.4%','blue')}${metric('有效告警率',`${d.validRate}%`,'目标 ≥ 90%','green')}${metric('待处理工单',d.pendingOrders,'其中 3 条高优先级','amber')}${metric('设备在线率',`${d.onlineRate}%`,'28 / 30 台在线','purple')}</section>
  <section class="grid two-one"><article class="panel"><div class="panel-head"><div><h2>告警趋势</h2><p>近 7 日有效告警数量</p></div><button class="link-btn" data-jump="alerts">查看告警 →</button></div><div class="chart">${d.trend.map((n,i) => `<div class="bar-wrap"><span>${n}</span><div class="bar" style="height:${n/0.52}%"></div><small>${['周二','周三','周四','周五','周六','周日','今日'][i]}</small></div>`).join('')}</div></article>
  <article class="panel"><div class="panel-head"><div><h2>处置效率</h2><p>今日工单处理状态</p></div></div><div class="donut-row"><div class="donut"><b>86%</b><span>按时处置</span></div><div class="legend"><p><i class="green-dot"></i> 已关闭 <b>36</b></p><p><i class="blue-dot"></i> 处理中 <b>12</b></p><p><i class="amber-dot"></i> 待验收 <b>8</b></p></div></div></article></section>
  <section class="grid two-one"><article class="panel"><div class="panel-head"><div><h2>待审核告警</h2><p>需要人工确认的 AI 识别结果</p></div><button class="link-btn" data-jump="alerts">全部查看 →</button></div>${alertRows(state.alerts.filter(a => a.status === 'pending').slice(0,3))}</article><article class="panel"><div class="panel-head"><div><h2>设备健康度</h2><p>异常设备需要关注</p></div><button class="link-btn" data-jump="devices">运维中心 →</button></div>${deviceMini(state.devices)}</article></section>`;
  bindJump();
}
function alertRows(alerts) { return `<div class="mini-list">${alerts.map(a => `<button class="alert-mini" data-alert="${a.id}"><span class="scene ${a.thumbnail}">${a.thumbnail}</span><span><b>${a.type}</b><small>${a.location} · ${a.occurredAt}</small></span>${badge(a.severity, a.severity === '高' ? 'red' : 'amber')}</button>`).join('')}</div>`; }
function deviceMini(devices) { return `<div class="mini-list">${devices.slice(0,3).map(d => `<div class="device-mini"><i class="${statusClass(d.status)}-dot"></i><span><b>${d.name}</b><small>${d.route} · ${d.lastSeen}</small></span><em>${d.status === 'online' ? '运行正常' : d.status === 'warning' ? '存储空间不足' : '连接中断'}</em></div>`).join('')}</div>`; }
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
  document.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',async()=>{ await api.updateAlert(id,{status:b.dataset.review}); showToast(b.dataset.review==='valid'?'已确认有效告警':'已标记为误报'); close(); go('alerts'); }));
  document.querySelector('#create-order').addEventListener('click',async()=>{ await api.createWorkOrder({title:`处置${alert.location}${alert.type}`,sourceAlertId:alert.id,location:alert.location}); await api.updateAlert(id,{status:'dispatched'}); showToast('工单已创建，等待指派'); close(); go('orders'); });
}

async function renderOrders() { state.orders = await api.getWorkOrders(); pageContent.innerHTML = `<section class="split-heading"><div><p>从 AI 事件到现场整改的全程留痕</p></div><button class="primary-btn" id="new-order">＋ 新建工单</button></section><section class="kanban">${Object.entries(WORK_ORDER_STATUS).map(([key,label])=>`<div class="kanban-col"><h3><i class="${statusClass(key)}-dot"></i>${label}<span>${state.orders.filter(x=>x.status===key).length}</span></h3><div>${state.orders.filter(x=>x.status===key).map(orderCard).join('') || `<p class="empty-card">暂无工单</p>`}</div></div>`).join('')}</section>`; document.querySelector('#new-order').addEventListener('click',()=>showToast('可从告警详情页一键创建关联工单')); }
function orderCard(o) { return `<article class="order-card"><span>${o.id}</span><h4>${o.title}</h4><p>⌖ ${o.location}</p><footer><b>${o.assignee}</b><em>${o.dueAt}</em></footer></article>`; }

async function renderMap() { if (!state.alerts.length) state.alerts=await api.getAlerts(); pageContent.innerHTML=`<section class="map-page"><div class="map-panel"><div class="map-grid"></div><div class="map-head"><b>城市巡检态势</b><span>${state.alerts.length} 个事件点位</span></div><div class="route-line"></div>${state.alerts.map((a,i)=>`<button class="map-pin ${a.severity==='高'?'danger':''}" style="left:${24+i*15}%;top:${32+(i%2)*26}%" data-alert="${a.id}">${i+1}</button>`).join('')}<div class="map-legend">● 高优先级　● 一般事件　━━ 公交巡检线路</div></div><aside class="map-side panel"><h2>巡检图层</h2><label class="switch-row">道路病害 <input type="checkbox" checked></label><label class="switch-row">道路设施 <input type="checkbox" checked></label><label class="switch-row">施工市容 <input type="checkbox" checked></label><label class="switch-row">车载设备 <input type="checkbox" checked></label><hr><h3>高优先级事件</h3>${alertRows(state.alerts.filter(x=>x.severity==='高'))}</aside></section>`; document.querySelectorAll('[data-alert]').forEach(x=>x.addEventListener('click',()=>openAlert(x.dataset.alert))); }

async function renderDevices() { state.devices=await api.getDevices(); pageContent.innerHTML=`<section class="metrics compact">${metric('接入设备','30','本月新增 2 台','blue')}${metric('当前在线','28','在线率 93.3%','green')}${metric('需关注','2','存储或温度异常','amber')}</section><section class="panel table-panel"><div class="panel-head"><div><h2>车载边缘盒</h2><p>设备心跳、网络与资源状态</p></div><button class="outline-btn">导出运维记录</button></div><table><thead><tr><th>设备</th><th>车辆 / 线路</th><th>网络</th><th>存储</th><th>温度</th><th>模型版本</th><th>状态</th></tr></thead><tbody>${state.devices.map(d=>`<tr><td><b>${d.id}</b><small>${d.lastSeen}</small></td><td>${d.name}<small>${d.route}</small></td><td>${d.network}</td><td><div class="progress"><i style="width:${d.storage}%"></i></div>${d.storage}%</td><td>${d.temperature ? d.temperature+'°C':'--'}</td><td>${d.modelVersion}</td><td>${badge(d.status==='online'?'在线':d.status==='warning'?'需关注':'离线',statusClass(d.status))}</td></tr>`).join('')}</tbody></table></section>`; }

async function renderSettings() { pageContent.innerHTML=`<section class="settings-layout"><article class="panel setting-card"><h2>告警判定规则</h2><p>调整后会在下一次设备同步时生效。</p><label>违停最短判定时长 <div class="input-suffix"><input id="stop-minutes" type="number" value="180" min="30"><span>秒</span></div></label><label>道路病害告警置信度 <div class="input-suffix"><input id="confidence" type="number" value="85" min="1" max="100"><span>%</span></div></label><label class="switch-row">高优先级事件即时通知 <input id="notice" type="checkbox" checked></label><button class="primary-btn" id="save-settings">保存配置</button></article><article class="panel setting-card"><h2>电子围栏与白名单</h2><p>配置禁行区域、重点巡检路段和特种车辆白名单。</p><button class="outline-btn wide-btn">管理电子围栏</button><button class="outline-btn wide-btn">管理白名单车辆</button><hr><h3>模型发布</h3><p>当前生产版本：<b>vision-1.4.2</b></p><button class="text-btn">查看模型版本记录 →</button></article></section>`; document.querySelector('#save-settings').addEventListener('click',async()=>{await api.updateSettings({stopDuration:Number(document.querySelector('#stop-minutes').value),confidence:Number(document.querySelector('#confidence').value),instantNotice:document.querySelector('#notice').checked});showToast('配置已保存，将在设备下次同步时生效');}); }

await go('dashboard');
