import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer, objectKey } from '../server/web-finish-server.mjs';
import { authorization, COS_HOST, createCosWriter } from '../server/finish-cos.mjs';

const jpg = Buffer.from([255, 216, 255, 224, 0, 0, 0, 0]);
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'finish-test-'));
  const writes = [], reads = [];
  const server = createWebServer({ temporaryRoot: directory,
    fetchImpl: async (url, options) => { reads.push({ url, options }); return new Response('[]'); },
    writeObject: async args => { writes.push({ ...args, bytes: await readFile(args.filePath) }); return `https://${COS_HOST}/${args.key}?preview=1`; },
    ...overrides,
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { directory, writes, reads, base, send: (body = jpg, options = {}) => fetch(`${base}/api/events/finish/upload?id=12`, { method: 'POST', headers: { Authorization: 'Bearer local-test', 'Content-Type': 'image/jpeg' }, body, ...options }) };
}

test('upload writes only COS, preserves scanner prefix and cleans temporary data', async t => {
  const f = await fixture(t);
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].options.method, undefined); // GET session validation only
  assert.match(f.reads[0].url, /\/api\/events\/finish$/);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].bytes, jpg);
  assert.match(f.writes[0].key, /^\/12\.[0-9a-f-]+\.jpg$/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await readdir(f.directory), []);
});

test('bad sessions, mismatched bytes, unsupported media and empty files never reach COS', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(jpg, { headers: { 'Content-Type': 'image/jpeg' } })).status, 401);
  assert.equal((await f.send(Buffer.from('fake jpg'))).status, 415);
  assert.equal((await f.send(Buffer.alloc(0))).status, 400);
  assert.equal((await f.send(jpg, { headers: { Authorization: 'Bearer local-test', 'Content-Type': 'image/png' } })).status, 415);
  assert.equal(f.writes.length, 0);
  const denied = await fixture(t, { fetchImpl: async () => new Response('{}', { status: 401 }) });
  assert.equal((await denied.send()).status, 401);
  assert.equal(denied.writes.length, 0);
});

test('COS failure is visible and staging is removed; video is accepted', async t => {
  const f = await fixture(t, { writeObject: async () => { throw new Error('simulated failure'); } });
  assert.equal((await f.send()).status, 503);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await readdir(f.directory), []);
  const video = await fixture(t);
  const res = await video.send(Buffer.from('0000ftypisom0000'), { headers: { Authorization: 'Bearer local-test', 'Content-Type': 'video/mp4' } });
  assert.equal(res.status, 200);
  assert.match(video.writes[0].key, /\.mp4$/);
});

test('web server serves only public web files and rejects cross-origin uploads', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/')).status, 200);
  for (const path of ['/server/finish-cos.mjs', '/SecretKey.csv', '/%2e%2e%2fpackage.json', '/api/unknown']) assert.equal((await fetch(f.base + path)).status, 404);
  assert.equal((await f.send(jpg, { headers: { Authorization: 'Bearer local-test', 'Content-Type': 'image/jpeg', Origin: 'https://foreign.example' } })).status, 403);
});

test('COS signing binds method and path; keys remain unique and scanner-compatible', () => {
  const options = { method: 'PUT', pathname: '//12.a.jpg', secretId: 'test-id', secretKey: 'test-secret', now: 1700000000000 };
  const signed = authorization(options);
  assert.match(signed, /q-header-list=host/);
  assert.ok(!signed.includes('test-secret'));
  assert.notEqual(signed, authorization({ ...options, method: 'GET' }));
  assert.notEqual(signed, authorization({ ...options, pathname: '//13.a.jpg' }));
  const keys = Array.from({ length: 100 }, () => objectKey('12', 'image/jpeg'));
  assert.equal(new Set(keys).size, 100);
  for (const key of keys) {
    assert.ok(key.startsWith('/'));
    assert.equal(key.split('/').at(-1).split('.')[0], '12');
  }
  assert.throws(() => createCosWriter({}), /服务/);
});
