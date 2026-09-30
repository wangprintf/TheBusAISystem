import { mountHoverPinPopup } from './hover-pin.js';

export const ORDER_STAGES = Object.freeze([
  { key: 'pending', label: '未处理', color: '#ffae3b', light: '#ffdb83', shade: '#a4681e' },
  { key: 'processing', label: '处理中', color: '#21c8ef', light: '#61edff', shade: '#087c9c' },
  { key: 'review', label: '待审核', color: '#b393ff', light: '#d5baff', shade: '#6949bc' },
  { key: 'completed', label: '已完成', color: '#31dfab', light: '#83f7d4', shade: '#127c65' },
]);
const TAU = Math.PI * 2;
const percentText = percent => `${Number(percent.toFixed(1))}%`;

export function buildOrderStatus(orders) {
  const groups = ORDER_STAGES.map(stage => ({ ...stage, orders: orders.filter(order => order.status === stage.key) }));
  const knownTotal = groups.reduce((total, group) => total + group.orders.length, 0);
  return { total: orders.length, knownTotal, unknown: orders.length - knownTotal, groups: groups.map(group => ({ ...group, count: group.orders.length, percent: knownTotal ? group.orders.length / knownTotal * 100 : 0 })) };
}

// A projected annulus: the front outer wall and the rear inner wall create
// depth while leaving a real hole. Complete circles need two SVG arcs.
export function orderRingGeometry(start, end) {
  if (!(end > start)) return { top: '', outerWall: '', innerWall: '', edge: '', anchor: [210, 106], middle: start };
  const point = (angle, inner = false, depth = 0) => [210 + (inner ? 51 : 101) * Math.cos(angle), 106 + (inner ? 29 : 57) * Math.sin(angle) + depth];
  const p = values => values.map(value => Number(value.toFixed(3))).join(' ');
  const arc = (a, b, inner = false, depth = 0, reverse = false) => `A ${inner ? '51 29' : '101 57'} 0 ${Math.abs(b - a) > Math.PI ? 1 : 0} ${reverse ? 0 : 1} ${p(point(b, inner, depth))}`;
  const full = end - start >= TAU - 1e-8;
  const top = full
    ? `M ${p(point(start))} ${arc(start, start + Math.PI)} ${arc(start + Math.PI, end)} Z M ${p(point(end, true))} ${arc(end, end - Math.PI, true, 0, true)} ${arc(end - Math.PI, start, true, 0, true)} Z`
    : `M ${p(point(start))} ${arc(start, end)} L ${p(point(end, true))} ${arc(end, start, true, 0, true)} Z`;
  function wall(inner) {
    let path = '';
    for (let turn = Math.floor(start / TAU) - 1; turn <= Math.floor(end / TAU); turn++) {
      const a = Math.max(start, turn * TAU + (inner ? Math.PI : 0));
      const b = Math.min(end, turn * TAU + (inner ? TAU : Math.PI));
      if (b > a) path += `M ${p(point(a, inner))} ${arc(a, b, inner)} L ${p(point(b, inner, 22))} ${arc(b, a, inner, 22, true)} Z `;
    }
    return path;
  }
  const edge = full ? '' : [start, end].map(angle => `M ${p(point(angle))} L ${p(point(angle, true))} L ${p(point(angle, true, 22))} L ${p(point(angle, false, 22))} Z`).join(' ');
  const middle = (start + end) / 2;
  return { top, outerWall: wall(false), innerWall: wall(true), edge, anchor: point(middle), middle };
}

export function orderRingCallouts(slices) {
  const callouts = slices.filter(slice => slice.count > 0).map(slice => ({ key: slice.key, side: Math.cos(slice.middle) >= 0 ? 'right' : 'left', y: 106 + Math.sin(slice.middle) * 82, anchor: slice.anchor }));
  for (const side of ['left', 'right']) {
    const rows = callouts.filter(row => row.side === side).sort((a, b) => a.y - b.y);
    rows.forEach((row, index) => { row.y = Math.max(28, row.y, index ? rows[index - 1].y + 30 : 28); });
    const overflow = Math.max(0, (rows.at(-1)?.y || 0) - 190);
    rows.forEach(row => { row.y -= overflow; });
  }
  return callouts;
}

