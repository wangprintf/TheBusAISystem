// Local preview only. These labeled illustrations never enter production data.
import { api, fixtureOrders } from './dashboard-device-data.js';
const image = (label, repaired = false) => ({ kind: 'image', url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#91a8ad"/><stop offset="1" stop-color="#c7cfc9"/></linearGradient><linearGradient id="road" x2="0" y2="1"><stop stop-color="#7c8381"/><stop offset="1" stop-color="#414e53"/></linearGradient></defs><rect width="960" height="540" fill="url(#sky)"/><path d="M0 165h90v-30h60v55h85v-70h100v85h250v-65h100v-40h80v85h95v-30h100v150H0Z" fill="#6b8586"/><path d="M0 280 430 215h110l420 65v260H0Z" fill="url(#road)"/><path d="M0 340 425 215M960 340 545 215" stroke="#c8c9b6" stroke-width="9"/><path d="m475 244-5 30m-10 40-15 60m-20 70-22 85m115-285 5 30m10 40 15 60m20 70 22 85" stroke="#ddd6ac" stroke-width="6"/>${repaired ? '<path d="m517 386 91-14 79 31-14 47-97 13-67-33Z" fill="#536367" stroke="#7d8b8d" stroke-width="2"/>' : '<path d="m517 386 91-14 79 31-14 47-97 13-67-33Z" fill="#2a3538" stroke="#8b9896" stroke-width="8"/><path d="m543 405 45-10 56 21-34 19-56-7Z" fill="#455356"/>'}<rect x="20" y="20" width="260" height="37" rx="4" fill="#071e2bcc"/><text x="36" y="45" fill="#ecf8f7" font-size="17" font-family="Microsoft YaHei">${label} · 示意影像</text><text x="24" y="516" fill="#e1eee9" font-size="15" font-family="Microsoft YaHei">本地功能预览 / 非现场证据</text></svg>`)}` });
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(d); };
const record = (id, offset, extra = {}) => ({ id, category: '道路', title: '道路病害 · 路面坑洼', eventType: '道路病害',
  latitude: 39.1051, longitude: 117.2081, occurredAt: `${day(offset)} 09:12:00`, status: 'pending', priority: '中',
  location: '津塘路与十一经路交叉口', remarks: '', assignee: '测试养护人员', licensePlate: '测试巡检车辆',
  alertMedia: [image('报警材料')], processedMedia: [], ...extra });
fixtureOrders.splice(0, fixtureOrders.length,
  record('RH-2026-001', -12, { status: 'completed', finishAt: `${day(-10)} 15:20:00`, alertMedia: [image('首次发现'), image('现场全景')], processedMedia: [image('处理后材料', true)] }),
  record('RH-2026-002', -7, { title: '道路设施 · 护栏倾倒', status: 'completed', finishAt: `${day(-6)} 11:00:00`, latitude: 39.1052, processedMedia: [image('现场材料', true)] }),
  record('RH-2026-003', -1, { latitude: 39.10515, longitude: 117.2082, priority: '高', remarks: '等待现场复核' }),
  record('RH-2026-004', -3, { title: '道路设施 · 井盖移位', location: '友谊路 · 文化中心东侧', latitude: 39.0845, longitude: 117.2132, status: 'processing' }),
  record('RH-2026-005', -2, { title: '道路设施 · 标志牌倾斜', location: '卫津路 · 八里台立交附近', latitude: 39.0923, longitude: 117.1781, status: 'review', processedMedia: [image('处理材料', true)] }),
  record('RH-2026-006', -5, { title: '道路病害 · 路面裂缝', location: '南京路 · 营口道附近', latitude: 39.118, longitude: 117.196, status: 'completed', finishAt: `${day(-4)} 16:40:00`, processedMedia: [image('修复材料', true)] }),
  record('RH-2026-007', -2, { title: '道路设施 · 护栏损坏', location: '解放南路', latitude: 39.088, longitude: 117.221 }),
  record('RH-MISSING', -1, { latitude: null, longitude: null }),
);
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario === 'empty') fixtureOrders.splice(0);
if (scenario === 'unlocated') fixtureOrders.forEach(event => { event.latitude = null; });
if (scenario === 'failed-media') fixtureOrders.forEach(event => { event.processedMedia = []; event.processedMediaLoadFailed = true; });
if (scenario === 'refresh-error') {
  const getOrders = api.getWorkOrders;
  let reads = 0;
  api.getWorkOrders = async () => { if (++reads > 1) throw new Error('本地预览：模拟网络断开'); return getOrders(); };
}
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '预览用户', department: '本地演示' }));
await import('/web/js/app.js');
document.querySelector('[data-center-page="health"]').click();
const note = document.createElement('div');
note.textContent = '本地预览 · 使用示例事件与示意影像';
note.style.cssText = 'position:fixed;bottom:8px;right:12px;z-index:100;padding:7px 12px;background:#123641;color:#a3d8d0;border:1px solid #3e6b70;border-radius:5px;font:11px Microsoft YaHei;pointer-events:none';
document.body.append(note);
