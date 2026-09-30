// Add only the two local web origins; preserve existing bucket rules and objects.
// Default: show the proposal. --apply: save a backup, update CORS, verify preflights.
import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { COS_DIRECT_CONFIG as config } from '../web/js/cos-direct-config.js';

const apply = process.argv.includes('--apply');
const origins = ['http://127.0.0.1:5500', 'http://localhost:5500'];
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key, value) => createHmac('sha1', key).update(value).digest('hex');
if (config.host !== 'traffic-events-finish-1451604295.cos.ap-beijing.myqcloud.com') throw new Error('Unexpected bucket. Stopped without changing CORS.');

function authorization(method) {
  const start = Math.floor(Date.now() / 1000) - 60;
  const time = `${start};${start + 600}`;
  const canonical = `${method.toLowerCase()}\n/\ncors=\nhost=${encode(config.host)}\n`;
  const hash = createHash('sha1').update(canonical).digest('hex');
  const signature = hmac(hmac(config.secretKey, time), `sha1\n${time}\n${hash}\n`);
  return `q-sign-algorithm=sha1&q-ak=${encode(config.secretId)}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=cors&q-signature=${signature}`;
}

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: config.host, method, path, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('COS request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function readCors() {
  const res = await request('GET', '/?cors', { Authorization: authorization('GET') });
  if (res.status !== 200 || !res.body.includes('</CORSConfiguration>')) throw new Error(`Cannot read CORS (HTTP ${res.status}). Stopped without changing it.`);
  return res.body;
}

const before = await readCors();
const rules = before.match(/<CORSRule>[\s\S]*?<\/CORSRule>/g) || [];
const missing = origins.filter(origin => !rules.some(rule =>
  rule.includes(`<AllowedOrigin>${origin}</AllowedOrigin>`)
  && ['PUT', 'GET', 'HEAD'].every(method => rule.includes(`<AllowedMethod>${method}</AllowedMethod>`))
  && rule.includes('<AllowedHeader>*</AllowedHeader>')));
if (!missing.length) console.log('Both local origins already have PUT/GET/HEAD rules.');
else {
  if (rules.length >= 10) throw new Error('CORS rule limit reached. Stopped without changing existing rules.');
  const extra = ['<CORSRule>', ...missing.map(origin => `  <AllowedOrigin>${origin}</AllowedOrigin>`),
    ...['PUT', 'GET', 'HEAD'].map(method => `  <AllowedMethod>${method}</AllowedMethod>`),
    '  <AllowedHeader>*</AllowedHeader>', '  <ExposeHeader>ETag</ExposeHeader>',
    '  <ExposeHeader>Content-Length</ExposeHeader>', '  <ExposeHeader>x-cos-request-id</ExposeHeader>',
    '  <MaxAgeSeconds>600</MaxAgeSeconds>', '</CORSRule>'].join('\n');
  const index = before.includes('<ResponseVary>') ? before.indexOf('<ResponseVary>') : before.indexOf('</CORSConfiguration>');
  const after = before.slice(0, index) + extra + '\n' + before.slice(index);
  console.log(`Bucket: ${config.host}\nExisting rules preserved: ${rules.length}\nRule to add:\n${extra}`);
  if (apply) {
    const backupDir = new URL('../backups/', import.meta.url);
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(new URL(`cos-cors-${stamp}.before.xml`, backupDir), before, { flag: 'wx' });
    if (await readCors() !== before) throw new Error('CORS changed since reading. Stopped to preserve the concurrent change.');
    const res = await request('PUT', '/?cors', {
      Authorization: authorization('PUT'), 'Content-Type': 'application/xml',
      'Content-MD5': createHash('md5').update(after).digest('base64'), 'Content-Length': Buffer.byteLength(after),
    }, after);
    if (res.status !== 200) throw new Error(`CORS update failed (HTTP ${res.status}, code ${res.body.match(/<Code>([^<]*)<\/Code>/)?.[1] || 'unknown'}).`);
    const saved = await readCors();
    for (const rule of rules) {
      if (!saved.replace(/\s+/g, '').includes(rule.replace(/\s+/g, ''))) throw new Error('An existing CORS rule differs after the update. Inspect the saved backup.');
    }
    console.log('CORS updated; existing rules verified unchanged.');
  }
}

for (const origin of [...origins, 'http://81.70.233.75']) {
  const res = await request('OPTIONS', '/202609220191.72801867-ac48-4a3e-9f6b-b1ea2917a7b2.jpg', {
    Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type',
  });
  const allowed = res.status === 200 && res.headers['access-control-allow-origin'] === origin && res.headers['access-control-allow-methods']?.includes('PUT');
  console.log(JSON.stringify({ origin, status: res.status, allowed }));
  if (apply && !allowed) process.exitCode = 1;
}
