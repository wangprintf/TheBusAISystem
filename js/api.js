import { API_CONFIG } from './config.js';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  try {
    const session = JSON.parse(sessionStorage.getItem('traffic-auth') || 'null');
    const response = await fetch(`${API_CONFIG.baseUrl}${path}`, { ...options, signal: controller.signal, headers: { 'Content-Type':'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally { clearTimeout(timer); }
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
  async getDashboard() { return API_CONFIG.useMock ? { todayAlerts:86, validRate:92.6, pendingOrders:14, onlineRate:93.3, trend:[18,25,20,35,28,46,39] } : request('/dashboard'); },
  async getAlerts(filters = {}) {
    if (!API_CONFIG.useMock) return request(`/alerts?${new URLSearchParams(filters)}`);
    return mockAlerts.filter(a => (!filters.status || a.status === filters.status) && (!filters.keyword || `${a.type}${a.location}${a.route}`.includes(filters.keyword)));
  },
  async updateAlert(id, action) {
    if (!API_CONFIG.useMock) return request(`/alerts/${id}/review`, { method:'PATCH', body:JSON.stringify(action) });
    const alert = mockAlerts.find(a => a.id === id); if (!alert) throw new Error('告警不存在');
    alert.status = action.status; return alert;
  },
  async getWorkOrders() {
    const [events, finishMedia] = await Promise.all([
      request('/api/events'),
      request('/api/events/finish').catch(() => []),
    ]);
    const finishMediaByEventId = new Map((Array.isArray(finishMedia) ? finishMedia : []).map(item => [String(item.id), item]));
    return (Array.isArray(events) ? events : [])
      .filter(event => Number(event.is_valid) !== 0)
      .map(event => mapDatabaseEvent(event, finishMediaByEventId.get(String(event.id))));
  },
  async reviewWorkOrder(id, isValid, existingRemarks = '') {
    if (![0, 1].includes(Number(isValid))) throw new Error('审核结果必须为 0 或 1');
    const auditRemark = isValid === 0 ? '人工审核结果：无效' : '人工审核结果：有效';
    const previousRemark = existingRemarks.replace(/^人工审核结果：(无效|有效)[；;]?\s*/, '');
    return requestForm('/api/events/update', {
      id: String(id),
      is_valid: String(isValid),
      remarks: [auditRemark, previousRemark].filter(Boolean).join('；'),
    });
  },
  async sendWorkOrder(id) {
    return requestForm('/api/events/update', { id: String(id), process_status:'处理中' });
  },
  async createWorkOrder(payload) {
    if (!API_CONFIG.useMock) return request('/work-orders', { method:'POST', body:JSON.stringify(payload) });
    const item = { id:`WO-20260713-${String(workOrders.length + 32).padStart(4,'0')}`, status:'pending', assignee:'待指派', dueAt:'待设置', updatedAt:'刚刚', ...payload }; workOrders = [item, ...workOrders]; return item;
  },
  async getDevices() {
    const result = await request('/api/devices');
    const devices = Array.isArray(result) ? result : (result.data || []);
    return devices.map((device) => ({
      id: device.device_id || '',
      name: device.license_plate || '',
      status: device.status || '未知',
      abnormalInfo: device.abnormal_info || '',
      temperature: toNumberOrNull(device.temperature),
      storage: toNumberOrNull(device.storage),
      lastSeen: '数据库同步',
    }));
  },
  async updateSettings(payload) { return API_CONFIG.useMock ? payload : request('/settings', { method:'PUT', body:JSON.stringify(payload) }); },
};

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

function mapDatabaseEvent(event, finishMedia = {}) {
  const remarks = event.remarks || '';
  const reviewStatus = remarks.startsWith('人工审核结果：无效') ? 0 : (remarks.startsWith('人工审核结果：有效') ? 1 : null);
  const processStatus = event.process_status || '未处理';
  const status = processStatus === '已完成'
    ? (reviewStatus === null ? 'review' : 'completed')
    : (processStatus === '处理中' ? 'processing' : 'pending');
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
    isValid: event.is_valid === null || event.is_valid === undefined || event.is_valid === '' ? null : Number(event.is_valid),
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
