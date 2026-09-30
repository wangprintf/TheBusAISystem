import test from 'node:test';
import assert from 'node:assert/strict';
import { finishMediaType, FINISH_FILE_LIMIT, uploadFinishFile, createUploadId, prepareFinishFile, isProcessingStatus, mountFinishUpload } from '../web/js/finish-upload.js';

const png = { name: '现场 图片.jpg', type: 'image/jpeg', size: 100 };
test('only processing events can upload finish media', () => {
  assert.equal(isProcessingStatus('processing'), true);
  assert.equal(isProcessingStatus('处理中'), true);
  for (const status of ['pending', 'review', 'completed', '未处理', '待审核', '已完成', '', null, undefined]) {
    assert.equal(isProcessingStatus(status), false, `status ${status} must stay upload-disabled`);
  }
});
test('non-processing upload mounts as a blocked state without a file picker', () => {
  const container = { ownerDocument: { defaultView: { AbortController } }, innerHTML: '', replaceChildren() {} };
  const controller = mountFinishUpload(container, { canUpload: false });
  assert.match(container.innerHTML, /仅处理中的事件可上传图片和视频/);
  assert.equal(controller.isBusy(), false);
});
test('upload ids are unique UUIDs without requiring the secure-context randomUUID API', () => {
  const ids = Array.from({ length: 100 }, createUploadId);
  assert.equal(new Set(ids).size, 100);
  ids.forEach(id => assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});
function transport(status = 200, response = { success: true, key: 'web/12/12.uuid.png', url: 'https://finish.example/web/12/12.uuid.png' }) {
  return { upload: {}, headers: {}, open(method, url) { this.method = method; this.url = url; }, setRequestHeader(name, value) { this.headers[name] = value; }, send(body) { this.body = body; queueMicrotask(() => { this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 }); this.status = status; this.responseText = JSON.stringify(response); this.onload(); }); } };
}
test('validates media type and size before transfer, including files without browser MIME', () => {
  assert.equal(finishMediaType(png), 'image/jpeg');
  assert.equal(finishMediaType({ name: 'a.PNG', type: '', size: 1 }), 'image/png');
  assert.throws(() => finishMediaType({ name: 'a.MOV', type: '', size: 1 }), /MP4/);
  assert.equal(finishMediaType({ name: 'a.m4v', type: 'video/mp4', size: 1 }), 'video/x-m4v');
  for (const file of [{ ...png, size: 0 }, { ...png, size: FINISH_FILE_LIMIT + 1 }, { ...png, name: 'a.svg' }, { ...png, type: 'text/html' }]) assert.throws(() => finishMediaType(file));
});
test('uploads the file directly to COS without sending it to an application upload endpoint', async () => {
  const xhr = transport(); const progress = [];
  const result = await uploadFinishFile({ baseUrl: 'https://api.example', token: 'test-token', orderId: '12', file: png, uploadId: 'same-id-on-retry', onProgress: value => progress.push(value), xhrFactory: () => xhr });
  assert.equal(xhr.method, 'PUT');
  assert.match(new URL(xhr.url).hostname, /cos\.ap-beijing\.myqcloud\.com$/);
  assert.doesNotMatch(xhr.url, /api\.example|\/api\/events\/finish\/upload/);
  assert.match(new URL(xhr.url).pathname, /\/12\.same-id-on-retry\.jpg$/);
  assert.match(new URL(xhr.url).search, /q-signature=/);
  assert.equal(xhr.headers['Content-Type'], 'image/jpeg');
  assert.equal(xhr.body, png);
  assert.deepEqual(progress, [99, 100]);
  assert.equal(result.kind, 'image');
});
test('COS failures are not reported as success, and retry keeps the upload id', async () => {
  const xhr = transport(503, { error: 'COS 上传暂未成功，请重试' });
  const options = { baseUrl: 'https://api.example', token: 'test', orderId: '12', file: png, uploadId: 'stable', xhrFactory: () => xhr };
  await assert.rejects(uploadFinishFile(options), /COS 上传失败/);
  const next = transport();
  await uploadFinishFile({ ...options, xhrFactory: () => next });
  assert.equal(new URL(xhr.url).pathname, new URL(next.url).pathname);
});
test('video uses the same binary transfer and returns a playable video media entry', async () => {
  const xhr = transport(200, { success: true, key: 'web/12/test.mp4', url: 'https://finish.example/web/12/test.mp4?signed=preview' });
  const video = { name: '处理结果.mp4', type: 'video/mp4', size: 1024 };
  const result = await uploadFinishFile({ baseUrl: 'https://api.example', token: 'test', orderId: '12', file: video, uploadId: createUploadId(), xhrFactory: () => xhr });
  assert.equal(xhr.body, video); assert.equal(xhr.headers['Content-Type'], 'video/mp4');
  assert.equal(result.kind, 'video'); assert.match(result.url, /\.mp4\?q-sign-algorithm=/);
});
test('login, missing deployment, network and timeout errors explain the actionable failure', async () => {
  const options = { baseUrl: 'https://api.example', token: 'test', orderId: '12', file: png, uploadId: 'stable' };
  await assert.rejects(uploadFinishFile({ ...options, token: '' }), /登录已失效/);
  for (const [status, message] of [[401, /COS 上传失败/], [404, /COS 上传失败/], [405, /COS 上传失败/]]) await assert.rejects(uploadFinishFile({ ...options, xhrFactory: () => transport(status, {}) }), message);
  for (const [handler, message] of [['onerror', /COS 直传失败.*CORS/], ['ontimeout', /上传超时/]]) {
    const xhr = transport(); xhr.send = () => queueMicrotask(() => xhr[handler]());
    await assert.rejects(uploadFinishFile({ ...options, xhrFactory: () => xhr }), message);
  }
});

