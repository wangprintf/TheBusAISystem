import { API_CONFIG } from './config.js';
import { uploadFinishFile } from './finish-upload.js';
import { createReadCache } from './read-cache.js';
import { buildPriorityTrend } from './priority-trend.js';
import { personnelLocations } from './personnel-location.js';

const readPaths = { events: '/api/events', devices: '/api/devices', finish: '/api/events/finish' };
// Keep the successful preview while the existing bucket scanner catches up.
// Scoped to the login session; these links never write back to the database.
let uploadedScope = '';
const uploadedPreviews = new Map();
function previewsFor(id) {
  const scope = sessionStorage.getItem('traffic-auth') || '';
  if (scope !== uploadedScope) { uploadedPreviews.clear(); uploadedScope = scope; }
  const items = (uploadedPreviews.get(String(id)) || []).filter(item => item.expires > Date.now());
  uploadedPreviews.set(String(id), items);
  return items;
}
const webReads = createReadCache({
  scope: () => `${API_CONFIG.baseUrl}|${sessionStorage.getItem('traffic-auth') || ''}`,
  load: (key, { fresh }) => request(`${readPaths[key]}?cache=web${fresh ? '&fresh=1' : ''}`),
});
function changedResources(path) {
  if (path.startsWith('/api/events/finish')) return ['events', 'finish'];
  if (path.startsWith('/api/events') || path.startsWith('/alerts') || path.startsWith('/work-orders')) return ['events', 'finish'];
  if (path.startsWith('/api/devices')) return ['devices'];
  return [];
}

const mockAlerts = [
  { id:'AL-20260713-0086', type:'机动车违停', category:'机动车', severity:'高', status:'pending', confidence:96.8, occurredAt:'10:23:16', route:'B12 路', location:'南京路与营口道交叉口', longitude:117.196, latitude:39.118, deviceId:'BUS-012', thumbnail:'违停', description:'检测到机动车在禁停路段持续停留，建议优先复核。' },
  { id:'AL-20260713-0085', type:'非机动车逆行', category:'非机动车', severity:'中', status:'pending', confidence:93.4, occurredAt:'10:08:42', route:'B12 路', location:'卫津路八里台立交附近', longitude:117.174, latitude:39.095, deviceId:'BUS-012', thumbnail:'逆行', description:'检测到非机动车沿反向车道行驶，存在交通安全风险。' },
  { id:'AL-20260713-0081', type:'行人闯红灯', category:'行人', severity:'高', status:'dispatched', confidence:91.2, occurredAt:'09:42:03', route:'K8 路', location:'黑牛城道与友谊南路交叉口', longitude:117.208, latitude:39.078, deviceId:'BUS-008', thumbnail:'闯灯', description:'检测到行人在红灯期间进入机动车道，建议及时处置。' },
  { id:'AL-20260713-0078', type:'路面坑洼', category:'道路', severity:'中', status:'valid', confidence:89.7, occurredAt:'09:15:37', route:'K8 路', location:'津塘路与十一经路交叉口', longitude:117.209, latitude:39.104, deviceId:'BUS-008', thumbnail:'坑洼', description:'检测到路面存在明显坑洼，建议安排现场复核。' },
];

const mockDevices = [
  { id:'BUS-012', name:'浙A·B1208', route:'B12 路', status:'online', network:'5G · 92%', storage:68, temperature:54, modelVersion:'vision-1.4.2', lastSeen:'刚刚' },
  { id:'BUS-008', name:'浙A·K0826', route:'K8 路', status:'online', network:'4G · 78%', storage:42, temperature:51, modelVersion:'vision-1.4.2', lastSeen:'1分钟前' },
  { id:'BUS-021', name:'浙A·B2166', route:'B21 路', status:'warning', network:'4G · 43%', storage:89, temperature:68, modelVersion:'vision-1.4.1', lastSeen:'3分钟前' },
  { id:'BUS-035', name:'浙A·K3517', route:'K35 路', status:'offline', network:'离线', storage:0, temperature:0, modelVersion:'vision-1.4.1', lastSeen:'18分钟前' },
];

let workOrders = [
  { id:'WO-20260713-0032', title:'紧急修复滨江大道路面坑洼', sourceAlertId:'AL-20260713-0086', status:'pending', assignee:'待指派', dueAt:'立即处理', updatedAt:'刚刚', location:'滨江大道与迎宾路交叉口' },
  { id:'WO-20260713-0031', title:'处置文一路违规占道施工', sourceAlertId:'AL-20260713-0081', status:'processing', assignee:'城管二中队 · 陈明', dueAt:'今日 16:00', updatedAt:'10:05', location:'文一路地铁站南侧' },
  { id:'WO-20260713-0029', title:'修复学院路井盖移位', sourceAlertId:'AL-20260713-0078', status:'completed', assignee:'市政养护 · 李群', dueAt:'今日 14:00', updatedAt:'09:50', location:'学院路 318 号' },
];