let sequence = 0;
export function mountOrderStatus(container, orders, onOrderClick) {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const events = new view.AbortController();
  const chartId = `order-status-${++sequence}`;
  const popupId = `${chartId}-popup`;
  container.innerHTML = `<svg class="order-status-ring" viewBox="0 0 420 224" role="group" aria-label="工单状态立体环形图"><defs><radialGradient id="${chartId}-halo"><stop stop-color="#14b5eb" stop-opacity=".15"/><stop offset="1" stop-color="#14b5eb" stop-opacity="0"/></radialGradient>${ORDER_STAGES.map(stage => `<linearGradient id="${chartId}-${stage.key}" x1="0" y1="0" x2=".65" y2="1"><stop stop-color="${stage.light}"/><stop offset="1" stop-color="${stage.color}"/></linearGradient>`).join('')}</defs><g class="order-ring-orbit" aria-hidden="true"><ellipse cx="210" cy="128" rx="147" ry="80" fill="url(#${chartId}-halo)"/><ellipse cx="210" cy="127" rx="139" ry="75"/><ellipse cx="210" cy="134" rx="126" ry="62" stroke-dasharray="2 7"/><path d="M 71 127 A 139 75 0 0 0 210 202"/><circle cx="71" cy="127" r="3"/><circle cx="349" cy="127" r="2"/></g><g class="order-ring-empty" aria-hidden="true"><ellipse cx="210" cy="106" rx="101" ry="57"/><ellipse cx="210" cy="106" rx="51" ry="29"/></g>${ORDER_STAGES.map(stage => `<g class="order-ring-depth" data-order-visual="${stage.key}" fill="${stage.shade}"><path data-wall="outer"/><path data-wall="inner"/><path class="order-ring-edge"/></g>`).join('')}${ORDER_STAGES.map(stage => `<g class="order-ring-slice" data-order-state="${stage.key}" tabindex="0" role="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="${popupId}"><path class="order-ring-face" data-order-visual="${stage.key}" fill="url(#${chartId}-${stage.key})" fill-rule="evenodd"/><path class="order-ring-hit" fill="transparent" fill-rule="evenodd"/></g>`).join('')}<g class="order-ring-center" text-anchor="middle" aria-hidden="true"><text y="101" x="210" data-ring-total></text><text y="120" x="210" class="order-ring-caption">工单总量</text></g>${ORDER_STAGES.map(stage => `<g class="order-ring-callout" data-callout="${stage.key}" style="--stage-color:${stage.color}" aria-hidden="true"><polyline/><circle r="2.5"/><text><tspan class="order-ring-state-label">${stage.label} </tspan><tspan data-ring-percent></tspan></text></g>`).join('')}</svg><div class="order-status-legend">${ORDER_STAGES.map(stage => `<button type="button" data-order-state="${stage.key}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${popupId}" style="--stage-color:${stage.color}"><span><i></i>${stage.label}</span><strong><b>0</b><small> 单</small></strong><em>0%</em></button>`).join('')}</div><p class="order-ring-hint">悬停满 1 秒固定小窗 · 点 × 关闭</p><p class="order-ring-unknown" hidden></p>`;
  const popup = doc.createElement('section');
  popup.id = popupId; popup.className = 'order-status-popup'; popup.hidden = true;
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '工单状态明细');
  popup.innerHTML = '<header><div><strong></strong><span></span></div><button type="button" aria-label="关闭工单状态明细">×</button></header><div class="order-status-popup-list"></div><p>点击工单查看处置详情</p>';
  doc.body.append(popup);
  const controls = [...container.querySelectorAll('[data-order-state]')];
  const list = popup.querySelector('.order-status-popup-list');
  let model;
  let active = null;
  let anchor = null;
  let signature = '';
  function highlight() {
    controls.forEach(control => { const selected = control.dataset.orderState === active; control.classList.toggle('is-active', selected); control.setAttribute('aria-expanded', String(selected)); });
    container.querySelectorAll('[data-order-visual]').forEach(shape => shape.classList.toggle('is-active', shape.dataset.orderVisual === active));
    container.querySelectorAll('[data-callout]').forEach(label => label.classList.toggle('is-active', label.dataset.callout === active));
  }
  function hide() { active = null; popup.hidden = true; highlight(); }
  function position() {
    if (popup.hidden || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const left = rect.left - bounds.width - 10 >= 10 ? rect.left - bounds.width - 10 : rect.right + 10;
    popup.style.left = `${Math.max(10, Math.min(left, view.innerWidth - bounds.width - 10))}px`;
    popup.style.top = `${Math.max(10, Math.min(rect.top, view.innerHeight - bounds.height - 10))}px`;
  }
  function paintPopup() {
    const group = model.groups.find(group => group.key === active);
    if (!group) return;
    popup.style.setProperty('--stage-color', group.color);
    popup.querySelector('header strong').textContent = `${group.label}工单`;
    popup.querySelector('header span').textContent = `${group.count} 单 · 占比 ${percentText(group.percent)}`;
    const nextSignature = JSON.stringify([active, group.orders.map(order => [order.id, order.title, order.priority, order.occurredAt, order.location])]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      const scrollTop = list.scrollTop;
      const existing = new Map([...list.querySelectorAll('button')].map(row => [row.dataset.popupOrderId, row]));
      group.orders.forEach((order, index) => {
        const id = String(order.id);
        let row = existing.get(id);
        if (!row) {
          row = doc.createElement('button'); row.type = 'button'; row.dataset.popupOrderId = id;
          row.innerHTML = '<span class="order-popup-row-head"><b></b><em></em></span><small></small><span class="order-popup-row-foot"><span></span><time></time></span>';
        }
        row.querySelector('b').textContent = order.title || `工单 ${id}`;
        row.querySelector('em').textContent = `${order.priority || '未分级'}优先级`;
        row.querySelector('small').textContent = order.location || '未提供位置';
        row.querySelector('.order-popup-row-foot span').textContent = `#${id}`;
        row.querySelector('time').textContent = order.occurredAt || '未提供时间';
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
        existing.delete(id);
      });
      existing.forEach(row => row.remove());
      list.querySelector('.order-popup-empty')?.remove();
      if (!group.count) { const empty = doc.createElement('div'); empty.className = 'order-popup-empty'; empty.textContent = `暂无${group.label}工单`; list.append(empty); }
      list.scrollTop = scrollTop;
    }
    position();
  }
  function show(control) {
    active = control.dataset.orderState; anchor = control;
    highlight(); popup.hidden = false; paintPopup();
  }
  function update(nextOrders) {
    model = buildOrderStatus(nextOrders);
    container.querySelector('[data-ring-total]').textContent = model.total;
    container.querySelector('.order-ring-caption').textContent = model.total ? '工单总量' : '暂无工单';
    container.querySelector('.order-ring-empty').style.display = model.knownTotal ? 'none' : '';
    let angle = -Math.PI / 2;
    const slices = [];
    for (const group of model.groups) {
      const end = angle + group.percent / 100 * TAU;
      const geometry = orderRingGeometry(angle, end);
      slices.push({ ...group, ...geometry });
      const slice = container.querySelector(`.order-ring-slice[data-order-state="${group.key}"]`);
      slice.style.display = group.count ? '' : 'none';
      slice.querySelectorAll('path').forEach(path => path.setAttribute('d', geometry.top));
      const depth = container.querySelector(`.order-ring-depth[data-order-visual="${group.key}"]`);
      depth.querySelector('[data-wall="outer"]').setAttribute('d', geometry.outerWall);
      depth.querySelector('[data-wall="inner"]').setAttribute('d', geometry.innerWall);
      depth.querySelector('.order-ring-edge').setAttribute('d', geometry.edge);
      const legend = container.querySelector(`button[data-order-state="${group.key}"]`);
      legend.querySelector('b').textContent = group.count;
      legend.querySelector('em').textContent = percentText(group.percent);
      for (const control of [slice, legend]) control.setAttribute('aria-label', `${group.label} ${group.count} 单，占比 ${percentText(group.percent)}，查看工单`);
      angle = end;
    }
    const callouts = orderRingCallouts(slices);
    for (const group of model.groups) {
      const label = container.querySelector(`[data-callout="${group.key}"]`);
      const callout = callouts.find(callout => callout.key === group.key);
      label.style.display = callout ? '' : 'none';
      if (!callout) continue;
      const x = callout.side === 'left' ? 12 : 408;
      const elbow = callout.side === 'left' ? 99 : 321;
      label.querySelector('polyline').setAttribute('points', `${callout.anchor.join(',')} ${elbow},${callout.y} ${x},${callout.y}`);
      label.querySelector('circle').setAttribute('cx', callout.anchor[0]); label.querySelector('circle').setAttribute('cy', callout.anchor[1]);
      label.querySelector('text').setAttribute('x', x); label.querySelector('text').setAttribute('y', callout.y - 7);
      label.querySelector('text').setAttribute('text-anchor', callout.side === 'left' ? 'start' : 'end');
      label.querySelector('[data-ring-percent]').textContent = percentText(group.percent);
    }
    const note = container.querySelector('.order-ring-unknown');
    note.hidden = !model.unknown; note.textContent = `${model.unknown} 单状态待确认，未计入环图占比`;
    hoverPin.validateSource();
    if (active) { if (!anchor.getClientRects().length) anchor = container.querySelector(`button[data-order-state="${active}"]`); paintPopup(); }
  }
  const hoverPin = mountHoverPinPopup({ popup, controls, onShow: show, onHide: hide });
  list.addEventListener('click', event => { const row = event.target.closest('[data-popup-order-id]'); if (row) onOrderClick(row.dataset.popupOrderId); }, { signal: events.signal });
  view.addEventListener('resize', position, { signal: events.signal });
  view.addEventListener('scroll', position, { capture: true, signal: events.signal });
  update(orders);
  return { update, destroy() { hoverPin.destroy(); events.abort(); popup.remove(); } };
}