test('a network failure identifies the actual page origin including its port', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location; });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'http://127.0.0.1:5500', protocol: 'http:' } });
  const xhr = transport();
  xhr.send = () => queueMicrotask(() => xhr.onerror());
  await assert.rejects(uploadFinishFile({ token: 'test', orderId: '12', file: png, uploadId: 'local-origin', xhrFactory: () => xhr }), /http:\/\/127\.0\.0\.1:5500（含端口）/);
});

test('a COS rejection shows the returned service error code', async () => {
  const xhr = transport();
  xhr.send = () => queueMicrotask(() => { xhr.status = 403; xhr.responseText = '<Error><Code>SignatureDoesNotMatch</Code></Error>'; xhr.onload(); });
  await assert.rejects(uploadFinishFile({ token: 'test', orderId: '12', file: png, uploadId: 'bad-signature', xhrFactory: () => xhr }), /403 · SignatureDoesNotMatch/);
});

test('PNG conversion sends JPEG bytes and preserves original file on the computer', async t => {
  const original = { name: '透明.png', type: 'image/png', size: 10 };
  const converted = new Blob(['jpeg-test'], { type: 'image/jpeg' });
  let closed = false, filled = false, drawn = false;
  const oldBitmap = globalThis.createImageBitmap, oldDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 10, height: 20, close() { closed = true; } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    getContext: () => ({ fillRect() { filled = true; }, drawImage() { drawn = true; } }),
    toBlob(callback, type) { assert.equal(type, 'image/jpeg'); callback(converted); },
  }) } });
  const prepared = await prepareFinishFile(original);
  assert.equal(prepared.type, 'image/jpeg');
  assert.equal(prepared.body, converted);
  assert.ok(closed && filled && drawn);
  assert.equal(original.type, 'image/png');
  const xhr = transport();
  await uploadFinishFile({ token: 'test', orderId: '12', file: original, uploadId: createUploadId(), xhrFactory: () => xhr });
  assert.equal(xhr.body, converted);
  assert.equal(xhr.headers['Content-Type'], 'image/jpeg');
  globalThis.createImageBitmap = oldBitmap;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument });
});
