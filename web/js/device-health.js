import { mountHoverPinPopup } from './hover-pin.js';

export const DEVICE_STATES = Object.freeze([
  { key: 'normal', label: '正常', color: '#31dfab', shade: '#147e68' },
  { key: 'abnormal', label: '异常', color: '#ffae3b', shade: '#a15f19' },
  { key: 'offline', label: '离线', color: '#94a0ae', shade: '#535f6d' },
]);

export function deviceState(device) {
  const status = String(device?.status || '').trim().toLowerCase();
  if (['正常', '在线', 'online', 'normal'].includes(status)) return 'normal';
  if (['异常', 'warning', 'abnormal'].includes(status)) return 'abnormal';
  if (['离线', 'offline'].includes(status)) return 'offline';
  return 'unknown';
}

export function deviceReason(device) {
  const reason = String(device.abnormalInfo || '').trim();
  if (reason) return reason;
  return { normal: '当前无异常记录', abnormal: '暂未上报异常原因', offline: '设备离线，暂未上报原因' }[deviceState(device)] || '状态待确认';
}

export function buildDeviceHealth(devices) {
  const groups = DEVICE_STATES.map(state => ({ ...state, devices: devices.filter(device => deviceState(device) === state.key) }));
  const knownTotal = groups.reduce((sum, group) => sum + group.devices.length, 0);
  return { total: devices.length, knownTotal, unknown: devices.length - knownTotal, groups: groups.map(group => ({ ...group, count: group.devices.length, percent: knownTotal ? group.devices.length * 100 / knownTotal : 0 })) };
}

const TAU = Math.PI * 2;
// Elliptical top and only the visible front wall; split complete circles into
// two arcs because SVG's arc command cannot draw a full circle in one step.
export function deviceSliceGeometry(start, end) {
  if (!(end > start)) return { top: '', wall: '', edge: '', label: [170, 85] };
  const point = (angle, depth = 0) => [170 + 111 * Math.cos(angle), 83 + 56 * Math.sin(angle) + depth];
  const p = values => values.map(value => Number(value.toFixed(3))).join(' ');
  const arc = (a, b, depth = 0, reverse = false) => `A 111 56 0 ${Math.abs(b - a) > Math.PI ? 1 : 0} ${reverse ? 0 : 1} ${p(point(b, depth))}`;
  const full = end - start >= TAU - 1e-8;
  const top = full
    ? `M ${p(point(start))} ${arc(start, start + Math.PI)} ${arc(start + Math.PI, end)} Z`
    : `M 170 83 L ${p(point(start))} ${arc(start, end)} Z`;
  let wall = '';
  for (let turn = Math.floor(start / TAU); turn <= Math.floor(end / TAU); turn++) {
    const a = Math.max(start, turn * TAU);
    const b = Math.min(end, turn * TAU + Math.PI);
    if (b > a) wall += `M ${p(point(a))} ${arc(a, b)} L ${p(point(b, 19))} ${arc(b, a, 19, true)} Z `;
  }
  const edge = full ? '' : [start, end].map(angle => `M 170 83 L ${p(point(angle))} L ${p(point(angle, 19))} L 170 102 Z`).join(' ');
  const mid = (start + end) / 2;
  return { top, wall, edge, label: full ? [170, 83] : [170 + 73 * Math.cos(mid), 83 + 36 * Math.sin(mid)] };
}

