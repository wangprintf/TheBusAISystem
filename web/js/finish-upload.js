export const FINISH_FILE_LIMIT = 200 * 1024 * 1024;
import { uploadDirectToCos } from './cos-direct.js';
export const FINISH_ACCEPT = '.jpg,.jpeg,.png,.webp,.mp4,.m4v';
const formats = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', m4v: 'video/x-m4v' };
const FINISH_UPLOAD_BLOCKED_MESSAGE = '仅处理中的事件可上传图片和视频';

export function isProcessingStatus(status) {
  return status === 'processing' || status === '处理中';
}

export function createUploadId() {
  // getRandomValues also works when the dashboard is served over local HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function finishMediaType(file) {
  const extension = String(file.name || '').split('.').at(-1).toLowerCase();
  const type = formats[extension];
  if (!type || (file.type && file.type !== type && !(extension === 'm4v' && file.type === 'video/mp4') && file.type !== 'application/octet-stream')) throw new Error('请选择 JPG、PNG、WEBP 图片或 MP4 视频；其他视频请先转换为 MP4');
  if (!file.size) throw new Error('不能上传空文件');
  if (file.size > FINISH_FILE_LIMIT) throw new Error('单个文件不能超过 200 MB');
  return type;
}

export async function prepareFinishFile(file) {
  const type = finishMediaType(file);
  if (type !== 'image/png' && type !== 'image/webp') return { body: file, type: type.startsWith('video/') ? 'video/mp4' : type };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40000000) throw new Error('图片分辨率过大，请缩小后上传');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const body = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!body) throw new Error('图片转换失败，请改用 JPG 图片');
    if (body.size > FINISH_FILE_LIMIT) throw new Error('转换后图片超过 200 MB，请缩小后上传');
    return { body, type: 'image/jpeg' };
  } catch (error) {
    throw new Error(error.message?.includes('请') ? error.message : '图片无法读取，请重新选择图片或改用 JPG');
  } finally { bitmap?.close(); }
}

export async function uploadFinishFile({ token, orderId, file, uploadId, onProgress = () => {}, xhrFactory = () => new XMLHttpRequest(), prepare = prepareFinishFile }) {
  finishMediaType(file);
  if (!token) return Promise.reject(new Error('登录已失效，请重新登录后上传'));
  if (globalThis.location?.protocol === 'file:') throw new Error('请通过网站地址或本地 HTTP 服务打开网页后上传');
  const { body, type } = await prepare(file);
  const extension = type === 'video/mp4' ? 'mp4' : 'jpg';
  const key = `/${String(orderId)}.${uploadId}.${extension}`;
  const result = await uploadDirectToCos({ body, type, key, onProgress, xhrFactory });
  return { ...result, kind: type.startsWith('video/') ? 'video' : 'image' };
}

export function mountFinishUpload(container, { upload, onComplete, onBusy = () => {}, canUpload = true } = {}) {
  if (!container) return { isBusy: () => false, destroy() {} };
  const doc = container.ownerDocument;
  const events = new doc.defaultView.AbortController();
  let queue = [];
  let running = false;
  let disposed = false;
  const uploadAllowed = typeof canUpload === 'function' ? canUpload() : canUpload !== false;
  if (!uploadAllowed) {
    container.innerHTML = `<p class="finish-upload-unavailable" role="status">${FINISH_UPLOAD_BLOCKED_MESSAGE}</p>`;
    return { isBusy: () => false, destroy() { container.replaceChildren(); } };
  }
  container.innerHTML = `<div class="finish-upload-toolbar"><button type="button" class="outline-btn" data-pick>＋ 添加图片 / 视频</button><button type="button" class="primary-btn" data-start disabled>开始上传</button><input type="file" accept="${FINISH_ACCEPT}" multiple hidden data-files></div><p class="finish-upload-hint">支持多选 JPG、PNG、WEBP 图片和 MP4 视频，每个不超过 200 MB。文件将直接上传到腾讯云 COS，数据库随后自动同步。</p><div class="finish-upload-list"></div><p class="finish-upload-message" role="status" aria-live="polite"></p>`;
  const input = container.querySelector('[data-files]');
  const pick = container.querySelector('[data-pick]');
  const start = container.querySelector('[data-start]');
  const list = container.querySelector('.finish-upload-list');
  const message = container.querySelector('.finish-upload-message');
  const tell = (text, error = false) => { message.textContent = text; message.classList.toggle('is-error', error); };
  function paint(item) {
    item.row.querySelector('progress').value = item.progress;
    item.row.querySelector('[data-status]').textContent = item.status === 'done' ? '上传成功' : item.status === 'error' ? item.error : item.status === 'uploading' ? item.progress >= 99 ? '正在保存材料…' : `上传中 ${item.progress}%` : '待上传';
    item.row.classList.toggle('is-error', item.status === 'error');
    item.row.querySelector('button').disabled = running;
    start.disabled = running || !queue.some(entry => ['queued', 'error'].includes(entry.status));
    start.textContent = running ? '正在上传…' : queue.some(entry => entry.status === 'error') ? '重试未完成项' : '开始上传';
    pick.disabled = running;
  }
  pick.addEventListener('click', () => input.click(), { signal: events.signal });
  input.addEventListener('change', () => {
    const errors = [];
    for (const file of input.files) {
      if (queue.length >= 10) { errors.push('每批最多选择 10 个文件'); break; }
      try { finishMediaType(file); } catch (error) { errors.push(`${file.name}：${error.message}`); continue; }
      if (queue.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      const item = { file, id: createUploadId(), progress: 0, status: 'queued', row: doc.createElement('div') };
      item.row.className = 'finish-upload-row';
      item.row.innerHTML = '<div><b></b><span data-status></span><progress max="100" value="0"></progress></div><button type="button" aria-label="移除文件">×</button>';
      const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
      item.row.querySelector('b').textContent = `${file.name} · ${size}`;
      item.row.querySelector('button').addEventListener('click', () => { if (running) return; queue = queue.filter(entry => entry !== item); item.row.remove(); paint(item); }, { signal: events.signal });
      queue.push(item); list.append(item.row); paint(item);
    }
    input.value = '';
    tell(errors.join('；') || `已选择 ${queue.length} 个文件，点击“开始上传”提交。`, errors.length > 0);
  }, { signal: events.signal });
  start.addEventListener('click', async () => {
    if (running || disposed) return;
    running = true; onBusy(true); queue.forEach(paint); tell('正在上传，请保留当前窗口。');
    try {
      for (const item of queue.filter(entry => entry.status !== 'done')) {
        item.status = 'uploading'; item.progress = 0; paint(item);
        try {
          const media = await upload(item.file, item.id, progress => { item.progress = progress; if (!disposed) paint(item); });
          item.status = 'done'; item.progress = 100;
          if (!disposed) onComplete(media);
        } catch (error) { item.status = 'error'; item.error = error.message || '上传失败，请重试'; }
        if (!disposed) paint(item);
      }
    } finally {
      running = false; onBusy(false);
      if (!disposed) {
        queue.forEach(paint);
        const failed = queue.filter(item => item.status === 'error').length;
        tell(failed ? `${queue.length - failed} 个成功，${failed} 个失败。可以重试未完成项。` : '上传完成，已保存到 finish 桶，工单材料等待自动同步。', failed > 0);
      }
    }
  }, { signal: events.signal });
  return { isBusy: () => running, destroy() { disposed = true; events.abort(); } };
}