async function request(path, options = {}) {
  const changed = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase()) ? changedResources(path) : [];
  if (changed.length) webReads.invalidate(changed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  try {
    const session = JSON.parse(sessionStorage.getItem('traffic-auth') || 'null');
    const response = await fetch(`${API_CONFIG.baseUrl}${path}`, { cache: 'no-store', ...options, signal: controller.signal, headers: { 'Content-Type':'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally {
    clearTimeout(timer);
    if (changed.length) webReads.invalidate(changed);
  }
}

function requestForm(path, values) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
}

export async function login(accountId, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id: accountId, password }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !result.token) throw new Error(result.message || '账号或密码错误');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  async getPersonnelLocations() {
    const scope = sessionStorage.getItem('traffic-auth') || '{}';
    const session = JSON.parse(scope);
    if (!session?.token) return [];
    // The deployed personnel endpoint fails in its cache=web handler. Its direct
    // read queries the database; request() also disables the browser HTTP cache.
    const result = await request('/api/personnel');
    if ((sessionStorage.getItem('traffic-auth') || '{}') !== scope) throw new Error('登录状态已变化，请重新加载数据');
    const rows = Array.isArray(result) ? result : result?.data;
    if (!Array.isArray(rows)) throw new Error('人员定位数据格式不正确');
    return personnelLocations(rows, session);
  },
  async uploadFinishMedia(id, file, uploadId, onProgress) {
    const scope = sessionStorage.getItem('traffic-auth') || '{}';
    const session = JSON.parse(scope);
    try {
      const media = await uploadFinishFile({ token: session.token, orderId: id, file, uploadId, onProgress });
      if (sessionStorage.getItem('traffic-auth') === scope) uploadedPreviews.set(String(id), [...previewsFor(id), { ...media, expires: Date.now() + 28 * 60 * 1000 }]);
      return media;
    } finally { webReads.invalidate(['finish']); }
  },
  invalidateReads(keys = Object.keys(readPaths)) { webReads.invalidate(keys); },
  async getDashboard() {
    if (API_CONFIG.useMock) return { todayAlerts:86, validRate:92.6, pendingOrders:14, onlineRate:93.3, trend:[18,25,20,35,28,46,39], completed:36, processing:12, unprocessed:8, labels:['周二','周三','周四','周五','周六','周日','今日'] };
    const [events, devices] = await Promise.all([webReads.read('events'), webReads.read('devices')]);
    const rows = Array.isArray(events) ? events : [];
    const deviceRows = Array.isArray(devices) ? devices : (devices?.data || []);
    const mapped = rows.map(event => mapDatabaseEvent(event));
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayAlerts = mapped.filter(event => parseEventTime(event.occurredAt) >= dayStart).length;
    const visibleOrders = mapped.filter(isVisibleWorkOrder);
    const completed = visibleOrders.filter(event => event.status === 'completed').length;
    const processing = visibleOrders.filter(event => event.status === 'processing').length;
    const review = visibleOrders.filter(event => event.status === 'review').length;
    const unprocessed = visibleOrders.filter(event => event.status === 'pending').length;
    const reviewed = mapped.filter(event => event.reviewStatus !== null);
    const validRate = reviewed.length ? Number((reviewed.filter(event => event.reviewStatus === 1).length * 100 / reviewed.length).toFixed(1)) : 0;
    const online = deviceRows.filter(device => ['正常', '在线', 'online'].includes(device.status)).length;
    const priorityTrend = buildPriorityTrend(rows, now);
    const trend = priorityTrend.map(day => day.total);
    const labels = priorityTrend.map(day => day.label);
    return { todayAlerts, validRate, pendingOrders: unprocessed, onlineRate: deviceRows.length ? Number((online * 100 / deviceRows.length).toFixed(1)) : 0, trend, labels, priorityTrend, completed, processing, review, unprocessed };
  },
  async getAlerts(filters = {}) {
    if (!API_CONFIG.useMock) {
      const events = await webReads.read('events');
      const alerts = (Array.isArray(events) ? events : []).map(mapDatabaseAlert);
      return alerts.filter(a => (!filters.status || a.status === filters.status) && (!filters.keyword || `${a.type}${a.location}${a.route}`.includes(filters.keyword)));
    }
    return mockAlerts.filter(a => (!filters.status || a.status === filters.status) && (!filters.keyword || `${a.type}${a.location}${a.route}`.includes(filters.keyword)));
  },
  async updateAlert(id, action) {
    if (!API_CONFIG.useMock) return request(`/alerts/${id}/review`, { method:'PATCH', body:JSON.stringify(action) });
    const alert = mockAlerts.find(a => a.id === id); if (!alert) throw new Error('告警不存在');
    alert.status = action.status; return alert;
  },
  async getWorkOrders() {
    const [events, finishMedia] = await Promise.all([
      webReads.read('events'),
      webReads.read('finish').catch(() => []),
    ]);
    const finishMediaByEventId = new Map((Array.isArray(finishMedia) ? finishMedia : []).map(item => [String(item.id), item]));
    return (Array.isArray(events) ? events : [])
      .map(event => {
        const order = mapDatabaseEvent(event, finishMediaByEventId.get(String(event.id)));
        for (const media of previewsFor(event.id)) {
          const index = order.processedMedia.findIndex(item => new URL(item.url).pathname === new URL(media.url).pathname);
          if (index < 0) order.processedMedia.push(media); else order.processedMedia[index] = media;
        }
        return order;
      }).filter(isVisibleWorkOrder);
  },
  async reviewWorkOrder(id, isValid, existingRemarks = '', resultLabel = (Number(isValid) === 0 ? '不合格' : '合格'), status = '') {
    if (![0, 1].includes(Number(isValid))) throw new Error('审核结果必须为 0 或 1');
    const auditRemark = `${formatActionTime()}-人工判定/审核结果：${resultLabel}`;
    return requestForm('/api/events/update', {
      id: String(id),
      is_valid: String(isValid),
      ...(status === 'review' ? { process_status: Number(isValid) === 1 ? '已完成' : '未处理' } : {}),
      remarks: appendRemark(existingRemarks, auditRemark),
    });
  },
  async sendWorkOrder(id, existingRemarks = '') {
    return requestForm('/api/events/update', { id: String(id), process_status:'处理中', remarks: appendRemark(existingRemarks, `${formatActionTime()}-发送工单`) });
  },
  async remindWorkOrder(id, existingRemarks = '') {
    return requestForm('/api/events/update', { id: String(id), remarks: appendRemark(existingRemarks, `${formatActionTime()}-催办`) });
  },
  async createWorkOrder(payload) {
    if (!API_CONFIG.useMock) return request('/work-orders', { method:'POST', body:JSON.stringify(payload) });
    const item = { id:`WO-20260713-${String(workOrders.length + 32).padStart(4,'0')}`, status:'pending', assignee:'待指派', dueAt:'待设置', updatedAt:'刚刚', ...payload }; workOrders = [item, ...workOrders]; return item;
  },
  async getDevices() {
    const result = await webReads.read('devices');
    const devices = Array.isArray(result) ? result : (result.data || []);
    return devices.map((device) => ({
      id: device.device_id || '',
      name: device.license_plate || '',
      status: device.status || '未知',
      abnormalInfo: device.abnormal_info || '',
      temperature: toNumberOrNull(device.temperature),
      storage: toNumberOrNull(device.storage),
      workStartTime: device.work_start_time || '',
      workFinishTime: device.work_finish_time || '',
      lastSeen: '数据库同步',
    }));
  },
  async createDevice(payload) {
    return requestForm('/api/devices', {
      device_id: payload.deviceId,
      license_plate: payload.licensePlate,
      work_start_time: normalizeTimeForApi(payload.workStartTime),
      work_finish_time: normalizeTimeForApi(payload.workFinishTime),
    });
  },
  async exportDeviceDetail(deviceId) {
    const session = JSON.parse(sessionStorage.getItem('traffic-auth') || 'null');
    const response = await fetch(`${API_CONFIG.baseUrl}/api/devices/export?${new URLSearchParams({ device_id: deviceId })}`, {
      headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
    });
    if (!response.ok) throw new Error(`导出失败：${response.status}`);
    return response.blob();
  },
  async updateSettings(payload) { return API_CONFIG.useMock ? payload : request('/settings', { method:'PUT', body:JSON.stringify(payload) }); },
};

