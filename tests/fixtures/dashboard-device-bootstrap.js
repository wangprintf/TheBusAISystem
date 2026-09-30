import { fixtureDevices } from './dashboard-device-data.js';
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
const svg = document.querySelector('.device-pie');
const map = document.querySelector('#dashboard-tencent-map');
const slices = [...document.querySelectorAll('.device-pie-slice')];
const orders = [...document.querySelectorAll('.dashboard-order-row')];
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;z-index:1200;bottom:2px;left:10px;right:10px;display:flex;gap:8px;padding:7px;background:#163c50;color:#eefaff;font-size:11px';
bar.innerHTML = '<button id="fixture-update">更新原因</button><button id="fixture-empty">空设备</button><button id="fixture-single">仅离线设备</button><button id="fixture-many">大量异常设备</button><span id="fixture-result">本页仅为测试数据；每 10 秒运行实际大屏刷新</span>';
document.body.append(bar);
const result = document.querySelector('#fixture-result');
document.querySelector('#fixture-update').onclick = () => {
  const device = fixtureDevices.find(device => device.status === '异常');
  if (device) device.abnormalInfo = '已更新：摄像头连接异常，等待检修';
  result.textContent = '已改变测试数据，等待下一次 10 秒刷新';
};
document.querySelector('#fixture-empty').onclick = () => { fixtureDevices.splice(0); result.textContent = '等待下次刷新为空数据'; };
document.querySelector('#fixture-single').onclick = () => { fixtureDevices.splice(0, fixtureDevices.length, { id: 'TEST-OFFLINE', name: '离线测试设备', status: '离线' }); result.textContent = '等待下次刷新为 100% 离线'; };
document.querySelector('#fixture-many').onclick = () => {
  fixtureDevices.splice(0, fixtureDevices.length, ...Array.from({ length: 30 }, (_, index) => ({ id: `ERR-${index}`, name: `异常测试 ${index}`, status: '异常', abnormalInfo: index ? '长原因测试：视频链路中断，需要现场检查接线并确认设备供电。'.repeat(2) : '<img src=x onerror=alert(1)> 文本转义验证' })));
  result.textContent = '等待下次刷新为 30 台异常设备';
};
setInterval(() => {
  const stable = svg === document.querySelector('.device-pie') && map === document.querySelector('#dashboard-tencent-map')
    && slices.every((node, i) => node === document.querySelectorAll('.device-pie-slice')[i])
    && orders.every((node, i) => node === document.querySelectorAll('.dashboard-order-row')[i]);
  result.textContent = `图表、地图、工单节点保持：${stable ? '通过' : '失败'}；设备总数 ${fixtureDevices.length}`;
}, 10500);
