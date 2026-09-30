import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadCache } from '../web/js/read-cache.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };

test('parallel readers share one request, cached values are isolated, and TTL expires', async () => {
  let calls = 0; let now = 0;
  const cache = createReadCache({load: async () => [{version: ++calls}], scope: () => 'user-a', now: () => now});
  const values = await Promise.all([cache.read('events'), cache.read('events'), cache.read('events')]);
  assert.equal(calls, 1);
  values[0][0].version = 99;
  assert.equal((await cache.read('events'))[0].version, 1);
  now = 1001;
  assert.equal((await cache.read('events'))[0].version, 2);
});

test('write invalidation retries an old in-flight response with a fresh server read', async () => {
  const old = deferred(); let calls = 0; const freshFlags = [];
  const cache = createReadCache({scope: () => 'a', load: async (_key, options) => { freshFlags.push(options.fresh); return ++calls === 1 ? old.promise : ['new']; }});
  const beforeWrite = cache.read('events');
  await Promise.resolve();
  cache.invalidate(['events']);
  const afterWrite = cache.read('events');
  old.resolve(['old']);
  assert.deepEqual(await beforeWrite, ['new']);
  assert.deepEqual(await afterWrite, ['new']);
  assert.deepEqual(freshFlags, [false, true]);
});

test('a failed request is not cached; an empty success is cached', async () => {
  let calls = 0;
  const cache = createReadCache({scope: () => 'a', load: async () => { if (++calls === 1) throw new Error('offline'); return []; }});
  await assert.rejects(cache.read('events'), /offline/);
  assert.deepEqual(await cache.read('events'), []);
  assert.deepEqual(await cache.read('events'), []);
  assert.equal(calls, 2);
});

test('cache entries and in-flight results cannot cross login sessions', async () => {
  let user = 'a'; let calls = 0; const old = deferred();
  const cache = createReadCache({scope: () => user, load: async () => ++calls === 1 ? old.promise : [user]});
  const oldRead = cache.read('events');
  await Promise.resolve(); user = 'b';
  assert.deepEqual(await cache.read('events'), ['b']);
  old.resolve(['a']);
  await assert.rejects(oldRead, /登录状态已变化/);
});

test('invalidating devices preserves independent event cache', async () => {
  const calls = [];
  const cache = createReadCache({scope: () => 'a', load: async key => { calls.push(key); return [key]; }});
  await cache.read('events'); await cache.read('devices');
  cache.invalidate(['devices']);
  await cache.read('events'); await cache.read('devices');
  assert.deepEqual(calls, ['events', 'devices', 'devices']);
});

test('explicit refresh bypasses browser cache and requests a fresh server read', async () => {
  const flags = [];
  const cache = createReadCache({scope: () => 'a', load: async (_key, {fresh}) => { flags.push(fresh); return []; }});
  await cache.read('events'); await cache.read('events', {fresh: true});
  assert.deepEqual(flags, [false, true]);
});

test('explicit refresh supersedes an older in-flight read', async () => {
  const old = deferred(); let calls = 0;
  const cache = createReadCache({scope: () => 'a', load: async () => ++calls === 1 ? old.promise : ['fresh']});
  const pending = cache.read('events'); await Promise.resolve();
  const fresh = cache.read('events', {fresh: true});
  old.resolve(['old']);
  assert.deepEqual(await pending, ['fresh']);
  assert.deepEqual(await fresh, ['fresh']);
  assert.equal(calls, 2);
});

test('dashboard, alerts, orders and devices use three authenticated GET requests per batch', async t => {
  const requests = []; let status = '未处理';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname; requests.push({url, options});
    if (options.method === 'POST') { status = '处理中'; return new Response('{"success":true}'); }
    const data = path === '/api/events' ? [{id: 1, event_type: '道路', process_status: status, is_valid: null, report_time: '2026-09-13 12:00:00'}]
      : path === '/api/devices' ? [{device_id:'a-1', status:'正常'}] : [];
    return new Response(JSON.stringify(data));
  });
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = {getItem: () => '{"token":"test-session"}'};
  t.after(() => { if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage; });
  const {api} = await import('../web/js/api.js?cache-test');
  const [dashboard, alerts, orders, devices] = await Promise.all([api.getDashboard(), api.getAlerts(), api.getWorkOrders(), api.getDevices()]);
  assert.equal(requests.length, 3);
  assert.equal(orders.length, 1); assert.equal(alerts.length, 1); assert.equal(devices.length, 1); assert.equal(dashboard.unprocessed, 1);
  assert.ok(requests.every(({url, options}) => new URL(url).searchParams.get('cache') === 'web' && options.headers.Authorization === 'Bearer test-session'));
  await api.sendWorkOrder('1');
  assert.equal((await api.getWorkOrders())[0].status, 'processing');
  assert.ok(requests.filter(({options}) => !options.method).slice(-2).every(({url}) => new URL(url).searchParams.get('fresh') === '1'));
});
