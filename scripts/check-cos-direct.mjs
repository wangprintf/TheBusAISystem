// Read-only diagnostics: GET, HEAD and OPTIONS only. Never uploads an object.
import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { COS_DIRECT_CONFIG as config } from '../web/js/cos-direct-config.js';
import { cosAuthorization } from '../web/js/cos-direct.js';

const pageUrl = new URL(process.argv[2] || 'http://81.70.233.75/');
const origin = pageUrl.origin;
const moduleUrl = name => new URL(`./js/${name}.js?check=cos-direct`, pageUrl).href;
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key, value) => createHmac('sha1', key).update(value).digest('hex');
const redact = value => String(value).replaceAll(config.secretId, '[redacted]').replaceAll(config.secretKey, '[redacted]').replace(/q-signature=[^&\s<]+/g, 'q-signature=[redacted]');

function read(url, method = 'GET', headers = {}) {
  return new Promise(resolve => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? https : http).request(target, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', error => resolve({ error: error.code || error.message }));
    });
    request.setTimeout(15000, () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ error: error.code || error.message }));
    request.end();
  });
}

function report(label, result, detail = {}) {
  const { status, headers = {}, body = '', error } = result;
  const visibleHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => /^(access-control-|date$|content-type$|server$|x-cos-request-id$)/.test(name)));
  const code = body.match(/<Code>([^<]*)<\/Code>/)?.[1];
  const message = body.match(/<Message>([^<]*)<\/Message>/)?.[1];
  console.log(redact(JSON.stringify({ label, status, error, headers: visibleHeaders, code, message, ...detail })));
}

const results = await Promise.allSettled([
  (async () => {
    const result = await read(moduleUrl('finish-upload'));
    report('published upload module', result, { directUpload: result.body?.includes('uploadDirectToCos'), oldServiceHint: result.body?.includes('start-web-upload.ps1') });
  })(),
  (async () => {
    const result = await read(moduleUrl('cos-direct'));
    report('published COS signer', result, { isJavascript: result.body?.includes('cosAuthorization'), localVersion: result.body?.includes('q-header-list=host') });
  })(),
  (async () => {
    const time = `${Math.floor(Date.now() / 1000) - 60};${Math.floor(Date.now() / 1000) + 300}`;
    const canonical = `get\n/\ncors=\nhost=${encode(config.host)}\n`;
    const hash = createHash('sha1').update(canonical).digest('hex');
    const signature = hmac(hmac(config.secretKey, time), `sha1\n${time}\n${hash}\n`);
    const auth = `q-sign-algorithm=sha1&q-ak=${encode(config.secretId)}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=cors&q-signature=${signature}`;
    const result = await read(`https://${config.host}/?cors`, 'GET', { Authorization: auth });
    report('current bucket CORS', result, result.status === 200 ? { cors: result.body } : {});
  })(),
  ...['/', '//'].map(prefix => (async () => {
    const pathname = `${prefix}202609220191.72801867-ac48-4a3e-9f6b-b1ea2917a7b2.jpg`;
    const auth = cosAuthorization({ method: 'PUT', pathname, secretId: config.secretId, secretKey: config.secretKey });
    const result = await read(`https://${config.host}${pathname}?${auth}`, 'OPTIONS', { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' });
    report(`PUT preflight with ${prefix.length} leading slash`, result);
    const headAuth = cosAuthorization({ method: 'HEAD', pathname, secretId: config.secretId, secretKey: config.secretKey });
    report(`signed HEAD with ${prefix.length} leading slash`, await read(`https://${config.host}${pathname}?${headAuth}`, 'HEAD', { Origin: origin }));
  })()),
]);
for (const result of results) if (result.status === 'rejected') console.log(redact(String(result.reason)));
