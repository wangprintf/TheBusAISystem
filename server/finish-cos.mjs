import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';
import { createReadStream } from 'node:fs';

export const COS_HOST = 'traffic-events-finish-1451604295.cos.ap-beijing.myqcloud.com';
const hmac = (key, text) => createHmac('sha1', key).update(text).digest('hex');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// COS V5 signature. The host, method and exact object path are signed.
export function authorization({ method, pathname, secretId, secretKey, now = Date.now() }) {
  const start = Math.floor(now / 1000) - 60;
  const time = `${start};${start + 1800}`;
  const canonical = `${method.toLowerCase()}\n${pathname}\n\nhost=${encode(COS_HOST)}\n`;
  const hash = createHash('sha1').update(canonical).digest('hex');
  const signature = hmac(hmac(secretKey, time), `sha1\n${time}\n${hash}\n`);
  return `q-sign-algorithm=sha1&q-ak=${encode(secretId)}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

export function createCosWriter({ secretId, secretKey, request = https.request }) {
  if (!secretId || !secretKey) throw new Error('请在服务器设置 TENCENT_COS_SECRET_ID 和 TENCENT_COS_SECRET_KEY');
  return async ({ key, filePath, size, contentType }) => {
    const pathname = '/' + key.split('/').map(encode).join('/');
    await new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      const req = request({ hostname: COS_HOST, path: pathname, method: 'PUT', headers: {
        Authorization: authorization({ method: 'PUT', pathname, secretId, secretKey }),
        'Content-Type': contentType, 'Content-Length': size,
        // Do not overwrite an existing object, even on an accidental UUID collision.
        'x-cos-forbid-overwrite': 'true',
      } }, res => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(Object.assign(new Error(res.statusCode === 403 ? 'COS 拒绝上传，请检查服务端密钥的桶写入权限' : `COS 上传失败（${res.statusCode}）`), { status: 502 }));
        });
        res.on('error', reject);
      });
      req.setTimeout(900000, () => req.destroy(new Error('COS 上传超时')));
      req.on('error', reject);
      req.on('close', () => stream.destroy());
      stream.on('error', error => req.destroy(error));
      stream.pipe(req);
    });
    const query = new URLSearchParams(authorization({ method: 'GET', pathname, secretId, secretKey }));
    return `https://${COS_HOST}${pathname}?${query}`;
  };
}
