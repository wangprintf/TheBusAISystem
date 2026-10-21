import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderStatus } from '../web/js/order-status.js';
import { orderQueue } from '../web/js/order-center.js';

async function fixture(t, rows, finishRows = []) {
  const requests = [];
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => '{"token":"mapping-test"}' };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      const fields = Object.fromEntries(options.body);
      Object.assign(rows.find(row => String(row.id) === fields.id), fields);
      return Response.json({ success: true });
    }
    return Response.json(new URL(url).pathname === '/api/events' ? rows : finishRows);
  });
  const { api } = await import(`../web/js/api.js?mapping=${encodeURIComponent(t.name)}`);
  return { api, requests };
}

test('database review stage appears in the dashboard and review queue with NULL validity', async t => {
  const { api } = await fixture(t, [
    { id: '202609220028', process_status: '待审核', is_valid: null },
    { id: 'pending', process_status: '未处理', is_valid: null },
    { id: 'processing', process_status: '处理中', is_valid: '1' },
    { id: 'done', process_status: '已完成', is_valid: null },
    { id: 'invalid', process_status: '未处理', is_valid: '0' },
  ]);
  const [orders, dashboard] = await Promise.all([api.getWorkOrders(), api.getDashboard()]);
  assert.deepEqual(orderQueue(orders, { status: 'review' }).map(order => order.id), ['202609220028']);
  assert.equal(orders.find(order => order.id === '202609220028').reviewStatus, null);
  assert.equal(orders.find(order => order.id === 'done').status, 'completed');
  assert.equal(orders.some(order => order.id === 'invalid'), false);
  assert.deepEqual(buildOrderStatus(orders).groups.map(group => group.count), [1, 1, 1, 1]);
  assert.deepEqual([dashboard.unprocessed, dashboard.processing, dashboard.review, dashboard.completed], [1, 1, 1, 1]);
  assert.equal(dashboard.pendingOrders, 1);
});

test('work order details expose assigned personnel from finish match_id without changing event fields', async t => {
  const rows = [
    { id: 'unassigned', process_status: '未处理', is_valid: null, event_type: '道路安全' },
    { id: 'assigned', process_status: '处理中', is_valid: null, event_type: '道路安全' },
    { id: 'unknown-assignee', process_status: '已完成', is_valid: null, event_type: '道路安全' },
  ];
  const { api } = await fixture(t, rows, [
    { id: 'unassigned', media_url: '', is_valid: null, match_id: null },
    { id: 'assigned', media_url: '', is_valid: null, match_id: '258438' },
    { id: 'unknown-assignee', media_url: '', is_valid: null, match_id: '999999' },
  ]);
  const orders = await api.getWorkOrders();
  assert.deepEqual(orders.map(order => order.assignee), ['待分配', '赵文丽', '未登记姓名']);
  assert.deepEqual(orders.map(order => order.matchId), [null, '258438', '999999']);
  assert.deepEqual(orders.map(order => order.status), ['pending', 'processing', 'completed']);
  assert.deepEqual(orders.map(order => order.eventType), ['道路安全', '道路安全', '道路安全']);
});

test('a finish read failure is visible without masking the event or processed media fields', async t => {
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => '{"token":"mapping-test"}' };
  t.after(() => { if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage; });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).pathname === '/api/events/finish') throw new Error('finish unavailable');
    return Response.json([{ id: 'finish-error', process_status: '处理中', is_valid: null, event_type: '道路安全', processed_media_url: 'https://example.test/processed.jpg' }]);
  });
  const { api } = await import(`../web/js/api.js?mapping-finish-error=${encodeURIComponent(t.name)}`);
  const [order] = await api.getWorkOrders();
  assert.equal(order.assignee, '读取失败');
  assert.equal(order.processedMediaLoadFailed, true);
  assert.equal(order.matchId, null);
  assert.equal(order.status, 'processing');
  assert.equal(order.processedMedia[0].url, 'https://example.test/processed.jpg');
});

