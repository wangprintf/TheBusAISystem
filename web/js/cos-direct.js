import { COS_DIRECT_CONFIG } from './cos-direct-config.js';

const textEncoder = new TextEncoder();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const concat = (...parts) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

function sha1(input) {
  const bytes = new Uint8Array(input);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) words[i] = ((words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16]) << 1) | ((words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16]) >>> 31);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const rotate = (a << 5) | (a >>> 27);
      const [fn, constant] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const next = (rotate + fn + e + constant + words[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const result = new Uint8Array(20); const output = new DataView(result.buffer);
  [h0, h1, h2, h3, h4].forEach((value, index) => output.setUint32(index * 4, value));
  return result;
}

function hmacSha1(key, message) {
  let keyBytes = textEncoder.encode(key);
  if (keyBytes.length > 64) keyBytes = sha1(keyBytes);
  const block = new Uint8Array(64); block.set(keyBytes);
  const inner = new Uint8Array(64), outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
  return sha1(concat(outer, sha1(concat(inner, textEncoder.encode(message)))));
}

const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

export function cosAuthorization({ method, pathname, secretId, secretKey, now = Date.now() }) {
  const start = Math.floor(now / 1000) - 60;
  const time = `${start};${start + 1800}`;
  const canonical = `${method.toLowerCase()}\n${pathname}\n\nhost=${encode(COS_DIRECT_CONFIG.host)}\n`;
  const hash = hex(sha1(textEncoder.encode(canonical)));
  const signKey = hex(hmacSha1(secretKey, time));
  const signature = hex(hmacSha1(signKey, `sha1\n${time}\n${hash}\n`));
  return `q-sign-algorithm=sha1&q-ak=${encode(secretId)}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

function signedUrl(method, key) {
  const pathname = '/' + key.split('/').map(encode).join('/');
  const query = cosAuthorization({ method, pathname, secretId: COS_DIRECT_CONFIG.secretId, secretKey: COS_DIRECT_CONFIG.secretKey });
  return { pathname, url: `https://${COS_DIRECT_CONFIG.host}${pathname}?${query}` };
}

export function uploadDirectToCos({ body, type, key, onProgress = () => {}, xhrFactory = () => new XMLHttpRequest() }) {
  const target = signedUrl('PUT', key);
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('PUT', target.url);
    xhr.setRequestHeader('Content-Type', type);
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve({ key, url: signedUrl('GET', key).url });
      } else {
        const code = xhr.responseText?.match(/<Code>([A-Za-z0-9]+)<\/Code>/)?.[1];
        reject(new Error(`COS 上传失败（${xhr.status}${code ? ` · ${code}` : ''}），请检查密钥权限或签名是否有效`));
      }
    };
    xhr.onerror = () => {
      const origin = globalThis.location?.origin;
      reject(new Error(`COS 直传失败：网络异常或跨域请求被拦截。请检查网络及桶 CORS 的 PUT 规则，来源需包含${origin && origin !== 'null' ? ` ${origin}（含端口）` : '当前网页地址（含端口）'}`));
    };
    xhr.ontimeout = () => reject(new Error('COS 上传超时，请重试'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(body);
  });
}
