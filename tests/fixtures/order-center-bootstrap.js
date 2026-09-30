import { api, fixtureOrders } from './dashboard-device-data.js';

const media = label => ({ kind: 'image', url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#15374b"/><path d="M0 400L800 160M0 280L800 40" stroke="#577786" stroke-width="60"/><text x="400" y="240" text-anchor="middle" fill="#e5f6ff" font-size="36">${label}</text></svg>`)}` });
const sample = fixtureOrders[0];
fixtureOrders.splice(0, fixtureOrders.length, ...Array.from({ length: 36 }, (_, index) => ({
  ...sample, id: String(202609220100 + index),
  title: ['道路安全 · 共享单车占道停放', '道路设施 · 护栏倾倒', '道路病害 · 路面坑洼'][index % 3],
  eventType: ['道路安全', '道路设施', '道路病害'][index % 3],
  location: ['人民路与南京路交叉口', '和平区建设路', '河西区友谊路'][index % 3],
  occurredAt: `2026-09-${String(23 - Math.floor(index / 6)).padStart(2, '0')} ${String(20 - index % 6).padStart(2, '0')}:25:18`,
  status: ['pending', 'processing', 'review', 'completed'][index % 4],
  priority: ['高', '中', '低'][index % 3], reviewStatus: -1, licensePlate: '未识别车牌',
  remarks: index % 4 === 1 ? '2026-09-01 08:00:00-发送工单' : '',
  alertMedia: [media(`事件 ${index + 1} · 报警材料 1`), media(`事件 ${index + 1} · 报警材料 2`)],
  processedMedia: index % 4 >= 2 ? [media(`事件 ${index + 1} · 处理后材料`)] : [],
})));
api.sendWorkOrder = async id => { fixtureOrders.find(order => order.id === id).status = 'processing'; };
api.reviewWorkOrder = async (id, valid) => {
  const index = fixtureOrders.findIndex(order => order.id === id);
  if (!valid) fixtureOrders.splice(index, 1);
  else fixtureOrders[index].status = 'completed';
};
api.remindWorkOrder = async id => { fixtureOrders.find(order => order.id === id).remarks += '；测试催办'; };
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
document.querySelector('[data-open-orders]').click();
