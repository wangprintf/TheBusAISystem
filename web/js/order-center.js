import { WORK_ORDER_STATUS } from './types.js';

const priorityRank = { '高': 1, '中': 2, '低': 3 };
const statusRank = { pending: 0, processing: 1, review: 2, completed: 3 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function orderQueue(orders, filters = {}) {
  const keyword = (filters.keyword || '').trim().toLocaleLowerCase();
  return orders.filter(order => (!filters.status || order.status === filters.status)
    && (!filters.priority || order.priority === filters.priority)
    && (!filters.date || String(order.occurredAt || '').startsWith(filters.date))
    && (!keyword || [order.id, order.title, order.eventType, order.location, order.licensePlate].some(value => String(value || '').toLocaleLowerCase().includes(keyword))))
    .sort((a, b) => (filters.sort === 'latest' ? 0 : (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4)
      || (priorityRank[a.priority] ?? 4) - (priorityRank[b.priority] ?? 4))
      || String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
}

export function mountOrderCenter(container, initialOrders, { mountDetail, onBlocked }) {
  const events = new container.ownerDocument.defaultView.AbortController();
  const filters = { keyword: '', status: '', priority: '', date: '', sort: 'pending' };
  let orders = initialOrders;
  let selectedId = null;
  let detail;
  container.innerHTML = `<section class="order-center" aria-label="工单中心">
    <aside class="order-queue" aria-label="报警处置队列">
      <header class="order-queue-head"><div><h3>报警处置队列</h3><p>未处理与高等级报警优先</p></div><span class="order-queue-count" data-queue-count></span></header>
      <div class="order-queue-tools"><input type="search" data-queue-filter="keyword" aria-label="搜索事件或区域" placeholder="搜索事件 / 区域 / 工单号"><select data-queue-filter="sort" aria-label="工单排序"><option value="pending">未处理优先</option><option value="latest">最新上报优先</option></select></div>
      <div class="order-queue-status" aria-label="按处置状态筛选">${[['', '全部'], ...Object.entries(WORK_ORDER_STATUS)].map(([key, label]) => `<button type="button" data-queue-status="${key}" aria-pressed="${!key}">${label}<b data-status-count="${key}"></b></button>`).join('')}</div>
      <div class="order-queue-filters"><label>日期<input type="date" data-queue-filter="date" aria-label="上报日期"></label><label>等级<select data-queue-filter="priority" aria-label="优先级筛选"><option value="">全部等级</option>${Object.keys(priorityRank).map(priority => `<option>${priority}</option>`).join('')}</select></label><button type="button" data-queue-reset>重置</button></div>
      <div class="order-queue-columns" aria-hidden="true"><span>事件</span><span>区域</span><span>时间</span><span>等级</span><span>状态</span></div>
      <div class="order-queue-list" role="group" aria-label="事件列表"></div>
      <footer class="order-queue-footer">点击左侧事件，查看工单详情<span data-queue-visible></span></footer>
    </aside>
    <div class="order-center-detail" aria-label="当前工单详情"></div>
  </section>`;
  const list = container.querySelector('.order-queue-list');
  const detailRoot = container.querySelector('.order-center-detail');
  function canChange() {
    if (!detail?.isBusy()) return true;
    onBlocked();
    return false;
  }
  function select(order, force = false) {
    const id = order ? String(order.id) : null;
    if (!force && selectedId === id) return;
    detail?.destroy();
    detail = null;
    selectedId = id;
    list.querySelectorAll('[data-queue-order]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.queueOrder === id)));
    detailRoot.scrollTop = 0;
    if (order) detail = mountDetail(order, detailRoot);
    else detailRoot.innerHTML = '<div class="order-center-empty"><span>暂无工单详情</span><p>当前没有符合条件的工单，请调整筛选条件。</p></div>';
  }
  function paint(force = false) {
    const visible = orderQueue(orders, filters);
    const scrollTop = list.scrollTop;
    container.querySelector('[data-queue-count]').textContent = `${orders.length} 条`;
    container.querySelector('[data-queue-visible]').textContent = `显示 ${visible.length} 条`;
    container.querySelectorAll('[data-queue-status]').forEach(button => {
      const status = button.dataset.queueStatus;
      button.setAttribute('aria-pressed', String(status === filters.status));
      button.querySelector('b').textContent = status ? orders.filter(order => order.status === status).length : orders.length;
    });
    list.innerHTML = visible.map(order => `<button type="button" class="order-queue-row${order.priority === '高' ? ' is-urgent' : ''}" data-queue-order="${esc(order.id)}" aria-pressed="${String(order.id) === selectedId}" aria-label="查看事件 ${esc(order.id)}：${esc(order.title)}" title="${esc(order.title)} · ${esc(order.location)} · ${esc(order.occurredAt)}">
      <span class="queue-event">${esc(String(order.title || order.eventType || '未命名事件').split(/[·•]/).at(-1).trim())}</span><span>${esc(order.location || '位置暂缺')}</span><time datetime="${esc(String(order.occurredAt || '').replace(' ', 'T'))}">${esc(String(order.occurredAt || '').slice(0, 10) || '暂无时间')}</time><span class="queue-priority priority-${priorityRank[order.priority] ?? 4}">${esc(order.priority || '—')}</span><span class="queue-stage stage-${statusRank[order.status] ?? 4}">${esc(WORK_ORDER_STATUS[order.status] || order.processStatus || '未知')}</span>
    </button>`).join('') || '<p class="order-queue-empty">没有匹配的事件</p>';
    list.scrollTop = scrollTop;
    const selected = visible.find(order => String(order.id) === selectedId) || visible[0];
    select(selected, force || !detail);
  }
  list.addEventListener('click', event => {
    const row = event.target.closest('[data-queue-order]');
    if (!row || row.dataset.queueOrder === selectedId || !canChange()) return;
    select(orders.find(order => String(order.id) === row.dataset.queueOrder));
  }, { signal: events.signal });
  container.querySelectorAll('[data-queue-filter]').forEach(input => input.addEventListener(input.type === 'search' ? 'input' : 'change', () => {
    const key = input.dataset.queueFilter;
    if (!canChange()) { input.value = filters[key]; return; }
    filters[key] = input.value;
    list.scrollTop = 0;
    paint();
  }, { signal: events.signal }));
  container.querySelectorAll('[data-queue-status]').forEach(button => button.addEventListener('click', () => {
    if (!canChange()) return;
    filters.status = button.dataset.queueStatus;
    list.scrollTop = 0;
    paint();
  }, { signal: events.signal }));
  container.querySelector('[data-queue-reset]').addEventListener('click', () => {
    if (!canChange()) return;
    Object.assign(filters, { keyword: '', status: '', priority: '', date: '', sort: 'pending' });
    container.querySelectorAll('[data-queue-filter]').forEach(input => { input.value = filters[input.dataset.queueFilter]; });
    list.scrollTop = 0;
    paint();
  }, { signal: events.signal });
  paint(true);
  return {
    container,
    isBusy: () => Boolean(detail?.isBusy()),
    update(nextOrders) { if (!canChange()) return; orders = nextOrders; paint(true); },
    destroy() { detail?.destroy(); events.abort(); },
  };
}