let sequence = 0;
export function mountDeviceHealth(container, devices, onDeviceClick = () => {}) {
  if (!container) return null;
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const events = new view.AbortController();
  const popupId = `device-health-popup-${++sequence}`;
  const shape = state => `<g data-shape="${state.key}" style="--slice-color:${state.color}"><path class="device-pie-edge" fill="${state.shade}"/><path class="device-pie-wall" fill="${state.shade}"/></g>`;
  container.innerHTML = `<div class="device-pie-heading"><span>设备状态分布</span><b data-device-total></b></div><svg class="device-pie" viewBox="0 0 340 174" role="group" aria-label="正常、异常、离线设备占比"><ellipse cx="170" cy="112" rx="113" ry="45" fill="#020e19" opacity=".5"/>${DEVICE_STATES.map(shape).join('')}${DEVICE_STATES.map(state => `<g class="device-pie-slice" data-state="${state.key}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="${popupId}"><path class="device-pie-face" fill="${state.color}"/><text text-anchor="middle" dominant-baseline="middle"></text><path class="device-pie-hit" fill="transparent"/></g>`).join('')}<text class="device-pie-empty" x="170" y="84" text-anchor="middle" hidden>暂无设备数据</text></svg><div class="device-pie-legend">${DEVICE_STATES.map(state => `<button type="button" data-state="${state.key}" aria-haspopup="dialog" aria-controls="${popupId}" style="--slice-color:${state.color}"><span><i></i>${state.label}</span><b>0<small> 台</small></b><em>0%</em></button>`).join('')}</div><p class="device-pie-hint">悬停满 1 秒固定小窗 · 点 × 关闭</p><p class="device-pie-unknown" hidden></p>`;
  const popup = doc.createElement('section');
  popup.id = popupId;
  popup.className = 'device-health-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', '设备状态明细');
  popup.hidden = true;
  popup.innerHTML = '<header><div><strong></strong><span></span></div><button type="button" aria-label="关闭设备状态明细">×</button></header><div class="device-health-popup-list"></div><p>点击设备查看运行详情</p>';
  doc.body.append(popup);
  const controls = [...container.querySelectorAll('[data-state]')];
  const rows = popup.querySelector('.device-health-popup-list');
  let model;
  let active = null;
  let anchor;
  let popupSignature = '';
  const percentage = value => `${Number(value.toFixed(1))}%`;
  function hide() {
    active = null; popup.hidden = true;
    controls.forEach(control => { control.classList.remove('is-active'); control.setAttribute('aria-expanded', 'false'); });
    container.querySelectorAll('[data-shape]').forEach(shape => shape.classList.remove('is-active'));
  }
  function position() {
    if (!anchor || popup.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const left = rect.right + 8 + bounds.width <= view.innerWidth - 10 ? rect.right + 8 : rect.left - bounds.width - 8;
    popup.style.left = `${Math.max(10, Math.min(left, view.innerWidth - bounds.width - 10))}px`;
    popup.style.top = `${Math.max(10, Math.min(rect.top, view.innerHeight - bounds.height - 10))}px`;
  }
  function paintPopup() {
    const group = model.groups.find(group => group.key === active);
    if (!group) return;
    popup.style.setProperty('--slice-color', group.color);
    popup.querySelector('header strong').textContent = `${group.label}设备`;
    popup.querySelector('header span').textContent = `${group.count} 台 · ${percentage(group.percent)}`;
    const signature = JSON.stringify([active, group.devices.map(device => [device.id, device.name, deviceReason(device)])]);
    // Keep the scroll position and focused device row through polling updates.
    if (signature !== popupSignature) {
      popupSignature = signature;
      const existing = new Map([...rows.querySelectorAll('button')].map(row => [row.dataset.deviceId, row]));
      const scrollTop = rows.scrollTop;
      group.devices.forEach((device, index) => {
        const id = String(device.id);
        let row = existing.get(id);
        if (!row) {
          row = doc.createElement('button'); row.type = 'button'; row.dataset.deviceId = id;
          row.innerHTML = '<b></b><small></small><span></span>';
        }
        row.querySelector('b').textContent = device.name || device.id || '未命名设备';
        row.querySelector('small').textContent = device.id || '未提供设备编号';
        row.querySelector('span').textContent = `${active === 'abnormal' ? '异常原因：' : active === 'offline' ? '离线信息：' : ''}${deviceReason(device)}`;
        if (rows.children[index] !== row) rows.insertBefore(row, rows.children[index] || null);
        existing.delete(id);
      });
      existing.forEach(row => row.remove());
      rows.querySelector('.device-popup-empty')?.remove();
      if (!group.count) { const empty = doc.createElement('div'); empty.className = 'device-popup-empty'; empty.textContent = `暂无${group.label}设备`; rows.append(empty); }
      rows.scrollTop = scrollTop;
    }
    position();
  }
  function show(control) {
    active = control.dataset.state; anchor = control;
    controls.forEach(item => { const selected = item.dataset.state === active; item.classList.toggle('is-active', selected); item.setAttribute('aria-expanded', String(selected)); });
    container.querySelectorAll('[data-shape]').forEach(shape => shape.classList.toggle('is-active', shape.dataset.shape === active));
    popup.hidden = false; paintPopup();
  }
  function update(nextDevices) {
    model = buildDeviceHealth(nextDevices);
    container.querySelector('[data-device-total]').textContent = `共 ${model.total} 台`;
    let angle = -Math.PI / 2;
    for (const group of model.groups) {
      const end = angle + group.percent / 100 * TAU;
      const geometry = deviceSliceGeometry(angle, end);
      const slice = container.querySelector(`.device-pie-slice[data-state="${group.key}"]`);
      const side = container.querySelector(`[data-shape="${group.key}"]`);
      slice.style.display = group.count ? '' : 'none';
      side.querySelector('.device-pie-wall').setAttribute('d', geometry.wall);
      side.querySelector('.device-pie-edge').setAttribute('d', geometry.edge);
      slice.querySelectorAll('path').forEach(path => path.setAttribute('d', geometry.top));
      const label = slice.querySelector('text');
      label.textContent = group.percent >= 8 ? percentage(group.percent) : '';
      label.setAttribute('x', geometry.label[0]); label.setAttribute('y', geometry.label[1]);
      const legend = container.querySelector(`button[data-state="${group.key}"]`);
      legend.querySelector('b').firstChild.textContent = group.count;
      legend.querySelector('em').textContent = percentage(group.percent);
      [slice, legend].forEach(control => control.setAttribute('aria-label', `${group.label} ${group.count} 台，占比 ${percentage(group.percent)}，查看设备与原因`));
      angle = end;
    }
    container.querySelector('.device-pie-empty').toggleAttribute('hidden', model.knownTotal > 0);
    container.querySelector('.device-pie-empty').textContent = model.total ? '暂无已确认状态' : '暂无设备数据';
    const note = container.querySelector('.device-pie-unknown');
    note.hidden = !model.unknown;
    note.textContent = `另有 ${model.unknown} 台状态未识别，未计入饼图占比`;
    hoverPin.validateSource();
    if (active) {
      if (!anchor.getClientRects().length) anchor = container.querySelector(`button[data-state="${active}"]`);
      paintPopup();
    }
  }
  const hoverPin = mountHoverPinPopup({ popup, controls, onShow: show, onHide: hide });
  rows.addEventListener('click', event => { const button = event.target.closest('[data-device-id]'); if (button) onDeviceClick(button.dataset.deviceId); }, { signal: events.signal });
  view.addEventListener('resize', position, { signal: events.signal });
  view.addEventListener('scroll', position, { capture: true, signal: events.signal });
  update(devices);
  return { update, destroy() { hoverPin.destroy(); events.abort(); popup.remove(); } };
}
