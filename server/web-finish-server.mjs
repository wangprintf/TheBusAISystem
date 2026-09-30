import { createServer } from 'node:http';
import { open, mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { API_CONFIG } from '../web/js/config.js';
import { createCosWriter } from './finish-cos.mjs';

export const MAX_BYTES = 200 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Existing COSDemo lists prefix "/" and groups JPG/MP4 by the first filename dot.
export function objectKey(id, contentType) {
  return `/${id}.${randomUUID()}.${contentType === 'image/jpeg' ? 'jpg' : 'mp4'}`;
}

export function createWebServer({
  webRoot = resolve(import.meta.dirname, '../web'),
  upstream = API_CONFIG.baseUrl,
  writeObject,
  fetchImpl = fetch,
  temporaryRoot = tmpdir(),
} = {}) {
  let active = 0;
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '仅支持 GET' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, service: 'web-upload' }));
    }
    if (url.pathname === '/api/events/finish/upload') {
      if (req.method !== 'POST') return json(res, 405, { error: '仅支持 POST 上传' });
      // Same-origin endpoint; do not expose the uploader to unrelated websites.
      if (req.headers.origin) {
        try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '请在当前网页地址上传' }); }
        catch { return json(res, 403, { error: '网页来源无效' }); }
      }
      const auth = req.headers.authorization || '';
      if (!/^Bearer [^\r\n]+$/.test(auth)) return json(res, 401, { error: '登录已失效，请重新登录后上传' });
      if (active >= 2) return json(res, 429, { error: '当前上传较多，请稍后重试' });
      active++;
      let directory;
      let responseStatus = 200, responseBody;
      try {
        if (!writeObject) throw fail(503, '上传服务尚未配置腾讯云密钥');
        const id = url.searchParams.get('id');
        const contentType = req.headers['content-type'];
        const length = req.headers['content-length'] === undefined ? NaN : Number(req.headers['content-length']);
        if (!/^[1-9]\d{0,18}$/.test(id || '') || BigInt(id) > 9223372036854775807n) throw fail(400, '工单编号无效');
        if (!['image/jpeg', 'video/mp4'].includes(contentType)) throw fail(415, '请上传 JPG 图片或 MP4 视频；PNG、WEBP 可由网页自动转换');
        if (Number.isFinite(length) && length > MAX_BYTES) throw fail(413, '单个文件不能超过 200 MB');
        // Validate the existing session via a read-only API; never write the DB.
        const session = await fetchImpl(`${upstream}/api/events/finish`, {
          headers: { Authorization: auth }, signal: AbortSignal.timeout(10000), redirect: 'error',
        });
        if (session.status === 401 || session.status === 403) throw fail(401, '登录已失效，请重新登录后上传');
        if (!session.ok) throw fail(503, '登录校验服务暂不可用，请稍后重试');
        const records = await session.json();
        if (!Array.isArray(records)) throw fail(503, '登录校验接口响应异常');
        directory = await mkdtemp(join(temporaryRoot, 'web-finish-'));
        const filePath = join(directory, 'upload');
        const file = await open(filePath, 'wx');
        let size = 0;
        const head = Buffer.alloc(16);
        try {
          for await (const chunk of req) {
            if (size < 16) chunk.copy(head, size, 0, Math.min(16 - size, chunk.length));
            size += chunk.length;
            if (size > MAX_BYTES) throw fail(413, '单个文件不能超过 200 MB');
            await file.writeFile(chunk);
          }
        } finally { await file.close(); }
        if (!size) throw fail(400, '不能上传空文件');
        if (Number.isFinite(length) && size !== length) throw fail(400, '文件传输不完整，请重试');
        const valid = contentType === 'image/jpeg'
          ? size >= 3 && head[0] === 255 && head[1] === 216 && head[2] === 255
          : size >= 12 && head.toString('ascii', 4, 8) === 'ftyp';
        if (!valid) throw fail(415, '文件内容与图片或视频格式不符');
        const key = objectKey(id, contentType);
        const previewUrl = await writeObject({ key, filePath, size, contentType });
        responseBody = { success: true, key, url: previewUrl };
      } catch (error) {
        responseStatus = error.status || 503;
        responseBody = { error: error.status ? error.message : '上传服务暂不可用，请检查服务器与腾讯云的连接后重试' };
      } finally {
        try { if (directory) await rm(directory, { recursive: true, force: true }); }
        catch { console.error('上传临时文件清理失败，请检查服务器临时目录权限'); }
        finally { active--; }
      }
      if (!res.destroyed && !res.headersSent) json(res, responseStatus, responseBody);
      return;
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '仅支持 GET' });
    try {
      const root = resolve(webRoot);
      const filePath = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!filePath.startsWith(root + sep)) return json(res, 404, { error: '文件不存在' });
      if (!(await stat(filePath)).isFile()) return json(res, 404, { error: '文件不存在' });
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(filePath));
    } catch { if (!res.headersSent) json(res, 404, { error: '文件不存在' }); else res.destroy(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createWebServer({
    upstream: process.env.WEB_API_UPSTREAM || API_CONFIG.baseUrl,
    writeObject: createCosWriter({ secretId: process.env.TENCENT_COS_SECRET_ID, secretKey: process.env.TENCENT_COS_SECRET_KEY }),
  });
  const port = Number(process.env.WEB_UPLOAD_PORT || 8290);
  server.requestTimeout = 15 * 60 * 1000;
  server.on('error', error => { console.error(`网页上传服务启动失败：${error.code || '未知错误'}`); process.exitCode = 1; });
  server.listen(port, process.env.WEB_UPLOAD_HOST || '127.0.0.1', () => console.log(`网页及材料上传服务：http://127.0.0.1:${port}`));
}
