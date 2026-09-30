import { WORK_ORDER_STATUS } from './types.js';
import { ORDER_STAGES as stages, mountOrderStatus } from './order-status.js';

const priorities = { '高': 1, '中': 2, '低': 3 };
const colors = { '高': '#ff5b65', '中': '#ffd05b', '低': '#18c8df' };

export function dashboardOrderQueue(orders) {
  const rank = order => order.status === 'completed' ? 1 : 0;
  return [...orders].sort((a, b) => rank(a) - rank(b)
    || (priorities[a.priority] ?? 4) - (priorities[b.priority] ?? 4)
    || String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))).slice(0, 6);
}

export function mountDashboardOrders(container, orders, onOrderClick, onOpenOrders) {
  const doc = container.ownerDocument;
  const events = new doc.defaultView.AbortController();
  container.innerHTML = `<article class="dash-panel status-panel"><div class="dash-panel-head"><div><span class="panel-code">07 / WORK ORDER STATUS</span><h2>工单状态</h2></div><span class="live-badge" data-order-total></span></div><div class="dashboard-order-status" aria-label="工单状态占比与明细"></div><button type="button" class="dash-wide-link dash-shortcut" data-open-orders><span class="dash-shortcut-label">工单看板 <span aria-hidden="true">→</span></span></button></article><article class="dash-panel dashboard-order-panel"><div class="dash-panel-head"><div><span class="panel-code">08 / WORK ORDER CENTER</span><h2>工单中心</h2></div></div><p class="dashboard-order-hint">优先展示未完成、高优先级工单</p><div class="dashboard-order-list"></div><button type="button" class="dash-wide-link dash-shortcut" data-open-orders><span class="dash-shortcut-label">工单看板 <span aria-hidden="true">→</span></span></button></article>`;
  const statusChart = mountOrderStatus(container.querySelector('.dashboard-order-status'), orders, onOrderClick);
  const list = container.querySelector('.dashboard-order-list');
  function update(nextOrders) {
    container.querySelector('[data-order-total]').textContent = `共 ${nextOrders.length} 单`;
    statusChart.update(nextOrders);
    const existing = new Map([...list.querySelectorAll('button')].map(row => [row.dataset.orderId, row]));
    dashboardOrderQueue(nextOrders).forEach((order, index) => {
      const id = String(order.id);
      let row = existing.get(id);
      if (!row) {
        row = doc.createElement('button'); row.type = 'button'; row.className = 'dashboard-order-row'; row.dataset.orderId = id;
        row.innerHTML = '<span class="dashboard-order-row-top"><b></b><em></em></span><strong></strong><small></small><span class="dashboard-order-row-bottom"><span></span><time></time></span>';
      }
      row.style.setProperty('--priority-color', colors[order.priority] || '#94a0ae');
      row.style.setProperty('--stage-color', stages.find(stage => stage.key === order.status)?.color || '#94a0ae');
      row.querySelector('.dashboard-order-row-top b').textContent = `${order.priority || '未分级'}优先级`;
      row.querySelector('em').textContent = WORK_ORDER_STATUS[order.status] || '状态待确认';
      row.querySelector('strong').textContent = order.title || `工单 ${id}`;
      row.querySelector('small').textContent = order.location || '未提供位置';
      row.querySelector('.dashboard-order-row-bottom span').textContent = `#${id}`;
      row.querySelector('time').textContent = order.occurredAt || '未提供时间';
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      existing.delete(id);
    });
    existing.forEach(row => row.remove());
    list.querySelector('.dash-empty')?.remove();
    if (!nextOrders.length) { const empty = doc.createElement('div'); empty.className = 'dash-empty'; empty.textContent = '暂无工单'; list.append(empty); }
  }
  container.addEventListener('click', event => {
    const row = event.target.closest('[data-order-id]');
    if (row) onOrderClick(row.dataset.orderId);
    if (event.target.closest('[data-open-orders]')) onOpenOrders();
  }, { signal: events.signal });
  update(orders);
  return { update, destroy() { statusChart.destroy(); events.abort(); } };
}