function formatActionTime(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function appendRemark(existing, note) {
  return [String(existing || '').trim(), note].filter(Boolean).join('；');
}

function normalizeTimeForApi(value) {
  const text = String(value || '').trim();
  return text && text.length === 5 ? `${text}:00` : text;
}

function parseEventTime(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  const parsed = Date.parse(text.replace(' ', 'T'));
  return Number.isNaN(parsed) ? NaN : parsed;
}

function mapDatabaseAlert(event) {
  const order = mapDatabaseEvent(event);
  const processStatus = order.processStatus;
  const status = order.reviewStatus === 0 && !isReturnedWorkOrder(order) ? 'false' : processStatus !== '未处理' ? 'dispatched' : order.reviewStatus === 1 ? 'valid' : 'pending';
  const confidence = toNumberOrNull(event.confidence ?? event.confidence_score ?? event.ai_confidence);
  return {
    id: order.id,
    type: order.eventType || order.title,
    category: order.category,
    severity: order.priority,
    status,
    confidence: confidence == null ? '--' : confidence,
    occurredAt: order.occurredAt,
    route: event.route || event.line_name || event.line || '--',
    location: order.location,
    longitude: order.longitude,
    latitude: order.latitude,
    deviceId: event.device_id || event.deviceId || '--',
    thumbnail: order.eventType || '告警',
    description: event.description || order.remarks || '数据库实时告警记录',
    evidenceUrl: order.evidenceUrl,
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasValidCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude !== 0 && longitude !== 0
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function normalizeReviewStatus(value) {
  const text = String(value ?? '').trim();
  return text === '0' ? 0 : text === '1' ? 1 : null;
}

function isVisibleWorkOrder(order) {
  return order.isValid !== 0 || isReturnedWorkOrder(order);
}

function isReturnedWorkOrder(order) {
  if (order.reviewStatus !== 0) return false;
  // is_valid=0 is also used for a failed completion review. The persisted audit
  // result distinguishes rework from an invalid event, including after a reload.
  const latestResult = [...String(order.remarks || '').matchAll(/(?:人工判定\/审核结果|人工审核结果)：(不合格|合格|无效|有效)/g)].at(-1)?.[1];
  return latestResult === '不合格' && ['pending', 'processing', 'review'].includes(order.status);
}

function mapDatabaseEvent(event, finishMedia = {}) {
  const remarks = event.remarks || '';
  const isValid = normalizeReviewStatus(event.is_valid);
  const reviewStatus = isValid ?? (remarks.startsWith('人工审核结果：无效') ? 0 : (remarks.startsWith('人工审核结果：有效') ? 1 : null));
  const rawProcessStatus = String(event.process_status ?? '').trim();
  // Match the existing API contract, including its legacy 0/1 progress values.
  const processStatus = rawProcessStatus === '0' ? '未处理' : rawProcessStatus === '1' ? '已完成' : rawProcessStatus || '未处理';
  const status = { '未处理': 'pending', '处理中': 'processing', '待审核': 'review', '已完成': 'completed' }[processStatus] || 'unknown';
  const alertMedia = parseMediaUrls(event.media_url);
  const processedMedia = parseMediaUrls(finishMedia.media_url || event.finish_media_url || event.processed_media_url || event.after_media_url || event.handle_media_url || event.media_url_finish || '');
  const latitude = toNumberOrNull(event.latitude);
  const longitude = toNumberOrNull(event.longitude);
  const sourceType = `${event.event_type || ''} ${event.detail_type || ''}`;
  return {
    id: String(event.id),
    title: [event.event_type, event.detail_type].filter(Boolean).join(' · ') || `事件 ${event.id}`,
    eventType: event.event_type || event.detail_type || '',
    status,
    processStatus,
    priority: event.priority_level || '普通',
    severity: event.priority_level || '普通',
    category: mapEventCategory(sourceType),
    occurredAt: event.report_time || '--',
    finishAt: event.finish_time || '',
    latitude,
    longitude,
    location: hasValidCoordinates(latitude, longitude) ? `${longitude}, ${latitude}` : '未上报有效坐标',
    licensePlate: event.license_plate || '未识别车牌',
    remarks,
    isValid,
    reviewStatus,
    alertMedia,
    processedMedia,
    evidenceUrl: alertMedia.find(item => item.kind === 'image')?.url || '',
  };
}

function mapEventCategory(sourceType) {
  if (sourceType.includes('非机动车')) return '非机动车';
  if (sourceType.includes('机动车') || sourceType.includes('车辆') || sourceType.includes('货车')) return '机动车';
  if (sourceType.includes('行人') || sourceType.includes('人行')) return '行人';
  return '道路';
}

function parseMediaUrls(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[;\n\r]+/);
  return entries.map(item => String(item).trim()).filter(item => /^https?:\/\//i.test(item)).map(url => ({ url, kind: /\.(mp4|webm|mov|m4v|ogg)(?:[?#]|$)/i.test(url) ? 'video' : 'image' })).sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1);
}
