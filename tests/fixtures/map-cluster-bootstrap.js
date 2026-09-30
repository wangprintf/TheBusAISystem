import { fixtureOrders } from './dashboard-device-data.js';

const sample = fixtureOrders[0];
fixtureOrders.splice(0, fixtureOrders.length, ...Array.from({ length: 360 }, (_, index) => {
  const group = Math.floor(index / 30);
  const within = index % 30;
  const priority = ['高', '中', '低'][index % 3];
  return {
    ...sample, id: `CLUSTER-${index}`, title: `聚合测试事件 ${index + 1}`, priority, severity: priority,
    latitude: 39.061 + Math.floor(group / 4) * 0.002 + Math.floor(within / 6) * 0.00013,
    longitude: 117.133 + group % 4 * 0.003 + within % 6 * 0.00015,
    category: index % 2 ? '道路' : '机动车',
  };
}), { ...sample, id: 'DISTANT', title: '远处的独立事件', latitude: 39.65, longitude: 117.2 });
document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
