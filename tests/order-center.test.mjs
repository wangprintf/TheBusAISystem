import test from 'node:test';
import assert from 'node:assert/strict';
import { orderQueue } from '../web/js/order-center.js';

const orders = [
  { id: '1', title: '共享单车占道停放', location: '人民路', status: 'processing', priority: '高', occurredAt: '2026-09-22 08:00:00' },
  { id: '2', title: '护栏倾倒', location: '南京路', status: 'pending', priority: '中', occurredAt: '2026-09-22 09:00:00' },
  { id: '3', title: '道路积水', location: '人民路', status: 'pending', priority: '高', occurredAt: '2026-09-21 08:00:00' },
  { id: '4', title: '路面坑洼', location: '人民路', status: 'pending', priority: '高', occurredAt: '2026-09-22 10:00:00' },
  { id: '5', title: '设施损坏', status: 'completed', priority: '高', occurredAt: '2026-09-23 10:00:00' },
];

test('queue prioritizes pending work, then urgency and latest time, without changing source order', () => {
  assert.deepEqual(orderQueue(orders).map(order => order.id), ['4', '3', '2', '1', '5']);
  assert.deepEqual(orders.map(order => order.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(orderQueue(orders, { sort: 'latest' }).map(order => order.id), ['5', '4', '2', '1', '3']);
});

test('search and filters compose and handle empty records', () => {
  assert.deepEqual(orderQueue(orders, { keyword: ' 人民 ', status: 'pending', priority: '高', date: '2026-09-22' }).map(order => order.id), ['4']);
  assert.equal(orderQueue(orders, { keyword: '共享单车' })[0].id, '1');
  assert.deepEqual(orderQueue(orders, { keyword: '不存在' }), []);
  assert.deepEqual(orderQueue([], { status: 'pending' }), []);
  assert.equal(orderQueue([{ id: 'missing' }]).length, 1);
});
