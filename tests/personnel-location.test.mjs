import test from 'node:test';
import assert from 'node:assert/strict';
import { personnelLocations, avatarText, personnelPinSource } from '../web/js/personnel-location.js';

const session = { accountId: '1001', name: '张丽', department: '路政' };
const rows = [
  { id: '1002', latitude: '40', longitude: '118', status: '1' },
  { id: 1001, latitude: '39.068637', longitude: '117.107211', laocation_time: '2026-09-29 18:43:59+08', status: '1' },
];

test('every account sees all personnel, with each identity derived from its own data', () => {
  const people = personnelLocations(rows, session);
  assert.equal(people.length, 2);
  const person = people.find(item => item.accountId === '1001');
  assert.equal(person.accountId, '1001');
  assert.equal(person.latitude, 39.068637);
  assert.equal(person.longitude, 117.107211);
  assert.equal(person.locatedAt, rows[1].laocation_time);
  assert.equal(person.status, 'online');
  assert.equal(avatarText(person), '丽');
  assert.equal(person.isCurrent, true);
  assert.equal(people[0].name, '未登记姓名');
  assert.equal(people[0].avatar, '待');
  assert.equal(people[0].isCurrent, false);
  const secondLogin = personnelLocations(rows, { accountId: '1002', name: '李波' });
  assert.deepEqual(secondLogin.map(item => item.accountId), people.map(item => item.accountId));
  assert.equal(secondLogin[0].avatar, '波');
  assert.equal(secondLogin[1].name, '未登记姓名');
  assert.equal(personnelLocations([{ ...rows[0], name: '张华', department: '交警' }], session)[0].avatar, '华');
});

test('missing and invalid coordinates are excluded without filtering valid offline or other personnel', () => {
  assert.equal(personnelLocations(rows, {}).length, 2);
  assert.equal(personnelLocations(rows, { accountId: 'unknown' }).length, 2);
  for (const latitude of [null, '', ' ', 0, 'NaN', '91']) {
    assert.deepEqual(personnelLocations([{ ...rows[1], latitude }], session), []);
  }
  assert.deepEqual(personnelLocations([{ id: '1001', ip: '81.70.233.75' }], session), []);
  assert.equal(personnelLocations([{ ...rows[1], status: '0' }], session)[0].status, 'offline');
});

test('the system account 100000 is excluded from personnel locations', () => {
  const people = personnelLocations([
    ...rows,
    { id: '100000', latitude: '39.056841', longitude: '117.144276', status: '1', name: '未登记姓名' },
  ], session);
  assert.deepEqual(people.map(person => person.accountId), ['1002', '1001']);
  assert.equal(people.some(person => person.accountId === '100000'), false);
});

test('compact pin uses a name initial instead of numeric initials and escapes SVG content', () => {
  assert.match(decodeURIComponent(personnelPinSource({ name: '李有才', avatar: '56', status: 'online' })), />才<\/text>/);
  assert.match(decodeURIComponent(personnelPinSource({ name: '<', status: 'offline' })), />&lt;<\/text>/);
  assert.equal(avatarText({ name: '  ' }), '用');
});

test('all logins resolve verified database names including the corrected account ID; live names take precedence', () => {
  const locations = ['123456', '223344', '734129', '258438', 'unknown'].map(id => ({ id, latitude: 39, longitude: 117 }));
  const expected = ['李有才', '刘文鸿', '王丽', '赵文丽', '未登记姓名'];
  assert.deepEqual(personnelLocations(locations, {}).map(person => person.name), expected);
  assert.deepEqual(personnelLocations(locations, { accountId: '823625', name: '李波' }).map(person => person.name), expected);
  assert.equal(personnelLocations(locations, { accountId: '734129', name: '实时姓名' })[2].name, '实时姓名');
  assert.equal(personnelLocations([{ ...locations[2], name: '接口姓名' }], { accountId: '734129', name: '登录姓名' })[0].name, '接口姓名');
  assert.ok(personnelLocations(locations, {}).every(person => !/\d/.test(person.avatar)));
});

test('personnel reads avoid the deployed broken cache endpoint, stay fresh, and reject an account change in flight', async t => {
  const previousStorage = globalThis.sessionStorage;
  let auth = { ...session, token: 'token-one' };
  globalThis.sessionStorage = { getItem: () => JSON.stringify(auth) };
  t.after(() => { if (previousStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStorage; });
  const requests = [];
  let release;
  let waitForResponse = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    // Production's cached personnel route returns 500; the direct route works.
    if (new URL(url).searchParams.has('cache')) return Response.json({ error: '服务器内部错误' }, { status: 500 });
    if (waitForResponse) await new Promise(resolve => { release = resolve; });
    return Response.json(rows);
  });
  const { api } = await import('../web/js/api.js?personnel-test');
  assert.equal((await api.getPersonnelLocations()).find(person => person.accountId === '1001').name, '张丽');
  assert.match(requests[0].url, /\/api\/personnel$/);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-one');
  const previousLatitude = rows[1].latitude;
  rows[1].latitude = '39.08';
  assert.equal((await api.getPersonnelLocations()).find(person => person.accountId === '1001').latitude, 39.08);
  rows[1].latitude = previousLatitude;
  auth = { accountId: '1002', name: '李波', token: 'token-two' };
  const secondLogin = await api.getPersonnelLocations();
  assert.equal(secondLogin.length, 2);
  assert.equal(secondLogin[0].latitude, 40);
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer token-two');
  waitForResponse = true;
  const pending = api.getPersonnelLocations();
  await new Promise(resolve => setImmediate(resolve));
  auth = { ...session, token: 'token-three' };
  release();
  await assert.rejects(pending, /登录状态已变化/);
});
