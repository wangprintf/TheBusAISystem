import { fixtureOrders } from './dashboard-device-data.js';
const sample = structuredClone(fixtureOrders[0]);
function seed() {
  const pending = [1, 4, 2, 9, 4, 7, 5];
  const now = new Date();
  fixtureOrders.splice(0, fixtureOrders.length, ...[3, 8, 6, 12, 9, 15, 11].flatMap((count, day) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + day);
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 10:00:00`;
    return Array.from({ length: count }, (_, index) => ({ ...sample, id: `MAP-${day}-${index}`, occurredAt: stamp, status: index < pending[day] ? 'pending' : 'processing' }));
  }));
}
seed();
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
const nodes = ['#dashboard-tencent-map'].map(selector => [selector, document.querySelector(selector)]);
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;z-index:1200;bottom:0;left:0;right:0;display:flex;gap:12px;padding:6px;background:#12364a;color:#daeff9;font-size:11px';
bar.innerHTML = '<button data-add>新增今日待处置事件</button><button data-empty>清空事件</button><button data-reset>恢复示例</button><span data-result>本地示例数据，等待 10 秒刷新</span>';
document.body.append(bar);
bar.querySelector('[data-add]').onclick = () => { const today = fixtureOrders.at(-1); if (today) fixtureOrders.push({ ...today, id: `ADDED-${Date.now()}`, status: 'pending' }); bar.querySelector('[data-result]').textContent = '等待刷新：已定位与待处置总数均应增加 1'; };
bar.querySelector('[data-empty]').onclick = () => { fixtureOrders.splice(0); bar.querySelector('[data-result]').textContent = '等待空数据刷新'; };
bar.querySelector('[data-reset]').onclick = seed;
setInterval(() => {
  const stable = nodes.every(([selector, node]) => node === document.querySelector(selector));
  const located = document.querySelector('[data-dashboard-located-count]').textContent;
  const pending = document.querySelector('[data-dashboard-pending-count]').textContent;
  bar.querySelector('[data-result]').textContent = `地图节点保持：${stable ? '通过' : '失败'}；已定位 ${located}；待处置 ${pending}`;
}, 10500);