test('database progress is independent from validity and supports documented legacy values', async t => {
  const { api } = await fixture(t, [
    { id: 'review-valid', process_status: ' 待审核 ', is_valid: '1' },
    { id: 'review-blank', process_status: '待审核', is_valid: ' ' },
    { id: 'review-unset', process_status: '待审核', is_valid: '-1' },
    { id: 'legacy-pending', process_status: 0, is_valid: null },
    { id: 'legacy-done', process_status: '1', is_valid: null },
    { id: 'blank-progress', process_status: null, is_valid: null },
    { id: 'unknown', process_status: '已挂起', is_valid: null },
  ]);
  const orders = await api.getWorkOrders();
  assert.deepEqual(orders.map(order => order.status), ['review', 'review', 'review', 'pending', 'completed', 'pending', 'unknown']);
  assert.equal(orders[1].reviewStatus, null);
  assert.equal(orders[2].reviewStatus, null);
  assert.equal(buildOrderStatus(orders).unknown, 1);
});

test('approving an explicit review order advances its database progress and refreshes the counts', async t => {
  const { api, requests } = await fixture(t, [{ id: '202609220028', process_status: '待审核', is_valid: null }]);
  assert.equal((await api.getWorkOrders())[0].status, 'review');
  await api.reviewWorkOrder('202609220028', 1, '', '合格', 'review');
  const write = requests.find(request => request.options.method === 'POST');
  assert.equal(write.options.body.get('process_status'), '已完成');
  assert.equal(write.options.body.get('is_valid'), '1');
  const orders = await api.getWorkOrders();
  assert.equal(orders[0].status, 'completed');
  assert.equal((await api.getDashboard()).review, 0);
});

test('marking an unprocessed event invalid does not mark it completed', async t => {
  const { api, requests } = await fixture(t, [{ id: 'invalid', process_status: '未处理', is_valid: null }]);
  await api.reviewWorkOrder('invalid', 0, '', '无效', 'pending');
  assert.equal(requests[0].options.body.has('process_status'), false);
  assert.deepEqual(await api.getWorkOrders(), []);
});

test('a failed review is persisted as pending and stays visible through resend, rereview and approval', async t => {
  const rows = [{ id: '202609220128', process_status: '待审核', is_valid: null, remarks: '原始备注' }];
  const { api, requests } = await fixture(t, rows);
  await api.reviewWorkOrder('202609220128', 0, rows[0].remarks, '不合格', 'review');
  const fields = requests[0].options.body;
  assert.equal(fields.get('process_status'), '未处理');
  assert.equal(fields.get('is_valid'), '0');
  assert.match(fields.get('remarks'), /^原始备注；.*人工判定\/审核结果：不合格$/);
  api.invalidateReads();
  let orders = await api.getWorkOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'pending');
  assert.equal(orders[0].reviewStatus, 0);
  assert.deepEqual(orderQueue(orders, { status: 'pending' }).map(order => order.id), ['202609220128']);
  assert.equal((await api.getAlerts())[0].status, 'pending');
  const dashboard = await api.getDashboard();
  assert.deepEqual([dashboard.pendingOrders, dashboard.review, dashboard.completed], [1, 0, 0]);

  await api.sendWorkOrder('202609220128', orders[0].remarks);
  orders = await api.getWorkOrders();
  assert.equal(orders[0].status, 'processing');
  assert.equal((await api.getAlerts())[0].status, 'dispatched');

  rows[0].process_status = '待审核';
  api.invalidateReads();
  orders = await api.getWorkOrders();
  assert.equal(orders[0].status, 'review');
  await api.reviewWorkOrder('202609220128', 1, orders[0].remarks, '合格', 'review');
  orders = await api.getWorkOrders();
  assert.equal(orders[0].status, 'completed');
  assert.equal(orders[0].reviewStatus, 1);
  assert.equal((await api.getDashboard()).completed, 1);
});

test('a later invalid-event decision removes a returned order instead of reviving it from old review history', async t => {
  const { api } = await fixture(t, [{ id: '202609220128', process_status: '待审核', is_valid: null }]);
  await api.reviewWorkOrder('202609220128', 0, '', '不合格', 'review');
  const [returnedOrder] = await api.getWorkOrders();
  await api.reviewWorkOrder(returnedOrder.id, 0, returnedOrder.remarks, '无效', 'pending');
  assert.deepEqual(await api.getWorkOrders(), []);
  assert.equal((await api.getDashboard()).pendingOrders, 0);
  assert.equal((await api.getAlerts())[0].status, 'false');
});
