import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrderAssignmentSync } from '../web/js/order-assignment-sync.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function documentFixture() {
  const doc = new EventTarget();
  doc.hidden = false;
  return doc;
}

test('an assignment written after dispatch reaches the open detail without a manual refresh', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => '{"token":"assignment-session"}' };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  });
  const event = { id: '202609220152', process_status: '未处理', is_valid: null, media_url: 'https://example.test/alarm.jpg' };
  let matchId = null;
  let failure = false;
  let malformed = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), options });
    if (options.method === 'POST') {
      Object.assign(event, Object.fromEntries(options.body));
      return Response.json({ success: true });
    }
    if (new URL(url).pathname === '/api/events') return Response.json([event]);
    if (failure) throw new Error('temporary network failure');
    if (malformed) return Response.json({ error: 'bad response' });
    // A stale server snapshot still contains no assignee unless fresh=1 is set.
    return Response.json([{ id: event.id, match_id: new URL(url).searchParams.get('fresh') === '1' ? matchId : null, media_url: 'https://example.test/finished.mp4' }]);
  });
  const { api } = await import('../web/js/api.js?assignment-sync');
  await api.sendWorkOrder(event.id);
  const [order] = await api.getWorkOrders();
  assert.equal(order.assignee, '待分配');
  assert.equal(order.status, 'processing');
  const media = order.processedMedia;
  const alarm = order.alertMedia;
  const sync = startOrderAssignmentSync({ orderId: order.id, doc: documentFixture(), isActive: () => true,
    load: () => api.getWorkOrderAssignments(), onUpdate: ({ matchId, assignee }) => Object.assign(order, { matchId, assignee }) });
  t.after(() => sync.destroy());
  await flush();
  const readsBeforeTick = requests.length;
  matchId = 258438;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(order.assignee, '赵文丽');
  assert.equal(order.matchId, '258438');
  assert.equal(order.processedMedia, media);
  assert.equal(order.alertMedia, alarm);
  assert.equal(order.status, 'processing');
  assert.equal(requests.length, readsBeforeTick + 1);
  assert.equal(requests.at(-1).url.pathname, '/api/events/finish');
  assert.equal(requests.at(-1).url.searchParams.get('fresh'), '1');
  assert.equal(requests.at(-1).options.cache, 'no-store');
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer assignment-session');
  failure = true;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(order.assignee, '赵文丽');
  failure = false;
  malformed = true;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(order.assignee, '赵文丽');
  malformed = false;
  matchId = '734129';
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(order.assignee, '王丽');
  matchId = null;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(order.assignee, '待分配');
});

test('hidden pages pause reads and returning to the tab refreshes immediately', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const doc = documentFixture();
  doc.hidden = true;
  let reads = 0;
  const updates = [];
  const sync = startOrderAssignmentSync({ orderId: 'A', doc, isActive: () => true,
    load: async () => { reads++; return []; }, onUpdate: value => updates.push(value) });
  t.after(() => sync.destroy());
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(reads, 0);
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(reads, 1);
  assert.deepEqual(updates, [{ matchId: null, assignee: '待分配' }]);
  sync.destroy();
  doc.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(reads, 1);
});

test('slow requests never overlap and responses cannot update a replaced detail', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let active = true;
  let reads = 0;
  let release;
  const updates = [];
  const doc = documentFixture();
  const sync = startOrderAssignmentSync({ orderId: 'A', doc, isActive: () => active,
    load: () => { reads++; return new Promise(resolve => { release = resolve; }); },
    onUpdate: value => updates.push(value) });
  t.after(() => sync.destroy());
  t.mock.timers.tick(15000);
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(reads, 1);
  active = false;
  release([{ id: 'A', matchId: '258438', assignee: '赵文丽' }]);
  await flush();
  t.mock.timers.tick(10000);
  assert.deepEqual(updates, []);
  assert.equal(reads, 1);
});

test('closing a detail discards its in-flight response', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release;
  const updates = [];
  const sync = startOrderAssignmentSync({ orderId: 'A', doc: documentFixture(), isActive: () => true,
    load: () => new Promise(resolve => { release = resolve; }), onUpdate: value => updates.push(value) });
  sync.destroy();
  release([{ id: 'A', matchId: '258438', assignee: '赵文丽' }]);
  await flush();
  assert.deepEqual(updates, []);
});
