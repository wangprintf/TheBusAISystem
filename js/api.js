import { API_CONFIG } from './config.js';

const mockAlerts = [
  { id:'AL-20260713-0086', type:'路面坑洼', category:'道路病害', severity:'高', status:'pending', confidence:96.8, occurredAt:'10:23:16', route:'B12 路', location:'滨江大道与迎宾路交叉口', longitude:120.192, latitude:30.261, deviceId:'BUS-012', thumbnail:'坑洼', description:'检测到主车道疑似深度较大的路面坑洼，建议优先复核。' },
  { id:'AL-20260713-0085', type:'护栏损坏', category:'道路设施', severity:'中', status:'pending', confidence:93.4, occurredAt:'10:08:42', route:'B12 路', location:'东城路 728 号附近', longitude:120.18, latitude:30.25, deviceId:'BUS-012', thumbnail:'护栏', description:'中央隔离护栏存在倾斜和缺失风险。' },
  { id:'AL-20260713-0081', type:'违规占道施工', category:'市容巡检', severity:'高', status:'dispatched', confidence:91.2, occurredAt:'09:42:03', route:'K8 路', location:'文一路地铁站南侧', longitude:120.16, latitude:30.27, deviceId:'BUS-008', thumbnail:'施工', description:'施工区域疑似未设置完整警示设施。' },
  { id:'AL-20260713-0078', type:'井盖移位', category:'道路病害', severity:'中', status:'valid', confidence:89.7, occurredAt:'09:15:37', route:'K8 路', location:'学院路 318 号', longitude:120.17, latitude:30.24, deviceId:'BUS-008', thumbnail:'井盖', description:'井盖边缘存在明显位移。' },
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
    const response = await fetch(`${API_CONFIG.baseUrl}${path}`, { ...options, signal: controller.signal, headers: { 'Content-Type':'application/json', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally { clearTimeout(timer); }
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
  async getWorkOrders() { return API_CONFIG.useMock ? workOrders : request('/work-orders'); },
  async createWorkOrder(payload) {
    if (!API_CONFIG.useMock) return request('/work-orders', { method:'POST', body:JSON.stringify(payload) });
    const item = { id:`WO-20260713-${String(workOrders.length + 32).padStart(4,'0')}`, status:'pending', assignee:'待指派', dueAt:'待设置', updatedAt:'刚刚', ...payload }; workOrders = [item, ...workOrders]; return item;
  },
  async getDevices() { return API_CONFIG.useMock ? mockDevices : request('/devices'); },
  async updateSettings(payload) { return API_CONFIG.useMock ? payload : request('/settings', { method:'PUT', body:JSON.stringify(payload) }); },
};
