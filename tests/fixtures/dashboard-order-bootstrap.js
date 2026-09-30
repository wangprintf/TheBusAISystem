import { fixtureOrders } from './dashboard-device-data.js';
const sample = structuredClone(fixtureOrders[0]);
function rowsFor(counts) {
  return ['pending', 'processing', 'review', 'completed'].flatMap((status, stage) => Array.from({ length: counts[stage] }, (_, index) => ({ ...sample, id: `${status}-${index}`, status, title: `${['机动车违停', '路面坑洼', '道路设施损坏'][index % 3]} · 测试 ${index + 1}`, priority: ['高', '中', '低'][index % 3] })));
}
fixtureOrders.splice(0, fixtureOrders.length, ...rowsFor([38, 8, 0, 0]));
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
const chart = document.querySelector('.order-status-ring');
const slices = [...document.querySelectorAll('.order-ring-slice')];
const map = document.querySelector('#dashboard-tencent-map');
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;z-index:1200;bottom:2px;left:10px;right:10px;display:flex;flex-wrap:wrap;gap:8px;padding:7px;background:#163c50;color:#eefaff;font-size:11px';
bar.innerHTML = '<button data-case="mixed">四种状态</button><button data-case="single">全部已完成</button><button data-case="empty">空工单</button><button data-case="update">更新工单</button><button data-case="skewed">极小扇区</button><span id="fixture-result">测试数据；通过实际的 10 秒刷新更新</span>';
document.body.append(bar);
let popupRow = null;
let popupScroll = null;
bar.addEventListener('click', event => {
  const action = event.target.dataset.case;
  if (!action) return;
  if (action === 'update') {
    popupRow = document.querySelector('.order-status-popup-list button');
    popupScroll = document.querySelector('.order-status-popup-list').scrollTop;
    const record = fixtureOrders[0];
    if (record) record.title = '已更新的工单标题 <img src=x onerror=alert(1)>';
  } else {
    fixtureOrders.splice(0, fixtureOrders.length, ...rowsFor({ mixed: [12, 9, 4, 8], single: [0, 0, 0, 15], empty: [0, 0, 0, 0], skewed: [97, 1, 1, 1] }[action]));
  }
  document.querySelector('#fixture-result').textContent = '测试数据已改变，等待下一次 10 秒刷新';
});
setInterval(() => {
  const stable = chart === document.querySelector('.order-status-ring') && map === document.querySelector('#dashboard-tencent-map') && slices.every((node, index) => node === document.querySelectorAll('.order-ring-slice')[index]);
  const popupStable = !popupRow || popupRow === document.querySelector('.order-status-popup-list button');
  const scrolled = popupScroll === null || popupScroll === document.querySelector('.order-status-popup-list').scrollTop;
  document.querySelector('#fixture-result').textContent = `环图、扇区、地图节点保持：${stable ? '通过' : '失败'}；小窗行保持：${popupStable ? '通过' : '失败'}；滚动保持：${scrolled ? '通过' : '失败'}`;
}, 10500);
