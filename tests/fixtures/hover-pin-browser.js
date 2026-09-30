import { mountDeviceHealth } from '/web/js/device-health.js';
import { mountOrderStatus } from '/web/js/order-status.js';
const devices = Array.from({ length: 12 }, (_, index) => ({ id: `DEV-${index}`, name: `测试车辆 ${index + 1}`, status: index < 6 ? '正常' : index < 9 ? '异常' : '离线', abnormalInfo: index < 6 ? '' : '设备连接异常，请检查线路' }));
const orders = Array.from({ length: 16 }, (_, index) => ({ id: `ORDER-${index}`, title: `测试工单 ${index + 1}`, status: ['pending', 'processing', 'review', 'completed'][index % 4], priority: '高', location: '测试道路', occurredAt: '2026-09-15 10:00:00' }));
const selection = document.querySelector('#selection');
const deviceChart = mountDeviceHealth(document.querySelector('#device-chart'), devices, id => { selection.textContent = `设备详情：${id}`; });
const orderChart = mountOrderStatus(document.querySelector('#order-chart'), orders, id => { selection.textContent = `工单详情：${id}`; });
const targets = [
  { name: '设备', root: '#device-chart', popup: '.device-health-popup', slice: '.device-pie-slice', legend: '.device-pie-legend button', update: () => deviceChart.update(devices) },
  { name: '工单', root: '#order-chart', popup: '.order-status-popup', slice: '.order-ring-slice', legend: '.order-status-legend button', update: () => orderChart.update(orders) },
];
document.querySelector('[data-update]').onclick = () => { devices[0].name = '已更新的测试车辆'; orders[0].title = '已更新的测试工单'; targets.forEach(target => target.update()); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pointer = (element, type) => element.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', bubbles: type === 'pointerdown' }));
let running = false;
document.querySelector('[data-run]').onclick = async () => {
  if (running) return; running = true;
  const output = document.querySelector('#results');
  output.textContent = '';
  function check(condition, message) { if (!condition) throw new Error(message); output.textContent += `通过：${message}\n`; }
  try {
    for (const target of targets) {
      const root = document.querySelector(target.root);
      const popup = document.querySelector(target.popup);
      const slice = root.querySelector(target.slice);
      const legend = root.querySelector(target.legend);
      const close = () => popup.querySelector('header button').click();
      close();
      for (const [name, control] of [['扇区', slice], ['状态框', legend]]) {
        pointer(control, 'pointerenter'); await delay(350);
        const progress = parseFloat(getComputedStyle(popup.querySelector('.hover-pin-progress')).strokeDashoffset);
        check(!popup.hidden && popup.dataset.pinState === 'preview' && progress > 10 && progress < 90, `${target.name}${name}：1 秒内圆圈正在前进`);
        pointer(control, 'pointerleave'); pointer(popup, 'pointerenter');
        check(popup.hidden, `${target.name}${name}：不足 1 秒移入小窗也立即关闭`);
        await delay(750); check(popup.hidden, `${target.name}${name}：移开后旧计时器不会重新打开小窗`);
      }
      pointer(slice, 'pointerenter'); await delay(500);
      pointer(slice, 'pointerleave'); pointer(legend, 'pointerenter'); await delay(550);
      check(popup.dataset.pinState === 'preview', `${target.name}：换到状态框重新计时`);
      legend.click();
      check(popup.dataset.pinState === 'preview', `${target.name}：点击不会提前固定`);
      await delay(550);
      check(popup.dataset.pinState === 'pinned' && popup.querySelector('.hover-pin-indicator').textContent === '已固定', `${target.name}：持续满 1 秒圆圈完成并固定`);
      const row = popup.querySelector('button[data-device-id],button[data-popup-order-id]');
      const indicator = popup.querySelector('.hover-pin-indicator');
      const oldTitle = popup.querySelector('header strong').textContent;
      pointer(legend, 'pointerleave'); pointer(popup, 'pointerenter');
      pointer(document.querySelector('#outside'), 'pointerdown'); document.querySelector('#outside').focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer(root.querySelectorAll(target.legend)[1], 'pointerenter');
      check(!popup.hidden && popup.querySelector('header strong').textContent === oldTitle, `${target.name}：固定后移出、外部点击、Esc 和其他状态不会关闭或切换`);
      row.click(); check(!popup.hidden, `${target.name}：查看详情后小窗仍保留`);
      const list = row.parentElement; list.scrollTop = 40; const scrollTop = list.scrollTop;
      target.update();
      check(popup.dataset.pinState === 'pinned' && row.isConnected && popup.querySelector('.hover-pin-indicator') === indicator && list.scrollTop === scrollTop, `${target.name}：刷新保持固定、小窗节点和滚动位置`);
      close(); check(popup.hidden, `${target.name}：只有 × 关闭且不会因恢复焦点重开`);
      pointer(slice, 'pointerenter'); await delay(150);
      pointer(slice, 'pointerleave'); check(popup.hidden, `${target.name}：重新进入从零计时`);
    }
    output.textContent += '全部交互检查通过';
  } catch (error) { output.textContent += `失败：${error.message}`; }
  finally { running = false; }
};
